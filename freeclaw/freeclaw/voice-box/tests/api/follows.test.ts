// ═══════════════════════════════════════════════════════════════════
// Post Follows API — follow/unfollow contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/follows contract:
//   1. GET  /api/follows?user_id=X            → { follows: [...ids], count }
//   2. POST /api/follows { user_id, post_id } → add, returns following:true
//   3. POST /api/follows { user_id, post_id, following:false } → remove
//   4. DELETE /api/follows?user_id=X&post_id=Y → remove
// Missing user_id/post_id must 400; unknown methods must 405.
// Follows persist in the settings table under key `follows:${userId}`
// (same storage pattern as notifications).
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
	// Default chain: select().eq(key).maybeSingle() returns null; upsert resolves.
	select.mockImplementation(() => ({ eq }));
	eq.mockImplementation(() => ({ maybeSingle, upsert }));
	maybeSingle.mockResolvedValue({ data: null, error: null });
	upsert.mockResolvedValue({ data: null, error: null });
	from.mockImplementation(() => ({ select, upsert }));
});

describe("GET /api/follows", () => {
	it("returns an empty list for a user with no follows", async () => {
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon-1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ follows: [], count: 0 });
		expect(from).toHaveBeenCalledWith("settings");
	});

	it("returns the stored follows for a user", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { follows: ["p1", "p2"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon-1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ follows: ["p1", "p2"], count: 2 });
	});

	it("400s when user_id is missing", async () => {
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatchObject({ error: "user_id required" });
	});
});

describe("POST /api/follows", () => {
	it("adds a post to the follows list", async () => {
		const { default: handler } = await import("../../api/_follows.js");
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
			following: true,
			follows: ["post_abc"],
		});
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "follows:anon-1",
				value: expect.objectContaining({ follows: ["post_abc"] }),
			}),
			{ onConflict: "key" },
		);
	});

	it("is idempotent when the post is already followed", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { follows: ["post_abc"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_follows.js");
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
		expect(res.body).toMatchObject({ following: true, follows: ["post_abc"] });
	});

	it("removes a post when following:false is sent", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { follows: ["post_abc", "post_xyz"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon-1", post_id: "post_abc", following: false },
				headers: {},
			},
			res,
		);
		expect(res.body).toMatchObject({
			success: true,
			following: false,
			follows: ["post_xyz"],
		});
	});

	it("400s when post_id is missing", async () => {
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { user_id: "anon-1" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatchObject({ error: "post_id required" });
	});
});

describe("DELETE /api/follows", () => {
	it("removes a post and returns following:false", async () => {
		maybeSingle.mockResolvedValue({
			data: { value: { follows: ["post_abc", "post_xyz"] } },
			error: null,
		});
		const { default: handler } = await import("../../api/_follows.js");
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
			following: false,
			follows: ["post_xyz"],
		});
	});
});

describe("unsupported method", () => {
	it("405s on PUT", async () => {
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{ method: "PUT", query: { user_id: "anon-1" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(405);
	});
});

describe("notifyFollowers", () => {
	it("pushes a notification to every follower of the post", async () => {
		const ilike = vi.fn();
		select.mockImplementation(() => ({ eq, ilike }));
		ilike.mockReturnValue({
			limit: vi.fn().mockResolvedValue({
				data: [
					{ key: "follows:anon-1", value: { follows: ["post_abc"] } },
					{
						key: "follows:anon-2",
						value: { follows: ["post_abc", "post_xyz"] },
					},
					{ key: "follows:anon-3", value: { follows: ["post_xyz"] } },
				],
				error: null,
			}),
		});
		maybeSingle.mockResolvedValue({ data: null, error: null });
		upsert.mockResolvedValue({ data: null, error: null });

		const { notifyFollowers } = await import("../../api/_follows.js");
		await notifyFollowers("post_abc", {
			title: "Status updated",
			body: "Your post changed",
		});

		// Two followers of post_abc receive notifications (anon-3 follows only post_xyz)
		const upsertedKeys = upsert.mock.calls.map((c) => c[0].key);
		expect(
			upsertedKeys.filter((k) => k === "notifications:anon-1"),
		).toHaveLength(1);
		expect(
			upsertedKeys.filter((k) => k === "notifications:anon-2"),
		).toHaveLength(1);
		expect(upsertedKeys).not.toContain("notifications:anon-3");
		const notifValue = upsert.mock.calls.find(
			(c) => c[0].key === "notifications:anon-1",
		)[0].value;
		expect(notifValue.notifications[0]).toMatchObject({
			type: "post",
			title: "Status updated",
			body: "Your post changed",
			post_id: "post_abc",
			read: false,
		});
	});

	it("never throws when the follower scan fails", async () => {
		select.mockImplementation(() => ({
			eq,
			ilike: vi
				.fn()
				.mockReturnValue({
					limit: vi.fn().mockRejectedValue(new Error("db down")),
				}),
		}));
		const { notifyFollowers } = await import("../../api/_follows.js");
		await expect(
			notifyFollowers("post_abc", { title: "x", body: "y" }),
		).resolves.toBeUndefined();
	});
});
