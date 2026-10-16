/**
 * REAL-WORK WORKERS — regression tests for the workers added to replace
 * "security review theater" with verifiable state change.
 *
 * The contract under test (mirrors workforce-reality.test.ts):
 *   observe → analyze → execute (REAL mutation) → verify (re-read evidence)
 *
 * These tests fail if a worker:
 *   - never reaches its mutation (decision routing broken), or
 *   - claims verified_success without its post-condition holding.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Minimal chainable Supabase stub ─────────────────────────────
// Mirrors workforce-reality.test.ts. Backed by a fake datastore so the
// workers can be driven through full observe→execute→verify cycles.

type Row = Record<string, unknown>;

function makeTable(initial: Row[] = []) {
	const rows = initial.slice();
	const table = {
		rows,
		builder() {
			type Filter = (r: Row) => boolean;
			const state = {
				filters: [] as Filter[],
				selectedCols: "*",
				orderCol: null as string | null,
				orderAsc: true,
				limitN: null as number | null,
				countMode: null as "exact" | null,
				headMode: false,
				payload: null as Row | null,
				notCol: null as string | null,
				notVal: null as unknown,
			};
			const b: any = {
				select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
					if (opts?.count) state.countMode = "exact";
					if (opts?.head) state.headMode = true;
					return b;
				},
				eq: (col: string, val: unknown) => {
					state.filters.push((r) => r[col] === val);
					return b;
				},
				neq: (col: string, val: unknown) => {
					state.filters.push((r) => r[col] !== val);
					return b;
				},
				gt: (col: string, val: unknown) => {
					state.filters.push((r) => Number(r[col]) > Number(val));
					return b;
				},
				gte: (col: string, val: unknown) => {
					state.filters.push((r) => Number(r[col]) >= Number(val));
					return b;
				},
				lt: (col: string, val: unknown) => {
					state.filters.push((r) => Number(r[col]) < Number(val) || (val instanceof Date) || (typeof val === "string" && !isNaN(Date.parse(val)) && String(r[col]) < val));
					return b;
				},
				lte: (col: string, val: unknown) => {
					state.filters.push((r) => Number(r[col]) <= Number(val));
					return b;
				},
				in: (col: string, vals: unknown[]) => {
					const set = new Set(vals);
					state.filters.push((r) => set.has(r[col]));
					return b;
				},
				not: (col: string, _op: string, val: unknown) => {
					state.filters.push((r) => r[col] !== val);
					return b;
				},
				or: () => b,
				ilike: (col: string, pat: string) => {
					const needle = pat.replace(/%/g, "").toLowerCase();
					state.filters.push((r) => String(r[col]).toLowerCase().includes(needle));
					return b;
				},
				order: (col: string, opts?: { ascending?: boolean }) => {
					state.orderCol = col;
					state.orderAsc = opts?.ascending !== false;
					return b;
				},
				limit: (n: number) => {
					state.limitN = n;
					return b;
				},
				range: () => b,
				maybeSingle: async () => {
					const found = apply();
					return { data: found[0] ?? null, error: null };
				},
				single: async () => {
					const found = apply();
					return { data: found[0] ?? null, error: null };
				},
				update: (payload: Row) => {
					state.payload = payload;
					return b;
				},
				insert: async (payload: Row | Row[]) => ({ data: payload, error: null }),
				upsert: async (payload: Row | Row[]) => ({ data: payload, error: null }),
				delete: () => b,
				// Await resolves with the query result.
				then: (resolve: (v: unknown) => unknown) =>
					Promise.resolve({
						data: apply(),
						error: null,
						count: state.countMode === "exact" ? apply().length : 0,
					}).then(resolve),
			};
			function apply() {
				let out = table.rows.filter((r) => state.filters.every((f) => f(r)));
				if (state.orderCol) {
					const col = state.orderCol as string;
					out = out.slice().sort((a, b2) => {
						const av: unknown = a[col];
						const bv: unknown = b2[col];
						const cmp =
							av === bv ? 0 : String(av) > String(bv) ? 1 : -1;
						return state.orderAsc ? cmp : -cmp;
					});
				}
				if (state.limitN != null) out = out.slice(0, state.limitN);
				return out;
			}
			// For mutation terminators: .update(...).eq(...).then / .eq chain
			// must apply on await. We intercept `then` after update too.
			// Store the mutation on the builder and apply at await time.
			const origThen = b.then;
			b.then = (resolve: (v: unknown) => unknown) => {
				if (state.payload && state.filters.length > 0) {
					let n = 0;
					for (const r of table.rows) {
						if (state.filters.every((f) => f(r))) {
							Object.assign(r, state.payload);
							n++;
						}
					}
					state.payload = null;
					return Promise.resolve({ data: null, error: null, count: n }).then(resolve);
				}
				return origThen(resolve);
			};
			return b;
		},
	};
	return table;
}

const tables: Record<string, ReturnType<typeof makeTable>> = {};

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (name: string) => tables[name]?.builder() ?? makeTable().builder(),
		rpc: async () => ({ data: null }),
	},
}));

vi.mock("../../api/_worker-memory.js", () => ({
	storeMemory: async () => undefined,
	MemoryType: { EPISODIC: "episodic", FAILURE: "failure" },
}));

vi.mock("../../api/_cache.js", () => ({
	cacheStats: () => ({ totalEntries: 0, expiredEntries: 0 }),
	cleanupCache: () => undefined,
}));

beforeEach(() => {
	// Fresh tables per test.
	tables["users_meta"] = makeTable();
	tables["posts"] = makeTable();
	tables["settings"] = makeTable();
	vi.clearAllMocks?.();
});

import { getRegistry, runWorker } from "../../api/_workforce-core.js";
// Side-effect import: registers all real workers. Static so vitest resolves
// it before any test runs (a floating dynamic import races the suite).
import "../../api/_workforce-workers.js";

describe("suspension-lifecycle — real expiry with verified post-condition", () => {
	it("clears an expired suspension and verifies via re-read", async () => {
		const past = new Date(Date.now() - 3600_000).toISOString();
		tables["users_meta"] = makeTable([
			{ anon_id: "expired-user", suspended_until: past },
			{ anon_id: "still-active", suspended_until: new Date(Date.now() + 3600_000).toISOString() },
		]);

		const row = await runWorker("suspension-lifecycle", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.decision).toMatch(/1 suspension/);
		// The REAL post-condition: the expired row no longer carries a gate.
		expect(tables["users_meta"]?.rows[0]?.suspended_until).toBeNull();
		// The active suspension is untouched.
		expect(tables["users_meta"]?.rows[1]?.suspended_until).toBeTruthy();
	});

	it("skips when nobody is expired (no fake work)", async () => {
		tables["users_meta"] = makeTable([
			{ anon_id: "clean", suspended_until: null },
		]);
		const row = await runWorker("suspension-lifecycle", "test");
		expect(row.outcome).toBe("skipped");
	});
});

describe("counter-reconciliation — repairs real drift between stored counts and sources", () => {
	it("repairs drifted comment_count and verifies by re-read", async () => {
		tables["posts"] = makeTable([
			{ id: "p1", comment_count: 5, created_at: "2026-09-17T10:00:00Z" }, // drift (actual 1)
			{ id: "p2", comment_count: 0, created_at: "2026-09-17T09:00:00Z" }, // no drift (actual 0)
		]);
		tables["comments"] = makeTable([
			{ post_id: "p1", deleted: false, hidden: false },
			{ post_id: "p2", deleted: true, hidden: false }, // must NOT count
		]);

		const row = await runWorker("counter-reconciliation", "test");
		expect(row.outcome).toBe("verified_success");
		// p1 stored 5 → repaired to the true count of 1.
		expect(tables["posts"]?.rows[0]?.comment_count).toBe(1);
		// p2 untouched (deleted comments never counted).
		expect(tables["posts"]?.rows[1]?.comment_count).toBe(0);
	});
});

describe("spam-score-decay — halves stale scores, verified by re-read", () => {
	it("decays a stale score to its half", async () => {
		tables["users_meta"] = makeTable([
			{ anon_id: "recovering-user", spam_score: 8, created_at: "2026-01-01T00:00:00Z" },
		]);

		const row = await runWorker("spam-score-decay", "test");
		expect(row.outcome).toBe("verified_success");
		expect(tables["users_meta"]?.rows[0]?.spam_score).toBe(4);
	});

	it("never touches users with a zero score", async () => {
		tables["users_meta"] = makeTable([
			{ anon_id: "clean-user", spam_score: 0, created_at: "2026-01-01T00:00:00Z" },
		]);
		const row = await runWorker("spam-score-decay", "test");
		expect(row.outcome).toBe("skipped");
	});
});

describe("authz-probe — honest unknown, never a fabricated pass", () => {
	it("reports an honest unknown when no base URL exists (shadow mode)", async () => {
		delete process.env.VERCEL_URL;
		delete process.env.APP_BASE_URL;
		const row = await runWorker("authz-probe", "test");
		// Shadow mode: observe+analyze only, never executes, never claims a pass.
		expect(["shadowed", "skipped", "escalated"]).toContain(row.outcome);
	});
});

describe("roster — the real-work workers are registered and in the roster", () => {
	it("registers all four workers with real responsibilities", async () => {
		await import("../../api/_workforce-workers.js");
		const reg = getRegistry();
		const need = [
			"suspension-lifecycle",
			"counter-reconciliation",
			"spam-score-decay",
			"authz-probe",
		];
		for (const id of need) {
			const w = (reg as Array<{ worker_id: string; responsibility: string }>).find(
				(r) => r.worker_id === id,
			);
			expect(w, `${id} must be registered`).toBeTruthy();
			expect(w!.responsibility, `${id} responsibility`).toBeTruthy();
		}
	});
});
