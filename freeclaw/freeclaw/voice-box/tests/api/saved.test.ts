// ═══════════════════════════════════════════════════════════════════
// Saved Posts API — server-persisted bookmarks contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/saved contract:
//   1. GET  /api/saved?user_id=X                        → { saved: [...ids], count }
//   2. POST /api/saved { user_id, post_id }             → add, returns isSaved:true
//   3. POST /api/saved { user_id, post_id, saved:false } → remove
//   4. DELETE /api/saved?user_id=X&post_id=Y            → remove
// Missing user_id/post_id must 400; unknown methods must 405.
// Persists in settings table under key `saved:${userId}`.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	verifyCallerIdentity: vi.fn().mockResolvedValue({ ok: true, callerId: "anon-1" }),
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	select.mockImplementation(() => ({ eq }));
	eq.mockImplementation(() => ({ maybeSingle, upsert }));
	maybeSingle.mockResolvedValue({ data: null, error: null });
	upsert.mockResolvedValue({ data: null, error: null });
	from.mockImplementation(() => ({ select, upsert }));
});

describe("GET /api/saved", () => {
	it("returns an empty list for a user with no saved posts", async () => {
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon-1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ saved: [], count: 0 });
		expect(from).toHaveBeenCalledWith("settings");
	});

	it("returns the stored saved ids for a user", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { saved: ["p1", "p2"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon-1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ saved: ["p1", "p2"], count: 2 });
	});

	it("400s when user_id is missing", async () => {
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatchObject({ error: "user_id required" });
	});
});

describe("POST /api/saved", () => {
	it("adds a post id to the saved list", async () => {
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon-1", post_id: "post_abc" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			success: true,
			isSaved: true,
			saved: ["post_abc"],
		});
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "saved:anon-1",
				value: expect.objectContaining({ saved: ["post_abc"] }),
			}),
			{ onConflict: "key" },
		);
	});

	it("is idempotent when the post is already saved", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { saved: ["post_abc"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon-1", post_id: "post_abc" },
				headers: {},
			},
			res,
		);
		expect(res.body).toMatchObject({ isSaved: true, saved: ["post_abc"] });
	});

	it("removes a post when saved:false is sent", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { saved: ["post_abc", "post_xyz"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon-1", post_id: "post_abc", saved: false },
				headers: {},
			},
			res,
		);
		expect(res.body).toMatchObject({
			success: true,
			isSaved: false,
			saved: ["post_xyz"],
		});
	});

	it("400s when post_id is missing", async () => {
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { user_id: "anon-1" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatchObject({ error: "post_id required" });
	});
});

describe("DELETE /api/saved", () => {
	it("removes a post and returns isSaved:false", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { saved: ["post_abc", "post_xyz"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { user_id: "anon-1", post_id: "post_abc" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			success: true,
			isSaved: false,
			saved: ["post_xyz"],
		});
	});
});

describe("unsupported method", () => {
	it("405s on PUT", async () => {
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{ method: "PUT", query: { user_id: "anon-1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(405);
	});
});
