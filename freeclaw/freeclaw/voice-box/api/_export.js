// My data export — aggregates every record the caller owns into one JSON bundle.
// GET /api/data-export?anon_id=X
// Returns: { anon_id, exported_at, profile, posts, comments, reactions,
//            poll_votes, saved, follows, notifications }
// Personal data leaves only at the caller's request; no names/emails/IPs stored.

import {
	clean,
	clientIp,
	cors,
	rateLimitResponse,
	verifyCallerIdentity,
} from "./_auth.js";
import supabase from "./_db-client.js";

/* ── IP-based rate limiting (aggregation is heavier than a page load) ── */
const hits = new Map();
const WINDOW = 60_000; // 1 minute
const LIMIT = 10; // 10 exports/min per IP

function isRateLimited(ip) {
	const now = Date.now();
	const entry = hits.get(ip);
	if (!entry || now - entry.start > WINDOW) {
		hits.set(ip, { start: now, count: 1 });
		return false;
	}
	entry.count++;
	return entry.count > LIMIT;
}

setInterval(() => {
	const now = Date.now();
	for (const [k, v] of hits) if (now - v.start > WINDOW * 2) hits.delete(k);
}, 300_000).unref();

async function settingsValue(key) {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", key)
		.maybeSingle();
	return data?.value ?? null;
}

// Profile fields that are safe to hand back to anyone who knows an anon_id.
// Moderation internals (warnings, strikes, banned, suspended_until, notes) are
// admin-state, NOT the user's own content — exporting them turns this endpoint
// into a public reader for any user's moderation history, so they are stripped.
const SAFE_PROFILE_FIELDS = ["anon_id", "created_at", "last_seen"];

function sanitizeProfile(row) {
	if (!row) return null;
	const out = {};
	for (const field of SAFE_PROFILE_FIELDS) {
		if (row[field] !== undefined && row[field] !== null)
			out[field] = row[field];
	}
	return out;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET")
		return res.status(405).json({ error: "Method not allowed" });

	const ip = clientIp(req); // FIX #11: proxy-aware, rightmost XFF hop
	if (isRateLimited(ip)) return rateLimitResponse(res, 60, "Too many requests");

	try {
		const anonId = clean(req.query.anon_id, 40);
		if (!anonId) return res.status(400).json({ error: "Missing anon_id" });
		const id = anonId.toLowerCase();

		const caller = await verifyCallerIdentity(req, res, id);
		if (!caller.ok) {
			return res
				.status(caller.status || 403)
				.json({ error: caller.error || "Forbidden" });
		}

		const [
			profile,
			posts,
			comments,
			reactions,
			pollVotes,
			saved,
			follows,
			notifications,
		] = await Promise.all([
			supabase.from("users_meta").select("*").eq("anon_id", id).maybeSingle(),
			supabase
				.from("posts")
				.select("*")
				.eq("author_id", id)
				.order("created_at", { ascending: false }),
			supabase
				.from("comments")
				.select("*")
				.eq("author_id", id)
				.order("created_at", { ascending: false }),
			supabase
				.from("reactions")
				.select("*")
				.eq("author_id", id)
				.order("created_at", { ascending: false }),
			supabase.from("poll_votes").select("*").eq("author_id", id),
			settingsValue(`saved:${id}`),
			settingsValue(`follows:${id}`),
			settingsValue(`notifications:${id}`),
		]);

		const bundle = {
			anon_id: id,
			exported_at: new Date().toISOString(),
			profile: sanitizeProfile(profile?.data || null),
			posts: posts?.data || [],
			comments: comments?.data || [],
			reactions: reactions?.data || [],
			poll_votes: pollVotes?.data || [],
			saved: saved?.saved || [],
			follows: follows?.follows || [],
			notifications: notifications?.notifications || [],
		};
		return res.status(200).json(bundle);
	} catch (err) {
		console.error("data-export error:", err.message);
		return res.status(500).json({ error: "Internal error" });
	}
}
