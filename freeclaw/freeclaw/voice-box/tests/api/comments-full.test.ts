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
	// Default-allow session gate (feature tests exercise behavior, not
	// auth; the impersonation tests below override with denial).
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
	serverModerate: vi.fn(() => ({
		blocked: false,
		requiresReview: false,
		flags: [],
	})),
	recordSafetyRepost: vi.fn(async () => false),
	checkSafetyRepost: vi.fn(async () => ({ blocked: false })),
}));

// Route verdicts come from the unified safety pipeline, not inline
// Route verdicts come from the unified safety pipeline: mock the seam (default ALLOW) and override per test.
const pipelineMocks = vi.hoisted(() => ({
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
}));
// `evaluateContentAsync` is the contextual-aware wrapper the route now calls.
// It delegates to the same mock so this file keeps asserting ROUTE behaviour
// rather than the contextual layer's classification.
pipelineMocks.evaluateContentAsync = vi.fn(async (...args) => pipelineMocks.evaluateContent(...args));
// `evaluateContentDeep` is the model-backed wrapper the write path now calls.
// Same delegation: model behaviour is pinned in deep-moderation.test.ts with
// mocked providers, not here.
pipelineMocks.evaluateContentDeep = vi.fn(async (...args) => pipelineMocks.evaluateContent(...args));
vi.mock("../../api/_safety-pipeline.js", () => pipelineMocks);

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
	in: () => Chain;
	lt: () => Chain;
	gte: () => Chain;
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
		in() {
			return this;
		},
		lt() {
			return this;
		},
		gte() {
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
				// Simulate PostgREST deletes: honor eq() filters so a delete for
				// the wrong id resolves { data: [] } (0 rows) like production.
				const rows = table === "comments" ? state.comments : state.posts;
				const matched = (rows as Array<Record<string, unknown>>).filter((r) =>
					this.filters.every(([col, val]) => r?.[col] === val),
				);
				fn({ data: matched, error: null });
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
	// Drain any leaked one-shot gate denial so a broken gate fails its own
	// test instead of poisoning the next test's session check.
	authMocks.verifyCallerIdentity.mockReset();
	authMocks.verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "" });
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
		pipelineMocks.evaluateContent.mockReturnValueOnce({
			action: "BLOCK_ACTION",
			classification: "privacy",
			confidence: "high",
			policy: "pipeline-test",
			reasons: ["test"],
			trace: [],
			flags: [{ type: "privacy" }],
			language: "en",
			blocked: true,
			needsReview: true,
			message:
				"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
			code: "PII_BLOCKED",
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
		pipelineMocks.evaluateContent.mockReturnValueOnce({
			action: "BLOCK_ACTION",
			classification: "harassment",
			confidence: "high",
			policy: "pipeline-test",
			reasons: ["test"],
			trace: [],
			flags: [{ type: "harassment" }],
			language: "en",
			blocked: true,
			needsReview: true,
			message: "This comment violates our safety guidelines and cannot be posted.",
			code: "CONTENT_BLOCKED",
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
		const { emitEventAndBridge, EVENT_TYPES } = await import("../../api/_events.js");
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
		expect(emitEventAndBridge).toHaveBeenCalledWith(
			EVENT_TYPES.COMMENT_CREATED,
			expect.objectContaining({ post_id: "p1" }),
		);
		expect(res.body).toEqual(state.lastInsert);
	});

	it("supports admin messages that bypass user gates and moderation", async () => {
		const { isAdmin, checkUser } = await import("../../api/_auth.js");
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
		expect(pipelineMocks.evaluateContent).not.toHaveBeenCalled();
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
		expect(pipelineMocks.evaluateContent).toHaveBeenCalled();
		expect(authMocks.auditLog).not.toHaveBeenCalled();
	});

	it("blocks PII introduced through an edit", async () => {
		state.singleRow = makeComment({ author_id: "anon-2" });
		pipelineMocks.evaluateContent.mockReturnValueOnce({
			action: "BLOCK_ACTION",
			classification: "privacy",
			confidence: "high",
			policy: "pipeline-test",
			reasons: ["test"],
			trace: [],
			flags: [{ type: "privacy" }],
			language: "en",
			blocked: true,
			needsReview: true,
			message:
				"Personal information detected in your edit (address, phone, or email). This is an anonymous platform — please remove personal details.",
			code: "PII_BLOCKED",
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
		state.comments = [makeComment({ id: "c1" })];
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

	it("returns 404 instead of ok:true when the id matches no row", async () => {
		// A mistyped or already-purged id must not report success while the
		// row "comes back" on reload — the posts hard-delete route learned
		// this the same way (removal verification).
		state.comments = [makeComment({ id: "c1" })];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "DELETE", query: {}, body: { id: "c-gone" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(404);
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"hard_delete_comment",
			"c-gone",
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

describe("comments — session binding (anti-impersonation)", () => {
	async function denySession() {
		const { verifyCallerIdentity } = await import("../../api/_auth.js");
		(verifyCallerIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: "Invalid session identity",
		});
	}

	it("refuses a POST when the session gate denies, even with a matching header", async () => {
		await denySession();
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "forged as victim" },
				headers: { "x-anon-id": "victim_1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("refuses an owner PUT when the session gate denies", async () => {
		state.singleRow = makeComment({ id: "c1", author_id: "victim_1" });
		await denySession();
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "c1", body: "forged edit" },
				headers: { "x-anon-id": "victim_1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});
});

describe("comments — private posts, repost guard, and identity gate", () => {
	it("hides private-post comments from strangers but serves the owner", async () => {
		state.singleRow = { id: "p-private", visibility: "private", author_id: "owner-1" };
		state.comments = [makeComment({ id: "c1", post_id: "p-private" })];
		const { default: handler } = await import("../../api/_comments.js");

		const denied = response();
		await handler(
			{ method: "GET", query: { post_id: "p-private", viewer: "stranger-9" }, body: {}, headers: {} },
			denied,
		);
		expect(denied.statusCode).toBe(403);

		const allowed = response();
		await handler(
			{ method: "GET", query: { post_id: "p-private", viewer: "owner-1" }, body: {}, headers: {} },
			allowed,
		);
		expect(allowed.statusCode).toBe(200);
	});

	it("rejects comments on a private post from non-authors", async () => {
		state.singleRow = { id: "p-private", visibility: "private", author_id: "owner-1", locked: false };
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p-private", body: "let me in" },
				headers: { "x-anon-id": "stranger-9" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects POST without a session identity", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { post_id: "p1", body: "hello" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("blocks reposting previously removed content and audits the attempt", async () => {
		const { checkSafetyRepost } = await import("../../api/_moderation.js");
		(checkSafetyRepost as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			blocked: true,
			rule: "unit-test",
			attempts: 3,
		});
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { post_id: "p1", body: "banned content returns" },
				headers: { "x-anon-id": "anon-2" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code?: string }).code).toBe("SAFETY_REPOST_BLOCKED");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"comment_repost_blocked",
			expect.stringContaining("anon-2"),
		);
	});

	it("applies the cursor bound when paginating", async () => {
		state.comments = [
			makeComment({ id: "c-new", created_at: "2026-08-01T00:00:00Z" }),
			makeComment({ id: "c-old", created_at: "2026-07-01T00:00:00Z" }),
		];
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "GET", query: { paginate: "1", cursor: "2026-07-15T00:00:00Z" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as { data: unknown[]; nextCursor: string | null; total: number };
		expect(body.data).toHaveLength(2);
		expect(body.nextCursor).toBeNull();
		expect(body.total).toBe(0);
	});
});
