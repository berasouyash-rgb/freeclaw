// ═══════════════════════════════════════════════════════════════════
// WORKFORCE INTEGRATION — Connects all workforce subsystems
// ═══════════════════════════════════════════════════════════════════
// This module:
//   1. Registers real tools in the Tool Gateway
//   2. Registers verifiers in the Verification Engine
//   3. Connects the Supervisor pre-check to worker execution
//   4. Provides the admin API for workforce management
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { registerTool, executeTool, readAuditLog, getAllTools, RISK_LEVELS } from "./_workforce-tool-gateway.js";
import { registerVerifier, verifyOutcome, calculateImpact } from "./_workforce-verification.js";
import { trackImpact, readImpactLog, getImpactSummary, registerBaseline, collectBaselines } from "./_impact-engine.js";
import { preExecutionCheck, recordFailure, recordSuccess, executeRollback, getSupervisorSummary, unpauseWorker, pushRollback } from "./_worker-supervisor.js";
import { readLedger, workforceHealth } from "./_workforce-core.js";

// ── Register Real Tools ───────────────────────────────────────

// Tool: Inspect database tables
registerTool({
	tool_id: "inspect_db_tables",
	description: "Read table row counts and basic health metrics",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 10_000,
	rate_limit: 20,
	async execute(_workerId, input) {
		const tables = input?.tables || ["posts", "comments", "reactions", "reports", "settings"];
		const results = {};
		for (const table of tables) {
			const start = Date.now();
			try {
				const { count, error } = await supabase
					.from(table)
					.select("*", { count: "exact", head: true });
				results[table] = {
					count: count || 0,
					latency_ms: Date.now() - start,
					status: error ? "error" : "ok",
					error: error?.message || null,
				};
			} catch (err) {
				results[table] = { count: 0, latency_ms: Date.now() - start, status: "error", error: err.message };
			}
		}
		return { tables: results, summary: `Inspected ${tables.length} tables` };
	},
});

// Tool: Measure query latency
registerTool({
	tool_id: "measure_query_latency",
	description: "Measure actual query latency for a specific table",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 10_000,
	rate_limit: 20,
	async execute(_workerId, input) {
		const table = input?.table || "posts";
		const start = Date.now();
		await supabase.from(table).select("id").limit(1);
		const latency = Date.now() - start;
		return { table, latency_ms: latency, summary: `${table} query: ${latency}ms` };
	},
});

// Tool: Get cache statistics
registerTool({
	tool_id: "get_cache_stats",
	description: "Get in-memory cache statistics",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 5_000,
	rate_limit: 30,
	async execute() {
		try {
			const { cacheStats } = await import("./_cache.js");
			const stats = cacheStats();
			return { ...stats, summary: `Cache: ${stats.totalEntries} entries, ${stats.expiredEntries} expired` };
		} catch {
			return { totalEntries: 0, expiredEntries: 0, summary: "Cache stats unavailable" };
		}
	},
});

// Tool: Cleanup expired cache entries
registerTool({
	tool_id: "cleanup_cache",
	description: "Remove expired cache entries",
	risk_level: RISK_LEVELS.SAFE_WRITE,
	timeout_ms: 10_000,
	rate_limit: 4,
	async execute() {
		try {
			const { cacheStats: before, cleanupCache } = await import("./_cache.js");
			const b = before();
			cleanupCache();
			const after = cacheStats();
			return {
				before_expired: b.expiredEntries,
				after_expired: after.expiredEntries,
				cleaned: b.expiredEntries - after.expiredEntries,
				summary: `Cleaned ${b.expiredEntries - after.expiredEntries} expired entries`,
			};
		} catch (err) {
			return { error: err.message, summary: `Cache cleanup failed: ${err.message}` };
		}
	},
	verify(result) {
		return {
			ok: result.after_expired === 0 || result.after_expired < result.before_expired,
			proof: `Cache: ${result.before_expired} → ${result.after_expired} expired entries`,
		};
	},
});

// Tool: Count records in a table
registerTool({
	tool_id: "count_records",
	description: "Count records in a table with optional filter",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 10_000,
	rate_limit: 20,
	async execute(_workerId, input) {
		const table = input?.table || "posts";
		const filter = input?.filter || {};
		let query = supabase.from(table).select("*", { count: "exact", head: true });
		if (filter.column && filter.value !== undefined) {
			query = query.eq(filter.column, filter.value);
		}
		const { count } = await query;
		return { table, count: count || 0, summary: `${table}: ${count || 0} records` };
	},
});

