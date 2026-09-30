// Pre-Publish Review Queue — admin endpoint for high-risk content awaiting review.
//
// GET  /api/pre-review            → list pending review items
// POST /api/pre-review            → take action on a review item
//   { key, action: 'approve'|'reject'|'keep_private'|'ban' }
//
// NOTE: the actual route mount is /api/pre-review (see routes table in
// _index.js). /api/pre-publish is a DIFFERENT endpoint (the submission-side
// AI scan) and is POST-only.

import { auditLog, cors, isAdmin, notifyUser } from "./_auth.js";
import supabase from "./_db-client.js";
import { logger } from "./_observability.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	if (!(await isAdmin(req))) {
		console.warn(
			"[pre-review] Auth rejected — token missing or expired. Header:",
			req.headers["x-admin-token"] ? "present" : "MISSING",
		);
		return res.status(403).json({ error: "Admin only" });
	}

	if (req.method === "GET") {
		try {
			const { data, error } = await supabase
				.from("settings")
				.select("key, value")
				.like("key", "pre_publish_review:%")
				.order("key", { ascending: false });

			if (error) {
				console.error("[pre-review] Supabase query error:", error.message);
				return res.status(500).json({ error: "Failed to query review queue" });
			}

			const items = (data || [])
				// Kept-private submissions remain durable for author/audit recovery,
				// but they are no longer actionable review-queue work.
				.filter((row) => row.value?.status !== "kept_private")
				.map((row) => ({
					key: row.key,
					...row.value,
				}));

			logger.info("pre-review", `Returning ${items.length} review items`);
			return res.status(200).json({ items, total: items.length });
		} catch (err) {
			console.error("review-queue GET error:", err);
			return res.status(500).json({ error: "Failed to load review queue" });
		}
	}

	if (req.method === "POST") {
		const { key, action } = req.body || {};
		if (!key || !action)
			return res.status(400).json({ error: "key and action required" });

		const validActions = ["approve", "reject", "keep_private", "ban"];
		if (!validActions.includes(action)) {
			return res
				.status(400)
				.json({ error: `action must be one of: ${validActions.join(", ")}` });
		}

		try {
			// Get the review item
			const { data: row } = await supabase
				.from("settings")
				.select("value")
				.eq("key", key)
				.maybeSingle();

			if (!row) return res.status(404).json({ error: "Review item not found" });

			const item = row.value;

			if (action === "approve") {
				// Create the post from the review item — include ALL required columns
				// (posts.id is a generated string id; missing fields broke the insert).
				const postId = `post_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
				const now = new Date().toISOString();
				const postData = {
					id: postId,
					type:
						item.content_type === "poll"
							? "suggestion"
							: item.content_type || "problem",
					title: String(item.title || "Untitled").slice(0, 120),
					description: String(item.description || item.body || "").slice(
						0,
						500,
					),
					category: item.category || "Other",
					priority: ["low", "medium", "high", "critical"].includes(
						item.priority,
					)
						? item.priority
						: "medium",
					author_id: item.author_id || "anonymous",
					status: "reported",
					progress: 5,
					image_url: item.image_url || null,
					tags: [],
					deleted: false,
					hidden: false,
					status_history: [
						{
							status: "reported",
							at: now,
							note: "Approved by admin from pre-publish review queue",
						},
					],
				};
				const { error: postErr } = await supabase
					.from("posts")
					.insert(postData);
				if (postErr) throw postErr;
				await auditLog(
					item.author_id || "anonymous",
					"pre_publish_approved",
					`Admin approved high-risk content from review queue`,
					"admin",
				);
				await notifyUser(
					item.author_id,
					"info",
					"Your voice was published",
					`"${String(item.title || "").slice(0, 60)}" was approved by the review team and is now public.`,
				);
			} else if (action === "reject") {
				await auditLog(
					item.author_id || "anonymous",
					"pre_publish_rejected",
					`Admin rejected high-risk content`,
					"admin",
				);
				await notifyUser(
					item.author_id,
					"info",
					"Content not published",
					`"${String(item.title || "").slice(0, 60)}" was held back by the review team. You can revise and resubmit it.`,
				);
			} else if (action === "keep_private") {
				// Keep the author's content as a real private post. The old path
				// updated the queue row and then deleted it immediately, which
				// destroyed the only durable copy while telling the author it was
				// still available. A private post gives My Activity a truthful,
				// author-only record and keeps the item out of the public feed.
				const postId = `private_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
				const now = new Date().toISOString();
				const { error: keepErr } = await supabase.from("posts").insert({
					id: postId,
					type:
						item.content_type === "poll"
							? "suggestion"
							: item.content_type || "problem",
					title: String(item.title || "Untitled").slice(0, 120),
					description: String(item.description || item.body || "").slice(0, 500),
					category: item.category || "Other",
					priority: ["low", "medium", "high", "critical"].includes(item.priority)
						? item.priority
						: "medium",
					author_id: item.author_id || "anonymous",
					status: "reported",
					progress: 5,
					image_url: item.image_url || null,
					tags: [],
					deleted: false,
					hidden: false,
					visibility: "private",
					status_history: [
						{
							status: "reported",
							at: now,
							note: "Kept private by admin from pre-publish review",
						},
					],
				});
				if (keepErr) throw keepErr;
				const { error: keepQueueErr } = await supabase
					.from("settings")
					.update({
						value: {
							...item,
							status: "kept_private",
							reviewed_by: "admin",
							reviewed_at: now,
							private_post_id: postId,
						},
					})
					.eq("key", key);
				if (keepQueueErr) throw keepQueueErr;
				await auditLog(
					item.author_id || "anonymous",
					"pre_publish_kept_private",
					`Admin kept content private as post ${postId}`,
					"admin",
				);
				await notifyUser(
					item.author_id,
					"info",
					"Content kept private",
					`"${String(item.title || "").slice(0, 60)}" is now a private post in My Activity. You can revise and resubmit it.`,
				);
				return res.status(200).json({ ok: true, action, key, post_id: postId });
			} else if (action === "ban") {
				// FIX #18: Require explicit confirmation token for instant-ban (prevents accidental/ CSRF-triggered bans)
				const body = req.body || {};
				if (body.confirm !== true && body.confirm !== "true" && body.confirmToken !== item.author_id) {
					return res.status(400).json({ error: "Ban requires confirmation: pass { confirm: true } or { confirmToken: author_id }", code: "CONFIRM_REQUIRED" });
				}
				// Ban the author (append warning so the user sees a strike popup too)
				if (!item.author_id || item.author_id === "anonymous") {
					return res
						.status(400)
						.json({ error: "No author_id on this item — cannot ban" });
				}
				const { data: existing } = await supabase
					.from("users_meta")
					.select("*")
					.eq("anon_id", item.author_id)
					.maybeSingle();
				const warnings = Array.isArray(existing?.warnings)
					? existing.warnings
					: [];
				warnings.push({
					text: "Banned from the review queue for high-risk content",
					at: new Date().toISOString(),
				});
				const { error: banErr } = await supabase.from("users_meta").upsert(
					{
						anon_id: item.author_id,
						banned: true,
						strikes: (existing?.strikes || 0) + 1,
						warnings,
						last_seen: new Date().toISOString(),
					},
					{ onConflict: "anon_id" },
				);
				// The ban is the whole point of this action — if it fails, surface the
				// error and KEEP the item in the queue so the ban is never silently lost.
				if (banErr) throw banErr;
				await auditLog(
					item.author_id || "anonymous",
					"pre_publish_banned",
					`Admin banned user for high-risk content`,
					"admin",
				);
				// Immediate popup: notify now, don't wait for the user's next heartbeat.
				await notifyUser(
					item.author_id,
					"warning",
					"Account permanently banned",
					"Your anonymous ID has been permanently banned from posting after a review.",
				);
			}

			// Remove from review queue. Log-only on failure: the action above already
			// committed, so a 500 here would make the admin UI retry and duplicate
			// the work (e.g. a second approved post).
			const { error: delErr } = await supabase
				.from("settings")
				.delete()
				.eq("key", key);
			if (delErr) {
				console.error(
					"[pre-review] Action succeeded but queue item could not be removed:",
					delErr.message,
				);
			}

			return res.status(200).json({ ok: true, action, key });
		} catch (err) {
			console.error("review-queue POST error:", err);
			return res.status(500).json({ error: "Failed to process review action" });
		}
	}

	return res.status(405).json({ error: "GET or POST only" });
}
