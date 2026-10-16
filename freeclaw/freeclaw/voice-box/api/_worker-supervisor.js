// ═══════════════════════════════════════════════════════════════════
// WORKER SUPERVISOR — Monitors, protects, and recovers workers
// ═══════════════════════════════════════════════════════════════════
// The supervisor watches ALL workers and:
//   - Detects runaway loops
//   - Detects repeated failures
//   - Detects conflicting workers
//   - Detects permission violations
//   - Detects excessive resource usage
//   - Pauses unsafe workers automatically
//   - Manages rollback when verification fails
//
// Workers CANNOT verify themselves.
// The supervisor is the independent safety layer.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const SUPERVISOR_KEY = "workforce_supervisor";
const MAX_FAILURES_BEFORE_PAUSE = 3;
const LOOP_DETECTION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_EXECUTIONS_IN_WINDOW = 10;

// ── Supervisor State ──────────────────────────────────────────
let _pausedWorkers = new Set();
let _failureCounts = new Map(); // worker_id => { count, last_failure, window_start }
let _backoffStreaks = new Map(); // worker_id => { consecutive, last_failure }
let _conflictPairs = new Map(); // "worker_a:worker_b" => { count, last_seen }

// ── Load/Save State ───────────────────────────────────────────
// The settings row is the durable supervisor memory: paused workers,
// failure windows, AND backoff streaks all survive restarts. Only paused
// workers were persisted originally — a restart wiped backoff streaks, so
// a consecutively-failing worker was retried every tick instead of
// deferred (retry storm on exactly the path the backoff was built for).
// Every mutation below saves best-effort; on DB failure the in-memory
// maps stay authoritative for this instance (fail-soft, never throws).
async function loadState() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", SUPERVISOR_KEY)
			.maybeSingle();

		if (data?.value) {
			_pausedWorkers = new Set(data.value.paused_workers || []);
			_failureCounts = sanitizeCounts(data.value.failure_counts);
			_backoffStreaks = sanitizeStreaks(data.value.backoff_streaks);
		}
	} catch {
		// Use in-memory state on failure
	}
}

function sanitizeCounts(raw) {
	const out = new Map();
	if (!raw || typeof raw !== "object") return out;
	for (const [k, v] of Object.entries(raw)) {
		const count = Number(v?.count);
		const window_start = Number(v?.window_start);
		if (!k || !Number.isFinite(count) || !Number.isFinite(window_start)) continue;
		out.set(k, {
			count: Math.max(0, Math.floor(count)),
			window_start,
			last_failure: Number.isFinite(Number(v?.last_failure))
				? Number(v.last_failure)
				: window_start,
		});
	}
	return out;
}

function sanitizeStreaks(raw) {
	const out = new Map();
	if (!raw || typeof raw !== "object") return out;
	for (const [k, v] of Object.entries(raw)) {
		const consecutive = Number(v?.consecutive);
		const last_failure = Number(v?.last_failure);
		if (!k || !Number.isFinite(consecutive) || !Number.isFinite(last_failure))
			continue;
		if (consecutive < 1) continue;
		out.set(k, { consecutive: Math.floor(consecutive), last_failure });
	}
	return out;
}

/** Re-read durable supervisor state (restart recovery + warm-instance convergence). */
export function reloadSupervisorState() {
	return loadState();
}

async function saveState() {
	try {
		await supabase.from("settings").upsert(
			{
				key: SUPERVISOR_KEY,
				value: {
					paused_workers: [..._pausedWorkers],
					failure_counts: Object.fromEntries(_failureCounts),
					backoff_streaks: Object.fromEntries(_backoffStreaks),
					updated_at: new Date().toISOString(),
				},
			},
			{ onConflict: "key" },
		);
	} catch (err) {
		console.error("[supervisor] failed to save state:", err?.message);
	}
}

// Initialize state on module load
loadState();

// ── Worker Status Queries ─────────────────────────────────────
export function isWorkerPaused(workerId) {
	return _pausedWorkers.has(workerId);
}

export function getPausedWorkers() {
	return [..._pausedWorkers];
}

export function getFailureCounts() {
	return Object.fromEntries(_failureCounts);
}

// ── Failure Detection ─────────────────────────────────────────
/**
 * Record a worker failure and check if it should be paused.
 */
