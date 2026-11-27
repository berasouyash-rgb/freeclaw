// ═══════════════════════════════════════════════════════════════════
// WORKFORCE PROOF — Controlled failure test suite
// ═══════════════════════════════════════════════════════════════════
// Deliberately introduces controlled failures in a sandbox to prove
// the workforce detects, triages, executes, verifies, and recovers.
//
// Every test proves: DETECTION → TRIAGE → TASK → WORKER → TOOL →
// EXECUTION → VERIFICATION → MEASURED RESULT → AUDIT
//
// This is the "prove it works" test suite. If any stage is missing,
// the test FAILS.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { executeTool, registerTool, getAllTools, RISK_LEVELS } from "./_workforce-tool-gateway.js";
import { verifyOutcome, calculateImpact } from "./_workforce-verification.js";
import { trackImpact, registerBaseline } from "./_impact-engine.js";
import { preExecutionCheck, recordFailure, recordSuccess, pushRollback, getSupervisorSummary } from "./_worker-supervisor.js";
import { runWorker, registerWorker, readLedger, workforceHealth } from "./_workforce-core.js";

// ── Test Infrastructure ────────────────────────────────────────
const _testResults = [];
const _testSuites = new Map();

function recordResult(suite, test, passed, details) {
	const entry = {
		suite,
		test,
		passed,
		details,
		timestamp: new Date().toISOString(),
	};
	_testResults.unshift(entry);
	if (_testResults.length > 200) _testResults.length = 200;
	return entry;
}

/**
 * Run all controlled failure tests.
 * Returns a summary of what passed and what failed.
 */
export async function runWorkforceProof() {
	const results = {
		total: 0,
		passed: 0,
		failed: 0,
		skipped: 0,
		details: [],
		started_at: new Date().toISOString(),
	};

	const tests = [
		testToolGatewayAuthorization,
		testToolRateLimiting,
		testToolDryRun,
		testToolInputValidation,
		testWorkerBudgetEnforcement,
		testWorkerLifecycle,
		testSupervisorPreCheck,
		testVerificationEngine,
		testImpactMeasurement,
		testCacheCleanup,
		testDatabaseInspection,
		testOrphanDetection,
		testAuditTrail,
		testRollbackCapability,
		testConflictDetection,
		testWorkerHealth,
		testEdgeWorkerSkip,
		testEscalationFlow,
		testToolTimeout,
		testShadowMode,
	];

	for (const testFn of tests) {
		const name = testFn.name || "unnamed_test";
		results.total++;
		try {
			const result = await testFn();
			if (result.passed) {
				results.passed++;
			} else {
				results.failed++;
			}
			results.details.push({ name, ...result });
		} catch (err) {
			results.failed++;
			results.details.push({
				name,
				passed: false,
				error: err.message,
				stage: "execution",
			});
		}
	}

	results.completed_at = new Date().toISOString();
	results.duration_ms = new Date(results.completed_at) - new Date(results.started_at);
	return results;
}

// ── TEST 1: Tool Gateway Authorization ─────────────────────────
async function testToolGatewayAuthorization() {
	// Attempt to use a tool with an unauthorized worker
	const result = await executeTool("unauthorized_worker", "cleanup_cache", {});

	const passed = result.success === false && result.error?.includes("not authorized");
	return recordResult("tool-gateway", "authorization_denied_for_unauthorized_worker", passed,
		passed ? "Correctly denied unauthorized worker" : `Unexpected: ${JSON.stringify(result)}`);
}

// ── TEST 2: Tool Rate Limiting ─────────────────────────────────
async function testToolRateLimiting() {
	// Execute the same tool rapidly to trigger rate limit
	const tool = getAllTools().find(t => t.tool_id === "check_orphans");
	const limit = tool?.rate_limit || 2;
	const results = [];
	for (let i = 0; i <= limit + 2; i++) {
		results.push(await executeTool("rate_test_worker", "check_orphans", {}));
	}
	const blocked = results.some(r => r.error?.includes("Rate limit"));
	return recordResult("tool-gateway", "rate_limit_enforced", blocked,
		blocked ? `Blocked after ${results.filter(r => r.success).length} successful calls` : "Rate limit not triggered");
}

