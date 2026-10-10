// Admin report deck — one endpoint composing the whole-platform report spec.
//
// The presentation layer (slides, charts, PPT export) renders THIS spec and
// nothing else: every number below is counted from live rows, every
// recommendation carries the deterministic rule that produced it, and an
// empty database yields an honest empty spec — never fabricated rows.
// New tables are never introduced here: posts + reactions/comments/polls
// (via the shared getRawCounts) + reports + polls, all already in the app.

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { isTestArtifact } from "./_artifact-filter.js";
import { fetchPaged } from "./_counts.js";

export const DECK_VERSION = 1;
// Bounded admin scan (same ceiling as the admin feed reads).
const POST_WINDOW = 2000;
const REPORT_WINDOW = 2000;
const POLL_WINDOW = 500;

/** Monday (UTC) bucket key for an ISO timestamp. */
function weekKey(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	const day = (d.getUTCDay() + 6) % 7; // Monday-first
	d.setUTCDate(d.getUTCDate() - day);
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString().slice(0, 10);
}

/**
 * Deterministic, rule-labeled recommendations. Pure over the aggregates —
 * unit-testable without I/O, and every entry names its rule so the admin
 * sees WHY, not just what. Thresholds are deliberately round and documented.
 */
export function buildRecommendations(ctx) {
	const out = [];
	const open = ctx.openPosts || [];
	const live = ctx.livePosts || [];
	// R1 — a single category dominates the open queue (≥30%, ≥3 open).
	const byCat = {};
	for (const p of open) byCat[p.category] = (byCat[p.category] || 0) + 1;
	const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
	if (top && open.length >= 3 && top[1] / open.length >= 0.3) {
		out.push({
			rule: "category-dominance",
			text: `${top[0]} holds ${top[1]} of ${open.length} open items (${Math.round((top[1] / open.length) * 100)}%). Consider a focused drive on ${top[0]} this week.`,
		});
	}
	// R2 — stale backlog (open items older than 30 days).
	const now = Date.now();
	const stale = open.filter(
		(p) => now - new Date(p.created_at).getTime() > 30 * 86400000,
	).length;
	if (stale > 0) {
		out.push({
			rule: "backlog-age",
			text: `${stale} open item${stale === 1 ? " is" : "s are"} older than 30 days. Review or re-scope them before they go stale.`,
		});
	}
	// R3 — low resolution rate (<25% solved, ≥5 live rows).
	const solved = live.filter((p) => p.status === "solved").length;
	if (live.length >= 5 && solved / live.length < 0.25) {
		out.push({
			rule: "resolution-rate",
			text: `Resolution rate is ${Math.round((solved / live.length) * 100)}% (${solved} of ${live.length}). Consider more resolver capacity or narrower intake.`,
		});
	}
	// R4 — polls with no votes (≥3) deserve featuring.
	if ((ctx.quietPolls || 0) >= 3) {
		out.push({
			rule: "quiet-polls",
			text: `${ctx.quietPolls} polls have no votes yet. Feature them on the home feed to jump-start participation.`,
		});
	}
	if (!out.length) {
		out.push({
			rule: "steady",
			text: "No hotspots right now: the queue is balanced and moving. Keep the cadence.",
		});
	}
	return out;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		const [{ data: postRows }, { data: reportRows }, { data: pollRows }] =
			await Promise.all([
				supabase
					.from("posts")
					.select("id,title,category,status,created_at,updated_at,deleted,hidden")
					.order("created_at", { ascending: false })
					.limit(POST_WINDOW),
				supabase.from("reports").select("id,status").limit(REPORT_WINDOW),
				supabase.from("polls").select("id,title").limit(POLL_WINDOW),
			]);

		const clean = (postRows || []).filter((p) => !isTestArtifact(p.title));
		const live = clean.filter((p) => !p.deleted && !p.hidden);
		const ids = live.map((p) => p.id);
		// Reaction map for exactly these posts (paginated: viral posts must
		// not truncate at the server page).
		const { data: reactRows } = await fetchPaged((page) =>
			supabase
				.from("reactions")
				.select("target_id,kind")
				.in("target_id", ids.length ? ids : ["__none__"])
				.range(page * 1000, page * 1000 + 999),
		);
		const rMap = {};
		for (const r of reactRows || []) {
			rMap[r.target_id] = rMap[r.target_id] || {};
			rMap[r.target_id][r.kind] = (rMap[r.target_id][r.kind] || 0) + 1;
		}

		const supportOf = (id) =>
			(rMap[id]?.support || 0) + (rMap[id]?.upvote || 0);
		const open = live.filter(
			(p) => p.status !== "solved" && p.status !== "archived",
		);
		const solved = live.filter((p) => p.status === "solved");

		const byCatMap = {};
		for (const p of live) {
			const c = p.category || "Other";
			byCatMap[c] = byCatMap[c] || { category: c, open: 0, solved: 0, total: 0 };
			byCatMap[c].total += 1;
			if (p.status === "solved") byCatMap[c].solved += 1;
			else if (p.status !== "archived") byCatMap[c].open += 1;
		}
		const by_category = Object.values(byCatMap).sort(
			(a, b) => b.total - a.total,
		);

		const byStatusMap = {};
		for (const p of live)
			byStatusMap[p.status] = (byStatusMap[p.status] || 0) + 1;
		const by_status = Object.entries(byStatusMap)
			.map(([status, count]) => ({ status, count }))
			.sort((a, b) => b.count - a.count);

		const top_supported = [...live]
			.sort((a, b) => supportOf(b.id) - supportOf(a.id))
			.slice(0, 10)
			.map((p) => ({
				id: p.id,
				title: p.title,
				category: p.category,
				status: p.status,
				support: rMap[p.id]?.support || 0,
				upvote: rMap[p.id]?.upvote || 0,
				score: supportOf(p.id),
			}));

		// Whole-platform poll totals (including standalone polls with no
		// post link — the feed-scoped map would miss them). Paginated.
		const allPollIds = (pollRows || []).map((p) => p.id);
		const { data: allVotes } = allPollIds.length
			? await fetchPaged((page) =>
					supabase
						.from("poll_votes")
						.select("poll_id")
						.in("poll_id", allPollIds)
						.range(page * 1000, page * 1000 + 999),
				)
			: { data: [] };
		const pvMap = {};
		for (const v of allVotes || []) {
			if (!v?.poll_id) continue;
			pvMap[v.poll_id] = (pvMap[v.poll_id] || 0) + 1;
		}
		const polls = (pollRows || []).map((p) => ({
			id: p.id,
			title: p.title,
			total: pvMap[p.id] || 0,
		}));
		const top_polls = [...polls]
			.sort((a, b) => b.total - a.total)
			.slice(0, 5);
		const quietPolls = polls.filter((p) => p.total === 0).length;

		const weekMap = {};
		for (const p of solved) {
			const k = weekKey(p.updated_at || p.created_at);
			if (k) weekMap[k] = (weekMap[k] || 0) + 1;
		}
		const solved_by_week = Object.entries(weekMap)
			.map(([week, solvedCount]) => ({ week, solved: solvedCount }))
			.sort((a, b) => (a.week < b.week ? -1 : 1))
			.slice(-8);

		const reports = reportRows || [];
		const recommendations = buildRecommendations({
			openPosts: open,
			livePosts: live,
			quietPolls,
		});

		return res.status(200).json({
			version: DECK_VERSION,
			generated_at: new Date().toISOString(),
			window: POST_WINDOW,
			totals: {
				posts: live.length,
				open: open.length,
				solved: solved.length,
				reports_open: reports.filter((r) => r.status !== "resolved").length,
				reports_resolved: reports.filter((r) => r.status === "resolved").length,
				polls: polls.length,
				votes: Object.values(pvMap).reduce((n, v) => n + v, 0),
			},
			by_category,
			by_status,
			top_supported,
			top_polls,
			solved_by_week,
			recommendations,
		});
	} catch (err) {
		return sanitizeError(res, err, "report-deck");
	}
}
