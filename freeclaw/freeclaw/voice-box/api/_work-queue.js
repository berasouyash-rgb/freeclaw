// ═══════════════════════════════════════════════════════════════════
// Durable Work Queue — SPEC §5
// ═══════════════════════════════════════════════════════════════════
// Never depend on an in-memory queue for critical work: every job
// lives in the settings KV row `work_queue` (same durable read-modify-
// write pattern as _ops-events.js / _incidents.js), so state survives
// restarts and is independently re-readable by the admin UI and by
// verification workers.
//
// States (SPEC §5, all 11, enforced by TRANSITIONS — illegal moves
// throw, terminal states have no outgoing edges):
//   PENDING → CLAIMED → RUNNING → VERIFYING → COMPLETED
//   WAITING (dependencies) · RETRYING (backoff) · BLOCKED (dead dep)
//   FAILED (dead-letter) · QUARANTINED · CANCELLED
//
// Guarantees (SPEC §5):
//   - idempotency/deduplication: enqueueJob requires `idempotencyKey`;
//     a repeat returns {enqueued:false, reason:"duplicate"} — 1 record.
//   - retries + backoff: failJob increments attempts and either moves
//     to RETRYING with nextRetryAt = now + min(base·factor^(n-1), max)
//     or, at maxAttempts, to FAILED (dead-letter, reason retained).
//   - dead-letter handling: listDeadLetters() exposes FAILED jobs with
//     their failure reason + attempt count; FAILED rows are never
//     trimmed from the store.
//   - worker crash / orphan recovery: recoverStaleJobs() re-fails jobs
//     in CLAIMED/RUNNING whose liveness anchor (heartbeat → claimedAt
//     → startedAt → createdAt) is older than the job's timeout.
//   - orphan dependency recovery: promoteWaiting() promotes WAITING
//     jobs whose dependencies all COMPLETED, and BLOCKs jobs whose
//     dependencies FAILED/CANCELLED/QUARANTINED (reason names the dep).
//   - backoff release: releaseRetried() moves RETRYING jobs whose
//     nextRetryAt has passed back to PENDING (only PENDING is claimable,
//     so backoff genuinely gates re-execution).
//   - bounded storage: saves trim the OLDEST COMPLETED/CANCELLED rows
//     past MAX_JOBS; active, RETRYING, and FAILED rows are never
//     trimmed (correctness over bound).
//
// Honest boundary (documented, not hidden): the settings KV write is a
// read-modify-write, not a conditional update — two concurrent claim
// attempts could both observe PENDING. Claim ownership is recorded on
// the row (worker + claimedAt) so a double-claim is visible in
// evidence, and the production cron is the single claimant today.
//
// Every persistence call checks the write error and THROWS — a failed
// write never looks like success.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const SETTINGS_KEY = "work_queue";
const MAX_JOBS = 500;

/** SPEC §5's 11 durable states. */
export const QUEUE_STATES = Object.freeze([
	"PENDING",
	"CLAIMED",
	"RUNNING",
	"WAITING",
	"RETRYING",
	"VERIFYING",
	"COMPLETED",
	"FAILED",
	"BLOCKED",
	"QUARANTINED",
	"CANCELLED",
]);

/** SPEC §5's required job fields — every built job carries all of them. */
export const JOB_FIELDS = Object.freeze([
	"id",
	"type",
	"priority",
	"attempts",
	"maxAttempts",
	"createdAt",
	"startedAt",
	"completedAt",
	"worker",
	"traceId",
	"parentJobId",
	"dependencies",
	"timeout",
	"retryPolicy",
	"evidence",
	"result",
	"failureReason",
]);

/** Job priority ladder — matches the agent_tasks queue vocabulary. */
export const JOB_PRIORITIES = Object.freeze(["critical", "high", "medium", "low"]);

/**
 * Legal state transitions (SPEC §5). Same-state "refresh" moves are
 * handled by transition() and are not listed here. COMPLETED, FAILED,
 * and CANCELLED are terminal.
 */
