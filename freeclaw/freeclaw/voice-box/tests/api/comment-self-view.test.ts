// ═══════════════════════════════════════════════════════════════════
// GET /api/comments — self-view of moderation-hidden comments
// ═══════════════════════════════════════════════════════════════════
// An admin hide of a student's comment must NOT make it silently vanish
// from the author's own thread — the same hole posts already fixed with
// isSelfView ("otherwise an admin hide … vanishes with no explanation").
// The rule under test:
//
//   • hidden row  → returned ONLY to its own author (viewer === author_id)
//   • hidden row  → never returned to any other viewer / anonymous read
//   • soft-deleted row → never self-visible (author chose removal; undo
//     already existed at delete time)
//   • paginated total → still counts ONLY public rows (honest count even
//     when the author's own hidden row is in `data`)
//
// Unlike comments-full.test.ts (whose chain ignores eq() filters — fine
// for shape tests), this file uses a FILTER-HONORING chain so the
// DB-side eq("hidden") filter is actually simulated, and the JS self-view
// filter is the only thing that can deliver an own hidden row.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = {
	comments: [] as Row[],
	posts: [] as Row[],
};

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

const authMocks = {
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "" })),
};

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(() => Promise.resolve()),
	emitEventAndBridge: vi.fn(() => Promise.resolve()),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, requiresReview: false, flags: [] })),
	recordSafetyRepost: vi.fn(async () => false),
	checkSafetyRepost: vi.fn(async () => ({ blocked: false })),
}));
vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContent: vi.fn(() => ({
		action: "ALLOW",
		classification: "clean",
		confidence: "high",
		policy: null,
		reasons: [],
		trace: [],
		flags: [],
		language: "en",
		blocked: false,
		needsReview: false,
	})),
	evaluateContentAsync: vi.fn(async () => ({
		action: "ALLOW",
		classification: "clean",
		confidence: "high",
		policy: null,
		reasons: [],
		trace: [],
		flags: [],
		language: "en",
		blocked: false,
		needsReview: false,
	})),
	evaluateContentDeep: vi.fn(async () => ({
		action: "ALLOW",
		classification: "clean",
		confidence: "high",
		policy: null,
		reasons: [],
		trace: [],
		flags: [],
		language: "en",
		blocked: false,
		needsReview: false,
	})),
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

/** Faithful PostgREST: eq() filters are APPLIED, headCount counts the
 *  filtered set, order() sorts the returned copy — so a DB-side
 *  eq("hidden", false) genuinely excludes rows here (unlike
 *  comments-full.test.ts, whose chain drops filters on the floor). */
function chainFor(table: string) {
	const filters: Array<[string, unknown]> = [];
	let op = "select";
	let orderBy: { col: string; asc: boolean } | null = null;
	const rowsOf = () =>
		table === "posts" ? state.posts : state.comments;
	const build = () => {
		let rows = rowsOf().filter((r) =>
			filters.every(([col, val]) => r?.[col] === val),
		);
		if (orderBy) {
			const { col, asc } = orderBy;
			rows = [...rows].sort((a, b) => {
				const av = String(a?.[col] ?? "");
				const bv = String(b?.[col] ?? "");
				return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
			});
		}
		return rows;
	};
	const chain = {
		select(_col?: unknown, opts?: unknown) {
			if ((opts as { count?: string } | undefined)?.count === "exact")
				op = "headCount";
			return chain;
		},
		eq(col?: unknown, val?: unknown) {
			if (typeof col === "string") filters.push([col, val]);
			return chain;
		},
		lt() {
			// Cursor narrowing is not exercised in this file (all fixtures
			// share one created_at); keep it a no-op so no fabricated eq
			// filter can silently empty the result set.
			return chain;
		},
		gte() {
			return chain;
		},
		in() {
			return chain;
		},
		order(col?: unknown, opts?: unknown) {
			if (typeof col === "string")
				orderBy = {
					col,
					asc: (opts as { ascending?: boolean } | undefined)?.ascending === true,
				};
			return chain;
		},
		limit() {
			return chain;
		},
		maybeSingle() {
			op = "maybeSingle";
			return chain;
		},
		single() {
			return chain;
		},
		then(resolve: (v: unknown) => void) {
			const rows = build();
			if (op === "maybeSingle") resolve({ data: rows[0] ?? null, error: null });
			else if (op === "headCount")
				resolve({ count: rows.length, data: null, error: null });
			else resolve({ data: rows, error: null });
		},
	};
	return chain;
}

function makeComment(overrides: Row = {}): Row {
	return {
		id: "c1",
		post_id: "p1",
		parent_id: null,
		author_id: "anon-2",
		body: "a perfectly fine comment",
		hidden: false,
		deleted: false,
		is_admin: false,
		created_at: "2026-10-01T00:00:00.000Z",
		...overrides,
	};
}

