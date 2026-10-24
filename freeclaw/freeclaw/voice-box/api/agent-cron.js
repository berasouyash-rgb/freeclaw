// Agent Cron — Vercel cron endpoint for autonomous agent execution.
import { timingSafeEqual } from "node:crypto";
import {
	ALL_AGENTS,
	classifyTask,
	processAgentTask,
	runSupervisorScan,
	saveAgentReport,
	setAgentState,
} from "./_agent-team.js";
// Runs the full roster (opt-out model: agents run unless explicitly
// deactivated or marked autonomous:false). Every run is recorded into
// agent_executions via _runner.runAgent so the Agent Office dashboard
// shows real working/results stats. Supervisor scan runs after agents.
import { cors, isAdmin } from "./_auth.js";
import { runImprovementScans } from "./_improve-scan.js";
import supabase from "./_db-client.js";
import { patrol } from "./_workforce.js";
import { runAgent } from "./agents/_runner.js";
// Single source of truth for every deterministic worker: the registry names
// each worker's module + run function, and the loop below (plus the OpsCenter
// "Run" button and the workforce API) all drive exactly those code paths.
import { recordLastRun, WORKERS } from "./_automation-registry.js";

export const config = { runtime: "nodejs" };

// Bounded concurrency so provider rate limits are respected while the full
// roster still completes well inside the 60s function window.
const CONCURRENCY = 12;
const AGENT_TIMEOUT_MS = 25000;

