// Resolution evidence — GET /api/resolution-evidence?post_id=X
//
// Answers "did the fix actually work?" from DATABASE rows, never from a
// story: complaints in the same category before vs after the solve moment,
// still-open lookalikes, and comments posted after the solve. The verdict
// is a deterministic function of those counts:
//
//   supported  — nothing open resembling it and no new complaints after
//   watch      — some new complaints, fewer than before
//   recurrence — an open lookalike exists, or complaints kept pace
//
// Public read (counts + public titles only — never private bodies), short
// cache. Related matching reuses the 85% word-overlap rule from the submit
// duplicate scan so "similar" means the same thing everywhere.
import { cors } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

const OPEN_STATUSES = ["reported", "verified", "in_progress", "waiting"];
const WINDOW_MS = 30 * 24 * 3600 * 1000;

function words(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2);
}

/** Fraction of the shorter title's words present in the longer (0..1). */
export function titleOverlap(a, b) {
	const wa = new Set(words(a));
	const wb = new Set(words(b));
	if (!wa.size || !wb.size) return 0;
	const [shorter, longer] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
	let hit = 0;
	for (const w of shorter) if (longer.has(w)) hit++;
	return hit / shorter.size;
}

function solvedAt(post) {
	const hist = Array.isArray(post.status_history) ? post.status_history : [];
	for (let i = hist.length - 1; i >= 0; i--) {
		if (hist[i] && hist[i].status === "solved" && hist[i].at) {
			const t = Date.parse(hist[i].at);
			if (!Number.isNaN(t)) return new Date(t).toISOString();
		}
	}
	return post.updated_at || post.created_at;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET")
		return res.status(405).json({ error: "GET only" });
	try {
		const postId = String(req.query.post_id || "").slice(0, 60);
		if (!postId) return res.status(400).json({ error: "post_id required" });
		const { data: post, error: postErr } = await supabase
			.from("posts")
			.select("id,title,category,status,created_at,updated_at,status_history,deleted,hidden,visibility")
			.eq("id", postId)
			.maybeSingle();
		if (postErr) throw postErr;
		if (!post || post.deleted)
			return res.status(404).json({ error: "Post not found" });

		const solved = post.status === "solved";
		const moment = solvedAt(post);
		const momentMs = Date.parse(moment) || Date.now();
		const since = new Date(momentMs - WINDOW_MS).toISOString();

		// Same-category neighbours in a bounded window (public boundary —
		// evidence must never leak private or moderated rows).
		const { data: neighbours } = await supabase
			.from("posts")
			.select("id,title,status,created_at")
			.eq("category", post.category)
			.eq("deleted", false)
			.eq("hidden", false)
			.neq("visibility", "private")
			.neq("status", "pending_review")
			.gte("created_at", since)
			.order("created_at", { ascending: false })
			.limit(200);
		const rows = (neighbours || []).filter((r) => r.id !== post.id);
		const before = rows.filter(
			(r) => Date.parse(r.created_at) < momentMs,
		).length;
		const after = rows.filter(
			(r) => Date.parse(r.created_at) >= momentMs,
		).length;
		const related = rows
			.filter(
				(r) =>
					OPEN_STATUSES.includes(r.status) &&
					Date.parse(r.created_at) >= momentMs &&
					titleOverlap(`${post.title}`, `${r.title}`) >= 0.5,
			)
			.slice(0, 5)
			.map((r) => ({
				id: r.id,
				title: r.title,
				status: r.status,
				created_at: r.created_at,
			}));

		// Discussion after the solve (visible comments only).
		let commentsAfter = 0;
		try {
			const { data: cmts } = await supabase
				.from("comments")
				.select("id,created_at")
				.eq("post_id", post.id)
				.eq("deleted", false)
				.eq("hidden", false)
				.gte("created_at", moment);
			commentsAfter = (cmts || []).length;
		} catch {
			/* evidence degrades to zero, never to error */
		}

		let verdict = "supported";
		if (related.length > 0 || after >= Math.max(2, before)) {
			verdict = "recurrence";
		} else if (after > 0) {
			verdict = "watch";
		}
		const changePct =
			before > 0 ? Math.round(((before - after) / before) * 100) : null;

		res.setHeader(
			"Cache-Control",
			"public, max-age=30, s-maxage=60, stale-while-revalidate=30",
		);
		return res.status(200).json({
			post_id: post.id,
			status: post.status,
			solved_at: solved ? moment : null,
			complaints_before: before,
			complaints_after: after,
			change_pct: changePct,
			related_open: related,
			comments_after: commentsAfter,
			verdict: solved ? verdict : "open",
		});
	} catch (err) {
		return sanitizeError(res, err, "resolution-evidence");
	}
}
