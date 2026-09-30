// Smart Search — global search across posts, comments, polls, and users.
// GET /api/search?q=keyword&type=all&status=all&category=all&priority=all

import { isTestArtifact } from "./_artifact-filter.js";
import { cors } from "./_auth.js";
import supabase from "./_db-client.js";
import { staleWhileRevalidate } from "./_cache.js";

/** Escape LIKE metacharacters to prevent pattern injection */
function escapeLike(str) {
	return String(str)
		.replace(/\\/g, "\\\\")
		.replace(/%/g, "\\%")
		.replace(/_/g, "\\_");
}

/**
 * Raw candidate scan: the three DB queries behind a search.
 * Wrapped in module-scope stale-while-revalidate below so N identical
 * searches inside the TTL window collapse into ONE set of DB scans
 * (previously: up to 4,000 rows re-fetched per keystroke-debounced query).
 * Per-viewer masking, artifact filtering, scoring, and pagination run
 * per-request on these cached rows — they are viewer-independent raw data.
 */
async function scanSearchRows(q, type, status, category, priority) {
	const out = { posts: null, comments: null, polls: null, users: null };
	// Hashtag queries (#canteen) must match the tag `canteen`: strip every
	// `#` once so the ilike prefilters, the tag-overlap pull below, and
	// the in-memory scorer all see the same word the tags store.
	const qText = q.replace(/#/g, "");
	const firstWord = qText ? qText.split(/\s+/).filter((w) => w.length > 1)[0] || qText : "";

	// Search posts — use DB-level text search for performance
	if (type === "all" || type === "posts") {
		// Note: reactions and comment_count are computed in _posts.js, not actual DB columns
		// Public search never surfaces moderation-hidden or pending-review posts
		let query = supabase
			.from("posts")
			.select(
				"id, type, title, description, category, status, priority, author_id, created_at, tags, deleted, hidden",
			)
			.eq("deleted", false)
			.eq("hidden", false);
		if (status !== "all") query = query.eq("status", status);
		if (category !== "all") query = query.eq("category", category);
		if (priority !== "all") query = query.eq("priority", priority);
		// DB-level text search: use ilike for matching instead of fetching 2000 rows
		if (q) {
			const searchPattern = `%${escapeLike(qText)}%`;
			// Hashtag surfacing as a same-scan OR term: ilike cannot scan the
			// tags text[] array, so `#canteen` (tagWord `canteen` via qText)
			// rides along as an array-overlap term. Sanitized to the
			// kebab-case tag contract so braces/commas can never break the
			// PostgREST `{…}` array literal. One from("posts") per scan set —
			// the search-perf guard counts exactly that.
			const tagWord = (qText.split(/\s+/).filter((w) => w.length > 1)[0] || "")
				.toLowerCase()
				.replace(/[^a-z0-9-]/g, "");
			const tagTerm = tagWord ? `,tags.ov.{${tagWord}}` : '';
			query = query.or(`title.ilike.${searchPattern},description.ilike.${searchPattern},id.ilike.${searchPattern}${tagTerm}`);
		}
		query = query.order("created_at", { ascending: false }).limit(500);

		const { data: posts, error: postErr } = await query;
		if (postErr) {
			try {
				const { logger } = await import("./_observability.js");
				logger.error("search", "posts_query_error", { error: postErr.message });
			} catch { /* non-fatal */ }
		}
		out.posts = posts;
	}

	// Search comments — match main handler: filter hidden for non-admins
	if (type === "all" || type === "comments") {
		let query = supabase
			.from("comments")
			.select("id, post_id, body, author_id, created_at, hidden")
			.eq("deleted", false)
			.eq("hidden", false);
		if (q) {
			query = query.ilike("body", `%${escapeLike(firstWord)}%`);
		}
		query = query.order("created_at", { ascending: false }).limit(1000);
		const { data: comments } = await query;
		out.comments = comments;
	}	// Search polls
	if (type === "all" || type === "polls") {
		let query = supabase
			.from("polls")
			.select("id, title, options, ptype, author_id, created_at, archived")
			.eq("deleted", false);
		if (q) {
			query = query.ilike("title", `%${escapeLike(firstWord)}%`);
		}
		query = query.order("created_at", { ascending: false }).limit(1000);
		const { data: polls } = await query;
		out.polls = polls;
	}

	// Search users — match anon_id (exact or partial)
	if (type === "all" || type === "users") {
		let query = supabase
			.from("users_meta")
			.select("anon_id, created_at, last_seen, strikes, banned, suspended_until")
			.order("created_at", { ascending: false });
		if (q) {
			// Support exact match, partial match, or ILIKE on anon_id
			query = query.or(`anon_id.ilike.%${escapeLike(q)}%`);
		}
		query = query.limit(200);
		const { data: users } = await query;
		out.users = users;
	}

	return out;
}

const searchSWR = staleWhileRevalidate(scanSearchRows, {
	ttl: 15_000,
	staleTtl: 60_000,
	keyPrefix: "globalsearch",
	maxEntries: 200,
});

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	req._searchStart = Date.now();

	try {
		if (req.method !== "GET")
			return res.status(405).json({ error: "GET only" });

		const q = (req.query.q || "").trim();
		// Same normalization as scanSearchRows above (which has its own copy
		// — the scorer below runs in handler scope, not in that function).
		const qText = q.replace(/#/g, "");
		const type = req.query.type || "all";
		const status = req.query.status || "all";
		const category = req.query.category || "all";
		const priority = req.query.priority || "all";
		const limit = Math.min(parseInt(req.query.limit) || 50, 100);
		const page = Math.max(parseInt(req.query.page) || 1, 1);

		if (!q && type === "all") {
			return res.status(200).json({ results: [], total: 0, query: "" });
		}
		// Allow 3-char queries for exact ID matches (comment/post IDs like 'abc123')
		// but require >= 3 chars for text search to avoid noise
		const isExactId = /^[a-z0-9_-]{3,}$/i.test(q);
		if (q && q.length < 3)
			return res
				.status(400)
				.json({ error: "Query must be at least 3 characters" });

		const results = [];
		// Mask author ids unless the caller proves ownership (viewer = anon id)
		const viewer = (req.query.viewer || "").toString().toLowerCase();
		const maskAuthor = (a) =>
			viewer && a && String(a).toLowerCase() === viewer ? a : null;

		// One cached scan serves this request (stale-while-revalidate at module scope)
		const rows = await searchSWR(q, type, status, category, priority);

		// Score posts — match if ANY search word appears in title, description, or tags
		if (rows.posts) {
		const words = qText
			? qText
					.toLowerCase()
					.split(/\s+/)
					.filter((w) => w.length > 1)
			: [];
			rows.posts.forEach((p) => {
				if (isTestArtifact(p.title)) return;
				const titleLower = (p.title || "").toLowerCase();
				const descLower = (p.description || "").toLowerCase();
				const tagsStr = Array.isArray(p.tags)
					? p.tags.join(" ").toLowerCase()
					: "";
				// Match if ANY search word appears in title, description, or tags
				const matches = q
					? words.some(
							(w) =>
								titleLower.includes(w) ||
								descLower.includes(w) ||
								tagsStr.includes(w),
						)
					: true;
				if (!matches) return;
				const titleMatch = words.some((w) => titleLower.includes(w));
				const descMatch = words.some((w) => descLower.includes(w));
				const tagMatch = words.some((w) => tagsStr.includes(w));
				// Exact ID match gets highest priority
				const exactIdMatch = q && p.id && p.id.toLowerCase().includes(q.toLowerCase());
				const score = exactIdMatch
					? 100
					: (titleMatch ? 3 : 0) + (descMatch ? 1 : 0) + (tagMatch ? 2 : 0);
				results.push({
					type: "post",
					id: p.id,
					title: p.title,
					description: (p.description || "").slice(0, 200),
					category: p.category,
					status: p.status,
					priority: p.priority,
					author_id: maskAuthor(p.author_id),
					created_at: p.created_at,
					relevance_score: score || 1,
				});
			});
		}

		// Comments
		if (rows.comments) {
			rows.comments.forEach((c) => {
				if (isTestArtifact(c.body)) return;
				const exactIdMatch = q && c.id && c.id.toLowerCase().includes(q.toLowerCase());
				results.push({
					type: "comment",
					id: c.id,
					post_id: c.post_id,
					body: (c.body || "").slice(0, 200),
					author_id: maskAuthor(c.author_id),
					created_at: c.created_at,
					relevance_score: exactIdMatch ? 100 : 1,
				});
			});
		}

		// Polls
		if (rows.polls) {
			rows.polls.forEach((p) => {
				if (isTestArtifact(p.title)) return;
				results.push({
					type: "poll",
					id: p.id,
					title: p.title,
					options: p.options,
					ptype: p.ptype,
					author_id: maskAuthor(p.author_id),
					created_at: p.created_at,
					archived: p.archived,
					relevance_score: 1,
				});
			});
		}

		// Users — match by anon_id (exact or partial)
		if (rows.users) {
			rows.users.forEach((u) => {
				const exactMatch = q && u.anon_id && u.anon_id.toLowerCase() === q.toLowerCase();
				const partialMatch = q && u.anon_id && u.anon_id.toLowerCase().includes(q.toLowerCase());
				if (!exactMatch && !partialMatch && q) return;
				results.push({
					type: "user",
					id: u.anon_id,
					title: u.anon_id,
					description: u.banned
						? "Banned"
						: u.suspended_until && new Date(u.suspended_until) > new Date()
							? "Suspended"
							: "Active",
					author_id: u.anon_id,
					created_at: u.created_at,
					relevance_score: exactMatch ? 200 : partialMatch ? 50 : 1,
				});
			});
		}

		// Sort by relevance score and recency
		results.sort(
			(a, b) =>
				(b.relevance_score || 0) - (a.relevance_score || 0) ||
				new Date(b.created_at) - new Date(a.created_at),
		);

		// Pagination
		const total = results.length;
		const start = (page - 1) * limit;
		const paged = results.slice(start, start + limit);

		// Record search quality telemetry (fire-and-forget)
		try {
			const { recordSearchEvent } = await import("./_search-quality.js");
			recordSearchEvent({
				query: q,
				results: total,
				latency_ms: Date.now() - (req._searchStart || Date.now()),
			});
		} catch (err) { console.warn("[search] telemetry drop", { error: err?.message || String(err) }); }

		return res.status(200).json({
			results: paged,
			total,
			page,
			pages: Math.ceil(total / limit),
			query: q,
			filters: { type, status, category, priority },
		});
	} catch (err) {
		// Record failed search for quality tracking
		try {
			const { recordSearchEvent } = await import("./_search-quality.js");
			recordSearchEvent({ query: q || "", results: 0, latency_ms: Date.now() - (req._searchStart || Date.now()) });
		} catch (telErr) { console.warn("[search] failure telemetry drop", { error: telErr?.message || String(telErr) }); }
		try {
			const { logger } = await import("./_observability.js");
			logger.error("search", "search_failed", { error: err.message });
		} catch (logErr) { console.error("[search] search_failed log drop", { error: logErr?.message || String(logErr) }); }
		return res.status(500).json({ error: "Internal error" });
	}
}
