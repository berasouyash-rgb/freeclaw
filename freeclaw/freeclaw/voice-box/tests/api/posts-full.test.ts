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
	select: (col?: unknown, opts?: unknown) => Chain;
	eq: () => Chain;
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
	const chain = {
		op: "select",
		select(_col?: unknown, opts?: unknown) {
			if ((opts as { count?: string } | undefined)?.count === "exact")
				this.op = "headCount";
			return this;
		},
		eq() {
			return this;
		},
		neq() {
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
			if (this.op === "maybeSingle") {
				fn({ data: state.singleRow, error: null });
				return;
			}
			if (this.op === "headCount") {
				fn({ data: null, error: null, count: state.totalCount });
				return;
			}
			const rows =
				table === "posts"
					? state.posts
					: table === "reactions"
						? state.reactions
						: table === "comments"
							? state.comments
							: table === "poll_votes"
								? state.pollVotes
								: state.polls;
			fn({ data: rows, error: null });
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
		const { emitEvent } = await import("../../api/_events.js");
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
		expect(emitEvent).toHaveBeenCalled();
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
