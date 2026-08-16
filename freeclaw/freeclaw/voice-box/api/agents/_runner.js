// Agent Runner — Core execution engine for all agents
// Self-healing: uses agent_executions table if it exists, falls back to settings table
import supabase from "../_db-client.js";

const STORE_KEY = "agent_executions_store";
const ACTIVITY_KEY = "agent_activity_store";
const MAX_STORED = 200; // max records in settings fallback
let _tableExists = null; // cache: null = unknown, true/false
let _tableExistsCheckedAt = 0; // FIX-M5: TTL for table-exists cache
const TABLE_CACHE_TTL_MS = 5 * 60 * 1000; // re-check every 5 minutes

/**
 * Check if agent_executions table exists (cached with TTL — re-checks every 5 min)
 */
async function hasExecutionsTable() {
	const now = Date.now();
	if (_tableExists !== null && now - _tableExistsCheckedAt < TABLE_CACHE_TTL_MS)
		return _tableExists;
	try {
		const { error } = await supabase
			.from("agent_executions")
			.select("id")
			.limit(1);
		_tableExists = !error;
	} catch {
		_tableExists = false;
	}
	_tableExistsCheckedAt = now;
	return _tableExists;
}

/**
 * Run an agent task and record the execution
 * @param {string} agentId - Agent identifier
 * @param {string} agentName - Human-readable name
 * @param {string} division - Agent division
 * @param {Function} taskFn - Task function (receives eventContext as first arg)
 * @param {string} triggerType - 'cron' | 'event' | 'manual'
 * @param {object} eventContext - Optional event data to pass to the agent
 */
export async function runAgent(
	agentId,
	agentName,
	division,
	taskFn,
	triggerType = "cron",
	eventContext = null,
) {
	const startTime = Date.now();
	const startedAt = new Date().toISOString();
	const useTable = await hasExecutionsTable();

	let executionId = null;

	if (useTable) {
		// Try dedicated table first
		const { data: execution } = await supabase
			.from("agent_executions")
			.insert({
				agent_id: agentId,
				agent_name: agentName,
				division,
				trigger_type: triggerType,
				task: taskFn.description || `${agentName} periodic run`,
				status: "running",
				started_at: startedAt,
			})
			.select()
			.single();
		executionId = execution?.id;
		// REAL HEARTBEAT — while the task runs, keep the execution row alive so
		// the workforce recovery pass can distinguish live work from stuck work.
		if (executionId) startHeartbeat(executionId);
	}

	try {
		const output = eventContext ? await taskFn(eventContext) : await taskFn();
		const durationMs = Date.now() - startTime;
		const record = {
			id: executionId || crypto.randomUUID(),
			agent_id: agentId,
			agent_name: agentName,
			division,
			trigger_type: triggerType,
			task: taskFn.description || `${agentName} periodic run`,
			status: "completed",
			output,
			duration_ms: durationMs,
			started_at: startedAt,
			completed_at: new Date().toISOString(),
		};

		if (useTable && executionId) {
			await supabase
				.from("agent_executions")
				.update({
					status: "completed",
					output,
					duration_ms: durationMs,
					completed_at: record.completed_at,
				})
				.eq("id", executionId);
		} else {
			await storeInSettings(record);
		}

		await logActivity(
			agentId,
			"task_completed",
			{
				duration_ms: durationMs,
				output_summary:
					typeof output === "object"
						? JSON.stringify(output).slice(0, 500)
						: String(output).slice(0, 500),
			},
			"info",
		);

		stopHeartbeat(executionId);
		return {
			status: "completed",
			output,
			duration_ms: durationMs,
			execution_id: executionId || record.id,
		};
	} catch (err) {
		stopHeartbeat(executionId);
		const durationMs = Date.now() - startTime;
		const record = {
			id: executionId || crypto.randomUUID(),
			agent_id: agentId,
			agent_name: agentName,
			division,
			trigger_type: triggerType,
			task: taskFn.description || `${agentName} periodic run`,
			status: "failed",
			error: err.message,
			duration_ms: durationMs,
			started_at: startedAt,
			completed_at: new Date().toISOString(),
		};

		if (useTable && executionId) {
			await supabase
				.from("agent_executions")
				.update({
					status: "failed",
					error: err.message,
					duration_ms: durationMs,
					completed_at: record.completed_at,
				})
				.eq("id", executionId);
		} else {
			await storeInSettings(record);
		}

		await logActivity(
			agentId,
			"task_failed",
			{ error: err.message, duration_ms: durationMs },
			"error",
		);

		return {
			status: "failed",
			error: err.message,
			duration_ms: durationMs,
			execution_id: executionId || record.id,
		};
	}
}

/**
 * Store execution record in settings table (fallback when agent_executions doesn't exist)
 * FIX-M5: upsert persists the merged record in a single row write.
 * NOTE: the read→merge→write window is still best-effort under concurrency —
 *       a race can drop a record, but this is the offline fallback path only.
 */
