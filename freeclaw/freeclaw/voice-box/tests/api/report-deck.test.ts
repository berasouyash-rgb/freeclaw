// ═══════════════════════════════════════════════════════════════════
// Admin report deck — one endpoint, whole-platform report spec
// ═══════════════════════════════════════════════════════════════════
// Contract:
//   1. Admin-only: non-admin reads 403 before any DB round trip.
//   2. Empty DB → honest empty spec (zeros + empty lists + steady note),
//      never fabricated rows. version: 1 always present.
//   3. Seeded data → exact category mix, top-supported ordering, solved
//      counts, open/resolved report split, deterministic rule-labeled
//      recommendations (no LLM prose).
//   4. Test/fuzz artifact titles are excluded from every number.
//   5. solved_by_week buckets sum back to the solved total.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const tables: Record<string, Array<Record<string, unknown>>> = {
	posts: [],
	reactions: [],
	comments: [],
	polls: [],
	poll_votes: [],
	reports: [],
};

const from = vi.fn();

vi.mock("../../api/_cache.js", () => ({
	staleWhileRevalidate: () => ({
		invalidate: vi.fn(),
	}),
}));
vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

function chainFor(table: string) {
	const chain = {
		eqF: [] as Array<[string, unknown]>,
		inF: [] as Array<[string, unknown[]]>,
		rf: null as number | null,
		rt: null as number | null,
		lim: null as number | null,
		select() {
			return this;
		},
		eq(col: string, val: unknown) {
			this.eqF.push([col, val]);
			return this;
		},
		neq() {
			return this;
		},
		in(col: string, values: unknown[]) {
			this.inF.push([col, values]);
			return this;
		},
		order() {
			return this;
		},
		limit(n: number) {
			this.lim = n;
			return this;
		},
		range(f: number, t: number) {
			this.rf = f;
			this.rt = t;
			return this;
		},
		maybeSingle() {
			return this;
		},
		then(onResolve: (v: unknown) => void) {
			let rows = (tables[table] || []).filter(
				(r) =>
					this.eqF.every(([c, v]) => r[c] === v) &&
					this.inF.every(([c, vs]) => vs.includes(r[c])),
			);
			if (this.rf !== null && this.rt !== null)
				rows = rows.slice(this.rf, this.rt + 1);
			else rows = rows.slice(0, 1000);
			if (this.lim !== null) rows = rows.slice(0, this.lim);
			onResolve({ data: rows, error: null });
			return Promise.resolve(undefined);
		},
	};
	return chain;
}

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(body: unknown) {
			res.body = body;
			return res;
		},
		end() {
			return res;
		},
		setHeader() {
			return res;
		},
	};
	return res;
}

async function get(admin: boolean) {
	const { isAdmin } = await import("../../api/_auth.js");
	(isAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(admin);
	const { default: handler } = await import("../../api/_report-deck.js");
	const res = response();
	await handler({ method: "GET", query: {}, headers: {}, body: {} }, res);
	return res;
}

function seed() {
	const old = new Date(Date.now() - 40 * 86400000).toISOString();
	const now = new Date().toISOString();
	tables.posts = [
		{ id: "p1", title: "Bus late every day", category: "Transport", status: "reported", created_at: old, updated_at: old, deleted: false, hidden: false },
		{ id: "p2", title: "Bus overcrowded", category: "Transport", status: "reported", created_at: now, updated_at: now, deleted: false, hidden: false },
		{ id: "p3", title: "Canteen food cold", category: "Food", status: "reported", created_at: now, updated_at: now, deleted: false, hidden: false },
		{ id: "p4", title: "Library closed early", category: "Library", status: "solved", created_at: old, updated_at: now, deleted: false, hidden: false },
		{ id: "p5", title: "Test poll 210147 fuzz", category: "Other", status: "reported", created_at: now, updated_at: now, deleted: false, hidden: false },
		{ id: "p6", title: "Math homework load", category: "Academics", status: "in_progress", created_at: now, updated_at: now, deleted: false, hidden: false },
	];
	tables.reactions = [
		{ target_id: "p1", kind: "support", author_id: "a" },
		{ target_id: "p1", kind: "support", author_id: "b" },
		{ target_id: "p1", kind: "support", author_id: "c" },
		{ target_id: "p2", kind: "support", author_id: "a" },
		{ target_id: "p4", kind: "support", author_id: "a" },
	];
	tables.comments = [];
	tables.polls = [{ id: "poll-1", post_id: null, title: "Fix the bus?" }];
	tables.poll_votes = [
		{ poll_id: "poll-1" },
		{ poll_id: "poll-1" },
	];
	tables.reports = [
		{ id: "r1", status: "pending" },
		{ id: "r2", status: "resolved" },
	];
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const k of Object.keys(tables)) tables[k] = [];
	from.mockImplementation((table: string) => chainFor(table));
});

