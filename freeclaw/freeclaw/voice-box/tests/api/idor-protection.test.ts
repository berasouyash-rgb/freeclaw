// ═══════════════════════════════════════════════════════════════════
// IDOR Protection — verifyCallerIdentity regression tests
// ═══════════════════════════════════════════════════════════════════
// Proves that a user cannot read/modify another user's data by
// sending a different user_id in the body vs the x-anon-id header.
//
// P0 SECURITY REGRESSION: these tests MUST pass. If they break,
// a user can read/modify/save/follow another user's private data.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";

const from = vi.fn();
const upsert = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

// Mock _auth.js with real verifyCallerIdentity logic (not a passthrough mock)
vi.mock("../../api/_auth.js", () => {
	const clean = (s: unknown, max = 2000) =>
		String(s ?? "")
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
			.trim()
			.slice(0, max);

	return {
		cors: vi.fn(),
		clean,
		isAdmin: vi.fn().mockResolvedValue(false),
		checkUser: vi.fn().mockResolvedValue({ ok: true }),
		rateLimitResponse: vi.fn((res: { statusCode: number; body: unknown }) =>
			res.status(429).json({ error: "rate limited" }),
		),
		verifyCallerIdentity: vi.fn(
			async (
				req: { headers: Record<string, string> },
				_res: unknown,
				claimedUserId: string,
			) => {
				const headerId = (req.headers["x-anon-id"] || "")
					.toString()
					.trim()
					.toLowerCase();
				const id = String(claimedUserId || "").trim().toLowerCase();
				if (!headerId)
					return {
						ok: false,
						status: 403,
						error: "Missing session identity (x-anon-id header)",
					};
				if (headerId !== id)
					return {
						ok: false,
						status: 403,
						error: "Cannot operate on another user's data",
					};
				return { ok: true, callerId: headerId };
			},
		),
	};
});

vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn(
		(res: { statusCode: number; body: unknown }) =>
			res.status(500).json({ error: "Internal error" }),
	),
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
		setHeader: vi.fn(),
		end: vi.fn(),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	select.mockImplementation(() => ({ eq }));
	eq.mockImplementation(() => ({ maybeSingle, upsert }));
	maybeSingle.mockResolvedValue({ data: null, error: null });
	upsert.mockResolvedValue({ data: null, error: null });
	from.mockImplementation(() => ({ select, upsert }));
});

describe("IDOR: saved posts", () => {
	it("rejects GET when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_victim" },
				body: {},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body).toMatchObject({
			error: "Cannot operate on another user's data",
		});
	});

	it("rejects POST when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					user_id: "anon_victim",
					post_id: "post_stolen",
				},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects DELETE when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_saved.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { user_id: "anon_victim", post_id: "post_stolen" },
				body: {},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});
});

describe("IDOR: follows", () => {
	it("rejects GET when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_victim" },
				body: {},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects POST when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_follows.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					user_id: "anon_victim",
					post_id: "post_stolen",
				},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});
});

describe("IDOR: notifications", () => {
	it("rejects GET when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_victim" },
				body: {},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects DELETE when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { user_id: "anon_victim" },
				body: {},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects when x-anon-id header is missing entirely", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_victim" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});
});

describe("IDOR: notifications POST create/mark-read", () => {
	it("rejects POST create when x-anon-id does not match user_id — nothing stored", async () => {
		// REGRESSION: POST (unlike GET/DELETE) skipped caller verification,
		// so anyone could plant arbitrary title/body into anyone else's
		// inbox — unmoderated content delivered straight to a victim.
		vi.resetModules();
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					user_id: "anon_victim",
					title: "You are finished",
					body: "don't come to school tomorrow",
				},
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(upsert).not.toHaveBeenCalled();
	});

	it("rejects POST mark-read when x-anon-id does not match user_id", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_victim", notification_id: "notif_x" },
				headers: { "x-anon-id": "anon_attacker" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(upsert).not.toHaveBeenCalled();
	});

	it("still lets the owner create into their own inbox", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_owner", title: "Hello", body: "world" },
				headers: { "x-anon-id": "anon_owner" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect(upsert).toHaveBeenCalled();
	});
});