async function storeInSettings(record) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", STORE_KEY)
			.maybeSingle();
		const existing = data?.value?.records || [];
		const updated = [record, ...existing].slice(0, MAX_STORED);
		await supabase
			.from("settings")
			.upsert(
				{
					key: STORE_KEY,
					value: { records: updated, updated_at: new Date().toISOString() },
				},
				{ onConflict: "key" },
			);
	} catch (err) {
		console.error(`[Runner] storeInSettings FAILED: ${err.message}`);
	}
}

/**
 * Log an activity event (FIX-L7: returns success indicator instead of swallowing errors)
 */
export async function logActivity(agentId, action, details, severity = "info") {
	try {
		const useTable = await hasExecutionsTable();
		if (useTable) {
			await supabase.from("agent_activity_log").insert({
				agent_id: agentId,
				action,
				details: typeof details === "string" ? { message: details } : details,
				severity,
			});
		} else {
			// Fallback: append to settings
			const { data } = await supabase
				.from("settings")
				.select("value")
				.eq("key", ACTIVITY_KEY)
				.maybeSingle();
			const existing = data?.value?.records || [];
			const record = {
				id: crypto.randomUUID(),
				agent_id: agentId,
				action,
				details: typeof details === "string" ? { message: details } : details,
				severity,
				created_at: new Date().toISOString(),
			};
			const updated = [record, ...existing].slice(0, MAX_STORED);
			await supabase
				.from("settings")
				.upsert(
					{
						key: ACTIVITY_KEY,
						value: { records: updated, updated_at: new Date().toISOString() },
					},
					{ onConflict: "key" },
				);
		}
		return true;
	} catch (err) {
		console.error(
			`[Runner] logActivity FAILED for ${agentId}: ${action} — ${err.message}`,
		);
		return false;
	}
}

/**
 * Record a system metric (FIX-L7: returns success indicator instead of swallowing errors)
 */
export async function recordMetric(metricName, value, tags = {}) {
	try {
		const useTable = await hasExecutionsTable();
		if (useTable) {
			await supabase
				.from("system_metrics")
				.insert({ metric_name: metricName, metric_value: value, tags });
		}
		return true;
	} catch (err) {
		console.error(
			`[Runner] recordMetric FAILED for ${metricName}=${value} — ${err.message}`,
		);
		return false;
	}
}

/**
 * Get recent executions — tries table first, falls back to settings
 */
export async function getRecentExecutions(agentId, limit = 50) {
	const useTable = await hasExecutionsTable();

	if (useTable) {
		let query = supabase
			.from("agent_executions")
			.select("*")
			.order("started_at", { ascending: false })
			.limit(limit);
		if (agentId) query = query.eq("agent_id", agentId);
		const { data } = await query;
		return data || [];
	}

	// Fallback: read from settings
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", STORE_KEY)
		.maybeSingle();
	let records = data?.value?.records || [];
	if (agentId) records = records.filter((r) => r.agent_id === agentId);
	return records.slice(0, limit);
}

/**
 * Activity `details` is stored as JSON — logActivity() wraps plain strings in
 * { message } and passes objects through untouched. Flatten to ONE safe,
 * human-readable line so UI renderers can never crash on an object child
 * (React throws "Objects are not valid as a React child" — which blanked the
 * Ops Center whenever an agent logged structured details).
 */
function flattenDetails(details) {
	if (typeof details === "string") return details;
	if (details && typeof details === "object") {
		const o = details;
		if (typeof o.message === "string" && o.message) return o.message;
		if (typeof o.title === "string") {
			return o.task_id
				? `${o.title} (${String(o.task_id).slice(0, 12)}…)`
				: o.title;
		}
		if (typeof o.output_summary === "string")
			return o.output_summary.slice(0, 160);
		try {
			const s = JSON.stringify(details);
			return s && s.length > 2 ? s.slice(0, 200) : "";
		} catch {
			return "";
		}
	}
	return details == null ? "" : String(details);
}

/**
 * Get activity log — tries table first, falls back to settings.
 * Details are flattened to strings (see flattenDetails) for every consumer.
 */
export async function getRecentActivity(limit = 50) {
	const useTable = await hasExecutionsTable();

	if (useTable) {
		const { data } = await supabase
			.from("agent_activity_log")
			.select("*")
			.order("created_at", { ascending: false })
			.limit(limit);
		return (data || []).map((r) => ({
			...r,
			details: flattenDetails(r.details),
		}));
	}

	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", ACTIVITY_KEY)
		.maybeSingle();
	return (data?.value?.records || [])
		.slice(0, limit)
		.map((r) => ({ ...r, details: flattenDetails(r.details) }));
}

