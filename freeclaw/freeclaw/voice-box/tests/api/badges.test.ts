// ═══════════════════════════════════════════════════════════════════
// Contributor badges — contribution profile for a user
// ═══════════════════════════════════════════════════════════════════
// Locks the GET /api/badges?anon_id=X contract:
//   1. Returns counts + a deterministic badge list with earned flags.
//   2. Thresholds: first post, 10+ posts/comments, 25+ reactions,
//      5+ poll votes, 3+ saved, 3+ follows, 50+ total contributions.
//   3. Missing anon_id → 400; unhandled method → 405.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
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
					order: async () => ({
						data: Array.isArray(v) ? v : null,
						error: null,
					}),
				});
			}),
		})),
	}));
}

function badgeSet(body: { badges: Array<{ id: string; earned: boolean }> }) {
	const map: Record<string, boolean> = {};
	(body.badges || []).forEach((b) => {
		map[b.id] = b.earned;
	});
	return map;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	tables = {
		posts: [],
		comments: [],
		reactions: [],
		poll_votes: [],
		settings: null,
	};
	mockTables();
});

describe("GET /api/badges", () => {
	it("returns all-zero counts and no earned badges for a new user", async () => {
		const { default: handler } = await import("../../api/_badges.js");
		const res = response();
		await handler(
			{ method: "GET", query: { anon_id: "anon-new" }, body: {}, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.counts).toEqual({
			posts: 0,
			comments: 0,
			reactions: 0,
			poll_votes: 0,
			saved: 0,
			follows: 0,
		});
		expect(badgeSet(res.body)).toMatchObject({
			"first-post": false,
			"active-voice": false,
			"reaction-lead": false,
			"poll-hub": false,
			curator: false,
			connector: false,
			cornerstone: false,
		});
	});

	it("earns badges when thresholds are met", async () => {
		tables.posts = [{ id: "p1" }, { id: "p2" }];
		tables.comments = [
			{ id: "c1" },
			{ id: "c2" },
			{ id: "c3" },
			{ id: "c4" },
			{ id: "c5" },
			{ id: "c6" },
			{ id: "c7" },
			{ id: "c8" },
			{ id: "c9" },
			{ id: "c10" },
		];
		tables.reactions = Array.from({ length: 27 }, (_, i) => ({ id: `r${i}` }));
		tables.poll_votes = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}` }));
		tables.settings = {
			value: { saved: ["p1", "p2", "p3"], follows: ["a", "b", "c"] },
		};

		const { default: handler } = await import("../../api/_badges.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-veteran" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.counts).toEqual({
			posts: 2,
			comments: 10,
			reactions: 27,
			poll_votes: 5,
			saved: 3,
			follows: 3,
		});
		expect(badgeSet(res.body)).toMatchObject({
			"first-post": true,
			"active-voice": true,
			"reaction-lead": true,
			"poll-hub": true,
			curator: true,
			connector: true,
			cornerstone: true,
		});
		expect(res.body.total).toBe(50);
	});

	it("does not earn reaction-lead or cornerstone for moderate activity", async () => {
		tables.posts = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];
		tables.reactions = [{ id: "r1" }];
		tables.poll_votes = [{ id: "v1" }];

		const { default: handler } = await import("../../api/_badges.js");
		const res = response();
		await handler(
			{ method: "GET", query: { anon_id: "anon-mid" }, body: {}, headers: {} },
			res,
		);
		const set = badgeSet(res.body);
		expect(set["first-post"]).toBe(true);
		expect(set["active-voice"]).toBe(false);
		expect(set["reaction-lead"]).toBe(false);
		expect(set["poll-hub"]).toBe(false);
		expect(set.curator).toBe(false);
		expect(set.connector).toBe(false);
		expect(set.cornerstone).toBe(false);
	});

	it("400s when anon_id is missing", async () => {
		const { default: handler } = await import("../../api/_badges.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(400);
	});

	it("405s on non-GET methods", async () => {
		const { default: handler } = await import("../../api/_badges.js");
		const res = response();
		await handler({ method: "POST", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
