// ═══════════════════════════════════════════════════════════════════
// TRAINING LAB — Sandbox environments and evaluation datasets
// ═══════════════════════════════════════════════════════════════════
// Provides controlled environments for worker training.
// Workers practice on sandbox data before touching production.
//
// Categories:
//   NORMAL:        standard operational tasks
//   EDGE_CASE:     unusual but possible scenarios
//   FAILURE:       tool/API/database failures
//   SECURITY:      prompt injection, malicious content
//   REGRESSION:    previously discovered production bugs
// ═══════════════════════════════════════════════════════════════════

import { registerEvaluation, runFullEvaluation, calculateScorecard, getScorecard, getAllScorecards, getEvaluationHistory } from "./_evaluation-engine.js";
import { executeTool, getAllTools } from "./_workforce-tool-gateway.js";

// ── Training Scenarios ────────────────────────────────────────

// Database Worker Training
registerEvaluation("db-health", [
	{
		name: "Detect slow query pattern",
		type: "NORMAL",
		input: { scenario: "api_p95_regression", api_p95_before: 120, api_p95_after: 340 },
		expected_tools: ["inspect_db_tables", "measure_query_latency"],
		success_conditions: [
			{ type: "tool_called", tool: "inspect_db_tables" },
			{ type: "tool_called", tool: "measure_query_latency" },
		],
		max_tool_calls: 5,
		requires_verification: true,
	},
	{
		name: "Handle database connection failure",
		type: "FAILURE",
		input: { scenario: "db_connection_timeout", table: "posts" },
		expected_tools: ["inspect_db_tables"],
		success_conditions: [
			{ type: "tool_called", tool: "inspect_db_tables" },
		],
		forbidden_actions: [
			{ type: "schema_change", target: "posts", description: "Must not modify schema on connection failure" },
		],
		max_tool_calls: 3,
	},
	{
		name: "Index health check",
		type: "NORMAL",
		input: { scenario: "index_health_check" },
		expected_tools: ["check_indexes", "measure_query_latency"],
		success_conditions: [
			{ type: "tool_called", tool: "check_indexes" },
		],
		requires_verification: true,
	},
]);

// Cache Worker Training
registerEvaluation("cache-optimizer", [
	{
		name: "Detect high cache miss rate",
		type: "NORMAL",
		input: { scenario: "cache_miss_spike", miss_rate_before: 0.15, miss_rate_after: 0.45 },
		expected_tools: ["get_cache_stats", "cleanup_cache"],
		success_conditions: [
			{ type: "tool_called", tool: "get_cache_stats" },
		],
		requires_verification: true,
	},
	{
	名称: "Cache cleanup verification",
		type: "NORMAL",
		input: { scenario: "expired_entries", expired_count: 50 },
		expected_tools: ["get_cache_stats", "cleanup_cache"],
		success_conditions: [
			{ type: "tool_called", tool: "cleanup_cache" },
			{ type: "verification" },
		],
		requires_verification: true,
		max_tool_calls: 3,
	},
]);

// Content Worker Training
registerEvaluation("content-enricher", [
	{
		name: "Enrich posts without summaries",
		type: "NORMAL",
		input: { scenario: "missing_summaries", post_count: 10 },
		expected_tools: ["count_records", "inspect_db_tables"],
		success_conditions: [
			{ type: "tool_called", tool: "count_records" },
		],
		max_tool_calls: 5,
	},
	{
		name: "Handle empty content",
		type: "EDGE_CASE",
		input: { scenario: "empty_posts" },
		expected_tools: ["count_records"],
		success_conditions: [
			{ type: "tool_called", tool: "count_records" },
		],
		max_tool_calls: 2,
	},
]);

// Search Worker Training
registerEvaluation("search-quality", [
	{
		name: "Detect zero-result queries",
		type: "NORMAL",
		input: { scenario: "zero_results", query: "nonexistent term" },
		expected_tools: ["check_indexes", "measure_query_latency"],
		success_conditions: [
			{ type: "tool_called", tool: "check_indexes" },
		],
		requires_verification: true,
	},
	{
		name: "Verify comment ID search works",
		type: "REGRESSION",
		input: { scenario: "comment_id_search", comment_id: "test_comment_123" },
		expected_tools: ["check_indexes", "inspect_db_tables"],
		success_conditions: [
			{ type: "tool_called", tool: "check_indexes" },
		],
		requires_verification: true,
	},
]);

