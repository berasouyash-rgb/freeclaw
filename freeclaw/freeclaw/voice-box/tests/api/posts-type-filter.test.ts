// ═══════════════════════════════════════════════════════════════════
// Posts API — content-type filter contract (problem / suggestion / poll)
// ═══════════════════════════════════════════════════════════════════
// `posts.type` only ever holds "problem" or "suggestion". A poll is a POST
// plus a `polls` row pointing back at it via `post_id`, so `?type=poll`
// cannot be a plain `.eq("type", "poll")` — that predicate matches zero rows.
// The handler must resolve the linked post ids first and narrow by id set.
//
// The mocks below are FILTER-AWARE: every predicate (`eq`, `neq`, `in`,
// `not`, `lt`, `gte`, `range`, `limit`, `order`) is recorded and applied to
// `tableData[table]` when the chain is awaited. That is what lets these tests
// distinguish "filtered in SQL" from "returned everything and filtered in JS".
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const tableData: Record<string, Row[]> = {};

// Every chain `from()` hands out, so tests can assert which tables were read.
const builtChains: Array<{ table: string }> = [];

const feedCacheMock = vi.hoisted(() => {
	const state: { wrapped: { mockClear: () => void } | null } = { wrapped: null };
	return {
		state,
		staleWhileRevalidate: vi.fn((fn: (...args: unknown[]) => unknown) => {
			const wrapped = vi.fn(fn);
			state.wrapped = wrapped;
			return wrapped;
		}),
	};
});

vi.mock("../../api/_cache.js", () => ({
	staleWhileRevalidate: feedCacheMock.staleWhileRevalidate,
}));

interface ChainState {
	table: string;
	predicates: Array<(r: Row) => boolean>;
	orderCol: string | null;
	orderAsc: boolean;
	limitN: number | null;
	rangeStart: number | null;
	rangeEnd: number | null;
	countExact: boolean;
	head: boolean;
	single: boolean;
	maybeSingle: boolean;
	wrote: boolean;
}

function chainFor(table: string) {
	const s: ChainState = {
		table,
		predicates: [],
		orderCol: null,
		orderAsc: false,
		limitN: null,
		rangeStart: null,
		rangeEnd: null,
		countExact: false,
		head: false,
		single: false,
		maybeSingle: false,
		wrote: false,
	};

	const chain = {
		table,
		select(_col: unknown, opts?: { count?: string; head?: boolean }) {
			s.countExact = opts?.count === "exact";
			s.head = !!opts?.head;
			return chain;
		},
		eq(col: string, val: unknown) {
			s.predicates.push((r) => r[col] === val);
			return chain;
		},
		neq(col: string, val: unknown) {
			s.predicates.push((r) => r[col] !== val);
			return chain;
		},
		in(col: string, vals: unknown[]) {
			const set = new Set(vals as unknown[]);
			s.predicates.push((r) => set.has(r[col]));
			return chain;
		},
		not(col: string, op: string, val: unknown) {
			if (op === "is" && val === null)
				s.predicates.push((r) => r[col] !== null && r[col] !== undefined);
			else s.predicates.push((r) => JSON.stringify(r[col]) !== JSON.stringify(val));
			return chain;
		},
		lt(col: string, val: unknown) {
			s.predicates.push((r) => String(r[col]) < String(val));
			return chain;
		},
		lte(col: string, val: unknown) {
			s.predicates.push((r) => String(r[col]) <= String(val));
			return chain;
		},
		gt(col: string, val: unknown) {
			s.predicates.push((r) => String(r[col]) > String(val));
			return chain;
		},
		gte(col: string, val: unknown) {
			s.predicates.push((r) => String(r[col]) >= String(val));
			return chain;
		},
		or() {
			// Free-text search is not under test here; treat as "matches all".
			return chain;
		},
		order(col: string, opts?: { ascending?: boolean }) {
			s.orderCol = col;
			s.orderAsc = !!opts?.ascending;
			return chain;
		},
		limit(n: number) {
			s.limitN = n;
			return chain;
		},
		range(from: number, to: number) {
			s.rangeStart = from;
			s.rangeEnd = to;
			return chain;
		},
		single() {
			s.single = true;
			return chain;
		},
		maybeSingle() {
			s.maybeSingle = true;
			return chain;
		},
		update() {
			s.wrote = true;
			return chain;
		},
		insert() {
			s.wrote = true;
			return chain;
		},
		delete() {
			s.wrote = true;
			return chain;
		},
		then(onResolve: (v: unknown) => void, onReject?: (e: unknown) => void) {
			try {
				const all = (tableData[table] ?? []).slice();
				const filtered = all.filter((r) => s.predicates.every((p) => p(r)));

				let rows = filtered;
				if (s.orderCol) {
					const col = s.orderCol;
					rows = rows.slice().sort((a, b) => {
						const av = String(a[col]);
						const bv = String(b[col]);
						if (av === bv) return 0;
						const cmp = av < bv ? -1 : 1;
						return s.orderAsc ? cmp : -cmp;
					});
				}
				if (s.rangeStart !== null && s.rangeEnd !== null)
					rows = rows.slice(s.rangeStart, s.rangeEnd + 1);
				if (s.limitN !== null) rows = rows.slice(0, s.limitN);

				if (s.wrote) {
					onResolve({ data: null, error: null, count: null });
					return;
				}
				if (s.countExact && s.head) {
					onResolve({ data: null, error: null, count: filtered.length });
					return;
				}
				if (s.maybeSingle) {
					onResolve({ data: rows[0] ?? null, error: null, count: null });
					return;
				}
				if (s.single) {
					onResolve({ data: rows[0] ?? null, error: null, count: null });
					return;
				}
				onResolve({
					data: rows,
					error: null,
					count: s.countExact ? filtered.length : null,
				});
			} catch (err) {
				if (onReject) onReject(err);
				else throw err;
			}
		},
	};

	builtChains.push(chain);
	return chain;
}

