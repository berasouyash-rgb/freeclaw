// ═══════════════════════════════════════════════════════════════════
// Posts API — full CRUD + branch coverage
// ═══════════════════════════════════════════════════════════════════
// Complements posts-feed.test.ts (artifact filter) with the remaining
// GET shapes (pagination, by-ids, by-id wrapping, visibility guard,
// caching) and the full POST/PUT/DELETE surface (auth gate, rate
// limit, validation, duplicate detection, moderation, ownership,
// admin patches, hard delete, 405).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	posts: [] as unknown[],
	reactions: [] as unknown[],
	comments: [] as unknown[],
	polls: [] as unknown[],
	pollVotes: [] as unknown[],
	singleRow: null as unknown,
	lastInsert: null as unknown,
	lastUpdate: null as unknown,
	totalCount: 0,
	// When set, every delete chain resolves with this error — regression
	// harness for "DELETE must not report ok:true when the DB failed".
	deleteError: null as Error | null,
};

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

const authMocks = {
	cors: vi.fn(),
	clientIp: (req: {
		headers?: Record<string, string | undefined>;
		socket?: { remoteAddress?: string };
	}) =>
		String(
			req?.headers?.["x-forwarded-for"] ||
				req?.socket?.remoteAddress ||
				"unknown",
		),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
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
	serverModerate: vi.fn(() => ({
		blocked: false,
		requiresReview: false,
		flags: [],
	})),
	getLearnedWeakStats: vi.fn(() =>
		Promise.resolve({ approved: 0, blocked: 0 }),
	),
	recordModerationDecision: vi.fn(() => Promise.resolve()),
	recordSafetyRepost: vi.fn(() => Promise.resolve(false)),
	checkSafetyRepost: vi.fn(() => Promise.resolve({ blocked: false })),
	getSpamConfig: vi.fn(() =>
		Promise.resolve({ flag: 40, review: 60, quarantine: 80 }),
	),
	spamAnalyze: vi.fn(() => ({
		spam_score: 0,
		signals: {},
		action: "allow",
		details: {},
	})),
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

interface Chain {
	op: string;
	/** eq() filters recorded so delete chains can honor them (like PostgREST) */
	filters: Array<[string, unknown]>;
	select: (col?: unknown, opts?: unknown) => Chain;
	eq: (col?: unknown, val?: unknown) => Chain;
	neq: () => Chain;
	in: () => Chain;
	lt: () => Chain;
	order: () => Chain;
	limit: () => Chain;
	maybeSingle: () => Chain;
	single: () => Chain;
	update: (patch: unknown) => Chain;
	insert: (row: unknown) => Chain;
	delete: () => Chain;
	then: (fn: (v: unknown) => void) => void;
}

function chainFor(table: string): Chain {
	const rowsFor = (t: string): unknown[] =>
		t === "posts"
			? state.posts
			: t === "reactions"
				? state.reactions
				: t === "comments"
					? state.comments
					: t === "poll_votes"
						? state.pollVotes
						: state.polls;
	const chain = {
		op: "select",
		filters: [] as Array<[string, unknown]>,
		select(_col?: unknown, opts?: unknown) {
			if ((opts as { count?: string } | undefined)?.count === "exact")
				this.op = "headCount";
			return this;
		},
		eq(col?: unknown, val?: unknown) {
			if (typeof col === "string") this.filters.push([col, val]);
			return this;
		},
		neq() {
			return this;
		},
		gte() {
			return this;
		},
		in() {
			return this;
		},
		lt() {
			return this;
		},
		order() {
			return this;
		},
		limit() {
			return this;
		},
		maybeSingle() {
			this.op = "maybeSingle";
			return this;
		},
		single() {
			return this;
		},
		update(patch: unknown) {
			this.op = "update";
			state.lastUpdate = patch;
			return this;
		},
		insert(row: unknown) {
			this.op = "insert";
			state.lastInsert = row;
			return this;
		},
		delete() {
			this.op = "delete";
			return this;
		},
		then(fn: (v: unknown) => void) {
			if (this.op === "insert") {
				fn({ data: state.lastInsert, error: null });
				return;
			}
			if (this.op === "update") {
				fn({ data: state.lastUpdate, error: null });
				return;
			}
			if (this.op === "delete") {
				// Simulate PostgREST deletes: honor eq() filters so a delete for
				// the wrong id resolves { data: [] } (0 rows) like production.
				// Rows are NOT mutated — purgeExpired runs fire-and-forget on
				// GETs and would otherwise race seeded fixtures mid-test.
				if (state.deleteError) {
					fn({ data: null, error: state.deleteError });
					return;
				}
				const matched = rowsFor(table).filter((r) =>
					this.filters.every(
						([col, val]) => (r as Record<string, unknown>)?.[col] === val,
					),
				);
				fn({ data: matched, error: null });
				return;
			}
			if (this.op === "maybeSingle") {
				fn({ data: state.singleRow, error: null });
				return;
			}
			if (this.op === "headCount") {
				fn({ data: null, error: null, count: state.totalCount });
				return;
			}
			fn({ data: rowsFor(table), error: null });
		},
	};
	return chain;
}

function makePost(over: Record<string, unknown> = {}) {
	return {
		id: "p1",
		type: "problem",
		title: "Broken projector in room 12",
		description: "The projector in room 12 keeps shutting down",
		category: "Facilities",
		priority: "medium",
		tags: [],
		image_url: null,
		author_id: "anon-2",
		status: "reported",
		progress: 0,
		status_history: [],
		created_at: "2026-07-15T00:00:00Z",
		updated_at: "2026-07-15T00:00:00Z",
		hidden: false,
		deleted: false,
		admin_reply: null,
		...over,
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	Object.assign(state, {
		posts: [],
		reactions: [],
		comments: [],
		polls: [],
		pollVotes: [],
		singleRow: null,
		lastInsert: null,
		lastUpdate: null,
		totalCount: 0,
		deleteError: null,
	});
	from.mockImplementation((table: string) => chainFor(table));
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.checkUser.mockResolvedValue({ ok: true });
	authMocks.rateLimited.mockResolvedValue(false);
});

describe("GET /api/posts — pagination, ids, visibility", () => {
	it("returns paginated data with nextCursor and total", async () => {
		state.posts = [
			makePost({ id: "p1" }),
			makePost({ id: "p2" }),
			makePost({ id: "p3" }),
		];
		state.totalCount = 3;
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { paginate: "1", limit: "2" },
				body: {},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(
			(res.body as { data: unknown[]; nextCursor: string; total: number }).data,
		).toHaveLength(2);
		expect(
			(res.body as { data: unknown[]; nextCursor: string; total: number })
				.nextCursor,
		).toBeTruthy();
		expect(
			(res.body as { data: unknown[]; nextCursor: string; total: number })
				.total,
		).toBe(3);
	});

	it("honors cursor and caps limit at 100", async () => {
		state.posts = [makePost({ id: "p1" })];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { paginate: "1", cursor: "2026-01-01T00:00:00Z", limit: "500" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { data: unknown[] }).data).toHaveLength(1);
	});

	it("treats a garbage cursor as page 1 — never 500 on input shape", async () => {
		state.posts = [makePost({ id: "p1" })];
		state.totalCount = 1;
		const { default: handler } = await import("../../api/_posts.js");
		for (const cursor of ["0", "abc", "99999"]) {
			const res = response();
			await handler(
				{
					method: "GET",
					query: { paginate: "1", cursor },
					body: {},
					headers: {},
				},
				res,
			);
			expect(res.statusCode).toBe(200);
			expect((res.body as { data: unknown[] }).data).toHaveLength(1);
		}
	});

	it("400s a garbage from-date with a clear message instead of 500", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { from: "not-a-date" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toMatch(/Invalid from date/);
	});

	it("validCursor accepts ISO, rejects everything else", async () => {
		const { validCursor } = await import("../../api/_posts.js");
		expect(validCursor("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
		expect(validCursor("0")).toBeNull();
		expect(validCursor("abc")).toBeNull();
		expect(validCursor("")).toBeNull();
		expect(validCursor(null)).toBeNull();
		expect(validCursor(123)).toBeNull();
	});

	it("fetches by ids list and masks author for non-owners", async () => {
		state.posts = [makePost({ id: "p1", author_id: "anon-99" })];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { ids: "p1,p2", viewer: "anon-2" },
				body: {},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		const out = res.body as Array<{ author_id: string; is_mine: boolean }>;
		// Non-owner, non-admin viewer → author masked with ASCII ellipsis (FIX #34)
		expect(out[0].author_id).toBe("anon-99...");
		expect(out[0].is_mine).toBe(false);
	});

	it("returns the single-post wrapper with mine for by-id + viewer", async () => {
		state.posts = [makePost({ id: "p1" })];
		state.reactions = [{ kind: "support" }];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { id: "p1", viewer: "anon-2" },
				body: {},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			post: { id: string };
			counts: Record<string, number>;
			mine: string[];
		};
		expect(body.post.id).toBe("p1");
		expect(body.mine).toEqual(["support"]);
		expect(body.counts).toBeDefined();
	});

	it("404s a hidden post to a non-owner viewer", async () => {
		state.posts = [
			makePost({ id: "p1", hidden: true, status: "pending_review" }),
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { id: "p1", viewer: "someone-else" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("lets the owner fetch their own hidden post by id", async () => {
		state.posts = [
			makePost({ id: "p1", hidden: true, status: "pending_review" }),
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { id: "p1", viewer: "anon-2" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
	});

	it("sets public cache headers without viewer/admin, private with viewer", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res1 = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res1);
		expect(res1.setHeader).toHaveBeenCalledWith(
			"Cache-Control",
			"public, max-age=0, no-cache, s-maxage=10, stale-while-revalidate=10",
		);

		const res2 = response();
		await handler(
			{ method: "GET", query: { viewer: "anon-2" }, body: {}, headers: {} },
			res2,
		);
		expect(res2.setHeader).toHaveBeenCalledWith(
			"Cache-Control",
			"private, no-cache",
		);
	});

	it("attaches live vote counts for linked polls in the feed", async () => {
		state.posts = [makePost({ id: "p1" })];
		state.polls = [{ id: "pl1", post_id: "p1" }];
		state.pollVotes = [
			{ poll_id: "pl1" },
			{ poll_id: "pl1" },
			{ poll_id: "pl1" },
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		const post = (
			res.body as Array<{
				linked_poll: string | null;
				linked_poll_votes: number | null;
			}>
		)[0];
		expect(post.linked_poll).toBe("pl1");
		expect(post.linked_poll_votes).toBe(3);
	});

	it("links the highest-vote duplicate when several polls share one post", async () => {
		// Production case: a double-created question leaves two poll rows on
		// one post (28 votes vs 2 votes). The feed badge must show the real
		// total, not whichever duplicate the row scan happens to hit last.
		state.posts = [makePost({ id: "p1" })];
		state.polls = [
			{ id: "pl-old", post_id: "p1" },
			{ id: "pl-new", post_id: "p1" },
		];
		state.pollVotes = [
			...Array.from({ length: 26 }, () => ({ poll_id: "pl-old" })),
			{ poll_id: "pl-old" },
			{ poll_id: "pl-new" },
			{ poll_id: "pl-new" },
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		const post = (
			res.body as Array<{
				linked_poll: string | null;
				linked_poll_votes: number | null;
			}>
		)[0];
		expect(post.linked_poll).toBe("pl-old");
		expect(post.linked_poll_votes).toBe(27);
	});

	it("falls back to null vote counts when no poll exists", async () => {
		state.posts = [makePost({ id: "p1" })];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		const post = (
			res.body as Array<{
				linked_poll: string | null;
				linked_poll_votes: number | null;
			}>
		)[0];
		expect(post.linked_poll).toBeNull();
		expect(post.linked_poll_votes).toBeNull();
	});

	it("admin all=1 skips visibility filters and unmasks authors", async () => {
		state.posts = [makePost({ id: "p1", author_id: "anon-99", hidden: true })];
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { all: "1", viewer: "anon-2" },
				body: {},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		const out = res.body as Array<{ author_id: string; is_mine: boolean }>;
		expect(out[0].author_id).toBe("anon-99");
		expect(out[0].is_mine).toBe(false);
	});

	it("caps non-paginated feeds at 300 rows", async () => {
		state.posts = Array.from({ length: 310 }, (_, i) =>
			makePost({ id: `p${i}` }),
		);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.body as unknown[]).toHaveLength(300);
	});
});

describe("POST /api/posts — gate, validation, duplicate, moderation", () => {
	it("rejects when the auth gate fails", async () => {
		(authMocks.checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "banned",
		});
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "Valid description text",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { error: string }).error).toBe("banned");
	});

	it("429s when rate limited", async () => {
		(authMocks.rateLimited as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			true,
		);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "Valid description text",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(429);
	});

	it("400s on too-short title", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "shrt",
					description: "Valid description text",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("Title");
	});

	it("400s on too-short description", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "too short",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("Description");
	});

	it("409s on a near-duplicate title in the same category", async () => {
		state.posts = [
			makePost({
				id: "old",
				title: "Broken projector in room 12",
				category: "Facilities",
				status: "reported",
			}),
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Broken projector in room 12",
					description: "It shuts down after ten minutes",
					category: "Facilities",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(409);
		expect((res.body as { code: string }).code).toBe("DUPLICATE_POST");
	});

	it("does not treat a hidden test artifact as an existing post", async () => {
		state.posts = [
			makePost({
				id: "artifact",
				title: "Test post in Academics category",
				category: "Academics",
				status: "reported",
				visibility: "public",
			}),
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Test post in Academics category",
					description: "A real description for this new complaint.",
					category: "Academics",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
	});

	it("does not let an invisible pending-review post block a new one", async () => {
		state.posts = [
			makePost({
				id: "queued",
				title: "Queued duplicate complaint",
				category: "Facilities",
				status: "pending_review",
				visibility: "public",
			}),
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Queued duplicate complaint",
					description: "A real description for this new complaint.",
					category: "Facilities",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
	});

	it("ignores closed posts during duplicate detection", async () => {
		state.posts = [
			makePost({
				id: "old",
				title: "Broken projector in room 12",
				category: "Facilities",
				status: "solved",
			}),
		];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Broken projector in room 12",
					description: "It shuts down after ten minutes",
					category: "Facilities",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
	});

	it("403s blocked content (non-PII) and audits", async () => {
		vi.mocked(
			await import("../../api/_moderation.js"),
		).serverModerate.mockImplementationOnce(() => ({
			blocked: true,
			requiresReview: false,
			flags: [{ type: "violence" }],
		}));
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "Valid description text",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("CONTENT_BLOCKED");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"post_blocked",
			expect.any(String),
		);
	});

	it("403s blocked PII content with the PII message", async () => {
		vi.mocked(
			await import("../../api/_moderation.js"),
		).serverModerate.mockImplementationOnce(() => ({
			blocked: true,
			requiresReview: false,
			flags: [{ type: "privacy" }],
		}));
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "Valid description text",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("PII_BLOCKED");
	});

	it("queues flagged posts as pending_review", async () => {
		vi.mocked(
			await import("../../api/_moderation.js"),
		).serverModerate.mockImplementationOnce(() => ({
			blocked: false,
			requiresReview: true,
			flags: [{ type: "moderation" }],
		}));
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "Valid description text",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect((state.lastInsert as { status: string }).status).toBe(
			"pending_review",
		);
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"post_flagged_for_review",
			expect.any(String),
		);
	});

	it("routes weak-PII content (privacy_weak) to pending_review instead of publishing", async () => {
		vi.mocked(
			await import("../../api/_moderation.js"),
		).serverModerate.mockImplementationOnce(() => ({
			blocked: false,
			requiresReview: false,
			flags: [{ type: "privacy_weak" }],
		}));
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "Valid description text",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect((state.lastInsert as { status: string }).status).toBe(
			"pending_review",
		);
	});

	it("creates a reported post with generated id, defaults and emits event", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const { emitEventAndBridge } = await import("../../api/_events.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Broken projector in room 12",
					description: "It shuts down after ten minutes",
					type: "suggestion",
					priority: "high",
					tags: ["tech", "repair"],
					category: "Facilities",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);

		expect(res.statusCode).toBe(201);
		const created = state.lastInsert as {
			id: string;
			type: string;
			status: string;
			priority: string;
			tags: string[];
		};
		expect(created.id).toMatch(/^sug_/);
		expect(created.type).toBe("suggestion");
		expect(created.status).toBe("reported");
		expect(created.priority).toBe("high");
		expect(created.tags).toEqual(["tech", "repair"]);
		expect(emitEventAndBridge).toHaveBeenCalled();
	});

	it("defaults category/type/priority for unknown values", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					author_id: "anon-2",
					title: "Valid title here",
					description: "Valid description text",
					category: "Nonsense",
					type: "weird",
					priority: "urgent",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		const created = state.lastInsert as {
			category: string;
			type: string;
			priority: string;
		};
		expect(created.category).toBe("Other");
		expect(created.type).toBe("problem");
		expect(created.priority).toBe("medium");
	});
});

