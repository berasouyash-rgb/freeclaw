// ═══════════════════════════════════════════════════════════════════
// Data Export API — "export all my data" contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/data-export contract:
//   1. GET /api/data-export?anon_id=X → one JSON bundle of everything
//      the caller owns: profile, posts, comments, reactions, poll_votes,
//      saved, follows, notifications, plus exported_at.
//   2. Missing anon_id → 400; unknown method → 405.
//   3. Aggregation is rate-limited per IP (heavy endpoint).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const verifyCallerIdentity = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	verifyCallerIdentity,
	clientIp: vi.fn(() => "test-ip"),
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

const FULL = {
	users_meta: { anon_id: "anon-1", strikes: 0 },
	posts: [
		{
			id: "p1",
			title: "Post one",
			author_id: "anon-1",
			created_at: "2026-07-01T10:00:00.000Z",
		},
	],
	comments: [
		{
			id: "c1",
			body: "Comment",
			author_id: "anon-1",
			created_at: "2026-07-01T10:00:00.000Z",
		},
	],
	reactions: [
		{
			id: "r1",
			author_id: "anon-1",
			kind: "up",
			created_at: "2026-07-01T10:00:00.000Z",
		},
	],
	poll_votes: [
		{ id: "v1", poll_id: "poll1", author_id: "anon-1", choices: ["a"] },
	],
	settings: {
		value: {
			saved: ["p1"],
			follows: ["u2"],
			notifications: [{ id: "n1", read: false }],
		},
	},
};

// A users_meta row carrying moderation internals — these must NEVER reach the
// export bundle, because /api/data-export is callable with any anon_id.
const MODERATED_USER = {
	anon_id: "anon-2",
	strikes: 3,
	banned: true,
	suspended_until: "2027-01-01T00:00:00.000Z",
	warnings: [{ text: "Hate speech", at: "2026-06-01T00:00:00.000Z" }],
	notes: "Repeat offender — flagged by admin agent",
	last_seen: "2026-08-01T12:00:00.000Z",
	created_at: "2026-05-01T12:00:00.000Z",
};

function mockTables(tables: Record<string, unknown>) {
	from.mockImplementation((table: string) => ({
		select: vi.fn(() => ({
			eq: vi.fn(() => {
				const v = tables[table];
				const q = Promise.resolve({ data: v ?? null, error: null });
				return Object.assign(q, {
					maybeSingle: async () => ({
						data: (Array.isArray(v) ? null : v) ?? null,
						error: null,
					}),
					order: async () => ({
						data: Array.isArray(v) ? v : null,
						error: null,
					}),
				});
			}),
		})),
	}));
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon-1" });
	mockTables({});
});

describe("GET /api/data-export", () => {
	it("returns an empty bundle for a user with no data", async () => {
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-1" },
				body: {},
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			anon_id: "anon-1",
			posts: [],
			comments: [],
			reactions: [],
			poll_votes: [],
			saved: [],
			follows: [],
			notifications: [],
		});
		expect(typeof res.body.exported_at).toBe("string");
	});

	it("aggregates every owned record into one bundle", async () => {
		mockTables(FULL);
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-1" },
				body: {},
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			// FIX-#1: moderation internals are stripped — only benign identity fields
			// (anon_id, created_at, last_seen) may appear in the exported profile.
			profile: { anon_id: "anon-1" },
			posts: [{ id: "p1" }],
			comments: [{ id: "c1" }],
			reactions: [{ id: "r1" }],
			poll_votes: [{ id: "v1" }],
			saved: ["p1"],
			follows: ["u2"],
			notifications: [{ id: "n1" }],
		});
		expect(res.body.anon_id).toBe("anon-1");
	});

	it("strips moderation internals from the exported profile (FIX-#1)", async () => {
		mockTables({ ...FULL, users_meta: MODERATED_USER });
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-2" },
				body: {},
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.profile).toEqual({
			anon_id: "anon-2",
			created_at: "2026-05-01T12:00:00.000Z",
			last_seen: "2026-08-01T12:00:00.000Z",
		});
		// The moderation internals must be gone, not merely renamed.
		for (const leaked of [
			"strikes",
			"banned",
			"suspended_until",
			"warnings",
			"notes",
		]) {
			expect(res.body.profile).not.toHaveProperty(leaked);
		}
	});

	it("400s when anon_id is missing", async () => {
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatchObject({ error: expect.any(String) });
	});

	it("405s on non-GET methods", async () => {
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler({ method: "POST", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});

	it("rate-limits repeated requests from the same IP", async () => {
		const { default: handler } = await import("../../api/_export.js");
		let res: ReturnType<typeof response> = response();
		for (let i = 0; i < 11; i++) {
			res = response();
			await handler(
				{
					method: "GET",
					query: { anon_id: "anon-1" },
					body: {},
					headers: { "x-forwarded-for": "1.2.3.4" },
				},
				res,
			);
		}
		expect(res.statusCode).toBe(429);
	});
});

describe("GET /api/data-export identity gate (FIX-#2)", () => {
	it("403s and exports NOTHING when the caller identity cannot be verified", async () => {
		verifyCallerIdentity.mockResolvedValue({
			ok: false,
			status: 403,
			error: "Cannot operate on another user's data",
		});
		mockTables(FULL);
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-2" },
				body: {},
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body).toEqual({
			error: "Cannot operate on another user's data",
		});
		// Nothing was read from the database for the unverified caller
		expect(from).not.toHaveBeenCalled();
	});

	it("calls the gate with the claimed anon_id (not caller-derived)", async () => {
		verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon-1" });
		mockTables(FULL);
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-1" },
				body: {},
				headers: { "x-forwarded-for": "9.9.9.9", "x-anon-id": "anon-1" },
			},
			res,
		);
		expect(verifyCallerIdentity).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"anon-1",
		);
		expect(res.statusCode).toBe(200);
	});

	it("lets admins export on behalf of the system (gate returns ok)", async () => {
		verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon-1" });
		mockTables(FULL);
		const { default: handler } = await import("../../api/_export.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-1" },
				body: {},
				headers: { "x-forwarded-for": "9.9.9.9" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.posts).toMatchObject([{ id: "p1" }]);
	});
});
