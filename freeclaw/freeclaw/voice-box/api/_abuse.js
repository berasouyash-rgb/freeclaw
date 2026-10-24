// Abuse Detection — the rapid-fire throttle worker (roster #23).
//
// REAL JOB: cross-request burst detection. The per-request spam analyzer
// (_spam.js) only sees one submission at a time; this worker scans the live
// queue for one author flooding it (>= BURST_POSTS posts within
// BURST_WINDOW_MS) and quarantines the burst via the platform's real
// quarantine status (pending_review — the same status _spam.js uses), so
// the moderation queue owns the review instead of the feed showing the
// flood. Advisory audit rows are recorded per quarantined post.
//
// Verification is independent: after each quarantine the worker re-reads
// the posts' status from the table.
import { auditLog, clean, cors, isAdmin } from "./_auth.js";
import { readLivePosts } from "./_live-posts.js";
import supabase from "./_db-client.js";
import { isTestArtifact } from "./_artifact-filter.js";

const BURST_POSTS = 6;
const BURST_WINDOW_MS = 10 * 60 * 1000;
const SWEEP_LIMIT = 200;
const MAX_QUARANTINE = 10;

/**
 * Watch the live queue for rapid-fire abuse and quarantine bursts.
 * Zero-arg (the cron loop calls the registry run with no arguments).
 *
 * @returns {Promise<{ok: boolean, verified?: boolean, quarantined: Array, authors: Array, errors: Array, error?: string}>}
 */
export async function runAbuseWatch({ nowMs = Date.now() } = {}) {
	const result = { quarantined: [], authors: [], errors: [] };

	const live = await readLivePosts({
		columns: "id, title, author_id, status, created_at",
		limit: SWEEP_LIMIT,
	});
	if (!live.ok || live.source !== "supabase") {
		return {
			...result,
			ok: false,
			error: live.error || "direct post store unavailable",
		};
	}

	// Group recent posts by author inside the burst window.
	const byAuthor = new Map();
	for (const p of live.posts || []) {
		if (isTestArtifact(p.title)) continue;
		if (String(p.status || "") !== "reported") continue; // only live feed rows
		const createdAt = new Date(p.created_at).getTime();
		if (Number.isNaN(createdAt)) continue;
		const age = nowMs - createdAt;
		if (age < 0 || age > BURST_WINDOW_MS) continue;
		const author = clean(String(p.author_id || ""), 40);
		if (!author) continue;
		if (!byAuthor.has(author)) byAuthor.set(author, []);
		byAuthor.get(author).push({ id: p.id, createdAt });
	}

	// Authors flooding the queue → quarantine their burst posts.
	const burstAuthors = [];
	for (const [author, posts] of byAuthor) {
		if (posts.length >= BURST_POSTS) burstAuthors.push({ author, posts });
	}
	if (!burstAuthors.length)
		return { ...result, ok: true, verified: true, quarantined: [], authors: [] };

	for (const { author, posts } of burstAuthors.slice(0, 5)) {
		result.authors.push({ author, posts_in_window: posts.length });
		for (const p of posts.slice(0, MAX_QUARANTINE)) {
			try {
				const { error } = await supabase
					.from("posts")
					.update({ status: "pending_review" })
					.eq("id", p.id);
				if (error) {
					result.errors.push({ post_id: p.id, error: error.message });
					continue;
				}
				result.quarantined.push({ post_id: p.id, author });
				try {
					await auditLog(
						"abuse-worker",
						"rapid_fire_quarantine",
						`${p.id} by ${author} — ${posts.length} posts in ${Math.round(BURST_WINDOW_MS / 60000)}m`,
					);
				} catch {
					/* audit is best-effort */
				}
			} catch (err) {
				result.errors.push({
					post_id: p.id,
					error: String(err?.message || err).slice(0, 200),
				});
			}
		}
	}

	if (!result.quarantined.length)
		return { ...result, ok: true, verified: true, quarantined: [] };

	// VERIFY: independent re-read — quarantined posts must read pending_review.
	let verified = 0;
	for (const q of result.quarantined) {
		try {
			const { data } = await supabase
				.from("posts")
				.select("id, status")
				.eq("id", q.post_id)
				.maybeSingle();
			if (data?.status === "pending_review") verified += 1;
		} catch {
			/* counted as unverified */
		}
	}
	return { ...result, ok: true, verified: verified === result.quarantined.length };
}

// GET /api/abuse — admin read of the rapid-fire abuse watch.
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const { data, error } = await supabase
			.from("activity_logs")
			.select("id, action, detail, created_at")
			.eq("action", "rapid_fire_quarantine")
			.order("created_at", { ascending: false })
			.limit(30);
		if (error) throw error;
		return res.status(200).json({
			quarantine_events: (data || []).length,
			recent: data || [],
		});
	} catch (err) {
		console.error("abuse error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
