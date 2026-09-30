// Saved Posts — server-persisted bookmarks tied to the anonymous user id.
// GET    /api/saved?user_id=X                          → { saved: [...ids], count }
// POST   /api/saved { user_id, post_id }               → add (isSaved: true)
// POST   /api/saved { user_id, post_id, saved:false }  → remove
// DELETE /api/saved?user_id=X&post_id=Y                → remove
//
// Persists in the settings table under key `saved:${userId}` as
// { saved: [postId, ...] } — the same storage pattern as follows/notifications.

import { clean, cors, rateLimitResponse, verifyCallerIdentity } from "./_auth.js";
import supabase from "./_db-client.js";

function savedKey(userId) {
	return `saved:${userId}`;
}

const SAVED_LIMIT = 200;

// Simple in-memory per-user rate limiter for write operations
const writeHits = new Map();
function writeRateLimited(userId, windowMs = 60000, limit = 30) {
	const now = Date.now();
	const entry = writeHits.get(userId);
	if (!entry || now - entry.start > windowMs) {
		writeHits.set(userId, { start: now, count: 1 });
		return false;
	}
	entry.count++;
	return entry.count > limit;
}

export async function getSaved(userId) {
	if (!userId) return [];
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", savedKey(userId))
		.maybeSingle();
	return (data?.value?.saved || []).filter(Boolean);
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
			const saved = await getSaved(userId);
			return res.status(200).json({ saved, count: saved.length });
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
			const saved = (await getSaved(userId)).filter((p) => p !== postId);
			await supabase
				.from("settings")
				.upsert(
					{
						key: savedKey(userId),
						value: { saved, updated_at: new Date().toISOString() },
					},
					{ onConflict: "key" },
				);
			return res.status(200).json({ success: true, isSaved: false, saved });
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
			const isSaving = b.saved === false ? false : true;
			const current = await getSaved(userId);
			const saved = isSaving
				? current.includes(postId)
					? current
					: [...current, postId].slice(0, SAVED_LIMIT)
				: current.filter((p) => p !== postId);
			await supabase
				.from("settings")
				.upsert(
					{
						key: savedKey(userId),
						value: { saved, updated_at: new Date().toISOString() },
					},
					{ onConflict: "key" },
				);
			return res.status(200).json({ success: true, isSaved: isSaving, saved });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		console.error("saved error:", err.message);
		return res.status(500).json({ error: "Internal error" });
	}
}
