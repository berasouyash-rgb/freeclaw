// Notification channel preferences — phone + email for SMS/email alerts.
// GET  /api/notify-prefs?user_id=X → { phone, email, sms_enabled, email_enabled, ai_chat_enabled }
// POST /api/notify-prefs { user_id, phone, email, sms_enabled, email_enabled, ai_chat_enabled }
//
// Stored in the settings table under `notify_prefs:<anonId>` as
// { phone, email, sms_enabled, email_enabled, ai_chat_enabled, updated_at } —
// the same KV pattern as follows/notifications. Consumed by _follows.js when a
// followed post is solved/updated: enabled + valid phone → SMS, enabled +
// valid email → email (via api/_dispatch.js). ai_chat_enabled gates the
// inbox AI auto-reply in _inbox.js. Reading prefs is public; writes require
// a valid, non-banned, non-suspended user (same gate as _posts.js).

import { checkUser, clean, cors, rateLimitResponse } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { normalizePhone, validEmail } from "./_dispatch.js";

const PREFIX = "notify_prefs:";

function prefsKey(userId) {
	return `${PREFIX}${userId}`;
}

// Same anon-id rule as _notifications.js — rejects settings-key injection.
function validAnonId(id) {
	return (
		typeof id === "string" &&
		id.length >= 5 &&
		id.length <= 40 &&
		/^anon_[a-z0-9]+$/.test(id)
	);
}

// Read prefs for a user (also used by _follows.js). Never throws.
export async function getNotifyPrefs(userId) {
	if (!validAnonId(userId)) return null;
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", prefsKey(userId))
			.maybeSingle();
		const v = data?.value || {};
		return {
			phone: typeof v.phone === "string" ? v.phone : "",
			email: typeof v.email === "string" ? v.email : "",
			sms_enabled: v.sms_enabled !== false,
			email_enabled: v.email_enabled !== false,
			// Inbox AI auto-replies — user-controllable, default ON.
			ai_chat_enabled: v.ai_chat_enabled !== false,
			// Status-change notifications (solved/in-progress/admin reply) — default ON.
			status_updates: v.status_updates !== false,
		};
	} catch (err) {
		console.warn("[notify-prefs] getNotifyPrefs failed:", err.message);
		return null;
	}
}

// Simple in-memory per-user rate limiter for writes.
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

		// GET: read prefs (public, like _me.js)
		if (req.method === "GET") {
			const prefs = await getNotifyPrefs(userId);
			return res.status(200).json(prefs || {});
		}

		// POST: save prefs
		if (req.method === "POST") {
			if (writeRateLimited(userId))
				return rateLimitResponse(
					res,
					60,
					"Too many requests. Please try again later.",
				);
			const gate = await checkUser(userId);
			if (!gate.ok) return res.status(403).json({ error: gate.error });

			const b = req.body || {};
			const phone = clean(b.phone, 20);
			const email = clean(b.email, 120);
			const errors = [];
			if (phone) {
				const n = normalizePhone(phone);
				if (!n) errors.push("Enter a valid phone number (8–15 digits, e.g. +15551234567)");
			}
			if (email && !validEmail(email)) errors.push("Enter a valid email address");
			if (errors.length) return res.status(400).json({ error: errors[0] });

			const value = {
				phone: phone ? normalizePhone(phone) : "",
				email: email ? email.trim() : "",
				sms_enabled: b.sms_enabled !== false,
				email_enabled: b.email_enabled !== false,
				ai_chat_enabled: b.ai_chat_enabled !== false,
				status_updates: b.status_updates !== false,
				updated_at: new Date().toISOString(),
			};
			await supabase
				.from("settings")
				.upsert({ key: prefsKey(userId), value }, { onConflict: "key" });
			return res.status(200).json(value);
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "notify-prefs");
	}
}
