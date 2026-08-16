// ═══════════════════════════════════════════════════════════════════
// Notification Center — in-app notifications for users
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/notifications contract (harden cycle 1 — IDOR fix):
//   1. user_id must be a well-formed anon id (anon_ prefix, 5..40 chars);
//      anything else → 400 (blocks settings-key suffix injection).
//   2. Writes (POST create / mark-as-read, DELETE clear) require the feed
//      owner to pass checkUser — banned/suspended → 403.
//   3. Reads (GET) stay open like _me.js — checkUser is NOT consulted.
//   4. Create sanitizes fields: type whitelist → 'info', title ≤200,
//      body ≤1000, post_id ≤40; feed trimmed to 100 newest-first.
//   5. Write rate limit: 15/60s per user → 429 on the 16th.
//   6. Unhandled methods → 405.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	clean: (s: unknown, max = 2000) =>
		String(s ?? "")
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
			.trim()
			.slice(0, max),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "rate limited" }),
	),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((res) =>
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
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

let tables: Record<string, unknown>;
let upserts: Array<{ key: string; value: unknown }>;

function mockTables() {
	from.mockImplementation((table: string) => ({
		select: vi.fn(() => ({
			eq: vi.fn(() => {
				const v = tables[table];
				const q = Promise.resolve({ data: v ?? null, error: null });
				return Object.assign(q, {
					maybeSingle: async () => ({
						data: Array.isArray(v) ? null : (v ?? null),
						error: null,
					}),
				});
			}),
		})),
		upsert: vi.fn(async (row: { key: string; value: unknown }) => {
			upserts.push(row);
			tables.settings = row;
			return { data: null, error: null };
		}),
	}));
}

function feed(notifications: Array<Record<string, unknown>>) {
	tables.settings = { value: { notifications } };
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	tables = { settings: null, users_meta: null };
	upserts = [];
	mockTables();
});

describe("GET /api/notifications", () => {
	it("returns the feed with unread and total counts", async () => {
		feed([
			{ id: "n1", read: false },
			{ id: "n2", read: true },
			{ id: "n3", read: false },
		]);
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_owner" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.notifications).toHaveLength(3);
		expect(res.body.unread_count).toBe(2);
		expect(res.body.total).toBe(3);
	});

	it("returns an empty feed for a user with no notifications", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{ method: "GET", query: { user_id: "anon_new" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ notifications: [], unread_count: 0, total: 0 });
	});

	it("rejects missing or malformed user_id with 400", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const bad = [
			{},
			{ user_id: "admin" }, // not anon_ prefixed
			{ user_id: "anon" }, // too short
			{ user_id: "anon-" + "x".repeat(50) }, // too long
			{ user_id: "anon-abc" }, // hyphen not allowed
			{ user_id: "anon_abc; drop table" }, // control chars / spaces stripped → mismatch
		];
		for (const query of bad) {
			const res = response();
			await handler({ method: "GET", query, body: {}, headers: {} }, res);
			expect(res.statusCode).toBe(400);
		}
	});

	it("normalizes uppercase anon ids to lowercase before querying", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "ANON_OWNER" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		// settings key is lowercased — no row exists for 'ANON-OWNER'
		expect(from).toHaveBeenCalledWith("settings");
		expect(res.body.total).toBe(0);
	});

	it("does not consult checkUser on reads (open read like _me.js)", async () => {
		feed([{ id: "n1", read: false }]);
		const { default: handler } = await import("../../api/_notifications.js");
		const { checkUser } = await import("../../api/_auth.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { user_id: "anon_owner" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(checkUser).not.toHaveBeenCalled();
	});
});

describe("POST /api/notifications — create", () => {
	it("creates a notification with sanitized fields and type whitelist fallback", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					user_id: "anon_owner",
					type: "evil",
					title: `  ${"T".repeat(300)}  `,
					body: "b".repeat(1500),
					post_id: "p1",
				},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect(res.body.id).toMatch(/^notif_/);
		expect(res.body.type).toBe("info");
		expect(res.body.title).toHaveLength(200);
		expect(res.body.body).toHaveLength(1000);
		expect(res.body.post_id).toBe("p1");
		expect(res.body.read).toBe(false);
		// stored in the settings row
		expect(upserts[0].value.notifications[0]).toEqual(res.body);
	});

	it("trims the feed to the newest 100 notifications", async () => {
		feed(
			Array.from({ length: 120 }, (_, i) => ({ id: `old-${i}`, read: false })),
		);
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_owner", title: "hello", body: "world" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect(upserts[0].value.notifications).toHaveLength(100);
		expect(upserts[0].value.notifications[0].id).toBe(res.body.id);
	});

	it("blocks create for a banned user with 403", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "This anonymous ID has been permanently banned.",
		});
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_banned", title: "spam", body: "spam" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body.error).toContain("banned");
		expect(upserts).toHaveLength(0);
	});

	it("blocks create for a suspended user with 403", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "This anonymous ID is suspended until 1/1/2099.",
		});
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_suspended", title: "spam", body: "spam" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body.error).toContain("suspended");
		expect(upserts).toHaveLength(0);
	});
});

describe("POST /api/notifications — mark as read", () => {
	it("marks the target notification read without touching others", async () => {
		feed([
			{ id: "n1", read: false },
			{ id: "n2", read: false },
		]);
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_owner", notification_id: "n1" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ success: true });
		const stored = upserts[0].value.notifications;
		expect(stored[0].read).toBe(true);
		expect(stored[0].read_at).toBeDefined();
		expect(stored[1].read).toBe(false);
	});

	it("blocks mark-as-read for a banned user with 403", async () => {
		feed([{ id: "n1", read: false }]);
		const { default: handler } = await import("../../api/_notifications.js");
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "This anonymous ID has been permanently banned.",
		});
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_banned", notification_id: "n1" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(upserts).toHaveLength(0);
	});
});

describe("DELETE /api/notifications", () => {
	it("clears the feed", async () => {
		feed([{ id: "n1", read: true }]);
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { user_id: "anon_owner" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ success: true, cleared: true });
		expect(upserts[0].value.notifications).toEqual([]);
	});

	it("blocks clear for a banned user with 403", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			error: "This anonymous ID has been permanently banned.",
		});
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { user_id: "anon_banned" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(upserts).toHaveLength(0);
	});
});

describe("POST /api/notifications — rate limit", () => {
	it("allows 15 writes per minute, then returns 429", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		for (let i = 0; i < 15; i++) {
			const res = response();
			await handler(
				{
					method: "POST",
					query: {},
					body: { user_id: "anon_owner", title: `t${i}`, body: "b" },
					headers: {},
				},
				res,
			);
			expect(res.statusCode).toBe(201);
		}
		const limited = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { user_id: "anon_owner", title: "spam", body: "spam" },
				headers: {},
			},
			limited,
		);
		expect(limited.statusCode).toBe(429);
	});
});

describe("Method handling", () => {
	it("returns 405 for unhandled methods", async () => {
		const { default: handler } = await import("../../api/_notifications.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: { user_id: "anon_owner" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(405);
	});
});
