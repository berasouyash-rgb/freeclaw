// Anonymous comments with nested replies

import { isTestArtifact } from "./_artifact-filter.js";
import {
	auditLog,
	checkUser,
	clean,
	cors,
	ensureUser,
	isAdmin,
	maskProfanity,
	rateLimited,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";
import { serverModerate } from "./_moderation.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			const {
				post_id,
				all,
				author,
				viewer,
				cursor,
				limit: limitParam,
				paginate,
			} = req.query;
			const admin = all === "1" ? await isAdmin(req) : false;
			// Private-post guard: comments on a private post are visible only to
			// its author and admins — mirrors the posts visibility model.
			let privatePostOwner = null;
			if (post_id && !admin) {
				const { data: prow } = await supabase
					.from("posts")
					.select("id,visibility,author_id")
					.eq("id", post_id)
					.maybeSingle();
				if (prow?.visibility === "private") privatePostOwner = prow.author_id;
			}
			const isPaginated = paginate === "1" || paginate === "true";
			const PAGE_LIMIT = Math.min(parseInt(limitParam) || 30, 100);

			// Cache headers for public reads
			if (!admin && !viewer) {
				res.setHeader(
					"Cache-Control",
					"public, max-age=0, no-cache, s-maxage=10, stale-while-revalidate=10",
				);
			} else {
				res.setHeader("Cache-Control", "private, no-cache");
			}

			let q = supabase
				.from("comments")
				.select("*")
				.order("created_at", { ascending: false });
			if (post_id) q = q.eq("post_id", post_id);
			if (author) q = q.eq("author_id", clean(author, 40));
			// Public listings exclude hidden AND soft-deleted comments
			if (!admin) q = q.eq("hidden", false).eq("deleted", false);

			// Support cursor pagination for ALL query types (post_id, author, general)
			// The artifact filter runs in JS AFTER this SQL limit, so fetch a wide
			// window — otherwise fuzz comments filling the newest rows would starve
			// real comments out of the response.
			if (isPaginated) {
				if (cursor) q = q.lt("created_at", cursor);
				q = q.limit(2000);
			} else {
				q = q.limit(2000);
			}
			const { data, error } = await q;
			if (error) throw error;

			// Full-site zero-fuzz: hide test/fuzz comment bodies on every surface,
			// admin included (mirrors _search.js, which already filters comment
			// bodies). Rows stay intact in the DB; they are only hidden.
			const cleanRows = (data || []).filter((c) => !isTestArtifact(c.body));

			// Strangers may not read comments on a private post (owner can).
			if (
				privatePostOwner !== null &&
				clean(viewer, 40) !== privatePostOwner
			)
				return res.status(403).json({ error: "Not authorized" });

			if (isPaginated) {
				const rows = cleanRows;
				const hasMore = rows.length > PAGE_LIMIT;
				const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
				const nextCursor = hasMore
					? sliced[sliced.length - 1]?.created_at
					: null;
				const v = clean(viewer, 40);
				const masked = (sliced || []).map((c) => {
					const is_mine = !!v && c.author_id === v;
					return {
						...c,
						is_mine,
						author_id:
							admin || is_mine || c.author_id === "ADMIN"
								? c.author_id
								: c.author_id.slice(0, 9) + "...",
					};
				});
				let totalQ = supabase
					.from("comments")
					.select("id", { count: "exact", head: true });
				if (post_id) totalQ = totalQ.eq("post_id", post_id);
				if (!admin) totalQ = totalQ.eq("hidden", false).eq("deleted", false);
				const { count } = await totalQ;
				return res
					.status(200)
					.json({ data: masked, nextCursor, total: count || 0 });
			}

			const v = clean(viewer, 40);
			const masked = cleanRows.slice(0, 500).map((c) => {
				const is_mine = !!v && c.author_id === v;
				return {
					...c,
					is_mine,
					author_id:
						admin || is_mine || c.author_id === "ADMIN"
							? c.author_id
							: c.author_id.slice(0, 9) + "...",
				};
			});
			return res.status(200).json(masked);
		}

		if (req.method === "POST") {
			const b = req.body || {};
			// P0 SECURITY FIX: Derive author_id from x-anon-id header, NOT from client body
			const headerId = clean(req.headers["x-anon-id"] || "", 40);
			const is_admin_msg = b.is_admin === true && (await isAdmin(req));
			const author_id = headerId || (is_admin_msg ? "ADMIN" : "");
			if (!author_id)
				return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });
			if (!is_admin_msg) {
				const gate = await checkUser(author_id);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				if (await rateLimited("comments", author_id, 30, 5)) {
					return rateLimitResponse(
						res,
						30,
						"Too many comments — please wait a moment.",
					);
				}
			}
			const body = maskProfanity(clean(b.body, 500));
			if (body.length < 2)
				return res.status(400).json({ error: "Comment is too short." });
			// Server-side PII/safety gate — comments can leak addresses, phones, emails too.
			if (!is_admin_msg) {
				const mod = serverModerate("", body);
				// Weak privacy signals (room-level addresses, PIN codes) also block
				// comments — unlike posts they have no pending_review queue to hold them.
				if (mod.blocked || mod.flags.some((f) => f.type === "privacy_weak")) {
					const isPII = mod.flags.some(
						(f) => f.type === "privacy" || f.type === "privacy_weak",
					);
					await auditLog(
						"moderation",
						"comment_blocked",
						`${author_id}: ${body.slice(0, 60)} [${mod.flags.map((f) => f.type).join(", ")}]`,
					);
					return res.status(403).json({
						error: isPII
							? "Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details."
							: "This comment violates our safety guidelines and cannot be posted.",
						code: isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED",
					});
				}
			}
			// Respect locked posts + private-post ownership in ONE lookup
			const { data: post } = await supabase
				.from("posts")
				.select("locked,visibility,author_id")
				.eq("id", b.post_id)
				.maybeSingle();
			if (post?.locked && !is_admin_msg)
				return res
					.status(403)
					.json({ error: "Comments are locked on this post." });
			// Private posts accept comments only from their author (admins exempt)
			if (
				post?.visibility === "private" &&
				!is_admin_msg &&
				post.author_id !== author_id
			)
				return res.status(403).json({ error: "Not authorized" });
			const row = {
				id: `cmt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
				post_id: clean(b.post_id, 60),
				parent_id: b.parent_id ? clean(b.parent_id, 60) : null,
				author_id: is_admin_msg ? "ADMIN" : author_id,
				body,
				is_admin: !!is_admin_msg,
			};
			const { data, error } = await supabase
				.from("comments")
				.insert(row)
				.select()
				.single();
			if (error) throw error;
			if (!is_admin_msg) await ensureUser(author_id);
			// Activity resets the auto-deletion countdown on solved/archived posts
			await supabase
				.from("posts")
				.update({ updated_at: new Date().toISOString() })
				.eq("id", row.post_id);
			// Emit event for event-triggered agents
			emitEventAndBridge(EVENT_TYPES.COMMENT_CREATED, {
				comment_id: data.id,
				post_id: row.post_id,
				author_id: row.author_id,
			}).catch(() => {});
			return res.status(201).json(data);
		}

		if (req.method === "PUT") {
			const b = req.body || {};
			const { data: cmt } = await supabase
				.from("comments")
				.select("*")
				.eq("id", b.id)
				.maybeSingle();
			if (!cmt) return res.status(404).json({ error: "Comment not found" });
			const admin = await isAdmin(req);
			// 'ADMIN' comments may only be edited by verified admins — a plain user
			// could otherwise spoof author_id='ADMIN' (a public constant) to edit them.
			// P0 SECURITY FIX: Derive caller identity from x-anon-id header, not client body
			const callerId = clean(req.headers["x-anon-id"] || "", 40);
			const isOwner =
				callerId && callerId !== "ADMIN" && callerId === cmt.author_id;
			if (!isOwner && !admin)
				return res.status(403).json({ error: "Not authorized" });
			const patch = {};
			if (b.body !== undefined) {
				patch.body = maskProfanity(clean(b.body, 500));
				patch.edited = true;
			}
			// Re-moderate edited comments — never let PII leak through an edit either.
			if (patch.body !== undefined) {
				const mod = serverModerate("", patch.body);
				if (mod.blocked || mod.flags.some((f) => f.type === "privacy_weak")) {
					const isPII = mod.flags.some(
						(f) => f.type === "privacy" || f.type === "privacy_weak",
					);
					return res.status(403).json({
						error: isPII
							? "Personal information detected in your edit (address, phone, or email). This is an anonymous platform — please remove personal details."
							: "This edit violates our safety guidelines and cannot be saved.",
						code: isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED",
					});
				}
			}
			if (typeof b.deleted === "boolean") patch.deleted = b.deleted;
			if (admin && typeof b.hidden === "boolean") patch.hidden = b.hidden;
			const { data, error } = await supabase
				.from("comments")
				.update(patch)
				.eq("id", b.id)
				.select()
				.single();
			if (error) throw error;
			if (admin && !isOwner) await auditLog("admin", "moderate_comment", b.id);
			return res.status(200).json(data);
		}

		if (req.method === "DELETE") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const id = req.body?.id || req.query?.id;
			if (!id) return res.status(400).json({ error: "Missing id" });
			const { error } = await supabase.from("comments").delete().eq("id", id);
			if (error) throw error;
			await auditLog("admin", "hard_delete_comment", String(id));
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "comments");
	}
}