export const TRANSITIONS = Object.freeze({
	PENDING: Object.freeze(["CLAIMED", "WAITING", "BLOCKED", "QUARANTINED", "CANCELLED"]),
	CLAIMED: Object.freeze(["RUNNING", "PENDING", "RETRYING", "FAILED", "CANCELLED"]),
	RUNNING: Object.freeze([
		"VERIFYING", "PENDING", "WAITING", "RETRYING",
		"FAILED", "BLOCKED", "QUARANTINED", "CANCELLED",
	]),
	WAITING: Object.freeze(["PENDING", "BLOCKED", "CANCELLED", "QUARANTINED"]),
	RETRYING: Object.freeze(["PENDING", "FAILED", "CANCELLED"]),
	VERIFYING: Object.freeze(["COMPLETED", "RETRYING", "FAILED", "CANCELLED"]),
	COMPLETED: Object.freeze([]),
	FAILED: Object.freeze([]),
	BLOCKED: Object.freeze(["PENDING", "CANCELLED"]),
	QUARANTINED: Object.freeze(["PENDING", "CANCELLED"]),
	CANCELLED: Object.freeze([]),
});

export const DEFAULT_RETRY_POLICY = Object.freeze({
	backoffBaseMs: 1000,
	backoffFactor: 2,
	backoffMaxMs: 300000,
});

export const DEFAULT_TIMEOUT_MS = 300000;
export const DEFAULT_MAX_ATTEMPTS = 3;

function nowIso() {
	return new Date().toISOString();
}

function isIsoString(v) {
	return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

/**
 * Build a fully-populated job (SPEC §5 field list) or throw.
 * Required: type (non-empty string), idempotencyKey (non-empty string).
 */
export function buildJob(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("buildJob: input object required");
	}
	const {
		type,
		idempotencyKey,
		priority = "medium",
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		timeout = DEFAULT_TIMEOUT_MS,
		dependencies = [],
		parentJobId = null,
		retryPolicy,
		worker = null,
		evidence,
		result = null,
		input: jobInput,
	} = input;

	if (typeof type !== "string" || !type.trim()) {
		throw new Error("buildJob: type is required");
	}
	if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
		throw new Error("buildJob: idempotencyKey is required");
	}
	if (!JOB_PRIORITIES.includes(priority)) {
		throw new Error(`buildJob: unknown priority: ${String(priority)}`);
	}
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new Error(`buildJob: maxAttempts must be an integer >= 1: ${String(maxAttempts)}`);
	}
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error(`buildJob: timeout must be a positive number: ${String(timeout)}`);
	}
	if (!Array.isArray(dependencies) || dependencies.some((d) => typeof d !== "string" || !d)) {
		throw new Error("buildJob: dependencies must be an array of job ids");
	}
	if (parentJobId !== null && (typeof parentJobId !== "string" || !parentJobId)) {
		throw new Error("buildJob: parentJobId must be a job id or null");
	}
	if (jobInput !== undefined && (typeof jobInput !== "object" || jobInput === null || Array.isArray(jobInput))) {
		throw new Error("buildJob: input payload must be an object");
	}
	if (evidence !== undefined && !Array.isArray(evidence)) {
		throw new Error("buildJob: evidence must be an array");
	}

	let policy = DEFAULT_RETRY_POLICY;
	if (retryPolicy !== undefined) {
		if (typeof retryPolicy !== "object" || retryPolicy === null || Array.isArray(retryPolicy)) {
			throw new Error("buildJob: retryPolicy must be an object");
		}
		const base = retryPolicy.backoffBaseMs ?? DEFAULT_RETRY_POLICY.backoffBaseMs;
		const factor = retryPolicy.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor;
		const max = retryPolicy.backoffMaxMs ?? DEFAULT_RETRY_POLICY.backoffMaxMs;
		if (!Number.isFinite(base) || base <= 0) {
			throw new Error(`buildJob: retryPolicy.backoffBaseMs must be > 0: ${String(base)}`);
		}
		if (!Number.isFinite(factor) || factor < 1) {
			throw new Error(`buildJob: retryPolicy.backoffFactor must be >= 1: ${String(factor)}`);
		}
		if (!Number.isFinite(max) || max < base) {
			throw new Error(`buildJob: retryPolicy.backoffMaxMs must be >= backoffBaseMs: ${String(max)}`);
		}
		policy = Object.freeze({ backoffBaseMs: base, backoffFactor: factor, backoffMaxMs: max });
	}

	const timestamp = nowIso();
	return {
		id: crypto.randomUUID(),
		type: type.trim(),
		idempotencyKey: idempotencyKey.trim(),
		state: "PENDING",
		priority,
		attempts: 0,
		maxAttempts,
		createdAt: timestamp,
		updatedAt: timestamp,
		startedAt: null,
		claimedAt: null,
		completedAt: null,
		heartbeatAt: null,
		nextRetryAt: null,
		worker: worker === null ? null : String(worker),
		traceId: input.traceId !== undefined ? String(input.traceId) : crypto.randomUUID(),
		parentJobId,
		dependencies,
		timeout,
		retryPolicy: policy,
		evidence: evidence ? [...evidence] : [],
		result,
		failureReason: null,
		input: jobInput ?? {},
	};
}

