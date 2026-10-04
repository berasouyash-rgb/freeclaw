// Problems + Suggestions API

import { isTestArtifact } from "./_artifact-filter.js";
import {
	auditLog,
	checkUser,
	clean,
	clientIp,
	cors,
	ensureUser,
	isAdmin,
	maskProfanity,
	notifyUser,
	rateLimited,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { staleWhileRevalidate } from "./_cache.js";
import { getRawCounts, invalidateCounts } from "./_counts.js";
import { evaluateContentDeep, messageFor } from "./_safety-pipeline.js";
import { strikeSlangAbuse } from "./_reports.js";
import { sanitizeError } from "./_error.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";
import { notifyFollowers } from "./_follows.js";
import { sendPostSolvedEmail } from "./_email.js";
import {
	getLearnedWeakStats,
	recordModerationDecision,
	recordSafetyRepost,
	checkSafetyRepost,
	spamAnalyze,
	getSpamConfig,
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
// Admin-configured feed page size (60s in-memory cache; serverless-safe:
// worst case a stale size for one minute after an admin change).
// Fail-open to 30 (today's default) — the feed must load even if the
// settings read fails.
let _feedPageCache = { at: 0, size: 30 };
async function getFeedPageSize() {
	if (Date.now() - _feedPageCache.at < 60_000) return _feedPageCache.size;
	try {
		const { data } = await supabase.from("settings").select("value").eq("key", "feed_config").maybeSingle();
		const n = data?.value?.page_size;
		_feedPageCache = { at: Date.now(), size: Number.isInteger(n) && n >= 5 && n <= 100 ? n : 30 };
	} catch { _feedPageCache = { at: Date.now(), size: 30 }; }
	return _feedPageCache.size;
}

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
	if (validCursor(cursor)) qq = qq.lt("created_at", cursor);
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

/**
 * A cursor is an opaque ISO timestamp WE issued as nextCursor. Anything else
 * (cursor=0, hand-typed garbage, a leaked internal id) must read as page 1:
 * PostgREST turns `.lt("created_at", "0")` into a 400 that used to surface
 * here as a 500 "Internal server error". Fail open, never 500 on input shape.
 */
export function validCursor(c) {
	if (typeof c !== "string" || !c) return null;
	// nextCursor values we issue are always ISO timestamps. Date.parse alone
	// is insufficient — V8 parses "0" as year 2000 — so require ISO shape too.
	if (!/\d{4}-\d{2}-\d{2}/.test(c)) return null;
	return Number.isNaN(Date.parse(c)) ? null : c;
}

/** Authenticated maintenance sweep: permanently remove solved/archived posts inactive for 5+ days (throttled to 1/hour). */
export async function purgeExpired() {
	const now = Date.now();
	if (now - _lastPurgeAtMem < PURGE_COOLDOWN_MS) {
		return { purged: 0, skipped: true };
	}
	// FIX #10: Check persisted throttle in settings (survives cold starts)
	try {
		const { data: state } = await supabase.from("settings").select("value").eq("key", "purge_state").maybeSingle();
		const lastAt = state?.value?.last_purge_at ? new Date(state.value.last_purge_at).getTime() : 0;
		if (now - lastAt < PURGE_COOLDOWN_MS) {
			_lastPurgeAtMem = lastAt;
			return { purged: 0, skipped: true };
		}
	} catch (err) { console.error("[posts] purge throttle read failed, continuing", { error: err?.message || String(err) }); }
	_lastPurgeAtMem = now;
	let purged = 0;
	try {
		const cutoff = new Date(Date.now() - PURGE_MS).toISOString();
		const { data: expired, error: expiredErr } = await supabase
			.from("posts")
			.select("id")
			.in("status", ["solved", "archived"])
			.lt("updated_at", cutoff)
			.limit(20);
		if (expiredErr) throw expiredErr;
		if (expired?.length) {
			const ids = expired.map((p) => p.id);
			await auditLog("system", "purge_expired", `${ids.length} solved/archived posts inactive 5d`);
			// Ordered compensating deletes: unlink linked polls first, then the
			// parent posts, then dependents. The unlink MUST succeed before a
			// parent row is removed — once it is gone the sweep can never
			// re-select it, so a failed unlink throws and the next sweep
			// retries the intact batch instead of orphaning polls.post_id.
			// (Dependent comment/reaction failures below stay log-only: those
			// reads are always anchored at the post, so their orphans are
			// invisible, but a poll points AT the post and dangles visibly.)
			const { error: e0 } = await supabase.from("polls").update({ post_id: null }).in("post_id", ids);
			if (e0) throw e0;
			const { error: e1 } = await supabase.from("posts").delete().in("id", ids);
			if (e1) throw e1;
			purged = ids.length;
			const { error: e2 } = await supabase.from("comments").delete().in("post_id", ids);
			if (e2) console.error("[posts] purge comments cleanup failed", { count: ids.length, error: e2.message });
			const { error: e3 } = await supabase.from("reactions").delete().in("target_id", ids);
			if (e3) console.error("[posts] purge reactions cleanup failed", { count: ids.length, error: e3.message });
		}
		// User-deleted auto-purge: deleted=true and updated_at older than 5h.
		// updated_at is set on every PUT, so it marks deletion time honestly
		// without a schema migration. Throttled with the same 1h gate above.
		let userDeleteHours = 5;
		let autoDelete = true;
		try {
			const { data: rs0 } = await supabase.from("settings").select("value").eq("key", "retention_config").maybeSingle();
			const n0 = Number(rs0?.value?.user_delete_hours);
			if (Number.isInteger(n0) && n0 >= 1 && n0 <= 168) userDeleteHours = n0;
			if (rs0?.value?.auto_delete_enabled === false) autoDelete = false;
		} catch {
			/* defaults stand */
		}
		if (autoDelete) {
		try {
			const userCutoff = new Date(Date.now() - userDeleteHours * 60 * 60 * 1000).toISOString();
			const { data: userDeleted, error: userDeletedErr } = await supabase
				.from("posts")
				.select("id")
				.eq("deleted", true)
				.lt("updated_at", userCutoff)
				.limit(20);
			if (userDeletedErr) throw userDeletedErr;
			if (userDeleted?.length) {
				const uids = userDeleted.map((p) => p.id);
				// Same unlink-first order as the solved/archived sweep above:
				// a failed unlink throws before any parent row is removed.
				const { error: u0 } = await supabase.from("polls").update({ post_id: null }).in("post_id", uids);
				if (u0) throw u0;
				const { error: u1 } = await supabase.from("posts").delete().in("id", uids);
				if (u1) throw u1;
				purged += uids.length;
				await auditLog("system", "purge_user_deleted", `${uids.length} user-deleted posts older than ${userDeleteHours}h`);
				const { error: u2 } = await supabase.from("comments").delete().in("post_id", uids);
				if (u2) console.error("[posts] purge user-deleted comments cleanup failed", { count: uids.length, error: u2.message });
				const { error: u3 } = await supabase.from("reactions").delete().in("target_id", uids);
				if (u3) console.error("[posts] purge user-deleted reactions cleanup failed", { count: uids.length, error: u3.message });
			}
		} catch (err) {
			console.error("[posts] user-deleted purge sweep failed", { error: err?.message || String(err) });
		}
		}
		// Purging cascades comment/reaction deletes — drop the derived-count SWR
		// so the next feed read does not serve a purged post's counts for up to
		// staleTtl. Best-effort: a miss just ages out with the TTL anyway.
		if (purged) invalidateCounts();
		// FIX #10: Persist last purge timestamp so throttle survives cold starts
		try {
			await supabase.from("settings").upsert({ key: "purge_state", value: { last_purge_at: new Date().toISOString() } }, { onConflict: "key" });
		} catch (err) { console.error("[posts] purge throttle persist failed", { error: err?.message || String(err) }); }
	} catch (err) {
		console.error("[posts] purge sweep failed", { error: err?.message || String(err) });
		throw err;
	}
	return { purged, skipped: false };
}

async function attachCounts(posts) {
	const ids = posts.map((p) => p.id);
	if (!ids.length) return posts;

	// The four raw count queries live in _counts.js behind staleWhileRevalidate
	// (3 s fresh / 6 s stale) so N concurrent visitors cost ONE set of queries
	// per window instead of 4 N. Under Vitest that cache is bypassed, so this
	// still hits the mocked DB every call — nothing test-visible changes here.
	// Everything below is presentation and is recomputed on EVERY request:
	// status gates, the co-sign threshold and purge_at are wall-clock/status
	// dependent and must never be served from a cache.
	const { rMap, cMap, pMap, pvMap } = await getRawCounts(ids);

	return posts.map((p) => {
		// Copy: the maps are shared across requests, so the response must not
		// hand out a reference a later handler could mutate.
		const reactions = { ...(rMap[p.id] || {}) };
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
			// Public reads are side-effect free. Expired-post cleanup belongs to
			// the authenticated maintenance/cron path, never to a user's GET.
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
				status,
				category,
				priority,
				q: qParam,
				fresh: freshParam,
				from,
				to,
			} = req.query;

			// ── Server-side list filters ─────────────────────────────
			// These MUST run in SQL. The admin table pages 30 rows at a time, so
			// filtering in the browser only ever filtered the rows that happened
			// to be loaded — which is why the date filter appeared broken: it
			// searched the 30 most recent posts of all time rather than the
			// dataset, and the row count it reported was not a real total.
			const listFilters = {
				status: clean(status, 40),
				category: clean(category, 60),
				priority: clean(priority, 20),
				q: clean(qParam, 80),
				from: clean(from, 40),
				to: clean(to, 40),
			};
			const hasListFilters = Object.values(listFilters).some(Boolean);
			// Date filters are user-typed: garbage must 400 with a clear
			// message, never reach PostgREST (which 400s opaquely and used
			// to surface here as a 500 "Internal server error").
			for (const k of ["from", "to"]) {
				if (listFilters[k] && !validCursor(listFilters[k])) {
					return res
						.status(400)
						.json({ error: `Invalid ${k} date — use YYYY-MM-DD.` });
				}
			}

			/** Narrow any posts query (row fetch OR exact count) by the same filters. */
			const applyListFilters = (query) => {
				let out = query;
				if (listFilters.status) out = out.eq("status", listFilters.status);
				if (listFilters.category) out = out.eq("category", listFilters.category);
				if (listFilters.priority) out = out.eq("priority", listFilters.priority);
				if (listFilters.from) out = out.gte("created_at", listFilters.from);
				if (listFilters.to) out = out.lt("created_at", listFilters.to);
				if (listFilters.q) {
					// Strip PostgREST separators so user input cannot reshape the query
					// (a stray comma in an `.or()` string would inject another clause).
					const term = listFilters.q.replace(/[,()%\\*]/g, " ").trim();
					if (term)
						out = out.or(
							[
								"title",
								"description",
								"category",
								"id",
								"author_id",
							]
								.map((col) => `${col}.ilike.%${term}%`)
								.join(","),
						);
				}
				return out;
			};
			const admin = all === "1" ? await isAdmin(req) : false;
			const isPaginated = paginate === "1" || paginate === "true";
			// Clamp on both ends: NaN/0 falls back to 30, negatives would produce
			// an invalid PostgREST `limit` and surface as a 500. An explicit
			// client limit is honored as today; when absent, the admin-configured
			// feed page size applies (default 30 = today's behavior).
			const PAGE_LIMIT = limitParam
				? Math.max(1, Math.min(parseInt(limitParam) || 30, 100))
				: await getFeedPageSize();

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
				// the main feed, EXCEPT the author always sees their own held and
				// hidden posts (otherwise an admin hide or a queued submission
				// silently vanishes from My Activity with no explanation).
				const isSelfView = !!viewerId && viewerId === clean(author, 40);
				if (!admin) {
					if (!isSelfView) q = q.eq("hidden", false);
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
				q = applyListFilters(q);
				// Cursor-based pagination: only a valid ISO cursor narrows the
				// window — garbage reads as page 1 (see validCursor).
				const safeCursor = validCursor(cursor);
				if (isPaginated && safeCursor) q = q.lt("created_at", safeCursor);
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
			// Filtered requests must never read the shared feed cache — the cache
			// key describes the unfiltered feed, so serving it here would return
			// rows that do not match the requested filters.
			const canUseFeedCache =
				!process.env.VITEST &&
				freshParam !== "1" &&
				freshParam !== "true" &&
				!admin &&
				!viewerId &&
				!id &&
				!ids &&
				!author &&
				!hasListFilters;
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

				// ── Total count ────────────────────────────────────────────
				// The count must describe the SAME set the rows came from, or the
				// header reports a total that contradicts what pagination can
				// actually serve: a plain count here once reported 1068 while the
				// artifact-filtered rows numbered 32, so every "total posts" widget
				// lied by 33x. The JS filter (artifacts + visibility) cannot be
				// expressed in SQL (word-boundary matching), but page 1 already
				// scans the full window and applies it — so `rows.length` IS the
				// honest total there (the comment at the limit(2000) documents that
				// ceiling).
				//
				// That also means page 1 never needs the SQL count. It used to run
				// an exact COUNT(*) — a matching-row scan plus one round trip — on
				// EVERY page-1 request and then DISCARD the result via
				// `cursor ? sqlCount : rows.length`. Page 1 is the hot path every
				// visitor lands on first, so skipping it removes a whole DB round
				// trip from the request that matters most under load. Only deeper
				// cursor pages, which never saw the whole set, still run the query —
				// and they start it BEFORE attachCounts so the two overlap instead
				// of queueing.
				const runTotalCount = () => {
					let totalQ = supabase
						.from("posts")
						.select("id", { count: "exact", head: true });
					if (type) totalQ = totalQ.eq("type", type);
					if (!admin)
						totalQ = totalQ
							.eq("hidden", false)
							.eq("deleted", false)
							.neq("status", "pending_review");
					totalQ = applyListFilters(totalQ);
					return Promise.resolve(totalQ);
				};
				const countPromise = cursor ? runTotalCount() : null;
				// Not awaited yet: if attachCounts throws below we must not leave
				// an unhandled rejection behind. The original stays awaitable.
				if (countPromise) countPromise.catch(() => {});

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

				// Page 1: the observed, fully-filtered set IS the total (pagination
				// can serve exactly these rows). Deeper cursor pages report the SQL
				// count as an approximate header, where precision matters less.
				let total = rows.length;
				if (countPromise) {
					const { count } = await countPromise;
					total = typeof count === "number" ? count : 0;
				}
				return res
					.status(200)
					.json({ data: masked, nextCursor, total });
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
			// Raw text through every gate below; masked only at insert.
			// Masking first would blind serverModerate (a masked slur no
			// longer matches SLURS and would publish instead of blocking).
			const title = clean(b.title, 120);
			const description = clean(b.description, 500);
			if (title.length < 5)
				return res
					.status(400)
					.json({ error: "Title must be at least 5 characters." });
			if (description.length < 10)
				return res
					.status(400)
					.json({ error: "Description must be at least 10 characters." });

			// Safety repost guard: previously removed content can't return
			// with trivial changes. Runs before the duplicate scan so reposts
			// get the safety code (and bump the persistence counter).
			const repost = await checkSafetyRepost(supabase, `${title} ${description}`);
			if (repost.blocked) {
				await auditLog(
					"moderation",
					"post_repost_blocked",
					`${author_id}: ${title.slice(0, 60)} [rule=${repost.rule} attempts=${repost.attempts}]`,
				);
				return res.status(403).json({
					error: "This content was previously removed for safety reasons and cannot be reposted.",
					code: "SAFETY_REPOST_BLOCKED",
				});
			}

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

			// Idempotent submit: double-tap, retry-after-timeout, and
			// offline-queue flush can deliver the same payload twice with
			// both copies passing the duplicate scan (neither has landed
			// when the other is checked). Same author + exact normalized
			// title + same category within 90s returns the original row
			// (200 + deduped:true) instead of a twin — and instead of a
			// confusing 409, since from the submitter's view this IS
			// their post. Deleted/hidden twins are skipped (a fresh repost
			// after delete is legitimate); empty normalized titles never
			// match (all-symbol titles would collide with each other).
			const IDEMPOTENCY_MS = 90000;
			const recentMine = await supabase
				.from("posts")
				.select("id,title,category,status,created_at,deleted,hidden")
				.eq("author_id", author_id)
				.gte("created_at", new Date(Date.now() - IDEMPOTENCY_MS).toISOString())
				.order("created_at", { ascending: false })
				.limit(10);
			const twinCutoff = Date.now() - IDEMPOTENCY_MS;
			const twin = (recentMine.data || []).find(
				(twinPost) =>
					!twinPost.deleted &&
					!twinPost.hidden &&
					twinPost.category === category &&
					Number(Date.parse(twinPost.created_at || 0)) > twinCutoff &&
					normalizeForCompare(twinPost.title || "") === normalizedTitle &&
					normalizedTitle !== "",
			);
			if (twin) {
				return res.status(200).json({ ...twin, deduped: true });
			}

			// Fetch recent posts in same category (last 200) for comparison.
			// Hidden posts are excluded: their titles must neither leak
			// through duplicate collisions nor block legitimate reposts.
			const { data: recentPosts } = await supabase
				.from("posts")
				.select("id, title, category, status")
				.eq("category", category)
				.eq("deleted", false)
				.eq("hidden", false)
				.eq("visibility", visibility)
				.order("created_at", { ascending: false })
				.limit(200);

			// Match the same public-content boundary used by GET /api/posts.
			// Test/fuzz artifacts and pending-review rows are intentionally
			// invisible to the submitter; neither may block a real submission
			// with a 409 duplicate error.
			const comparablePosts = (recentPosts || []).filter(
				(p) => !isTestArtifact(p.title) && p.status !== "pending_review",
			);

			// Check for exact or near-exact title matches
			const isDuplicate = comparablePosts.some((p) => {
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
			// DEEP path: deterministic floor + deterministic contextual scan +
			// a real model judging meaning (bounded, skipped when already
			// blocked). The model is what catches contextual PII and
			// politely-worded abuse that no list contains.
			const decision = await evaluateContentDeep(`${title} ${description}`, "queued", learned, {
				taskKey: "posts.write",
			});
			if (decision.blocked) {
				const isPII = decision.flags.some((f) => f.type === "privacy");
				await auditLog(
					"moderation",
					"post_blocked",
					`${author_id}: ${title.slice(0, 60)} [${decision.flags.map((f) => f.type).join(", ")}]`,
				);
				// Fingerprint blocked text so near-verbatim reposts hit SAFETY_REPOST_BLOCKED.
				await recordSafetyRepost(
					supabase,
					`${title} ${description}`,
					(decision.flags[0] || {}).type || "policy",
				);
				// Slang auto-strike: 4+ unique slang terms in one blocked
				// submission strikes the author (best-effort, never delays 403).
				if (decision.flags.some((f) => f.type === "profanity")) {
					await strikeSlangAbuse(author_id, "post", `${title} ${description}`);
				}
				const code = isPII ? "PII_BLOCKED" : decision.code;
				return res.status(403).json({
					error: messageFor("post", code),
					code,
				});
			}

			// Quality review: flagged posts need admin approval before going public.
			// Clients that ran the pre-publish AI agent can also request review for
			// 'revision'-level content — or when the moderation service was down —
			// by passing pending_review: true. Never let such content publish directly.
			// Weak/unusual personal-info formats (PIN codes, room-level addresses)
			// also never publish: posts route to the review queue for an admin
			// decision, while comments/polls hard-block outright.
			const weakPII = decision.flags.some((f) => f.type === "privacy_weak");
			const needsReview = decision.needsReview;
			const holdForReview = needsReview || weakPII || b.pending_review === true;

			// ── Real spam analysis (multi-signal, deterministic) ────────
			const ip = clientIp(req);
			// Thresholds come from admin settings (spam_config) — one read per
			// submission, defaulting safely when unset.
			const spamResult = spamAnalyze(
				title,
				description,
				author_id,
				ip,
				[],
				await getSpamConfig(supabase),
			);
			// Quarantine regardless of the moderation result. The action comes
			// from the admin-configured spam ladder (spam_config), never from a
			// second hardcoded copy of the thresholds here.
			if (spamResult.action === "quarantine") {
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
			// Hold for review (don't block, but don't auto-publish)
			const spamHold = spamResult.action === "review";
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
				// Store masked text; every gate above already ran on the raw text.
				title: maskProfanity(title),
				description: maskProfanity(description),
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
					`${author_id}: ${title.slice(0, 60)} [${decision.flags.map((f) => f.type).join(", ")}]`,
				);
				// Persist the flag types so the admin's later decision can feed
				// the self-learning loop (approve → confidence up, reject → down).
				try {
					await supabase.from("settings").upsert(
						{
							key: `modflag:${post.id}`,
							value: {
								flags: decision.flags.map((f) => f.type),
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
			feedSWR.invalidate(); // new post appears immediately, no stale 10s window
			invalidateCounts(); // its id enters a different id-set anyway; cheap
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
					patch.title = clean(b.title, 120);
				if (b.description !== undefined)
					patch.description = clean(b.description, 500);
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
				const editDecision = await evaluateContentDeep(`${patch.title ?? post.title} ${patch.description ?? post.description}`, "queued", null, {
					taskKey: "posts.edit",
				});
				if (editDecision.blocked) {
					const isPII = editDecision.flags.some((f) => f.type === "privacy");
					await auditLog(
						"moderation",
						"edit_blocked",
						`${id}: ${(patch.title || "").slice(0, 60)} [${editDecision.flags.map((f) => f.type).join(", ")}]`,
					);
					await recordSafetyRepost(
						supabase,
						`${patch.title ?? post.title} ${patch.description ?? post.description}`,
						(editDecision.flags[0] || {}).type || "policy",
					);
					const editCode = isPII ? "PII_BLOCKED" : editDecision.code;
					return res.status(403).json({
						error: messageFor("editPost", editCode),
						code: editCode,
					});
				}
				// Weak/unusual PII formats (PIN codes, room-level addresses) never
				// publish either: pull the post into the review queue, keeping the
				// edit out of public view until an admin decides.
				if (editDecision.flags.some((f) => f.type === "privacy_weak")) {
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
			// Mask for storage only after the raw text passes moderation.
			if (patch.title !== undefined) patch.title = maskProfanity(patch.title);
			if (patch.description !== undefined)
				patch.description = maskProfanity(patch.description);
			patch.updated_at = new Date().toISOString();
			const { data, error } = await supabase
				.from("posts")
				.update(patch)
				.eq("id", id)
				.select()
				.single();
			if (error) throw error;
			// Owner deletes/restores were invisible to admins (no audit row, no
			// deleter timestamp beyond updated_at). Record them best-effort so
			// the admin feed can show which user deleted and when.
			if (!admin && isOwner && patch.deleted !== undefined) {
				try {
					await auditLog(
						"user",
						patch.deleted === true ? "delete_post" : "restore_post",
						`${callerId}: ${id}`,
					);
				} catch {
					/* audit never breaks the update */
				}
			}
			if (admin)
				await auditLog(
					"admin",
					"update_post",
					`${id}: ${Object.keys(patch).join(", ")}`,
				);
			// Author notice: an admin acting on someone else's post must reach
			// the author — otherwise posts vanish from My Activity with no
			// explanation and no notification. Best-effort: notices never
			// break the update. (Owner edits and follower-solved notices are
			// handled by their own paths, not duplicated here.)
			if (admin && !isOwner) {
				try {
					const shortTitle = String(post.title || "your post").slice(0, 60);
					const spaced = (s) => String(s).replace(/_/g, " ");
					if (patch.hidden === true)
						await notifyUser(
							post.author_id,
							"info",
							"Post hidden by moderators",
							`"${shortTitle}" is temporarily hidden while under review. Message the team via inbox if this is a mistake.`,
						);
					else if (patch.hidden === false)
						await notifyUser(
							post.author_id,
							"success",
							"Post visible again",
							`"${shortTitle}" is public again.`,
						);
					else if (patch.deleted === true)
						await notifyUser(
							post.author_id,
							"info",
							"Post removed by moderators",
							`"${shortTitle}" was removed. Message the team via inbox if this is a mistake.`,
						);
					else if (patch.admin_reply && patch.admin_reply !== post.admin_reply)
						await notifyUser(
							post.author_id,
							"info",
							"Admin replied to your post",
							`"${shortTitle}": ${String(patch.admin_reply).slice(0, 120)}`,
						);
					else if (patch.status && patch.status !== post.status)
						await notifyUser(
							post.author_id,
							patch.status === "solved" ? "success" : "info",
							patch.status === "solved"
								? "Your post was marked solved"
								: `Update on your post: ${spaced(patch.status)}`,
							`"${shortTitle}" moved to ${spaced(patch.status)}.`,
						);
				} catch {
					/* notices never break the update */
				}
			}
			feedSWR.invalidate(); // solved/hidden/pinned changes show live
			invalidateCounts(); // hide/unhide changes which rows counts map onto
			// Emit event for status changes
			if (patch.status)
				emitEventAndBridge(EVENT_TYPES.POST_STATUS_CHANGED, {
					post_id: id,
					old_status: post.status,
					new_status: patch.status,
				}).catch((err) =>
					console.warn("[posts] emit POST_STATUS_CHANGED failed:", err.message),
				);
			// Removal verification: when this update takes the post out of
			// public view, prove it on the public read path and record how
			// long it was exposed. Failures audit loudly, never silently.
			let removalVerification = null;
			const becameUnlisted =
				patch.hidden === true || patch.deleted === true || patch.status === "pending_review";
			if (becameUnlisted) {
				let publicAbsent = false;
				let proof = "";
				try {
					const { data: visible } = await supabase
						.from("posts")
						.select("id")
						.eq("id", id)
						.eq("hidden", false)
						.eq("deleted", false)
						.neq("status", "pending_review")
						.maybeSingle();
					publicAbsent = visible == null;
					proof = publicAbsent
						? "post absent from public read path"
						: "post still publicly visible after removal";
				} catch (err) {
					proof = err?.message || String(err);
				}
				const createdMs = post.created_at ? new Date(post.created_at).getTime() : NaN;
				const exposure_ms = Number.isFinite(createdMs)
					? Math.max(0, Date.now() - createdMs)
					: null;
				// Fingerprint safety-driven removals so the text can't return
				// verbatim: posts held by moderation carry the signal; plain
				// admin curation hides do not.
				const safetyHold =
					post.status === "pending_review" || patch.status === "pending_review";
				if (publicAbsent && safetyHold) {
					let rule = "admin_hide";
					try {
						const { data: mf } = await supabase
							.from("settings")
							.select("value")
							.eq("key", `modflag:${id}`)
							.maybeSingle();
						const held = mf?.value?.flags || [];
						if (held[0]) rule = held[0];
					} catch {
						/* rule stays admin_hide */
					}
					await recordSafetyRepost(
						supabase,
						`${data.title ?? post.title} ${data.description ?? post.description}`,
						rule,
					);
				}
				removalVerification = {
					ok: publicAbsent,
					exposure_ms,
					public_path_absent: publicAbsent,
					proof,
				};
				await auditLog(
					"moderation",
					publicAbsent ? "post_removal_verified" : "post_removal_unverified",
					`${id}: ${proof} [exposure_ms=${exposure_ms}]`,
				);
			}
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
			return res.status(200).json(
				removalVerification ? { ...data, verification: removalVerification } : data,
			);
		}

		if (req.method === "DELETE") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			// DELETE bodies are not parsed on some hosts (Vercel drops them),
			// so the id travels in the query string; body accepted as fallback.
			const id = req.query?.id || req.body?.id;
			if (!id) return res.status(400).json({ error: "Missing id" });
			// Null out post_id on linked polls (preserve votes + poll data), then delete post + comments + reactions
			const [
				{ error: e1 },
				{ data: removed, error: e2 },
				{ error: e3 },
				{ error: e4 },
			] = await Promise.all([
				supabase.from("polls").update({ post_id: null }).eq("post_id", id),
				supabase.from("posts").delete().eq("id", id).select("id"),
				supabase.from("comments").delete().eq("post_id", id),
				supabase.from("reactions").delete().eq("target_id", id),
			]);
			const firstErr = e1 || e2 || e3 || e4;
			if (firstErr) throw firstErr;
			// Prove the delete landed: an unparsed/missing id used to no-op and
			// still return ok:true, so the row "came back" on reload.
			if (!removed || removed.length === 0)
				return res.status(404).json({ error: "Post not found" });
			await auditLog("admin", "hard_delete_post", id);
			feedSWR.invalidate();
			invalidateCounts(); // cascade-deleted reactions/comments leave the cache
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
