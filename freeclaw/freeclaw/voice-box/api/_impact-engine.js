// ═══════════════════════════════════════════════════════════════════
// IMPACT ENGINE — Measurable before/after for every optimization
// ═══════════════════════════════════════════════════════════════════
// Every optimization must capture:
//   baseline → action → after_state → difference
//
// Example:
//   BEFORE: average query latency = 184ms
//   ACTION: create verified index
//   AFTER:  average query latency = 71ms
//   IMPACT: -61.4%
//
// If no measurable improvement: "NO MEASURABLE IMPROVEMENT"
// Do not claim success without measurement.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const IMPACT_KEY = "workforce_impact_log";
const IMPACT_MAX = 200;

// ── Baseline Collectors ───────────────────────────────────────
const _baselineCollectors = new Map();

/**
 * Register a baseline collector for a metric.
 * @param {string} metricName
 * @param {Function} collect - async () => number
 */
export function registerBaseline(metricName, collect) {
	_baselineCollectors.set(metricName, collect);
}

/**
 * Collect all registered baselines.
 */
export async function collectBaselines() {
	const baselines = {};
	for (const [name, collect] of _baselineCollectors) {
		try {
			baselines[name] = await collect();
		} catch {
			baselines[name] = null; // never fabricate
		}
	}
	return baselines;
}

// ── Register Built-in Baselines ───────────────────────────────

registerBaseline("db.latency_ms", async () => {
	const start = Date.now();
	await supabase.from("posts").select("id").limit(1);
	return Date.now() - start;
});

registerBaseline("db.post_count", async () => {
	const { count } = await supabase
		.from("posts")
		.select("*", { count: "exact", head: true });
	return count || 0;
});

registerBaseline("db.comment_count", async () => {
	const { count } = await supabase
		.from("comments")
		.select("*", { count: "exact", head: true });
	return count || 0;
});

registerBaseline("db.reaction_count", async () => {
	const { count } = await supabase
		.from("reactions")
		.select("*", { count: "exact", head: true });
	return count || 0;
});

registerBaseline("db.report_count", async () => {
	const { count } = await supabase
		.from("reports")
		.select("*", { count: "exact", head: true });
	return count || 0;
});

registerBaseline("db.settings_count", async () => {
	const { count } = await supabase
		.from("settings")
		.select("*", { count: "exact", head: true });
	return count || 0;
});

// ── Impact Recording ──────────────────────────────────────────
async function recordImpact(entry) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", IMPACT_KEY)
			.maybeSingle();

		const items = Array.isArray(data?.value?.items) ? data.value.items : [];
		items.unshift({
			...entry,
			recorded_at: new Date().toISOString(),
		});

		await supabase.from("settings").upsert(
			{
				key: IMPACT_KEY,
				value: {
					items: items.slice(0, IMPACT_MAX),
					updated_at: new Date().toISOString(),
				},
			},
			{ onConflict: "key" },
		);
	} catch (err) {
		console.error("[impact] failed to record:", err?.message);
	}
}

export async function readImpactLog(limit = 50) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", IMPACT_KEY)
			.maybeSingle();
		return (data?.value?.items || []).slice(0, limit);
	} catch {
		return [];
	}
}

// ── Main Impact Tracking Function ─────────────────────────────
/**
 * Track the impact of a worker execution.
 * Collects baseline → executes → collects after → calculates impact.
 */
export async function trackImpact(workerId, actionType, actionFn) {
	const t0 = Date.now();

	// 1. Collect baselines
	const baselines = await collectBaselines();

	// 2. Execute the action
	let result;
	try {
		result = await actionFn();
	} catch (err) {
		return {
			success: false,
			error: err.message,
			baselines,
			after: null,
			impact: null,
		};
	}

	// 3. Collect after-state
	const afterBaselines = await collectBaselines();

	// 4. Calculate impact for each metric
	const impacts = {};
	for (const metric of Object.keys(baselines)) {
		const before = baselines[metric];
		const after = afterBaselines[metric];
		if (before !== null && after !== null && typeof before === "number" && typeof after === "number") {
			const change = after - before;
			const percentage = before !== 0 ? ((change / before) * 100) : 0;
			impacts[metric] = {
				before,
				after,
				change,
				percentage: parseFloat(percentage.toFixed(1)),
				direction: change < 0 ? "improved" : change > 0 ? "regressed" : "unchanged",
			};
		}
	}

	// 5. Record the impact
	const impactEntry = {
		worker_id: workerId,
		action_type: actionType,
		duration_ms: Date.now() - t0,
		baselines,
		after: afterBaselines,
		impacts,
		result: result?.summary || "completed",
	};

	await recordImpact(impactEntry);

	return {
		success: true,
		result,
		impact: impacts,
		duration_ms: Date.now() - t0,
	};
}

// ── Impact Summary ────────────────────────────────────────────
/**
 * Get a summary of recent impacts.
 */
export async function getImpactSummary(limit = 20) {
	const log = await readImpactLog(limit);

	const summary = {
		total_actions: log.length,
		improved: 0,
		regressed: 0,
		unchanged: 0,
		no_data: 0,
		top_improvements: [],
		top_regressions: [],
	};

	for (const entry of log) {
		if (!entry.impacts || Object.keys(entry.impacts).length === 0) {
			summary.no_data++;
			continue;
		}

		let hasImprovement = false;
		let hasRegression = false;

		for (const [metric, impact] of Object.entries(entry.impacts)) {
			if (impact.direction === "improved") {
				hasImprovement = true;
				summary.top_improvements.push({
					worker: entry.worker_id,
					metric,
					before: impact.before,
					after: impact.after,
					percentage: impact.percentage,
					time: entry.recorded_at,
				});
			} else if (impact.direction === "regressed") {
				hasRegression = true;
				summary.top_regressions.push({
					worker: entry.worker_id,
					metric,
					before: impact.before,
					after: impact.after,
					percentage: impact.percentage,
					time: entry.recorded_at,
				});
			}
		}

		if (hasImprovement) summary.improved++;
		if (hasRegression) summary.regressed++;
		if (!hasImprovement && !hasRegression) summary.unchanged++;
	}

	// Sort by magnitude
	summary.top_improvements.sort((a, b) => a.percentage - b.percentage);
	summary.top_regressions.sort((a, b) => b.percentage - a.percentage);
	summary.top_improvements = summary.top_improvements.slice(0, 5);
	summary.top_regressions = summary.top_regressions.slice(0, 5);

	return summary;
}