/** Exponential backoff for the n-th attempt: min(base·factor^(n-1), max). */
export function backoffDelayMs(retryPolicy, attempts) {
	const policy = retryPolicy ?? DEFAULT_RETRY_POLICY;
	const exponent = Math.max(1, attempts) - 1;
	return Math.min(policy.backoffBaseMs * Math.pow(policy.backoffFactor, exponent), policy.backoffMaxMs);
}

/** Throws on an illegal state change; same-state refresh is allowed. */
export function assertTransition(from, to) {
	if (from === to) return to;
	if (!QUEUE_STATES.includes(from) || !QUEUE_STATES.includes(to)) {
		throw new Error(`invalid transition: unknown state ${String(from)} → ${String(to)}`);
	}
	if (!TRANSITIONS[from].includes(to)) {
		throw new Error(`invalid transition: ${from} → ${to}`);
	}
	return to;
}

async function loadQueue() {
	const { data, error } = await supabase
		.from("settings")
		.select("value")
		.eq("key", SETTINGS_KEY)
		.maybeSingle();
	if (error) {
		throw new Error(`work_queue read failed: ${error.message ?? String(error)}`);
	}
	// Deep-copy: mutations only ever reach the store through saveQueue's
	// checked write — a failed save must leave the stored queue untouched.
	const jobs =
		data?.value && Array.isArray(data.value.jobs)
			? JSON.parse(JSON.stringify(data.value.jobs))
			: [];
	return { jobs, rowExists: Boolean(data) };
}

/** Trim oldest COMPLETED/CANCELLED past MAX_JOBS; active/FAILED kept. */
function trimQueue(jobs) {
	while (jobs.length > MAX_JOBS) {
		let idx = -1;
		for (let i = 0; i < jobs.length; i++) {
			if (jobs[i].state === "COMPLETED" || jobs[i].state === "CANCELLED") {
				idx = i;
				break;
			}
		}
		if (idx === -1) break; // nothing safely trimmable — keep correctness over bound
		jobs.splice(idx, 1);
	}
	return jobs;
}

async function saveQueue(jobs, rowExists) {
	const value = { jobs: trimQueue(jobs), updated_at: nowIso() };
	const result = rowExists
		? await supabase.from("settings").update({ value }).eq("key", SETTINGS_KEY)
		: await supabase.from("settings").insert({ key: SETTINGS_KEY, value });
	if (result?.error) {
		throw new Error(`work_queue write failed: ${result.error.message ?? String(result.error)}`);
	}
	return value.jobs;
}

function mustFind(jobs, id) {
	const job = jobs.find((j) => j.id === id);
	if (!job) throw new Error(`work_queue: no such job: ${String(id)}`);
	return job;
}

/**
 * Enqueue a job. Idempotent + deduplicating: a repeat idempotencyKey
 * returns the existing job without storing a second record.
 * Jobs with dependencies that are not all COMPLETED start WAITING.
 */
export async function enqueueJob(input) {
	const job = buildJob(input);
	const { jobs, rowExists } = await loadQueue();
	const existing = jobs.find((j) => j.idempotencyKey === job.idempotencyKey);
	if (existing) {
		return { enqueued: false, reason: "duplicate", job: existing };
	}
	if (job.dependencies.length > 0) {
		job.state = "WAITING";
	}
	jobs.push(job);
	await saveQueue(jobs, rowExists);
	return { enqueued: true, job };
}