export function recordFailure(workerId) {
	const now = Date.now();
	const entry = _failureCounts.get(workerId) || { count: 0, window_start: now };

	// Reset window if expired
	if (now - entry.window_start > LOOP_DETECTION_WINDOW_MS) {
		entry.count = 0;
		entry.window_start = now;
	}

	entry.count++;
	entry.last_failure = now;
	_failureCounts.set(workerId, entry);
	noteBackoffFailure(workerId, now);
	// Durable retry state: the streak must survive restarts, so every
	// failure persists (fire-and-forget; memory stays authoritative).
	saveState();

	// Pause if too many failures
	if (entry.count >= MAX_FAILURES_BEFORE_PAUSE) {
		_pausedWorkers.add(workerId);
		saveState();
		return {
			paused: true,
			reason: `${entry.count} failures in ${Math.round((now - entry.window_start) / 1000)}s`,
		};
	}

	return { paused: false, failure_count: entry.count };
}

/**
 * Record a worker success (resets failure count).
 */
export function recordSuccess(workerId) {
	const had = _failureCounts.has(workerId) || _backoffStreaks.has(workerId);
	_failureCounts.delete(workerId);
	clearBackoff(workerId);
	// Persist only when streak state actually cleared — success is the
	// common path and most runs have no streak to clear (avoids a settings
	// write per worker per tick).
	if (had) saveState();
}

// ── Per-worker backoff (spec §43) ─────────────────────────────────
// A worker with consecutive failures is deferred for a growing window
// instead of re-running (and re-failing) on every tick. Windows are sized
// against the 5-minute cron cadence: 10min skips ~1 tick, 30min skips ~5.
// Backoff applies to SCHEDULED (cron) runs only: an explicit manual/admin
// run is human intent and always executes (subject to pause/loop gates).
// The streak is independent of the 5-minute pause window below: slow-burn
// failures (one per hour) still back off instead of retrying every tick.
// Success (recordSuccess) or an explicit unpause clears the streak; the
// rapid-burst pause (>=3 failures in 5min) supersedes backoff when it fires.
export const BACKOFF_AFTER_FAILURES = 1;
export const BACKOFF_FIRST_MS = 10 * 60 * 1000;
export const BACKOFF_ESCALATED_MS = 30 * 60 * 1000;
// _backoffStreaks is declared with the supervisor state above (durable).

export function backoffMsFor(consecutiveFailures) {
	if (!consecutiveFailures || consecutiveFailures < BACKOFF_AFTER_FAILURES) return 0;
	return consecutiveFailures >= 2 ? BACKOFF_ESCALATED_MS : BACKOFF_FIRST_MS;
}

/** Milliseconds of backoff remaining for a worker, or 0 when runnable. */
export function getBackoffMs(workerId, now = Date.now()) {
	const entry = _backoffStreaks.get(workerId);
	if (!entry || !entry.consecutive) return 0;
	return Math.max(0, entry.last_failure + backoffMsFor(entry.consecutive) - now);
}

function noteBackoffFailure(workerId, now = Date.now()) {
	const entry = _backoffStreaks.get(workerId) || { consecutive: 0, last_failure: 0 };
	entry.consecutive++;
	entry.last_failure = now;
	_backoffStreaks.set(workerId, entry);
}

function clearBackoff(workerId) {
	_backoffStreaks.delete(workerId);
}

// ── Loop Detection ────────────────────────────────────────────
const _executionHistory = new Map(); // worker_id => [timestamps]

/**
 * Check if a worker is in a runaway loop.
 */
export function checkForLoop(workerId) {
	const now = Date.now();
	const history = _executionHistory.get(workerId) || [];

	// Clean old entries
	const recent = history.filter((t) => now - t < LOOP_DETECTION_WINDOW_MS);
	recent.push(now);
	_executionHistory.set(workerId, recent);

	if (recent.length > MAX_EXECUTIONS_IN_WINDOW) {
		_pausedWorkers.add(workerId);
		saveState();
		return {
			loop_detected: true,
			executions_in_window: recent.length,
			reason: `${recent.length} executions in ${Math.round(LOOP_DETECTION_WINDOW_MS / 1000)}s window`,
		};
	}

	return { loop_detected: false, executions_in_window: recent.length };
}

// ── Conflict Detection ────────────────────────────────────────
/**
 * Check if two workers are conflicting (modifying same resource).
 */
export function checkConflict(workerA, workerB) {
	const key = [workerA, workerB].sort().join(":");
	const now = Date.now();
	const entry = _conflictPairs.get(key) || { count: 0, last_seen: 0 };

	entry.count++;
	entry.last_seen = now;
	_conflictPairs.set(key, entry);

	if (entry.count >= 3) {
		return {
			conflict_detected: true,
			workers: [workerA, workerB],
			conflict_count: entry.count,
			reason: `${entry.count} simultaneous modifications to same resource`,
		};
	}

	return { conflict_detected: false };
}

