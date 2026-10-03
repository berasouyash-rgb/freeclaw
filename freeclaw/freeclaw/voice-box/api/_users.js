// Anonymous account registration + heartbeat + own-status check
// Called on app load so every live browser shows up in admin immediately,
// and so banned/suspended users see their status.

import { clean, clientIp, cors, rateLimitResponse } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

// Simple in-memory rate limiter: max `limit` requests per `windowMs` for a key.
const ipHits = new Map();
function ipRateLimited(key, windowMs = 60000, limit = 10) {
	const now = Date.now();
	// Lazy prune — serverless-safe (no module-scope timers: they are frozen
	// between invocations and never fire reliably).
	if (ipHits.size > 1000) {
		const cutoff = now - 2 * windowMs;
		for (const [k, v] of ipHits) {
			if (v.start < cutoff) ipHits.delete(k);
		}
	}
	const entry = ipHits.get(key);
	if (!entry || now - entry.start > windowMs) {
		ipHits.set(key, { start: now, count: 1 });
		return false;
	}
	entry.count++;
	return entry.count > limit;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		// Key on clientIp (x-real-ip / RIGHTMOST x-forwarded-for hop / socket) so
		// a caller cannot mint unlimited buckets by rewriting the leftmost hop.
		const clientIpKey = clientIp(req);
		const claimed = clean(
			req.headers["x-anon-id"] || req.body?.anon_id,
			40,
		).toLowerCase();

		// This endpoint is the app-load heartbeat: every live browser calls it,
		// and callers read their own ban/suspension status from the reply. The
		// bucket used to be keyed on IP alone, so an entire school behind one
		// NAT shared 10 requests/minute — five page loads and nobody behind that
		// address could register or see their account status. Key on identity
		// instead (falling back to IP), exactly as checkAbuse does in
		// _security.js, and keep a looser per-IP backstop so a caller cannot mint
		// unlimited buckets by rotating the header.
		const identityKey = claimed.startsWith("anon_")
			? `id:${claimed}`
			: `ip:${clientIpKey}`;
		if (ipRateLimited(identityKey, 60000, 20) || ipRateLimited(`ip:${clientIpKey}`, 60000, 120)) {
			return rateLimitResponse(
				res,
				60,
				"Too many requests. Please try again later.",
			);
		}

		const anon_id = claimed;
		if (!anon_id || !anon_id.startsWith("anon_"))
			return res.status(400).json({ error: "Invalid anonymous ID" });

		const now = new Date().toISOString();
		const { data: existing } = await supabase
			.from("users_meta")
			.select("*")
			.eq("anon_id", anon_id)
			.maybeSingle();

		if (!existing) {
			// New visitor — create the row with full defaults so admin views are
			// never missing moderation/activity columns.
			const { error: insErr } = await supabase.from("users_meta").insert({
				anon_id,
				warnings: [],
				strikes: 0,
				banned: false,
				last_seen: now,
			});
			if (insErr) console.error("users_meta insert failed:", insErr.message);
		} else {
			// Returning visitor — the heartbeat doubles as the online signal for the
			// admin dashboard; without this, last_seen goes stale forever (FIX-#9).
			const { error: updErr } = await supabase
				.from("users_meta")
				.update({ last_seen: now })
				.eq("anon_id", anon_id);
			if (updErr)
				console.error("users_meta last_seen update failed:", updErr.message);
		}

		const meta = existing || {
			banned: false,
			suspended_until: null,
			strikes: 0,
			warnings: [],
		};
		const suspended =
			meta.suspended_until && new Date(meta.suspended_until) > new Date();
		return res.status(200).json({
			ok: true,
			banned: !!meta.banned,
			suspended: !!suspended,
			suspended_until: suspended ? meta.suspended_until : null,
			strikes: meta.strikes || 0,
			warning_count: (meta.warnings || []).length,
			latest_warning: (meta.warnings || []).slice(-1)[0]?.text || null,
		});
	} catch (err) {
		return sanitizeError(res, err, "users");
	}
}