/**
 * Claim the highest-priority oldest PENDING job for a worker.
 * Only PENDING is claimable — RETRYING jobs must pass backoff release.
 * @returns {{claimed: boolean, job?: object}}
 */
export async function enqueueClaim(worker, { type } = {}) {
	if (typeof worker !== "string" || !worker.trim()) {
		throw new Error("claimJob: worker is required");
	}
	const { jobs, rowExists } = await loadQueue();
	const rank = (p) => JOB_PRIORITIES.indexOf(p);
	const candidates = jobs
		.filter((j) => j.state === "PENDING" && (type === undefined || j.type === type))
		.sort((a, b) => rank(a.priority) - rank(b.priority) || a.createdAt.localeCompare(b.createdAt));
	if (candidates.length === 0) {
		return { claimed: false };
	}
	const job = candidates[0];
	assertTransition(job.state, "CLAIMED");
	const timestamp = nowIso();
	job.state = "CLAIMED";
	job.worker = worker.trim();
	job.claimedAt = timestamp;
	job.heartbeatAt = timestamp;
	job.updatedAt = timestamp;
	await saveQueue(jobs, rowExists);
	return { claimed: true, job };
}

/** CLAIMED → RUNNING (owner only). startedAt records first attempt start. */
export async function startJob(id, worker) {
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	if (job.worker !== worker) {
		throw new Error(`work_queue: job ${id} is not claimed by "${String(worker)}"`);
	}
	assertTransition(job.state, "RUNNING");
	const timestamp = nowIso();
	job.state = "RUNNING";
	if (job.startedAt === null) job.startedAt = timestamp;
	job.heartbeatAt = timestamp;
	job.updatedAt = timestamp;
	await saveQueue(jobs, rowExists);
	return job;
}

/** Liveness ping — owner only, CLAIMED or RUNNING. */
export async function heartbeatJob(id, worker) {
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	if (job.worker !== worker) {
		throw new Error(`work_queue: job ${id} is not claimed by "${String(worker)}"`);
	}
	if (job.state !== "CLAIMED" && job.state !== "RUNNING") {
		throw new Error(`work_queue: heartbeat not allowed in state ${job.state}`);
	}
	job.heartbeatAt = nowIso();
	job.updatedAt = job.heartbeatAt;
	await saveQueue(jobs, rowExists);
	return job;
}

/**
 * RUNNING → VERIFYING: the worker hands over produced result + evidence.
 * Evidence is mandatory — a completion claim without evidence throws.
 */
export async function submitVerification(id, { worker, evidence, result }) {
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	if (job.worker !== worker) {
		throw new Error(`work_queue: job ${id} is not claimed by "${String(worker)}"`);
	}
	assertTransition(job.state, "VERIFYING");
	if (!Array.isArray(evidence) || evidence.length === 0) {
		throw new Error("work_queue: submitVerification requires non-empty evidence");
	}
	const timestamp = nowIso();
	job.state = "VERIFYING";
	job.evidence = [...job.evidence, ...evidence];
	if (result !== undefined) job.result = result;
	job.updatedAt = timestamp;
	job.heartbeatAt = timestamp;
	await saveQueue(jobs, rowExists);
	return job;
}

/**
 * VERIFYING → COMPLETED (passed) or the retry/dead-letter path (failed).
 * Independent verification is the only path to COMPLETED.
 */
export async function resolveVerification(id, { passed, failureReason, worker }) {
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	if (worker !== undefined && job.worker !== worker) {
		throw new Error(`work_queue: job ${id} is not claimed by "${String(worker)}"`);
	}
	assertTransition(job.state, "COMPLETED");
	if (passed) {
		const timestamp = nowIso();
		job.state = "COMPLETED";
		job.completedAt = timestamp;
		job.updatedAt = timestamp;
		job.failureReason = null;
		await saveQueue(jobs, rowExists);
		return job;
	}
	if (typeof failureReason !== "string" || !failureReason.trim()) {
		throw new Error("work_queue: resolveVerification(false) requires failureReason");
	}
	return applyFailure(jobs, rowExists, job, failureReason);
}

