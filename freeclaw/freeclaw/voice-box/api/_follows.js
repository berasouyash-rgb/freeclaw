// Post Follows — follow/unfollow a post and get notified on status change.
// GET    /api/follows?user_id=X                  → { follows: [...ids], count }
// POST   /api/follows { user_id, post_id }       → add follow
// POST   /api/follows { user_id, post_id, following:false } → remove follow
// DELETE /api/follows?user_id=X&post_id=Y        → remove follow
//
// Follows persist in the settings table under key `follows:${userId}` as
// { follows: [postId, ...] } — the same storage pattern as notifications.
// `notifyFollowers` is exported for _posts.js to fan out a status-change /
// admin-reply notification to everyone following a post.

import { clean, cors, rateLimitResponse, verifyCallerIdentity } from "./_auth.js";
import supabase from "./_db-client.js";
import { getNotifyPrefs } from "./_notify-prefs.js";
import { sendEmail, sendSms } from "./_dispatch.js";

function followsKey(userId) {
	return `follows:${userId}`;
}

const FOLLOWS_LIMIT = 200;
// Notification fan-out is capped to keep one status change from hammering settings
const NOTIFY_CAP = 50;

// Simple in-memory per-user rate limiter for write operations
const writeHits = new Map();
function writeRateLimited(userId, windowMs = 60000, limit = 15) {
	const now = Date.now();
	const entry = writeHits.get(userId);
	if (!entry || now - entry.start > windowMs) {
		writeHits.set(userId, { start: now, count: 1 });
		return false;
	}
	entry.count++;
	return entry.count > limit;
}

export async function getFollows(userId) {
	if (!userId) return [];
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", followsKey(userId))
		.maybeSingle();
	return (data?.value?.follows || []).filter(Boolean);
}

// Best-effort: push a notification to every user following postId.
// Never throws — callers treat this as fire-and-forget.
export async function notifyFollowers(postId, notification = {}) {
	try {
		if (!postId) return;
		const { data: rows } = await supabase
			.from("settings")
			.select("key,value")
			.ilike("key", "follows:%")
			.limit(400);
		const followers = (rows || [])
			.filter((r) => (r.value?.follows || []).includes(postId))
			.slice(0, NOTIFY_CAP);

		await Promise.all(
			followers.map(async (row) => {
				const userId = String(row.key || "").replace("follows:", "");
				if (!userId) return;
				// Respect the follower's status-update preference FIRST — when
				// opted out, skip every channel (in-app, SMS, email).
				const prefs = await getNotifyPrefs(userId);
				if (prefs && prefs.status_updates === false) return;
				const { data: cur } = await supabase
					.from("settings")
					.select("value")
					.eq("key", `notifications:${userId}`)
					.maybeSingle();
				const notif = {
					id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
					type: notification.type || "post",
					title: notification.title || "Post updated",
					body: notification.body || "",
					post_id: postId,
					read: false,
					created_at: new Date().toISOString(),
				};
				const notifications = (cur?.value?.notifications || []).slice(0, 99);
				notifications.unshift(notif);
				await supabase
					.from("settings")
					.upsert(
						{
							key: `notifications:${userId}`,
							value: { notifications, updated_at: new Date().toISOString() },
						},
						{ onConflict: "key" },
					);

				// ── REAL outbound channels: SMS + email when the follower opted in ──
				// Best-effort only — a missing API key or a dead provider never blocks
				// the in-app notification above. prefs was fetched above (opt-out gate).
				const text = `${notif.title}\n${notif.body || ""}`;
				if (prefs?.sms_enabled && prefs.phone) {
					const r = await sendSms(prefs.phone, text);
					if (!r.ok && r.error !== "not_configured")
						console.warn(`[follows] SMS to ${userId} failed: ${r.error}`);
				}
				if (prefs?.email_enabled && prefs.email) {
					const r = await sendEmail(prefs.email, notif.title, text);
					if (!r.ok && r.error !== "not_configured")
						console.warn(`[follows] email to ${userId} failed: ${r.error}`);
				}
			}),
		);
	} catch (err) {
		console.warn("[follows] notifyFollowers failed:", err.message);
	}
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		const userId = clean(req.query.user_id || req.body?.user_id, 40);
		if (!userId) return res.status(400).json({ error: "user_id required" });

		// P0 SECURITY FIX: Verify caller identity on all operations
		if (req.method !== "OPTIONS") {
			const caller = await verifyCallerIdentity(req, res, userId);
			if (!caller.ok)
				return res.status(caller.status).json({ error: caller.error });
		}

		if (req.method === "GET") {
			const follows = await getFollows(userId);
			return res.status(200).json({ follows, count: follows.length });
		}

		if (req.method === "DELETE") {
			if (writeRateLimited(userId))
				return rateLimitResponse(
					res,
					60,
					"Too many requests. Please try again later.",
				);
			const postId = clean(req.query.post_id || req.body?.post_id, 40);
			if (!postId) return res.status(400).json({ error: "post_id required" });
			const follows = (await getFollows(userId)).filter((p) => p !== postId);
			await supabase
				.from("settings")
				.upsert(
					{
						key: followsKey(userId),
						value: { follows, updated_at: new Date().toISOString() },
					},
					{ onConflict: "key" },
				);
			return res.status(200).json({ success: true, following: false, follows });
		}

		if (req.method === "POST") {
			if (writeRateLimited(userId))
				return rateLimitResponse(
					res,
					60,
					"Too many requests. Please try again later.",
				);
			const b = req.body || {};
			const postId = clean(b.post_id, 40);
			if (!postId) return res.status(400).json({ error: "post_id required" });
			const following = b.following === false ? false : true;
			const current = await getFollows(userId);
			const follows = following
				? current.includes(postId)
					? current
					: [...current, postId].slice(0, FOLLOWS_LIMIT)
				: current.filter((p) => p !== postId);
			await supabase
				.from("settings")
				.upsert(
					{
						key: followsKey(userId),
						value: { follows, updated_at: new Date().toISOString() },
					},
					{ onConflict: "key" },
				);
			return res.status(200).json({ success: true, following, follows });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		console.error("follows error:", err.message);
		return res.status(500).json({ error: "Internal error" });
	}
}
