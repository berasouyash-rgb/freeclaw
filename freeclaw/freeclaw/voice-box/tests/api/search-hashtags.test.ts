// Hashtag search contract — #tag must find posts tagged `tag`.
//
// Two layers make this true (both pinned here):
//  1. the DB prefilter strips `#` for the ilike scan AND pulls tag matches
//     explicitly via overlaps("tags", …), because ilike cannot scan the
//     tags text[] array — without the overlap pull a tag-only post never
//     reaches the scorer;
//  2. the in-memory scorer strips `#` per word so `#canteen` scores the
//     tag `canteen` instead of matching nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	posts: [] as Array<Record<string, unknown>>,
	calls: [] as Array<{ table: string; or: string[] }>,
}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			const state = { table, or: [] as string[] };
			const builder: Record<string, (...a: never[]) => unknown> = {};
			builder.select = () => builder;
			builder.eq = () => builder;
			builder.or = ((s: string) => {
				state.or.push(s);
				return builder;
			}) as (...a: never[]) => unknown;
			builder.ilike = () => builder;
			builder.order = () => builder;
			builder.limit = () => builder;
			builder.then = (resolve: (v: unknown) => void) => {
				db.calls.push({ table, or: state.or });
				resolve({
					data: table === "posts" ? db.posts : [],
					error: null,
				});
			};
			return builder;
		},
	},
}));

import handler from "../../api/_search.js";

function mockRes() {
	const res: {
		statusCode?: number;
		body?: unknown;
		status: (n: number) => unknown;
		json: (b: unknown) => unknown;
		setHeader: () => void;
	} = {
		status: (n: number) => {
			res.statusCode = n;
			return res;
		},
		json: (b: unknown) => {
			res.body = b;
			return res;
		},
		setHeader: () => {},
	};
	return res;
}

const req = (q: string) => ({
	method: "GET",
	query: { q, type: "all", status: "all", category: "all", priority: "all" },
	headers: {},
});

const POST_TAGGED = {
	id: "p-tag-1",
	type: "problem",
	title: "Food is served cold",
	description: "Lunch arrives late every day",
	category: "Food",
	status: "reported",
	priority: "medium",
	author_id: "anon_a",
	created_at: new Date().toISOString(),
	tags: ["canteen"],
	deleted: false,
	hidden: false,
};

const POST_OTHER = {
	...POST_TAGGED,
	id: "p-other-1",
	title: "Library closes early",
	tags: ["library"],
};

beforeEach(() => {
	vi.clearAllMocks();
	db.calls.length = 0;
	db.posts = [POST_TAGGED, POST_OTHER];
});

describe("hashtag search", () => {
	it("#canteen finds the post tagged canteen (title has no such word)", async () => {
		const res = mockRes();
		// trailing token keeps the query unique per test — the module-scope
		// SWR cache keys on q, and the tag word must stay first and intact
		await handler(req("#canteen uniqone") as never, res as never);
		const ids = (
			(res.body as { results: Array<{ id: string }> }).results || []
		).map((r) => r.id);
		expect(ids).toContain("p-tag-1");
		expect(ids).not.toContain("p-other-1");
	});

	it("folds the tag into the SAME scan (ilike cannot read text[] arrays)", async () => {
		const res = mockRes();
		await handler(req("#canteen uniqtwo") as never, res as never);
		expect(res.statusCode).toBe(200);
		// Still exactly one posts scan per search (the perf guard counts
		// from("posts") calls) — the tag rides in the or() filter string.
		const postScans = db.calls.filter((c) => c.table === "posts");
		expect(postScans.length).toBe(1);
		expect(postScans[0].or.join(",")).toContain("tags.ov.{canteen}");
	});

	it("plain canteen still matches the tagged post (no regression)", async () => {
		const res = mockRes();
		await handler(req("canteen uniqthree") as never, res as never);
		const ids = (
			(res.body as { results: Array<{ id: string }> }).results || []
		).map((r) => r.id);
		expect(ids).toContain("p-tag-1");
	});
});