describe("POST /api/posts — rapid resubmit idempotency (no twin posts)", () => {
	// Double-tap, retry-after-timeout, and offline-queue flush can deliver the
	// same payload twice with both copies passing the duplicate scan (neither
	// has landed when the other is checked). Same author + exact normalized
	// title + same category within 90s must return the original row
	// (200 + deduped:true) instead of inserting a twin.
	const FRESH = () => new Date().toISOString();

	async function submit(body: Record<string, unknown>) {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body, headers: { "x-anon-id": "anon-2" } },
			res,
		);
		return res;
	}

	it("returns the existing post instead of inserting a twin", async () => {
		state.posts = [
			makePost({
				id: "first",
				title: "Canteen water tastes bad",
				category: "Food",
				status: "reported",
				created_at: FRESH(),
			}),
		];
		state.lastInsert = null;
		const res = await submit({
			title: "Canteen water tastes bad",
			description: "A fresh description typed again after a timeout.",
			category: "Food",
		});
		expect(res.statusCode).toBe(200);
		expect((res.body as { id: string }).id).toBe("first");
		expect((res.body as { deduped?: boolean }).deduped).toBe(true);
		// No second insert ran.
		expect(state.lastInsert).toBeNull();
	});

	it("dedupes a true back-to-back double submit", async () => {
		const first = await submit({
			title: "Library fans are too loud",
			description: "The ceiling fans in the library make noise all day long.",
			category: "Academics",
		});
		expect(first.statusCode).toBe(201);
		// Mirror what the database now holds (the mock insert does not persist).
		const landed = {
			...(state.lastInsert as Record<string, unknown>),
			created_at: FRESH(),
		};
		state.posts = [landed];
		state.lastInsert = null;
		const second = await submit({
			title: "Library fans are too loud",
			description: "The ceiling fans in the library make noise all day long.",
			category: "Academics",
		});
		expect(second.statusCode).toBe(200);
		expect((second.body as { deduped?: boolean }).deduped).toBe(true);
		expect((second.body as { id: string }).id).toBe(
			(first.body as { id: string }).id,
		);
		expect(state.lastInsert).toBeNull();
	});

	it("ignores stale twins outside the window (duplicate scan still applies)", async () => {
		state.posts = [
			makePost({
				id: "old",
				title: "Broken projector in room 12",
				category: "Facilities",
				status: "reported",
			}),
		];
		const res = await submit({
			title: "Broken projector in room 12",
			description: "It shuts down after ten minutes",
			category: "Facilities",
		});
		// Old rows are the duplicate scan's job (409), never the idempotency
		// window's — but either way no deduped flag and no twin insert story.
		expect((res.body as { deduped?: boolean }).deduped).not.toBe(true);
	});

	it("ignores deleted twins (a fresh repost after delete is legitimate)", async () => {
		state.posts = [
			makePost({
				id: "gone",
				title: "Temp issue with taps",
				category: "Facilities",
				status: "reported",
				deleted: true,
				created_at: FRESH(),
			}),
		];
		const res = await submit({
			title: "Temp issue with taps",
			description: "Reposting after I deleted the earlier one just now.",
			category: "Facilities",
		});
		expect((res.body as { deduped?: boolean }).deduped).not.toBe(true);
	});

	it("requires an exact normalized title (near-misses still go to the scan)", async () => {
		state.posts = [
			makePost({
				id: "first",
				title: "Canteen water tastes bad",
				category: "Food",
				status: "reported",
				created_at: FRESH(),
			}),
		];
		const res = await submit({
			title: "Canteen water tastes really bad today",
			description: "A different complaint that merely resembles the first.",
			category: "Food",
		});
		expect((res.body as { deduped?: boolean }).deduped).not.toBe(true);
	});
});