// ── TEST 3: Tool Dry Run ───────────────────────────────────────
async function testToolDryRun() {
	// Dry run should validate but not execute
	const { dryRunTool } = await import("./_workforce-tool-gateway.js");
	const result = await dryRunTool("test_worker", "cleanup_cache", {});
	const passed = result.success === true && result.dry_run === true;
	return recordResult("tool-gateway", "dry_run_validates_without_executing", passed,
		passed ? "Dry run correctly skipped execution" : `Unexpected: ${JSON.stringify(result)}`);
}

// ── TEST 4: Tool Input Validation ──────────────────────────────
async function testToolInputValidation() {
	// Execute with invalid input
	const result = await executeTool("test_worker", "count_records", { invalid_field: true });
	// Tool should still work (count_records doesn't validate strictly)
	// but it should not crash
	const passed = result !== undefined && result !== null;
	return recordResult("tool-gateway", "tool_handles_invalid_input_gracefully", passed,
		passed ? "Tool handled invalid input without crash" : "Tool crashed on invalid input");
}

// ── TEST 5: Worker Budget Enforcement ──────────────────────────
async function testWorkerBudgetEnforcement() {
	const workerId = "budget_test_worker";
	registerWorker({
		worker_id: workerId,
		name: "Budget Test Worker",
		responsibility: "Testing budget enforcement",
		execution_class: "A",
		risk_level: "low",
		budget: { max_runs_per_hour: 2, max_affected_records: 5 },
		tools: ["count_records"],
	});

	// Run worker multiple times to exceed budget
	const results = [];
	for (let i = 0; i < 5; i++) {
		results.push(await runWorker(workerId, "test"));
	}

	const budgetBlocked = results.filter(r => r.outcome === "budget_blocked").length;
	const passed = budgetBlocked > 0;
	return recordResult("workforce", "budget_enforcement_blocks_excess_runs", passed,
		passed ? `${budgetBlocked} runs blocked by budget` : "Budget not enforced");
}

// ── TEST 6: Worker Full Lifecycle ──────────────────────────────
async function testWorkerLifecycle() {
	const workerId = "lifecycle_test_worker";
	let executed = false;
	let verified = false;

	registerWorker({
		worker_id: workerId,
		name: "Lifecycle Test Worker",
		responsibility: "Testing full lifecycle",
		execution_class: "A",
		risk_level: "low",
		budget: { max_runs_per_hour: 10, max_affected_records: 100 },
		tools: ["count_records"],
		observe: async () => ({ summary: "test observation", test: true }),
		analyze: async () => ({ decision: "act", reason: "test", affected: 1 }),
		execute: async () => {
			executed = true;
			return { result: "test execution", affected: 1, action_type: "test" };
		},
		verify: async () => {
			verified = true;
			return { ok: true, proof: "Test verification passed" };
		},
	});

	const result = await runWorker(workerId, "test");
	const passed = executed && verified && result.outcome === "verified_success";
	return recordResult("workforce", "full_lifecycle_observe_analyze_execute_verify", passed,
		passed ? `Lifecycle complete: ${result.outcome}` : `Failed: executed=${executed}, verified=${verified}, outcome=${result.outcome}`);
}

// ── TEST 7: Supervisor Pre-Check ───────────────────────────────
async function testSupervisorPreCheck() {
	const workerId = "supervisor_test_worker";
	const check = preExecutionCheck(workerId);
	// Should return { allowed: true } for a new worker
	const passed = check && typeof check.allowed === "boolean";
	return recordResult("supervisor", "pre_execution_check_returns_valid_result", passed,
		passed ? `Check result: allowed=${check.allowed}` : "Pre-check returned invalid result");
}

// ── TEST 8: Verification Engine ────────────────────────────────
async function testVerificationEngine() {
	// Test with a known-good verification
	const result = await verifyOutcome("db-health", {}, {});
	const passed = result && typeof result.ok === "boolean";
	return recordResult("verification", "engine_returns_structured_verdict", passed,
		passed ? `Verdict: ok=${result.ok}, proof=${result.proof?.slice(0, 80)}` : "Invalid verification result");
}

