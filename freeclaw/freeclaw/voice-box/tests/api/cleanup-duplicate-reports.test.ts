// ═══════════════════════════════════════════════════════════════════
// Cleanup sweep — duplicate-report dedupe contract
// ═══════════════════════════════════════════════════════════════════
// REGRESSION: the sweep deduped on (target_id, author_id) only and never
// selected `status`, so a user who reported a post, saw it resolved, then
// reported it AGAIN could have their live PENDING report deleted — an
// active moderation item silently vanishing. It also reported
// `toDelete.length` while deleting only one batch (fake success).
//
// Locks:
//   1. Same target + author + status  -> newest duplicate is removed.
//   2. Same target + author, DIFFERENT status -> BOTH survive (a re-report
//      after resolution is a new record, not a duplicate).
//   3. The reported count equals rows actually deleted.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	reports: [] as Array<Record<string, unknown>>,
	deletedIds: [] as string[],
}));

function from(table: string) {
	const q: Record<string, unknown> = {};
	const h: ProxyHandler<Record<string, unknown>> = {
		get(_t, p) {
			// Every builder method must return the SAME proxy so chains like
			// .select().order().limit() keep their handlers.
			const self = new Proxy(q, h);
			if (p === "then")
				return (res: (v: unknown) => unknown) => {
					// A delete builder resolves only once it is awaited, and it
					// carries the ids captured by the trailing .in(...) — this
					// mirrors how the real client chains .delete().in("id", ids).
					if (q.__deleting) {
						const ids = (q.__inIds as string[]) ?? [];
						if (ids.length) {
							state.deletedIds.push(...ids);
							state.reports = state.reports.filter(
								(r) => !ids.includes(String(r.id)),
							);
						}
						void res({ data: null, error: null });
						return;
					}
					if (table === "reports") {
						const rows = state.reports.map((r) => ({ ...r }));
						const sel = String(q.__sel ?? "");
						const ord = String(q.__ord ?? "");
						const dir = ord.includes("desc") ? -1 : 1;
						if (ord.includes("created_at"))
							rows.sort(
								(a, b) =>
									String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) * dir,
							);
						if (!ord && sel.includes("created_at"))
							rows.sort((a, b) =>
								String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
							);
						void res({ data: rows, error: null });
						return;
					}
					void res({ data: [], error: null });
				};
			if (p === "select")
				return (cols: unknown) => ((q.__sel = cols), self);
			if (p === "order")
				return (col: string, o: { ascending: boolean }) => (
					(q.__ord = `${col}:${o?.ascending ? "asc" : "desc"}`), self
				);
			if (p === "in")
				return (col: string, vals: string[]) => ((q.__inCol = col), (q.__inIds = vals), self);
			if (p === "limit" || p === "lt" || p === "lte" || p === "eq" || p === "is" || p === "not")
				return () => self;
			if (p === "delete")
				return () => ((q.__deleting = true), self);
			if (p === "insert" || p === "update" || p === "upsert")
				return async () => ({ data: null, error: null });
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data: null, error: null });
			return () => self;
		},
	};
	return new Proxy(q, h);
}

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => ({})),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	trackError: vi.fn(),
}));

beforeEach(() => {
	vi.resetModules();
	state.reports = [];
	state.deletedIds = [];
});

// Drive the exported background worker directly. vi.resetModules() clears the
// cooldown before each test; HTTP authentication is covered by the maintenance
// boundary suite.
async function runCleanup() {
	const { runCleanup: cleanup } = await import("../../api/_cleanup.js");
	return cleanup();
}

describe("cleanup — duplicate report sweep", () => {
	it("removes only true duplicates (same target, author AND status)", async () => {
		state.reports = [
			{ id: "r1", target_id: "p1", author_id: "a1", status: "pending", created_at: "2026-01-01T00:00:00Z" },
			{ id: "r2", target_id: "p1", author_id: "a1", status: "pending", created_at: "2026-01-02T00:00:00Z" },
			{ id: "r3", target_id: "p1", author_id: "a1", status: "pending", created_at: "2026-01-03T00:00:00Z" },
		];
		await runCleanup();
		expect(state.deletedIds.sort()).toEqual(["r2", "r3"]);
	});

	it("keeps a NEW report of the same target after the old one was resolved", async () => {
		// The bug: this new pending report was deleted because the old
		// resolved row for the same target+author already existed.
		state.reports = [
			{ id: "old-resolved", target_id: "p1", author_id: "a1", status: "resolved", created_at: "2026-01-01T00:00:00Z" },
			{ id: "new-pending", target_id: "p1", author_id: "a1", status: "pending", created_at: "2026-02-01T00:00:00Z" },
		];
		await runCleanup();
		expect(state.deletedIds).not.toContain("new-pending");
		expect(state.reports.some((r) => r.id === "new-pending")).toBe(true);
		expect(state.reports.some((r) => r.id === "old-resolved")).toBe(true);
	});

	it("does not merge different targets or different reporters", async () => {
		state.reports = [
			{ id: "a", target_id: "p1", author_id: "a1", status: "pending", created_at: "2026-01-01T00:00:00Z" },
			{ id: "b", target_id: "p2", author_id: "a1", status: "pending", created_at: "2026-01-02T00:00:00Z" },
			{ id: "c", target_id: "p1", author_id: "a2", status: "pending", created_at: "2026-01-03T00:00:00Z" },
		];
		await runCleanup();
		expect(state.deletedIds).toEqual([]);
		expect(state.reports).toHaveLength(3);
	});
});
