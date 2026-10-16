// ═══════════════════════════════════════════════════════════════
// AI WORKFORCE ORCHESTRATOR — Persistent task queue + real loop
// ═══════════════════════════════════════════════════════════════
// The execution layer (runner → agent_executions) already exists and
// is real. This module adds the TASK layer that makes the workforce
// operate like a company:
//
//   DISCOVER (real signals) → CREATE TASK → ASSIGN (capability match)
//   → CLAIM → EXECUTE (real runner) → VERIFY → COMPLETE/FAIL
//   → MEMORY + AUDIT + REALTIME EVENT → NEXT TASK
//
// Everything is persisted (agent_tasks table, settings fallback when
// the table hasn't been migrated). No fabricated activity — every row
// reflects a real transition.
// ═══════════════════════════════════════════════════════════════

import {
	ALL_AGENTS,
	classifyTask,
	getAgentState,
	processAgentTask,
	setAgentState,
} from "./_agent-team.js";
import { auditLog, clean, cors, isAdmin } from "./_auth.js";
import { isTestArtifact } from "./_artifact-filter.js";
import supabase from "./_db-client.js";
import { getLearningStatus, runContinuousEvaluation } from "./_continuous-learning.js";
import { sanitizeError } from "./_error.js";
import { getEvaluationHistory } from "./_evaluation-engine.js";
import { emitEvent } from "./_events.js";
import { getRedteamStatus, runRedTeam } from "./_redteam-cases.js";
import { workforceHealth } from "./_workforce-core.js";
import { getSupervisorSummary, unpauseWorker } from "./_worker-supervisor.js";
import { TRAINING_SCENARIOS } from "./_training-lab.js";
import { logActivity, recordMetric, runAgent } from "./agents/_runner.js";

const TASK_KEY = "agent_tasks_store";
const CONFIG_KEY = "workforce_config";
const MAX_STORED = 300;

// Terminal states — the only tasks that may be evicted when the store hits
// MAX_STORED. Non-terminal work (blocked/queued/claimed/working/verifying)
// is NEVER dropped: a blocked approval task must not silently vanish and
// orphan its Approval Center alert, and live work must not disappear
// mid-flight (spec §16 anti-fantasy + §7 approval guarantees).
const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
	"rejected",
]);

// Cap the store, evicting ONLY terminal tasks (oldest first). Never evict
// pending or in-flight work — an approval decision must always be reachable.
function capTasks(tasks) {
	const pending = (tasks || []).filter((t) => !TERMINAL_STATUSES.has(t.status));
	const terminal = (tasks || []).filter((t) => TERMINAL_STATUSES.has(t.status));
	const room = Math.max(0, MAX_STORED - pending.length);
	return [...pending, ...terminal.slice(0, room)];
}
const HEARTBEAT_MS = 10000; // worker liveness write cadence
const STALE_WORKING_MS = 10 * 60 * 1000; // working w/o heartbeat → stale
const STALE_QUEUED_MS = 24 * 60 * 60 * 1000; // unclaimed too long → fail

// ─── Table detection (TTL-cached, mirrors _runner.js) ─────────────
// The live DB may have an OLD agent_tasks schema (id, thread_id,
// agent_id, task, priority, status, ...) with no title/source_ref/
// heartbeat columns. We probe for a modern column: if the table is
// missing or legacy, the settings store is used (fully supported).
let _tasksTable = null;
let _tasksCheckedAt = 0;
const TABLE_CACHE_TTL_MS = 5 * 60 * 1000;

async function hasTasksTable() {
	const now = Date.now();
	if (_tasksTable !== null && now - _tasksCheckedAt < TABLE_CACHE_TTL_MS)
		return _tasksTable;
	try {
		// Probe a WORKFORCE-ONLY column. `title` was wrong: the legacy/chat
		// `agent_tasks` schema (thread_id, agent_id, task, …) has no title column,
		// so the probe errored and the runtime silently degraded to the settings
		// store even when the modern table existed. assigned_agent exists only in
		// the workforce schema, so the probe is now deterministic.
		const { error } = await supabase
			.from("agent_tasks")
			.select("assigned_agent")
			.limit(1);
		_tasksTable = !error; // only true when the modern workforce schema exists
	} catch {
		_tasksTable = false;
	}
	_tasksCheckedAt = now;
	return _tasksTable;
}

// ─── Task store (table-first, settings fallback) ──────────────────
async function listTasks({ status, agentId, limit = 100 } = {}) {
	const useTable = await hasTasksTable();
	if (useTable) {
		let q = supabase
			.from("agent_tasks")
			.select("*")
			.order("created_at", { ascending: false })
			.limit(limit);
		if (status) q = q.eq("status", status);
		if (agentId) q = q.eq("assigned_agent", agentId);
		const { data } = await q;
		return data || [];
	}
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", TASK_KEY)
		.maybeSingle();
	let tasks = data?.value?.tasks || [];
	if (status) tasks = tasks.filter((t) => t.status === status);
	if (agentId) tasks = tasks.filter((t) => t.assigned_agent === agentId);
	return tasks.slice(0, limit);
}

async function saveTasks(tasks) {
	try {
		await supabase
			.from("settings")
			.upsert(
				{
					key: TASK_KEY,
					value: { tasks, updated_at: new Date().toISOString() },
				},
				{ onConflict: "key" },
			);
	} catch (err) {
		console.error("[workforce] saveTasks failed:", err.message);
	}
}

async function createTask({
	title,
	description,
	source = "system",
	source_ref = null,
	priority = "medium",
	required_capability = null,
	risk_level = "low",
	input = null,
	created_by = "system",
	parent_task_id = null,
	dedupe = "open",
}) {
	const titleClean = clean(String(title || ""), 200);
	if (!titleClean) return null;
	// SAFETY GATE (master prompt §24/§43): high/critical risk never runs
	// autonomously — parked in BLOCKED until an admin approves via the
	// approve-task command. Only low/medium risk enters the queue.
	const needsApproval = ["high", "critical"].includes(
		String(risk_level || "low"),
	);
	const task = {
		id: crypto.randomUUID(),
		title: titleClean,
		description: clean(String(description || ""), 2000) || null,
		source,
		source_ref,
		priority,
		status: needsApproval ? "blocked" : "queued",
		assigned_agent: null,
		parent_task_id: parent_task_id ? clean(String(parent_task_id), 64) : null,
		required_capability,
		risk_level,
		input,
		output: null,
		outcomes: null,
		error: null,
		verification_status: needsApproval ? "awaiting_approval" : "none",
		attempts: 0,
		max_attempts: 3,
		created_by,
		created_at: new Date().toISOString(),
		claimed_at: null,
		started_at: null,
		heartbeat_at: null,
		completed_at: null,
	};

	// Dedupe: identical source_ref skips. 'open' = only skip while the same
	// work is still pending (discovery may re-triage once an old task
	// completed — e.g. a report reopened). 'all' = skip even if the earlier
	// task finished (handoff children must NEVER be created twice for the
	// same target, so chains cannot grow unbounded).
	// NOTE: 'blocked' counts as pending — a task awaiting approval must never
	// be re-created on the next patrol, or the Approval Center would fill with
	// duplicates of the same high-risk decision.
	if (source_ref) {
		const existing = await listTasks({ limit: 500 });
		const dup = existing.find((t) => t.source_ref === source_ref);
		if (dup) {
			if (dedupe === "all") return null;
			if (["queued", "claimed", "working", "blocked"].includes(dup.status))
				return null;
		}
	}

	// High/critical risk never runs autonomously — park it in the Approval
	// Center AND raise an admin alert so the boss sees it without polling.
	// Grouped by source_ref: one alert per approval decision, never a flood.
	if (needsApproval) {
		// Stable key: source_ref is the same target across re-triages; fall back
		// to the title so tasks without a source_ref still group instead of
		// raising a fresh alert on every patrol.
		raiseAlert({
			severity: "high",
			// Some task creators already prefix their title (e.g. escalate-post
			// writes "Approval required: …") — never double-prefix the alert.
			title: titleClean.startsWith("Approval required:")
				? titleClean
				: `Approval required: ${titleClean}`,
			body: clean(String(description || ""), 300) || null,
			agent: created_by,
			key: `approval:${source_ref || titleClean}`,
			evidence: `${String(risk_level).toUpperCase()} risk — parked in the Approval Center until an administrator decides`,
		}).catch(() => {});
	}

	const useTable = await hasTasksTable();
	if (useTable) {
		const { data, error } = await supabase
			.from("agent_tasks")
			.insert(task)
			.select()
			.single();
		if (error) {
			console.warn(
				"[workforce] createTask table insert failed:",
				error.message,
			);
			await saveTasks(
				capTasks([...(await listTasks({ limit: 1000 })), task]),
			);
		} else {
			emitEvent("task.created", {
				task_id: data.id,
				title: data.title,
				priority: data.priority,
			}).catch(() => {});
			return data;
		}
	} else {
		const all = await listTasks({ limit: 1000 });
		await saveTasks(capTasks([task, ...all]));
	}
	emitEvent("task.created", {
		task_id: task.id,
		title: task.title,
		priority: task.priority,
	}).catch(() => {});
	return task;
}

async function updateTask(id, patch) {
	const useTable = await hasTasksTable();
	if (useTable) {
		const { data, error } = await supabase
			.from("agent_tasks")
			.update(patch)
			.eq("id", id)
			.select()
			.single();
		if (error) {
			console.warn("[workforce] updateTask failed:", error.message);
			return null;
		}
		return data;
	}
	const all = await listTasks({ limit: 1000 });
	const idx = all.findIndex((t) => t.id === id);
	if (idx === -1) return null;
	all[idx] = { ...all[idx], ...patch };
	await saveTasks(all);
	return all[idx];
}

