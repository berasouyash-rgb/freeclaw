// ═══════════════════════════════════════════════════════════════════
// Leaderboard API — test/fuzz artifact filtering contract
// ═══════════════════════════════════════════════════════════════════
// Locks the garbage filter in /api/leaderboard:
//   - Fuzz gibberish ("Fzqbn …", "Wxcrp …", "Kjvwm …", "Xqvtm …"), "QA test …",
//     "Test post/poll …", yes/no polls auto-generated from a test post, and any
//     title containing the whole word "test" are excluded from the ranked
//     problems, suggestions, and polls arrays (and thus the merged leaderboard)
//     — but real content still ranks normally.
// Rows are NOT deleted server-side; they are only filtered out of ranking.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const tableData: Record<string, unknown[]> = {};
const from = vi.fn();
// Failure injection for the degraded-counts paths. Reset per test.
let pollsHiddenErrorOnce = false;
let pollVotesError: Error | null = null;

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
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
	const filters: Record<string, unknown> = {};
	const neqFilters: Record<string, unknown> = {};
	const chain = {
		select: vi.fn().mockReturnThis(),
		eq(col: string, val: unknown) {
			filters[col] = val;
			return this;
		},
		neq(col: string, val: unknown) {
			neqFilters[col] = val;
			return this;
		},
		in: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		maybeSingle() {
			// settings lookups resolve to the single stored row (or null)
			return Promise.resolve({
				data: (tableData[table] as Record<string, unknown>[] | undefined)?.[0] ?? null,
				error: null,
			});
		},
		then(onResolve: (v: unknown) => void) {
			// Pre-migration databases lack polls.hidden: the first (filtered)
			// query errors once, and the route must retry without the filter.
			if (table === "polls" && pollsHiddenErrorOnce && "hidden" in neqFilters) {
				pollsHiddenErrorOnce = false;
				onResolve({
					data: null,
					error: Object.assign(new Error('column "hidden" does not exist'), {
						code: "PGRST204",
					}),
				});
				return;
			}
			if (table === "poll_votes" && pollVotesError) {
				onResolve({ data: null, error: pollVotesError });
				return;
			}
			const rows = tableData[table] ?? [];
			let filtered =
				"type" in filters && table === "posts"
					? rows.filter((r) => (r as { type: string }).type === filters.type)
					: rows;
			// Mirror PostgREST neq("hidden", true): rows without the column
			// (legacy/seeded) stay visible; only hidden:true drops out.
			if (table === "polls" && "hidden" in neqFilters)
				filtered = filtered.filter(
					(r) => (r as { hidden?: unknown }).hidden !== true,
				);
			onResolve({ data: filtered, error: null });
		},
	};
	return chain;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	// Reset the shared table store so no config/data leaks between tests.
	for (const k of Object.keys(tableData)) delete tableData[k];
	pollsHiddenErrorOnce = false;
	pollVotesError = null;
	from.mockImplementation((table: string) => chainFor(table));
});

