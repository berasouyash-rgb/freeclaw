// ═══════════════════════════════════════════════════════════════════
// Polls API — full CRUD + branch coverage
// ═══════════════════════════════════════════════════════════════════
// Complements polls-filter.test.ts (artifact filter) and poll-close.test.ts
// (close notifications) with: GET shapes (voter, id, post_id, admin view,
// orphan cleanup, masking) and the POST vote / POST create / PUT / DELETE
// surface (auth gate, rate limit, validation, moderation, ownership,
// ADMIN-spoof protection, admin patches, hard delete).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	polls: [] as unknown[],
	poll_votes: [] as unknown[],
	posts: [] as unknown[],
	singleRow: null as unknown,
	existingVote: null as unknown,
	lastInsert: null as unknown,
	lastUpdate: null as unknown,
	// Error-injection switches for the vote write-failure regression tests.
	probeError: null as unknown,
	writeError: null as unknown,
	resultsError: null as unknown,
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
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({
		blocked: false,
		requiresReview: false,
		flags: [],
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

interface Chain {
	op: string;
	selCol: string;
	select: (col?: unknown, opts?: unknown) => Chain;
	eq: () => Chain;
	in: () => Chain;
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
		selCol: "",
		select(col?: unknown) {
			this.selCol = String(col ?? "");
			return this;
		},
		eq() {
			return this;
		},
		in() {
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
				if (state.writeError) {
					fn({ data: null, error: state.writeError });
					return;
				}
				fn({ data: state.lastInsert, error: null });
				return;
			}
			if (this.op === "update") {
				if (state.writeError) {
					fn({ data: null, error: state.writeError });
					return;
				}
				fn({ data: state.lastUpdate, error: null });
				return;
			}
			if (this.op === "maybeSingle") {
				// The vote-existence probe selects only `id` from poll_votes.
				if (table === "poll_votes" && this.selCol === "id") {
					if (state.probeError) {
						fn({ data: null, error: state.probeError });
						return;
					}
					fn({ data: state.existingVote, error: null });
					return;
				}
				fn({ data: state.singleRow, error: null });
				return;
			}
			if (this.op === "delete") {
				fn({ data: null, error: null });
				return;
			}
			// Post-write results read (attachResults strict) — select('poll_id,choices').
			if (
				this.op === "select" &&
				table === "poll_votes" &&
				this.selCol === "poll_id,choices" &&
				state.resultsError
			) {
				fn({ data: null, error: state.resultsError });
				return;
			}
			const rows =
				table === "polls"
					? state.polls
					: table === "poll_votes"
						? state.poll_votes
						: state.posts;
			fn({ data: rows, error: null });
		},
	};
	return chain;
}

function makePoll(over: Record<string, unknown> = {}) {
	return {
		id: "poll-1",
		title: "Should we prioritize lab repairs?",
		ptype: "yesno",
		options: ["Yes", "No"],
		post_id: null,
		author_id: "anon-2",
		expires_at: null,
		deleted: false,
		archived: false,
		created_at: "2026-07-15T00:00:00Z",
		...over,
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	Object.assign(state, {
		polls: [],
		poll_votes: [],
		posts: [],
		singleRow: null,
		existingVote: null,
		lastInsert: null,
		lastUpdate: null,
		probeError: null,
		writeError: null,
		resultsError: null,
	});
	from.mockImplementation((table: string) => chainFor(table));
});