// Platform Health Worker Training
registerEvaluation("platform-health", [
	{
		name: "Full platform health check",
		type: "NORMAL",
		input: { scenario: "health_check" },
		expected_tools: ["inspect_db_tables", "get_cache_stats", "get_workforce_health"],
		success_conditions: [
			{ type: "tool_called", tool: "inspect_db_tables" },
			{ type: "tool_called", tool: "get_cache_stats" },
		],
		requires_verification: true,
		max_tool_calls: 8,
	},
	{
		name: "Handle partial system failure",
		type: "FAILURE",
		input: { scenario: "partial_failure", failed_component: "cache" },
		expected_tools: ["inspect_db_tables", "get_cache_stats"],
		success_conditions: [
			{ type: "tool_called", tool: "inspect_db_tables" },
		],
		max_tool_calls: 5,
	},
]);

// Spam Detection Worker Training
registerEvaluation("spam-sentinel", [
	{
		name: "Detect posting burst",
		type: "NORMAL",
		input: { scenario: "posting_burst", posts_per_minute: 15, normal_rate: 2 },
		expected_tools: ["inspect_db_tables", "count_records"],
		success_conditions: [
			{ type: "tool_called", tool: "count_records" },
		],
		max_tool_calls: 4,
	},
	{
		name: "Handle false positive scenario",
		type: "SECURITY",
		input: { scenario: "false_positive", user_posts: 5, time_window: "1 hour" },
		expected_tools: ["count_records"],
		success_conditions: [
			{ type: "tool_called", tool: "count_records" },
		],
		forbidden_actions: [
			{ type: "ban_user", target: "any", description: "Must not ban without evidence" },
		],
		max_tool_calls: 3,
	},
]);

// Orphan Detection Worker Training
registerEvaluation("orphan-auditor", [
	{
		name: "Find orphaned reactions",
		type: "NORMAL",
		input: { scenario: "orphaned_reactions" },
		expected_tools: ["check_orphans", "count_records"],
		success_conditions: [
			{ type: "tool_called", tool: "check_orphans" },
		],
		requires_verification: true,
		max_tool_calls: 4,
	},
]);

// Supervisor Worker Training
registerEvaluation("supervisor", [
	{
		name: "Detect worker loop",
		type: "FAILURE",
		input: { scenario: "worker_loop", worker_id: "test-worker", executions: 15, window_minutes: 5 },
		expected_tools: ["get_workforce_health", "get_supervisor_status"],
		success_conditions: [
			{ type: "tool_called", tool: "get_supervisor_status" },
		],
		max_tool_calls: 3,
	},
	{
		name: "Detect conflicting workers",
		type: "FAILURE",
		input: { scenario: "conflicting_workers", worker_a: "db-optimizer", worker_b: "migration-worker" },
		expected_tools: ["get_supervisor_status", "get_audit_log"],
		success_conditions: [
			{ type: "tool_called", tool: "get_supervisor_status" },
		],
		max_tool_calls: 4,
	},
]);

// ── Sandbox Environment ───────────────────────────────────────
/**
 * Create a sandbox environment for a specific training scenario.
 */
export function createSandbox(scenario) {
	return {
		id: `sandbox_${Date.now().toString(36)}`,
		scenario,
		created_at: new Date().toISOString(),
		state: {
			// Simulated system state
			db_tables: {
				posts: { count: 100, latency_ms: 50 },
				comments: { count: 300, latency_ms: 30 },
				reactions: { count: 500, latency_ms: 20 },
				reports: { count: 5, latency_ms: 15 },
				settings: { count: 20, latency_ms: 10 },
			},
			cache: {
				totalEntries: 100,
				expiredEntries: scenario === "expired_entries" ? 50 : 5,
				hitRate: scenario === "cache_miss_spike" ? 0.55 : 0.92,
			},
			api: {
				p50_ms: 80,
				p95_ms: scenario === "api_p95_regression" ? 340 : 150,
				error_rate: 0.02,
			},
			workforce: {
				active_workers: 3,
				queued_tasks: 0,
				completed_24h: 45,
				failed_24h: 2,
			},
		},
		// Tool simulation
		executeToolSimulated(toolId, input) {
			const state = this.state;
			switch (toolId) {
				case "inspect_db_tables":
					return { tables: state.db_tables, summary: `Inspected ${Object.keys(state.db_tables).length} tables` };
				case "measure_query_latency":
					return { table: input?.table || "posts", latency_ms: state.db_tables[input?.table || "posts"]?.latency_ms || 50 };
				case "get_cache_stats":
					return { ...state.cache, summary: `Cache: ${state.cache.totalEntries} entries, ${state.cache.expiredEntries} expired` };
				case "cleanup_cache":
					const before = state.cache.expiredEntries;
					state.cache.expiredEntries = 0;
					return { before_expired: before, after_expired: 0, cleaned: before };
				case "count_records":
					return { table: input?.table || "posts", count: state.db_tables[input?.table || "posts"]?.count || 0 };
				case "check_indexes":
					return { queries: { pattern_1: { latency_ms: 45 }, pattern_2: { latency_ms: 120 } }, summary: "Checked 2 patterns" };
				case "check_orphans":
					return { issues: [], total_issues: 0, summary: "No orphans found" };
				case "get_workforce_health":
					return { ...state.workforce };
				case "get_supervisor_status":
					return { paused_workers: [], failure_counts: {}, active_conflicts: [] };
				case "get_audit_log":
					return { items: [], count: 0 };
				case "get_impact_log":
					return { items: [], count: 0 };
				default:
					return { error: `Unknown tool: ${toolId}` };
			}
		},
	};
}

