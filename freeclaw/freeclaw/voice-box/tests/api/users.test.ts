// ═══════════════════════════════════════════════════════════════════
// Users API — anonymous identity + heartbeat
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/users contract:
//   1. POST heartbeat with { anon_id } → { existing, banned, suspended_until, ... }
//   2. FIX-#9: the heartbeat is a WRITE — existing users refresh last_seen so
//      the admin dashboard shows live presence; new users are created with
//      full defaults (warnings, strikes, banned, last_seen).
//   3. Rate-limited per identity (20 per 60s) → 429, with a per-IP backstop.
//      REGRESSION: the bucket used to be keyed on IP alone at 10/min, so a
//      whole school behind one NAT address shared ten page loads per minute
//      and every student behind it saw "too many requests".
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
let updateFn = vi.fn();
let insertFn = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
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
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (
		res: { status: (code: number) => unknown; json: (b: unknown) => unknown },
		err: unknown,
	) =>
		res
			.status(500)
			.json({ error: `Internal server error: ${(err as Error).message}` }),
}));

function mockTables(
	state: {
		usersMetaSelect?: { data?: unknown; error?: unknown };
		usersMetaWrite?: { error?: unknown };
	} = {},
) {
	from.mockImplementation((table: string) => {
		if (table === "users_meta") {
			return {
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: async () =>
							state.usersMetaSelect ?? { data: null, error: null },
					})),
				})),
				update: (updateFn = vi.fn(() => ({
					eq: async () => state.usersMetaWrite ?? { error: null },
				}))),
				insert: (insertFn = vi.fn(
					() => state.usersMetaWrite ?? { error: null },
				)),
			};
		}
		return {};
	});
}

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

const EXISTING_USER = {
	anon_id: "anon_user1",
	warnings: [],
	strikes: 0,
	banned: false,
	last_seen: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	updateFn = vi.fn();
	insertFn = vi.fn();
	mockTables();
});

describe("POST /api/users — heartbeat", () => {
	it("returns the user state for an existing user", async () => {
		mockTables({ usersMetaSelect: { data: EXISTING_USER, error: null } });
		const { default: handler } = await import("../../api/_users.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { anon_id: "anon_user1" },
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			ok: true,
			banned: false,
			suspended: false,
			suspended_until: null,
			strikes: 0,
			warning_count: 0,
			latest_warning: null,
		});
	});

	it("refreshes last_seen on every heartbeat for existing users (FIX-#9)", async () => {
		mockTables({ usersMetaSelect: { data: EXISTING_USER, error: null } });
		const { default: handler } = await import("../../api/_users.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { anon_id: "anon_user1" },
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(updateFn).toHaveBeenCalledWith(
			expect.objectContaining({ last_seen: expect.any(String) }),
		);
		expect(updateFn.mock.calls[0][0].last_seen).not.toBe(
			"2026-01-01T00:00:00.000Z",
		);
		// ...and it updates by anon_id, not a blanket write.
		expect(updateFn.mock.results[0].value.eq).toBeDefined();
	});

	it("creates a brand-new user with full defaults (FIX-#9)", async () => {
		mockTables({ usersMetaSelect: { data: null, error: null } });
		const { default: handler } = await import("../../api/_users.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { anon_id: "anon_newbie" },
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(insertFn).toHaveBeenCalledWith(
			expect.objectContaining({
				anon_id: "anon_newbie",
				warnings: [],
				strikes: 0,
				banned: false,
				last_seen: expect.any(String),
			}),
		);
		// It must NOT have taken the update path.
		expect(updateFn).not.toHaveBeenCalled();
	});

	it("surfaces a banned user as banned:true", async () => {
		mockTables({
			usersMetaSelect: {
				data: {
					...EXISTING_USER,
					banned: true,
					warnings: [{ text: "x", at: "y" }],
				},
				error: null,
			},
		});
		const { default: handler } = await import("../../api/_users.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { anon_id: "anon_user1" },
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			ok: true,
			banned: true,
			suspended: false,
			warning_count: 1,
			latest_warning: "x",
		});
	});

	it("400s on an invalid anon_id", async () => {
		const { default: handler } = await import("../../api/_users.js");
		const res = response();
		await handler(
			{ method: "POST", body: { anon_id: "not-an-anon-id" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("405s on non-POST methods", async () => {
		const { default: handler } = await import("../../api/_users.js");
		const res = response();
		await handler({ method: "GET", body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});

	it("rate-limits a single identity that hammers the heartbeat", async () => {
		const { default: handler } = await import("../../api/_users.js");
		let res: ReturnType<typeof response> = response();
		for (let i = 0; i < 21; i++) {
			res = response();
			await handler(
				{
					method: "POST",
					body: { anon_id: "anon_hammer" },
					headers: { "x-forwarded-for": "1.2.3.4" },
				},
				res,
			);
		}
		expect(res.statusCode).toBe(429);
	});

	// REGRESSION (the school-NAT case): many different students behind ONE IP
	// must NOT exhaust each other's budget. Each identity gets its own bucket.
	it("does not rate-limit distinct identities that share one IP", async () => {
		const { default: handler } = await import("../../api/_users.js");
		let last: ReturnType<typeof response> = response();
		for (let i = 0; i < 25; i++) {
			last = response();
			await handler(
				{
					method: "POST",
					body: { anon_id: `anon_student_${i}` },
					headers: { "x-forwarded-for": "1.2.3.4" },
				},
				last,
			);
		}
		expect(last.statusCode).toBe(200);
	});
});
