// ═══════════════════════════════════════════════════════════════════
// CONTINUOUS LEARNING — Production evidence → evaluation → improve
// ═══════════════════════════════════════════════════════════════════
// The learning pipeline:
//   PRODUCTION EVIDENCE → DATASET → EVALUATION → CANDIDATE →
//   TEST → CANARY → RELEASE
//
// Workers cannot silently change themselves in production.
// All behavior-changing updates go through:
//   TEST → EVALUATE → CANARY → MONITOR → RELEASE
//
// This module also manages worker versioning, autonomy levels,
// and the production approval pipeline.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { getRegistry, readLedger } from "./_workforce-core.js";
import { registerEvaluation, runFullEvaluation, getEvaluationCases } from "./_evaluation-engine.js";
import { getScorecard, calculateScorecard } from "./_evaluation-engine.js";
import { getMemoryStats, storeMemory, MemoryType } from "./_worker-memory.js";
import { getSupervisorSummary } from "./_worker-supervisor.js";

const VERSION_KEY = "workforce_versions";
const CANARY_KEY = "workforce_canaries";
const LEARNING_KEY = "workforce_learning";

// ── Autonomy Levels ────────────────────────────────────────────
export const AutonomyLevel = {
	OBSERVE_ONLY: 0,      // read metrics, diagnose only
	RECOMMEND: 1,         // recommend actions to admin
	SAFE_EXECUTE: 2,      // execute safe actions (cache, derived data)
	CONTROLLED: 3,        // execute controlled actions (config, indexes)
	FULL_AUTONOMOUS: 4,   // within strict policies
	EMERGENCY: 5,         // emergency automation
};

/**
 * Calculate autonomy level based on evidence.
 * Earned through successful evaluations, low failure rate, etc.
 */
export async function calculateAutonomyLevel(workerId) {
	const scorecard = await getScorecard(workerId);
	if (!scorecard) return AutonomyLevel.OBSERVE_ONLY;

	const health = scorecard.overall_health || 0;
	const safety = scorecard.safety_score || 0;
	const rollback = scorecard.rollback_rate || 0;
	const success = scorecard.task_success_rate || 0;

	// Earn autonomy through evidence
	if (health >= 90 && safety >= 95 && rollback < 5 && success >= 95) {
		return AutonomyLevel.FULL_AUTONOMOUS;
	}
	if (health >= 80 && safety >= 85 && rollback < 10 && success >= 85) {
		return AutonomyLevel.CONTROLLED;
	}
	if (health >= 70 && safety >= 80 && rollback < 15 && success >= 75) {
		return AutonomyLevel.SAFE_EXECUTE;
	}
	if (health >= 50 && safety >= 70) {
		return AutonomyLevel.RECOMMEND;
	}
	return AutonomyLevel.OBSERVE_ONLY;
}

// ── Worker Versioning ──────────────────────────────────────────

/**
 * Record a new worker version.
 */
export async function recordVersion(workerId, versionInfo) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", VERSION_KEY)
			.maybeSingle();

		const versions = data?.value?.versions || {};
		if (!versions[workerId]) versions[workerId] = [];

		versions[workerId].unshift({
			version: versionInfo.version || "1.0.0",
			author: versionInfo.author || "system",
			reason: versionInfo.reason || "initial version",
			evaluation_result: versionInfo.evaluation || null,
			tools_changed: versionInfo.tools_changed || [],
			model_changed: versionInfo.model_changed || false,
			policy_changed: versionInfo.policy_changed || false,
			recorded_at: new Date().toISOString(),
		});

		// Keep last 20 versions per worker
		if (versions[workerId].length > 20) versions[workerId].length = 20;

		await supabase.from("settings").upsert(
			{
				key: VERSION_KEY,
				value: { versions, updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);

		return true;
	} catch (err) {
		console.error("[learning] version record failed:", err?.message);
		return false;
	}
}

/**
 * Get version history for a worker.
 */
export async function getVersionHistory(workerId) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", VERSION_KEY)
			.maybeSingle();

		return data?.value?.versions?.[workerId] || [];
	} catch {
		return [];
	}
}

// ── Canary System ──────────────────────────────────────────────

/**
 * Register a canary deployment for a worker version.
 */
export async function registerCanary(workerId, version, config = {}) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", CANARY_KEY)
			.maybeSingle();

		const canaries = data?.value?.canaries || {};
		canaries[workerId] = {
			version,
			traffic_pct: config.traffic_pct || 10,
			status: "active",
			started_at: new Date().toISOString(),
			metrics: { success: 0, failure: 0, rollback: 0 },
			config,
		};

		await supabase.from("settings").upsert(
			{
				key: CANARY_KEY,
				value: { canaries, updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);

		return canaries[workerId];
	} catch (err) {
		console.error("[learning] canary registration failed:", err?.message);
		return null;
	}
}