/**
 * Fail the current attempt (owner, or system recovery with {system:true}).
 * Increments attempts → RETRYING with backoff, or FAILED dead-letter
 * once attempts reaches maxAttempts (reason retained either way).
 */
export async function failJob(id, failureReason, { worker, system = false } = {}) {
	if (typeof failureReason !== "string" || !failureReason.trim()) {
		throw new Error("work_queue: failJob requires failureReason");
	}
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	if (!system && job.worker !== worker) {
		throw new Error(`work_queue: job ${id} is not claimed by "${String(worker)}"`);
	}
	return applyFailure(jobs, rowExists, job, failureReason);
}

async function applyFailure(jobs, rowExists, job, failureReason) {
	const from = job.state;
	const timestamp = nowIso();
	job.attempts += 1;
	job.failureReason = failureReason.trim();
	job.worker = null;
	job.heartbeatAt = null;
	if (job.attempts >= job.maxAttempts) {
		assertTransition(from, "FAILED");
		job.state = "FAILED";
		job.nextRetryAt = null;
	} else {
		assertTransition(from, "RETRYING");
		job.state = "RETRYING";
		job.nextRetryAt = new Date(
			Date.now() + backoffDelayMs(job.retryPolicy, job.attempts),
		).toISOString();
	}
	job.updatedAt = timestamp;
	await saveQueue(jobs, rowExists);
	return job;
}

/** Owner hands a CLAIMED/RUNNING job back to PENDING without burning an attempt. */
export async function releaseJob(id, { worker }) {
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	if (job.worker !== worker) {
		throw new Error(`work_queue: job ${id} is not claimed by "${String(worker)}"`);
	}
	assertTransition(job.state, "PENDING");
	const timestamp = nowIso();
	job.state = "PENDING";
	job.worker = null;
	job.claimedAt = null;
	job.heartbeatAt = null;
	job.updatedAt = timestamp;
	await saveQueue(jobs, rowExists);
	return job;
}

/** RUNNING → BLOCKED with a human-readable reason (safety gate). */
export async function blockJob(id, reason) {
	return changeHoldState(id, "BLOCKED", reason);
}

/** → QUARANTINED with a human-readable reason (safety ladder). */
export async function quarantineJob(id, reason) {
	return changeHoldState(id, "QUARANTINED", reason);
}

async function changeHoldState(id, target, reason) {
	if (typeof reason !== "string" || !reason.trim()) {
		throw new Error(`work_queue: ${target.toLowerCase()} requires a reason`);
	}
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	assertTransition(job.state, target);
	const timestamp = nowIso();
	job.state = target;
	job.failureReason = reason.trim();
	job.worker = null;
	job.heartbeatAt = null;
	job.updatedAt = timestamp;
	await saveQueue(jobs, rowExists);
	return job;
}

/** BLOCKED → PENDING (operator release). */
export async function unblockJob(id) {
	return releaseHold(id, "BLOCKED");
}

/** QUARANTINED → PENDING (operator release). */
export async function releaseQuarantine(id) {
	return releaseHold(id, "QUARANTINED");
}

async function releaseHold(id, heldState) {
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	assertTransition(job.state, "PENDING");
	if (job.state !== heldState) {
		throw new Error(`work_queue: job ${id} is ${job.state}, not ${heldState}`);
	}
	const timestamp = nowIso();
	job.state = "PENDING";
	job.failureReason = null;
	job.updatedAt = timestamp;
	await saveQueue(jobs, rowExists);
	return job;
}

/** → CANCELLED with a human-readable reason (operator/safety). */
export async function cancelJob(id, reason) {
	if (typeof reason !== "string" || !reason.trim()) {
		throw new Error("work_queue: cancel requires a reason");
	}
	const { jobs, rowExists } = await loadQueue();
	const job = mustFind(jobs, id);
	assertTransition(job.state, "CANCELLED");
	const timestamp = nowIso();
	job.state = "CANCELLED";
	job.failureReason = reason.trim();
	job.worker = null;
	job.heartbeatAt = null;
	job.updatedAt = timestamp;
	await saveQueue(jobs, rowExists);
	return job;
}

/**
 * RETRYING jobs whose backoff elapsed → PENDING (claimable again).
 * No-op (no write) when nothing is due. @returns {number} released
 */