describe("GET /api/leaderboard — test/fuzz artifact filter", () => {
	it('excludes fuzz, QA, and "Test post/poll" artifacts from every ranked list', async () => {
		tableData["posts"] = [
			{
				id: "post_a",
				title: "Fzqbn otsm8vjg lh2d3kil",
				type: "problem",
				category: "Academics",
				status: "reported",
				created_at: "2026-07-26T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_g",
				title: "Wxcrp 9kgndw01 dv7eo9xu",
				type: "problem",
				category: "Other",
				status: "reported",
				created_at: "2026-07-25T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_h",
				title: "Xqvtm 4srdhkky mupsxdes",
				type: "suggestion",
				category: "Other",
				status: "reported",
				created_at: "2026-07-24T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_b",
				title: "QA test post 2026-07-14",
				type: "problem",
				category: "Academics",
				status: "reported",
				created_at: "2026-07-14T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_c",
				title: "Test post in Other category",
				type: "suggestion",
				category: "Other",
				status: "reported",
				created_at: "2026-07-23T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_e",
				title: "Content Type Test",
				type: "suggestion",
				category: "Other",
				status: "reported",
				created_at: "2026-07-22T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_f",
				title: "Final Workflow Test",
				type: "suggestion",
				category: "Academics",
				status: "reported",
				created_at: "2026-07-22T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_d",
				title: "Broken window in Science Lab B",
				type: "problem",
				category: "Facilities",
				status: "in_progress",
				created_at: "2026-07-15T00:00:00Z",
				admin_reply: null,
			},
		];
		tableData["polls"] = [
			{
				id: "poll_a",
				title: "Test poll 210147",
				ptype: "multi",
				created_at: "2026-07-15T00:00:00Z",
				archived: false,
			},
			{
				id: "poll_b",
				title: "Do you agree: Test post in Technology category?",
				ptype: "yesno",
				created_at: "2026-07-23T00:00:00Z",
				archived: false,
			},
			{
				id: "poll_c",
				title: "Should we prioritize lab repairs?",
				ptype: "yesno",
				created_at: "2026-07-15T00:00:00Z",
				archived: false,
			},
		];
		tableData["reactions"] = [
			{ target_id: "post_a", kind: "support" },
			{ target_id: "post_g", kind: "support" },
			{ target_id: "post_h", kind: "support" },
			{ target_id: "post_b", kind: "support" },
			{ target_id: "post_c", kind: "upvote" },
			{ target_id: "post_e", kind: "support" },
			{ target_id: "post_f", kind: "support" },
			{ target_id: "post_d", kind: "support" },
		];
		tableData["poll_votes"] = [
			{ poll_id: "poll_a" },
			{ poll_id: "poll_a" },
			{ poll_id: "poll_b" },
			{ poll_id: "poll_c" },
			{ poll_id: "poll_c" },
			{ poll_id: "poll_c" },
			{ poll_id: "poll_c" },
		];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];

		const { default: handler } = await import("../../api/_leaderboard.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		// Real content ranks; all three test/fuzz artifacts are gone.
		expect(res.body.problems.map((p: { title: string }) => p.title)).toEqual([
			"Broken window in Science Lab B",
		]);
		expect(res.body.suggestions.map((s: { title: string }) => s.title)).toEqual(
			[],
		);
		expect(res.body.polls.map((p: { title: string }) => p.title)).toEqual([
			"Should we prioritize lab repairs?",
		]);
		// Merged leaderboard only contains real content.
		const mergedTitles = res.body.leaderboard.map(
			(i: { title: string }) => i.title,
		);
		// Poll ranks higher (4 votes) than problem (1 support); both should appear
		// under default page_size=25. Verify artifacts are excluded.
		expect(mergedTitles).toContain("Should we prioritize lab repairs?");
		expect(mergedTitles).not.toContain("Fzqbn otsm8vjg lh2d3kil");
		expect(mergedTitles).not.toContain("Wxcrp 9kgndw01 dv7eo9xu");
		expect(mergedTitles).not.toContain("Xqvtm 4srdhkky mupsxdes");
		expect(mergedTitles).not.toContain("QA test post 2026-07-14");
		expect(mergedTitles).not.toContain("Test post in Other category");
		expect(mergedTitles).not.toContain("Test poll 210147");
		expect(mergedTitles).not.toContain(
			"Do you agree: Test post in Technology category?",
		);
		expect(mergedTitles).not.toContain("Content Type Test");
		expect(mergedTitles).not.toContain("Final Workflow Test");
	});

	it("keeps normal content ranked by support when no artifacts exist", async () => {
		tableData["posts"] = [
			{
				id: "post_x",
				title: "Broken window in Science Lab B",
				type: "problem",
				category: "Facilities",
				status: "in_progress",
				created_at: "2026-07-15T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_y",
				title: "Canteen food is cold",
				type: "suggestion",
				category: "Canteen",
				status: "reported",
				created_at: "2026-07-16T00:00:00Z",
				admin_reply: null,
			},
		];
		tableData["polls"] = [
			{
				id: "poll_x",
				title: "Should we prioritize lab repairs?",
				ptype: "yesno",
				created_at: "2026-07-15T00:00:00Z",
				archived: false,
			},
		];
		tableData["reactions"] = [
			{ target_id: "post_x", kind: "support" },
			{ target_id: "post_x", kind: "support" },
			{ target_id: "post_y", kind: "upvote" },
		];
		tableData["poll_votes"] = [
			{ poll_id: "poll_x" },
			{ poll_id: "poll_x" },
			{ poll_id: "poll_x" },
		];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];

		const { default: handler } = await import("../../api/_leaderboard.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);

		expect(res.statusCode).toBe(200);
		expect(res.body.problems.map((p: { title: string }) => p.title)).toEqual([
			"Broken window in Science Lab B",
		]);
		expect(res.body.suggestions.map((s: { title: string }) => s.title)).toEqual(
			["Canteen food is cold"],
		);
		expect(res.body.polls.map((p: { title: string }) => p.title)).toEqual([
			"Should we prioritize lab repairs?",
		]);
	});

	it("405s on non-GET methods", async () => {
		const { default: handler } = await import("../../api/_leaderboard.js");
		const res = response();
		await handler({ method: "POST", query: {}, body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});

describe("GET /api/leaderboard — admin customization is applied", () => {
	function seedBoard() {
		tableData["posts"] = [
			{
				id: "post_hot",
				title: "Broken window in Science Lab B",
				type: "problem",
				category: "Facilities",
				status: "in_progress",
				created_at: "2026-07-15T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_cold",
				title: "Canteen food is cold",
				type: "suggestion",
				category: "Canteen",
				status: "reported",
				created_at: "2026-07-16T00:00:00Z",
				admin_reply: null,
			},
		];
		tableData["polls"] = [
			{
				id: "poll_x",
				title: "Should we prioritize lab repairs?",
				ptype: "yesno",
				created_at: "2026-07-15T00:00:00Z",
				archived: false,
			},
		];
		tableData["reactions"] = [
			{ target_id: "post_hot", kind: "support" },
			{ target_id: "post_hot", kind: "support" },
			// suggestion "post_cold" gets a non-counted kind so it has zero
			// support for suggestion ranking (only upvote counts there)
			{ target_id: "post_cold", kind: "frustrated" },
		];
		tableData["poll_votes"] = [{ poll_id: "poll_x" }];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];
	}

	async function fetchBoard() {
		const { default: handler } = await import("../../api/_leaderboard.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		return res;
	}

	it("with no stored config, defaults apply (full board)", async () => {
		delete tableData["settings"];
		seedBoard();
		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		expect(res.body.problems.length).toBe(1);
		expect(res.body.suggestions.length).toBe(1);
		expect(res.body.polls.length).toBe(1);
	});

	it("hide_empty drops zero-support entries from every ranked list", async () => {
		tableData["settings"] = [
			{ key: "leaderboard_config", value: { hide_empty: true } },
		];
		// suggestion "Canteen food is cold" has zero upvotes (kind upvote counts 0)
		// → problem has 2 support, poll has 1 vote; the empty suggestion must vanish.
		seedBoard();
		const res = await fetchBoard();
		expect(res.body.problems.map((p: { title: string }) => p.title)).toEqual([
			"Broken window in Science Lab B",
		]);
		expect(res.body.suggestions).toEqual([]);
		expect(res.body.polls.length).toBe(1);
	});

	it("page_size caps each ranked list", async () => {
		tableData["settings"] = [
			{ key: "leaderboard_config", value: { page_size: 5 } },
		];
		const posts = Array.from({ length: 8 }, (_, i) => ({
			id: `post_${i}`,
			title: `Real item ${i}`,
			type: "problem",
			category: "Other",
			status: "reported",
			created_at: `2026-07-${10 + i}T00:00:00Z`,
			admin_reply: null,
		}));
		tableData["posts"] = posts;
		tableData["polls"] = [];
		tableData["reactions"] = posts.map((p, i) => ({
			target_id: p.id,
			kind: "support",
			count: i,
		}));
		tableData["poll_votes"] = [];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];
		const res = await fetchBoard();
		expect(res.body.problems.length).toBeLessThanOrEqual(5);
	});

	it("pinned_ids rise to the top of the merged leaderboard in listed order", async () => {
		tableData["settings"] = [
			{ key: "leaderboard_config", value: { pinned_ids: ["post_cold"] } },
		];
		seedBoard();
		const res = await fetchBoard();
		const merged = res.body.leaderboard.map((i: { title: string }) => i.title);
		// pinned "Canteen food is cold" outranks the higher-score entries
		expect(merged[0]).toBe("Canteen food is cold");
		expect(merged).toContain("Broken window in Science Lab B");
	});

	it("pins survive hide_empty even with zero support (explicit override)", async () => {
		// "post_cold" (suggestion) has zero counted support (frustrated kind);
		// hide_empty alone would drop it from the merged board, but the pin must win.
		tableData["settings"] = [
			{
				key: "leaderboard_config",
				value: { pinned_ids: ["post_cold"], hide_empty: true },
			},
		];
		seedBoard();
		const res = await fetchBoard();
		const merged = res.body.leaderboard.map((i: { title: string }) => i.title);
		expect(merged[0]).toBe("Canteen food is cold");
		// …but hide_empty still governs the unpinned rest: the 1-vote poll and
		// the 2-support problem stay, and nothing with zero support leaks in.
		expect(merged.filter((t: string) => t !== "Canteen food is cold")).toEqual([
			"Broken window in Science Lab B",
			"Should we prioritize lab repairs?",
		]);
	});

	it("pins resolve from the FULL list, not just the page_size-capped slice", async () => {
		// 8 problems ranked by score; page_size 5 means post_2…post_7 are below
		// the visible cap. Pinning post_7 (lowest score) must still surface it.
		tableData["settings"] = [
			{ key: "leaderboard_config", value: { page_size: 5, pinned_ids: ["post_7"] } },
		];
		const posts = Array.from({ length: 8 }, (_, i) => ({
			id: `post_${i}`,
			title: `Real item ${i}`,
			type: "problem",
			category: "Other",
			status: "reported",
			created_at: `2026-07-${10 + i}T00:00:00Z`,
			admin_reply: null,
		}));
		tableData["posts"] = posts;
		tableData["polls"] = [];
		tableData["reactions"] = posts.map((p) => ({
			target_id: p.id,
			kind: "support",
		}));
		tableData["poll_votes"] = [];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];
		const res = await fetchBoard();
		const merged = res.body.leaderboard.map((i: { id: string }) => i.id);
		expect(merged[0]).toBe("post_7");
		expect(merged).toContain("post_7");
	});

	it("merged board respects page_size (no hard-coded 20 cap)", async () => {
		tableData["settings"] = [
			{ key: "leaderboard_config", value: { page_size: 6 } },
		];
		const posts = Array.from({ length: 8 }, (_, i) => ({
			id: `post_${i}`,
			title: `Real item ${i}`,
			type: "problem",
			category: "Other",
			status: "reported",
			created_at: `2026-07-${10 + i}T00:00:00Z`,
			admin_reply: null,
		}));
		tableData["posts"] = posts;
		tableData["polls"] = [];
		tableData["reactions"] = posts.map((p) => ({
			target_id: p.id,
			kind: "support",
		}));
		tableData["poll_votes"] = [];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];
		const res = await fetchBoard();
		expect(res.body.leaderboard.length).toBe(6);
	});

	it("enabled=false returns an empty board (leaderboard hidden)", async () => {
		tableData["settings"] = [
			{ key: "leaderboard_config", value: { enabled: false } },
		];
		seedBoard();
		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		expect(res.body.problems).toEqual([]);
		expect(res.body.suggestions).toEqual([]);
		expect(res.body.polls).toEqual([]);
		expect(res.body.leaderboard).toEqual([]);
	});

	it("merged board preserves the correct type label per section", async () => {
		tableData["posts"] = [
			{
				id: "post_p",
				title: "A problem",
				type: "problem",
				category: "Facilities",
				status: "reported",
				created_at: "2026-07-15T00:00:00Z",
				admin_reply: null,
			},
			{
				id: "post_s",
				title: "A suggestion",
				type: "suggestion",
				category: "Canteen",
				status: "reported",
				created_at: "2026-07-16T00:00:00Z",
				admin_reply: null,
			},
		];
		tableData["polls"] = [
			{
				id: "poll_1",
				title: "A poll",
				ptype: "yesno",
				created_at: "2026-07-17T00:00:00Z",
				archived: false,
			},
		];
		tableData["reactions"] = [
			{ target_id: "post_p", kind: "support" },
			{ target_id: "post_s", kind: "upvote" },
		];
		tableData["poll_votes"] = [{ poll_id: "poll_1" }];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];
		const res = await fetchBoard();
		const byTitle = Object.fromEntries(
			res.body.leaderboard.map((i: { title: string; type: string }) => [
				i.title,
				i.type,
			]),
		);
		expect(byTitle["A problem"]).toBe("problem");
		expect(byTitle["A suggestion"]).toBe("suggestion");
		expect(byTitle["A poll"]).toBe("poll");
	});

	it("unused config keys are ignored safely (only known keys apply)", async () => {
		tableData["settings"] = [
			{
				key: "leaderboard_config",
				value: { enabled: true, hide_empty: false, page_size: 25, evil: "x" },
			},
		];
		seedBoard();
		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		expect(res.body.problems.length).toBe(1);
	});
});