// ── TICK BUDGET ────────────────────────────────────────────────────────
// This function runs under a hard platform limit (vercel.json → all /api/*
// rewrites to api/index.js, maxDuration 60s) and Vercel KILLS an overrunning
// invocation mid-run. Measured against the real system, one tick needed the
// 90-agent roster pass PLUS ~17s of workforce maintenance PLUS ~45s for a
// single patrol task — every production tick therefore died before it could
// record anything, which is exactly why the workforce looked dead. Every
// phase now runs against a wall-clock deadline; work that does not fit is
// reported as `deferred` and picked up by the next run (manual OpsCenter
// run, workforce API, or scheduled tick where configured) instead of being
// silently destroyed. Override with AGENT_TICK_BUDGET_MS.
const TICK_BUDGET_MS = Math.max(
	10_000,
	Number(process.env.AGENT_TICK_BUDGET_MS) || 50_000,
);
// The roster pass is observational (each agent asks a model for a status
// report). Cap it at 40% so the maintenance passes that actually change
// platform state always get time under the deadline.
const ROSTER_BUDGET_MS = Math.floor(TICK_BUDGET_MS * 0.4);

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(200).end();

	// Vercel cron sends a secret header; verify its value (constant-time) or
	// fall back to real admin auth. Header presence alone is not authentication.
	// Vercel cron sends the secret as "Authorization: Bearer <CRON_SECRET>" (not
	// x-vercel-cron-secret). Accept Bearer, x-vercel-cron-secret, or x-cron-secret,
	// verified constant-time, then fall back to a real admin session.
	let authorized = false;
	const authHeader = String(req.headers["authorization"] || "");
	const bearerToken = authHeader.startsWith("Bearer ")
		? authHeader.slice(7)
		: null;
	const cronSecret =
		req.headers["x-vercel-cron-secret"] ||
		req.headers["x-cron-secret"] ||
		bearerToken;
	if (cronSecret && process.env.CRON_SECRET) {
		const a = Buffer.from(String(cronSecret));
		const b = Buffer.from(String(process.env.CRON_SECRET));
		authorized = a.length === b.length && timingSafeEqual(a, b);
	}
	if (!authorized) authorized = await isAdmin(req);
	if (!authorized) {
		return res
			.status(401)
			.json({
				error:
					"Unauthorized - requires valid Authorization: Bearer CRON_SECRET, x-vercel-cron-secret, or x-admin-token",
			});
	}

	try {
		const tickStart = Date.now();
		const deadline = tickStart + TICK_BUDGET_MS;
		const remainingMs = () => deadline - Date.now();
		const rosterDeadline = tickStart + ROSTER_BUDGET_MS;
		const rosterMs = () => rosterDeadline - Date.now();
		const phaseMs = {};

		// ── Dedicated patrol slot (?action=patrol) ─────────────────────────
		// A full tick cannot hold the roster + maintenance + a real patrol
		// inside the 60s platform limit, so the LLM-driven orchestration gets
		// its own cron entry and runs ONLY the patrol, which fits on its own.
		if (req.query.action === "patrol" || req.body?.action === "patrol") {
			// One LLM-orchestrated task measures 45-90s against the live provider
			// fleet, which can exceed the 60s function limit. Race it against a
			// deadline so the response ALWAYS returns in time: if the task is
			// still running we say so honestly (timed_out) and the in-flight job
			// stays claimed, where recoverStale() requeues it on the next patrol
			// — instead of the whole invocation being killed with no evidence.
			const PATROL_DEADLINE_MS = Math.max(
				10_000,
				Number(process.env.AGENT_PATROL_DEADLINE_MS) || 50_000,
			);
			const r = await Promise.race([
				patrol({ limit: 1 }).then(
					(v) => ({ value: v }),
					(e) => ({ error: e.message }),
				),
				new Promise((res) =>
					setTimeout(() => res({ timedOut: true }), PATROL_DEADLINE_MS),
				),
			]);
			if (r.error) {
				return res
					.status(500)
					.json({ ok: false, slot: "patrol", error: r.error });
			}
			if (r.timedOut) {
				return res.status(200).json({
					ok: true,
					slot: "patrol",
					timed_out: true,
					deadline_ms: PATROL_DEADLINE_MS,
					duration_ms: Date.now() - tickStart,
					note:
						"patrol exceeded its deadline — the in-flight job stays claimed and is requeued by recoverStale() on the next patrol",
				});
			}
			return res.status(200).json({
				ok: true,
				slot: "patrol",
				workforce: r.value,
				duration_ms: Date.now() - tickStart,
			});
		}

		// Get activation state
		const { data: settingsRow } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "agent_activation_state")
			.single();
		const activationState = settingsRow?.value || {};

		// Opt-out model: every agent runs unless explicitly deactivated
		// (active:false) or explicitly marked non-autonomous (autonomous:false).
		const enabled = ALL_AGENTS.filter((a) => {
			if (a.status === "inactive") return false;
			const act = activationState[a.id];
			return act?.active !== false && act?.autonomous !== false;
		});

		// ── BEHAVIOUR GATE ───────────────────────────────────────────
		// An agent whose capabilities match no router branch falls through to
		// the generic "ask an LLM for a status report" fallback. That path
		// spends real tokens and writes a real execution row while changing
		// nothing in the platform, so it was inflating the Office dashboard
		// with work that never happened. Such agents are skipped and reported
		// instead of executed.
		const { classifyAgent, auditRoster } = await import(
			"./_agent-behaviours.js"
		);
		const agentsToRun = [];
		const skippedNoBehaviour = [];
		for (const a of enabled) {
			const cls = classifyAgent(a);
			if (cls.status === "retired") {
				skippedNoBehaviour.push({
					agent_id: a.id,
					name: a.name,
					reason: cls.reason,
				});
				setAgentState(a.id, "idle", "No routed behaviour — skipped");
				continue;
			}
			agentsToRun.push({ agent: a, behaviour: cls });
		}

		if (enabled.length === 0) {
			return res
				.status(200)
				.json({
					ok: true,
					message: "No agents configured for autonomous execution",
					executed: 0,
				});
		}

		// Run the full roster in parallel with bounded concurrency. Each run is
		// recorded by runAgent → agent_executions (settings fallback if the
		// table is missing) so Office 7-day stats reflect real work.
		const results = [];
		const queue = [...agentsToRun];

		const worker = async () => {
			while (queue.length > 0) {
				// Stop pulling roster work once this phase's slice is spent —
				// leftover agents stay queued and are reported as deferred.
				if (rosterMs() <= 3000) break;
				const entry = queue.shift();
				const agent = entry.agent;
				const startTime = Date.now();
				const task = classifyTask(agent.description || agent.name);
				try {
					setAgentState(agent.id, "working", "Autonomous cron scan");
					const taskFn = () =>
						Promise.race([
							processAgentTask(agent, "Autonomous scheduled scan", task),
							new Promise((_, reject) =>
								setTimeout(
									() => reject(new Error("Cron timeout")),
									Math.min(AGENT_TIMEOUT_MS, Math.max(3000, rosterMs())),
								),
							),
						]);
					taskFn.description = `Autonomous scan: ${agent.name}`;
					const execution = await runAgent(
						agent.id,
						agent.name,
						agent.division,
						taskFn,
						"cron",
					);
					const duration = Date.now() - startTime;
					if (
						execution.status === "completed" &&
						execution.output &&
						execution.output.type !== "error"
					) {
						await saveAgentReport(
							agent.id,
							agent.name,
							agent.division,
							execution.output,
							"Autonomous cron scan",
							duration,
						);
							results.push({
							agent_id: agent.id,
							status: "completed",
							duration_ms: duration,
							execution_id: execution.execution_id,
							// What this agent was actually able to do, so the dashboard
							// can separate liveness from real impact.
							behaviour_id: entry.behaviour.behaviour_id,
							impact: entry.behaviour.impact,
						});
					} else {
						results.push({
							agent_id: agent.id,
							status: "error",
							behaviour_id: entry.behaviour.behaviour_id,
							impact: entry.behaviour.impact,
							error:
								execution.error ||
								execution.output?.data?.error ||
								"Agent execution failed",
						});
					}
					setAgentState(agent.id, "completed", "Autonomous cron scan");
				} catch (err) {
					results.push({
						agent_id: agent.id,
						status: "error",
						error: err.message,
					});
					setAgentState(agent.id, "error", "Cron failed");
				}
			}
		};

		const workerCount = Math.min(CONCURRENCY, queue.length);
		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		// Whatever the roster slice could not reach this tick.
		const deferredAgents = queue.length;
		phaseMs.roster = Date.now() - tickStart;

		// After all agents run, run supervisor scan
		let supervisorResult = { deferred: true, reason: "tick budget spent" };
		const supStart = Date.now();
		if (remainingMs() > 4000) {
			supervisorResult = await runSupervisorScan();
		}
		phaseMs.supervisor = Date.now() - supStart;

		// ── IMPROVEMENT SCAN PASS ────────────────────────────────────
		// Five hidden audit scanners (content/security/db/perf/UX) queue
		// SUGGESTIONS into the admin improvement desk. Suggestions never
		// self-apply — an admin approves each one. Bounded read-only queries.
		let improvements = null;
		const impStart = Date.now();
		try {
			improvements =
				remainingMs() > 6000
					? await runImprovementScans()
					: { deferred: true, reason: "tick budget spent" };
		} catch (impErr) {
			console.error(
				"[agent-cron] Improvement scan failed:",
				impErr.message,
			);
			improvements = { ok: false, error: impErr.message };
		}
		phaseMs.improvements = Date.now() - impStart;

		// ── REGISTRY-DRIVEN WORKFORCE PASS ───────────────────────────
		// The _automation-registry WORKERS[] is the single source of truth
		// for every deterministic worker: each entry names the module + run
		// function it maps to, so the OpsCenter UI, the manual Run button,
		// and this cron all drive exactly the same code paths. One shared
		// loop executes them in registry order; each phase is budget-guarded
		// (deferred once the deadline is near — never silently dropped) and
		// every completed run is recorded for the Automations section.
		// Converge with durable supervisor state first: on serverless a warm
		// instance may hold stale pauses/backoff streaks, so re-hydrate from
		// the settings row (one read per tick) before gating any worker.
		// Best-effort - memory stays authoritative on read failure.
		try {
			const { reloadSupervisorState } = await import("./_worker-supervisor.js");
			await reloadSupervisorState();
		} catch {
			/* convergence is best-effort */
		}
		const phaseResults = {};
		for (const w of WORKERS) {
			const phaseStart = Date.now();
			try {
				if (remainingMs() > 8000) {
					const mod = await import(w.module);
					const fn = mod[w.run];
					if (typeof fn !== "function")
						throw new Error(
							`module ${w.module} does not export ${w.run}()`,
						);
					phaseResults[w.id] = await fn();
				} else {
					phaseResults[w.id] = {
						deferred: true,
						reason: "tick budget spent",
					};
				}
			} catch (err) {
				const msg = (err && err.message) || String(err) || "unknown error";
				console.error(
					`[agent-cron] ${w.id} (${w.name}) failed:`,
					msg,
				);
				phaseResults[w.id] = { ok: false, error: msg, worker: w.id };
			}
			phaseMs[w.id] = Date.now() - phaseStart;
		}

		// Named handles keep the response contract stable — OpsCenter and
		// integration tests read these exact field names.
		const {
			"poll-sweep": poll_sweep,
			sla,
			reopen,
			followup,
			"poll-integrity": poll_integrity,
			storage,
			trends,
			anonymity,
			"comment-watch": comment_watch,
		} = phaseResults;

		// ── WORKFORCE ROSTER PASS ────────────────────────────────────
		// High-value roster: each worker runs the full lifecycle
		// (observe→verify→log). Class-A workers execute safe autonomous
		// only collect evidence and escalate. Every outcome lands in the ledger.
		let workforce_roster = null;
		const hvStart = Date.now();
		try {
			if (remainingMs() > 5000) {
				const { runHighValueRoster } = await import(
					"./_workforce-workers.js"
				);
				workforce_roster = await runHighValueRoster("cron");
			} else {
				workforce_roster = { deferred: true, reason: "tick budget spent" };
			}
		} catch (wfErr) {
			console.error("[agent-cron] Workforce roster failed:", wfErr.message);
			workforce_roster = { ok: false, error: wfErr.message };
		}
		phaseMs.high_value_roster = Date.now() - hvStart;

		// ── WORKFORCE ORCHESTRATION PASS ─────────────────────────────
		// Real task queue: discover real signals → assign capable workers →
		// execute → verify. Records every transition to agent_tasks + the
		// runner so the dashboard reflects real state, never fabrication.
		//
		// NOTE: the Vercel cron window is ~60s and the full roster already ran
		// above. Executing LLM chains takes 30-60s per task, so the cron patrol
		// executes at most ONE task and leaves the rest for the next tick or a
		// manual admin patrol — otherwise the function would be killed mid-run.
		let workforce = null;
		const wfStart = Date.now();
		try {
			// patrol() executes a real task per dispatched job and measured ~45s
			// for a single one — it only fits when the other phases left most of
			// the tick, so normally it is deferred to its own cron slot above.
			// Deferring is honest and costs nothing: the job stays QUEUED.
			if (remainingMs() > 48000) {
				workforce = await patrol({ limit: 1 });
			} else {
				workforce = {
					deferred: true,
					reason: `patrol needs ~48s, ${Math.max(0, Math.round(remainingMs() / 1000))}s left — runs in the dedicated patrol slot`,
				};
			}
		} catch (wfErr) {
			console.error("[agent-cron] Workforce patrol failed:", wfErr.message);
			workforce = { ok: false, error: wfErr.message };
		}
		phaseMs.patrol = Date.now() - wfStart;
		const succeeded = results.filter((r) => r.status === "completed").length;
		const roster = auditRoster(ALL_AGENTS);
		// Persist last-run summaries so the OpsCenter Automations section
		// shows what each deterministic worker did — best-effort, never fatal.
		try {
			for (const [id, r] of Object.entries(phaseResults)) {
				if (r) await recordLastRun(supabase, id, r);
			}
		} catch {
			/* last-run persistence is best-effort */
		}
		return res
			.status(200)
			.json({
				ok: true,
				executed: results.length,
				succeeded,
				// Honest budget accounting: what this tick deferred, and where the
				// time actually went. Never silently dropped.
				deferred_agents: deferredAgents,
				budget_ms: TICK_BUDGET_MS,
				phase_ms: phaseMs,
				duration_ms: Date.now() - tickStart,
				// Honest accounting: how many agents were skipped because they
				// cannot change anything, and how much of the roster can.
				skipped_no_behaviour: skippedNoBehaviour.length,
				skipped_agents: skippedNoBehaviour,
				roster: {
					agents_total: roster.agents_total,
					agents_reaching_a_behaviour: roster.agents_reaching_a_behaviour,
					agents_retired: roster.agents_retired,
					behaviours_available: roster.behaviours_available,
					behaviours_state_changing: roster.behaviours_state_changing,
				},
				results,
				supervisor: supervisorResult,
				improvements,
				// Named handles (stable contract for existing readers) plus
				// the full per-worker map: every registry entry, newest
				// workers included — nothing runs invisibly.
				phases: phaseResults,
				poll_sweep,
				sla,
				reopen,
				followup,
				poll_integrity,
				storage,
				trends,
				anonymity,
				comment_watch,
				workforce_roster,
				workforce,
			});
	} catch (err) {
		console.error("[agent-cron] Fatal error:", err.message);
		return res.status(500).json({ error: err.message });
	}
}
