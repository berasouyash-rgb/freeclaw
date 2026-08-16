// Community Insights — aggregate participation stats across the whole board.
// GET /api/insights
//   → { totals, by_category, by_status, trend, top_categories, generated_at }
//
// Every aggregate is computed in code from raw rows; individual sub-queries
// are guarded so one missing table can never sink the endpoint.

import { isTestArtifact } from "./_artifact-filter.js";
import { cors } from "./_auth.js";
import supabase from "./_db-client.js";

const WINDOW_DAYS = 14; // trend covers WINDOW_DAYS + 1 buckets (today included)

async function fetchRows(table, columns, filters = []) {
	let q = supabase.from(table).select(columns);
	for (const [key, value] of filters) q = q.eq(key, value);
	const { data } = await q.limit(5000);
	return data || [];
}

const SOLVED = new Set(["solved", "archived"]);

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

	try {
		res.setHeader(
			"Cache-Control",
			"public, max-age=60, s-maxage=60, stale-while-revalidate=15",
		);

		let posts = [],
			comments = [],
			reactions = [],
			polls = [],
			pollVotes = [];
		try {
			posts = await fetchRows(
				"posts",
				"id,type,category,status,author_id,created_at,title",
				[["deleted", false]],
			);
		} catch {
			/* non-fatal */
		}
		try {
			comments = await fetchRows(
				"comments",
				"id,post_id,author_id,created_at,body",
				[["deleted", false]],
			);
		} catch {
			/* non-fatal */
		}
		try {
			reactions = await fetchRows("reactions", "id,target_id,kind");
		} catch {
			/* non-fatal */
		}
		try {
			polls = await fetchRows("polls", "id,title,author_id,created_at", [
				["deleted", false],
			]);
		} catch {
			/* non-fatal */
		}
		try {
			pollVotes = await fetchRows("poll_votes", "id,poll_id");
		} catch {
			/* non-fatal */
		}

		// Full-site zero-fuzz: drop test/fuzz artifacts BEFORE any aggregate is
		// computed so totals, categories, statuses, and trends stay clean. Rows
		// stay intact in the DB; they are only excluded from the numbers.
		posts = posts.filter((p) => !isTestArtifact(p.title));
		comments = comments.filter((c) => !isTestArtifact(c.body));
		polls = polls.filter((p) => !isTestArtifact(p.title));
		// Reactions and votes pointing at artifacts are counted with their targets.
		const cleanPostIds = new Set(posts.map((p) => p.id));
		const cleanCommentIds = new Set(comments.map((c) => c.id));
		const cleanPollIds = new Set(polls.map((p) => p.id));
		reactions = reactions.filter(
			(r) => cleanPostIds.has(r.target_id) || cleanCommentIds.has(r.target_id),
		);
		pollVotes = pollVotes.filter((v) => cleanPollIds.has(v.poll_id));

		// ── Totals ──────────────────────────────────────────────
		const open = posts.filter((p) => !SOLVED.has(p.status)).length;
		const solved = posts.filter((p) => SOLVED.has(p.status)).length;
		const participants = new Set();
		posts.forEach((p) => {
			if (p.author_id) participants.add(p.author_id);
		});
		comments.forEach((c) => {
			if (c.author_id) participants.add(c.author_id);
		});
		polls.forEach((p) => {
			if (p.author_id) participants.add(p.author_id);
		});

		const totals = {
			posts: posts.length,
			comments: comments.length,
			reactions: reactions.length,
			polls: polls.length,
			poll_votes: pollVotes.length,
			open,
			solved,
			participants: participants.size,
		};

		// ── By category ─────────────────────────────────────────
		const catMap = new Map();
		for (const p of posts) {
			const cat = p.category || "Other";
			const entry = catMap.get(cat) || { category: cat, count: 0, solved: 0 };
			entry.count += 1;
			if (SOLVED.has(p.status)) entry.solved += 1;
			catMap.set(cat, entry);
		}
		const byCategory = [...catMap.values()].sort((a, b) => b.count - a.count);

		// ── By status ───────────────────────────────────────────
		const statusMap = new Map();
		for (const p of posts) {
			const status = p.status || "reported";
			statusMap.set(status, (statusMap.get(status) || 0) + 1);
		}
		const byStatus = [...statusMap.entries()]
			.map(([status, count]) => ({ status, count }))
			.sort((a, b) => b.count - a.count);

		// ── Trend (zero-filled last WINDOW_DAYS+1 days) ─────────
		const buckets = [];
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		for (let i = WINDOW_DAYS; i >= 0; i -= 1) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			buckets.push({
				date: d.toISOString().slice(0, 10),
				posts: 0,
				comments: 0,
			});
		}
		const bucketByDate = new Map(buckets.map((b) => [b.date, b]));
		for (const p of posts) {
			const date = new Date(p.created_at);
			if (Number.isNaN(+date)) continue;
			const key = date.toISOString().slice(0, 10);
			const bucket = bucketByDate.get(key);
			if (bucket) bucket.posts += 1;
		}
		for (const c of comments) {
			const date = new Date(c.created_at);
			if (Number.isNaN(+date)) continue;
			const key = date.toISOString().slice(0, 10);
			const bucket = bucketByDate.get(key);
			if (bucket) bucket.comments += 1;
		}

		// ── Top categories (top 5) ──────────────────────────────
		const topCategories = byCategory
			.slice(0, 5)
			.map(({ category, count }) => ({ category, count }));

		return res.status(200).json({
			totals,
			by_category: byCategory,
			by_status: byStatus,
			trend: buckets,
			top_categories: topCategories,
			generated_at: new Date().toISOString(),
		});
	} catch (err) {
		console.error("insights error:", err.message);
		return res.status(500).json({ error: "Internal error" });
	}
}
