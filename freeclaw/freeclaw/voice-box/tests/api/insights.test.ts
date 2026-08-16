// ═══════════════════════════════════════════════════════════════════
// Community insights — GET /api/insights
// ═══════════════════════════════════════════════════════════════════
// Locks the aggregate contract:
//   totals         → posts/comments/reactions/polls/poll_votes/open/solved/participants
//   by_category    → [{ category, count, solved }]  sorted desc
//   by_status      → [{ status, count }]
//   trend          → last 15 days [{ date, posts, comments }] with zero-fill
//   top_categories → [{ category, count }] top 5
// Graceful when a table is empty; 405 on non-GET.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => ({
	posts: [] as unknown[],
	comments: [] as unknown[],
	reactions: [] as unknown[],
	polls: [] as unknown[],
	poll_votes: [] as unknown[],
}));

// Generic chain mock — every .select/.eq/.order/.limit returns the same
// proxy whose awaited value is { data, error } for the requested table.
function chainFor(data: unknown) {
	const result = { data, error: null };
	const proxy = new Proxy(result, {
		get: (t, p) => {
			if (p === "then") return undefined; // stay a plain object when awaited
			if (p in t) return t[p];
			return () => proxy;
		},
	});
	return proxy;
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => chainFor(tables[table as keyof typeof tables]),
	},
}));

vi.mock("../../api/_auth.js", () => ({
	cors: () => {},
}));

const api = await import("../../api/_insights.js");

interface MockRes {
	statusCode: number;
	headers: Record<string, string>;
	body: unknown;
	status: (code: number) => MockRes;
	setHeader: (k: string, v: string) => MockRes;
	json: (body: unknown) => MockRes;
	end: () => MockRes;
}

function response(): MockRes {
	const res: MockRes = {
		statusCode: 200,
		headers: {},
		body: undefined,
	} as unknown as MockRes;
	res.status = (code: number) => {
		res.statusCode = code;
		return res;
	};
	res.setHeader = (k: string, v: string) => {
		res.headers[k] = v;
		return res;
	};
	res.json = (body: unknown) => {
		res.body = body;
		return res;
	};
	res.end = () => res;
	return res;
}

// Fixture timestamps are RELATIVE to now (not fixed dates) so the 15-day
// trend window always contains them — the suite stays deterministic no
// matter when it runs or in which timezone.
const daysAgo = (n: number, hour = 9): string => {
	const d = new Date(Date.now() - n * 86400000);
	d.setUTCHours(hour, 0, 0, 0);
	return d.toISOString();
};

const POSTS = [
	{
		id: "p1",
		type: "problem",
		category: "Academics",
		status: "solved",
		created_at: daysAgo(3),
		author_id: "a1",
	},
	{
		id: "p2",
		type: "problem",
		category: "Academics",
		status: "reported",
		created_at: daysAgo(2),
		author_id: "a2",
	},
	{
		id: "p3",
		type: "suggestion",
		category: "Food",
		status: "in_progress",
		created_at: daysAgo(1),
		author_id: "a1",
	},
];
const COMMENTS = [
	{ id: "c1", post_id: "p1", author_id: "a3", created_at: daysAgo(3, 10) },
	{ id: "c2", post_id: "p2", author_id: "a2", created_at: daysAgo(1, 10) },
];
const REACTIONS = [
	{ id: "r1", target_id: "p1", kind: "support" },
	{ id: "r2", target_id: "p1", kind: "appreciate" },
	{ id: "r3", target_id: "p2", kind: "support" },
	{ id: "r4", target_id: "p3", kind: "upvote" },
];
const POLLS = [
	{
		id: "pl1",
		title: "Cafeteria hours",
		created_at: daysAgo(2, 8),
		author_id: "a4",
	},
];
const POLL_VOTES = [
	{ id: "v1", poll_id: "pl1" },
	{ id: "v2", poll_id: "pl1" },
];

beforeEach(() => {
	tables.posts = POSTS.map((p) => ({ ...p }));
	tables.comments = COMMENTS.map((c) => ({ ...c }));
	tables.reactions = REACTIONS.map((r) => ({ ...r }));
	tables.polls = POLLS.map((p) => ({ ...p }));
	tables.poll_votes = POLL_VOTES.map((v) => ({ ...v }));
});