async function get(query: Record<string, unknown>) {
	const { default: handler } = await import("../../api/_comments.js");
	const res = response();
	await handler({ method: "GET", query, body: {}, headers: {} }, res);
	return res;
}

type ThreadRow = { id: string; hidden?: boolean; is_mine?: boolean; author_id?: string };

beforeEach(() => {
	state.comments = [];
	state.posts = [];
	from.mockReset();
	from.mockImplementation((table: string) => chainFor(table));
	authMocks.isAdmin.mockReset();
	authMocks.isAdmin.mockResolvedValue(false);
});

describe("GET /api/comments — author self-view of hidden comments", () => {
	it("returns the author's OWN hidden comment, flagged hidden + is_mine", async () => {
		state.comments = [
			makeComment({ id: "c-mine", author_id: "anon-2", hidden: true, body: "held thought" }),
			makeComment({ id: "c-public", author_id: "anon-9" }),
		];
		const res = await get({ post_id: "p1", viewer: "anon-2" });
		expect(res.statusCode).toBe(200);
		const body = res.body as ThreadRow[];
		const own = body.find((c) => c.id === "c-mine");
		expect(own, "author must still see their own hidden comment").toBeTruthy();
		expect(own?.hidden).toBe(true);
		expect(own?.is_mine).toBe(true);
		expect(body.find((c) => c.id === "c-public")).toBeTruthy();
	});

	it("never returns another viewer's hidden comment", async () => {
		state.comments = [
			makeComment({ id: "c-mine", author_id: "anon-2", hidden: true }),
			makeComment({ id: "c-public", author_id: "anon-9" }),
		];
		const res = await get({ post_id: "p1", viewer: "anon-9" });
		expect(res.statusCode).toBe(200);
		const body = res.body as ThreadRow[];
		expect(body.find((c) => c.id === "c-mine")).toBeUndefined();
		expect(body.find((c) => c.id === "c-public")).toBeTruthy();
	});

	it("excludes hidden comments when no viewer identifies themselves", async () => {
		state.comments = [
			makeComment({ id: "c-hidden", author_id: "anon-2", hidden: true }),
			makeComment({ id: "c-public" }),
		];
		const res = await get({ post_id: "p1" });
		expect(res.statusCode).toBe(200);
		const body = res.body as ThreadRow[];
		expect(body.find((c) => c.id === "c-hidden")).toBeUndefined();
		expect(body.find((c) => c.id === "c-public")).toBeTruthy();
	});

	it("never self-shows a soft-deleted comment, even the author's own", async () => {
		state.comments = [
			makeComment({ id: "c-deleted", author_id: "anon-2", deleted: true }),
			makeComment({ id: "c-public" }),
		];
		const res = await get({ post_id: "p1", viewer: "anon-2" });
		expect(res.statusCode).toBe(200);
		const body = res.body as ThreadRow[];
		expect(body.find((c) => c.id === "c-deleted")).toBeUndefined();
	});

	it("paginated: data carries the own hidden row while total stays public-only", async () => {
		state.comments = [
			makeComment({ id: "c-mine", author_id: "anon-2", hidden: true }),
			makeComment({ id: "c-public", author_id: "anon-9" }),
		];
		const res = await get({ post_id: "p1", viewer: "anon-2", paginate: "1" });
		expect(res.statusCode).toBe(200);
		const body = res.body as { data: ThreadRow[]; total: number };
		expect(
			body.data.find((c) => c.id === "c-mine"),
			"own hidden comment must appear in the paginated thread",
		).toBeTruthy();
		// Honest count: hidden rows are never public, so total must not grow.
		expect(body.total).toBe(1);
	});

	it("My Activity shape (author+viewer): own hidden in, other authors' hidden out", async () => {
		state.comments = [
			makeComment({ id: "c-mine-hidden", author_id: "anon-2", hidden: true }),
			makeComment({ id: "c-other-hidden", author_id: "anon-9", hidden: true }),
			makeComment({ id: "c-other-public", author_id: "anon-9" }),
		];
		// Own listing: hidden self row must survive.
		const ownRes = await get({ author: "anon-2", viewer: "anon-2" });
		expect(ownRes.statusCode).toBe(200);
		const ownBody = ownRes.body as ThreadRow[];
		expect(ownBody.find((c) => c.id === "c-mine-hidden")).toBeTruthy();

		// Someone else's listing viewed as anon-2: their hidden row stays out.
		const otherRes = await get({ author: "anon-9", viewer: "anon-2" });
		expect(otherRes.statusCode).toBe(200);
		const otherBody = otherRes.body as ThreadRow[];
		expect(otherBody.find((c) => c.id === "c-other-hidden")).toBeUndefined();
		expect(otherBody.find((c) => c.id === "c-other-public")).toBeTruthy();
	});
});
