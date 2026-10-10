// ═══════════════════════════════════════════════════════════════════
// Continuous learning — scorecards must come from REAL ledger rows
// ═══════════════════════════════════════════════════════════════════
// Regression guard: runContinuousEvaluation() used to only *read* scorecards,
// and nothing in the codebase ever wrote one (runFullEvaluation and
// calculateScorecard were imported but never called), so
// `workforce_scorecards` was permanently empty in production.
//
// These tests lock the two properties that make a scorecard honest:
//   1. only real attempts count — an idle worker is not a failing worker;
//   2. verification is only credited when the ledger row actually carries a
//      verification result.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({ default: {} }));

import { scorecardMetricsFromLedger } from "../../api/_continuous-learning.js";

const row = (outcome: string, extra: Record<string, unknown> = {}) => ({
	worker_id: "test-worker",
	outcome,
	...extra,
});

describe("scorecardMetricsFromLedger", () => {
	it("does not count idle outcomes as attempts", () => {
		const metrics = scorecardMetricsFromLedger([
			row("budget_blocked"),
			row("skipped"),
			row("skipped"),
			row("escalated"),
		]);

		// An idle worker must not look like a failing one.
		expect(metrics.attempts).toBe(0);
		expect(metrics.success_rate).toBe(0);
		expect(metrics.rollback_rate).toBe(0);
		expect(metrics.verification_rate).toBe(0);
	});

	it("derives success rate from verified outcomes only", () => {
		const metrics = scorecardMetricsFromLedger([
			row("verified_success"),
			row("verified_failure"),
			row("verified_failure"),
			row("execution_failed"),
			row("budget_blocked"), // must not dilute the denominator
		]);

		expect(metrics.attempts).toBe(4);
		expect(metrics.success_rate).toBe(25);
		expect(metrics.impact_summary).toContain("1 verified change(s) from 4 attempt(s)");
	});

	it("credits verification only when the row carries one", () => {
		const metrics = scorecardMetricsFromLedger([
			row("verified_success", { verification: { passed: true } }),
			row("verified_success"), // no verification recorded
		]);

		expect(metrics.attempts).toBe(2);
		expect(metrics.verification_rate).toBe(50);
	});

	it("computes rollback rate against attempts", () => {
		const metrics = scorecardMetricsFromLedger([
			row("verified_success"),
			row("rolled_back"),
			row("rolled_back"),
			row("rolled_back"),
		]);

		expect(metrics.attempts).toBe(4);
		expect(metrics.rollback_rate).toBe(75);
	});

	it("averages latency over numeric durations only", () => {
		const metrics = scorecardMetricsFromLedger([
			row("verified_success", { duration_ms: 100 }),
			row("verified_success", { duration_ms: 300 }),
			row("verified_success", { duration_ms: null }),
			row("verified_success", { duration_ms: -5 }),
		]);

		expect(metrics.avg_latency).toBe(200);
	});

	it("returns finite zeros for no rows — never NaN", () => {
		const metrics = scorecardMetricsFromLedger([]);

		expect(metrics.attempts).toBe(0);
		expect(metrics.avg_latency).toBe(0);
		for (const value of Object.values(metrics)) {
			if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
		}
		expect(metrics.source).toBe("production_ledger");
	});
});
