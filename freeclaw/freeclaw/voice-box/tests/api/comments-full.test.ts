// ═══════════════════════════════════════════════════════════════════
// Comments API — full CRUD + branch coverage
// ═══════════════════════════════════════════════════════════════════
// Complements comments-filter.test.ts (artifact filter) with: GET shapes
// (pagination + cursor + total, author filter, admin all=1 view, cache
// headers, masking) and the POST / PUT / DELETE surface (auth gate, rate
// limit, validation, moderation, locked posts, admin messages, edits,
// soft-delete, admin hide, hard delete).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	comments: [] as unknown[],
	posts: [] as unknown[],
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
			if (this.op === "maybeSingle") {
				fn({ data: state.singleRow, error: null });
				return;
			}
			if (this.op === "headCount") {
				fn({ data: null, error: null, count: state.totalCount });
				return;
			}
			if (this.op === "delete") {
				fn({ data: null, error: null });
				return;
			}
			const rows = table === "comments" ? state.comments : state.posts;
			fn({ data: rows, error: null });
		},
	};
	return chain;
}

function makeComment(over: Record<string, unknown> = {}) {
	return {
		id: "c1",
		post_id: "p1",
		parent_id: null,
		body: "The projector lamp needs replacing.",
		author_id: "anon-2",
		is_admin: false,
		hidden: false,
		deleted: false,
		created_at: "2026-07-15T00:00:00Z",
		...over,
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	Object.assign(state, {
		comments: [],
		posts: [],
		singleRow: null,
		lastInsert: null,
		lastUpdate: null,
		totalCount: 0,
	});
	from.mockImplementation((table: string) => chainFor(table));
});