const from = vi.fn((table: string) => chainFor(table));

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn(),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
}));
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
	serverModerate: () => ({ blocked: false, requiresReview: false, flags: [] }),
	recordSafetyRepost: () => Promise.resolve(false),
	checkSafetyRepost: () => Promise.resolve({ blocked: false }),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
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

/** A clean, public, visible post row. */
function post(id: string, type: "problem" | "suggestion", createdAt: string): Row {
	return {
		id,
		title: `Reported issue ${id}`,
		type,
		category: "Facilities",
		status: "reported",
		author_id: "anon-1234",
		hidden: false,
		deleted: false,
		visibility: "public",
		created_at: createdAt,
		updated_at: createdAt,
		admin_reply: null,
	};
}

function poll(id: string, postId: string | null, createdAt: string): Row {
	return { id, post_id: postId, created_at: createdAt, question: "Which one?" };
}

function idsOf(body: unknown): string[] {
	return (body as Row[]).map((r) => String(r.id));
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	builtChains.length = 0;
	feedCacheMock.state.wrapped = null;
	for (const key of Object.keys(tableData)) delete tableData[key];

	tableData["settings"] = [];
	tableData["posts"] = [
		post("p1", "problem", "2026-07-26T00:00:00Z"),
		post("p2", "suggestion", "2026-07-25T00:00:00Z"),
		post("p3", "problem", "2026-07-24T00:00:00Z"),
		post("p4", "suggestion", "2026-07-23T00:00:00Z"),
		// Hidden row linked to a poll: must never surface in any list.
		{ ...post("p5", "problem", "2026-07-22T00:00:00Z"), hidden: true },
	];
	tableData["polls"] = [
		poll("poll-a", "p3", "2026-07-24T00:00:00Z"),
		poll("poll-b", "p4", "2026-07-23T00:00:00Z"),
		// Duplicate link to the same post: the id set must dedupe.
		poll("poll-c", "p3", "2026-07-22T00:00:00Z"),
		// Null link: filtered out by `.not("post_id", "is", null)`.
		poll("poll-null", null, "2026-07-21T00:00:00Z"),
		// Link to a hidden post: resolved, but the row is still filtered out.
		poll("poll-hidden", "p5", "2026-07-20T00:00:00Z"),
	];
});

