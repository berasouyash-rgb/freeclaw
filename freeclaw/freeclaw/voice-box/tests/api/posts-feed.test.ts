// ═══════════════════════════════════════════════════════════════════
// Posts API — full-site test/fuzz artifact filtering contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/posts artifact filter:
//   - EVERY surface is filtered unconditionally: the public feed, by-id and
//     by-ids fetches, author listings, AND admin views (with or without the
//     legacy filter_artifacts=1 flag, which is still accepted for compat).
//     "Fzqbn …", "Wxcrp …", "Kjvwm …", "Xqvtm …", "QA test …",
//     "Test post/poll …", and any title containing the whole word "test"
//     (e.g. "Content Type Test", "Full CRUD Test 210145") are hidden.
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
	EVENT_TYPES: {},
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: () => ({ blocked: false, requiresReview: false, flags: [] }),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
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

function chainFor(table: string, selectArgs: unknown) {
	const opts = (selectArgs || {}) as { count?: string; head?: boolean };
	return {
		select(_col: unknown) {
			return this;
		},
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		lt: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		single: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		then(onResolve: (v: unknown) => void) {
			if (table === "posts") {
				if (opts.count === "exact" && opts.head) {
					onResolve({
						data: null,
						error: null,
						count: tableData["posts"]?.length ?? 0,
					});
					return;
				}
				onResolve({ data: tableData["posts"] ?? [], error: null });
				return;
			}
			onResolve({ data: [], error: null });
		},
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	from.mockImplementation((table: string, args?: unknown) =>
		chainFor(table, args),
	);
});

