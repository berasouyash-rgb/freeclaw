// ═══════════════════════════════════════════════════════════════════
// Comments API — full-site test/fuzz artifact filtering contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/comments GET filter (mirrors _search.js, which already
// filters comment bodies):
//   - Public AND admin comment listings hide bodies that read as
//     test/fuzz artifacts (gibberish, whole-word "test", "QA test …").
//   - Cursor-paginated responses are filtered the same way.
// Rows are NOT deleted server-side; they are only hidden from responses.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const tableData: Record<string, unknown[]> = {};
const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn(),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
}));
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
	serverModerate: () => ({ blocked: false, requiresReview: false, flags: [] }),
	recordSafetyRepost: () => Promise.resolve(false),
	checkSafetyRepost: () => Promise.resolve({ blocked: false }),
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

function chainFor(table: string) {
	let selectOpts: { count?: string; head?: boolean } = {};
	return {
		select(_col: unknown, opts?: { count?: string; head?: boolean }) {
			if (opts) selectOpts = opts;
			return this;
		},
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		lt: vi.fn().mockReturnThis(),
		gte: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		single: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		then(onResolve: (v: unknown) => void) {
			if (table === "comments") {
				if (selectOpts.count === "exact" && selectOpts.head) {
					onResolve({
						data: null,
						error: null,
						count: tableData["comments"]?.length ?? 0,
					});
					return;
				}
				onResolve({ data: tableData["comments"] ?? [], error: null });
				return;
			}
			onResolve({ data: [], error: null });
		},
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	from.mockImplementation((table: string) => chainFor(table));
});

describe("GET /api/comments — artifact filter", () => {
	it("hides test/fuzz comment bodies from the public listing but keeps real comments", async () => {
		tableData["comments"] = [
			{
				id: "c1",
				post_id: "p1",
				body: "Fzqbn otsm8vjg lh2d3kil",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-26T00:00:00Z",
			},
			{
				id: "c2",
				post_id: "p1",
				body: "this is a test comment",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-25T00:00:00Z",
			},
			{
				id: "c3",
				post_id: "p1",
				body: "QA test 210145",
				author_id: "fuzz-1.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-24T00:00:00Z",
			},
			{
				id: "c4",
				post_id: "p1",
				body: "The projector in room 12 needs a new lamp.",
				author_id: "anon-2",
				hidden: false,
				deleted: false,
				created_at: "2026-07-23T00:00:00Z",
			},
		];

		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "GET", query: { post_id: "p1" }, body: {}, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(200);
		const bodies = (res.body as Array<{ body: string }>).map((c) => c.body);
		expect(bodies).toEqual(["The projector in room 12 needs a new lamp."]);
		expect(bodies).not.toContain("Fzqbn otsm8vjg lh2d3kil");
		expect(bodies).not.toContain("this is a test comment");
		expect(bodies).not.toContain("QA test 210145");
	});

	it("filters artifacts from admin comment listings too (no admin exemption)", async () => {
		tableData["comments"] = [
			{
				id: "c1",
				post_id: "p1",
				body: "QA test 210145",
				author_id: "fuzz-1.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-26T00:00:00Z",
			},
			{
				id: "c2",
				post_id: "p1",
				body: "Real issue: water leak near the labs.",
				author_id: "anon-3",
				hidden: false,
				deleted: false,
				created_at: "2026-07-25T00:00:00Z",
			},
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
		expect((res.body as Array<{ body: string }>).map((c) => c.body)).toEqual([
			"Real issue: water leak near the labs.",
		]);
	});

	it("filters artifacts in cursor-paginated responses and keeps real comments", async () => {
		tableData["comments"] = [
			{
				id: "c1",
				post_id: "p1",
				body: "Fzqbn otsm8vjg lh2d3kil",
				author_id: "fuzz-1.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-26T00:00:00Z",
			},
			{
				id: "c2",
				post_id: "p1",
				body: "lamp is flickering, please check",
				author_id: "anon-2",
				hidden: false,
				deleted: false,
				created_at: "2026-07-25T00:00:00Z",
			},
			{
				id: "c3",
				post_id: "p1",
				body: "test body text",
				author_id: "fuzz-2.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-24T00:00:00Z",
			},
		];

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
			data: Array<{ body: string }>;
			nextCursor: string | null;
			total: number;
		};
		expect(body.data.map((c) => c.body)).toEqual([
			"lamp is flickering, please check",
		]);
		expect(body.total).toBe(3); // total is the SQL count, artifacts remain counted in the DB
	});
});
