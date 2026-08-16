// ═══════════════════════════════════════════════════════════════════
// Polls API — full-site test/fuzz artifact filtering contract
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/polls GET filter:
//   - Public AND admin poll listings hide test/fuzz titles (gibberish,
//     whole-word "test", "QA test …", "Test poll …").
//   - Orphaned post_id cleanup runs against the filtered set.
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
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: () => ({ blocked: false, requiresReview: false, flags: [] }),
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

function chainFor(table: string, _selectArgs: unknown) {
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
			onResolve({ data: tableData[table] ?? [], error: null });
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

describe("GET /api/polls — artifact filter", () => {
	it("hides test/fuzz polls from the public listing but keeps real polls", async () => {
		tableData["polls"] = [
			{
				id: "poll_a",
				title: "Fzqbn otsm8vjg lh2d3kil",
				ptype: "yesno",
				options: ["Yes", "No"],
				author_id: "fuzz-1.",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-26T00:00:00Z",
			},
			{
				id: "poll_b",
				title: "Test poll 210147",
				ptype: "multi",
				options: ["A", "B"],
				author_id: "fuzz-2.",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-25T00:00:00Z",
			},
			{
				id: "poll_c",
				title: "Do you agree: Test post in Technology category?",
				ptype: "yesno",
				options: ["Yes", "No"],
				author_id: "fuzz-3.",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-24T00:00:00Z",
			},
			{
				id: "poll_d",
				title: "Should we prioritize lab repairs?",
				ptype: "yesno",
				options: ["Yes", "No"],
				author_id: "anon-2",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-23T00:00:00Z",
			},
		];
		tableData["poll_votes"] = [];
		tableData["posts"] = [];

		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		const titles = (res.body as Array<{ title: string }>).map((p) => p.title);
		expect(titles).toEqual(["Should we prioritize lab repairs?"]);
		expect(titles).not.toContain("Fzqbn otsm8vjg lh2d3kil");
		expect(titles).not.toContain("Test poll 210147");
		expect(titles).not.toContain(
			"Do you agree: Test post in Technology category?",
		);
	});

	it("filters artifacts from admin poll listings too (no admin exemption)", async () => {
		tableData["polls"] = [
			{
				id: "poll_a",
				title: "QA test poll 2026-07-14",
				ptype: "yesno",
				options: ["Yes", "No"],
				author_id: "fuzz-1.",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-26T00:00:00Z",
			},
			{
				id: "poll_b",
				title: "Should the library open longer hours?",
				ptype: "yesno",
				options: ["Yes", "No"],
				author_id: "anon-3",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-25T00:00:00Z",
			},
		];
		tableData["poll_votes"] = [];
		tableData["posts"] = [];
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		expect((res.body as Array<{ title: string }>).map((p) => p.title)).toEqual([
			"Should the library open longer hours?",
		]);
	});

	it("still reports vote counts for the real polls that survive filtering", async () => {
		tableData["polls"] = [
			{
				id: "poll_a",
				title: "Test poll 210147",
				ptype: "multi",
				options: ["A", "B"],
				author_id: "fuzz-1.",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-25T00:00:00Z",
			},
			{
				id: "poll_b",
				title: "Should we prioritize lab repairs?",
				ptype: "yesno",
				options: ["Yes", "No"],
				author_id: "anon-2",
				deleted: false,
				archived: false,
				post_id: null,
				created_at: "2026-07-23T00:00:00Z",
			},
		];
		tableData["poll_votes"] = [
			{ poll_id: "poll_b", choices: [0] },
			{ poll_id: "poll_b", choices: [1] },
			{ poll_id: "poll_b", choices: [0] },
		];
		tableData["posts"] = [];

		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		const body = res.body as Array<{
			title: string;
			total_votes: number;
			vote_counts: Record<string, number>;
		}>;
		expect(body.map((p) => p.title)).toEqual([
			"Should we prioritize lab repairs?",
		]);
		expect(body[0].total_votes).toBe(3);
		expect(body[0].vote_counts).toEqual({ 0: 2, 1: 1 });
	});
});
