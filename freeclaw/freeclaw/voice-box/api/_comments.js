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
	verifyCallerIdentity,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { invalidateCounts } from "./_counts.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";
import { recordSafetyRepost, checkSafetyRepost, alertAdminThreat } from "./_moderation.js";
import { evaluateContentDeep } from "./_safety-pipeline.js";
import { strikeSlangAbuse } from "./_reports.js";

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
			// Public listings exclude hidden AND soft-deleted comments. When a
			// viewer identifies themselves, the hidden filter moves into the JS
			// self-view filter below so the author's OWN hidden row can still be
			// returned — a moderation hide must not vanish from their thread with
			// no explanation (posts solved the same hole with isSelfView).
			// Soft-deleted rows stay DB-excluded either way.
			const selfId = clean(viewer, 40);
			if (!admin) {
				q = q.eq("deleted", false);
				if (!selfId) q = q.eq("hidden", false);
			}

			// Support cursor pagination for ALL query types (post_id, author, general)
			// The artifact filter runs in JS AFTER this SQL limit, so the scan
			// needs headroom over the page size — otherwise fuzz comments filling
			// the newest rows would starve real comments out of the response.
			// But a flat 2000-row scan for a 20-comment page is pure transfer
			// latency, so scale the window to the page and keep the historic
			// ceiling only for the unpaginated read (which slices to 500).
			const scanLimit = isPaginated
				? Math.min(2000, Math.max(PAGE_LIMIT * 4 + 100, 200))
				: 2000;
			if (isPaginated && cursor) q = q.lt("created_at", cursor);
			q = q.limit(scanLimit);

			// The private-post guard, the rows themselves, and the honest total
			// are three INDEPENDENT reads. Run sequentially they cost three remote
			// round-trips — measured at ~684ms p50 for a thread that usually holds
			// a handful of comments — so fire them together and pay for one.
			const guardP =
				post_id && !admin
					? supabase
							.from("posts")
							.select("id,visibility,author_id")
							.eq("id", post_id)
							.maybeSingle()
					: Promise.resolve({ data: null });

			let totalP = Promise.resolve({ count: null });
			if (isPaginated) {
				let totalQ = supabase
					.from("comments")
					.select("id", { count: "exact", head: true });
				if (post_id) totalQ = totalQ.eq("post_id", post_id);
				if (!admin) totalQ = totalQ.eq("hidden", false).eq("deleted", false);
				totalP = totalQ;
			}

			const [{ data, error }, guardRes, totalRes] = await Promise.all([
				q,
				guardP,
				totalP,
			]);
			if (error) throw error;

			// Private-post guard: comments on a private post are visible only to
			// its author and admins — mirrors the posts visibility model.
			const privatePostOwner =
				guardRes?.data?.visibility === "private"
					? guardRes.data.author_id
					: null;

			// Full-site zero-fuzz: hide test/fuzz comment bodies on every surface,
			// admin included (mirrors _search.js, which already filters comment
			// bodies). Rows stay intact in the DB; they are only hidden.
			let cleanRows = (data || []).filter((c) => !isTestArtifact(c.body));

			// Author self-view: with a viewer present the DB did NOT exclude
			// hidden rows, so drop everyone else's here — server-side, before
			// any response. Only the viewer's OWN hidden comments survive
			// (flagged `hidden` + `is_mine` for the client to render as held);
			// soft-deleted rows never self-show. The paginated `total` below
			// still counts public rows only, so the honest count never moves.
			if (!admin && selfId) {
				cleanRows = cleanRows.filter(
					(c) => !c.deleted && (!c.hidden || c.author_id === selfId),
				);
			}

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
				const { count } = totalRes || {};
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
			// ── Comment write wall (always on) ───────────────────────
			// Same arithmetic as POST /posts: identity + reads + a full model
			// cap + insert must not sum past the 6000 ms llm-write gate, so the
			// moderation call gets whatever this request has left.
			const COMMENT_WALL_MS = 5400;
			const commentWallStart = performance.now();
			const commentRemainingMs = () =>
				Math.max(0, COMMENT_WALL_MS - (performance.now() - commentWallStart));
			// P0 SECURITY FIX: Derive author_id from x-anon-id header, NOT from client body
			const headerId = clean(req.headers["x-anon-id"] || "", 40);
			const is_admin_msg = b.is_admin === true && (await isAdmin(req));
			const author_id = headerId || (is_admin_msg ? "ADMIN" : "");
			if (!author_id)
				return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });
			// Session binding: the header claim must match a live session.
			// Header-only auth let anyone knowing an id comment as them.
			if (!is_admin_msg) {
				const caller = await verifyCallerIdentity(req, res, author_id);
				if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
			}
			if (!is_admin_msg) {
				const gate = await checkUser(author_id, "comment_write");
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				const commentWait = await rateLimited("comments", author_id, 30, 5);
				if (commentWait) {
					return rateLimitResponse(
						res,
						commentWait,
						"Too many comments — please wait a moment.",
					);
				}
			}
			// Moderate the RAW text and store the masked text: masking first
			// would blind serverModerate (a masked slur no longer matches
			// SLURS and would publish instead of blocking).
			const rawBody = clean(b.body, 500);
			if (rawBody.length < 2)
				return res.status(400).json({ error: "Comment is too short." });
			// Safety repost guard (see _posts.js): a fingerprint match means
			// "this looks like text removed before" — not a fresh violation.
			// Don't hard-block; hold for a human instead so legitimate
			// resubmission still gets reviewed. The moderation pipeline below
			// keeps blocking genuinely harmful content on its own merits.
			let repostHold = false;
			const repost = await checkSafetyRepost(supabase, rawBody);
			if (repost.blocked) {
				repostHold = true;
				await auditLog(
					"moderation",
					"comment_repost_held",
					`${author_id}: ${rawBody.slice(0, 60)} [rule=${repost.rule} attempts=${repost.attempts}]`,
				);
			}
			// Server-side PII/safety gate — verdict from the unified safety
			// pipeline (same blocked set the old inline check computed).
			let autoQueueForReview = false;
			let autoReviewReason = "";
			if (!is_admin_msg) {
				const decision = await evaluateContentDeep(rawBody, "direct", null, {
					taskKey: "comments.write",
					timeoutMs: commentRemainingMs(),
				});
				if (decision.blocked) {
					const isPII = decision.flags.some(
						(f) => f.type === "privacy" || f.type === "privacy_weak",
					);
					const isSevereThreat = decision.flags.some(
						(f) => f.type === "threat" || f.type === "suicide" || f.type === "crisis",
					);
					if (isSevereThreat) {
						await Promise.allSettled([
							alertAdminThreat({
								surface: "comment",
								authorId: author_id,
								excerpt: rawBody,
								flags: decision.flags,
							}),
							strikeSlangAbuse(author_id, "comment_threat", rawBody),
							typeof supabase?.from?.("reports")?.insert === "function"
								? supabase.from("reports").insert({
										target_id: b.post_id || "unknown",
										target_type: "post",
										reason: `[Threat Protection] Comment threat: ${decision.flags.map((f) => f.type).join(", ")}`,
										details: `Student ${author_id} blocked for threat in comment: "${rawBody.slice(0, 300)}"`,
										status: "pending",
										author_id: author_id,
									})
								: Promise.resolve(),
							auditLog(
								"moderation",
								"comment_threat_blocked",
								`${author_id}: ${rawBody.slice(0, 60)} [${decision.flags.map((f) => f.type).join(", ")}]`,
							),
						]);
						return res.status(403).json({
							error: decision.message || "Threatening or violent content is strictly prohibited.",
							code: decision.code || "THREAT_BLOCKED",
						});
					}
					// Strictly block PII leaks to protect student anonymity
					if (isPII) {
						await auditLog(
							"moderation",
							"comment_blocked",
							`${author_id}: ${rawBody.slice(0, 60)}`,
						);
						return res.status(403).json({
							error: "Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
							code: "PII_BLOCKED",
						});
					}
					const isSlangOnly =
						decision.flags.length > 0 &&
						decision.flags.every((f) => f.type === "profanity" || f.type === "slang");
					if (!isSlangOnly) {
						await auditLog(
							"moderation",
							"comment_blocked",
							`${author_id}: ${rawBody.slice(0, 60)} [${decision.flags.map((f) => f.type).join(", ")}]`,
						);
						return res.status(403).json({
							error: decision.message,
							code: decision.code || "CONTENT_BLOCKED",
						});
					}
					// For slang/profanity: mask profanity, post comment,
					// and queue to Reports for moderator review
					autoQueueForReview = true;
					autoReviewReason = decision.flags.map((f) => f.type).join(", ") || "content review";
					await auditLog(
						"moderation",
						"comment_flagged_for_review",
						`${author_id}: ${rawBody.slice(0, 60)} [${autoReviewReason}]`,
					);
					if (decision.flags.some((f) => f.type === "profanity" || f.type === "slang")) {
						await strikeSlangAbuse(author_id, "comment", rawBody);
					}
				}
			}
			// Store the masked text; every gate above already ran on the raw text.
			const body = maskProfanity(rawBody);
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
			// Idempotent submit (mirrors the posts 90s twin rule): double-tap
			// past the client cooldown, retry-after-timeout, and offline-queue
			// flush can deliver the same comment twice with both copies passing
			// moderation. Same author + same post + same thread (parent_id) +
			// exact normalized body within 90s returns the original row
			// (200 + deduped:true) instead of a visible twin. Deleted/hidden
			// twins are skipped (a fresh repost after delete is legitimate);
			// empty normalized bodies never match.
			const normalizeCommentBody = (s) =>
				String(s || "")
					.toLowerCase()
					.replace(/[^a-z0-9\s]/g, "")
					.replace(/\s+/g, " ")
					.trim();
			const normalizedBody = normalizeCommentBody(body);
			const CTWIN_MS = 90000;
			const twinCutoff = Date.now() - CTWIN_MS;
			const parentKey = b.parent_id ? clean(b.parent_id, 60) : null;
			const { data: recentComments } = await supabase
				.from("comments")
				.select("id,post_id,parent_id,body,created_at,deleted,hidden")
				.eq("author_id", author_id)
				.eq("post_id", clean(b.post_id, 60))
				.gte("created_at", new Date(twinCutoff).toISOString())
				.order("created_at", { ascending: false })
				.limit(10);
			const twin = (recentComments || []).find(
				(c) =>
					!c.deleted &&
					!c.hidden &&
					(c.parent_id || null) === parentKey &&
					Number(Date.parse(c.created_at || 0)) > twinCutoff &&
					normalizeCommentBody(c.body || "") === normalizedBody &&
					normalizedBody !== "",
			);
			if (twin) {
				return res.status(200).json({ ...twin, deduped: true });
			}
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
			// A safety-repost hit is queued for a human here (never blocked):
			// the comment publishes, but a moderator decides whether the
			// resurfaced text should stand. Keeps legitimate resubmission alive.
			const queueReason = autoQueueForReview
				? autoReviewReason
				: repostHold
					? "safety repost held for review"
					: "";
			if (queueReason && data?.id) {
				const rIns = supabase.from("reports").insert({
					target_id: data.id,
					target_type: "comment",
					reason: `[Auto-Review] Flagged comment: ${queueReason}`,
					details: rawBody.slice(0, 200),
					status: "pending",
					author_id: author_id,
				});
				if (rIns) {
					Promise.resolve(rIns).catch(() => {});
				}
			}
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
			invalidateCounts(); // comment_count is cached in api/_counts.js
			return res.status(201).json(data);
		}

		if (req.method === "PUT") {
			const b = req.body || {};
			// PUT /comments is gated as interactive (2500 ms), so the edit
			// re-moderation must fit in what this request has left.
			const COMMENT_EDIT_WALL_MS = 2200;
			const commentEditStart = performance.now();
			const commentEditRemainingMs = () =>
				Math.max(0, COMMENT_EDIT_WALL_MS - (performance.now() - commentEditStart));
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
			// Session binding: the header claim must match a live session
			// before ownership is even compared. (Admins bypass inside the
			// gate, like everywhere else.)
			if (!admin) {
				const caller = await verifyCallerIdentity(req, res, callerId || "!");
				if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
			}
			if (!isOwner && !admin)
				return res.status(403).json({ error: "Not authorized" });
			const patch = {};
			if (b.body !== undefined) {
				// Moderate raw, store masked (see POST path above).
				patch.rawBody = clean(b.body, 500);
				patch.edited = true;
			}
			// Re-moderate edited comments — verdict from the unified safety
			// pipeline (same blocked set; edit-specific 403 wording kept).
			if (patch.rawBody !== undefined) {
				const decision = await evaluateContentDeep(patch.rawBody, "direct", null, {
					taskKey: "comments.edit",
					timeoutMs: commentEditRemainingMs(),
				});
				if (decision.blocked) {
					const isPII = decision.flags.some(
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
			// Mask for storage only after the raw text passes moderation.
			// rawBody must never reach the database.
			if (patch.rawBody !== undefined) {
				patch.body = maskProfanity(patch.rawBody);
				delete patch.rawBody;
			}
			if (typeof b.deleted === "boolean") patch.deleted = b.deleted;
			if (admin && typeof b.hidden === "boolean") patch.hidden = b.hidden;
			// Resurrection gate: restoring (un-deleting / un-hiding) a comment
			// on a locked post would plant a visible stray on a post that
			// claims "comments off". The lock purge deleted everything; the
			// lock must keep it deleted until the post is unlocked first.
			if (patch.deleted === false || patch.hidden === false) {
				const { data: parent } = await supabase
					.from("posts")
					.select("locked")
					.eq("id", cmt.post_id)
					.maybeSingle();
				if (parent?.locked === true)
					return res.status(403).json({
						error: "Comments are locked on this post — unlock the post before restoring comments.",
						code: "post_locked",
					});
			}
			const { data, error } = await supabase
				.from("comments")
				.update(patch)
				.eq("id", b.id)
				.select()
				.single();
			if (error) throw error;
			if (admin && !isOwner) await auditLog("admin", "moderate_comment", b.id);
			invalidateCounts(); // edit/hide/soft-delete all change comment_count
			return res.status(200).json(data);
		}

		if (req.method === "DELETE") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const id = req.body?.id || req.query?.id;
			if (!id) return res.status(400).json({ error: "Missing id" });
			// Prove the delete landed: an unparsed/missing id used to no-op and
			// still return ok:true, so the row "came back" on reload (same flaw
			// class as the posts hard-delete route before removal verification).
			const { data: removed, error } = await supabase
				.from("comments")
				.delete()
				.eq("id", id)
				.select("id");
			if (error) throw error;
			if (!removed || removed.length === 0)
				return res.status(404).json({ error: "Comment not found" });
			await auditLog("admin", "hard_delete_comment", String(id));
			invalidateCounts();
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "comments");
	}
}
