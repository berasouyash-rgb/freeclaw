// ═══════════════════════════════════════════════════════════════════
// Worker measurement — measure() records real measured numbers (spec §49)
// ═══════════════════════════════════════════════════════════════════
// Locks: session-cleaner, poll-archiver, and content-quality record
// before/after (or observed/acted) measurements from values the worker
// itself read — never derived-from-nothing. And a Class-C evidence-only
// worker records NO metrics on a no-action run (a metric there would be
// fabricated: its measure phase is unreachable by design).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

function settingsTable() {
	return {
		select: () => ({
			eq: (_c: string, key: string) => ({
				maybeSingle: async () => ({
					data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
					error: null,
				}),
			}),
			limit: async () => ({ data: [], error: null }),
			// Direct-await count reads (independent engine verifier).
			then: (resolve: (v: unknown) => void) =>
				Promise.resolve({ data: null, count: 1, error: null }).then(resolve),
		}),
		upsert: async (row: { key: string; value: unknown }) => {
			kv.store.set(row.key, row.value);
			return { error: null };
		},
	};
}

function emptyTable() {
	const q: Record<string, unknown> = {};
	return new Proxy(q, {
		get(_t, p) {
			if (p === "then")
				return (res: (v: unknown) => unknown) =>
					Promise.resolve({ data: [], error: null }).then(res);
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data: null, error: null });
			return (..._a: unknown[]) => emptyTable();
		},
	});
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => (table === "settings" ? settingsTable() : emptyTable()),
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => {}),
}));

import { readLedger, runWorker } from "../../api/_workforce-core.js";
import { resetSupervisorState } from "../../api/_worker-supervisor.js";
import "../../api/_workforce-workers.js";

async function resetFrom() {
	const { default: supabase } = await import("../../api/_db-client.js");
	(supabase.from as ReturnType<typeof vi.fn>) = vi.fn((table: string) =>
		table === "settings" ? settingsTable() : emptyTable(),
	);
}

beforeEach(async () => {
	kv.store.clear();
	vi.clearAllMocks();
	resetSupervisorState();
	await resetFrom();
});

describe("measured workers record real before/after numbers", () => {
	it("session-cleaner measures tokens before/after the purge", async () => {
		const now = Date.now();
		kv.store.set("admin_sessions", {
			tokens: [{ exp: now - 1000 }, { exp: now + 3600000 }],
		});
		const row = await runWorker("session-cleaner", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.metrics).toMatchObject({
			metric: "admin_sessions.tokens",
			before: 2,
			after: 1,
			purged: 1,
		});
		const [ledger] = await readLedger(5);
		expect(ledger.metrics).toMatchObject({ before: 2, after: 1 });
	});

	it("poll-archiver measures observed vs archived polls", async () => {
		const { default: supabase } = await import("../../api/_db-client.js");
		let archived = false;
		(supabase.from as ReturnType<typeof vi.fn>) = vi.fn((table: string) => {
			if (table === "settings") return settingsTable();
			// polls: count/update/recount chain with real state flip
			const q: Record<string, unknown> = {};
			const chain = () => q;
			for (const m of ["select", "eq", "not", "lt", "update", "in"]) q[m] = vi.fn(chain);
			(q.then as unknown) = (resolve: (v: unknown) => void) => {
				const updated = (q.update as ReturnType<typeof vi.fn>).mock.calls.length > 0;
				if (updated) archived = true;
				return Promise.resolve(
					updated
						? { data: [{ id: "p1" }], error: null }
						: { data: [], count: archived ? 0 : 1, error: null },
				).then(resolve);
			};
			return q;
		});
		const row = await runWorker("poll-archiver", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.metrics).toMatchObject({
			metric: "polls.expired_archived",
			observed: 1,
			archived: 1,
		});
	});

	it("content-quality measures observed vs flagged posts", async () => {
		const { default: supabase } = await import("../../api/_db-client.js");
		let flagged = false;
		(supabase.from as ReturnType<typeof vi.fn>) = vi.fn((table: string) => {
			if (table === "settings") return settingsTable();
			const q: Record<string, unknown> = {};
			for (const m of ["select", "eq", "lt", "limit", "update", "in"])
				q[m] = vi.fn(() => q);
			(q.ilike as unknown) = vi.fn(() => ({
				limit: async () => ({ data: [{ id: "p1" }], error: null }),
			}));
			(q.maybeSingle as unknown) = vi.fn(async () => ({ data: null, error: null }));
			(q.then as unknown) = (resolve: (v: unknown) => void) => {
				const updated = (q.update as ReturnType<typeof vi.fn>).mock.calls.length > 0;
				if (updated) flagged = true;
				const status = flagged ? "pending_review" : "reported";
				const rows = [
					{
						id: "p1",
						title: "x",
						description: "",
						status,
						created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
					},
				];
				return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
			};
			return q;
		});
		const row = await runWorker("content-quality", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.metrics).toMatchObject({
			metric: "posts.low_quality_flagged",
			observed: 1,
			flagged: 1,
		});
	});
});

describe("evidence-only workers fabricate no metrics", () => {
	it("spam-sentinel on a quiet window skips with null metrics", async () => {
		const row = await runWorker("spam-sentinel", "test");
		expect(row.outcome).toBe("skipped");
		expect(row.metrics).toBeNull();
	});
});
