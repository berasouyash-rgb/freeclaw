/**
 * WORKFORCE REALITY — regression tests for the autonomous-worker engine.
 *
 * These lock in three defects that silently made the workforce report work it
 * never performed:
 *
 *   1. `execute` was called as `execute(decision)` only. Four registered
 *      workers read their rows from a second argument (`evidence`), so they
 *      operated on an empty set on every single run.
 *   2. `verify` returning a bare `{ ok: true }` was accepted as proof. Five
 *      workers did exactly that, so "verified_success" in the ledger meant
 *      nothing for them.
 *   3. `platform-health` wrote a synthesised score that no code ever read.
 *      It has been retired and must not creep back into the roster.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Minimal chainable Supabase stub ─────────────────────────────
// The engine touches `settings` for the ledger + budget and nothing else.
const settingsValue = { data: null as unknown };

vi.mock("../../api/_db-client.js", () => {
	const builder = {
		select: () => builder,
		eq: () => builder,
		order: () => builder,
		limit: () => builder,
		maybeSingle: async () => settingsValue,
		single: async () => settingsValue,
		upsert: async () => ({ error: null }),
		update: () => builder,
		insert: async () => ({ error: null }),
		in: () => builder,
		lt: () => builder,
		gt: () => builder,
		gte: () => builder,
		not: () => builder,
		ilike: () => builder,
		or: () => builder,
		range: () => builder,
		then: (resolve: (v: unknown) => unknown) =>
			Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
	};
	return {
		default: { from: () => builder, rpc: async () => ({ data: null }) },
	};
});

vi.mock("../../api/_worker-memory.js", () => ({
	storeMemory: async () => undefined,
	MemoryType: { EPISODIC: "episodic", FAILURE: "failure" },
}));

vi.mock("../../api/_cache.js", () => ({
	cacheStats: () => ({ totalEntries: 0, expiredEntries: 0 }),
	cleanupCache: () => undefined,
}));

import { getRegistry, registerWorker, runWorker } from "../../api/_workforce-core.js";

describe("workforce engine — evidence is forwarded to execute", () => {
	it("passes the collected evidence to execute()", async () => {
		let received: unknown = "NOT_CALLED";

		registerWorker({
			worker_id: "test-evidence-forwarding",
			name: "Evidence Forwarding Test",
			responsibility: "Regression: execute must receive the evidence argument",
			execution_class: "A",
			observe: async () => ({ summary: "one row", rows: [{ id: "p1" }] }),
			analyze: async () => ({ decision: "act", reason: "1 row" }),
			execute: async (_dec: unknown, ev: unknown) => {
				received = ev;
				return { action_type: "test", affected: 1 };
			},
			verify: async () => ({ ok: true, proof: "test proof" }),
		});

		const row = await runWorker("test-evidence-forwarding", "test");

		expect(received).toEqual({ summary: "one row", rows: [{ id: "p1" }] });
		expect(row.outcome).toBe("verified_success");
	});
});

describe("workforce engine — verification must carry evidence", () => {
	it("downgrades a bare { ok: true } with no proof to a failure", async () => {
		registerWorker({
			worker_id: "test-no-proof",
			name: "No-Proof Verification Test",
			responsibility: "Regression: ok:true without proof is not evidence",
			execution_class: "A",
			observe: async () => ({ summary: "something" }),
			analyze: async () => ({ decision: "act", reason: "act" }),
			execute: async () => ({ action_type: "test", affected: 1 }),
			// The exact shape five real workers used to return.
			verify: async () => ({ ok: true }) as { ok: boolean; proof?: string },
		});

		const row = await runWorker("test-no-proof", "test");

		expect(row.outcome).toBe("verified_failure");
		expect(row.verification).toMatch(/no evidence/i);
	});

	it("accepts a verdict that states its proof", async () => {
		registerWorker({
			worker_id: "test-with-proof",
			name: "With-Proof Verification Test",
			responsibility: "A verdict that states real evidence still passes",
			execution_class: "A",
			observe: async () => ({ summary: "something" }),
			analyze: async () => ({ decision: "act", reason: "act" }),
			execute: async () => ({ action_type: "test", affected: 1 }),
			verify: async () => ({ ok: true, proof: "3/3 rows persisted" }),
		});

		const row = await runWorker("test-with-proof", "test");

		expect(row.outcome).toBe("verified_success");
		expect(row.verification).toBe("3/3 rows persisted");
	});
});

describe("workforce roster — retired workers stay retired", () => {
	it("no longer registers platform-health (unconsumed synthesised score)", async () => {
		// Importing the module runs every registerWorker() call.
		await import("../../api/_workforce-workers.js");
		const ids = (getRegistry() as Array<{ worker_id: string }>).map((w) => w.worker_id);

		expect(ids).not.toContain("platform-health");
		// The workers that DO have real consumers must still be present.
		expect(ids).toContain("content-enricher");
		expect(ids).toContain("priority-scaler");
		expect(ids).toContain("search-quality");
		expect(ids).toContain("data-consistency");
	});

	it("gives every registered worker a responsibility and a class", async () => {
		await import("../../api/_workforce-workers.js");
		for (const w of getRegistry() as Array<{
			worker_id: string;
			responsibility: string;
			execution_class: string;
		}>) {
			expect(w.worker_id, "worker_id").toBeTruthy();
			expect(w.responsibility, `${w.worker_id} responsibility`).toBeTruthy();
			expect(["A", "B", "C"], `${w.worker_id} class`).toContain(
				w.execution_class,
			);
		}
	});
});

beforeEach(() => {
	settingsValue.data = null;
});