/**
 * Get dashboard stats — tries table first, falls back to settings
 */
// ─── Heartbeat (real liveness) ─────────────────────────────────────
const _heartbeats = new Map(); // executionId → interval
const HEARTBEAT_MS = 10000;

// TTL-cached probe: does agent_executions have the heartbeat_at column?
// Avoids spamming warnings every 10s on DBs where the migration hasn't run.
let _hbColumn = null;
let _hbCheckedAt = 0;

async function hasHeartbeatColumn() {
	const now = Date.now();
	if (_hbColumn !== null && now - _hbCheckedAt < 5 * 60 * 1000)
		return _hbColumn;
	try {
		const { error } = await supabase
			.from("agent_executions")
			.select("heartbeat_at")
			.limit(1);
		_hbColumn = !error;
	} catch {
		_hbColumn = false;
	}
	_hbCheckedAt = now;
	return _hbColumn;
}

function startHeartbeat(executionId) {
	if (!executionId || _heartbeats.has(executionId)) return;
	// Interval is registered SYNCHRONOUSLY so stopHeartbeat() can always
	// find and clear it — even if the task finishes before the column probe
	// resolves (no leaked intervals on fast executions). Each tick probes
	// (TTL-cached) whether the migration column exists before writing, so
	// DBs that haven't run the migration get zero log spam and zero writes.
	const hb = setInterval(() => {
		hasHeartbeatColumn()
			.then((ok) => {
				if (!ok) return;
				return supabase
					.from("agent_executions")
					.update({ heartbeat_at: new Date().toISOString() })
					.eq("id", executionId)
					.then(({ error }) => {
						if (error)
							console.warn("[Runner] heartbeat failed:", error.message);
					});
			})
			.catch(() => {});
	}, HEARTBEAT_MS);
	if (hb.unref) hb.unref(); // don't hold the process open in local dev
	_heartbeats.set(executionId, hb);
}

function stopHeartbeat(executionId) {
	if (!executionId) return;
	const hb = _heartbeats.get(executionId);
	if (hb) {
		clearInterval(hb);
		_heartbeats.delete(executionId);
	}
}

/**
 * Recover executions stuck in 'running' with no heartbeat for too long.
 * Returns the number recovered. Called by the workforce recovery pass.
 */
export async function recoverStaleExecutions(staleMs = 10 * 60 * 1000) {
	const useTable = await hasExecutionsTable();
	if (!useTable) return 0;
	const cutoff = new Date(Date.now() - staleMs).toISOString();
	const { data, error } = await supabase
		.from("agent_executions")
		.select("id, agent_id")
		.eq("status", "running")
		.lt("heartbeat_at", cutoff)
		.limit(50);
	if (error) {
		console.warn("[Runner] recoverStaleExecutions error:", error.message);
		return 0;
	}
	if (!data || data.length === 0) return 0;
	const ids = data.map((r) => r.id);
	await supabase
		.from("agent_executions")
		.update({
			status: "failed",
			error: "Stale execution — heartbeat expired",
			completed_at: new Date().toISOString(),
		})
		.in("id", ids);
	for (const r of data) {
		await logActivity(
			r.agent_id,
			"execution_recovered",
			{ execution_id: r.id, reason: "heartbeat expired" },
			"warning",
		).catch(() => {});
	}
	return ids.length;
}

export async function getDashboardStats() {
	const useTable = await hasExecutionsTable();

	if (useTable) {
		const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
		const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

		const [totalResult, recentResult, failedResult, runningResult] =
			await Promise.all([
				supabase
					.from("agent_executions")
					.select("*", { count: "exact", head: true }),
				supabase
					.from("agent_executions")
					.select("*", { count: "exact", head: true })
					.gte("started_at", oneHourAgo),
				supabase
					.from("agent_executions")
					.select("*", { count: "exact", head: true })
					.eq("status", "failed")
					.gte("started_at", oneDayAgo),
				supabase
					.from("agent_executions")
					.select("*")
					.eq("status", "running")
					.order("started_at", { ascending: false })
					.limit(50),
			]);

		return {
			total_executions: totalResult.count || 0,
			last_hour: recentResult.count || 0,
			failed_today: failedResult.count || 0,
			currently_running: runningResult.data || [],
		};
	}

	// Fallback: compute from settings
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", STORE_KEY)
		.maybeSingle();
	const records = data?.value?.records || [];
	const now = Date.now();
	const oneHourAgo = now - 3600000;
	const oneDayAgo = now - 86400000;

	return {
		total_executions: records.length,
		last_hour: records.filter(
			(r) => new Date(r.started_at).getTime() > oneHourAgo,
		).length,
		failed_today: records.filter(
			(r) =>
				r.status === "failed" && new Date(r.started_at).getTime() > oneDayAgo,
		).length,
		currently_running: records.filter((r) => r.status === "running"),
	};
}