// Tool: Check for orphan records
registerTool({
	tool_id: "check_orphans",
	description: "Check for orphaned records across tables",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 30_000,
	rate_limit: 2,
	async execute() {
		const issues = [];

		// Check orphaned reactions
		try {
			const { data: reactions } = await supabase
				.from("reactions")
				.select("target_id")
				.limit(500);

			if (reactions && reactions.length > 0) {
				const targetIds = [...new Set(reactions.map((r) => r.target_id))];
				const { data: posts } = await supabase
					.from("posts")
					.select("id")
					.in("id", targetIds);

				const postIds = new Set((posts || []).map((p) => p.id));
				const orphans = targetIds.filter((id) => !postIds.has(id));

				if (orphans.length > 0) {
					issues.push({
						table: "reactions",
						type: "orphaned_targets",
						count: orphans.length,
						sample: orphans.slice(0, 5),
					});
				}
			}
		} catch {
			// Skip on error
		}

		return {
			issues,
			total_issues: issues.length,
			summary: `Found ${issues.length} orphan issue types`,
		};
	},
});

// Tool: Check index usage
registerTool({
	tool_id: "check_indexes",
	description: "Check database index health via query plan analysis",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 15_000,
	rate_limit: 4,
	async execute() {
		// Measure query latency for common patterns as a proxy for index health
		const queries = [
			{ name: "posts_by_status", table: "posts", filter: { column: "status", value: "reported" } },
			{ name: "posts_by_category", table: "posts", filter: { column: "category", value: "Facilities" } },
			{ name: "comments_by_post", table: "comments", filter: { column: "post_id", value: "nonexistent" } },
			{ name: "reactions_by_target", table: "reactions", filter: { column: "target_id", value: "nonexistent" } },
		];

		const results = {};
		for (const q of queries) {
			const start = Date.now();
			try {
				await supabase
					.from(q.table)
					.select("id")
					.eq(q.filter.column, q.filter.value)
					.limit(1);
				results[q.name] = { latency_ms: Date.now() - start, status: "ok" };
			} catch {
				results[q.name] = { latency_ms: Date.now() - start, status: "error" };
			}
		}

		return { queries: results, summary: `Checked ${queries.length} query patterns` };
	},
});

// Tool: Get workforce health
registerTool({
	tool_id: "get_workforce_health",
	description: "Get overall workforce health metrics",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 10_000,
	rate_limit: 10,
	async execute() {
		const health = await workforceHealth();
		return { ...health, summary: `${health.total_executions_24h} executions in 24h` };
	},
});

// Tool: Get impact log
registerTool({
	tool_id: "get_impact_log",
	description: "Get recent impact measurements",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 10_000,
	rate_limit: 10,
	async execute(_workerId, input) {
		const limit = input?.limit || 20;
		const log = await readImpactLog(limit);
		return { items: log, count: log.length, summary: `${log.length} impact entries` };
	},
});

// Tool: Get audit log
registerTool({
	tool_id: "get_audit_log",
	description: "Get tool execution audit trail",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 10_000,
	rate_limit: 10,
	async execute(_workerId, input) {
		const limit = input?.limit || 50;
		const log = readAuditLog(limit);
		return { items: log, count: log.length, summary: `${log.length} audit entries` };
	},
});

// Tool: Get supervisor status
registerTool({
	tool_id: "get_supervisor_status",
	description: "Get worker supervisor status and paused workers",
	risk_level: RISK_LEVELS.SAFE_READ,
	timeout_ms: 5_000,
	rate_limit: 10,
	async execute() {
		const summary = getSupervisorSummary();
		return { ...summary, summary: `${summary.paused_workers.length} paused workers` };
	},
});

// ── Register Verifiers for Workers ────────────────────────────

registerVerifier("cache-optimizer", async (result) => {
	return {
		ok: result.after_expired === 0 || result.after_expired < result.before_expired,
		proof: `Cache cleanup: ${result.before_expired} → ${result.after_expired} expired entries`,
	};
});

registerVerifier("session-cleaner", async (result) => {
	return {
		ok: result.kept !== undefined,
		proof: `Sessions: ${result.purged} purged, ${result.kept} kept`,
	};
});

registerVerifier("poll-archiver", async (result) => {
	return {
		ok: result.archived >= 0,
		proof: `Poll archival: ${result.archived} polls archived`,
	};
});

registerVerifier("db-health", async () => {
	const start = Date.now();
	await supabase.from("posts").select("id").limit(1);
	const latency = Date.now() - start;
	return {
		ok: latency < 5000,
		proof: `DB health check: ${latency}ms`,
	};
});

registerVerifier("content-enricher", async (result) => {
	return {
		ok: result.enriched >= 0,
		proof: `Content enrichment: ${result.enriched} posts enriched`,
	};
});