describe("GET /api/posts — feed artifact filter", () => {
	it("hides test/fuzz artifacts from the public feed but keeps real posts", async () => {
		tableData["posts"] = [
			{
				id: "p1",
				title: "Fzqbn otsm8vjg lh2d3kil",
				type: "problem",
				category: "Academics",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-26T00:00:00Z",
				updated_at: "2026-07-26T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p4",
				title: "Wxcrp 9kgndw01 dv7eo9xu",
				type: "problem",
				category: "Other",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-25T00:00:00Z",
				updated_at: "2026-07-25T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p9",
				title: "Kjvwm z7evp978 pjosjdkh",
				type: "suggestion",
				category: "Other",
				status: "reported",
				author_id: "fuzz-1.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-24T00:00:00Z",
				updated_at: "2026-07-24T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p10",
				title: "Xqvtm 4srdhkky mupsxdes",
				type: "poll",
				category: "Other",
				status: "reported",
				author_id: "fuzz-2.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-24T00:00:00Z",
				updated_at: "2026-07-24T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p2",
				title: "QA test post 2026-07-14",
				type: "problem",
				category: "Academics",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-14T00:00:00Z",
				updated_at: "2026-07-14T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p3",
				title: "Test post in Other category",
				type: "suggestion",
				category: "Other",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-23T00:00:00Z",
				updated_at: "2026-07-23T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p5",
				title: "Content Type Test",
				type: "problem",
				category: "Other",
				status: "reported",
				author_id: "content-t.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-22T00:00:00Z",
				updated_at: "2026-07-22T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p6",
				title: "Full CRUD Test 210145",
				type: "suggestion",
				category: "Other",
				status: "reported",
				author_id: "fv-test-2.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-22T00:00:00Z",
				updated_at: "2026-07-22T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p7",
				title: "Final Workflow Test",
				type: "suggestion",
				category: "Academics",
				status: "reported",
				author_id: "fv-final-.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-22T00:00:00Z",
				updated_at: "2026-07-22T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p8",
				title: "Broken projector in room 12",
				type: "problem",
				category: "Facilities",
				status: "reported",
				author_id: "anon-2",
				hidden: false,
				deleted: false,
				created_at: "2026-07-15T00:00:00Z",
				updated_at: "2026-07-15T00:00:00Z",
				admin_reply: null,
			},
		];

		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		const titles = (res.body as Array<{ title: string }>).map((p) => p.title);
		expect(titles).toEqual(["Broken projector in room 12"]);
		expect(titles).not.toContain("Fzqbn otsm8vjg lh2d3kil");
		expect(titles).not.toContain("Wxcrp 9kgndw01 dv7eo9xu");
		expect(titles).not.toContain("Kjvwm z7evp978 pjosjdkh");
		expect(titles).not.toContain("Xqvtm 4srdhkky mupsxdes");
		expect(titles).not.toContain("QA test post 2026-07-14");
		expect(titles).not.toContain("Test post in Other category");
		expect(titles).not.toContain("Content Type Test");
		expect(titles).not.toContain("Full CRUD Test 210145");
		expect(titles).not.toContain("Final Workflow Test");
	});

	it("hides an artifact on a direct by-id fetch too (full-site filter)", async () => {
		tableData["posts"] = [
			{
				id: "p1",
				title: "Fzqbn otsm8vjg lh2d3kil",
				type: "problem",
				category: "Academics",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-26T00:00:00Z",
				updated_at: "2026-07-26T00:00:00Z",
				admin_reply: null,
			},
		];

		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "GET", query: { id: "p1" }, body: {}, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body as Array<{ title: string }>).toEqual([]);
	});

	it("still returns a real post via direct by-id fetch", async () => {
		tableData["posts"] = [
			{
				id: "p1",
				title: "Broken projector in room 12",
				type: "problem",
				category: "Facilities",
				status: "reported",
				author_id: "anon-2",
				hidden: false,
				deleted: false,
				created_at: "2026-07-15T00:00:00Z",
				updated_at: "2026-07-15T00:00:00Z",
				admin_reply: null,
			},
		];

		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "GET", query: { id: "p1" }, body: {}, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as { post: { title: string } }).post.title).toBe(
			"Broken projector in room 12",
		);
	});

	it("filters artifacts from author listings too (MyActivity)", async () => {
		tableData["posts"] = [
			{
				id: "p1",
				title: "Test post in Other category",
				type: "suggestion",
				category: "Other",
				status: "reported",
				author_id: "anon-9",
				hidden: false,
				deleted: false,
				created_at: "2026-07-23T00:00:00Z",
				updated_at: "2026-07-23T00:00:00Z",
				admin_reply: null,
			},
		];

		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "GET", query: { author: "anon-9" }, body: {}, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body as Array<{ title: string }>).toEqual([]);
	});

	it("filters artifacts from admin views even without the flag (no admin exemption)", async () => {
		tableData["posts"] = [
			{
				id: "p1",
				title: "QA test post 2026-07-14",
				type: "problem",
				category: "Academics",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-14T00:00:00Z",
				updated_at: "2026-07-14T00:00:00Z",
				admin_reply: null,
			},
		];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "GET", query: { all: "1" }, body: {}, headers: {} },
			res,
		);

		expect(res.statusCode).toBe(200);
		expect(res.body as Array<{ title: string }>).toEqual([]);
	});

	it("admin dashboard filter_artifacts=1 hides fuzz junk but keeps real posts", async () => {
		tableData["posts"] = [
			{
				id: "p1",
				title: "Fzqbn otsm8vjg lh2d3kil",
				type: "problem",
				category: "Academics",
				status: "reported",
				author_id: "fuzz-1.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-26T00:00:00Z",
				updated_at: "2026-07-26T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p2",
				title: "QA test post 2026-07-14",
				type: "problem",
				category: "Academics",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-25T00:00:00Z",
				updated_at: "2026-07-25T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p3",
				title: "Content Type Test",
				type: "problem",
				category: "Other",
				status: "reported",
				author_id: "content-t.",
				hidden: false,
				deleted: false,
				created_at: "2026-07-24T00:00:00Z",
				updated_at: "2026-07-24T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p4",
				title: "WiFi down in library",
				type: "problem",
				category: "Facilities",
				status: "reported",
				author_id: "anon-2",
				hidden: false,
				deleted: false,
				created_at: "2026-07-23T00:00:00Z",
				updated_at: "2026-07-23T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p5",
				title: "Suggestion: more bike racks",
				type: "suggestion",
				category: "Other",
				status: "reported",
				author_id: "anon-3",
				hidden: false,
				deleted: false,
				created_at: "2026-07-22T00:00:00Z",
				updated_at: "2026-07-22T00:00:00Z",
				admin_reply: null,
			},
		];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { all: "1", filter_artifacts: "1" },
				body: {},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		const titles = (res.body as Array<{ title: string }>).map((p) => p.title);
		expect(titles).toEqual([
			"WiFi down in library",
			"Suggestion: more bike racks",
		]);
		expect(titles).not.toContain("Fzqbn otsm8vjg lh2d3kil");
		expect(titles).not.toContain("QA test post 2026-07-14");
		expect(titles).not.toContain("Content Type Test");
	});

	it("filter_artifacts=1 without admin access is ignored (no privilege escalation)", async () => {
		tableData["posts"] = [
			{
				id: "p1",
				title: "QA test post 2026-07-14",
				type: "problem",
				category: "Academics",
				status: "reported",
				author_id: "anon-1",
				hidden: false,
				deleted: false,
				created_at: "2026-07-14T00:00:00Z",
				updated_at: "2026-07-14T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "p2",
				title: "Real post",
				type: "problem",
				category: "Other",
				status: "reported",
				author_id: "anon-2",
				hidden: false,
				deleted: false,
				created_at: "2026-07-13T00:00:00Z",
				updated_at: "2026-07-13T00:00:00Z",
				admin_reply: null,
			},
		];
		// isAdmin resolves false: the public feed filter already hides artifacts.
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { all: "1", filter_artifacts: "1" },
				body: {},
				headers: {},
			},
			res,
		);

		expect(res.statusCode).toBe(200);
		expect((res.body as Array<{ title: string }>).map((p) => p.title)).toEqual([
			"Real post",
		]);
	});
});
