// Problems + Suggestions API

import { isTestArtifact } from "./_artifact-filter.js";
import {
	auditLog,
	checkUser,
	clean,
	cors,
	ensureUser,
	isAdmin,
	maskProfanity,
	rateLimited,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { staleWhileRevalidate, cacheClear } from "./_cache.js";
import { sanitizeError } from "./_error.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";
import { notifyFollowers } from "./_follows.js";
import { sendPostSolvedEmail } from "./_email.js";
import {
	serverModerate,
	getLearnedWeakStats,
	recordModerationDecision,
	spamAnalyze,
} from "./_moderation.js";

const CATEGORIES = [
	"Academics",
	"Facilities",
	"Food",
	"Bullying",
	"Teachers",
	"Events",
	"Transport",
	"Sports",
	"Technology",
	"Library",
	"Hostel",
	"Security",
	"Cleanliness",
	"Medical",
	"Other",
];
const STATUSES = [
	"reported",
	"verified",
	"in_progress",
	"waiting",
	"solved",
	"archived",
	"pending_review",
];
// Private posts are visible ONLY to their author and verified admins —
// enforced on every read path in this file and in _comments.js.
const VISIBILITIES = ["public", "private"];

// ─── Automatic priority scoring ─────────────────────────────────────
// Deterministic keyword scorer: the platform decides priority from the
// content's urgency, so no author (or admin) can hand-pick it. Real
// emergencies surface as critical; everything else stays honest.
const PRIORITY_KEYWORDS = {
	critical: [
		"emergency",
		"danger",
		"injur",
		"bleeding",
		"fire",
		"accident",
		"ambulance",
		"hospital",
		"threat",
		"weapon",
		"gas leak",
	],
	high: [
		"harass",
		"bully",
		"abuse",
		"stolen",
		"theft",
		"fight",
		"unsafe",
		"broken",
		"leak",
		"not working",
		"crash",
		"urgent",
		"asap",
		"immediately",
		"safety",
		"risk",
		"damage",
	],
	low: [
		"minor",
		"cosmetic",
		"sometimes",
		"occasionally",
		"small issue",
		"nice to have",
		"whenever possible",
	],
};

/** Compute priority from content urgency. Order matters: critical > high > low > medium. */
export function computeAutoPriority(...texts) {
	const hay = texts
		.filter((t) => typeof t === "string")
		.join(" ")
		.toLowerCase();
	for (const w of PRIORITY_KEYWORDS.critical)
		if (hay.includes(w)) return "critical";
	for (const w of PRIORITY_KEYWORDS.high) if (hay.includes(w)) return "high";
	for (const w of PRIORITY_KEYWORDS.low) if (hay.includes(w)) return "low";
	return "medium";
}

// Co-sign threshold: posts with this many supports are auto-flagged "ready for decision"
const READY_THRESHOLD = 10;
// Solved/archived posts are permanently deleted after 5 days of NO activity.
// Any reaction or comment bumps updated_at and resets the countdown.
const PURGE_MS = 5 * 24 * 60 * 60 * 1000;

// FIX #10: Persist purge throttle in settings so it survives cold starts / scales across serverless instances
const PURGE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
let _lastPurgeAtMem = 0; // in-memory fast-path; DB is source of truth

// ── Module-level feed cache (load-shedding) ─────────────────────
// ONE wrapper instance for the process lifetime — its memory map is what
// makes repeat feeds free. Created per-request it would never hit.
async function fetchFeedRows({ type, cursor }) {
	let qq = supabase
		.from("posts")
		.select("*")
		.order("created_at", { ascending: false });
	if (type) qq = qq.eq("type", type);
	qq = qq.eq("hidden", false).eq("deleted", false).neq("status", "pending_review");
	if (cursor) qq = qq.lt("created_at", cursor);
	qq = qq.limit(2000);
	const r = await qq;
	if (r.error) throw r.error;
	return r.data || [];
}
const feedSWR = staleWhileRevalidate(fetchFeedRows, {
	ttl: 10_000,
	staleTtl: 60_000,
	keyPrefix: "postsfeed",
});

/** Lazy sweep: permanently remove solved/archived posts inactive for 5+ days (throttled to 1/hour) */
async function purgeExpired() {
	const now = Date.now();
	if (now - _lastPurgeAtMem < PURGE_COOLDOWN_MS) return;
	// FIX #10: Check persisted throttle in settings (survives cold starts)
	try {
		const { data: state } = await supabase.from("settings").select("value").eq("key", "purge_state").maybeSingle();
		const lastAt = state?.value?.last_purge_at ? new Date(state.value.last_purge_at).getTime() : 0;
		if (now - lastAt < PURGE_COOLDOWN_MS) {
			_lastPurgeAtMem = lastAt;
			return;
		}
	} catch { /* best-effort — fall through to purge */ }
	_lastPurgeAtMem = now;
	try {
		const cutoff = new Date(Date.now() - PURGE_MS).toISOString();
		const { data: expired } = await supabase
			.from("posts")
			.select("id")
			.in("status", ["solved", "archived"])
			.lt("updated_at", cutoff)
			.limit(20);
		if (expired?.length) {
			const ids = expired.map((p) => p.id);
			await Promise.all([
				supabase.from("posts").delete().in("id", ids),
				supabase.from("comments").delete().in("post_id", ids),
				supabase.from("reactions").delete().in("target_id", ids),
			]);
		}
		// FIX #10: Persist last purge timestamp so throttle survives cold starts
		try {
			await supabase.from("settings").upsert({ key: "purge_state", value: { last_purge_at: new Date().toISOString() } }, { onConflict: "key" });
		} catch { /* best-effort */ }
	} catch {
		/* sweep is best-effort */
	}
}

async function attachCounts(posts) {
	const ids = posts.map((p) => p.id);
	if (!ids.length) return posts;

	// Batch all 3 count queries in parallel across ALL IDs (chunked for Supabase IN limit)
	const chunkSize = 100;
	const allReactions = [];
	const allComments = [];
	const allPolls = [];

	// Build chunk arrays once, then run all queries in flat parallel
	const chunks = [];
	for (let i = 0; i < ids.length; i += chunkSize)
		chunks.push(ids.slice(i, i + chunkSize));

	const results = await Promise.all(
		chunks.flatMap((chunk) => [
			supabase
				.from("reactions")
				.select("target_id,kind")
				.in("target_id", chunk),
			supabase
				.from("comments")
				.select("post_id")
				.in("post_id", chunk)
				.eq("deleted", false)
				.eq("hidden", false),
			supabase.from("polls").select("id,post_id").in("post_id", chunk),
		]),
	);

	// Unpack results: every 3 entries correspond to one chunk (reactions, comments, polls)
	for (let i = 0; i < results.length; i += 3) {
		const reactRes = results[i];
		const commRes = results[i + 1];
		const pollRes = results[i + 2];
		if (reactRes.data) allReactions.push(...reactRes.data);
		if (commRes.data) allComments.push(...commRes.data);
		if (pollRes.data) allPolls.push(...pollRes.data);
	}

	const rMap = {};
	const cMap = {};
	const pMap = {};
	allReactions.forEach((r) => {
		rMap[r.target_id] = rMap[r.target_id] || {};
		rMap[r.target_id][r.kind] = (rMap[r.target_id][r.kind] || 0) + 1;
	});
	allComments.forEach((c) => {
		cMap[c.post_id] = (cMap[c.post_id] || 0) + 1;
	});
	allPolls.forEach((p) => {
		pMap[p.post_id] = p.id;
	});

	// Live vote count per linked poll. Vote upserts never write the polls row,
	// so count poll_votes rows directly (same source as /api/polls results).
	const pollIds = Object.values(pMap).filter(Boolean);
	const pvMap = {};
	for (let i = 0; i < pollIds.length; i += chunkSize) {
		const chunk = pollIds.slice(i, i + chunkSize);
		const { data: votes } = await supabase
			.from("poll_votes")
			.select("poll_id")
			.in("poll_id", chunk);
		(votes || []).forEach((v) => {
			pvMap[v.poll_id] = (pvMap[v.poll_id] || 0) + 1;
		});
	}

	return posts.map((p) => {
		const reactions = rMap[p.id] || {};
		const isClosed = ["solved", "archived"].includes(p.status);
		const pollId = pMap[p.id] || null;
		return {
			...p,
			reactions,
			comment_count: cMap[p.id] || 0,
			linked_poll: pollId,
			linked_poll_votes: pollId ? pvMap[pollId] || 0 : null,
			// Co-sign threshold auto-flag
			ready_for_decision:
				!isClosed && (reactions.support || 0) >= READY_THRESHOLD,
			ready_threshold: READY_THRESHOLD,
			// Countdown metadata for solved/archived posts (5-day auto-delete)
			purge_at: isClosed
				? new Date(
						+new Date(p.updated_at || p.created_at) + PURGE_MS,
					).toISOString()
				: null,
		};
	});
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			purgeExpired(); // fire-and-forget: don't await, don't delay the response
			const {
				id,
				ids,
				type,
				all,
				viewer,
				author,
				cursor,
				limit: limitParam,
				paginate,
				filter_artifacts,
			} = req.query;
			const admin = all === "1" ? await isAdmin(req) : false;
			const isPaginated = paginate === "1" || paginate === "true";
			// Clamp on both ends: NaN/0 falls back to 30, negatives would produce
			// an invalid PostgREST `limit` and surface as a 500.
			const PAGE_LIMIT = Math.max(1, Math.min(parseInt(limitParam) || 30, 100));

			// Cache headers for public reads (30s browser cache, 30s CDN, 10s stale-while-revalidate)
			if (!admin && !viewer) {
				res.setHeader(
					"Cache-Control",
					"public, max-age=0, no-cache, s-maxage=10, stale-while-revalidate=10",
				);
				res.setHeader("X-Content-Type-Options", "nosniff");
			} else {
				res.setHeader("Cache-Control", "private, no-cache");
			}

			const viewerId = clean(viewer, 40);
			// Visibility guard: private posts are visible ONLY to their author
			// and verified admins — feeds, id fetches, ids lists, author views.
			const canSeePost = (p) =>
				admin ||
				!p.visibility ||
				p.visibility === "public" ||
				p.author_id === viewerId;

			let q = supabase
				.from("posts")
				.select("*")
				.order("created_at", { ascending: false });
			if (id) q = q.eq("id", id);
			else if (ids) {
				q = q.in("id", String(ids).split(",").slice(0, 100));
				// Non-admins must not fetch hidden/deleted/pending_review posts by id list
				if (!admin)
					q = q
						.eq("hidden", false)
						.eq("deleted", false)
						.neq("status", "pending_review");
			} else if (author) {
				q = q.eq("author_id", clean(author, 40)).eq("deleted", false);
				// Author listing is public data — apply the same visibility filter as
				// the main feed, EXCEPT the author always sees their own held posts
				// (otherwise a queued submission silently vanishes from My Activity).
				if (!admin) {
					q = q.eq("hidden", false);
					const isSelfView = !!viewerId && viewerId === clean(author, 40);
					if (!isSelfView) q = q.neq("status", "pending_review");
				}
				// Widen the fetch window: the JS artifact filter below can thin the set.
				q = q.limit(2000);
			} else {
				if (type) q = q.eq("type", type);
				if (!admin)
					q = q
						.eq("hidden", false)
						.eq("deleted", false)
						.neq("status", "pending_review");
				// Cursor-based pagination: cursor is ISO timestamp of last item
				if (isPaginated && cursor) q = q.lt("created_at", cursor);
				// The artifact filter runs in JS AFTER this SQL limit, so raise the fetch
				// window on every path — otherwise fuzz posts filling the most recent rows
				// would starve real posts out of the response. 2000 covers the realistic
				// ceiling; responses are re-bounded after filtering.
				q = q.limit(2000);
			}
			// ── Feed cache (load-shedding) ────────────────────────────
			// The anonymous main feed is identical for everyone, so its expensive
			// part — the up-to-2000-row scan — runs through staleWhileRevalidate:
			// Postgres sees ~6 feed queries/min instead of one per visitor, and
			// spikes are absorbed by serving stale while ONE background fetch
			// refreshes. Viewer-specific branches bypass this entirely.
			// Under Vitest the cache is bypassed so every test exercises the real
			// query path against its own mocked data (no cross-test pollution).
			const canUseFeedCache =
				!process.env.VITEST &&
				!admin &&
				!viewerId &&
				!id &&
				!ids &&
				!author;
			const feedCacheKey = `${type || "all"}|${cursor || ""}|${PAGE_LIMIT}`;
			const fetchRows = async () => {
				const r = await q;
				if (r.error) throw r.error;
				return r.data || [];
			};
			const data = canUseFeedCache
				? await feedSWR({
						type: type || null,
						cursor: cursor || null,
					})
				: await fetchRows();

			// Full-site zero-fuzz: hide test/fuzz artifacts on EVERY surface — public
			// feed, admin views (with or without filter_artifacts=1), by-id/by-ids
			// fetches, and author listings. The filter_artifacts=1 query flag is still
			// accepted (the admin Overview sends it) but the filter no longer depends
			// on it. Rows stay intact in the DB; they are only hidden from responses.
			let rows = (data || []).filter(
				(p) => !isTestArtifact(p.title) && canSeePost(p),
			);
			// Keep responses bounded: only the most recent clean rows matter.
			if (!isPaginated && rows.length > (author ? 200 : 300))
				rows = rows.slice(0, author ? 200 : 300);

			// Visibility guard for direct-by-id fetches: non-admins may only view
			// hidden/deleted/pending_review/private posts they own. Prevents
			// id-guessing leaks while keeping owner access to their own queued posts.
			if (id && !admin && (data || []).length === 1) {
				const row = data[0];
				const publicVisible =
					!row.hidden &&
					!row.deleted &&
					row.status !== "pending_review" &&
					(!row.visibility || row.visibility === "public");
				if (!publicVisible && clean(viewer, 40) !== row.author_id) {
					return res.status(404).json({ error: "Post not found" });
				}
			}

			if (isPaginated) {
				const hasMore = rows.length > PAGE_LIMIT;
				const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
				const nextCursor = hasMore
					? sliced[sliced.length - 1]?.created_at
					: null;
				const out = await attachCounts(sliced);
				const masked = out.map((p) => {
					const is_mine = !!viewerId && p.author_id === viewerId;
					return {
						...p,
						is_mine,
						author_id:
							admin || is_mine ? p.author_id : p.author_id.slice(0, 9) + "...",
					};
				});
				// Get total count (separate query, lightweight)
				let totalQ = supabase
					.from("posts")
					.select("id", { count: "exact", head: true });
				if (type) totalQ = totalQ.eq("type", type);
				if (!admin)
					totalQ = totalQ
						.eq("hidden", false)
						.eq("deleted", false)
						.neq("status", "pending_review");
				const { count } = await totalQ;
				return res
					.status(200)
					.json({ data: masked, nextCursor, total: count || 0 });
			}

			const out = await attachCounts(rows);
			const masked = out.map((p) => {
				const is_mine = !!viewerId && p.author_id === viewerId;
				return {
					...p,
					is_mine,
					author_id:
						admin || is_mine ? p.author_id : p.author_id.slice(0, 9) + "...",
				};
			});
			// Single-post fetch (by ID) returns wrapped format for PostDetail page
			if (id && masked.length === 1) {
				const post = masked[0];
				const counts = post.reactions || {};
				// Fetch viewer's own reactions for this post
				let mine = [];
				if (viewerId) {
					const { data: myReactions } = await supabase
						.from("reactions")
						.select("kind")
						.eq("target_id", id)
						.eq("author_id", viewerId);
					mine = (myReactions || []).map((r) => r.kind);
				}
				return res.status(200).json({ post, counts, mine });
			}
			return res.status(200).json(masked);
		}

		if (req.method === "POST") {
			const b = req.body || {};
			// P0 SECURITY FIX: Derive author_id from x-anon-id header, NOT from client body
			const headerId = clean(req.headers["x-anon-id"] || "", 40);
			const admin = await isAdmin(req);
			const author_id = headerId || (admin ? "ADMIN" : "");
			if (!author_id)
				return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });
			const gate = await checkUser(author_id);
			if (!gate.ok) return res.status(403).json({ error: gate.error });
			if (await rateLimited("posts", author_id, 60, 3)) {
				return rateLimitResponse(
					res,
					60,
					"Slow down — you can post at most 3 times per minute.",
				);
			}
			const title = maskProfanity(clean(b.title, 120));
			const description = maskProfanity(clean(b.description, 500));
			if (title.length < 5)
				return res
					.status(400)
					.json({ error: "Title must be at least 5 characters." });
			if (description.length < 10)
				return res
					.status(400)
					.json({ error: "Description must be at least 10 characters." });

			// Duplicate detection: check for posts with very similar titles in the same category
			const category = CATEGORIES.includes(b.category) ? b.category : "Other";
			const visibility = VISIBILITIES.includes(b.visibility)
				? b.visibility
				: "public";
			const normalizeForCompare = (s) =>
				s
					.toLowerCase()
					.replace(/[^a-z0-9\s]/g, "")
					.replace(/\s+/g, " ")
					.trim();
			const normalizedTitle = normalizeForCompare(title);

			// Fetch recent posts in same category (last 200) for comparison
			const { data: recentPosts } = await supabase
				.from("posts")
				.select("id, title, category, status")
				.eq("category", category)
				.eq("deleted", false)
				.eq("visibility", visibility)
				.order("created_at", { ascending: false })
				.limit(200);

			// Check for exact or near-exact title matches
			const isDuplicate = (recentPosts || []).some((p) => {
				if (["solved", "archived"].includes(p.status)) return false; // ignore closed posts
				const existingTitle = normalizeForCompare(p.title || "");
				// Exact match after normalization
				if (existingTitle === normalizedTitle) return true;
				// Very high similarity (>85% word overlap in shorter title)
				const shorter =
					normalizedTitle.length < existingTitle.length
						? normalizedTitle
						: existingTitle;
				const longer =
					normalizedTitle.length < existingTitle.length
						? existingTitle
						: normalizedTitle;
				const shorterWords = new Set(shorter.split(" "));
				const longerWords = new Set(longer.split(" "));
				const overlap = [...shorterWords].filter((w) =>
					longerWords.has(w),
				).length;
				if (shorterWords.size > 0 && overlap / shorterWords.size >= 0.85)
					return true;
				return false;
			});

			if (isDuplicate) {
				return res.status(409).json({
					error:
						"A post with a very similar title already exists in this category. Please check the existing posts before creating a duplicate.",
					code: "DUPLICATE_POST",
				});
			}

			// Server-side content moderation — blocks dangerous content before save.
			// Learned weak-signal confidence is consulted so repeat-approved
			// patterns stop holding posts once admins have proven them benign.
			const learned = await getLearnedWeakStats();
			const moderation = serverModerate(title, description, learned);
			if (moderation.blocked) {
				const isPII = moderation.flags.some((f) => f.type === "privacy");
				await auditLog(
					"moderation",
					"post_blocked",
					`${author_id}: ${title.slice(0, 60)} [${moderation.flags.map((f) => f.type).join(", ")}]`,
				);
				return res.status(403).json({
					error: isPII
						? "Personal information detected (address, phone, or email). This is an anonymous platform — please remove all personal details and try again."
						: "This content violates our safety guidelines and cannot be published. If you are in crisis, please contact a counselor or call a crisis hotline.",
					code: isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED",
				});
			}

			// Quality review: flagged posts need admin approval before going public.
			// Clients that ran the pre-publish AI agent can also request review for
			// 'revision'-level content — or when the moderation service was down —
			// by passing pending_review: true. Never let such content publish directly.
			// Weak/unusual personal-info formats (PIN codes, room-level addresses)
			// also never publish: posts route to the review queue for an admin
			// decision, while comments/polls hard-block outright.
			const weakPII = moderation.flags.some((f) => f.type === "privacy_weak");
			const needsReview = moderation.requiresReview;
			const holdForReview = needsReview || weakPII || b.pending_review === true;

			// ── Real spam analysis (multi-signal, deterministic) ────────
			const ip = (req.headers?.["x-forwarded-for"] || "unknown").split(",")[0]?.trim();
			const spamResult = spamAnalyze(title, description, author_id, ip);
			// High spam score → force quarantine regardless of moderation result
			if (spamResult.spam_score >= 80) {
				await auditLog(
					"spam",
					"post_quarantined",
					`${author_id}: ${title.slice(0, 60)} [score=${spamResult.spam_score}]`,
				);
				return res.status(403).json({
					error: "This post was flagged as potential spam. Please try a different approach.",
					code: "SPAM_QUARANTINED",
					spam_score: spamResult.spam_score,
				});
			}
			// Medium spam score → hold for review (don't block, but don't auto-publish)
			const spamHold = spamResult.spam_score >= 60;
			if (spamHold) {
				await auditLog(
					"spam",
					"post_held_for_review",
					`${author_id}: ${title.slice(0, 60)} [score=${spamResult.spam_score}]`,
				);
			}

			const initialStatus = (holdForReview || spamHold) ? "pending_review" : "reported";

			const type = b.type === "suggestion" ? "suggestion" : "problem";
			// Priority is computed automatically from content urgency —
			// authors never pick it (everyone would choose "critical").
			const priority = computeAutoPriority(title, description);
			const tags = Array.isArray(b.tags)
				? b.tags
						.slice(0, 6)
						.map((t) => clean(t, 24))
						.filter(Boolean)
				: [];
			const post = {
				id: `${type === "suggestion" ? "sug" : "post"}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
				type,
				title,
				description,
				category,
				visibility,
				priority,
				tags,
				image_url: clean(b.image_url, 500) || null,
				author_id,
				status: initialStatus,
				progress: 0,
				status_history: [
					{
						status: initialStatus,
						at: new Date().toISOString(),
						note: holdForReview
							? "Queued for quality review"
							: "Submitted anonymously",
					},
				],
			};

			if (holdForReview) {
				await auditLog(
					"moderation",
					"post_flagged_for_review",
					`${author_id}: ${title.slice(0, 60)} [${moderation.flags.map((f) => f.type).join(", ")}]`,
				);
				// Persist the flag types so the admin's later decision can feed
				// the self-learning loop (approve → confidence up, reject → down).
				try {
					await supabase.from("settings").upsert(
						{
							key: `modflag:${data?.id || post.id}`,
							value: {
								flags: moderation.flags.map((f) => f.type),
								at: new Date().toISOString(),
							},
						},
						{ onConflict: "key" },
					);
				} catch {
					/* best-effort */
				}
			}

			let { data, error } = await supabase
				.from("posts")
				.insert(post)
				.select()
				.single();
			if (error && post.visibility) {
				// Pre-migration DBs lack posts.visibility (migration 009 not yet
				// applied). Never fail a user's submission for that: retry once
				// WITHOUT the visibility field so the post publishes as public,
				// then surface a hint to run the migration.
				const msg = String(error.message || "");
				if (
					error.code === "PGRST204" ||
					error.code === "42703" ||
					/visibility|could not find|does not exist/i.test(msg)
				) {
					console.warn(
						"[posts] visibility column missing — run api/migrations/009_private_posts_integrity_indexes.sql. Publishing as public.",
					);
					const { visibility: _omit, ...rest } = post;
					const retry = await supabase
						.from("posts")
						.insert(rest)
						.select()
						.single();
					data = retry.data;
					error = retry.error;
				}
			}
			if (error) throw error;
			await ensureUser(author_id);
			// Emit event for event-triggered agents
			emitEventAndBridge(EVENT_TYPES.POST_CREATED, {
				post_id: data.id,
				type,
				category,
				priority,
				author_id,
				flagged: holdForReview,
			}).catch((err) =>
				console.warn("[posts] emit POST_CREATED failed:", err.message),
			);
			cacheClear("^postsfeed"); // new post appears immediately, no stale 10s window
			// Background: auto-generate AI summary (non-blocking, best-effort)
			import("./_ai-summary.js").then((mod) => {
				if (typeof mod.default === "function") {
					mod.default({
						method: "POST",
						body: {
							post_id: data.id,
							title: data.title,
							description: data.description,
							category: data.category,
						},
					}, { status: () => ({ json: () => {} }) }).catch(() => {});
				}
			}).catch(() => {});
			return res.status(201).json(data);
		}

		if (req.method === "PUT") {
			const b = req.body || {};
			const { id } = b;
			if (!id) return res.status(400).json({ error: "Missing id" });
			const { data: post } = await supabase
				.from("posts")
				.select("*")
				.eq("id", id)
				.maybeSingle();
			if (!post) return res.status(404).json({ error: "Post not found" });
			const admin = await isAdmin(req);
			// P0 SECURITY FIX: Derive caller identity from x-anon-id header, not client body
			const callerId = clean(req.headers["x-anon-id"] || "", 40);
			const isOwner = callerId && callerId !== "ADMIN" && callerId === post.author_id;
			if (isOwner) {
				const gate = await checkUser(callerId);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
			}

			const patch = {};
			if (isOwner || admin) {
				// Owner-permitted fields
				if (typeof b.deleted === "boolean") patch.deleted = b.deleted; // soft delete + 30s restore
				if (typeof b.locked === "boolean") patch.locked = b.locked; // owner turns comments off/on
				if (b.visibility !== undefined && VISIBILITIES.includes(b.visibility))
					patch.visibility = b.visibility;
				if (b.title !== undefined)
					patch.title = maskProfanity(clean(b.title, 120));
				if (b.description !== undefined)
					patch.description = maskProfanity(clean(b.description, 500));
				if (b.tags !== undefined && Array.isArray(b.tags))
					patch.tags = b.tags.slice(0, 6).map((t) => clean(t, 24));
			}
			if (admin) {
				if (b.status && STATUSES.includes(b.status)) {
					patch.status = b.status;
					const map = {
						reported: 5,
						verified: 20,
						in_progress: 50,
						waiting: 70,
						solved: 100,
						archived: 100,
						pending_review: 10,
					};
					patch.progress = map[b.status];
					patch.status_history = [
						...(post.status_history || []),
						{
							status: b.status,
							at: new Date().toISOString(),
							note: clean(b.status_note, 300) || null,
						},
					];
				}
				for (const f of ["pinned", "featured", "hidden", "locked", "official"])
					if (typeof b[f] === "boolean") patch[f] = b[f];
				if (b.admin_reply !== undefined)
					patch.admin_reply = clean(b.admin_reply, 1000);
				if (b.admin_notes !== undefined)
					patch.admin_notes = clean(b.admin_notes, 2000);
				if (b.ai_summary !== undefined)
					patch.ai_summary = clean(b.ai_summary, 2000);
				if (b.category !== undefined && CATEGORIES.includes(b.category))
					patch.category = b.category;
			// Priority is automatic: recompute when the content itself is edited.
			if (b.title !== undefined || b.description !== undefined)
				patch.priority = computeAutoPriority(
					patch.title ?? post.title,
					patch.description ?? post.description,
				);
				if (b.eta !== undefined) patch.eta = clean(b.eta, 60);
				if (b.assigned_to !== undefined)
					patch.assigned_to = clean(b.assigned_to, 60);
				if (typeof b.progress === "number")
					patch.progress = Math.max(0, Math.min(100, b.progress));
				if (b.merged_into !== undefined)
					patch.merged_into = clean(b.merged_into, 60);
				if (b.type !== undefined && ["problem", "suggestion"].includes(b.type))
					patch.type = b.type; // convert suggestion <-> project/problem
			}
			if (!isOwner && !admin)
				return res.status(403).json({ error: "Not authorized" });
			if (!Object.keys(patch).length)
				return res.status(400).json({ error: "Nothing to update" });
			// Re-moderate edited content — a user could create a clean post then inject an
			// address/phone/email via edit. Never let PII leak through the PUT path either.
			if (patch.title !== undefined || patch.description !== undefined) {
				const editMod = serverModerate(
					patch.title ?? post.title,
					patch.description ?? post.description,
				);
				if (editMod.blocked) {
					const isPII = editMod.flags.some((f) => f.type === "privacy");
					await auditLog(
						"moderation",
						"edit_blocked",
						`${id}: ${(patch.title || "").slice(0, 60)} [${editMod.flags.map((f) => f.type).join(", ")}]`,
					);
					return res.status(403).json({
						error: isPII
							? "Personal information detected in your edit (address, phone, or email). This is an anonymous platform — please remove all personal details and try again."
							: "Your edit violates our safety guidelines and cannot be saved.",
						code: isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED",
					});
				}
				// Weak/unusual PII formats (PIN codes, room-level addresses) never
				// publish either: pull the post into the review queue, keeping the
				// edit out of public view until an admin decides.
				if (editMod.flags.some((f) => f.type === "privacy_weak")) {
					patch.status = "pending_review";
					patch.progress = 10;
					patch.status_history = [
						...(post.status_history || []),
						{
							status: "pending_review",
							at: new Date().toISOString(),
							note: "Edit flagged for review (possible personal info)",
						},
					];
					await auditLog(
						"moderation",
						"edit_held",
						`${id}: ${(patch.title || "").slice(0, 60)} [privacy_weak]`,
					);
				}
			}
			patch.updated_at = new Date().toISOString();
			const { data, error } = await supabase
				.from("posts")
				.update(patch)
				.eq("id", id)
				.select()
				.single();
			if (error) throw error;
			if (admin)
				await auditLog(
					"admin",
					"update_post",
					`${id}: ${Object.keys(patch).join(", ")}`,
				);
			cacheClear("^postsfeed"); // solved/hidden/pinned changes show live
			// Emit event for status changes
			if (patch.status)
				emitEventAndBridge(EVENT_TYPES.POST_STATUS_CHANGED, {
					post_id: id,
					old_status: post.status,
					new_status: patch.status,
				}).catch((err) =>
					console.warn("[posts] emit POST_STATUS_CHANGED failed:", err.message),
				);
			// ── Self-learning feedback: an admin decision on a held post ──
			// Approving (leaving pending_review to any public status) raises
			// confidence for the weak pattern; archiving lowers it.
			if (
				admin &&
				post.status === "pending_review" &&
				patch.status &&
				patch.status !== "pending_review"
			) {
				try {
					const { data: mf } = await supabase
						.from("settings")
						.select("value")
						.eq("key", `modflag:${id}`)
						.maybeSingle();
					const heldFlags = mf?.value?.flags || [];
					for (const t of heldFlags) {
						await recordModerationDecision(t, patch.status !== "archived");
					}
					await supabase.from("settings").delete().eq("key", `modflag:${id}`);
				} catch {
					/* learning is best-effort */
				}
			}				// Notify followers on status change or admin reply
				if (admin && (patch.status || patch.admin_reply !== undefined)) {
					const nTitle = patch.status
						? `Status updated: ${patch.status.replace(/_/g, " ")}`
						: "Admin replied";
					notifyFollowers(id, {
						type: "post",
						title: nTitle,
						body: post.title || "A post you follow was updated",
					});
				}
				// Send email notification when post is solved
				if (patch.status === "solved" && post.author_id) {
					sendPostSolvedEmail({
						postTitle: post.title,
						postId: id,
						authorId: post.author_id,
						adminReply: patch.admin_reply || post.admin_reply,
					}).catch(() => {});
				}
			return res.status(200).json(data);
		}

		if (req.method === "DELETE") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const { id } = req.body || {};
			// Null out post_id on linked polls (preserve votes + poll data), then delete post + comments + reactions
			await Promise.all([
				supabase.from("polls").update({ post_id: null }).eq("post_id", id),
				supabase.from("posts").delete().eq("id", id),
				supabase.from("comments").delete().eq("post_id", id),
				supabase.from("reactions").delete().eq("target_id", id),
			]);
			await auditLog("admin", "hard_delete_post", id);
			cacheClear("^postsfeed");
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		console.error(
			"[posts] Handler error:",
			err.message,
			err.stack?.split("\n").slice(0, 5).join("\n"),
		);
		return sanitizeError(res, err, "posts");
	}
}