describe("GET /api/polls", () => {
	it("returns the voter poll_votes rows when ?voter= is set", async () => {
		state.poll_votes = [
			{ poll_id: "poll-1", choices: [0] },
			{ poll_id: "poll-2", choices: [1, 2] },
		];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "GET", query: { voter: "anon-2" }, body: {}, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual(state.poll_votes);
	});

	it("unmasks author_id and sets is_mine when the viewer owns the poll", async () => {
		state.polls = [makePoll({ author_id: "anon-7" })];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "GET", query: { viewer: "anon-7" }, body: {}, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ author_id: string; is_mine: boolean }>;
		expect(p.is_mine).toBe(true);
		expect(p.author_id).toBe("anon-7");
	});

	it("masks foreign author ids with a trailing ellipsis for anonymous viewers", async () => {
		state.polls = [makePoll({ author_id: "anon-99" })];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ author_id: string }>;
		expect(p.author_id).toBe("anon-99...");
	});

	it("never masks ADMIN-authored polls", async () => {
		state.polls = [makePoll({ author_id: "ADMIN" })];
		state.poll_votes = [];
		state.posts = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ author_id: string }>;
		expect(p.author_id).toBe("ADMIN");
	});

	it("cleans orphaned post_id references in background and in-memory", async () => {
		state.polls = [
			makePoll({
				id: "poll-orphan",
				post_id: "post-gone",
				author_id: "anon-5",
			}),
		];
		state.poll_votes = [];
		state.posts = []; // linked post does not exist → orphan
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ post_id: string | null }>;
		expect(p.post_id).toBeNull();
		expect(state.lastUpdate).toEqual({ post_id: null });
	});

	it("keeps post_id intact when the linked post still exists", async () => {
		state.polls = [
			makePoll({ id: "poll-linked", post_id: "post-1", author_id: "anon-5" }),
		];
		state.poll_votes = [];
		state.posts = [{ id: "post-1" }];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ post_id: string | null }>;
		expect(p.post_id).toBe("post-1");
		expect(state.lastUpdate).toBeNull();
	});

	it("lets admins see deleted polls (no deleted=false filter)", async () => {
		state.polls = [
			makePoll({ id: "poll-del", deleted: true, author_id: "anon-4" }),
		];
		state.poll_votes = [];
		state.posts = [];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(200);
		const [p] = res.body as Array<{ deleted: boolean }>;
		expect(p.deleted).toBe(true);
	});
});

