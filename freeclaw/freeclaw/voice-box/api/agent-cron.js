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

export const config = { runtime: "nodejs" };

// Bounded concurrency so provider rate limits are respected while the full
// roster still completes well inside the 60s function window.
const CONCURRENCY = 12;
const AGENT_TIMEOUT_MS = 25000;

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
		// Get activation state
		const { data: settingsRow } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "agent_activation_state")
			.single();
		const activationState = settingsRow?.value || {};

		// Opt-out model: every agent runs unless explicitly deactivated
		// (active:false) or explicitly marked non-autonomous (autonomous:false).
		const agentsToRun = ALL_AGENTS.filter((a) => {
			if (a.status === "inactive") return false;
			const act = activationState[a.id];
			return act?.active !== false && act?.autonomous !== false;
		});

		if (agentsToRun.length === 0) {
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
				const agent = queue.shift();
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
									AGENT_TIMEOUT_MS,
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
						});
					} else {
						results.push({
							agent_id: agent.id,
							status: "error",
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

		// After all agents run, run supervisor scan
		const supervisorResult = await runSupervisorScan();

		// ── IMPROVEMENT SCAN PASS ────────────────────────────────────
		// Five hidden audit scanners (content/security/db/perf/UX) queue
		// SUGGESTIONS into the admin improvement desk. Suggestions never
		// self-apply — an admin approves each one. Bounded read-only queries.
		let improvements = null;
		try {
			improvements = await runImprovementScans();
		} catch (impErr) {
			console.error(
				"[agent-cron] Improvement scan failed:",
				impErr.message,
			);
			improvements = { ok: false, error: impErr.message };
		}

		// ── WORKFORCE ROSTER PASS ────────────────────────────────────
		// Ten high-value workers run the full lifecycle (observe→verify→log).
		// Class-A workers execute safe autonomous maintenance; Class-C workers
		// only collect evidence and escalate. Every outcome lands in the ledger.
		let workforce_roster = null;
		try {
			const { runHighValueRoster } = await import("./_workforce-workers.js");
			workforce_roster = await runHighValueRoster("cron");
		} catch (wfErr) {
			console.error("[agent-cron] Workforce roster failed:", wfErr.message);
			workforce_roster = { ok: false, error: wfErr.message };
		}

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
		try {
			workforce = await patrol({ limit: 1 });
		} catch (wfErr) {
			console.error("[agent-cron] Workforce patrol failed:", wfErr.message);
			workforce = { ok: false, error: wfErr.message };
		}

		const succeeded = results.filter((r) => r.status === "completed").length;
		return res
			.status(200)
			.json({
				ok: true,
				executed: results.length,
				succeeded,
			results,
			supervisor: supervisorResult,
			improvements,
			workforce_roster,
			workforce,
		});
	} catch (err) {
		console.error("[agent-cron] Fatal error:", err.message);
		return res.status(500).json({ error: err.message });
	}
}
