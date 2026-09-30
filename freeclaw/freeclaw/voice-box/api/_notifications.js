// Notification Center — in-app notifications for users.
// GET  /api/notifications?user_id=X            →  get notifications
// POST /api/notifications { user_id, type, title, body, post_id }  →  create notification
// POST /api/notifications/read { notification_id, user_id }        →  mark as read
// DELETE /api/notifications { user_id }         →  clear all notifications

import { checkUser, clean, cors, rateLimitResponse, verifyCallerIdentity } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

function notificationKey(userId) {
	return `notifications:${userId}`;
}

// Validate an anonymous id: anon_ prefix + lowercase alphanumeric, 5..40 chars.
// Mirrors checkUser()'s length rule and _users.js's anon_ prefix rule. Rejects
// settings-key suffix injection (e.g. "admin:1") and garbage ids.
function validAnonId(id) {
	return (
		typeof id === "string" &&
		id.length >= 5 &&
		id.length <= 40 &&
		/^anon_[a-z0-9]+$/.test(id)
	);
}

// Allowed notification type values — anything else falls back to 'info'.
const TYPES = new Set(["info", "success", "warning", "error"]);

// Simple in-memory per-user rate limiter for write operations
const userWriteHits = new Map();
function writeRateLimited(userId, windowMs = 60000, limit = 15) {
	const now = Date.now();
	const entry = userWriteHits.get(userId);
	if (!entry || now - entry.start > windowMs) {
		userWriteHits.set(userId, { start: now, count: 1 });
		return false;
	}
	entry.count++;
	return entry.count > limit;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		const userId = clean(
			(req.query.user_id || req.body?.user_id || "").toString(),
			40,
		).toLowerCase();
		if (!validAnonId(userId))
			return res.status(400).json({ error: "Invalid user_id" });

		// Rate limit write operations (POST, DELETE) per user
		if (
			(req.method === "POST" || req.method === "DELETE") &&
			writeRateLimited(userId)
		) {
			return rateLimitResponse(
				res,
				60,
				"Too many requests. Please try again later.",
			);
		}

		// P0 SECURITY FIX: Verify caller identity — prevent reading/other-user's notifications
		if (req.method === "GET" || req.method === "DELETE") {
			const caller = await verifyCallerIdentity(req, res, userId);
			if (!caller.ok)
				return res.status(caller.status).json({ error: caller.error });
		}

		// Writes require the feed owner to be a valid, non-banned, non-suspended user
		if (req.method === "POST" || req.method === "DELETE") {
			const gate = await checkUser(userId);
			if (!gate.ok) return res.status(403).json({ error: gate.error });
		}

		// GET: fetch notifications
		if (req.method === "GET") {
			const { data } = await supabase
				.from("settings")
				.select("value")
				.eq("key", notificationKey(userId))
				.maybeSingle();
			const notifications = data?.value?.notifications || [];
			const unread = notifications.filter((n) => !n.read).length;
			return res
				.status(200)
				.json({
					notifications,
					unread_count: unread,
					total: notifications.length,
				});
		}

		// POST: create notification
		if (req.method === "POST") {
			const b = req.body || {};
			if (b.notification_id) {
				// Mark as read
				const { data } = await supabase
					.from("settings")
					.select("value")
					.eq("key", notificationKey(userId))
					.maybeSingle();
				const notifications = (data?.value?.notifications || []).map((n) =>
					n.id === b.notification_id
						? { ...n, read: true, read_at: new Date().toISOString() }
						: n,
				);
				await supabase
					.from("settings")
					.upsert(
						{
							key: notificationKey(userId),
							value: { notifications, updated_at: new Date().toISOString() },
						},
						{ onConflict: "key" },
					);
				return res.status(200).json({ success: true });
			}

			// Create new notification (fields sanitized + type whitelisted)
			const notification = {
				id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
				type: TYPES.has(b.type) ? b.type : "info",
				title: clean(b.title, 200) || "Notification",
				body: clean(b.body, 1000),
				post_id: clean(b.post_id, 40) || null,
				read: false,
				created_at: new Date().toISOString(),
			};

			const { data } = await supabase
				.from("settings")
				.select("value")
				.eq("key", notificationKey(userId))
				.maybeSingle();
			const notifications = data?.value?.notifications || [];
			notifications.unshift(notification);
			// Keep max 100 notifications
			const trimmed = notifications.slice(0, 100);

			await supabase
				.from("settings")
				.upsert(
					{
						key: notificationKey(userId),
						value: {
							notifications: trimmed,
							updated_at: new Date().toISOString(),
						},
					},
					{ onConflict: "key" },
				);

			return res.status(201).json(notification);
		}

		// DELETE: clear all
		if (req.method === "DELETE") {
			await supabase
				.from("settings")
				.upsert(
					{
						key: notificationKey(userId),
						value: { notifications: [], updated_at: new Date().toISOString() },
					},
					{ onConflict: "key" },
				);
			return res.status(200).json({ success: true, cleared: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "notifications");
	}
}