describe("GET /api/leaderboard — hidden polls and degraded counts", () => {
	function seedPollBoard() {
		tableData["posts"] = [];
		tableData["polls"] = [
			{
				id: "poll_live",
				title: "Should we pave the courtyard?",
				ptype: "yesno",
				created_at: "2026-07-15T00:00:00Z",
				archived: false,
			},
			{
				id: "poll_hidden",
				title: "Should we extend the library hours?",
				ptype: "yesno",
				created_at: "2026-07-16T00:00:00Z",
				archived: false,
				hidden: true,
			},
		];
		tableData["reactions"] = [];
		tableData["poll_votes"] = [
			{ poll_id: "poll_live" },
			{ poll_id: "poll_hidden" },
			{ poll_id: "poll_hidden" },
		];
		tableData["agent_executions"] = [];
		tableData["agent_insights"] = [];
	}

	async function fetchBoard() {
		const { default: handler } = await import("../../api/_leaderboard.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		return res;
	}

	it("excludes hidden (moderated) polls from every ranked list", async () => {
		// Problems/suggestions already filter hidden — polls must match, or a
		// moderated poll keeps ranking publicly.
		seedPollBoard();
		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		const titles = (res.body.polls as { title: string }[]).map((p) => p.title);
		expect(titles).toEqual(["Should we pave the courtyard?"]);
		const merged = (res.body.leaderboard as { title: string }[]).map((i) => i.title);
		expect(merged).not.toContain("Should we extend the library hours?");
		expect(res.body.degraded).toBeUndefined();
		expect(res.body.estimated).toBeUndefined();
	});

	it("retries without the hidden filter on pre-migration databases", async () => {
		// Migration 018 (polls.hidden) may be unapplied: the filtered query
		// errors once, and the board must degrade to unfiltered polls rather
		// than emptying the section.
		pollsHiddenErrorOnce = true;
		seedPollBoard();
		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		const titles = (res.body.polls as { title: string }[]).map((p) => p.title);
		expect(titles).toContain("Should we pave the courtyard?");
		expect(titles).toContain("Should we extend the library hours?");
	});

	it("flags the board degraded when vote counts fail instead of failing silently", async () => {
		seedPollBoard();
		pollVotesError = new Error("poll_votes fetch failed");
		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		// Fail-closed: without vote data the polls ranking cannot be computed,
		// so the section stays empty — but the board must SAY the ranks are
		// incomplete rather than look like a quiet board.
		expect(res.body.polls).toEqual([]);
		expect(res.body.degraded).toBe(true);
		expect(res.body.estimated).toBe(true);
	});
});

// ══════════════════════════════════════════════════════════════════
describe("GET /api/leaderboard — response contract the dashboard reads", () => {
	// src/lib/dashboard/widgets.tsx reads this payload with NO mapping
	// layer (PulseStrip stores the raw response per source key). Every
	// other test in this file stubs the agent tables empty, so ai_activity
	// rows were never pinned — a field rename would ship green and render
	// literal "—" rows in the production admin dashboard. Pin the exact
	// keys the widgets consume on both legs (AI rows + merged rows).
	async function fetchBoard() {
		const { default: handler } = await import("../../api/_leaderboard.js");
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		return res;
	}

	it("ai_activity rows carry {kind,label,detail,at} — the keys the widget reads", async () => {
		tableData["agent_executions"] = [
			{
				agent_id: "agent_1",
				agent_name: "moderator",
				division: "safety",
				task: "review post p1",
				status: "ok",
				started_at: "2026-10-03T09:00:00.000Z",
			},
		];
		tableData["agent_insights"] = [
			{
				agent_id: "scout",
				insight_type: "trend",
				reasoning: "library hours requested repeatedly",
				created_at: "2026-10-04T09:00:00.000Z",
			},
		];

		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		const ai = res.body.ai_activity as Record<string, unknown>[];
		expect(ai).toHaveLength(2);
		// Newest first (merged then sorted by `at` desc server-side — the
		// widget's stable sort trusts this order).
		expect(ai[0]).toMatchObject({
			kind: "learning",
			label: "scout",
			at: "2026-10-04T09:00:00.000Z",
		});
		expect(String(ai[0].detail)).toContain("library hours");
		expect(ai[1]).toMatchObject({
			kind: "execution",
			label: "moderator",
			at: "2026-10-03T09:00:00.000Z",
		});
		expect(String(ai[1].detail)).toContain("review post p1");
		// The agent_name/count columns exist upstream but are mapped away —
		// if a row ever leaks them raw the widget contract has changed.
		expect(ai[0]).not.toHaveProperty("agent_name");
		expect(ai[0]).not.toHaveProperty("count");
	});

	it("merged rows expose `title` and `score`, never a `name` field", async () => {
		tableData["posts"] = [
			{
				id: "post_x",
				title: "Broken window in Science Lab B",
				type: "problem",
				category: "Facilities",
				status: "in_progress",
				created_at: "2026-07-15T00:00:00Z",
				admin_reply: null,
			},
		];
		tableData["reactions"] = [{ target_id: "post_x", kind: "support" }];

		const res = await fetchBoard();
		expect(res.statusCode).toBe(200);
		const merged = res.body.leaderboard as Record<string, unknown>[];
		expect(merged).toHaveLength(1);
		expect(merged[0].title).toBe("Broken window in Science Lab B");
		expect(typeof merged[0].score).toBe("number");
		expect(merged[0]).not.toHaveProperty("name");
	});
});