describe("GET /api/report-deck", () => {
	it("denies non-admins before any DB round trip", async () => {
		const res = await get(false);
		expect(res.statusCode).toBe(403);
		expect(from).not.toHaveBeenCalled();
	});

	it("rejects non-GET methods", async () => {
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		const { default: handler } = await import("../../api/_report-deck.js");
		const res = response();
		await handler({ method: "POST", query: {}, headers: {}, body: {} }, res);
		expect(res.statusCode).toBe(405);
	});

	it("returns an honest empty spec on an empty database", async () => {
		const res = await get(true);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			version: 1,
			totals: {
				posts: 0,
				open: 0,
				solved: 0,
				reports_open: 0,
				reports_resolved: 0,
				polls: 0,
				votes: 0,
			},
			by_category: [],
			top_supported: [],
			top_polls: [],
		});
		expect(typeof (res.body as { generated_at?: unknown }).generated_at).toBe("string");
		const recs = (res.body as { recommendations: Array<{ rule: string }> }).recommendations;
		expect(recs.length).toBe(1);
		expect(recs[0].rule).toBe("steady");
	});

	it("computes exact mixes, tops, and rule-labeled recommendations", async () => {
		seed();
		const res = await get(true);
		expect(res.statusCode).toBe(200);
		const body = res.body as {
			version: number;
			totals: Record<string, number>;
			by_category: Array<{ category: string; open: number; solved: number; total: number }>;
			top_supported: Array<{ id: string; support: number }>;
			top_polls: Array<{ id: string; total: number }>;
			solved_by_week: Array<{ week: string; solved: number }>;
			recommendations: Array<{ rule: string; text: string }>;
		};
		expect(body.version).toBe(1);
		// p5 is a fuzz artifact: excluded from every number.
		expect(body.totals.posts).toBe(5);
		expect(body.totals.open).toBe(4);
		expect(body.totals.solved).toBe(1);
		expect(body.totals.reports_open).toBe(1);
		expect(body.totals.reports_resolved).toBe(1);
		expect(body.totals.polls).toBe(1);
		expect(body.totals.votes).toBe(2);
		const transport = body.by_category.find((c) => c.category === "Transport");
		expect(transport).toMatchObject({ open: 2, solved: 0, total: 2 });
		expect(body.by_category[0].category).toBe("Transport");
		expect(body.top_supported[0]).toMatchObject({ id: "p1", support: 3 });
		expect(body.top_polls).toEqual([{ id: "poll-1", title: "Fix the bus?", total: 2 }]);
		// Weekly buckets reconcile to the solved total.
		expect(
			body.solved_by_week.reduce((n, w) => n + w.solved, 0),
		).toBe(1);
		const rules = body.recommendations.map((r) => r.rule);
		// Transport holds 2/4 open (50% ≥ 30%) + p1 is 40 days old.
		expect(rules).toContain("category-dominance");
		expect(rules).toContain("backlog-age");
		for (const r of body.recommendations) {
			expect(typeof r.text).toBe("string");
			expect(r.text.length).toBeGreaterThan(10);
		}
	});

	it("notes low resolution rate with a labeled rule", async () => {
		seed();
		// 1 solved / 5 live = 20% < 25% with ≥ 5 live rows.
		const res = await get(true);
		const rules = (
			res.body as { recommendations: Array<{ rule: string }> }
		).recommendations.map((r) => r.rule);
		expect(rules).toContain("resolution-rate");
	});
});