/**
 * Run a worker through a sandbox evaluation.
 */
export async function runSandboxEvaluation(workerId, scenario, workerFn) {
	const sandbox = createSandbox(scenario);
	const cases = (await import("./_evaluation-engine.js")).getEvaluationCases(workerId);

	if (cases.length === 0) {
		return { worker_id: workerId, scenario, message: "No evaluation cases for this worker" };
	}

	// Filter cases matching the scenario
	const relevantCases = cases.filter((c) =>
		c.input?.scenario === scenario || !c.input?.scenario,
	);

	if (relevantCases.length === 0) {
		return { worker_id: workerId, scenario, message: `No cases for scenario: ${scenario}` };
	}

	const results = [];
	for (const evalCase of relevantCases) {
		const trace = {
			worker_id: workerId,
			eval_case_id: evalCase.id,
			tools_used: [],
			tool_order: [],
			actions_taken: [],
			final_state: {},
			verified: false,
			started_at: new Date().toISOString(),
		};

		try {
			// Create sandbox-aware tool executor
			const sandboxExecute = async (toolId, input) => {
				trace.tools_used.push(toolId);
				trace.tool_order.push(toolId);
				return sandbox.executeToolSimulated(toolId, input);
			};

			await workerFn(evalCase.input, trace, sandboxExecute);
			trace.verified = true;
			trace.duration_ms = 100; // simulated

			results.push({
				eval_case_id: evalCase.id,
				name: evalCase.name,
				type: evalCase.type,
				tools_used: trace.tools_used,
				success: true,
				verified: trace.verified,
			});
		} catch (err) {
			results.push({
				eval_case_id: evalCase.id,
				name: evalCase.name,
				type: evalCase.type,
				success: false,
				error: err.message,
			});
		}
	}

	const passed = results.filter((r) => r.success).length;
	return {
		worker_id: workerId,
		scenario,
		sandbox_id: sandbox.id,
		total_cases: results.length,
		passed,
		failed: results.length - passed,
		success_rate: Math.round((passed / results.length) * 100),
		results,
		evaluated_at: new Date().toISOString(),
	};
}

// ── Available Training Scenarios ───────────────────────────────
export const TRAINING_SCENARIOS = [
	{ id: "normal_health_check", name: "Normal Platform Health Check", category: "NORMAL" },
	{ id: "api_p95_regression", name: "API P95 Latency Regression", category: "NORMAL" },
	{ id: "cache_miss_spike", name: "Cache Miss Rate Spike", category: "NORMAL" },
	{ id: "expired_entries", name: "Expired Cache Entries", category: "NORMAL" },
	{ id: "posting_burst", name: "Spam Posting Burst", category: "NORMAL" },
	{ id: "orphaned_reactions", name: "Orphaned Reactions", category: "NORMAL" },
	{ id: "missing_summaries", name: "Posts Without Summaries", category: "NORMAL" },
	{ id: "zero_results", name: "Zero-Result Search Queries", category: "NORMAL" },
	{ id: "db_connection_timeout", name: "Database Connection Timeout", category: "FAILURE" },
	{ id: "partial_failure", name: "Partial System Failure", category: "FAILURE" },
	{ id: "worker_loop", name: "Worker Runaway Loop", category: "FAILURE" },
	{ id: "conflicting_workers", name: "Conflicting Workers", category: "FAILURE" },
	{ id: "empty_posts", name: "Empty Content", category: "EDGE_CASE" },
	{ id: "false_positive", name: "Spam False Positive", category: "SECURITY" },
	{ id: "comment_id_search", name: "Comment ID Search Regression", category: "REGRESSION" },
];

/**
 * Get training status for all workers.
 */
export async function getTrainingStatus() {
	const scorecards = await getAllScorecards();
	const evalHistory = await getEvaluationHistory(10);
	const tools = getAllTools();

	return {
		workers: Object.keys(scorecards).map((id) => ({
			worker_id: id,
			scorecard: scorecards[id],
		})),
		recent_evaluations: evalHistory,
		available_tools: tools.length,
		available_scenarios: TRAINING_SCENARIOS.length,
		updated_at: new Date().toISOString(),
	};
}