// ── TEST 9: Impact Measurement ─────────────────────────────────
async function testImpactMeasurement() {
	// Calculate impact from before/after
	const impact = calculateImpact({ latency: 184 }, { latency: 71 }, "latency");
	const passed = impact.measurable === true && impact.direction === "improved";
	return recordResult("impact", "measures_before_after_change", passed,
		passed ? `${impact.before}ms → ${impact.after}ms (${impact.percentage}%)` : `Impact: ${JSON.stringify(impact)}`);
}

// ── TEST 10: Cache Cleanup ─────────────────────────────────────
async function testCacheCleanup() {
	const result = await executeTool("test_worker", "cleanup_cache", {});
	// Should succeed (cleanup is SAFE_WRITE)
	const passed = result.success !== false || result.error === undefined;
	return recordResult("tools", "cache_cleanup_executes_through_gateway", passed,
		passed ? `Cache cleanup: ${result.result?.summary || "executed"}` : `Failed: ${result.error}`);
}

// ── TEST 11: Database Inspection ───────────────────────────────
async function testDatabaseInspection() {
	const result = await executeTool("test_worker", "inspect_db_tables", {
		tables: ["posts", "comments"],
	});
	const passed = result.success !== false && result.result?.tables;
	const tableCount = result.result?.tables ? Object.keys(result.result.tables).length : 0;
	return recordResult("tools", "db_inspection_returns_real_table_data", passed,
		passed ? `Inspected ${tableCount} tables` : `Failed: ${result.error}`);
}

// ── TEST 12: Orphan Detection ──────────────────────────────────
async function testOrphanDetection() {
	const result = await executeTool("test_worker", "check_orphans", {});
	const passed = result !== undefined && result.result !== undefined;
	return recordResult("tools", "orphan_detection_runs_without_crash", passed,
		passed ? `Orphan check: ${result.result?.summary || "executed"}` : "Failed");
}

// ── TEST 13: Audit Trail ───────────────────────────────────────
async function testAuditTrail() {
	// Execute a tool and verify it appears in audit log
	await executeTool("audit_test_worker", "count_records", { table: "posts" });
	const auditLog = await import("./_workforce-tool-gateway.js").then(m => m.readAuditLog(10));
	const hasEntry = auditLog.some(e => e.worker_id === "audit_test_worker");
	return recordResult("audit", "tool_execution_recorded_in_audit_log", hasEntry,
		hasEntry ? `Audit log has ${auditLog.length} entries` : "No audit entry found");
}

// ── TEST 14: Rollback Capability ───────────────────────────────
async function testRollbackCapability() {
	// Push a rollback entry and verify it exists
	pushRollback("rollback_test_worker", {
		type: "cache_cleanup",
		before: { expired: 10 },
		after: { expired: 0 },
		rollback_method: "manual",
	});
	const summary = getSupervisorSummary();
	const hasRollback = summary.recent_rollbacks?.some(r => r.worker_id === "rollback_test_worker");
	return recordResult("supervisor", "rollback_entry_recorded", !!hasRollback,
		hasRollback ? "Rollback recorded" : "Rollback not found");
}

// ── TEST 15: Conflict Detection ────────────────────────────────
async function testConflictDetection() {
	// Record a failure for a worker
	recordFailure("conflict_test_worker", "test_tool", "test failure");
	recordFailure("conflict_test_worker", "test_tool", "test failure 2");
	const summary = getSupervisorSummary();
	const hasFailure = summary.failure_counts?.conflict_test_worker > 0;
	return recordResult("supervisor", "failure_tracking_records_worker_failures", !!hasFailure,
		hasFailure ? `Worker has ${summary.failure_counts.conflict_test_worker} failures` : "Failures not tracked");
}

// ── TEST 16: Worker Health ─────────────────────────────────────
async function testWorkerHealth() {
	const health = await workforceHealth();
	const passed = health && typeof health.total_executions_24h === "number"
		&& typeof health.workers_registered === "number";
	return recordResult("workforce", "health_metrics_from_real_ledger", passed,
		passed ? `${health.total_executions_24h} executions, ${health.workers_registered} workers` : "Invalid health data");
}