export async function releaseRetried() {
	const { jobs, rowExists } = await loadQueue();
	const now = Date.now();
	let released = 0;
	for (const job of jobs) {
		if (job.state !== "RETRYING") continue;
		if (!job.nextRetryAt || Date.parse(job.nextRetryAt) > now) continue;
		assertTransition(job.state, "PENDING");
		job.state = "PENDING";
		job.nextRetryAt = null;
		job.updatedAt = nowIso();
		released += 1;
	}
	if (released > 0) await saveQueue(jobs, rowExists);
	return released;
}

/**
 * Worker crash recovery: CLAIMED/RUNNING jobs with a liveness anchor
 * older than the job's timeout are failed like any other attempt
 * (burns an attempt → RETRYING or dead-letter). Orphan dependency
 * recovery also lives in promoteWaiting().
 * No-op (no write) when nothing is stale. @returns {number} recovered
 */
export async function recoverStaleJobs() {
	const { jobs, rowExists } = await loadQueue();
	const now = Date.now();
	let recovered = 0;
	for (const job of jobs) {
		if (job.state !== "CLAIMED" && job.state !== "RUNNING") continue;
		const anchor = job.heartbeatAt ?? job.claimedAt ?? job.startedAt ?? job.createdAt;
		const anchorMs = isIsoString(anchor) ? Date.parse(anchor) : NaN;
		const limit = Number.isFinite(job.timeout) && job.timeout > 0 ? job.timeout : DEFAULT_TIMEOUT_MS;
		if (!Number.isFinite(anchorMs) || now - anchorMs <= limit) continue;
		await applyFailure(jobs, rowExists, job, "stale claim recovered (worker crash/orphan)");
		recovered += 1;
	}
	if (recovered > 0) {
		// applyFailure already saved per job; nothing extra to persist here.
	}
	return recovered;
}

/**
 * Dependency sweep: all deps COMPLETED → PENDING; any dep
 * FAILED/CANCELLED/QUARANTINED → BLOCKED (reason names the dep);
 * missing/in-flight deps keep the job WAITING.
 * No-op (no write) when nothing changes. @returns {{promoted:number, blocked:number}}
 */
export async function promoteWaiting() {
	const { jobs, rowExists } = await loadQueue();
	const byId = new Map(jobs.map((j) => [j.id, j]));
	let promoted = 0;
	let blocked = 0;
	for (const job of jobs) {
		if (job.state !== "WAITING" || job.dependencies.length === 0) continue;
		const deps = job.dependencies.map((depId) => byId.get(depId));
		const dead = deps.find(
			(d) => d && (d.state === "FAILED" || d.state === "CANCELLED" || d.state === "QUARANTINED"),
		);
		if (dead) {
			assertTransition(job.state, "BLOCKED");
			job.state = "BLOCKED";
			job.failureReason = `dependency ${dead.id} is ${dead.state}`;
			job.updatedAt = nowIso();
			blocked += 1;
			continue;
		}
		if (deps.every((d) => d && d.state === "COMPLETED")) {
			assertTransition(job.state, "PENDING");
			job.state = "PENDING";
			job.failureReason = null;
			job.updatedAt = nowIso();
			promoted += 1;
		}
	}
	if (promoted > 0 || blocked > 0) await saveQueue(jobs, rowExists);
	return { promoted, blocked };
}

/** Single job by id, or null (independent read-back). */
export async function getJob(id) {
	const { jobs } = await loadQueue();
	return jobs.find((j) => j.id === id) ?? null;
}

/**
 * Independent read-back with filters; newest first.
 * Unknown `state` throws (UNKNOWN is not a filter).
 */
export async function listJobs({ state, type, worker, limit } = {}) {
	if (state !== undefined && !QUEUE_STATES.includes(state)) {
		throw new Error(`work_queue: unknown state: ${String(state)}`);
	}
	const { jobs } = await loadQueue();
	let out = jobs;
	if (state !== undefined) out = out.filter((j) => j.state === state);
	if (type !== undefined) out = out.filter((j) => j.type === type);
	if (worker !== undefined) out = out.filter((j) => j.worker === worker);
	const n = limit === undefined ? 100 : Number(limit);
	if (!Number.isFinite(n) || n <= 0) return [];
	return out.slice(-n).reverse();
}

