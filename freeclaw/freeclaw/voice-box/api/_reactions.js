// Reaction toggles — positive-only voting (Support on problems, Upvote on ideas).
// One vote per anonymous browser per item; tapping again removes it.

import { checkUser, clean, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

// Normalize legacy/synonym kinds from older cached clients so nobody
// ever gets an "invalid reaction" error.
const NORMALIZE = {
	support: "support",
	like: "support",
	important: "support",
	urgent: "support",
	disagree: "disagree",
	dislike: "disagree",
	unsupport: "disagree",
	unsupported: "disagree",
	upvote: "upvote",
	// Nuanced emotional reactions
	concerned: "concerned",
	frustrated: "frustrated",
	appreciate: "appreciate",
};
const OPPOSITES = {}; // no opposing kinds — voting is positive-only

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			const { author, target, viewer } = req.query;
			const admin = await isAdmin(req);
			let q = supabase.from("reactions").select("*");
			if (author) q = q.eq("author_id", author);
			if (target) q = q.eq("target_id", target);
			const { data, error } = await q.limit(1000);
			if (error) throw error;
			// Author IDs are bearer tokens for post/comment owner actions — mask them
			// for everyone except the row owner and verified admins.
			const v = clean(viewer, 40);
			const masked = (data || []).map((r) => {
				const is_mine = !!v && r.author_id === v;
				return {
					...r,
					is_mine,
					author_id:
						admin || is_mine ? r.author_id : r.author_id.slice(0, 9) + "...",
				};
			});
			// Viewer-scoped data (per-?author rows with is_mine) must never be served
			// from a shared browser/CDN cache: a cached pre-toggle response re-applied
			// reactions the user just removed. Revalidate every request like /api/posts.
			res.setHeader("Cache-Control", "private, no-cache");
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
			const kind = NORMALIZE[b.kind] || null;
			const target_id = clean(b.target_id, 60);
			const target_type = ["post", "comment", "suggestion"].includes(
				b.target_type,
			)
				? b.target_type
				: "post";
			if (!kind || !target_id)
				return res.status(400).json({ error: "Invalid reaction" });
			const gate = await checkUser(author_id);
			if (!gate.ok) return res.status(403).json({ error: gate.error });

			// Toggle in one shot: DELETE returns the removed row if it existed.
			// If nothing was removed we insert (toggle ON). This avoids the extra
			// pre-SELECT roundtrip the old check-then-delete/insert flow needed.
			const { data: removed, error: delError } = await supabase
				.from("reactions")
				.delete()
				.eq("target_id", target_id)
				.eq("author_id", author_id)
				.eq("kind", kind)
				.select("id");
			if (delError) throw delError;
			const toggled = !removed || removed.length === 0; // true → insert (now active)
			if (toggled) {
				const { error: insError } = await supabase
					.from("reactions")
					.insert({ target_id, target_type, author_id, kind });
				if (insError) throw insError;
			}

			// Fresh counts AND the caller's own reactions in ONE query; the activity
			// bump runs in parallel (different table, independent of the counts).
			const counts = {};
			const mine = [];
			try {
				const [{ data: rows }] = await Promise.all([
					supabase
						.from("reactions")
						.select("kind, author_id")
						.eq("target_id", target_id),
					target_type === "post" || target_type === "suggestion"
						? supabase
								.from("posts")
								.update({ updated_at: new Date().toISOString() })
								.eq("id", target_id)
						: Promise.resolve({ data: null, error: null }),
				]);
				(rows || []).forEach((r) => {
					counts[r.kind] = (counts[r.kind] || 0) + 1;
					if (r.author_id === author_id) mine.push(r.kind);
				});
			} catch (countErr) {
				console.error("reactions count query error:", countErr);
				// Still return success — the toggle itself worked
			}
			return res.status(200).json({ toggled, counts, mine });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "reactions");
	}
}