/**
 * Record canary metrics.
 */
export async function recordCanaryMetric(workerId, success) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", CANARY_KEY)
			.maybeSingle();

		const canaries = data?.value?.canaries || {};
		const canary = canaries[workerId];
		if (!canary || canary.status !== "active") return null;

		if (success) canary.metrics.success++;
		else canary.metrics.failure++;

		await supabase.from("settings").upsert(
			{
				key: CANARY_KEY,
				value: { canaries, updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);

		return canary;
	} catch {
		return null;
	}
}

/**
 * Evaluate canary results and decide: expand, rollback, or keep.
 */
export async function evaluateCanary(workerId) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", CANARY_KEY)
			.maybeSingle();

		const canary = data?.value?.canaries?.[workerId];
		if (!canary || canary.status !== "active") {
			return { decision: "no_active_canary", reason: "No active canary for this worker" };
		}

		const total = canary.metrics.success + canary.metrics.failure;
		if (total < 5) {
			return { decision: "insufficient_data", reason: `Only ${total} observations (need 5+)` };
		}

		const successRate = canary.metrics.success / total;

		if (successRate >= 0.9) {
			return {
				decision: "expand",
				reason: `Success rate ${(successRate * 100).toFixed(1)}% meets threshold`,
				metrics: canary.metrics,
			};
		} else if (successRate < 0.7) {
			return {
				decision: "rollback",
				reason: `Success rate ${(successRate * 100).toFixed(1)}% below threshold`,
				metrics: canary.metrics,
			};
		}
		return {
			decision: "keep",
			reason: `Success rate ${(successRate * 100).toFixed(1)}% — monitoring`,
			metrics: canary.metrics,
		};
	} catch (err) {
		return { decision: "error", reason: err.message };
	}
}

// ── Continuous Learning Pipeline ────────────────────────────────

/**
 * Collect production evidence and generate learning opportunities.
 */
export async function collectProductionEvidence() {
	const ledger = await readLedger(200);
	const supervisor = getSupervisorSummary();
	const memoryStats = await getMemoryStats();
	const now = Date.now();
	const last24h = ledger.filter(r => now - new Date(r.started_at).getTime() < 24 * 3600 * 1000);

	// Identify patterns
	const failures = last24h.filter(r => r.outcome === "verified_failure" || r.outcome === "execution_failed");
	const successes = last24h.filter(r => r.outcome === "verified_success");
	const escalations = last24h.filter(r => r.outcome === "escalated");

	// Group failures by worker
	const failuresByWorker = {};
	for (const f of failures) {
		if (!failuresByWorker[f.worker_id]) failuresByWorker[f.worker_id] = [];
		failuresByWorker[f.worker_id].push(f);
	}

	return {
		period: "24h",
		total_executions: last24h.length,
		successes: successes.length,
		failures: failures.length,
		escalations: escalations.length,
		failures_by_worker: failuresByWorker,
		memory_stats: memoryStats,
		supervisor_summary: supervisor,
		generated_at: new Date().toISOString(),
	};
}

/**
 * Generate evaluation cases from production evidence.
 * When a worker fails repeatedly, create a test case from the failure.
 */
export async function generateEvalFromFailures() {
	const evidence = await collectProductionEvidence();
	const generated = [];

	for (const [workerId, failures] of Object.entries(evidence.failures_by_worker)) {
		if (failures.length < 2) continue; // need repeated failure

		const existingCases = getEvaluationCases(workerId);
		const existingNames = new Set(existingCases.map(c => c.name));

		// Create a regression test from the failure pattern
		const testName = `regression_from_failure_${Date.now().toString(36)}`;
		if (existingNames.has(testName)) continue; // already have this test

		const newCase = {
			name: testName,
			type: "REGRESSION",
			input: {
				scenario: "production_failure",
				failure_count: failures.length,
				recent_error: failures[0]?.error || "unknown",
			},
			expected_tools: [], // derived from actual worker tools
			success_conditions: [
				{ type: "verification" },
			],
			requires_verification: true,
			max_tool_calls: 10,
			production_evidence: true,
			generated_from: failures.map(f => f.id),
		};

		registerEvaluation(workerId, [newCase]);
		generated.push({ worker_id: workerId, case: newCase.name });
	}

	return {
		generated_cases: generated.length,
		details: generated,
		generated_at: new Date().toISOString(),
	};
}

/**
 * Run continuous evaluation for all workers.
 */