async function get(query: Record<string, string>) {
	const { default: handler } = await import("../../api/_posts.js");
	const res = response();
	await handler({ method: "GET", query, body: {}, headers: {} }, res);
	return res;
}

describe("GET /api/posts?type= — content-type filter", () => {
	it("returns only posts that have a poll attached for ?type=poll", async () => {
		const res = await get({ type: "poll" });

		expect(res.statusCode).toBe(200);
		const ids = idsOf(res.body);
		expect(ids.sort()).toEqual(["p3", "p4"]);
		// The duplicate link did not duplicate rows.
		expect(ids).toHaveLength(2);
	});

	it("returns an empty feed for ?type=poll when no post has a poll", async () => {
		tableData["polls"] = [];

		const res = await get({ type: "poll" });

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual([]);
	});

	it("returns only problems for ?type=problem", async () => {
		const res = await get({ type: "problem" });

		expect(res.statusCode).toBe(200);
		// p3 is a problem that also carries a poll — still a problem.
		expect(idsOf(res.body).sort()).toEqual(["p1", "p3"]);
	});

	it("returns only suggestions for ?type=suggestion", async () => {
		const res = await get({ type: "suggestion" });

		expect(res.statusCode).toBe(200);
		expect(idsOf(res.body).sort()).toEqual(["p2", "p4"]);
	});

	it("treats ?type=all as unfiltered", async () => {
		const res = await get({ type: "all" });

		expect(res.statusCode).toBe(200);
		expect(idsOf(res.body).sort()).toEqual(["p1", "p2", "p3", "p4"]);
	});

	it("keeps the historic 'matches nothing' behaviour for an unknown type", async () => {
		const res = await get({ type: "announcement" });

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual([]);
	});

	it("scopes the deeper-page total count to the poll id set", async () => {
		// Page 1: two poll-linked rows, one per page. nextCursor is p3's time.
		const first = await get({ type: "poll", paginate: "1", limit: "1" });
		expect(first.statusCode).toBe(200);
		const firstBody = first.body as { data: Row[]; nextCursor: string; total: number };
		expect(firstBody.data.map((r) => r.id)).toEqual(["p3"]);
		expect(firstBody.nextCursor).toBe("2026-07-24T00:00:00Z");
		expect(firstBody.total).toBe(2);

		// Page 2 runs the SQL COUNT path. Without applyTypeFilter on that query
		// it would report every visible post (4), not the poll subset (2).
		const second = await get({
			type: "poll",
			paginate: "1",
			limit: "1",
			cursor: "2026-07-24T00:00:00Z",
		});
		expect(second.statusCode).toBe(200);
		const secondBody = second.body as { data: Row[]; total: number };
		expect(secondBody.data.map((r) => r.id)).toEqual(["p4"]);
		expect(secondBody.total).toBe(2);
	});
});

describe("GET /api/posts — feed cache eligibility by content type", () => {
	it("never serves a ?type=poll request from the shared feed cache", async () => {
		// Under Vitest the cache is bypassed globally; drop the flag so the
		// handler actually evaluates its cache-eligibility gate.
		const previous = process.env.VITEST;
		delete process.env.VITEST;
		try {
			const { default: handler } = await import("../../api/_posts.js");
			// Warm the module so the feed wrapper is registered.
			const warm = response();
			await handler({ method: "GET", query: { type: "problem" }, body: {}, headers: {} }, warm);
			expect(feedCacheMock.state.wrapped).toHaveBeenCalledTimes(1);

			feedCacheMock.state.wrapped?.mockClear();
			const res = response();
			await handler({ method: "GET", query: { type: "poll" }, body: {}, headers: {} }, res);

			expect(res.statusCode).toBe(200);
			expect(idsOf(res.body).sort()).toEqual(["p3", "p4"]);
			// `fetchFeedRows` narrows by `posts.type`; a cached poll feed would
			// therefore always be empty, so this path must bypass the cache.
			expect(feedCacheMock.state.wrapped).not.toHaveBeenCalled();
		} finally {
			if (previous === undefined) delete process.env.VITEST;
			else process.env.VITEST = previous;
		}
	});
});