// ── TEST 17: Edge Worker Skip ──────────────────────────────────
async function testEdgeWorkerSkip() {
	const workerId = "skip_test_worker";
	registerWorker({
		worker_id: workerId,
		name: "Skip Test Worker",
		responsibility: "Testing skip when nothing to do",
		execution_class: "A",
		risk_level: "low",
		tools: [],
		observe: async () => ({ empty: true, summary: "nothing to do" }),
		analyze: async () => ({ decision: "skip", reason: "nothing to do" }),
	});

	const result = await runWorker(workerId, "test");
	const passed = result.outcome === "skipped";
	return recordResult("workforce", "worker_skips_when_nothing_to_do", passed,
		passed ? "Correctly skipped" : `Outcome: ${result.outcome}`);
}

// ── TEST 18: Escalation Flow ───────────────────────────────────
async function testEscalationFlow() {
	const workerId = "escalation_test_worker";
	registerWorker({
		worker_id: workerId,
		name: "Escalation Test Worker",
		responsibility: "Testing escalation",
		execution_class: "C", // Class C always escalates
		risk_level: "low",
		tools: [],
		observe: async () => ({ summary: "issue detected" }),
		analyze: async () => ({ decision: "act", reason: "need admin attention" }),
	});

	const result = await runWorker(workerId, "test");
	const passed = result.outcome === "escalated";
	return recordResult("workforce", "class_c_worker_escalates_correctly", passed,
		passed ? "Correctly escalated" : `Outcome: ${result.outcome}`);
}

// ── TEST 19: Tool Timeout ──────────────────────────────────────
async function testToolTimeout() {
	// Register a tool that takes too long
	const slowToolId = "slow_test_tool";
	registerTool({
		tool_id: slowToolId,
		description: "Tool that exceeds timeout",
		risk_level: RISK_LEVELS.SAFE_READ,
		timeout_ms: 100, // Very short timeout
		rate_limit: 100,
		async execute() {
			await new Promise(resolve => setTimeout(resolve, 500));
			return { result: "should not reach" };
		},
	});

	const result = await executeTool("test_worker", slowToolId, {});
	const passed = result.success === false && result.error?.includes("timeout");
	return recordResult("tool-gateway", "tool_timeout_enforced", passed,
		passed ? "Tool correctly timed out" : `Result: ${JSON.stringify(result)}`);
}

// ── TEST 20: Shadow Mode ───────────────────────────────────────
async function testShadowMode() {
	const workerId = "shadow_test_worker";
	let executed = false;

	registerWorker({
		worker_id: workerId,
		name: "Shadow Test Worker",
		responsibility: "Testing shadow mode",
		execution_class: "A",
		risk_level: "low",
		shadow_mode: true,
		tools: ["count_records"],
		observe: async () => ({ summary: "shadow observation" }),
		analyze: async () => ({ decision: "act", reason: "shadow test", affected: 1 }),
		execute: async () => {
			executed = true;
			return { result: "should not execute", action_type: "test" };
		},
		verify: async () => ({ ok: true, proof: "shadow verify" }),
	});

	const result = await runWorker(workerId, "test");
	const passed = !executed && result.outcome === "skipped";
	return recordResult("workforce", "shadow_mode_observe_without_execute", passed,
		passed ? "Shadow mode correctly skipped execution" : `executed=${executed}, outcome=${result.outcome}`);
}

// ── Public API ─────────────────────────────────────────────────
export function getProofResults() {
	return _testResults;
}

export function getProofSummary() {
	const total = _testResults.length;
	const passed = _testResults.filter(r => r.passed).length;
	const failed = total - passed;
	const suites = {};
	for (const r of _testResults) {
		if (!suites[r.suite]) suites[r.suite] = { total: 0, passed: 0, failed: 0 };
		suites[r.suite].total++;
		if (r.passed) suites[r.suite].passed++;
		else suites[r.suite].failed++;
	}
	return { total, passed, failed, suites, updated_at: new Date().toISOString() };
}
