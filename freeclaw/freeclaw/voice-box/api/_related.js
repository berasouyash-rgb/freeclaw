// Related Case finder — surfaces open posts that share vocabulary.
//
// This is the READ side of the Related Case worker (roster #8). It is a
// deterministic word-overlap scan: tokenize title + description + tags,
// count shared words, and emit an advisory link for any pair that shares
// at least MIN_SHARED distinct words. No model call, no guessing — the
// same discipline as _duplicates.js (which the Duplicate Case worker
// reuses) but pairwise instead of clustered.
//
// Advisory only: nothing is written here. The worker records what it
// finds in the audit log; it never edits or links posts destructively.
import { isTestArtifact } from "./_artifact-filter.js";
import { cors } from "./_auth.js";
import { readLivePosts } from "./_live-posts.js";

const MIN_SHARED = 2;
const DEFAULT_LIMIT = 25;
const SCAN_LIMIT = 300;
const TERMINAL_STATUSES = new Set(["solved", "closed", "archived", "resolved"]);

/** Lowercase word tokens of length >= 3, punctuation stripped. */
function tokenize(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length >= 3);
}

/** All meaningful words for one post (title + description + tags). */
function postWords(post) {
	const tags = Array.isArray(post?.tags)
		? post.tags.join(" ")
		: String(post?.tags || "");
	return new Set(
		tokenize(`${post?.title || ""} ${post?.description || ""} ${tags}`),
	);
}

/**
 * Scan live posts for related pairs.
 *
 * @returns {{ ok: boolean, source: "supabase"|"server"|null, checked: number, related: Array<{post_id:string, related_id:string, shared:string[], score:number}>, error?: string }}
 */
export async function findRelatedPosts({ limit = DEFAULT_LIMIT } = {}) {
	const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 100));
	// Dual-backend read: direct Supabase first, app feed as fallback.
	const fetched = await readLivePosts({
		columns: "id, title, description, category, status, tags",
		limit: SCAN_LIMIT,
	});
	if (!fetched.ok) {
		return {
			ok: false,
			source: null,
			checked: 0,
			related: [],
			error: fetched.error,
		};
	}
	const posts = fetched.posts;

	// Drop artifacts and finished cases: a solved post is not a live lead.
	const live = posts.filter(
		(p) =>
			!isTestArtifact(p.title) &&
			!TERMINAL_STATUSES.has(String(p.status || "").toLowerCase()),
	);

	const words = live.map((p) => postWords(p));
	const related = [];
	const seen = new Set();

	for (let i = 0; i < live.length; i++) {
		for (let j = i + 1; j < live.length; j++) {
			const shared = [...words[i]].filter((w) => words[j].has(w));
			if (shared.length < MIN_SHARED) continue;
			const a = live[i].id;
			const b = live[j].id;
			const key = [a, b].sort().join("|");
			if (seen.has(key)) continue;
			seen.add(key);
			related.push({ post_id: a, related_id: b, shared, score: shared.length });
		}
	}

	related.sort((x, y) => y.score - x.score || String(x.post_id).localeCompare(String(y.post_id)));
	return {
		ok: true,
		source: fetched.source,
		checked: live.length,
		related: related.slice(0, capped),
	};
}

// GET /api/related?limit=25
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") {
		res.statusCode = 204;
		return res.end();
	}
	if (req.method !== "GET") {
		res.statusCode = 405;
		return res.end(JSON.stringify({ error: "Method Not Allowed" }));
	}
	try {
		const limit =
			Number(new URL(req.url || "/", "http://localhost").searchParams.get("limit")) ||
			DEFAULT_LIMIT;
		const result = await findRelatedPosts({ limit });
		res.statusCode = 200;
		res.setHeader("content-type", "application/json");
		return res.end(JSON.stringify(result));
	} catch (err) {
		res.statusCode = 500;
		res.setHeader("content-type", "application/json");
		return res.end(JSON.stringify({ error: String(err?.message || err) }));
	}
}
