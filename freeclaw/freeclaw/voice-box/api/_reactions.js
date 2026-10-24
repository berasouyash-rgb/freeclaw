// Reaction toggles — positive-only voting (Support on problems, Upvote on ideas).
// One vote per anonymous browser per item; tapping again removes it.

import { checkUser, clean, cors, isAdmin, rateLimited, rateLimitResponse, verifyCallerIdentity } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { invalidateCounts } from "./_counts.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";

// Normalize legacy/synonym kinds from older cached clients so nobody
// ever gets an "invalid reaction" error.
const NORMALIZE = {
	support: "support",
	like: "support",
	important: "support",
	urgent: "support",
	disagree: "disagree",
	dislike: "disagree",
	downvote: "disagree",
	down: "disagree",
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
			// Session binding: the header claim must match a live session
			// (same model as inbox/communities). Header-only auth let anyone
			// knowing an id vote as them.
			if (!admin) {
				const caller = await verifyCallerIdentity(req, res, author_id);
				if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
			}
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
			// Toggle floods (scripted tapping) each cost a delete + insert +
			// counts + a parent touch that fans out to realtime badges on every
			// client. 30 toggles per 10s is far beyond human tapping.
			if (await rateLimited("reactions", author_id, 10, 30)) {
				return rateLimitResponse(
					res,
					10,
					"Too many reactions — please wait a moment.",
				);
			}

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
				// Race safety (same model as _polls.js): web + app open on one
				// identity can fire two toggles in the same instant — both
				// DELETEs see no row and both INSERT. The unique index
				// reactions_target_author_kind_uidx turns the loser into a
				// duplicate-key error, which means the winner already made
				// THIS exact reaction active — precisely the state a toggle-ON
				// wanted — so swallow it and report success instead of a 500
				// the user can do nothing about (the row is already there).
				// Any other insert error still throws: no fake success.
				const duplicate =
					insError &&
					(insError.code === "23505" ||
						/duplicate key|unique constraint/i.test(
							String(insError.message || ""),
						));
				if (insError && !duplicate) throw insError;
			}
			// The feed's derived counts are behind a 3s/6s stale-while-revalidate
			// cache (api/_counts.js). Without this, a toggle would stay invisible to
			// a COLD page load for up to staleTtl even though every connected client
			// already got the realtime delta. Clearing it is two Map deletions.
			invalidateCounts();

			// Fresh counts AND the caller's own reactions in ONE query; the activity
			// bump runs in parallel (different table, independent of the counts).
			const counts = {};
			const mine = [];
			// Paginated row fetch: PostgREST silently caps an uncapped select
			// at max-rows (1000), so a viral post would report truncated
			// counts AND lose the caller's mine row past the cap. Pages stop
			// at the first short page — small posts cost exactly one round
			// trip, same as before. No ORDER BY: rows only feed counters, and
			// a concurrent toggle mid-pagination self-corrects on the next
			// toggle recount (same snapshot semantics as the old single read).
			const fetchAllReactionRows = async () => {
				const PAGE = 1000;
				const all = [];
				for (let page = 0; ; page += 1) {
					const { data: chunk, error: pageError } = await supabase
						.from("reactions")
						.select("kind, author_id")
						.eq("target_id", target_id)
						.range(page * PAGE, page * PAGE + PAGE - 1);
					if (pageError) throw pageError;
					if (chunk && chunk.length) all.push(...chunk);
					if (!chunk || chunk.length < PAGE) break;
				}
				return all;
			};
			try {
				const [rows] = await Promise.all([
					fetchAllReactionRows(),
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
				// Real-time priority recalculation based on support count
				if (target_type === "post" || target_type === "suggestion") {
					const supportCount = counts["support"] || 0;
					const concernCount = counts["concern"] || 0;
					let newPriority = "medium";
					if (supportCount >= 20 || concernCount >= 15) newPriority = "critical";
					else if (supportCount >= 10 || concernCount >= 8) newPriority = "high";
					else if (supportCount < 3 && concernCount < 3) newPriority = "low";
					try {
						supabase
							.from("posts")
							.update({ priority: newPriority })
							.eq("id", target_id)
							.then(
								({ error }) => { if (error) console.error("[reactions] priority recalc failed", { target_id, error: error.message }); },
								(err) => console.error("[reactions] priority recalc failed", { target_id, error: err?.message || String(err) }),
							);
					} catch (err) {
						console.error("[reactions] priority recalc threw", { target_id, error: err?.message || String(err) });
					}
				}
			} catch (countErr) {
				console.error("reactions count query error:", countErr);
				// Still return success — the toggle itself worked
			}
			// Emit event for workforce consumption (fire-and-forget)
			if (toggled) {
				emitEventAndBridge(EVENT_TYPES.REACTION_ADDED, {
					target_id,
					target_type,
					kind,
					author_id,
				}).catch(() => {});
			}
			return res.status(200).json({ toggled, counts, mine });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "reactions");
	}
}