describe("GET /api/insights — totals", () => {
	it("computes totals across all tables", async () => {
		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(res.body.totals).toEqual({
			posts: 3,
			comments: 2,
			reactions: 4,
			polls: 1,
			poll_votes: 2,
			open: 2,
			solved: 1,
			participants: 4,
		});
	});

	it("counts distinct participants across posts + comments", async () => {
		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		expect(res.body.totals.participants).toBe(4); // a1, a2, a3, a4
	});
});

describe("GET /api/insights — breakdowns", () => {
	it("returns by_category sorted desc with solved counts", async () => {
		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		expect(res.body.by_category).toEqual([
			{ category: "Academics", count: 2, solved: 1 },
			{ category: "Food", count: 1, solved: 0 },
		]);
	});

	it("returns by_status counts", async () => {
		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		const got = [...res.body.by_status].sort(
			(a: { status: string }, b: { status: string }) =>
				a.status.localeCompare(b.status),
		);
		expect(got).toEqual([
			{ status: "in_progress", count: 1 },
			{ status: "reported", count: 1 },
			{ status: "solved", count: 1 },
		]);
	});

	it("returns top_categories (top 5) sorted desc", async () => {
		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		expect(res.body.top_categories[0]).toEqual({
			category: "Academics",
			count: 2,
		});
	});
});

describe("GET /api/insights — trend", () => {
	it("zero-fills the full 15-day window", async () => {
		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		expect(res.body.trend).toHaveLength(15);
		const nonZero = res.body.trend.filter(
			(d: { posts: number; comments: number }) => d.posts > 0 || d.comments > 0,
		);
		expect(nonZero.length).toBeGreaterThan(0);
		// All 3 posts must appear somewhere in the trend
		const totalPosts = res.body.trend.reduce(
			(s: number, d: { posts: number }) => s + d.posts,
			0,
		);
		expect(totalPosts).toBe(3);
	});
});

describe("GET /api/insights — artifact exclusion", () => {
	it("excludes test/fuzz artifacts from every aggregate", async () => {
		tables.posts = [
			...POSTS.map((p) => ({ ...p })),
			{
				id: "pA",
				type: "problem",
				category: "Academics",
				status: "reported",
				created_at: daysAgo(0, 9),
				author_id: "fuzz-1.",
				title: "Fzqbn otsm8vjg lh2d3kil",
			},
			{
				id: "pB",
				type: "suggestion",
				category: "Food",
				status: "reported",
				created_at: daysAgo(0, 10),
				author_id: "fuzz-2.",
				title: "QA test post 2026-07-14",
			},
		];
		tables.comments = [
			...COMMENTS.map((c) => ({ ...c })),
			{
				id: "cA",
				post_id: "pA",
				author_id: "fuzz-1.",
				created_at: daysAgo(0, 11),
				body: "Fzqbn otsm8vjg lh2d3kil",
			},
		];
		tables.reactions = [
			...REACTIONS.map((r) => ({ ...r })),
			{ id: "rA", target_id: "pA", kind: "support" },
			{ id: "rB", target_id: "cA", kind: "upvote" },
		];
		tables.polls = [
			...POLLS.map((p) => ({ ...p })),
			{
				id: "plA",
				title: "Test poll 210147",
				created_at: daysAgo(0, 12),
				author_id: "fuzz-3.",
			},
		];
		tables.poll_votes = [
			...POLL_VOTES.map((v) => ({ ...v })),
			{ id: "vA", poll_id: "plA" },
			{ id: "vB", poll_id: "plA" },
		];

		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		expect(res.statusCode).toBe(200);
		// Artifact posts/comments/polls and their reactions/votes are all excluded.
		expect(res.body.totals).toEqual({
			posts: 3,
			comments: 2,
			reactions: 4,
			polls: 1,
			poll_votes: 2,
			open: 2,
			solved: 1,
			participants: 4,
		});
		expect(res.body.by_category).toEqual([
			{ category: "Academics", count: 2, solved: 1 },
			{ category: "Food", count: 1, solved: 0 },
		]);
	});
});

describe("GET /api/insights — robustness", () => {
	it("returns 200 with zeroed aggregates when a table is missing", async () => {
		tables.posts = undefined as unknown as unknown[];
		const res = response();
		await api.default({ method: "GET", query: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(res.body.totals.posts).toBe(0);
		expect(res.body.trend).toHaveLength(15);
	});

	it("returns 405 for non-GET methods", async () => {
		const res = response();
		await api.default({ method: "POST", query: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