// ─── REAL WORK DISCOVERY — creates tasks from real signals ────────
async function discoverWork() {
	// Kill switch §24: maintenance mode and an active GLOBAL STOP freeze NEW
	// autonomous work. Monitoring (heartbeats, recovery, alerts) keeps running
	// — the workforce just stops creating fresh tasks from real signals.
	const cfg = await getConfig();
	if (cfg.maintenance || isStopActive(cfg)) return [];
	const created = [];
	const push = async (t) => {
		const r = await createTask(t);
		if (r) created.push(r);
	};

	// 1. Pending user reports → report triage tasks (dedupe by source_ref)
	//    Note: this DB stores open reports as status IS NULL (or 'pending')
	//    SAFETY GATE: a target with 2+ pending reports is a coordinated-abuse
	//    signal → HIGH risk → parked BLOCKED in the Approval Center (never
	//    auto-executed). Single reports stay medium-risk triage.
	try {
		const { data: reports } = await supabase
			.from("reports")
			.select("id, reason, target_type, target_id, created_at")
			.or("status.is.null,status.eq.pending")
			.limit(100);
		const byTarget = {};
		for (const r of reports || []) {
			const key = `${r.target_type || "post"}:${r.target_id || "?"}`;
			(byTarget[key] = byTarget[key] || []).push(r);
		}
		for (const [key, list] of Object.entries(byTarget)) {
			const [targetType, targetId] = key.split(":");
			if ((list || []).length >= 2) {
				// Coordinated abuse → approval-gated moderation decision
				await push({
					title: `Approval required: hide reported ${targetType} ${String(targetId).slice(0, 12)}`,
					description: `${list.length} users reported this ${targetType} within the review window. High-risk moderation decision — approve to execute the policy action, reject to dismiss.`,
					source: "report",
					source_ref: `coordinated:${targetId}`,
					priority: "critical",
					risk_level: "high",
					required_capability: "content_moderation",
					// decision:'hide' is the SANCTIONED ACTION the admin endorses when
					// approving — applyApprovedDecision only executes with this marker,
					// so approving this task really hides the target + resolves reports.
					input: {
						decision: "hide",
						target_type: targetType,
						target_id: targetId,
						report_ids: list.map((r) => r.id),
						reasons: list.map((r) => clean(String(r.reason || ""), 80)),
						escalated_by: "discovery",
					},
					created_by: "discovery",
				});
				continue;
			}
			const r = list[0];
			await push({
				title: `Triage report: ${clean(String(r.reason || "content report"), 80)}`,
				description: `Report ${r.target_type || "content"} flagged by a user. Investigate, classify, and apply the policy workflow.`,
				source: "report",
				source_ref: `report:${r.id}`,
				priority: "high",
				risk_level: "medium",
				required_capability: "report_triage",
				input: {
					report_id: r.id,
					target_type: r.target_type,
					target_id: r.target_id,
					reason: r.reason,
				},
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] report discovery failed:", err.message);
	}

	// 2. Failed agent executions → self-healing tasks
	try {
		const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
		const { data: failed } = await supabase
			.from("agent_executions")
			.select("agent_id, agent_name, error, started_at")
			.eq("status", "failed")
			.gte("started_at", oneHourAgo)
			.limit(20);
		for (const f of (failed || []).slice(0, 10)) {
			await push({
				title: `Diagnose failure: ${f.agent_name || f.agent_id}`,
				description: `Agent execution failed: ${clean(String(f.error || "unknown error"), 200)}. Diagnose, repair, and verify.`,
				source: "error",
				source_ref: `error:${f.agent_id}:${f.started_at ? new Date(f.started_at).getTime() : Date.now()}`,
				priority: "high",
				risk_level: "medium",
				required_capability: "self_healing",
				input: { agent_id: f.agent_id, error: f.error },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] error discovery failed:", err.message);
	}

	// 3. Stale running executions (heartbeat expired) → recovery tasks
	try {
		const stale = await findStaleRunningExecutions();
		for (const e of stale.slice(0, 10)) {
			await push({
				title: `Recover stuck execution: ${e.agent_name || e.agent_id}`,
				description: `Execution started ${new Date(e.started_at).toISOString()} has no heartbeat. Mark failed and recover.`,
				source: "system",
				source_ref: `stale:${e.id}`,
				priority: "critical",
				risk_level: "low",
				required_capability: "self_healing",
				input: { execution_id: e.id, agent_id: e.agent_id },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] stale discovery failed:", err.message);
	}

	// 4. Flagged/pending posts → content moderation tasks
	try {
		const { data: flagged } = await supabase
			.from("posts")
			.select("id, title, status, created_at")
			.eq("deleted", false)
			.or("status.eq.flagged,status.eq.pending")
			.limit(30);
		for (const p of (flagged || []).slice(0, 10)) {
			await push({
				title: `Review flagged post: ${clean(String(p.title || "untitled"), 80)}`,
				description:
					"Post awaits moderation review. Classify content, decide keep/hide, and verify the decision.",
				source: "moderation",
				source_ref: `moderation:${p.id}`,
				priority: "medium",
				risk_level: "low",
				required_capability: "content_moderation",
				input: { post_id: p.id, status: p.status },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] moderation discovery failed:", err.message);
	}

	// 5. Security patrol — users with repeated warnings/strikes → security-monitor.
	//    Real signal from users_meta; routed via a capability ONLY the security
	//    monitor carries (vulnerability_scanning) so it never lands on the
	//    report-handler.
	try {
		const { data: users } = await supabase
			.from("users_meta")
			.select("anon_id, warnings, strikes, banned")
			.limit(500);
		const atRisk = (users || [])
			.filter(
				(u) =>
					u &&
					((Array.isArray(u.warnings) && u.warnings.length >= 3) ||
						(u.strikes || 0) >= 1 ||
						!!u.banned),
			)
			.slice(0, 10);
		for (const u of atRisk) {
			await push({
				title: `Security review: user ${String(u.anon_id).slice(0, 10)}…`,
				description: `User has ${u.strikes || 0} strike(s), ${Array.isArray(u.warnings) ? u.warnings.length : 0} warning(s), banned=${!!u.banned}. Verify enforcement is complete and correct, and act if needed.`,
				source: "security",
				source_ref: `security:${u.anon_id}`,
				priority: "high",
				risk_level: "medium",
				required_capability: "vulnerability_scanning",
				input: { anon_id: u.anon_id },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] security discovery failed:", err.message);
	}

	// 6. Duplicate detection patrol — identical titles within 7 days →
	//    duplicate-detector (capability duplicate_clustering). Real merge work.
	try {
		const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
		const { data: posts } = await supabase
			.from("posts")
			.select("id, title")
			.eq("deleted", false)
			.gte("created_at", weekAgo)
			.limit(200);
		const byTitle = {};
		for (const p of posts || []) {
			const t = String(p.title || "")
				.toLowerCase()
				.replace(/\s+/g, " ")
				.trim();
			if (t.length < 12) continue; // ignore noise titles
			(byTitle[t] = byTitle[t] || []).push(p.id);
		}
		for (const [t, ids] of Object.entries(byTitle)) {
			if (ids.length < 2) continue;
			await push({
				title: `Duplicate cluster: "${String(t).slice(0, 48)}…"`,
				description: `${ids.length} posts share the same title. Compare content, merge support where appropriate, and record the decision.`,
				source: "duplicate",
				source_ref: `dup:${t}`,
				priority: "medium",
				risk_level: "low",
				required_capability: "duplicate_clustering",
				input: { post_ids: ids, title: t },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] duplicate discovery failed:", err.message);
	}

	// 7. Stale moderation — pending/flagged posts untouched for 48h →
	//    escalation-engine (escalation_detection). Real backlog signal.
	try {
		const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString();
		const { data: stale } = await supabase
			.from("posts")
			.select("id, title")
			.eq("deleted", false)
			.lt("created_at", twoDaysAgo)
			.or("status.eq.pending,status.eq.flagged")
			.limit(20);
		for (const p of (stale || []).slice(0, 10)) {
			await push({
				title: `Escalate stale review: ${clean(String(p.title || "untitled"), 60)}`,
				description: `Post ${p.id} has awaited moderation for over 48 hours. Escalate for priority review and resolution.`,
				source: "escalation",
				source_ref: `stale-moderate:${p.id}`,
				priority: "high",
				risk_level: "low",
				required_capability: "escalation_detection",
				input: { post_id: p.id },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] escalation discovery failed:", err.message);
	}

	// 8. Expired polls — ended but still open → poll agent archives them.
	try {
		const { data: polls } = await supabase
			.from("polls")
			.select("id, title, expires_at, archived, deleted")
			.limit(50);
		const expired = (polls || [])
			.filter(
				(p) =>
					!p.deleted &&
					!p.archived &&
					p.expires_at &&
					new Date(p.expires_at).getTime() < Date.now(),
			)
			.slice(0, 10);
		for (const p of expired) {
			await push({
				title: `Archive expired poll: ${clean(String(p.title || "untitled"), 60)}`,
				description: `Poll ${p.id} ended ${new Date(p.expires_at).toISOString()}. Archive it and record the final results.`,
				source: "poll",
				source_ref: `poll-expired:${p.id}`,
				priority: "low",
				risk_level: "low",
				required_capability: "poll_design",
				input: { poll_id: p.id, expires_at: p.expires_at },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] poll discovery failed:", err.message);
	}

	// 9. Inactive-user sweep — users with no content and no recent activity
	//    are pure DB bloat. REAL signal from users_meta + posts + comments;
	//    routed to cleanup-steward (storage_optimization) so a real worker
	//    audits them. Never auto-deletes a user — the worker verifies and the
	//    admin sees the outcome in the Ops Center.
	try {
		const inactiveCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
		const { data: users } = await supabase
			.from("users_meta")
			.select("anon_id, last_seen, created_at, banned, warnings, strikes")
			.limit(1000);
		const { data: content } = await supabase
			.from("posts")
			.select("author_id")
			.eq("deleted", false)
			.limit(2000);
		const activeAuthors = new Set((content || []).map((p) => p.author_id).filter(Boolean));
		const inactive = (users || [])
			.filter((u) => {
				if (!u || activeAuthors.has(u.anon_id)) return false;
				// Has a record of discipline — NOT inert bloat, keep for review
				if (u.banned || (Array.isArray(u.warnings) && u.warnings.length) || (u.strikes || 0) > 0)
					return false;
				const last = u.last_seen || u.created_at;
				return last && new Date(last).getTime() < Date.now() - 90 * 24 * 60 * 60 * 1000;
			})
			.slice(0, 15);
		for (const u of inactive) {
			await push({
				title: `Audit inactive user ${String(u.anon_id).slice(0, 10)}…`,
				description: `User has no posts and no activity for 90+ days. Verify they are genuinely dormant, then archive or flag them to reclaim database storage.`,
				source: "hygiene",
				source_ref: `inactive:${u.anon_id}`,
				priority: "low",
				risk_level: "low",
				required_capability: "storage_optimization",
				input: { anon_id: u.anon_id, last_seen: u.last_seen || u.created_at },
				created_by: "discovery",
			});
		}
	} catch (err) {
		console.warn("[workforce] inactive-user discovery failed:", err.message);
	}

	return created;
}

// ─── Stale running executions (heartbeat recovery source) ─────────
// LIVENESS IS NOT AGE. An execution that has been running for an hour is not
// stuck if it is still heartbeating; the old query filtered on `started_at`
// alone, so every long-running-but-alive execution was reported stale (and
// marked failed while still running). Liveness is the freshest heartbeat,
// falling back to started_at ONLY when a row has no heartbeat at all (old
// schema / pre-heartbeat row). A row with no usable timestamp is never
// declared stale — we cannot prove it is dead.
function effectiveLivenessMs(row) {
	const ts = row?.heartbeat_at || row?.started_at;
	const ms = ts ? new Date(ts).getTime() : 0;
	return Number.isFinite(ms) ? ms : 0;
}

async function findStaleRunningExecutions() {
	// agent_executions is its OWN table — independent of the agent_tasks
	// probe. Any error (missing table/column) is a truthful 'nothing to
	// recover'.
	const cutoff = Date.now() - STALE_WORKING_MS;
	let rows = null;
	try {
		const { data, error } = await supabase
			.from("agent_executions")
			.select("id, agent_id, agent_name, started_at, heartbeat_at")
			.eq("status", "running")
			.order("started_at", { ascending: true })
			.limit(50);
		if (error) throw new Error(error.message);
		rows = data || [];
	} catch {
		// Schema without heartbeat_at → retry without it so recovery still
		// works on un-migrated DBs (started_at is then the only signal).
		try {
			const { data } = await supabase
				.from("agent_executions")
				.select("id, agent_id, agent_name, started_at")
				.eq("status", "running")
				.order("started_at", { ascending: true })
				.limit(50);
			rows = data || [];
		} catch {
			return [];
		}
	}
	return rows
		.filter((e) => {
			const live = effectiveLivenessMs(e);
			return live > 0 && live < cutoff;
		})
		.slice(0, 20);
}

// Independent verification of an execution transition: the UPDATE's own
// success report is not proof — only a re-read that shows the persisted
// status is. A read error returns false (never claim a recovery we can't see).
async function verifyExecutionFailed(executionId) {
	try {
		const { data, error } = await supabase
			.from("agent_executions")
			.select("status")
			.eq("id", executionId)
			.maybeSingle();
		if (error) return false;
		return data?.status === "failed";
	} catch {
		return false;
	}
}

// Independent read-back of a task from the live store (table-first, settings
// fallback — same path the workers use). Used to VERIFY a recovery actually
// persisted instead of trusting updateTask()'s return value, which in the
// settings store returns the patched object even when saveTasks() swallowed a
// write failure.
async function readTaskById(id) {
	const all = await listTasks({ limit: 1000 });
	return all.find((t) => t.id === id) || null;
}

// ─── Heartbeat recovery — never leave WORKING forever ─────────────
// Requeues/fails genuinely stuck work AND independently verifies each
// transition persisted, returning how many were verified vs unverified (an
// unverified recovery is never counted as a success).
async function recoverStale() {
	const recovered = {
		executions: 0,
		tasks: 0,
		executions_unverified: 0,
		tasks_unverified: 0,
		evidence: [],
	};
	const note = (entry) => {
		if (recovered.evidence.length < 10) recovered.evidence.push(entry);
	};

	try {
		const staleExecs = await findStaleRunningExecutions();
		for (const e of staleExecs) {
			const { error } = await supabase
				.from("agent_executions")
				.update({
					status: "failed",
					error: "Stale execution — heartbeat expired",
					completed_at: new Date().toISOString(),
				})
				.eq("id", e.id);
			// INDEPENDENT VERIFICATION — read the row back. Only a persisted
			// 'failed' counts; a write error or a still-'running' row does not.
			if (error || !(await verifyExecutionFailed(e.id))) {
				recovered.executions_unverified++;
				continue;
			}
			await logActivity(
				e.agent_id,
				"execution_recovered",
				{ execution_id: e.id, reason: "heartbeat expired", verified: true },
				"warning",
			);
			recovered.executions++;
			note({
				kind: "execution",
				id: e.id,
				agent_id: e.agent_id,
				last_liveness_at: e.heartbeat_at || e.started_at,
				verified_status: "failed",
			});
		}
	} catch (err) {
		console.warn("[workforce] execution recovery failed:", err.message);
	}

	// Tasks stuck in working/claimed with no heartbeat → requeue (bounded)
	const open = (await listTasks({ limit: 500 })).filter((t) =>
		["working", "claimed"].includes(t.status),
	);
	for (const t of open) {
		const hb = effectiveLivenessMs(t);
		if (!hb || Date.now() - hb <= STALE_WORKING_MS) continue;
		const maxed = (t.attempts || 0) >= (t.max_attempts || 3);
		await updateTask(
			t.id,
			maxed
				? {
						status: "failed",
						error: "Stale — max attempts reached",
						completed_at: new Date().toISOString(),
						verification_status: "failed",
					}
				: {
						status: "queued",
						assigned_agent: null,
						attempts: (t.attempts || 0) + 1,
						heartbeat_at: null,
					},
		);
		// INDEPENDENT VERIFICATION — re-read from the live store. This is the
		// answer to "did the requeue actually persist?", not updateTask()'s
		// self-report.
		const after = await readTaskById(t.id);
		const ok =
			after &&
			(maxed
				? after.status === "failed"
				: after.status === "queued" && !after.assigned_agent);
		if (!ok) {
			recovered.tasks_unverified++;
			continue;
		}
		recovered.tasks++;
		note({
			kind: "task",
			id: t.id,
			action: maxed ? "failed_max_attempts" : "requeued",
			attempts: after.attempts,
			verified_status: after.status,
		});
	}
	return recovered;
}

// ─── Orchestrator: assign queued tasks to capable workers ─────────
async function findCapableAgent(task) {
	// Kill switch §24: paused agents and paused divisions never receive work;
	// a disabled tool holds its tasks (they stay queued until re-enabled).
	const cfg = await getConfig();
	const pausedAgents = new Set(cfg.paused_agents || []);
	const pausedDivisions = new Set(cfg.paused_divisions || []);
	const disabledTools = new Set(cfg.disabled_tools || []);
	const cap = task.required_capability;
	if (cap && disabledTools.has(cap)) return null; // tool disabled → task held
	// Capability match first, then division heuristic, then any available worker.
	const candidates = ALL_AGENTS.filter(
		(a) =>
			a.status !== "inactive" &&
			!pausedAgents.has(a.id) &&
			!pausedDivisions.has(a.division) &&
			Array.isArray(a.capabilities) &&
			a.capabilities.length > 0,
	);
	if (cap) {
		const exact = candidates.find((a) => a.capabilities.includes(cap));
		if (exact) return exact;
		const partial = candidates.find((a) =>
			a.capabilities.some((c) => cap.includes(c) || c.includes(cap)),
		);
		if (partial) return partial;
	}
	// Division heuristic: route by source so we never dump everything on one agent
	const divisionHint = {
		report: "moderation",
		moderation: "moderation",
		error: "infrastructure",
		system: "infrastructure",
		manual: "specialist",
		admin: "specialist",
		security: "system",
		duplicate: "content",
		escalation: "specialist",
		poll: "content",
	}[task.source];
	const byDivision = divisionHint
		? candidates.filter(
				(a) =>
					String(a.division).includes(divisionHint) ||
					divisionHint.includes(String(a.division)),
			)
		: [];
	if (byDivision.length > 0) return byDivision[0];
	// Final fallback: lowest workload among all capable agents, else first active
	return (
		candidates.slice().sort((a, b) => (a.load || 0) - (b.load || 0))[0] ||
		candidates[0] ||
		ALL_AGENTS[0] ||
		null
	);
}

async function assignQueued(limit = 6) {
	const queued = (await listTasks({ status: "queued", limit: 50 }))
		.sort(
			(a, b) =>
				(PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0),
		)
		.slice(0, limit);
	const assigned = [];
	for (const task of queued) {
		const agent = await findCapableAgent(task);
		if (!agent) continue;
		// ATOMIC CLAIM — only claim if still queued (guards against two
		// concurrent patrols double-executing the same task).
		const claimed = await claimTask(task.id, agent.id);
		if (!claimed) continue;
		emitEvent("task.assigned", {
			task_id: task.id,
			agent_id: agent.id,
			title: task.title,
		}).catch(() => {});
		assigned.push({ task: { ...task, assigned_agent: agent.id }, agent });
	}
	return assigned;
}

// Atomic claim: conditional update only when status is still 'queued'.
// Returns the updated row, or null if another worker already claimed it.
async function claimTask(id, agentId) {
	const useTable = await hasTasksTable();
	if (useTable) {
		const { data, error } = await supabase
			.from("agent_tasks")
			.update({
				status: "claimed",
				assigned_agent: agentId,
				claimed_at: new Date().toISOString(),
				heartbeat_at: new Date().toISOString(),
			})
			.eq("id", id)
			.eq("status", "queued")
			.select()
			.maybeSingle();
		if (error || !data) return null;
		return data;
	}
	// Settings fallback: read-modify-write with status guard
	const all = await listTasks({ limit: 1000 });
	const idx = all.findIndex((t) => t.id === id && t.status === "queued");
	if (idx === -1) return null;
	all[idx] = {
		...all[idx],
		status: "claimed",
		assigned_agent: agentId,
		claimed_at: new Date().toISOString(),
		heartbeat_at: new Date().toISOString(),
	};
	await saveTasks(all);
	return all[idx];
}

const PRIORITY_WEIGHT = { critical: 100, high: 60, medium: 30, low: 10 };

// ─── REAL OUTCOME VERIFICATION ───────────────────────────────────
// Every action an employee claims it performed is re-checked against
// the live DB before it becomes a verified outcome on the task. A task
// whose claims fail verification gets verification_status 'failed' —
// an unverifiable change is never counted as a completed outcome.
const OUTCOME_VERIFIERS = {
	hide_post: async (a) => {
		const { data } = await supabase
			.from("posts")
			.select("hidden")
			.eq("id", a.target_id)
			.maybeSingle();
		return {
			ok: !!data?.hidden,
			evidence: data?.hidden
				? `posts.hidden=true (${a.target_id})`
				: `posts.hidden≠true (${a.target_id})`,
		};
	},
	set_priority: async (a) => {
		const { data } = await supabase
			.from("posts")
			.select("priority")
			.eq("id", a.target_id)
			.maybeSingle();
		return {
			ok: data?.priority === a.priority,
			evidence: `posts.priority=${data?.priority} expected=${a.priority}`,
		};
	},
	resolve_reports: async (a) => {
		const ids = a.report_ids || [];
		if (!ids.length) return { ok: false, evidence: "no report_ids recorded" };
		const { data } = await supabase
			.from("reports")
			.select("id,status")
			.in("id", ids)
			.limit(ids.length);
		const done = (data || []).filter(
			(r) => r.status === (a.status || "auto_resolved"),
		).length;
		return {
			ok: done === ids.length,
			evidence: `${done}/${ids.length} reports → ${a.status || "auto_resolved"}`,
		};
	},
	flag_target: async (a) => {
		const { data } = await supabase
			.from("reports")
			.select("id")
			.eq("target_id", a.target_id)
			.eq("target_type", a.target_type || "post")
			.eq("reason", a.reason)
			.eq("status", "pending")
			.limit(1)
			.maybeSingle();
		return {
			ok: !!data,
			evidence: data
				? `pending report exists (${a.target_id})`
				: `no pending report (${a.target_id})`,
		};
	},
	pin_post: async (a) => {
		const { data } = await supabase
			.from("posts")
			.select("pinned")
			.eq("id", a.target_id)
			.maybeSingle();
		return { ok: !!data?.pinned, evidence: `posts.pinned=${!!data?.pinned}` };
	},
	feature_post: async (a) => {
		const { data } = await supabase
			.from("posts")
			.select("featured")
			.eq("id", a.target_id)
			.maybeSingle();
		return {
			ok: !!data?.featured,
			evidence: `posts.featured=${!!data?.featured}`,
		};
	},
	comment_reply: async (a) => {
		const { data } = await supabase
			.from("comments")
			.select("id")
			.eq("post_id", a.target_id)
			.eq("is_admin", true)
			.limit(1)
			.maybeSingle();
		return {
			ok: !!data,
			evidence: data
				? `admin comment exists (${a.target_id})`
				: `no admin comment (${a.target_id})`,
		};
	},
};

async function verifyOutcomes(actions) {
	const outcomes = [];
	for (const a of actions || []) {
		if (!a?.ok || a.skipped) continue; // only real, non-skipped actions
		const verifier = OUTCOME_VERIFIERS[a.type];
		let res = { ok: false, evidence: `no verifier for ${a.type}` };
		if (verifier) {
			try {
				res = await verifier(a);
			} catch (e) {
				res = { ok: false, evidence: `verify error: ${e.message}` };
			}
		}
		outcomes.push({
			type: a.type,
			target_id: a.target_id || null,
			count: a.count || null,
			status: a.status || null,
			verified: res.ok,
			evidence: res.evidence,
			at: a.at || new Date().toISOString(),
		});
	}
	return outcomes;
}

// ─── APPROVED DECISION EXECUTION ────────────────────────────────
// A blocked (awaiting-approval) task was approved → the admin endorsed a
// SPECIFIC action encoded in task.input. After the agent's investigation
// runs, the workforce applies that sanctioned decision directly — never
// invented, never left to chance. The mutations are then verified against
// the DB like any other outcome (hide_post / resolve_reports verifiers).
async function applyApprovedDecision(task) {
	const inp = task.input || {};
	if (!["high", "critical"].includes(String(task.risk_level))) return [];
	if (inp.decision !== "hide") return []; // decision-only tasks are honestly analysis
	const actions = [];
	const at = new Date().toISOString();
	// Approved moderation decision: hide the reported target (posts only)
	if (inp.target_id && inp.target_type === "post") {
		try {
			const { data: post } = await supabase
				.from("posts")
				.select("hidden,deleted")
				.eq("id", inp.target_id)
				.maybeSingle();
			if (post && !post.hidden && !post.deleted) {
				const { error } = await supabase
					.from("posts")
					.update({ hidden: true })
					.eq("id", inp.target_id);
				if (!error)
					actions.push({
						type: "hide_post",
						target_id: inp.target_id,
						count: null,
						status: null,
						ok: true,
						at,
					});
				else console.warn("[workforce] approved hide failed:", error.message);
			}
		} catch (err) {
			console.warn("[workforce] approved hide error:", err.message);
		}
	}
	// Resolve the linked reports (only when the decision was to act)
	if (Array.isArray(inp.report_ids) && inp.report_ids.length) {
		try {
			const { data: reports } = await supabase
				.from("reports")
				.select("id,status")
				.in("id", inp.report_ids);
			const open = (reports || [])
				.filter((r) => !r.status || r.status === "pending")
				.map((r) => r.id);
			if (open.length) {
				const { error } = await supabase
					.from("reports")
					.update({ status: "resolved" })
					.in("id", open);
				if (!error)
					actions.push({
						type: "resolve_reports",
						target_id: null,
						count: open.length,
						status: "resolved",
						report_ids: open,
						ok: true,
						at,
					});
			}
		} catch (err) {
			console.warn("[workforce] approved resolve error:", err.message);
		}
	}
	return actions;
}

// ─── REAL HANDOFFS — one employee spawns dependent work for another ─
// A completed task that changed the product can create a child task for
// a different capability. Dedupe by source_ref: each post gets at most
// one escalation / one report-closure child, so chains can never loop.
async function maybeHandoff(task, outcomes) {
	// Kill switch §24: delegation can be disabled — completed work then never
	// spawns child tasks for other employees (single-agent mode).
	const cfg = await getConfig();
	if (cfg.allow_handoffs === false) return [];
	const created = [];
	// Escalation: report-handler set priority=high on hot posts → escalation-engine second opinion
	const escalated = (outcomes || []).filter(
		(o) => o.type === "set_priority" && o.verified,
	);
	for (const o of escalated.slice(0, 3)) {
		const child = await createTask({
			title: `Escalation review: post ${String(o.target_id).slice(0, 12)}`,
			description: `Triage escalated post ${o.target_id} to high priority. Investigate root cause, assess impact, and verify the correct handler.`,
			source: "escalation",
			source_ref: `escalate:${o.target_id}`,
			priority: "high",
			risk_level: "low",
			required_capability: "escalation_detection",
			input: { post_id: o.target_id, parent_task_id: task.id },
			created_by: task.assigned_agent || "system",
			parent_task_id: task.id,
			dedupe: "all",
		});
		if (child) {
			created.push(child.id);
			emitEvent("task.handoff", {
				parent: task.id,
				child: child.id,
				title: child.title,
			}).catch(() => {});
		}
	}
	// Hidden content: moderation hid spam → report-handler closes every open report on that post
	const hidden = (outcomes || []).filter(
		(o) => o.type === "hide_post" && o.verified,
	);
	for (const o of hidden.slice(0, 3)) {
		const child = await createTask({
			title: `Close reports on hidden post ${String(o.target_id).slice(0, 12)}`,
			description: `Post ${o.target_id} was hidden by moderation. Ensure every open report against it is resolved and the decision is recorded.`,
			source: "moderation",
			source_ref: `close-reports:${o.target_id}`,
			priority: "medium",
			risk_level: "low",
			required_capability: "report_triage",
			input: { post_id: o.target_id, parent_task_id: task.id },
			created_by: task.assigned_agent || "system",
			parent_task_id: task.id,
			dedupe: "all",
		});
		if (child) {
			created.push(child.id);
			emitEvent("task.handoff", {
				parent: task.id,
				child: child.id,
				title: child.title,
			}).catch(() => {});
		}
	}
	return created;
}

// ─── Shared outcome → impact-bucket mapping (used by measureImpact
// and impactCenter so the ledger is consistent in both places).
function outcomeImpactKey(o) {
	if (o.type === "hide_post") return "posts_hidden";
	if (o.type === "restore_post") return "posts_restored";
	if (o.type === "set_priority") return "posts_escalated";
	if (o.type === "pin_post") return "posts_pinned";
	if (o.type === "feature_post") return "posts_featured";
	if (o.type === "resolve_reports") return "reports_resolved";
	if (o.type === "flag_target") return "flags_created";
	if (o.type === "comment_reply") return "content_changed";
	return null;
}

// ─── Shared verification predicate ───────────────────────────────────
// Only statuses that mean verification ACTUALLY RAN count as "reached
// verification". Blocked tasks ('awaiting_approval') and admin-rejected
// tasks ('rejected') never executed a verifier — counting them would
// falsely deflate the rate. Used by impactCenter, per-employee rates,
// and the overview headline so the whole dashboard can never disagree.
function reachedVerification(status) {
	return status === "passed" || status === "failed" || status === "partial";
}

// ─── REAL IMPACT MEASUREMENT (Phase 15 of the production spec) ─────
// Impact is derived EXCLUSIVELY from DB-verified outcomes. Nothing is
// invented: if the task changed nothing verifiable, impact is truthfully
// NOT MEASURABLE.
function measureImpact(outcomes) {
	const v = (outcomes || []).filter((o) => o.verified);
	if (!v.length)
		return {
			measurable: false,
			summary: "",
			note: "NOT MEASURABLE — no verified change",
		};
	const stats = {
		reports_resolved: 0,
		posts_hidden: 0,
		posts_escalated: 0,
		flags_created: 0,
		content_changed: 0,
	};
	for (const o of v) {
		const key = outcomeImpactKey(o);
		if (key === "reports_resolved")
			stats.reports_resolved += (o.count ?? 0) > 0 ? o.count : 1;
		else if (key === "posts_hidden") stats.posts_hidden += 1;
		else if (key === "posts_escalated") stats.posts_escalated += 1;
		else if (key === "flags_created") stats.flags_created += 1;
		else if (key === "content_changed") stats.content_changed += 1;
	}
	const parts = [];
	if (stats.reports_resolved)
		parts.push(`${stats.reports_resolved} report(s) resolved`);
	if (stats.posts_hidden) parts.push(`${stats.posts_hidden} post(s) hidden`);
	if (stats.posts_escalated)
		parts.push(`${stats.posts_escalated} post(s) escalated`);
	if (stats.flags_created) parts.push(`${stats.flags_created} flag(s) created`);
	if (stats.content_changed)
		parts.push(`${stats.content_changed} content change(s)`);
	return {
		measurable: true,
		summary: parts.join(", "),
		stats,
		verified_actions: v.length,
	};
}

// ─── REAL IMPACT CENTER (Phase 19 of the production spec) ──────
// Aggregate verified outcomes across ALL tasks into real platform
// impact. Only DB-verified outcomes count — nothing invented. Each
// metric carries a list of evidence rows (which task, what changed,
// verification evidence) so the admin can click through to the proof.
async function impactCenter() {
	const tasks = await listTasks({ limit: 500 });
	const totals = {
		posts_hidden: 0,
		posts_restored: 0,
		posts_escalated: 0,
		posts_pinned: 0,
		posts_featured: 0,
		reports_resolved: 0,
		flags_created: 0,
		content_changed: 0,
		verified_actions: 0,
		failed_verifications: 0,
	};
	const evidence = [];
	let tasksReachedVerification = 0;
	let tasksVerified = 0;
	for (const t of tasks) {
		const outcomes = Array.isArray(t.outcomes) ? t.outcomes : [];
		const verified = outcomes.filter((o) => o.verified);
		for (const o of verified) {
			const key = outcomeImpactKey(o);
			if (!key) continue;
			totals[key] +=
				key === "reports_resolved" ? ((o.count ?? 0) > 0 ? o.count : 1) : 1;
			totals.verified_actions += 1;
			evidence.push({
				task_id: t.id,
				title: t.title || t.task || "Untitled",
				type: o.type,
				target_id: o.target_id,
				count: o.count,
				evidence: o.evidence,
				at: o.at || t.completed_at || t.created_at,
			});
		}
		if (t.verification_status === "failed") totals.failed_verifications += 1;
		if (reachedVerification(t.verification_status)) {
			tasksReachedVerification += 1;
			if (t.verification_status === "passed") tasksVerified += 1;
		}
	}
	// Real completed/failed execution counts from the executions table
	let executions = { completed: 0, failed: 0, total: 0 };
	try {
		const { data } = await supabase
			.from("agent_executions")
			.select("status")
			.limit(5000);
		const list = data || [];
		executions = {
			total: list.length,
			completed: list.filter((e) => e.status === "completed").length,
			failed: list.filter((e) => e.status === "failed").length,
		};
	} catch {
		/* truthful zeros */
	}
	evidence.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	// Verification rate = verified tasks / tasks that reached verification
	// (the spec's definition — never a raw ratio that can exceed 100%).
	const verification_rate =
		tasksReachedVerification > 0
			? Math.min(
					100,
					Math.round((tasksVerified / tasksReachedVerification) * 100),
				)
			: null;
	return {
		ok: true,
		impact: totals,
		verification_rate,
		tasks_reached_verification: tasksReachedVerification,
		tasks_verified: tasksVerified,
		executions,
		evidence: evidence.slice(0, 100),
		generated_at: new Date().toISOString(),
	};
}

// ─── APPROVAL LEDGER — every human decision on high-risk work, persisted
// so the admin always has a reviewable audit trail (who, when, what, why).
// Stored in settings (same durability as the settings-store fallback) so it
// survives refreshes; each entry is appended, capped to keep it bounded.
const APPROVAL_HISTORY_KEY = "workforce_approval_history";

async function appendApprovalDecision(decision) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", APPROVAL_HISTORY_KEY)
			.maybeSingle();
		let history = Array.isArray(data?.value?.entries) ? data.value.entries : [];
		history.unshift({
			task_id: decision.task_id,
			title: decision.title || "Untitled task",
			decision: decision.decision, // 'approved' | 'rejected'
			reason: decision.reason || null,
			risk_level: decision.risk_level || "unknown",
			source: decision.source || "admin",
			created_by: decision.created_by || "admin",
			at: new Date().toISOString(),
		});
		// Bound the settings-row ledger (same pattern as other settings stores).
		history = history.slice(0, 200);
		await supabase
			.from("settings")
			.upsert(
				{
					key: APPROVAL_HISTORY_KEY,
					value: { entries: history.slice(0, 100) },
				},
				{ onConflict: "key" },
			);
	} catch (err) {
		console.warn("[workforce] approval ledger append failed:", err.message);
	}
}

async function approvalHistory() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", APPROVAL_HISTORY_KEY)
			.maybeSingle();
		return {
			ok: true,
			history: Array.isArray(data?.value?.entries) ? data.value.entries : [],
		};
	} catch {
		return { ok: true, history: [] };
	}
}

// ─── ADMIN ALERT SYSTEM (spec §7 / §19 / §20) ──────────────────────
// A centralized real-time notification layer with severity and grouping.
// Repeated identical issues are NOT duplicated: the same key increments
// `occurrences`, refreshes `last_at`, and ESCALATES severity after repeated
// occurrence (first detection HIGH → repeated → CRITICAL). Critical alerts
// remain visible until the administrator acknowledges them. Persisted in a
// settings row (same durability as the task store fallback).
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;
const ALERT_SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];
const ALERT_ESCALATE_AFTER = 2; // occurrences before severity bumps one step

async function readAlerts() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", ALERT_KEY)
			.maybeSingle();
		return Array.isArray(data?.value?.alerts) ? data.value.alerts : [];
	} catch {
		return [];
	}
}

async function writeAlerts(alerts) {
	try {
		await supabase
			.from("settings")
			.upsert(
				{
					key: ALERT_KEY,
					value: {
						alerts: alerts.slice(0, ALERT_MAX),
						updated_at: new Date().toISOString(),
					},
				},
				{ onConflict: "key" },
			);
	} catch (err) {
		console.warn("[workforce] alerts write failed:", err.message);
	}
}

/** Raise (or escalate) an admin alert from a REAL runtime signal. Grouping:
 *  an UNRESOLVED alert with the same key is never duplicated — the
 *  occurrence count grows and severity escalates (spec §19: 40 failed logins
 *  become ONE incident, not 40 alerts). An alert that was merely
 *  ACKNOWLEDGED (seen) but is still open keeps grouping; once RESOLVED
 *  (issue actually fixed), a fresh signal raises a fresh alert. */
async function raiseAlert({
	severity = "medium",
	title,
	body = null,
	agent = null,
	key = null,
	evidence = null,
}) {
	const titleClean = clean(String(title || ""), 160);
	if (!titleClean) return null;
	const alerts = await readAlerts();
	const now = new Date().toISOString();
	const existing = key
		? alerts.find((a) => a.key === key && !a.resolved_at)
		: null;
	if (existing) {
		const occ = (existing.occurrences || 1) + 1;
		const idx = ALERT_SEVERITY_ORDER.indexOf(existing.severity);
		// Escalate at most one step above the ORIGINAL severity (base_severity).
		const baseIdx = ALERT_SEVERITY_ORDER.indexOf(
			existing.base_severity || existing.severity,
		);
		const maxIdx = Math.min(
			ALERT_SEVERITY_ORDER.length - 1,
			(baseIdx >= 0 ? baseIdx : 0) + 1,
		);
		if (occ >= ALERT_ESCALATE_AFTER && idx >= 0 && idx < maxIdx) {
			existing.severity = ALERT_SEVERITY_ORDER[idx + 1];
		}
		existing.occurrences = occ;
		existing.last_at = now;
		existing.agent = agent || existing.agent;
		if (evidence) existing.evidence = clean(String(evidence), 500);
		await writeAlerts(alerts);
		return existing;
	}
	const normalized = ALERT_SEVERITY_ORDER.includes(severity)
		? severity
		: "medium";
	const alert = {
		id: crypto.randomUUID(),
		key: key || null,
		severity: normalized,
		// Escalation never exceeds ONE step above the originally-raised severity,
		// so a transient medium issue cannot balloon to CRITICAL on its own.
		base_severity: normalized,
		title: titleClean,
		body: clean(String(body || ""), 600) || null,
		agent: agent || null,
		evidence: clean(String(evidence || ""), 500) || null,
		occurrences: 1,
		acknowledged_at: null,
		acknowledged_by: null,
		resolved_at: null,
		resolved_by: null,
		created_at: now,
		last_at: now,
	};
	alerts.unshift(alert);
	await writeAlerts(alerts);
	return alert;
}

async function listAlerts() {
	// Clear orphaned approval alerts (no matching blocked task) so the Ops
	// Center never shows an Approval decision that no longer exists.
	await reconcileApprovalAlerts().catch(() => {});
	const alerts = await readAlerts();
	const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
	// Three distinct lifecycle states:
	//   OPEN          — never seen, never fixed → needs administrator action
	//   ACKNOWLEDGED  — seen by an admin, but the issue is STILL open
	//   RESOLVED      — the underlying issue was actually fixed (resolved_at)
	const open = alerts.filter((a) => !a.resolved_at && !a.acknowledged_at);
	const acknowledged = alerts.filter(
		(a) => !a.resolved_at && a.acknowledged_at,
	);
	const resolved = alerts.filter((a) => a.resolved_at);
	open.sort(
		(a, b) =>
			(order[a.severity] ?? 4) - (order[b.severity] ?? 4) ||
			(b.last_at || "").localeCompare(a.last_at || ""),
	);
	acknowledged.sort((a, b) =>
		(b.acknowledged_at || "").localeCompare(a.acknowledged_at || ""),
	);
	resolved.sort((a, b) =>
		(b.resolved_at || "").localeCompare(a.resolved_at || ""),
	);
	// "critical_open" = critical alerts whose issue is still LIVE (open OR
	// acknowledged-but-unresolved) — consistent with the report's alerts_open.
	const unresolved = [...open, ...acknowledged];
	return {
		ok: true,
		alerts: [...open, ...acknowledged, ...resolved].slice(0, ALERT_MAX),
		open: open.length,
		acknowledged_open: acknowledged.length,
		resolved: resolved.length,
		critical_open: unresolved.filter((a) => a.severity === "critical").length,
	};
}

async function acknowledgeAlert(id, by = "admin") {
	const alerts = await readAlerts();
	const a = alerts.find((x) => x.id === id);
	if (!a) return { ok: false, error: "Alert not found" };
	// A resolved alert is done — acknowledging it would muddy the lifecycle.
	if (a.resolved_at) return { ok: true, alert: a, note: "already resolved" };
	a.acknowledged_at = new Date().toISOString();
	a.acknowledged_by = clean(String(by), 40);
	await writeAlerts(alerts);
	await auditLog(
		"admin",
		"workforce_alert_acknowledged",
		`Acknowledged alert ${id}`,
	).catch(() => {});
	return { ok: true, alert: a };
}

/** Auto-resolve an open alert when its underlying issue is handled (the
 *  approval decision was made, or a retry verified successfully). Only
 *  writes when an unresolved alert actually matched — no cost otherwise.
 *
 *  RESOLVED is deliberately distinct from ACKNOWLEDGED: resolution records
 *  that the issue was actually fixed (resolved_at + resolved_by), and never
 *  implies the admin looked at it. Acknowledgment (seen) stays a separate,
 *  optional step that the admin performs in the UI. */
async function resolveAlertKey(key) {
	if (!key) return null;
	const alerts = await readAlerts();
	const a = alerts.find((x) => x.key === key && !x.resolved_at);
	if (!a) return null;
	const now = new Date().toISOString();
	a.resolved_at = now;
	a.resolved_by = "system";
	await writeAlerts(alerts);
	return a;
}

/** Reconcile orphaned approval alerts. An `approval:` alert exists to signal
 *  that a blocked (awaiting-approval) task needs a human decision. If that
 *  task is gone (evicted from a legacy store, cancelled externally, or its
 *  dedupe prevented re-creation), the alert has NOTHING to approve — keeping
 *  it open means the admin clicks Approve and gets "Task not found" (the
 *  exact "approval buttons do nothing" failure). This resolves any open
 *  approval alert whose matching blocked task no longer exists, so the
 *  Approval Center always reflects a REAL pending decision. */
async function reconcileApprovalAlerts() {
	try {
		// Fetch ALL tasks, not just blocked: an alert whose decision task still
		// exists in ANY state (blocked / working / completed) is legitimate —
		// e.g. a fresh recurrence after a prior approval must stay visible.
		// Only a task that is COMPLETELY gone (evicted / externally cleared)
		// orphans its approval alert and makes Approve return "Task not found".
		const tasks = await listTasks({ limit: 500 });
		const liveKeys = new Set(
			tasks.map((t) => `approval:${t.source_ref || t.title || t.task || ""}`),
		);
		const alerts = await readAlerts();
		const orphans = alerts.filter(
			(a) =>
				a.key &&
				a.key.startsWith("approval:") &&
				!a.resolved_at &&
				!liveKeys.has(a.key),
		);
		if (orphans.length === 0) return 0;
		const now = new Date().toISOString();
		const keys = new Set(orphans.map((a) => a.key));
		for (const a of alerts) {
			if (a.key && keys.has(a.key) && !a.resolved_at) {
				a.resolved_at = now;
				a.resolved_by = "system";
				a.evidence = "Approval task no longer exists — alert auto-resolved";
			}
		}
		await writeAlerts(alerts);
		return orphans.length;
	} catch (err) {
		console.warn("[workforce] approval alert reconcile failed:", err.message);
		return 0;
	}
}

// ─── PENDING APPROVALS — full list of blocked (awaiting-approval) tasks
// NOT truncated to the overview's recent-30 window: a high-risk task must
// never silently disappear from the admin's Approval Center. Includes the
// description/input (the WHY) the directive §21 requires.
async function pendingApprovals() {
	// First clear any approval alerts whose task vanished (see reconcile
	// above) so the list the admin acts on always maps to a real task.
	await reconcileApprovalAlerts().catch(() => {});
	const tasks = await listTasks({ status: "blocked", limit: 500 });
	return {
		ok: true,
		approvals: tasks.map((t) => ({
			id: t.id,
			title: t.title || t.task || "Untitled task",
			description: t.description || null,
			source: t.source || "admin",
			priority: t.priority || "medium",
			risk_level: t.risk_level || "low",
			verification_status: t.verification_status || "awaiting_approval",
			input: t.input || null,
			created_by: t.created_by || "system",
			created_at: t.created_at,
		})),
	};
}

// ─── Real per-agent work record (larger window than the overview) ─
// The overview only surfaces the 30 most recent tasks across ALL
// employees, which would make an employee's Work Record falsely look
// empty if their older tasks fell out of that window. This command
// queries the store filtered by assigned_agent so each employee's
// arena reflects their REAL work.
async function agentWork(agentId) {
	const id = clean(String(agentId || ""), 64);
	if (!id) return { ok: false, error: "agent_id required" };
	const tasks = await listTasks({ agentId: id, limit: 200 });
	return {
		ok: true,
		tasks: tasks.map((t) => ({
			id: t.id,
			title: t.title || t.task || "Untitled task",
			source: t.source || "admin",
			priority: t.priority || "medium",
			status: t.status || "queued",
			assigned_agent: t.assigned_agent || t.agent_id || null,
			parent_task_id: t.parent_task_id || null,
			risk_level: t.risk_level || "low",
			attempts: t.attempts || 0,
			verification_status: t.verification_status || "none",
			error: t.error || null,
			outcomes: Array.isArray(t.outcomes) ? t.outcomes : null,
			timeline: Array.isArray(t.timeline) ? t.timeline : null,
			impact: t.impact || null,
			created_at: t.created_at,
			completed_at: t.completed_at || null,
		})),
	};
}

// ─── Execute one claimed task through the REAL runner ──────────────
async function runClaimed({ task, agent }) {
	const startedAt = new Date().toISOString();
	// REAL EXECUTION TIMELINE (Phase 23) — every phase is recorded with a real
	// timestamp and surfaced in the admin console. No fabricated steps.
	const timeline = [
		{
			at: task.claimed_at || startedAt,
			step: "claimed",
			detail: `Task claimed by ${agent.name}`,
		},
		{
			at: startedAt,
			step: "started",
			detail: `Execution started — ${task.title}`,
		},
	];
	await updateTask(task.id, {
		status: "working",
		started_at: startedAt,
		heartbeat_at: startedAt,
		timeline,
	});

	// Real heartbeat while working (so recovery never kills live work).
	// Guaranteed cleared on every exit path (finally) — no leaks, and a
	// queued/failed task can never keep receiving heartbeats.
	let hb = null;
	hb = setInterval(() => {
		updateTask(task.id, { heartbeat_at: new Date().toISOString() }).catch(
			() => {},
		);
	}, HEARTBEAT_MS);

	try {
		setAgentState(agent.id, "working", task.title);
		const taskFn = () =>
			processAgentTask(
				agent,
				task.description || task.title,
				classifyTask(agent.description || agent.name),
			);
		taskFn.description = `Workforce task: ${task.title}`;
		const execution = await runAgent(
			agent.id,
			agent.name,
			agent.division,
			taskFn,
			"workforce",
			{ task_id: task.id },
		);

		const ok =
			execution.status === "completed" &&
			execution.output &&
			execution.output.type !== "error";
		if (ok) {
			// Real outcome verification: re-check every claimed change against the DB
			let outcomes = [];
			let verification_status = "none";
			// Visible VERIFYING state while independent verification runs — a real
			// runtime transition, never a cosmetic label. The timeline entry is
			// recorded BEFORE verification so the trace always matches the real
			// state transitions even if verification throws.
			const verifyingAt = new Date().toISOString();
			timeline.push({
				at: verifyingAt,
				step: "verifying",
				detail: "Independent DB verification of claimed changes",
			});
			await updateTask(task.id, {
				status: "verifying",
				heartbeat_at: verifyingAt,
				timeline,
			});
			setAgentState(agent.id, "verifying", task.title);
			try {
				const claimed = execution.output?.data?.actions || [];
				// Admin-approved high-risk decision: the workforce executes the
				// exact sanctioned action (hide + resolve linked reports) on top of
				// the agent's investigation — approval means REAL execution, and
				// the result is DB-verified like any other outcome.
				const approved = await applyApprovedDecision(task);
				for (const a of approved) claimed.push(a);
				outcomes = await verifyOutcomes(claimed);
				const v = outcomes.filter((o) => o.verified).length;
				verification_status =
					outcomes.length === 0
						? "none"
						: v === outcomes.length
							? "passed"
							: v > 0
								? "partial"
								: "failed";
				timeline[timeline.length - 1].detail =
					`Independent DB verification: ${v}/${outcomes.length} claimed changes confirmed`;
			} catch (err) {
				console.warn("[workforce] outcome verification failed:", err.message);
			}
			const completedAt = new Date().toISOString();
			// Real impact measured from verified outcomes only (never invented).
			const impact = measureImpact(outcomes);
			const verifiedCount = outcomes.filter((o) => o.verified).length;
			timeline.push({
				at: completedAt,
				step:
					verification_status === "failed"
						? "verification_failed"
						: "completed",
				detail:
					verification_status === "failed"
						? `Verification failed — ${outcomes.filter((o) => !o.verified).length} unverified claim(s)`
						: `Completed with ${verifiedCount} verified outcome(s)${impact.measurable ? ` — impact: ${impact.summary}` : ""}`,
			});
			await updateTask(task.id, {
				status: "completed",
				output: execution.output,
				error: null,
				outcomes,
				verification_status,
				impact,
				timeline,
				completed_at: completedAt,
				heartbeat_at: null,
			});
			setAgentState(agent.id, "completed", task.title, {
				...(execution.output || {}),
				outcomes,
				verification_status,
				impact,
			});
			await logActivity(agent.id, "task_completed", {
				task_id: task.id,
				title: task.title,
				duration_ms: execution.duration_ms,
				verified_outcomes: verifiedCount,
				impact: impact.summary || null,
			});
			await recordMetric("tasks_completed", 1);
			if (verifiedCount > 0)
				await recordMetric("outcomes_verified", verifiedCount);
			emitEvent("task.completed", {
				task_id: task.id,
				agent_id: agent.id,
				title: task.title,
				duration_ms: execution.duration_ms,
				verified_outcomes: verifiedCount,
			}).catch(() => {});
			// Action happened but independent verification FAILED — mandatory alert
			// (spec §24: never show DONE for an unverified claim; surface it).
			if (verification_status === "failed") {
				const unverified = outcomes.filter((o) => !o.verified);
				raiseAlert({
					severity: "high",
					title: `Verification failed: ${task.title}`,
					body: `${unverified.length} claimed change(s) could not be confirmed against the database.`,
					agent: agent.id,
					key: `verify-failed:${task.id}`,
					evidence:
						unverified
							.map((o) => o.evidence)
							.filter(Boolean)
							.join("; ")
							.slice(0, 400) || null,
				}).catch(() => {});
			} else {
				// The action verified this time — close any earlier failure alert for
				// this task (spec §20: "After resolution: RESOLVED notification").
				// Awaited so the resolution is durable before the outcome is reported.
				await resolveAlertKey(`verify-failed:${task.id}`).catch(() => {});
				await resolveAlertKey(`task-failed:${task.id}`).catch(() => {});
			}
			// Real handoff: spawn dependent work for other employees (parent_task_id chain)
			let handoffs = [];
			try {
				handoffs = await maybeHandoff(task, outcomes);
			} catch (err) {
				console.warn("[workforce] handoff failed:", err.message);
			}
			return {
				task_id: task.id,
				agent_id: agent.id,
				status: "completed",
				duration_ms: execution.duration_ms,
				verified_outcomes: verifiedCount,
				outcomes,
				handoffs,
			};
		}

		// Failed — honor the retry budget, then requeue or fail for real.
		// attempts is incremented HERE (not at claim) so the budget is
		// identical in table mode and settings mode — a task can never retry
		// forever, in either store.
		const errMsg = clean(
			execution.error ||
				execution.output?.data?.error ||
				"Agent execution failed",
			300,
		);
		const attempts = (task.attempts || 0) + 1;
		if (attempts < (task.max_attempts || 3)) {
			timeline.push({
				at: new Date().toISOString(),
				step: "failed_retry",
				detail: `Execution failed — requeued for retry (attempt ${attempts}/${task.max_attempts || 3})`,
			});
			await updateTask(task.id, {
				status: "queued",
				assigned_agent: null,
				error: errMsg,
				verification_status: "none",
				attempts,
				timeline,
				heartbeat_at: null,
			});
			setAgentState(agent.id, "idle", task.title); // truthful: nothing executing now
			await logActivity(
				agent.id,
				"task_failed_retry",
				{ task_id: task.id, error: errMsg, attempts },
				"warning",
			);
			return {
				task_id: task.id,
				agent_id: agent.id,
				status: "queued_for_retry",
				error: errMsg,
				attempts,
			};
		}
		timeline.push({
			at: new Date().toISOString(),
			step: "failed",
			detail: `Execution failed — ${errMsg.slice(0, 90)}`,
		});
		await updateTask(task.id, {
			status: "failed",
			error: errMsg,
			verification_status: "failed",
			attempts,
			timeline,
			completed_at: new Date().toISOString(),
			heartbeat_at: null,
		});
		setAgentState(agent.id, "error", task.title);
		await logActivity(
			agent.id,
			"task_failed",
			{ task_id: task.id, error: errMsg, attempts },
			"error",
		);
		await recordMetric("tasks_failed", 1);
		emitEvent("task.failed", {
			task_id: task.id,
			agent_id: agent.id,
			error: errMsg,
		}).catch(() => {});
		// Real failure → admin alert (grouped per task; repeated retries escalate).
		raiseAlert({
			severity: "medium",
			title: `Task failed: ${task.title}`,
			body: errMsg,
			agent: agent.id,
			key: `task-failed:${task.id}`,
			evidence: `attempts ${attempts}/${task.max_attempts || 3} exhausted`,
		}).catch(() => {});
		return {
			task_id: task.id,
			agent_id: agent.id,
			status: "failed",
			error: errMsg,
		};
	} catch (err) {
		timeline.push({
			at: new Date().toISOString(),
			step: "failed",
			detail: `Unexpected error — ${clean(err.message, 90)}`,
		});
		await updateTask(task.id, {
			status: "failed",
			error: clean(err.message, 300),
			verification_status: "failed",
			timeline,
			completed_at: new Date().toISOString(),
			heartbeat_at: null,
		});
		setAgentState(agent.id, "error", task.title);
		await logActivity(
			agent.id,
			"task_failed",
			{ task_id: task.id, error: err.message },
			"error",
		);
		return {
			task_id: task.id,
			agent_id: agent.id,
			status: "failed",
			error: err.message,
		};
	} finally {
		if (hb) clearInterval(hb);
	}
}

// ─── Workforce Supervisor — degraded-worker detection ──────────────
// Worker #100's real duty: watch the OTHER workers. Reads REAL
// agent_executions failure rows (written by the runner) and raises a
// deduped admin alert when an agent crosses the failure threshold. No
// fabricated numbers — zero failures → zero alerts.
const WORKER_DEGRADED_THRESHOLD = 4; // ≥4 failed executions in the window
const WORKER_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function supervisorHealthCheck() {
	try {
		const since = new Date(
			Date.now() - WORKER_FAILURE_WINDOW_MS,
		).toISOString();
		const { data, error } = await supabase
			.from("agent_executions")
			.select("agent_id, agent_name, error")
			.eq("status", "failed")
			.gte("started_at", since)
			.limit(500);
		if (error) return { checked: 0, degraded: 0 }; // no table → no data → no claim
		const byAgent = {};
		for (const ex of data || []) {
			const id = ex.agent_id || "unknown";
			byAgent[id] = byAgent[id] || {
				agent_id: id,
				name: ex.agent_name || id,
				count: 0,
				lastError: null,
			};
			byAgent[id].count += 1;
			if (ex.error && !byAgent[id].lastError)
				byAgent[id].lastError = String(ex.error).slice(0, 160);
		}
		let degraded = 0;
		for (const a of Object.values(byAgent)) {
			if (a.count < WORKER_DEGRADED_THRESHOLD) continue;
			degraded += 1;
			raiseAlert({
				severity: "medium",
				title: `Worker degraded: ${a.name}`,
				body: `${a.count} failed executions in the last 24h. Inspect and recover, or reassign its tasks.`,
				agent: a.agent_id,
				key: `worker-degraded:${a.agent_id}`,
				evidence: a.lastError
					? `Last error: ${a.lastError} — ${a.count} failure(s) in 24h from agent_executions`
					: `${a.count} failure(s) in 24h from agent_executions`,
			}).catch(() => {});
		}
		// Only write the metric when something is actually degraded — avoids
		// filling system_metrics with a zero row on every patrol cycle.
		if (degraded > 0) await recordMetric("workers_degraded", degraded);
		return { checked: Object.keys(byAgent).length, degraded };
	} catch (err) {
		return { checked: 0, degraded: 0, error: err.message };
	}
}

// ─── REAL STORAGE HYGIENE — prune what the platform no longer needs ─
// Class-A safe operations only (reversible/low-risk/deterministic):
//   • system_metrics rows older than RETENTION_MS are DELETED — telemetry
//     is the #1 silent DB grower, and stale rows have zero value.
//   • The measured count is recorded as a metric + activity row so the
//     Ops Center can show REAL storage savings (never invented).
//   • Wrapped defensively: a missing table / column just reports 0 and
//     the patrol continues — hygiene is best-effort, not load-bearing.
async function runStorageHygiene() {
	const RESULT = { metrics_pruned: 0, error: null };
	const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
	try {
		const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
		const { data: stale } = await supabase
			.from("system_metrics")
			.select("id")
			.lt("recorded_at", cutoff)
			.limit(5000);
		const ids = (stale || []).map((r) => r.id).filter(Boolean);
		if (ids.length > 0) {
			const { error } = await supabase
				.from("system_metrics")
				.delete()
				.in("id", ids);
			if (error) {
				RESULT.error = error.message;
				console.warn("[workforce] storage hygiene prune failed:", error.message);
			} else {
				RESULT.metrics_pruned = ids.length;
				await logActivity("cleanup-steward", "storage_hygiene", {
					pruned: ids.length,
					table: "system_metrics",
					cutoff,
				}, "info");
				await recordMetric("metrics_pruned", ids.length);
			}
		}
	} catch (err) {
		RESULT.error = err.message;
		console.warn("[workforce] storage hygiene failed:", err.message);
	}
	return RESULT;
}

// ─── The full autonomous loop (one patrol) ─────────────────────────
async function patrol({ limit = 6 } = {}) {
	const startedAt = Date.now();
	// Kill switch §24: maintenance / active GLOBAL STOP freeze discovery +
	// assignment + execution. recoverStale STILL runs — stuck work must never
	// rot while the workforce is on hold (monitoring duty).
	const cfg = await getConfig();
	// Kill switch §24 — the soft global PAUSE must freeze direct patrol()
	// callers too (Vercel cron + dev scheduler), not just the HTTP command
	// that pre-checks cfg.paused. recoverStale still runs under pause: stuck
	// work must never rot while the workforce is on hold (monitoring duty).
	const frozen = cfg.paused || cfg.maintenance || isStopActive(cfg);
	const discovered = frozen ? [] : await discoverWork();
	// REAL STORAGE HYGIENE (Class-A safe) — prunes stale telemetry that would
	// otherwise grow the DB forever. Runs on the same patrol cadence; the
	// operation is a real DELETE with a measured row count recorded as a
	// metric + activity, so the Ops Center reports actual storage savings.
	const hygiene = await runStorageHygiene();
	const recovered = await recoverStale();
	const assigned = frozen ? [] : await assignQueued(limit);
	const results = [];
	for (const a of assigned) {
		try {
			results.push(await runClaimed(a));
		} catch (err) {
			results.push({
				task_id: a.task.id,
				status: "failed",
				error: err.message,
			});
		}
	}
	const completed = results.filter((r) => r.status === "completed").length;
	const failed = results.filter((r) => r.status === "failed").length;
	const queuedForRetry = results.filter(
		(r) => r.status === "queued_for_retry",
	).length;
	await recordMetric("patrol_duration_ms", Date.now() - startedAt);
	// Workforce Supervisor: real degraded-worker detection from failure rows.
	const supervised = await supervisorHealthCheck();
	// Heartbeat for the Ops Center freshness chip — EVERY patrol driver
	// (Vercel cron, admin command, dev scheduler) records when it ran, so the
	// dashboard never claims "patrol 1d ago" while the workforce is active.
	await setConfig({ last_patrol_at: new Date().toISOString() });
	return {
		ok: true,
		patrol_ms: Date.now() - startedAt,
		maintenance: cfg.maintenance,
		stopped: isStopActive(cfg),
		discovered: discovered.length,
		hygiene,
		recovered,
		assigned: assigned.length,
		executed: results.length,
		completed,
		failed,
		queued_for_retry: queuedForRetry,
		supervised,
		results,
	};
}

// ─── LIVE OVERVIEW — truthful numbers from real runtime ────────────
async function getOverview(tasksOverride) {
	const cfg = await getConfig();
	const [tasks, executions, activity, llmOk] = await Promise.all([
		// Allow callers (e.g. ops-summary) to reuse an already-fetched task list
		// instead of querying agent_tasks twice per request.
		tasksOverride ? Promise.resolve(tasksOverride) : listTasks({ limit: 200 }),
		(async () => {
			// agent_executions has its own table (separate from agent_tasks) —
			// always try it; empty/error is a truthful 0. Bounded to the 300 most
			// recent rows: per-agent summary stats only need a recent window, and
			// the ops-summary endpoint is polled every 20s — scanning 1000+ rows
			// every poll is what made the Ops Center load slowly (3.6s live).
			try {
				const { data } = await supabase
					.from("agent_executions")
					.select("agent_id, status, duration_ms, started_at")
					.order("started_at", { ascending: false })
					.limit(300);
				return data || [];
			} catch {
				return [];
			}
		})(),
		(async () => {
			const { getRecentActivity } = await import("./agents/_runner.js");
			return getRecentActivity(40);
		})(),
		(async () => {
			const { hasUsableLLM } = await import("./_providers.js");
			return hasUsableLLM();
		})(),
	]);

	const byStatus = {};
	for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

	// Employee roster — every worker maps to real runtime stats
	const employees = ALL_AGENTS.map((a) => {
		const mine = executions.filter((e) => e.agent_id === a.id);
		const completed = mine.filter((e) => e.status === "completed").length;
		const failed = mine.filter((e) => e.status === "failed").length;
		const running = mine.filter((e) => e.status === "running").length;
		const myTasks = tasks.filter((t) => t.assigned_agent === a.id);
		const activeTask = tasks.find(
			(t) =>
				t.assigned_agent === a.id && ["working", "claimed"].includes(t.status),
		);
		const state = getAgentState(a.id).state;
		const status =
			running > 0 || state === "working"
				? "working"
				: state === "verifying"
					? "verifying"
					: activeTask
						? "working"
						: state === "error" || (failed > 0 && completed === 0)
							? "error"
							: "idle";
		const durations = mine
			.filter((e) => e.duration_ms)
			.map((e) => e.duration_ms);
		// Employee economics (§ REAL EMPLOYEE OUTPUT REQUIREMENT): only real
		// tasks and verified outcomes count. 0 useful work ⇒ underutilized,
		// never simulated busyness.
		const outputsCreated = myTasks.reduce(
			(s, t) =>
				s +
				(Array.isArray(t.outcomes)
					? t.outcomes.filter((o) => o.verified).length
					: 0),
			0,
		);
		const received7d = myTasks.filter(
			(t) => Date.now() - new Date(t.created_at).getTime() < 7 * 86400000,
		).length;
		const utilization =
			status === "working"
				? "working"
				: received7d > 0 || outputsCreated > 0
					? "utilized"
					: "underutilized";
		return {
			employee_id: a.id,
			name: a.name,
			division: a.division,
			role: a.role || "Specialist",
			description: a.description || "",
			icon: a.icon || "🤖",
			capabilities: a.capabilities || [],
			status,
			utilization,
			current_task:
				activeTask?.title ||
				(state === "working" ? getAgentState(a.id).task || null : null),
			total_executions: mine.length,
			completed,
			failed,
			running,
			tasks_received: myTasks.length,
			tasks_completed: myTasks.filter((t) => t.status === "completed").length,
			tasks_failed: myTasks.filter((t) => t.status === "failed").length,
			outputs_created: outputsCreated,
			// Truthful employee success: verified outcomes / tasks that reached
			// verification (never the raw execution-completion ratio — that would
			// count unverified "done" as success, which the directive forbids).
			success_rate: (() => {
				const reached = myTasks.filter((t) =>
					reachedVerification(t.verification_status),
				).length;
				if (reached === 0) return null;
				return Math.min(
					100,
					Math.round(
						(myTasks.filter((t) => t.verification_status === "passed").length /
							reached) *
							100,
					),
				);
			})(),
			completion_rate: myTasks.length
				? Math.round(
						(myTasks.filter((t) => t.status === "completed").length /
							myTasks.length) *
							100,
					)
				: null,
			avg_duration_ms: durations.length
				? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
				: null,
			last_activity: mine[0]?.started_at || null,
			memory_count: null, // filled below if table present
			health: failed > 3 ? "degraded" : "healthy",
		};
	});

	// Real memory counts (best-effort — agent_memory is its own table)
	try {
		const { data: mem } = await supabase
			.from("agent_memory")
			.select("agent_id")
			.limit(5000);
		const counts = {};
		(mem || []).forEach((m) => {
			counts[m.agent_id] = (counts[m.agent_id] || 0) + 1;
		});
		employees.forEach((e) => {
			e.memory_count = counts[e.employee_id] || 0;
		});
	} catch {
		/* non-critical */
	}

	// Normalize legacy rows (old schema has `task` instead of `title`)
	const recentTasks = tasks.slice(0, 30).map((t) => ({
		id: t.id,
		title: t.title || t.task || "Untitled task",
		source: t.source || "admin",
		priority: t.priority || "medium",
		status: t.status || "queued",
		assigned_agent: t.assigned_agent || t.agent_id || null,
		parent_task_id: t.parent_task_id || null,
		risk_level: t.risk_level || "low",
		attempts: t.attempts || 0,
		verification_status: t.verification_status || "none",
		error: t.error || null,
		outcomes: Array.isArray(t.outcomes) ? t.outcomes : null,
		timeline: Array.isArray(t.timeline) ? t.timeline : null,
		impact: t.impact || null,
		created_at: t.created_at,
		completed_at: t.completed_at || null,
	}));

	return {
		ok: true,
		employees,
		task_queue: {
			total: tasks.length,
			queued: byStatus.queued || 0,
			claimed: byStatus.claimed || 0,
			working: byStatus.working || 0,
			verifying: byStatus.verifying || 0,
			completed: byStatus.completed || 0,
			failed: byStatus.failed || 0,
			blocked: byStatus.blocked || 0,
		},
		recent_tasks: recentTasks,
		activity: activity.map((a) => ({
			agent_id: a.agent_id,
			action: a.action,
			severity: a.severity,
			details: a.details,
			created_at: a.created_at,
		})),
		config: {
			paused: !!cfg.paused,
			last_patrol_at: cfg.last_patrol_at || null,
		},
		// Honest provider status (Phase 43 of the spec): when no AI key is
		// configured anywhere the workforce can't reason — the UI shows
		// AI PROVIDER DEGRADED instead of pretending agents are thinking.
		ai_provider: {
			ok: llmOk,
			status: llmOk ? "ready" : "degraded",
			note: llmOk
				? "AI provider configured"
				: "AI PROVIDER DEGRADED — no API key configured; agents run data-only patrols",
		},
		metrics: {
			working: employees.filter((e) => e.status === "working").length,
			verifying: employees.filter((e) => e.status === "verifying").length,
			done: employees.filter(
				(e) => e.status !== "working" && e.status !== "verifying",
			).length,
			total_employees: employees.length,
			utilized: employees.filter((e) => e.utilization !== "underutilized")
				.length,
			underutilized: employees.filter((e) => e.utilization === "underutilized")
				.length,
			total_executions: executions.length,
			completed_executions: executions.filter((e) => e.status === "completed")
				.length,
			failed_executions: executions.filter((e) => e.status === "failed").length,
			verified_outcomes: tasks.reduce(
				(s, t) =>
					s +
					(Array.isArray(t.outcomes)
						? t.outcomes.filter((o) => o.verified).length
						: 0),
				0,
			),
			// Truthful success: only DB-verified outcomes count (spec §20). A task that
			// completed but never verified is NOT a success — so the headline rate is
			// verified tasks / tasks that reached verification, clamped to 100%.
			success_rate: (() => {
				const reached = tasks.filter((t) =>
					reachedVerification(t.verification_status),
				).length;
				if (reached === 0) return null;
				const verified = tasks.filter(
					(t) => t.verification_status === "passed",
				).length;
				return Math.min(100, Math.round((verified / reached) * 100));
			})(),
			completion_rate: executions.length
				? Math.round(
						(executions.filter((e) => e.status === "completed").length /
							executions.length) *
							100,
					)
				: null,
			avg_duration_ms: executions.filter((e) => e.duration_ms).length
				? Math.round(
						executions
							.filter((e) => e.duration_ms)
							.reduce((s, e) => s + e.duration_ms, 0) /
							executions.filter((e) => e.duration_ms).length,
					)
				: null,
		},
		updated_at: new Date().toISOString(),
	};
}

// ─── Ops summary — the admin's outcome-focused command view ─────────
// The workforce directive demands the admin see RESULTS, INCIDENTS, RISKS
// and ATTENTION-REQUIRED work — not 100 agent cards. This aggregates real
// persisted task rows (agent_tasks) into exactly those buckets, plus the
// platform-health counts the command center renders. Nothing here is
// invented: every number derives from database state, and an empty bucket
// is an honest empty bucket (the UI renders it as such).
const OPS_PRIO = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
// Exclusive buckets (no double-counting): ACTIVE work is queued/claimed/
// working/verifying; anything blocked or awaiting approval is ATTENTION.
const OPS_ACTIVE = new Set(["queued", "claimed", "working", "verifying"]);

// ─── ops-summary cache ───────────────────────────────────────────
// The Ops Center polls this endpoint every 20s (+ realtime refreshes + the
// default admin tab), and each poll runs ~10 sequential Supabase round trips
// (free-tier per-query latency ~250-750ms — measured live at ~3.3s total).
// Cache the summary for 8s so concurrent polls/tabs share ONE computation;
// the payload still reflects a real computation ≤8s old, and `updated_at` is
// re-stamped on every response so the UI's LIVE indicator stays honest.
let _opsSummaryCache = { at: 0, data: null };
// Matches the Ops Center poll cadence (useSmartPoll intervalMs: 20000). With an
// 8s TTL the endpoint recomputed its 5 exact-count DB scans on EVERY poll tick
// (cold cost ~4s), which made the command center feel laggy. Caching for one
// full poll window halves the recomputes while keeping data ≤20s fresh — the
// exact counts still run on every real (non-cached) computation, so nothing is
// approximated or fabricated.
const OPS_SUMMARY_TTL_MS = 20000;

/** Drop the cached summary after any state-changing workforce command so the
 *  Ops Center's forceRefresh (acknowledge / approve / reject / patrol / raise)
 *  sees the NEW state immediately instead of a stale payload for up to TTL. */
function invalidateOpsSummary() {
	_opsSummaryCache = { at: 0, data: null };
}

async function opsSummary() {
	const nowMs = Date.now();
	if (
		_opsSummaryCache.data &&
		nowMs - _opsSummaryCache.at < OPS_SUMMARY_TTL_MS
	) {
		return { ..._opsSummaryCache.data, updated_at: new Date().toISOString() };
	}
	// Fetch tasks ONCE and hand them to getOverview — the default admin tab
	// polls this endpoint, so avoid the double listTasks round-trip.
	const tasks = await listTasks({ limit: 300 });
	const ov = await getOverview(tasks);
	const now = Date.now();
	const DAY = 24 * 60 * 60 * 1000;

	const incidents = [];
	const attention = [];
	const autoResolved = [];
	let verifiedToday = 0;

	for (const t of tasks) {
		const outcomes = Array.isArray(t.outcomes) ? t.outcomes : [];
		const verified = outcomes.filter((o) => o.verified);
		const doneAt = t.completed_at || t.created_at || "";
		for (const o of verified) {
			if (doneAt && now - new Date(doneAt).getTime() < DAY) verifiedToday++;
		}
		const row = {
			id: t.id,
			title: t.title || t.task || "Untitled task",
			agent: t.assigned_agent || t.agent_id || null,
			priority: t.priority || "medium",
			risk_level: t.risk_level || "low",
			status: t.status || "queued",
			verification_status: t.verification_status || "none",
			created_at: t.created_at,
			completed_at: t.completed_at || null,
			error: t.error || null,
			impact: t.impact || null,
			evidence_count: verified.length,
			timeline_count: Array.isArray(t.timeline) ? t.timeline.length : 0,
			outcomes: verified.slice(0, 3).map((o) => ({
				what: o.what || o.action || o.change || "platform change",
				impact: o.impact || null,
			})),
		};
		if (
			OPS_ACTIVE.has(row.status) &&
			(t.priority === "critical" || t.priority === "high")
		)
			incidents.push(row);
		if (
			t.status === "blocked" ||
			t.status === "waiting_approval" ||
			t.status === "failed" ||
			t.verification_status === "failed"
		)
			attention.push(row);
		if (
			t.status === "completed" &&
			t.verification_status === "passed" &&
			verified.length > 0
		)
			autoResolved.push(row);
	}

	const prio = (p) => OPS_PRIO[p] ?? 3;
	incidents.sort(
		(a, b) =>
			prio(a.priority) - prio(b.priority) ||
			(b.created_at || "").localeCompare(a.created_at || ""),
	);
	attention.sort((a, b) => prio(a.priority) - prio(b.priority));
	autoResolved.sort((a, b) =>
		(b.completed_at || "").localeCompare(a.completed_at || ""),
	);

// Cached clean-post count for the platform pulse. The feed hides test/fuzz
// artifacts in JS; the same filter runs here over a bounded title scan so the
// dashboard's post count matches what users actually see (a raw count said
// 1068 while only 32 real posts existed). Refreshed at most every 60s.
let _cleanPostCountCache = { at: 0, value: 0 };
const CLEAN_POST_COUNT_TTL_MS = 60_000;
async function getCleanPostCount() {
	if (
		_cleanPostCountCache.value > 0 &&
		Date.now() - _cleanPostCountCache.at < CLEAN_POST_COUNT_TTL_MS
	)
		return _cleanPostCountCache.value;
	try {
		const { data } = await supabase
			.from("posts")
			.select("title", { count: "exact" })
			.eq("deleted", false)
			.order("created_at", { ascending: false })
			.limit(2000);
		// `count` describes the whole table (unfiltered); the honest number is
		// the artifact-filtered scan. If rows were truncated at the limit, fall
		// back to the raw exact count rather than undercounting a big table.
		const rows = data || [];
		if (rows.length >= 2000) {
			const { count } = await supabase
				.from("posts")
				.select("id", { count: "exact", head: true })
				.eq("deleted", false);
			_cleanPostCountCache = { at: Date.now(), value: count || rows.length };
		} else {
			_cleanPostCountCache = {
				at: Date.now(),
				value: rows.filter((p) => !isTestArtifact(p.title)).length,
			};
		}
		return _cleanPostCountCache.value;
	} catch {
		// On failure keep serving the last known value — a dashboard number
		// going stale briefly beats it disappearing.
		return _cleanPostCountCache.value;
	}
}

	// ── Platform pulse (Recent / Trending / Emergency / Reports / Suggestion /
	//    Polls) — real data, bounded queries so the 20s poll stays cheap. ──
	// Post count must match what every other surface shows: the feed hides
	// test/fuzz artifacts in JS, so a plain count here once said 1068 while
	// the dashboard said 32. A head-count can't express the artifact filter,
	// so scan titles (bounded) and count the clean set — cached to keep the
	// 20s poll cheap.
	const cleanPostCount = await getCleanPostCount();
	const [pendingReportsRes, usersRes, commentsRes, reactionsRes] =
		await Promise.all([
			supabase
				.from("reports")
				.select("id", { count: "exact", head: true })
				.eq("status", "pending"),
			// Head-only counts return count=null on this database (verified
			// live), which the widget rendered as 0 while 1446 accounts exist.
			// Selecting a real row makes the count exact again.
			supabase.from("users_meta").select("anon_id", { count: "exact" }).limit(1),
			supabase.from("comments").select("id", { count: "exact", head: true }),
			supabase.from("reactions").select("id", { count: "exact", head: true }),
		]);
	const [recentPostsRes, pollsRes, suggestionCountRes] = await Promise.all([
		supabase
			.from("posts")
			.select("id,title,category,priority,status,type,created_at")
			.eq("deleted", false)
			.order("created_at", { ascending: false })
			.limit(20),
		supabase
			.from("polls")
			.select("id,title,expires_at,created_at")
			.eq("deleted", false)
			.order("created_at", { ascending: false })
			.limit(10),
		supabase
			.from("posts")
			.select("id", { count: "exact", head: true })
			.eq("type", "suggestion")
			.eq("deleted", false),
	]);
	// Full-site zero-fuzz: hide test/fuzz artifacts from the ops pulse, same
	// as every other content surface ("Load test test-issue …" was surfacing
	// here in Recent/Trending).
	const recentClean = (recentPostsRes.data || []).filter(
		(p) => !isTestArtifact(p.title),
	);
	const recentPosts = recentClean.map((p) => ({
		id: p.id,
		title: p.title,
		category: p.category,
		priority: p.priority,
		status: p.status,
		type: p.type,
		created_at: p.created_at,
	}));
	// REAL trending score: support/upvote/appreciate reactions + comments for
	// the bounded recent window (no fabricated ranking).
	const pulseIds = recentPosts.map((p) => p.id);
	let pulseEngagement = {}; // id -> { reactions, comments }
	if (pulseIds.length > 0) {
		// NOTE: PostgrestBuilder has .then but NO .catch — use try/catch so a
		// transient DB error never 500s the whole ops-summary.
		const fetchRows = async (table, col, ids) => {
			try {
				const { data } = await supabase
					.from(table)
					.select(col)
					.in(ids[0], ids[1]);
				return data || [];
			} catch {
				return [];
			}
		};
		const [reactRows, commentRows] = await Promise.all([
			// Restrict to post reactions only — comment reactions share the same
			// table and an unfiltered id query could attribute them to posts.
			fetchRows("reactions", "target_id,kind,target_type", ["target_id", pulseIds]),
			fetchRows("comments", "post_id", ["post_id", pulseIds]),
		]);
		const pos = new Set(["support", "upvote", "appreciate"]);
		pulseEngagement = {};
		for (const r of reactRows) {
			if (r.target_type && r.target_type !== "post") continue;
			if (!pos.has(r.kind)) continue;
			pulseEngagement[r.target_id] = pulseEngagement[r.target_id] || { r: 0, c: 0 };
			pulseEngagement[r.target_id].r++;
		}
		for (const c of commentRows) {
			pulseEngagement[c.post_id] = pulseEngagement[c.post_id] || { r: 0, c: 0 };
			pulseEngagement[c.post_id].c++;
		}
	}
	const withEng = recentPosts.map((p) => ({
		...p,
		engagement: (pulseEngagement[p.id]?.r || 0) + (pulseEngagement[p.id]?.c || 0),
	}));
	const emergencyPosts = recentPosts.filter(
		(p) =>
			(p.priority === "critical" || p.priority === "high") &&
			p.status !== "solved" &&
			p.status !== "archived",
	);
	const nowIso = Date.now();
	const activePolls = (pollsRes.data || []).filter(
		(p) => !p.expires_at || new Date(p.expires_at).getTime() > nowIso,
	);
	const platformPulse = {
		recent: withEng.slice(0, 5),
		trending: [...withEng].sort((a, b) => b.engagement - a.engagement).slice(0, 5),
		emergency: emergencyPosts.slice(0, 5),
		emergency_count: emergencyPosts.length,
		reports_open: pendingReportsRes.count || 0,
		suggestions: suggestionCountRes.count || 0,
		polls: activePolls.slice(0, 5),
		polls_active: activePolls.length,
	};

	// ── Admin alerts: unresolved first (open + seen-pending), then a few
	//     recent resolved rows so the Ops Center can render all three states ──
	const alerts = await listAlerts();
	// Trim the polled payload — bounded rows + bucket counts, never the full
	// 100-row history. Counts (open/acknowledged_open/resolved) are always the
	// true totals; rows are a bounded window.
	const alertsView = {
		ok: true,
		alerts: [
			...alerts.alerts.filter((a) => !a.resolved_at).slice(0, 7),
			...alerts.alerts.filter((a) => a.resolved_at).slice(0, 3),
		],
		open: alerts.open,
		critical_open: alerts.critical_open,
		acknowledged_open: alerts.acknowledged_open,
		resolved: alerts.resolved,
	};

	// ── Daily operations report (spec §26) — real 24h aggregates ───────
	const dayTasks = tasks.filter(
		(t) => t.created_at && now - new Date(t.created_at).getTime() < DAY,
	);
	const completedIn24h = dayTasks.filter(
		(t) =>
			t.status === "completed" &&
			t.completed_at &&
			now - new Date(t.completed_at).getTime() < DAY,
	);
	const bySource = {};
	for (const t of dayTasks)
		bySource[t.source || "system"] = (bySource[t.source || "system"] || 0) + 1;
	const report = {
		tasks_created_24h: dayTasks.length,
		tasks_completed_24h: completedIn24h.length,
		tasks_failed_24h: dayTasks.filter((t) => t.status === "failed").length,
		verified_outcomes_24h: verifiedToday,
		auto_resolved_24h: completedIn24h.filter(
			(t) => t.verification_status === "passed",
		).length,
		incidents_open: incidents.length,
		attention_open: attention.length,
		// "Alerts open" = every alert whose issue is still live (needs action
		// OR seen-but-not-fixed). Resolved alerts are not open work.
		alerts_open: alerts.open + alerts.acknowledged_open,
		top_risks: Object.entries(bySource)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([label, count]) => ({ label, count })),
	};

	// ── System health + recent agent activity (Overview dashboard) ──
	// Measured during this build, never assumed. db = one cheap timed
	// read; api = this very response; cache = ops-summary cache freshness;
	// realtime = unknown — only the browser observes its own socket, and a
	// server guess would be fabrication.
	const healthProbeStart = Date.now();
	let dbHealth = "down";
	try {
		await supabase.from("settings").select("key").limit(1);
		dbHealth = Date.now() - healthProbeStart < 500 ? "ok" : "slow";
	} catch {
		dbHealth = "down";
	}
	const cacheAgeMs = Date.now() - (_opsSummaryCache.at || 0);
	const health = {
		db: dbHealth,
		api: "ok",
		cache:
			_opsSummaryCache.at && cacheAgeMs < OPS_SUMMARY_TTL_MS ? "ok" : "stale",
		realtime: "unknown",
	};
	let recent = [];
	try {
		const { data: execs } = await supabase
			.from("agent_executions")
			.select("agent_name,agent_id,task,status,started_at,duration_ms")
			.order("started_at", { ascending: false })
			.limit(6);
		recent = (execs || []).map((e) => ({
			worker: e.agent_name || e.agent_id || "agent",
			action: `${e.task || "run"} — ${e.status || "unknown"}`,
			at: e.started_at,
			impact:
				typeof e.duration_ms === "number" ? `${e.duration_ms}ms` : undefined,
		}));
	} catch {
		recent = [];
	}

	const { employees, ...rest } = ov; // Ops Center never renders the roster — don't ship it on every poll
	// Kill-switch state (spec §24) so the Ops Center can show PAUSED / STOPPED /
	// MAINTENANCE banners from the same source of truth the console uses.
	const wfCfg = await getConfig();
	const wfPausedAgents = new Set(wfCfg.paused_agents || []);
	const wfPausedDivisions = new Set(wfCfg.paused_divisions || []);
	const controls = {
		paused: wfCfg.paused,
		stop_active: isStopActive(wfCfg),
		maintenance: wfCfg.maintenance,
		allow_handoffs: wfCfg.allow_handoffs !== false,
		agents_blocked: ALL_AGENTS.filter(
			(a) =>
				wfPausedAgents.has(a.id) ||
				wfPausedDivisions.has(a.division || "other"),
		).length,
		disabled_tools: (wfCfg.disabled_tools || []).length,
	};
	// ── Live workforce: tasks actually being worked RIGHT NOW (real rows, real
	//     heartbeats). Drives the "what agents are working on" stream on the
	//     Ops Center — every entry is a live working/verifying/claimed task.
	const LIVE_STATUSES = new Set(["working", "verifying", "claimed"]);
	const liveWork = tasks
		.filter((t) => LIVE_STATUSES.has(t.status))
		.map((t) => ({
			id: t.id,
			title: t.title || t.task || "Untitled task",
			agent: t.assigned_agent || t.agent_id || null,
			status: t.status || "working",
			started_at: t.started_at || null,
			heartbeat_at: t.heartbeat_at || null,
			priority: t.priority || "medium",
		}))
		.sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""))
		.slice(0, 12);

	const payload = {
		ok: true,
		...rest,
		controls,
		incidents: incidents.slice(0, 10),
		attention: attention.slice(0, 10),
		auto_resolved: autoResolved.slice(0, 8),
		verified_today: verifiedToday,
		alerts: alertsView,
		report,
		live_work: liveWork,
		health,
		recent,
		platform: {
			posts: cleanPostCount,
			pending_reports: pendingReportsRes.count || 0,
			users: usersRes.count ?? 0,
			comments: commentsRes.count ?? 0,
			reactions: reactionsRes.count ?? 0,
			pulse: platformPulse,
		},
		last_patrol_at: ov.config?.last_patrol_at || null,
		updated_at: new Date().toISOString(),
	};
	_opsSummaryCache = { at: Date.now(), data: payload };
	return payload;
}

// ─── Workforce config — the KILL SWITCH (master prompt §24) ────────
// A single persisted config row carries every control. Every layer of the
// loop (discovery, assignment, handoffs, patrol) reads this before acting,
// so one admin action takes effect everywhere at once and survives restarts:
//   paused            — soft global pause (patrols refused)
//   stop_until        — emergency GLOBAL STOP time window (ISO)
//   maintenance       — freeze NEW autonomous work; monitoring/recovery keep running
//   allow_handoffs    — delegation toggle (agent → agent child tasks)
//   paused_agents     — individual agents off duty
//   paused_divisions  — whole departments off duty
//   disabled_tools    — capability/tool names that may not be executed
const CONTROL_DEFAULTS = {
	paused: false,
	stop_until: null,
	maintenance: false,
	allow_handoffs: true,
	paused_agents: [],
	paused_divisions: [],
	disabled_tools: [],
	last_patrol_at: null,
};

async function getConfig() {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", CONFIG_KEY)
		.maybeSingle();
	return { ...CONTROL_DEFAULTS, ...(data?.value || {}) };
}
async function setConfig(patch) {
	const cfg = await getConfig();
	const next = { ...cfg, ...patch };
	await supabase
		.from("settings")
		.upsert({ key: CONFIG_KEY, value: next }, { onConflict: "key" });
	return next;
}

/** True while an emergency GLOBAL STOP window is active. */
function isStopActive(cfg) {
	return !!(cfg.stop_until && new Date(cfg.stop_until).getTime() > Date.now());
}

// ─── KILL SWITCH CONTROL CENTER (spec §24) ────────────────────────
// Full current control state + derived roster info (which divisions exist,
// how many agents each holds, how many are paused/blocked). The admin
// console renders the kill switch from this; every mutation goes through
// the commands above so the config + audit trail stay consistent.
async function workforceControls() {
	const cfg = await getConfig();
	const pausedAgents = new Set(cfg.paused_agents || []);
	const pausedDivisions = new Set(cfg.paused_divisions || []);
	const byDivision = {};
	for (const a of ALL_AGENTS) {
		const d = a.division || "other";
		(byDivision[d] = byDivision[d] || []).push(a.id);
	}
	const divisions = Object.entries(byDivision)
		.map(([division, ids]) => ({
			division,
			agent_count: ids.length,
			paused: pausedDivisions.has(division),
		}))
		.sort((a, b) => b.agent_count - a.agent_count);
	const blockedAgents = ALL_AGENTS.filter(
		(a) => pausedAgents.has(a.id) || pausedDivisions.has(a.division || "other"),
	);
	return {
		ok: true,
		paused: cfg.paused,
		stop_until: cfg.stop_until,
		stop_active: isStopActive(cfg),
		maintenance: cfg.maintenance,
		allow_handoffs: cfg.allow_handoffs !== false,
		paused_agents: cfg.paused_agents || [],
		paused_divisions: cfg.paused_divisions || [],
		disabled_tools: cfg.disabled_tools || [],
		divisions,
		agents_blocked: blockedAgents.length,
		updated_at: new Date().toISOString(),
	};
}

// ─── Commands ──────────────────────────────────────────────────────
async function command(action, body = {}) {
	switch (action) {
		case "overview":
			return await getOverview();
		case "ops-summary":
			return await opsSummary();
		case "patrol": {
			const cfg = await getConfig();
			if (cfg.paused)
				return {
					ok: true,
					paused: true,
					message: "Workforce is paused — resume to run patrols",
				};
			if (isStopActive(cfg))
				return {
					ok: true,
					stopped: true,
					message:
						"GLOBAL STOP active — no autonomous work until the window expires or the admin resumes",
				};
			// NOTE: limit may be 0 (discovery-only patrol — no agent executions).
			// Number(null) is 0, so only fall back to 6 when the field is absent.
			const limitRaw =
				body.limit === undefined || body.limit === null || body.limit === ""
					? 6
					: Number(body.limit);
			// Clamp: negative limits silently change slice(0, -1) semantics in assignQueued.
			const result = await patrol({
				limit: Number.isFinite(limitRaw) ? Math.max(0, limitRaw) : 6,
			});
			// patrol() records last_patrol_at itself — no double write here.
			invalidateOpsSummary();
			return result;
		}
		case "pause":
			await setConfig({ paused: true });
			await auditLog("admin", "workforce_pause", "Workforce paused by admin");
			invalidateOpsSummary();
			return { ok: true, paused: true };
		case "resume":
			// Full resume: lift the soft pause AND any emergency GLOBAL STOP window.
			await setConfig({ paused: false, stop_until: null });
			await resolveAlertKey("global-stop").catch(() => {});
			await auditLog("admin", "workforce_resume", "Workforce resumed by admin");
			invalidateOpsSummary();
			return { ok: true, paused: false, stop_until: null };
		case "resume-worker": {
			// Manual unpause of a SUPERVISOR-paused worker (auto-paused after
			// repeated failures). Distinct from resume-agent, which only
			// clears the admin's manual paused_agents config list. Without
			// this action a supervisor-paused worker could never be resumed
			// from the UI — the AI Failures page pointed at a kill switch
			// that did not exist.
			const workerId = clean(
				String(body.agent_id || body.worker_id || ""),
				64,
			);
			if (!workerId) return { ok: false, error: "agent_id required" };
			const done = unpauseWorker(workerId);
			await auditLog(
				"admin",
				"workforce_resume_worker",
				`Resumed worker ${workerId}`,
			);
			invalidateOpsSummary();
			return { ok: true, ...done };
		}
		case "controls":
			return await workforceControls();
		case "pause-agent": {
			const agentId = clean(String(body.agent_id || ""), 64);
			if (!agentId) return { ok: false, error: "agent_id required" };
			const cfg = await getConfig();
			if (!(cfg.paused_agents || []).includes(agentId)) {
				await setConfig({
					paused_agents: [...(cfg.paused_agents || []), agentId],
				});
				await auditLog(
					"admin",
					"workforce_pause_agent",
					`Paused agent ${agentId}`,
				);
				emitEvent("workforce.control", {
					control: "pause_agent",
					agent: agentId,
				}).catch(() => {});
			}
			return { ok: true, paused_agents: (await getConfig()).paused_agents };
		}
		case "resume-agent": {
			const agentId = clean(String(body.agent_id || ""), 64);
			if (!agentId) return { ok: false, error: "agent_id required" };
			const cfg = await getConfig();
			if ((cfg.paused_agents || []).includes(agentId)) {
				await setConfig({
					paused_agents: (cfg.paused_agents || []).filter((x) => x !== agentId),
				});
				await auditLog(
					"admin",
					"workforce_resume_agent",
					`Resumed agent ${agentId}`,
				);
			}
			return { ok: true, paused_agents: (await getConfig()).paused_agents };
		}
		case "pause-division": {
			const division = clean(String(body.division || ""), 40);
			if (!division) return { ok: false, error: "division required" };
			const cfg = await getConfig();
			if (!(cfg.paused_divisions || []).includes(division)) {
				await setConfig({
					paused_divisions: [...(cfg.paused_divisions || []), division],
				});
				await auditLog(
					"admin",
					"workforce_pause_division",
					`Paused division ${division}`,
				);
				emitEvent("workforce.control", {
					control: "pause_division",
					division,
				}).catch(() => {});
			}
			return {
				ok: true,
				paused_divisions: (await getConfig()).paused_divisions,
			};
		}
		case "resume-division": {
			const division = clean(String(body.division || ""), 40);
			if (!division) return { ok: false, error: "division required" };
			const cfg = await getConfig();
			if ((cfg.paused_divisions || []).includes(division)) {
				await setConfig({
					paused_divisions: (cfg.paused_divisions || []).filter(
						(x) => x !== division,
					),
				});
				await auditLog(
					"admin",
					"workforce_resume_division",
					`Resumed division ${division}`,
				);
			}
			return {
				ok: true,
				paused_divisions: (await getConfig()).paused_divisions,
			};
		}
		case "set-controls": {
			// Partial update — only provided keys change. This is the maintenance
			// mode / delegation / disabled-tool surface (spec §24).
			const patch = {};
			if (typeof body.maintenance === "boolean")
				patch.maintenance = body.maintenance;
			if (typeof body.allow_handoffs === "boolean")
				patch.allow_handoffs = body.allow_handoffs;
			if (Array.isArray(body.disabled_tools)) {
				patch.disabled_tools = body.disabled_tools
					.map((t) => clean(String(t), 40))
					.filter(Boolean);
			}
			if (Object.keys(patch).length === 0)
				return { ok: false, error: "Nothing to update" };
			await setConfig(patch);
			await auditLog(
				"admin",
				"workforce_set_controls",
				`Controls updated: ${Object.keys(patch).join(", ")}`,
			);
			return { ok: true, controls: await workforceControls() };
		}
		case "global-stop": {
			const minutes = Math.max(1, Math.min(1440, Number(body.minutes) || 30));
			const stopUntil = new Date(
				Date.now() + minutes * 60 * 1000,
			).toISOString();
			await setConfig({ stop_until: stopUntil });
			await auditLog(
				"admin",
				"workforce_global_stop",
				`GLOBAL STOP engaged for ${minutes} min`,
			);
			// Emergency — raise a CRITICAL alert so the stop is visible + must be
			// acknowledged in the Ops Center, never silently applied.
			raiseAlert({
				severity: "critical",
				title: "GLOBAL WORKFORCE STOP ENGAGED",
				body: `All autonomous execution halted for ${minutes} minute(s). Monitoring, recovery, and audit continue.`,
				agent: "admin",
				key: "global-stop",
				evidence: `stop_until: ${stopUntil}`,
			}).catch(() => {});
			return { ok: true, stop_until: stopUntil, minutes };
		}
		case "agent-work": {
			return await agentWork(body.agent_id);
		}
		case "pending-approvals":
			return await pendingApprovals();
		case "alerts":
			return await listAlerts();
		case "acknowledge-alert": {
			const id = clean(String(body.id || ""), 64);
			const acked = await acknowledgeAlert(id);
			invalidateOpsSummary();
			return acked;
		}
		case "raise-alert": {
			const alert = await raiseAlert({
				severity: body.severity,
				title: body.title,
				body: body.body,
				agent: body.agent,
				key: body.key,
				evidence: body.evidence,
			});
			invalidateOpsSummary();
			return { ok: !!alert, alert };
		}
		case "privacy-scan": {
			// REAL on-demand PII scan — the Privacy Guardian employee performs its
			// actual job: query the real posts table, detect emails/phone numbers,
			// record a REAL agent_execution row, and raise a REAL admin alert the
			// moment personal information is exposed. No simulation.
			// NOTE: keep the email/phone patterns in sync with the scheduled
			// privacy-guardian / privacy-auditor tasks in _agents-cron.js.
			const { runAgent } = await import("./agents/_runner.js");
			const scanTask = async () => {
				const { data: recentPosts } = await supabase
					.from("posts")
					.select("id, title, description")
					.eq("deleted", false)
					.order("created_at", { ascending: false })
					.limit(100);
				const patterns = [
					{ kind: "email", re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
					{ kind: "phone", re: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
				];
				const findings = [];
				for (const p of recentPosts || []) {
					const text = `${p.title || ""} ${p.description || ""}`;
					for (const { kind, re } of patterns) {
						re.lastIndex = 0;
						let m;
						while ((m = re.exec(text)) && findings.length < 25) {
							findings.push({ post_id: p.id, kind, value: m[0].slice(0, 48) });
						}
					}
				}
				return {
					summary: `Privacy scan: ${recentPosts?.length || 0} posts scanned, ${findings.length} potential PII instance(s) detected.`,
					posts_scanned: recentPosts?.length || 0,
					pii_found: findings.length,
					findings: findings.slice(0, 25),
					status: findings.length > 0 ? "review_needed" : "clean",
				};
			};
			scanTask.description =
				"Privacy scan — detect emails/phones in public posts";
			const result = await runAgent(
				"privacy-guardian",
				"Privacy Guardian",
				"users",
				scanTask,
				"admin_command",
			);
			const output = result?.output || {};
			// Real admin notification — PII exposure deserves immediate attention.
			if (output.pii_found > 0) {
				await raiseAlert({
					severity: "medium",
					title: `${output.pii_found} potential PII detection(s) in public posts`,
					body: `Privacy Guardian scanned ${output.posts_scanned} posts and found ${output.pii_found} instance(s) of emails or phone numbers. Review the affected posts and redact if needed.`,
					agent: "privacy-guardian",
					key: `privacy-scan:${new Date().toISOString().slice(0, 13)}`,
					evidence: JSON.stringify((output.findings || []).slice(0, 3)),
				});
			}
			invalidateOpsSummary();
			return { ok: true, ...result, output };
		}
		case "retry-task": {
			const id = clean(String(body.id || ""), 64);
			const t = (await listTasks({ limit: 1000 })).find((x) => x.id === id);
			if (!t) return { ok: false, error: "Task not found" };
			await updateTask(id, {
				status: "queued",
				assigned_agent: null,
				error: null,
				attempts: 0,
				verification_status: "none",
				completed_at: null,
			});
			await auditLog("admin", "workforce_retry", `Retrying task ${id}`);
			return { ok: true, task_id: id };
		}
		case "reassign-task": {
			const id = clean(String(body.id || ""), 64);
			const agentId = clean(String(body.agent_id || ""), 64);
			const t = (await listTasks({ limit: 1000 })).find((x) => x.id === id);
			if (!t) return { ok: false, error: "Task not found" };
			await updateTask(id, {
				status: "queued",
				assigned_agent: agentId || null,
				heartbeat_at: null,
			});
			await auditLog(
				"admin",
				"workforce_reassign",
				`Reassigned task ${id} → ${agentId || "auto"}`,
			);
			return { ok: true, task_id: id };
		}
		case "cancel-task": {
			const id = clean(String(body.id || ""), 64);
			const t = (await listTasks({ limit: 1000 })).find((x) => x.id === id);
			if (!t) return { ok: false, error: "Task not found" };
			await updateTask(id, {
				status: "cancelled",
				completed_at: new Date().toISOString(),
			});
			await auditLog("admin", "workforce_cancel", `Cancelled task ${id}`);
			// A cancelled decision no longer needs approval — close its alert.
			await resolveAlertKey(
				`approval:${t.source_ref || t.title || t.task}`,
			).catch(() => {});
			return { ok: true, task_id: id };
		}
		case "approve-task": {
			const id = clean(String(body.id || ""), 64);
			const t = (await listTasks({ limit: 1000 })).find((x) => x.id === id);
			if (!t) return { ok: false, error: "Task not found" };
			if (t.status !== "blocked")
				return {
					ok: false,
					error: "Only blocked (awaiting-approval) tasks can be approved",
				};
			await updateTask(id, {
				status: "queued",
				error: null,
				verification_status: "none",
				heartbeat_at: null,
			});
			await auditLog(
				"admin",
				"workforce_approve",
				`Approved high-risk task ${id}`,
			);
			await appendApprovalDecision({
				task_id: id,
				title: t.title || t.task,
				decision: "approved",
				reason: null,
				risk_level: t.risk_level,
				source: t.source,
			});
			// The admin made the call — the approval alert is handled; close it.
			// Awaited so the auto-resolve is durable before the approve response returns.
			await resolveAlertKey(
				`approval:${t.source_ref || t.title || t.task}`,
			).catch(() => {});
			emitEvent("approval.approved", {
				task_id: id,
				title: t.title || t.task,
				priority: t.priority,
			}).catch(() => {});
			invalidateOpsSummary();

			// ═══ REAL WORK, NOW — not "approved and queued for the next cron" ═══
			// The approval is the green light: claim the task and kick off real
			// execution IMMEDIATELY (same pipeline as patrol: claim → runClaimed →
			// real verification). The Ops Center live stream + realtime updates
			// show it working → verifying → verified in real time. Fire-and-forget
			// (with error capture) so the HTTP response returns fast; the task row
			// is the source of truth for what happened.
			let executed = false;
			const agent = await findCapableAgent(t).catch(() => null);
			if (agent) {
				const claimed = await claimTask(id, agent.id).catch(() => null);
				if (claimed) {
				executed = true;
				runClaimed({ task: claimed, agent })
					.then((r) => {
						if (r.status === "failed") {
							console.error(
								`[workforce] immediate execution failed for ${id}:`,
								r.error,
							);
						}
					})
					.catch((e) =>
						console.error(
							`[workforce] immediate execution error for ${id}:`,
							e.message,
						),
					);
				}
			}
			return {
				ok: true,
				task_id: id,
				executed,
				message: executed
					? `Task approved — ${agent?.name || "agent"} is working on it now`
					: "Task approved — queued for the next patrol",
			};
		}
		case "reject-task": {
			const id = clean(String(body.id || ""), 64);
			const t = (await listTasks({ limit: 1000 })).find((x) => x.id === id);
			if (!t) return { ok: false, error: "Task not found" };
			if (t.status !== "blocked")
				return {
					ok: false,
					error: "Only blocked (awaiting-approval) tasks can be rejected",
				};
			const note = clean(String(body.reason || "Rejected by admin"), 300);
			await updateTask(id, {
				status: "cancelled",
				error: note,
				verification_status: "rejected",
				completed_at: new Date().toISOString(),
			});
			await auditLog(
				"admin",
				"workforce_reject",
				`Rejected high-risk task ${id}: ${note}`,
			);
			await appendApprovalDecision({
				task_id: id,
				title: t.title || t.task,
				decision: "rejected",
				reason: note,
				risk_level: t.risk_level,
				source: t.source,
			});
			await resolveAlertKey(
				`approval:${t.source_ref || t.title || t.task}`,
			).catch(() => {});
			emitEvent("approval.rejected", {
				task_id: id,
				title: t.title || t.task,
				reason: note,
			}).catch(() => {});
			invalidateOpsSummary();
			return { ok: true, task_id: id, message: "Task rejected and cancelled" };
		}
		case "approval-history":
			return await approvalHistory();
		case "escalate-report": {
			// Reports → Approval Center bridge: an admin (or the review pipeline)
			// pushes a specific report into the human-approval queue as a HIGH-risk
			// blocked task. Approve → the workforce executes real triage/mitigation.
			const rid = clean(String(body.id || ""), 40);
			if (!rid) return { ok: false, error: "Report id required" };
			const { data: report } = await supabase
				.from("reports")
				.select("*")
				.eq("id", rid)
				.maybeSingle();
			if (!report) return { ok: false, error: "Report not found" };
			let targetTitle = String(report.target_id || "target");
			try {
				if (report.target_type === "comment") {
					const { data: c } = await supabase
						.from("comments")
						.select("body")
						.eq("id", report.target_id)
						.maybeSingle();
					if (c?.body) targetTitle = String(c.body).slice(0, 60);
				} else if (report.target_type === "poll") {
					const { data: p } = await supabase
						.from("polls")
						.select("title")
						.eq("id", report.target_id)
						.maybeSingle();
					if (p?.title) targetTitle = String(p.title).slice(0, 60);
				} else {
					const { data: p } = await supabase
						.from("posts")
						.select("title")
						.eq("id", report.target_id)
						.maybeSingle();
					if (p?.title) targetTitle = String(p.title).slice(0, 60);
				}
			} catch {
				/* title is best-effort */
			}
			const task = await createTask({
				title: `Approval required: report on ${targetTitle.slice(0, 48)}`,
				description: `Admin escalated report ${rid} (${report.target_type} ${report.target_id}) for a high-risk moderation decision: "${clean(String(report.reason || ""), 100)}". Approve to execute, reject to dismiss.`,
				source: "report",
				source_ref: `escalated:${rid}`,
				priority: "high",
				risk_level: "high",
				required_capability: "report_triage",
				// decision:'hide' (posts only) + report_ids let applyApprovedDecision
				// execute the sanctioned moderation action on approval — approval is
				// never a no-op: it hides the target and resolves the linked report.
				input: {
					decision: report.target_type === "post" ? "hide" : undefined,
					report_id: rid,
					target_type: report.target_type,
					target_id: report.target_id,
					report_ids: report.target_type === "post" ? [rid] : undefined,
					reason: report.reason,
					escalated_by: "admin",
				},
				created_by: "admin",
			});
			if (!task)
				return {
					ok: false,
					error:
						"Already escalated (an open approval task exists for this report)",
				};
			await auditLog(
				"admin",
				"workforce_escalate_report",
				`Escalated report ${rid} to approval (${task.id})`,
			);
			emitEvent("approval.requested", {
				task_id: task.id,
				title: task.title,
				source: "report",
			}).catch(() => {});
			invalidateOpsSummary();
			return { ok: true, task_id: task.id, title: task.title };
		}
		case "escalate-post": {
			// Content review → Approval Center bridge: escalate a flagged/pending
			// post's moderation decision into the human-approval queue.
			const pid = clean(String(body.id || ""), 64);
			if (!pid) return { ok: false, error: "Post id required" };
			const { data: post } = await supabase
				.from("posts")
				.select("id,title,status,hidden,deleted")
				.eq("id", pid)
				.maybeSingle();
			if (!post) return { ok: false, error: "Post not found" };
			const task = await createTask({
				title: `Approval required: moderation decision for "${String(post.title || "untitled").slice(0, 48)}"`,
				description: `Post ${pid} (status: ${post.status || "unknown"}, hidden: ${!!post.hidden}) escalated from content review. High-risk moderation decision — approve to execute the policy action, reject to leave as-is.`,
				source: "moderation",
				source_ref: `moderate:${pid}`,
				priority: "high",
				risk_level: "high",
				required_capability: "content_moderation",
				// decision:'hide' is the sanctioned action — approving this task
				// really hides the post via applyApprovedDecision, then verifies it.
				input: {
					decision: "hide",
					target_type: "post",
					target_id: pid,
					post_id: pid,
					status: post.status,
					hidden: !!post.hidden,
					escalated_by: "admin",
				},
				created_by: "admin",
			});
			if (!task)
				return {
					ok: false,
					error:
						"Already escalated (an open approval task exists for this post)",
				};
			await auditLog(
				"admin",
				"workforce_escalate_post",
				`Escalated post ${pid} to approval (${task.id})`,
			);
			emitEvent("approval.requested", {
				task_id: task.id,
				title: task.title,
				source: "moderation",
			}).catch(() => {});
			invalidateOpsSummary();
			return { ok: true, task_id: task.id, title: task.title };
		}
		case "activity":
			// Real runtime activity log (same source the Command tab's live feed
			// reads) — a single source of truth for every surface.
			try {
				const { getRecentActivity } = await import("./agents/_runner.js");
				const list = await getRecentActivity(60);
				return {
					ok: true,
					activity: list.map((a) => ({
						agent_id: a.agent_id,
						action: a.action,
						severity: a.severity || "info",
						details: a.details || null,
						created_at: a.created_at,
					})),
				};
			} catch {
				return { ok: true, activity: [] };
			}

		case "impact":
			return await impactCenter();
		case "fabric-status":
		case "fabric-run":
			return await fabricProxy(action, body || {});
		case "ask-agent": {
			// One endpoint that always answers when it possibly can: the
			// external agent backend when configured, otherwise the built-in
			// engine (provider LLM + live ops context). Only fails honestly
			// when neither path can answer.
			const input = String(body?.input || "").slice(0, 2000);
			if (!input.trim())
				return { ok: false, error: "Ask something first — input is empty." };
			if (fabricBaseUrl()) return await fabricProxy("fabric-run", body || {});
			return await builtinAgentRun(input);
		}
		case "automation-status": {
			// Every deterministic worker + its last cron run. Powers the
			// OpsCenter Automations section — visible proof of automation.
			const { WORKERS, readLastRuns } = await import(
				"./_automation-registry.js"
			);
			const lastRuns = await readLastRuns(supabase);
			return {
				ok: true,
				workers: WORKERS.map((w) => ({ ...w, last: lastRuns[w.id] || null })),
			};
		}
		case "automation-run": {
			// Manual trigger: run one worker NOW and return its real result.
			// Same code path the cron uses — no shadow implementation.
			// Every failure carries worker + step + a non-empty message: the
			// UI used to show "unknown error" when a worker threw a non-Error
			// or returned {ok:false} with no error string. That ends here.
			const id = String(body?.worker || "");
			const { WORKERS, recordLastRun, formatRunError } = await import(
				"./_automation-registry.js"
			);
			const def = WORKERS.find((w) => w.id === id);
			if (!def)
				return {
					ok: false,
					error: `Unknown worker "${id}". Known: ${WORKERS.map((w) => w.id).join(", ")}`,
				};
			let mod = null;
			try {
				mod = await import(def.module);
			} catch (e) {
				const fail = formatRunError(id, "load", null, e);
				const last = await recordLastRun(supabase, id, {
					ok: false,
					error: fail.error,
				});
				return {
					ok: false,
					worker: id,
					step: fail.step,
					error: `${fail.error} (${def.module})`,
					last,
					duration_ms: 0,
				};
			}
			if (!mod || typeof mod[def.run] !== "function") {
				const fail = formatRunError(id, "load", null, `missing export ${def.run}`);
				const last = await recordLastRun(supabase, id, {
					ok: false,
					error: fail.error,
				});
				return {
					ok: false,
					worker: id,
					step: fail.step,
					error: `${fail.error} in ${def.module}`,
					last,
					duration_ms: 0,
				};
			}
			const started = Date.now();
			try {
				const result = await mod[def.run]();
				const last = await recordLastRun(supabase, id, result);
				const duration_ms = Date.now() - started;
				if (result?.ok === true)
					return { ok: true, worker: id, result, last, duration_ms };
				const fail = formatRunError(id, "run", result);
				return {
					ok: false,
					worker: id,
					step: fail.step,
					error: fail.error,
					result,
					last,
					duration_ms,
				};
			} catch (e) {
				const fail = formatRunError(id, "threw", null, e);
				const last = await recordLastRun(supabase, id, {
					ok: false,
					error: fail.error,
				});
				return {
					ok: false,
					worker: id,
					step: fail.step,
					error: fail.error,
					last,
					duration_ms: Date.now() - started,
				};
			}
		}
		case "quality":
			return await qualitySummary();
		case "quality-evaluate": {
			// Real trigger: re-derive every worker's scorecard from its
			// production ledger and persist it, then return the fresh view.
			const run = await runContinuousEvaluation();
			return { ok: true, run, ...(await qualitySummary()) };
		}
		case "quality-redteam": {
			// Real trigger: execute every adversarial case against the live
			// moderation engine, persist the run, return fresh results.
			// (Named redteam_run: qualitySummary() also carries a `redteam`
			// status block, which would overwrite a same-named run payload.)
			const redteamRun = await runRedTeam();
			return { ok: true, redteam_run: redteamRun, ...(await qualitySummary()) };
		}
		case "overnight-briefing": {
			return { ok: true, ...(await overnightBriefing()) };
		}
		default:
			return { ok: false, error: "Unknown workforce action: " + action };
	}
}

// ─── AI Quality — real evaluation / scorecard aggregate ─────────
// The real source is the continuous-learning engine: it derives each
// worker's scorecard from its production ledger (verified outcomes) and
// persists it. Nothing here is fabricated — workers with no evidence are
// reported as unmeasured, and an unknown aggregate is `null`, never a
// reassuring 0 (spec §anti-fantasy).
async function qualitySummary() {
	const [learning, evals, redteam] = await Promise.all([
		getLearningStatus(),
		getEvaluationHistory(20),
		getRedteamStatus().catch(() => null),
	]);
	const evaluation = learning?.evaluation || {};
	const results = Array.isArray(evaluation.results) ? evaluation.results : [];
	const cards = results.map((r) => r.scorecard).filter(Boolean);
	// `overall_health` is null when a worker has no measured dimension, so
	// the average is taken only over measured cards — never coerced to 0.
	const measured = cards.filter((c) => c.overall_health != null);
	const averageHealth = measured.length
		? Math.round(
				measured.reduce((sum, c) => sum + c.overall_health, 0) /
					measured.length,
			)
		: null;
	const totalCases = evals.reduce(
		(sum, e) => sum + (e?.summary?.total_cases || 0),
		0,
	);
	const totalPassed = evals.reduce(
		(sum, e) => sum + (e?.summary?.passed || 0),
		0,
	);
	const safetyViolations = evals.reduce(
		(sum, e) => sum + (e?.summary?.safety_violations || 0),
		0,
	);
	return {
		ok: true,
		scorecards: cards,
		workers: results,
		recent_evaluations: evals,
		evidence: learning?.evidence || null,
		memory: learning?.memory || null,
		versions: learning?.versions || {},
		summary: {
			workers_tracked: results.length,
			workers_measured: measured.length,
			workers_without_evidence: evaluation.workers_without_evidence ?? null,
			average_health: averageHealth,
			evaluations_run: evals.length,
			total_cases: totalCases,
			pass_rate:
				totalCases > 0 ? Math.round((totalPassed / totalCases) * 100) : null,
			safety_violations: safetyViolations,
			drift: evalDrift(evals),
		},
		training: {
			available_scenarios: TRAINING_SCENARIOS.length,
			scenario_categories: [
				...new Set(TRAINING_SCENARIOS.map((s) => s.category)),
			],
		},
		redteam: redteam || null,
		scorecard_source: evaluation.scorecard_source || "production_ledger",
		updated_at: new Date().toISOString(),
	};
}

// ─── Overnight briefing (spec §50: every number from real system data) ─
// Deterministic aggregation — no LLM, works with zero keys. Each item cites
// its source so the admin can verify it, never just trust it.
async function overnightBriefing() {
	const [health, supervisor, evals, redteam] = await Promise.all([
		workforceHealth().catch(() => null),
		Promise.resolve().then(() => getSupervisorSummary()),
		getEvaluationHistory(20).catch(() => []),
		getRedteamStatus().catch(() => null),
	]);
	// The ledger read fails soft inside workforceHealth, so a dead database
	// would otherwise report a reassuring 0 executions. Probe readability
	// once: UNKNOWN stays null, never 0 (spec §56).
	let ledgerReadable = true;
	try {
		await supabase.from("settings").select("key").limit(1);
	} catch {
		ledgerReadable = false;
	}
	let openReports = null;
	let approvals = null;
	try {
		const { count } = await supabase
			.from("reports")
			.select("*", { count: "exact", head: true })
			.eq("status", "open");
		openReports = count ?? 0;
	} catch {
		/* unknown stays null, never 0 */
	}
	try {
		const pa = await pendingApprovals();
		approvals = Array.isArray(pa?.approvals) ? pa.approvals.length : 0;
	} catch {
		/* unknown stays null */
	}
	const safetyViolations = (evals || []).reduce(
		(sum, e) => sum + (e?.summary?.safety_violations || 0),
		0,
	);
	const paused = supervisor?.paused_workers || [];
	const items = [
		{
			label: "Workforce executions (24h)",
			value: ledgerReadable ? (health?.total_executions_24h ?? null) : null,
			detail:
				!ledgerReadable || health == null
					? "ledger unreadable"
					: `${health.verified_success_24h ?? 0} verified ok · ${health.verified_failure_24h ?? 0} verified failed · ${health.budget_blocked_24h ?? 0} budget-blocked`,
			source: "workforce ledger",
		},
		{
			label: "Workers paused by supervisor",
			value: paused.length,
			detail:
				paused.length > 0
					? paused.join(", ")
					: "none quarantined",
			source: "supervisor",
		},
		{
			label: "Open reports",
			value: openReports,
			detail: "awaiting triage in Reports",
			source: "reports table",
		},
		{
			label: "Pending approvals",
			value: approvals,
			detail: "blocked tasks awaiting admin decision",
			source: "workforce tasks",
		},
		{
			label: "Evaluation safety violations",
			value: safetyViolations,
			detail: `across ${(evals || []).length} eval runs`,
			source: "evaluation ledger",
		},
		{
			label: "Red-team pass rate",
			value: redteam?.last_run?.pass_rate ?? null,
			detail: redteam?.last_run
				? `${redteam.last_run.passed}/${redteam.last_run.total} at ${redteam.last_run.run_at}`
				: "no run yet",
			source: "red-team ledger",
		},
	];
	return {
		window: "24h",
		generated_at: new Date().toISOString(),
		items,
		needs_attention: items.filter(
			(i) =>
				(i.label.includes("paused") && (i.value ?? 0) > 0) ||
				(i.label.includes("violations") && (i.value ?? 0) > 0) ||
				(i.label.includes("Red-team") && i.value != null && i.value < 100),
		).length,
	};
}

// Compare the newer half of the eval ledger against the older half.
// `evals` is newest-first. Returns null until there are enough runs to
// compare — an unknown drift is never reported as "stable".
function evalDrift(evals) {
	const rates = evals
		.map((e) => e?.summary?.success_rate)
		.filter((r) => typeof r === "number");
	if (rates.length < 4) return null;
	const half = Math.floor(rates.length / 2);
	const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
	const recentAvg = mean(rates.slice(0, half));
	const olderAvg = mean(rates.slice(half));
	const delta = Math.round(recentAvg - olderAvg);
	return {
		recent_success_rate: Math.round(recentAvg),
		previous_success_rate: Math.round(olderAvg),
		delta_pct: delta,
		direction: delta < 0 ? "degrading" : delta > 0 ? "improving" : "stable",
	};
}

// ─── NeMo Fabric backend proxy ──────────────────────────────────
// The real agent runtime lives in services/ (FastAPI). The browser never
// talks to it directly — this proxy keeps one authenticated, bounded,
// admin-gated path. The backend is OPTIONAL: it is only contacted when
// WORKFORCE_BASE_URL (or WORKFORCE_URL) is explicitly set. When unset the
// proxy returns {ok:false, configured:false} immediately — no localhost
// probe, no 45s wait, no localhost URL leaked into the UI. Unreachable
// configured backend → honest {ok:false}, never fake.
// Vercel kills this function at 60s, so the backend fetch is capped at 45s
// and callers must wait with a ≥55s client timeout.
const FABRIC_TIMEOUT_MS = 45000;

function fabricBaseUrl() {
	const raw = (
		process.env.WORKFORCE_BASE_URL ||
		process.env.WORKFORCE_URL ||
		""
	).trim();
	if (!raw) return null;
	return raw.replace(/\/+$/, "");
}

// ─── Built-in agent answer (no external backend needed) ────────
// Answers "Ask the agent" from the provider LLM with a live ops snapshot.
// Works with zero infrastructure beyond one provider key.
async function builtinAgentRun(input) {
	const { callLLMChain, hasUsableLLM } = await import("./_providers.js");
	if (!(await hasUsableLLM())) {
		return {
			ok: false,
			configured: false,
			backend: null,
			error:
				"No AI provider key is configured — add NVIDIA_API_KEY (or OpenAI/Anthropic/Groq) to enable answers. Tasks, patrols and evaluations below already run without one.",
		};
	}
	const [health, supervisor] = await Promise.all([
		workforceHealth().catch(() => null),
		Promise.resolve().then(() => getSupervisorSummary()),
	]);
	let openReports = null;
	let approvals = null;
	try {
		const { count } = await supabase
			.from("reports")
			.select("*", { count: "exact", head: true })
			.eq("status", "open");
		openReports = count ?? 0;
	} catch {
		/* unknown stays null */
	}
	try {
		const pa = await pendingApprovals();
		approvals = Array.isArray(pa?.approvals) ? pa.approvals.length : 0;
	} catch {
		/* unknown stays null */
	}
	const paused = supervisor?.paused_workers || [];
	const system =
		`You are the Voice Flow operations assistant. Answer the admin's question concisely, using these LIVE numbers; say "unknown" where the value is null rather than inventing.\n` +
		`Workforce executions (24h): ${health?.total_executions_24h ?? "unknown"} ` +
		`(verified ok ${health?.verified_success_24h ?? "?"}, failed ${health?.verified_failure_24h ?? "?"}). ` +
		`Paused workers: ${paused.length ? paused.join(", ") : "none"}. ` +
		`Open reports: ${openReports ?? "unknown"}. Pending approvals: ${approvals ?? "unknown"}. ` +
		`Current time: ${new Date().toISOString()}`;
	try {
		const r = await callLLMChain(system, input, [], "high");
		// Null means the whole chain failed over (congestion, cooldowns,
		// outages) — NOT a bad question. Say so; the old copy blamed the
		// question length ("try a shorter question") for a server-side outage.
		if (!r)
			return {
				ok: false,
				error:
					"All AI providers are busy or recovering from failures — wait about a minute and retry. Your question is fine; nothing was lost.",
			};
		const text = (r?.text || (typeof r === "string" ? r : "") || "").trim();
		if (!text)
			return { ok: false, error: "The model returned an empty answer — try a shorter question." };
		return {
			ok: true,
			status: "succeeded",
			response: text.slice(0, 4000),
			backend: "builtin",
			provider: r?.provider || null,
			model: r?.model || null,
		};
	} catch (err) {
		return { ok: false, error: `Built-in agent failed: ${err?.message || err}` };
	}
}

async function fabricProxy(action, args) {
	const base = fabricBaseUrl();
	if (!base) {
		return {
			ok: false,
			configured: false,
			disabled: true,
			backend: null,
			error:
				"Agent backend not configured — set WORKFORCE_BASE_URL to enable live agent runs. Built-in workforce (tasks, patrols, evaluations) works without it.",
		};
	}
	const path =
		action === "fabric-status"
			? "/api/workforce/fabric/status"
			: "/api/workforce/fabric/run";
	let body;
	if (action === "fabric-status") {
		body = undefined;
	} else {
		const input = String(args.input || "").slice(0, 2000);
		if (!input.trim())
			return { ok: false, error: "Ask something first — input is empty." };
		body = JSON.stringify({
			input,
			task_title: String(args.task_title || "ops-console-run").slice(0, 80),
			system_instruction:
				typeof args.system_instruction === "string"
					? args.system_instruction.slice(0, 2000)
					: null,
			timeout_seconds: Math.max(
				10,
				Math.min(Number(args.timeout_seconds) || 45, 45),
			),
			max_turns: Math.max(1, Math.min(Number(args.max_turns) || 3, 10)),
		});
	}
	const controller = new AbortController();
	const kill = setTimeout(() => controller.abort(), FABRIC_TIMEOUT_MS);
	try {
		// FIX #4 (AUDIT): workforce API now requires an admin token.
		// Build headers conditionally — a fetch header with value
		// `undefined` throws before the request is even sent.
		const wfHeaders = { "Content-Type": "application/json" };
		if (process.env.ADMIN_TOKEN)
			wfHeaders["X-Admin-Token"] = process.env.ADMIN_TOKEN;

		const res = await fetch(`${base}${path}`, {
			method: action === "fabric-status" ? "GET" : "POST",
			headers: wfHeaders,
			body,
			signal: controller.signal,
		});
		const data = await res.json().catch(() => ({}));
		return { ok: res.ok, backend: base, ...(data || {}) };
	} catch (err) {
		return {
			ok: false,
			unavailable: true,
			configured: true,
			backend: base,
			error:
				err?.name === "AbortError"
					? "Agent backend timed out — it may still be working; try a shorter question."
					: `Agent backend unreachable at ${base} — check the service or update WORKFORCE_BASE_URL.`,
		};
	} finally {
		clearTimeout(kill);
	}
}

// ─── HTTP handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (!(await isAdmin(req)))
		return res.status(403).json({ error: "Admin only" });

	const action =
		req.method === "GET"
			? req.query.action || "overview"
			: req.body?.action || "overview";
	try {
		const result = await command(action, req.body || req.query || {});
		return res.status(200).json(result);
	} catch (err) {
		console.error("[workforce] Error:", err.message);
		return sanitizeError(res, err, "workforce");
	}
}

// Also exported for cron + command-center reuse (+ verifyOutcomes/maybeHandoff
// for observability and the live outcome-verification proof).
export {
	agentWork,
	applyApprovedDecision,
	command as workforceCommand,
	createTask,
	discoverWork,
	getOverview,
	impactCenter,
	isStopActive,
	listTasks,
	maybeHandoff,
	measureImpact,
	patrol,
	pendingApprovals,
	recoverStale,
	updateTask,
	verifyOutcomes,
	workforceControls,
};
