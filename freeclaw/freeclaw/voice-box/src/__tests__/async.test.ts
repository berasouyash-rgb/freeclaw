// ═══════════════════════════════════════════════════════════════════
// mapWithConcurrency — bounded-concurrency bulk execution
// ═══════════════════════════════════════════════════════════════════
// Locks the property the admin bulk actions depend on: bulk work runs
// IN PARALLEL (fast) but never more than `limit` at once (no connection
// exhaustion / rate-limit storm on a large selection).
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";
import { BULK_CONCURRENCY, mapWithConcurrency } from "../lib/async";

describe("mapWithConcurrency", () => {
	it("preserves input order in the results", async () => {
		const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
		expect(out.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
			2, 4, 6, 8, 10,
		]);
	});

	it("never exceeds the concurrency limit", async () => {
		let inFlight = 0;
		let peak = 0;
		await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 8, async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((r) => setTimeout(r, 1));
			inFlight--;
		});
		expect(peak).toBeLessThanOrEqual(8);
		expect(peak).toBeGreaterThan(1); // actually parallel, not sequential
	});

	it("is materially faster than a sequential loop", async () => {
		const ids = Array.from({ length: 24 }, (_, i) => i);
		const work = () => new Promise((r) => setTimeout(r, 10));

		const started = Date.now();
		await mapWithConcurrency(ids, 8, work);
		const parallelMs = Date.now() - started;

		// 24 × 10ms sequential would be ≥240ms; 8 lanes is ~3 batches (~30ms).
		expect(parallelMs).toBeLessThan(200);
	});

	it("reports per-item failures without aborting the batch", async () => {
		const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
			if (n === 2) throw new Error("protected");
			return n;
		});
		expect(out[0]).toMatchObject({ status: "fulfilled", value: 1 });
		expect(out[1]).toMatchObject({ status: "rejected" });
		expect(out[2]).toMatchObject({ status: "fulfilled", value: 3 });
	});

	it("handles an empty batch and a limit larger than the batch", async () => {
		const worker = vi.fn(async (n: number) => n);
		expect(await mapWithConcurrency([], 8, worker)).toEqual([]);
		expect(await mapWithConcurrency([1, 2], 99, worker)).toHaveLength(2);
	});

	it("exports a sane default limit", () => {
		expect(BULK_CONCURRENCY).toBeGreaterThan(1);
		expect(BULK_CONCURRENCY).toBeLessThanOrEqual(16);
	});
});