describe("GET /api/comments", () => {
	it("masks foreign authors and marks is_mine for the viewer", async () => {
		state.comments = [
			makeComment({ id: "c1", author_id: "anon-99" }),
			makeComment({ id: "c2", author_id: "anon-2" }),
		];
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "GET", query: { viewer: "anon-2" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as Array<{ author_id: string; is_mine: boolean }>;
		expect(body[0].author_id).toBe("anon-99...");
		expect(body[0].is_mine).toBe(false);
		expect(body[1].author_id).toBe("anon-2");
		expect(body[1].is_mine).toBe(true);
	});

	it("emits private cache headers when a viewer is present", async () => {
		state.comments = [];
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "GET", query: { viewer: "anon-2" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		const setHeader = res.setHeader as ReturnType<typeof vi.fn>;
		const cache = setHeader.mock.calls.find(
			(c) => c[0] === "Cache-Control",
		)?.[1] as string;
		expect(cache).toContain("private");
	});

	it("emits public cache headers for anonymous reads", async () => {
		state.comments = [];
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		const setHeader = res.setHeader as ReturnType<typeof vi.fn>;
		const cache = setHeader.mock.calls.find(
			(c) => c[0] === "Cache-Control",
		)?.[1] as string;
		expect(cache).toContain("public");
	});

	it("filters by author handle", async () => {
		state.comments = [makeComment()];
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "GET", query: { author: "anon-2" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toHaveLength(1);
	});

	it("shows hidden comments to admins via all=1", async () => {
		state.comments = [
			makeComment({ id: "c-hidden", hidden: true, author_id: "anon-5" }),
		];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "GET", query: { all: "1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as Array<{ hidden: boolean }>;
		expect(body[0].hidden).toBe(true);
	});

	it("paginates with cursor and total when paginate=1", async () => {
		state.comments = [
			makeComment({ id: "c3", created_at: "2026-07-18T00:00:00Z" }),
			makeComment({ id: "c2", created_at: "2026-07-17T00:00:00Z" }),
			makeComment({ id: "c1", created_at: "2026-07-16T00:00:00Z" }),
		];
		state.totalCount = 7;
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { post_id: "p1", paginate: "1", limit: "2" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as {
			data: unknown[];
			nextCursor: string | null;
			total: number;
		};
		expect(body.data).toHaveLength(2);
		expect(body.nextCursor).toBe("2026-07-17T00:00:00Z");
		expect(body.total).toBe(7);
	});

	it("returns null nextCursor on the last page", async () => {
		state.comments = [makeComment({ id: "c1" })];
		state.totalCount = 1;
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { paginate: "1", limit: "10" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { nextCursor: string | null }).nextCursor).toBeNull();
	});
});

describe("POST /api/comments", () => {
	it("rejects unauthenticated commenters", async () => {
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "Invalid handle",
		});
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "hello there", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rate-limits rapid commenters", async () => {
		state.singleRow = { id: "p1", locked: false };
		const { rateLimited } = await import("../../api/_auth.js");
		(rateLimited as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "hello there", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(429);
	});

	it("rejects comments shorter than 2 characters", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "x", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("blocks PII in comment bodies", async () => {
		const { serverModerate } = await import("../../api/_moderation.js");
		(serverModerate as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			blocked: true,
			flags: [{ type: "privacy" }],
		});
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					post_id: "p1",
					body: "call me at 555-0100",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("PII_BLOCKED");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"comment_blocked",
			expect.any(String),
		);
	});

	it("blocks content that violates safety guidelines", async () => {
		const { serverModerate } = await import("../../api/_moderation.js");
		(serverModerate as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			blocked: true,
			flags: [{ type: "harassment" }],
		});
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "a nasty message", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("CONTENT_BLOCKED");
	});

	it("rejects comments on locked posts", async () => {
		state.singleRow = { id: "p1", locked: true };
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "hello there", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { error: string }).error).toContain("locked");
	});

	it("creates a comment, ensures the user, bumps post activity and emits an event", async () => {
		state.singleRow = { id: "p1", locked: false };
		const { default: handler } = await import("../../api/_comments.js");
		const { emitEvent, EVENT_TYPES } = await import("../../api/_events.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					post_id: "p1",
					parent_id: "c0",
					body: "hello there",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		const row = state.lastInsert as Record<string, unknown>;
		expect(String(row.id)).toMatch(/^cmt_/);
		expect(row.author_id).toBe("anon-2");
		expect(row.post_id).toBe("p1");
		expect(row.parent_id).toBe("c0");
		expect(authMocks.ensureUser).toHaveBeenCalledWith("anon-2");
		expect(state.lastUpdate).toMatchObject({ updated_at: expect.any(String) });
		expect(emitEvent).toHaveBeenCalledWith(
			EVENT_TYPES.COMMENT_CREATED,
			expect.objectContaining({ post_id: "p1" }),
		);
		expect(res.body).toEqual(state.lastInsert);
	});

	it("supports admin messages that bypass user gates and moderation", async () => {
		const { isAdmin, checkUser } = await import("../../api/_auth.js");
		const { serverModerate } = await import("../../api/_moderation.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "Official notice", is_admin: true },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		const row = state.lastInsert as Record<string, unknown>;
		expect(row.author_id).toBe("ADMIN");
		expect(row.is_admin).toBe(true);
		expect(checkUser).not.toHaveBeenCalled();
		expect(serverModerate).not.toHaveBeenCalled();
	});
});

describe("PUT /api/comments", () => {
	it("404s for an unknown comment", async () => {
		state.singleRow = null;
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "nope", body: "edit", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});

	it("rejects a spoofed ADMIN author", async () => {
		state.singleRow = makeComment({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "c1", body: "edit", author_id: "ADMIN" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects non-owner edits", async () => {
		state.singleRow = makeComment({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "c1", body: "edit", author_id: "anon-9" },
				headers: { "x-anon-id": "anon-9" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("lets the owner edit their comment (marks edited, re-moderates)", async () => {
		state.singleRow = makeComment({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_comments.js");
		const { serverModerate } = await import("../../api/_moderation.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "c1", body: "my updated comment", author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toMatchObject({
			body: "my updated comment",
			edited: true,
		});
		expect(serverModerate).toHaveBeenCalled();
		expect(authMocks.auditLog).not.toHaveBeenCalled();
	});

	it("blocks PII introduced through an edit", async () => {
		state.singleRow = makeComment({ author_id: "anon-2" });
		const { serverModerate } = await import("../../api/_moderation.js");
		(serverModerate as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			blocked: true,
			flags: [{ type: "privacy" }],
		});
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: {
					id: "c1",
					body: "my address is 1 Main St",
					author_id: "anon-2",
				},
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("PII_BLOCKED");
	});

	it("lets the owner soft-delete their comment", async () => {
		state.singleRow = makeComment({ author_id: "anon-2" });
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "c1", deleted: true, author_id: "anon-2" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toEqual({ deleted: true });
	});

	it("lets admins hide a comment and audits the moderation", async () => {
		state.singleRow = makeComment({ author_id: "anon-2" });
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "c1", hidden: true },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(state.lastUpdate).toEqual({ hidden: true });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"moderate_comment",
			"c1",
		);
	});
});

describe("DELETE /api/comments", () => {
	it("rejects non-admins", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "c1" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects a missing id", async () => {
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler({ method: "DELETE", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(400);
	});

	it("hard-deletes a comment as an admin and audits it", async () => {
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "c1" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"hard_delete_comment",
			"c1",
		);
	});
});

describe("method routing", () => {
	it("answers OPTIONS with 204", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler({ method: "OPTIONS", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(204);
	});

	it("405s on unhandled methods", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler({ method: "PATCH", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