// ── Rollback Management ───────────────────────────────────────
const _rollbackStack = new Map(); // worker_id => [rollback_entries]

/**
 * Push a rollback entry for a worker.
 */
export function pushRollback(workerId, entry) {
	const stack = _rollbackStack.get(workerId) || [];
	stack.unshift({
		...entry,
		timestamp: new Date().toISOString(),
	});
	// Keep last 10 rollbacks per worker
	if (stack.length > 10) stack.length = 10;
	_rollbackStack.set(workerId, stack);
}

/**
 * Execute rollback for a worker's last action.
 */
export async function executeRollback(workerId) {
	const stack = _rollbackStack.get(workerId);
	if (!stack || stack.length === 0) {
		return { success: false, reason: "No rollback entries available" };
	}

	const entry = stack.shift();

	if (entry.rollback_fn && typeof entry.rollback_fn === "function") {
		try {
			await entry.rollback_fn();
			return {
				success: true,
				rollback: entry.description,
				timestamp: new Date().toISOString(),
			};
		} catch (err) {
			return {
				success: false,
				error: err.message,
				rollback: entry.description,
			};
		}
	}

	return {
		success: false,
		reason: "No rollback function available for this entry",
		entry: entry.description,
	};
}

// ── Pre-execution Checks ──────────────────────────────────────
/**
 * Run all supervisor checks before a worker executes.
 * Returns { allowed, reason } or { allowed: true }.
 * Backoff deferral applies to scheduled (cron) runs only — pass
 * { trigger: "cron" } from the scheduler; explicit manual/admin/test runs
 * bypass the deferral (pause/loop gates still apply to every trigger).
 */
export function preExecutionCheck(workerId, opts = {}) {
	// 1. Check if paused
	if (isWorkerPaused(workerId)) {
		return {
			allowed: false,
			reason: `Worker ${workerId} is paused by supervisor`,
		};
	}

	// 2. Check for loops
	const loopCheck = checkForLoop(workerId);
	if (loopCheck.loop_detected) {
		return {
			allowed: false,
			reason: `Loop detected: ${loopCheck.reason}`,
		};
	}

	// 3. Backoff: a consecutively-failing worker sits out scheduled ticks
	// until its window elapses instead of burning a full run per tick.
	if ((opts.trigger || "manual") === "cron") {
		const waitMs = getBackoffMs(workerId);
		if (waitMs > 0) {
			return {
				allowed: false,
				deferred: true,
				retry_after_ms: waitMs,
				reason: `Backoff: ${workerId} deferred ${Math.ceil(waitMs / 1000)}s after consecutive failures`,
			};
		}
	}

	return { allowed: true };
}

// ── Supervisor Summary ────────────────────────────────────────
/**
 * Get a summary of the supervisor's current state.
 */
export function getSupervisorSummary() {
	const now = Date.now();
	return {
		paused_workers: [..._pausedWorkers],
		failure_counts: Object.fromEntries(_failureCounts),
		backed_off_workers: [..._backoffStreaks.keys()].filter(
			(id) => getBackoffMs(id, now) > 0,
		),
		active_conflicts: [..._conflictPairs.entries()]
			.filter(([, v]) => Date.now() - v.last_seen < LOOP_DETECTION_WINDOW_MS)
			.map(([k, v]) => ({ pair: k, count: v.count })),
		rollback_entries: Object.fromEntries(
			[..._rollbackStack.entries()].map(([k, v]) => [k, v.length]),
		),
		checked_at: new Date().toISOString(),
	};
}

/**
 * Manually unpause a worker.
 */
export function unpauseWorker(workerId) {
	_pausedWorkers.delete(workerId);
	_failureCounts.delete(workerId);
	_executionHistory.delete(workerId);
	clearBackoff(workerId);
	saveState();
	return { unpaused: true, worker_id: workerId };
}

/**
 * Full supervisor reset — clears pauses, failure streaks, backoff streaks,
 * loop histories, and conflict pairs. TEST AND MAINTENANCE USE ONLY: in
 * production prefer the per-worker unpauseWorker so unrelated workers keep
 * their safety state. Test suites that run the same worker rapidly must call
 * this in beforeEach, otherwise one test's failure streak (pause or backoff)
 * leaks into the next test's run.
 * Pass { persist: false } to drop memory WITHOUT clearing durable state —
 * the restart simulator (reloadSupervisorState then re-hydrates from KV).
 */
export function resetSupervisorState({ persist = true } = {}) {
	_pausedWorkers.clear();
	_failureCounts.clear();
	_executionHistory.clear();
	_conflictPairs.clear();
	_backoffStreaks.clear();
	if (persist) saveState();
}
