// Account status check for the caller's own anonymous ID (no personal data involved)

import {
	checkUser,
	clean,
	clientIp,
	cors,
	isAdmin,
	rateLimitResponse,
	verifyCallerIdentity,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

/* ── IP-based rate limiting (prevent enumeration) ────────── */
const hits = new Map();
const postHits = new Map();
const POST_WINDOW = 60_000;
const POST_LIMIT = 30; // 30 beats/min per IP — one tab beats 1/min; 30 is headroom, not a target
const WINDOW = 60_000; // 1 minute
const LIMIT = 30; // 30 req/min per IP (generous — this endpoint is called by every page load)

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

// Periodic cleanup every 5 minutes
setInterval(() => {
	const now = Date.now();
	for (const [k, v] of hits) {
		if (now - v.start > WINDOW * 2) hits.delete(k);
	}
}, 300_000).unref();

// Presence-heartbeat throttle state (per instance, best-effort).
const heartbeatAt = new Map();

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	// Presence heartbeat: one lightweight last_seen touch per visible tab
	// per minute (client) throttled here to one write per id per 45s so a
	// fleet of idle tabs cannot turn presence into a write flood. Self-only
	// (or admin); upsert is safe on a fresh id (all other columns nullable
	// or defaulted). Best-effort per-instance throttle — documented, not a
	// security boundary.
	if (req.method === "POST") {
		try {
			const b = req.body || {};
			const pip = clientIp(req);
			const pentry = postHits.get(pip);
			const pnow = Date.now();
			if (!pentry || pnow - pentry.start > POST_WINDOW) postHits.set(pip, { start: pnow, count: 1 });
			else {
				pentry.count++;
				if (pentry.count > POST_LIMIT) return rateLimitResponse(res, 60, "Too many heartbeats");
			}
			if (b.action !== "heartbeat")
				return res.status(400).json({ error: "Unknown action" });
			const headerId = clean(req.headers["x-anon-id"] || "", 40);
			const admin = await isAdmin(req);
			const anonId = headerId || "";
			if (!anonId)
				return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });
			if (!admin) {
				const gate = await verifyCallerIdentity(req, res, anonId);
				if (!gate.ok) return res.status(gate.status || 403).json({ error: gate.error, code: gate.code });
			}
			// Banned/suspended IDs get no presence: refuse BEFORE the throttle
			// (a refusal must not poison the throttle slot) and write nothing.
			const gate = await checkUser(anonId);
			if (!gate.ok) return res.status(403).json({ error: gate.error, heartbeat: "refused" });
			const nowMs = Date.now();
			const last = heartbeatAt.get(anonId) || 0;
			if (nowMs - last < 45_000)
				return res.status(200).json({ ok: true, throttled: true });
			heartbeatAt.set(anonId, nowMs);
			const { error } = await supabase
				.from("users_meta")
				.upsert(
					{ anon_id: anonId, last_seen: new Date(nowMs).toISOString() },
					{ onConflict: "anon_id" },
				);
			if (error) throw error;
			return res.status(200).json({ ok: true });
		} catch (err) {
			return sanitizeError(res, err, "me-heartbeat");
		}
	}
	if (req.method !== "GET")
		return res.status(405).json({ error: "Method not allowed" });

	// Rate limit
	const ip = clientIp(req); // FIX #11: proxy-aware, rightmost XFF hop
	if (isRateLimited(ip)) return rateLimitResponse(res, 60, "Too many requests");

	try {
		const anonId = clean(req.query.anon_id, 40);
		if (!anonId) return res.status(400).json({ error: "Missing anon_id" });
		// FIX #2: Verify caller identity — only allow checking your own anon_id unless admin
		if (!(await isAdmin(req))) {
			const gate = await verifyCallerIdentity(req, res, anonId);
			if (!gate.ok) return res.status(gate.status || 403).json({ error: gate.error, code: gate.code });
		}
		const { data } = await supabase
			.from("users_meta")
			.select("banned,suspended_until,strikes,warnings")
			.eq("anon_id", anonId)
			.maybeSingle();
		const suspended =
			data?.suspended_until && new Date(data.suspended_until) > new Date();
		return res.status(200).json({
			banned: !!data?.banned,
			suspended: !!suspended,
			suspended_until: suspended ? data.suspended_until : null,
			strikes: data?.strikes || 0,
			warnings: data?.warnings || [],
		});
	} catch (err) {
		return sanitizeError(res, err, "me");
	}
}