// Outcomes that represent a worker actually *attempting* work. `budget_blocked`
// and `skipped` mean the worker never acted, so they must not count as failures
// (that would make an idle worker look broken).
const ATTEMPT_OUTCOMES = new Set([
	"verified_success",
	"verified_failure",
	"execution_failed",
	"rolled_back",
]);

/**
 * Derive a worker's production metrics from its real ledger rows.
 *
 * The ledger is the only durable evidence of what a worker actually did, so it
 * is the honest basis for a scorecard. Exported for testing.
 */
export function scorecardMetricsFromLedger(rows = []) {
	const attempted = rows.filter((r) => ATTEMPT_OUTCOMES.has(r.outcome));
	const attempts = attempted.length;
	const success = attempted.filter((r) => r.outcome === "verified_success").length;
	const rollback = attempted.filter((r) => r.outcome === "rolled_back").length;
	// Independent verification must be present on the row, not assumed.
	const verified = attempted.filter((r) => r.verification != null).length;
	const durations = attempted
		.map((r) => r.duration_ms)
		.filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);

	return {
		attempts,
		success_rate: attempts ? Math.round((success / attempts) * 100) : 0,
		rollback_rate: attempts ? Math.round((rollback / attempts) * 100) : 0,
		verification_rate: attempts ? Math.round((verified / attempts) * 100) : 0,
		avg_latency: durations.length
			? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
			: 0,
		impact_summary: `${success} verified change(s) from ${attempts} attempt(s)`,
		source: "production_ledger",
	};
}

/**
 * Build real scorecards from production evidence.
 *
 * Previously this only *read* scorecards, so `workforce_scorecards` was always
 * empty in production: nothing ever ran the evaluation datasets (there is no
 * workerFn to evaluate against), so nothing ever wrote a card. It now derives
 * each card from the ledger — the measured outcome of real worker runs.
 *
 * Workers with no attempted work get no card: "no evidence" is reported
 * explicitly rather than fabricated as 0% success.
 */
export async function runContinuousEvaluation() {
	const registry = getRegistry();
	const versionById = new Map(registry.map((w) => [w.worker_id, w.version]));
	const ledger = await readLedger(500);

	const byWorker = new Map();
	for (const row of ledger) {
		if (!row?.worker_id) continue;
		if (!byWorker.has(row.worker_id)) byWorker.set(row.worker_id, []);
		byWorker.get(row.worker_id).push(row);
	}

	// Enumerate from BOTH the registry and the ledger. The ledger knows who
	// actually ran, while the registry is empty in request paths that never
	// import the worker definitions (which is exactly how this was reached
	// before, yielding zero scorecards).
	const ids = [
		...new Set([...registry.map((w) => w.worker_id), ...byWorker.keys()]),
	].sort();

	const results = [];
	const withoutEvidence = [];

	for (const id of ids) {
		const metrics = scorecardMetricsFromLedger(byWorker.get(id) || []);

		if (metrics.attempts === 0) {
			withoutEvidence.push(id);
			continue;
		}

		const scorecard = await calculateScorecard(id, metrics, null);
		const autonomyLevel = await calculateAutonomyLevel(id);

		results.push({
			worker_id: id,
			version: versionById.get(id) ?? null,
			// Registered dataset size — NOT a count of cases actually run: no
			// automated eval runner is wired, so we must not imply one ran.
			registered_eval_cases: getEvaluationCases(id).length,
			scorecard,
			autonomy_level: autonomyLevel,
			autonomy_name:
				Object.entries(AutonomyLevel).find(([, v]) => v === autonomyLevel)?.[0] ||
				"UNKNOWN",
		});
	}

	return {
		workers_evaluated: results.length,
		workers_without_evidence: withoutEvidence.length,
		scorecard_source: "production_ledger",
		results,
		evaluated_at: new Date().toISOString(),
	};
}

/**
 * Get the full learning status for admin display.
 */
export async function getLearningStatus() {
	const [evidence, evaluation, memoryStats, versions] = await Promise.all([
		collectProductionEvidence(),
		runContinuousEvaluation(),
		getMemoryStats(),
		getAllVersions(),
	]);

	return {
		evidence,
		evaluation,
		memory: memoryStats,
		versions,
		updated_at: new Date().toISOString(),
	};
}

/**
 * Get all worker versions.
 */
async function getAllVersions() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", VERSION_KEY)
			.maybeSingle();

		return data?.value?.versions || {};
	} catch {
		return {};
	}
}

/**
 * Get all canaries.
 */
export async function getAllCanaries() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", CANARY_KEY)
			.maybeSingle();

		return data?.value?.canaries || {};
	} catch {
		return {};
	}
}