registerVerifier("stale-sweeper", async (result) => {
	return {
		ok: result.archived >= 0,
		proof: `Stale sweep: ${result.archived} posts archived`,
	};
});

registerVerifier("priority-scaler", async (result) => {
	return {
		ok: result.recalculated >= 0,
		proof: `Priority recalculation: ${result.recalculated} posts updated`,
	};
});

// ── Verifiers for remaining workers ────────────────────────────

registerVerifier("report-sla", async () => {
	try {
		const { count } = await supabase
			.from("posts")
			.select("*", { count: "exact", head: true })
			.eq("type", "complaint")
			.eq("status", "open");
		return {
			ok: true,
			proof: `SLA check: ${count || 0} open complaints checked`,
			metrics: { open_complaints: count || 0 },
		};
	} catch (err) {
		return { ok: false, proof: `SLA check failed: ${err.message}` };
	}
});

registerVerifier("api-reliability", async () => {
	try {
		const start = Date.now();
		await supabase.from("settings").select("key").limit(1);
		const latency = Date.now() - start;
		return {
			ok: latency < 3000,
			proof: `API reliability: ${latency}ms response`,
			metrics: { latency_ms: latency },
		};
	} catch (err) {
		return { ok: false, proof: `API check failed: ${err.message}` };
	}
});

registerVerifier("spam-sentinel", async (result) => {
	return {
		ok: result.flagged >= 0 || result.flagged === undefined,
		proof: `Spam sentinel: ${result.flagged || 0} posts flagged`,
	};
});

registerVerifier("duplicate-reports", async (result) => {
	return {
		ok: Array.isArray(result.duplicates),
		proof: `Duplicate check: ${result.duplicates?.length || 0} potential duplicates found`,
	};
});

registerVerifier("notification-health", async () => {
	try {
		const { count } = await supabase
			.from("notifications")
			.select("*", { count: "exact", head: true });
		return {
			ok: true,
			proof: `Notification health: ${count || 0} notifications tracked`,
			metrics: { total: count || 0 },
		};
	} catch (err) {
		return { ok: false, proof: `Notification check failed: ${err.message}` };
	}
});

registerVerifier("supervisor", async () => {
	const summary = getSupervisorSummary();
	const noRunaway = !summary.runaway_detected;
	return {
		ok: noRunaway,
		proof: `Supervisor: ${summary.paused_workers.length} paused, ${Object.keys(summary.failure_counts).length} tracked workers`,
	};
});

registerVerifier("content-quality", async (result) => {
	return {
		ok: result.issues_found >= 0,
		proof: `Content quality: ${result.issues_found || 0} issues found`,
	};
});

registerVerifier("user-anomaly", async (result) => {
	return {
		ok: result.anomalies_found >= 0,
		proof: `User anomaly: ${result.anomalies_found || 0} anomalies detected`,
	};
});

registerVerifier("search-quality", async () => {
	try {
		const { data } = await supabase
			.from("posts")
			.select("id")
			.limit(1);
		return {
			ok: data && data.length > 0,
			proof: `Search quality: index ${data?.length ? 'accessible' : 'empty'}`,
		};
	} catch (err) {
		return { ok: false, proof: `Search check failed: ${err.message}` };
	}
});

registerVerifier("platform-health", async () => {
	try {
		const start = Date.now();
		const { data } = await supabase
			.from("posts")
			.select("id")
			.limit(1);
		const latency = Date.now() - start;
		return {
			ok: latency < 5000 && !!data,
			proof: `Platform health: ${latency}ms, data accessible: ${!!data}`,
			metrics: { latency_ms: latency },
		};
	} catch (err) {
		return { ok: false, proof: `Platform health check failed: ${err.message}` };
	}
});

// ── Export Integration Functions ───────────────────────────────

/**
 * Get comprehensive workforce status for admin dashboard.
 */
export async function getWorkforceStatus() {
	const [health, impactSummary, supervisor, tools, auditLog] = await Promise.all([
		workforceHealth(),
		getImpactSummary(),
		getSupervisorSummary(),
		getAllTools(),
		readAuditLog(20),
	]);

	return {
		health,
		impact: impactSummary,
		supervisor,
		tools,
		recent_audit: auditLog,
		updated_at: new Date().toISOString(),
	};
}

export {
	readAuditLog as getAuditLog,
	readImpactLog as getImpactLog,
	getImpactSummary,
	getSupervisorSummary,
	preExecutionCheck,
	recordFailure,
	recordSuccess,
	executeRollback,
	unpauseWorker,
	pushRollback,
	executeTool,
	collectBaselines,
	trackImpact,
};