/** Dead-letter exposure: FAILED jobs with reason + attempt count. */
export async function listDeadLetters() {
	const { jobs } = await loadQueue();
	return jobs
		.filter((j) => j.state === "FAILED")
		.map((j) => ({
			id: j.id,
			type: j.type,
			attempts: j.attempts,
			maxAttempts: j.maxAttempts,
			failureReason: j.failureReason,
			createdAt: j.createdAt,
			updatedAt: j.updatedAt,
		}));
}

/** Per-state counts for every one of the 11 states + total. */
export async function queueStats() {
	const { jobs } = await loadQueue();
	const stats = { total: jobs.length };
	for (const s of QUEUE_STATES) stats[s] = 0;
	for (const job of jobs) stats[job.state] = (stats[job.state] ?? 0) + 1;
	return stats;
}

// ───────────────────────────────────────────────────────────────────
// Queue Recovery Worker (roster #33) — the registry's Class-A general
// sweep over the durable queue: due backoff releases, stale-claim
// recovery, and dependency promotion (each via this module's own
// bounded functions), then an independent re-read verifying the
// recovery actually held. Zero-arg (the cron loop calls the registry
// run with no arguments).
// ───────────────────────────────────────────────────────────────────
export async function runQueueRecovery({ nowMs = Date.now() } = {}) {
	// 1. Real action: the module's own bounded recovery passes.
	let released = 0;
	let recovered = 0;
	let promoted = 0;
	let blocked = 0;
	try {
		released = await releaseRetried();
		recovered = await recoverStaleJobs();
		const dep = await promoteWaiting();
		promoted = dep.promoted;
		blocked = dep.blocked;
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}

	// 2. Independent verification: a fresh re-read must show no stuck work
	//    remains under this module's own detection rules. A leftover stuck
	//    job is reported honestly (verified: false), never smoothed over.
	const now = nowMs;
	const { jobs } = await loadQueue();
	const byId = new Map(jobs.map((j) => [j.id, j]));
	const stuck = [];
	for (const job of jobs) {
		if (
			job.state === "RETRYING" &&
			job.nextRetryAt &&
			Date.parse(job.nextRetryAt) <= now
		)
			stuck.push({ id: job.id, reason: "due backoff not released" });
		if (job.state === "CLAIMED" || job.state === "RUNNING") {
			const anchor = job.heartbeatAt ?? job.claimedAt ?? job.startedAt ?? job.createdAt;
			const anchorMs = isIsoString(anchor) ? Date.parse(anchor) : NaN;
			const limit =
				Number.isFinite(job.timeout) && job.timeout > 0
					? job.timeout
					: DEFAULT_TIMEOUT_MS;
			if (!Number.isFinite(anchorMs) || now - anchorMs > limit)
				stuck.push({ id: job.id, reason: `stale ${job.state} claim not recovered` });
		}
		if (job.state === "WAITING" && job.dependencies.length > 0) {
			const deps = job.dependencies.map((depId) => byId.get(depId));
			const dead = deps.find(
				(d) =>
					d &&
					(d.state === "FAILED" || d.state === "CANCELLED" || d.state === "QUARANTINED"),
			);
			if (dead)
				stuck.push({ id: job.id, reason: `dead dependency ${dead.id} not blocked` });
			if (deps.every((d) => d && d.state === "COMPLETED"))
				stuck.push({ id: job.id, reason: "completed dependencies not promoted" });
		}
	}

	// 3. Advisory row when the sweep changed real state (best-effort).
	if (released > 0 || recovered > 0 || promoted > 0 || blocked > 0) {
		try {
			await supabase.from("activity_logs").insert({
				actor: "worker:queue-recovery",
				action: "queue_recovery_applied",
				detail: JSON.stringify({ released, recovered, promoted, blocked }).slice(0, 500),
			});
		} catch {
			/* advisory; a failed log must not fabricate evidence */
		}
	}

	return {
		ok: true,
		verified: stuck.length === 0,
		released,
		recovered,
		promoted,
		blocked,
		stuck: stuck.slice(0, 10),
	};
}