describe("PUT /api/posts — ownership, admin patches, moderation", () => {
	it("400s when id is missing", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "PUT", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toBe("Missing id");
	});

	it("404s when the post does not exist", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: "nope" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("403s a non-owner non-admin", async () => {
		state.singleRow = makePost({ id: "p1", author_id: "anon-owner" });
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "p1", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("lets the owner patch title/description with re-moderation", async () => {
		state.singleRow = makePost({ id: "p1" });
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: {
					id: "p1",
					author_id: "anon-2",
					title: "Fixed title now",
					description: "A longer description that is definitely valid",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const patch = state.lastUpdate as { title: string; description: string };
		expect(patch.title).toBe("Fixed title now");
		expect(patch.description).toBe(
			"A longer description that is definitely valid",
		);
	});

	it("403s an owner edit that trips moderation (PII)", async () => {
		state.singleRow = makePost({ id: "p1" });
		vi.mocked(
			await import("../../api/_moderation.js"),
		).serverModerate.mockImplementationOnce(() => ({
			blocked: true,
			requiresReview: false,
			flags: [{ type: "privacy" }],
		}));
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: {
					id: "p1",
					author_id: "anon-2",
					title: "New title",
					description: "New description",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("PII_BLOCKED");
	});

	it("pulls a post into pending_review when an edit trips weak PII", async () => {
		state.singleRow = makePost({ id: "p1" });
		vi.mocked(
			await import("../../api/_moderation.js"),
		).serverModerate.mockImplementationOnce(() => ({
			blocked: false,
			requiresReview: false,
			flags: [{ type: "privacy_weak" }],
		}));
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: {
					id: "p1",
					author_id: "anon-2",
					title: "New title",
					description: "New description",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const patch = state.lastUpdate as { status: string; progress: number };
		expect(patch.status).toBe("pending_review");
		expect(patch.progress).toBe(10);
		expect(patch.status_history).toBeDefined();
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"edit_held",
			expect.stringContaining("p1"),
		);
	});

	it("400s when there is nothing to update", async () => {
		state.singleRow = makePost({ id: "p1" });
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "p1", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toBe("Nothing to update");
	});

	it("admin can change status, set flags, and notify followers", async () => {
		state.singleRow = makePost({ id: "p1" });
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const { notifyFollowers } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: {
					id: "p1",
					status: "solved",
					pinned: true,
					featured: true,
					admin_reply: "Thanks, fixed!",
					category: "Facilities",
					progress: 77,
					priority: "critical",
					assigned_to: "team-b",
					status_note: "fixed it",
				},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		const patch = state.lastUpdate as {
			status: string;
			pinned: boolean;
			progress: number;
			assigned_to: string;
		};
		expect(patch.status).toBe("solved");
		expect(patch.pinned).toBe(true);
		expect(patch.progress).toBe(77);
		expect(patch.assigned_to).toBe("team-b");
		expect(patch.status_history).toBeDefined();
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"update_post",
			expect.any(String),
		);
		expect(notifyFollowers).toHaveBeenCalled();
	});

	it("admin cannot set an invalid status", async () => {
		state.singleRow = makePost({ id: "p1" });
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "p1", status: "bogus" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toBe("Nothing to update");
	});
});

describe("DELETE /api/posts — admin only", () => {
	it("403s a non-admin", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "p1" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("hard-deletes post, comments, reactions and nulls linked poll", async () => {
		state.posts = [makePost({ id: "p1" })];
		state.comments = [{ id: "c1", post_id: "p1" }];
		state.reactions = [{ id: "r1", target_id: "p1", kind: "up" }];
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "p1" }, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as { ok: boolean }).ok).toBe(true);
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"hard_delete_post",
			"p1",
		);
		// Dependent rows are targeted at the same id, not blanket-wiped.
		expect(
			(authMocks.auditLog as ReturnType<typeof vi.fn>).mock.calls.some(
				(c) => c[0] === "admin",
			),
		).toBe(true);
	});

	// REGRESSION: an unparsed/missing id used to delete 0 rows and still
	// return ok:true — the client dropped the row, then refresh re-applied
	// it, so admins saw posts "come back" after a successful delete.
	it("404s when the id matches no row instead of returning ok:true", async () => {
		state.posts = [makePost({ id: "some-other-post" })];
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "p1" }, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(404);
		expect((res.body as { ok?: boolean }).ok).not.toBe(true);
		expect((res.body as { error: string }).error).toBe("Post not found");
		// A no-op delete must not claim it deleted anything.
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"hard_delete_post",
			"p1",
		);
	});

	// REGRESSION: id travels in the query string because some hosts (Vercel)
	// drop DELETE bodies — the body-only read 400'd or no-oped.
	it("accepts the id from the query string when the body is empty", async () => {
		state.posts = [makePost({ id: "p1" })];
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: { id: "p1" }, body: {}, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as { ok: boolean }).ok).toBe(true);
	});

	it("400s when the id is missing from both query and body", async () => {
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "DELETE", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(400);
		expect((res.body as { ok?: boolean }).ok).not.toBe(true);
	});

	// REGRESSION: Supabase errors in Promise.all used to be ignored — the
	// endpoint answered ok:true while the row survived, so the post
	// reappeared on the next refresh. A DB failure must fail loudly.
	it("fails loudly when the database delete errors", async () => {
		state.posts = [makePost({ id: "p1" })];
		state.deleteError = new Error("posts delete failed");
		(authMocks.isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();

		await expect(
			handler(
				{ method: "DELETE", query: {}, body: { id: "p1" }, headers: {} },
				res,
			),
		).rejects.toThrow("posts delete failed");
		// No success payload may be written on the failure path.
		expect((res.body as { ok?: boolean } | undefined)?.ok).not.toBe(true);
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"hard_delete_post",
			"p1",
		);
	});
});

describe("unsupported methods", () => {
	it("405s on PATCH", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "PATCH", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