describe("POST /api/polls { action: vote }", () => {
	it("rejects unauthenticated voters", async () => {
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "Invalid handle",
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("404s when the poll does not exist", async () => {
		state.singleRow = null;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "nope",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("404s when the poll is soft-deleted", async () => {
		state.singleRow = makePoll({ deleted: true });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("rejects votes on archived polls", async () => {
		state.singleRow = makePoll({ archived: true });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("archived");
	});

	it("rejects votes after expiry", async () => {
		state.singleRow = makePoll({ expires_at: "2020-01-01T00:00:00.000Z" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("ended");
	});

	it("rejects empty choice arrays", async () => {
		state.singleRow = makePoll();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("option");
	});

	it("rejects multi-option votes on single-choice polls", async () => {
		state.singleRow = makePoll({ ptype: "single" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0, 1],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("inserts a new vote and returns live results", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.poll_votes = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastInsert).toMatchObject({
			poll_id: "poll-1",
			author_id: "anon-2",
			choices: [0],
		});
		expect(res.body).toMatchObject({ total_votes: 0, vote_counts: {} });
	});

	it("updates an existing vote instead of inserting a duplicate", async () => {
		state.singleRow = makePoll();
		state.existingVote = { id: "v1", poll_id: "poll-1", choices: [1] };
		state.poll_votes = [];
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					action: "vote",
					poll_id: "poll-1",
					choices: [0],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toEqual({ choices: [0] });
		expect(state.lastInsert).toBeNull();
	});

	// ── Vote write-failure regression (the "refresh resets my vote to 0" bug) ──
	// Old behavior: DB errors were unchecked → handler replied 200 with zeroed
	// results → client showed "Vote recorded 🔒" but nothing persisted.
	// New behavior: every DB step throws on error → sanitizeError → 500.
	// The handler must reject and must NOT write a fake 200 response.

	it("throws (no fake 200) when the vote-existence probe fails", async () => {
		state.singleRow = makePoll();
		state.probeError = new Error("probe failed");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("probe failed");
		expect(res.statusCode).toBe(200); // handler never completed a response
	});

	it("throws (no fake 200) when the vote insert fails", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.writeError = new Error("RLS denied insert");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("RLS denied insert");
		expect(res.statusCode).toBe(200);
	});

	it("throws (no fake 200) when the vote update fails", async () => {
		state.singleRow = makePoll();
		state.existingVote = { id: "v1", poll_id: "poll-1", choices: [1] };
		state.writeError = new Error("RLS denied update");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("RLS denied update");
		expect(res.statusCode).toBe(200);
	});

	it("throws (no zeroed results) when the post-write results read fails", async () => {
		state.singleRow = makePoll();
		state.existingVote = null;
		state.resultsError = new Error("results read failed");
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await expect(
			handler(
				{
					method: "POST",
					query: {},
					body: {
						action: "vote",
						poll_id: "poll-1",
						choices: [0],
						author_id: "anon-2",
					},
					headers: { "x-anon-id": "anon-2" },
				},
				res,
			),
		).rejects.toThrow("results read failed");
		expect(res.statusCode).toBe(200);
	});
});

describe("POST /api/polls — create", () => {
	it("creates a poll with yesno defaults for a plain user", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Should the library open longer?", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		const row = state.lastInsert as Record<string, unknown>;
		expect(String(row.id)).toMatch(/^poll_/);
		expect(row.ptype).toBe("yesno");
		expect(row.options).toEqual(["Yes", "No"]);
		expect(row.author_id).toBe("anon-2");
		expect(res.body).toEqual(state.lastInsert);
	});

	it("rate-limits poll creation for plain users", async () => {
		const { rateLimited } = await import("../../api/_auth.js");
		(rateLimited as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Should we change the schedule?", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(429);
	});

	it("rejects titles shorter than 5 characters", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Ques", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("5 characters");
	});

	it("validates 2–10 options for non-yesno poll types", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Pick your favorite?",
					ptype: "single",
					options: ["Only one"],
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toContain("2–10");
	});

	it("blocks PII in poll questions", async () => {
		const { serverModerate } = await import("../../api/_moderation.js");
		(serverModerate as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			blocked: true,
			flags: [{ type: "privacy" }],
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Where does Alex live?", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("PII_BLOCKED");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"poll_blocked",
			expect.any(String),
		);
	});

	it("blocks content that violates safety guidelines", async () => {
		const { serverModerate } = await import("../../api/_moderation.js");
		(serverModerate as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			blocked: true,
			flags: [{ type: "hate" }],
		});
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "A dangerous question", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("CONTENT_BLOCKED");
	});

	it("stores a valid expires_at as ISO and drops invalid dates", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res1 = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Deadline poll?",
					expires_at: "2099-05-01T12:00:00Z",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res1,
		);
		expect(res1.statusCode).toBe(201);
		expect((state.lastInsert as { expires_at: string }).expires_at).toBe(
			"2099-05-01T12:00:00.000Z",
		);

		const res2 = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Deadline poll two?",
					expires_at: "not-a-date",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res2,
		);
		expect(res2.statusCode).toBe(201);
		expect(
			(state.lastInsert as { expires_at: string | null }).expires_at,
		).toBeNull();
	});

	it("attributes anonymous admin-created polls to ADMIN and skips rate limiting", async () => {
		const { isAdmin, rateLimited } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { title: "Official town hall poll?" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect((state.lastInsert as { author_id: string }).author_id).toBe("ADMIN");
		expect(rateLimited).not.toHaveBeenCalled();
	});
});

describe("PUT /api/polls", () => {
	it("404s for an unknown poll", async () => {
		state.singleRow = null;
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "nope", archived: true, author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("rejects a spoofed ADMIN author", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "ADMIN" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects non-owner updates", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "anon-9" },
				headers: { "x-anon-id": "anon-9" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("lets the owner archive or delete their own poll", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", archived: true, author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toEqual({ archived: true });
		expect(authMocks.auditLog).not.toHaveBeenCalled();
	});

	it("lets admins patch expires_at and audit the change", async () => {
		state.singleRow = makePoll({ author_id: "anon-2" });
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "poll-1", expires_at: "2099-01-01T00:00:00Z" },
				headers: { "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toEqual({ expires_at: "2099-01-01T00:00:00Z" });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"update_poll",
			"poll-1",
		);
	});
});

describe("DELETE /api/polls", () => {
	it("rejects non-admins", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "poll-1" }, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("hard-deletes the poll and its votes as an admin", async () => {
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "poll-1" }, headers: { "x-anon-id": "anon-1" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"delete_poll",
			"poll-1",
		);
	});
});

describe("method routing", () => {
	it("answers OPTIONS with 204", async () => {
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "OPTIONS", query: {}, body: {}, headers: { "x-anon-id": "anon-1" } }, res);
		expect(res.statusCode).toBe(204);
	});
});
