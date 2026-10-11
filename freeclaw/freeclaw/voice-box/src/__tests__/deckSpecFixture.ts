// Shared canned deck spec for ReportDeck suites — mirrors the live
// GET /api/report-deck shape (see api/_report-deck.js). Every number is
// fixed so selection/filtering assertions are exact, never approximate.
import type { DeckSpec } from "../lib/reportDeck";

export function cannedSpec(): DeckSpec {
	return {
		version: 1,
		generated_at: "2026-10-10T12:00:00.000Z",
		window: 2000,
		totals: {
			posts: 10,
			open: 7,
			solved: 3,
			reports_open: 4,
			reports_resolved: 2,
			polls: 3,
			votes: 9,
		},
		by_category: [
			{ category: "Facilities", open: 4, solved: 1, total: 5 },
			{ category: "Food", open: 3, solved: 2, total: 5 },
		],
		by_status: [
			{ status: "open", count: 5 },
			{ status: "solved", count: 3 },
			{ status: "in_progress", count: 2 },
		],
		top_supported: [
			{
				id: "p1",
				title: "Fix the lab taps",
				category: "Facilities",
				status: "open",
				support: 5,
				upvote: 2,
				score: 7,
			},
			{
				id: "p2",
				title: "Longer library hours",
				category: "Food",
				status: "solved",
				support: 3,
				upvote: 1,
				score: 4,
			},
		],
		top_polls: [
			{ id: "poll1", title: "Canteen menu", total: 6 },
			{ id: "poll2", title: "Sports day", total: 3 },
		],
		solved_by_week: [
			{ week: "2026-09-28", solved: 1 },
			{ week: "2026-10-05", solved: 2 },
		],
		recommendations: [
			{ rule: "category-dominance", text: "Facilities dominates the queue." },
			{ rule: "quiet-polls", text: "Feature the quiet polls." },
		],
		narrations: {
			cover: "10 posts in scope, 7 still open. Resolution rate 30%.",
			complaints:
				"Facilities holds 4 of 7 open items (57%) — fix this category first.",
			feed: "3 of 10 posts resolved (30%). The ring is the share done.",
			reports: "4 reports need a human decision; 2 already resolved.",
			polls: "\u201cCanteen menu\u201d leads with 6 of 9 votes (67%).",
			trends: "Last week: 2 solved vs 1 the week before.",
			actions: "2 recommended moves, each labeled with the rule that fired.",
		},
	};
}

export function emptySpec(): DeckSpec {
	return {
		version: 1,
		generated_at: "2026-10-10T12:00:00.000Z",
		window: 2000,
		totals: {
			posts: 0,
			open: 0,
			solved: 0,
			reports_open: 0,
			reports_resolved: 0,
			polls: 0,
			votes: 0,
		},
		by_category: [],
		by_status: [],
		top_supported: [],
		top_polls: [],
		solved_by_week: [],
		recommendations: [{ rule: "steady", text: "Nothing to report yet." }],
		narrations: {
			cover: "0 posts in scope, 0 still open. Resolution rate 0%.",
			complaints: "No open complaints right now.",
			feed: "0 of 0 posts resolved (0%). The ring is the share done.",
			reports: "The moderation queue is clear.",
			polls: "No votes cast yet — feature the polls to start participation.",
			trends: "No resolutions recorded yet.",
			actions: "1 recommended move, each labeled with the rule that fired.",
		},
	};
}
