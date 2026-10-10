// Poll system: standalone + complaint-linked, with live results

import { isTestArtifact } from "./_artifact-filter.js";
import {
	auditLog,
	checkUser,
	clean,
	cors,
	isAdmin,
	maskProfanity,
	rateLimited,
	rateLimitResponse,
	verifyCallerIdentity,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { invalidateCounts } from "./_counts.js";
import { trackError } from "./_observability.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";
import { sendPollClosedEmail } from "./_email.js";
import { evaluateContentDeep, messageFor } from "./_safety-pipeline.js";

// Failed realtime liveness touches on `polls`. The ballot write itself has
// already succeeded when this runs, so the vote is not lost — but `poll_votes`
// has no anon SELECT policy, meaning this touch is the ONLY signal that makes
// the new total reach connected readers. A silent failure here is
// indistinguishable from a broken realtime feed, so it is counted and routed
// into `trackError` (surfaced by v3 monitoring's `getErrorSummary`).
// Mirrors `_auth.js`'s `auditFailedCount`: `export let` gives tests a live
// binding they can diff before/after a call.
export let touchFailureCount = 0;

async function attachResults(polls, strict = false) {
	const ids = polls.map((p) => p.id);
	if (!ids.length) return polls;
	// Paginated vote fetch: PostgREST silently caps an uncapped select at
	// max-rows (1000), so a viral poll would report truncated totals. Pages
	// stop at the first short page — ordinary polls cost exactly one round
	// trip, same as before. Error semantics preserved: strict throws (the
	// no-fake-zeros contract), non-strict keeps rows read so far.
	const PAGE = 1000;
	const votes = [];
	for (let page = 0; ; page += 1) {
		const { data: chunk, error } = await supabase
			.from("poll_votes")
			.select("poll_id,choices")
			.in("poll_id", ids)
			.range(page * PAGE, page * PAGE + PAGE - 1);
		if (error) {
			if (strict) throw error;
			break;
		}
		if (chunk && chunk.length) votes.push(...chunk);
		if (!chunk || chunk.length < PAGE) break;
	}
	// Strict mode is used after a write: a failed results read must not
	// masquerade as "0 votes" — the vote DID persist, so report the error.
	const map = {};
	(votes || []).forEach((v) => {
		map[v.poll_id] = map[v.poll_id] || { total: 0, counts: {} };
		map[v.poll_id].total += 1;
		(v.choices || []).forEach((c) => {
			map[v.poll_id].counts[c] = (map[v.poll_id].counts[c] || 0) + 1;
		});
	});
	return polls.map((p) => ({
		...p,
		total_votes: map[p.id]?.total || 0,
		vote_counts: map[p.id]?.counts || {},
	}));
}

/**
 * Case/punctuation-insensitive form of a poll question, used only to tell a
 * genuine second poll apart from the SAME poll being retried after a lost
 * response. Deliberately conservative: if two questions normalize the same,
 * treating the second as a retry is the safe direction (it cannot duplicate).
 */
function normalizeQuestion(text) {
	return String(text ?? "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/**
 * Create one poll — the real POST path, lifted from the handler so the
 * Poll Creation worker (#19) runs the exact same code, never a shadow
 * implementation. Behavior is identical (same mask, same row shape, same
 * insert + select().single()).
 */
export async function createPoll({
	title,
	ptype,
	options,
	post_id: linkPostId,
	author_id,
	expires_at,
	admin = false,
}) {
	// One poll per linked post — enforced HERE, inside the shared writer,
	// not in the HTTP handler. Every caller goes through this function (the
	// POST route, the Poll Creation worker, and any agent acting later), and
	// the rule was previously only in the route, so the worker happily
	// created a second poll for a post that already had one.
	//
	// A same-question retry returns the existing poll instead of writing a
	// second row: a lost response looks identical to a failed write, so a
	// retry must neither duplicate nor look like an error to the author.
	if (linkPostId) {
		const { data: existingRows } = await supabase
			.from("polls")
			.select("id,title,ptype,options,post_id,created_at")
			.eq("post_id", linkPostId)
			.eq("deleted", false)
			.order("created_at", { ascending: true })
			.limit(1);
		const existing = Array.isArray(existingRows)
			? existingRows[0]
			: existingRows ?? null;
		if (existing) {
			if (normalizeQuestion(existing.title) === normalizeQuestion(title)) {
				return { ok: true, poll: existing, deduped: true };
			}
			return {
				ok: false,
				deduped: true,
				code: "POST_ALREADY_HAS_POLL",
				error: new Error(
					"This post already has a poll. Delete it first, or add your question to it.",
				),
			};
		}
	}
	const row = {
		id: `poll_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
		// Store masked text; the gate above already ran on raw text.
		title: maskProfanity(title),
		ptype,
		options,
		post_id: linkPostId,
		author_id: admin && !author_id ? "ADMIN" : author_id,
		expires_at,
		deleted: false,
		archived: false,
		created_at: new Date().toISOString(),
	};
	const { data, error } = await supabase
		.from("polls")
		.insert(row)
		.select()
		.single();
	if (error) return { ok: false, error };
	// A NEW linked poll changes pMap/pvMap for that post (the feed badge goes
	// from "no poll" to "0 votes") — drop the derived-count entry.
	invalidateCounts();
	return { ok: true, poll: data };
}

// PostgREST unknown-column errors (pre-migration): require the column
// NAME plus a column-ish signal so unrelated errors still throw loudly.
// Exported for search, which needs the same pre-018 fallback on polls.hidden.
export function isMissingColumn(err, col) {
	const msg = String(err?.message || "");
	const code = String(err?.code || "");
	return msg.toLowerCase().includes(String(col).toLowerCase()) && /column|pgrst|exist|find|schema|cache/i.test(msg + " " + code);
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			const { id, post_id, voter, ids } = req.query;
			const requestedIds = (Array.isArray(ids) ? ids : typeof ids === "string" ? ids.split(",") : [])
				.map((value) => clean(value, 80))
				.filter(Boolean)
				.slice(0, 50);
			const admin = await isAdmin(req);
			// Cache: 30s browser + CDN for poll listings. Voter-specific responses
			// (a user's own vote rows) must never be publicly cacheable — the CDN
			// could serve one user's votes to another. Mirrors the posts route.
			if (voter) {
				res.setHeader("Cache-Control", "private, no-cache");
			} else {
				res.setHeader(
					"Cache-Control",
					"public, max-age=0, no-cache, s-maxage=10, stale-while-revalidate=10",
				);
			}
			if (voter) {
				const { data } = await supabase
					.from("poll_votes")
					.select("poll_id,choices")
					.eq("author_id", voter);
				return res.status(200).json(data || []);
			}
			// Widen the fetch window: the artifact filter below runs in JS AFTER this
			// SQL limit, so a narrow window of mostly-fuzz rows would starve the list.
			const runList = async (withHidden) => {
				let qq = supabase
					.from("polls")
					.select("*")
					.order("created_at", { ascending: false })
					.limit(2000);
				if (id) qq = qq.eq("id", id);
				else if (requestedIds.length) qq = qq.in("id", requestedIds);
				if (post_id) qq = qq.eq("post_id", post_id);
				if (!admin) qq = qq.eq("deleted", false);
				// Blocked polls stay out of every public read. The hidden column
				// lands with migration 018 — before that this filter errors and we
				// retry without it (nothing can be blocked yet, so nothing leaks).
				if (withHidden) qq = qq.eq("hidden", false);
				return qq;
			};
			const hideBlocked = !admin;
			let { data, error } = await runList(hideBlocked);
			if (error && hideBlocked && isMissingColumn(error, "hidden")) {
				({ data, error } = await runList(false));
			}
			if (error) throw error;

			// Full-site zero-fuzz: hide test/fuzz polls on every surface, admin
			// included. Rows stay intact in the DB; they are only hidden.
			const cleanRows = (data || []).filter((p) => !isTestArtifact(p.title));

			// Maintenance (stale-archive and orphan repair) runs from an
			// authenticated worker. A public GET only reads and shapes rows.
			const results = await attachResults(cleanRows.slice(0, 200), true);
			// Mask author IDs — they are bearer tokens for poll deletion
			const v = clean(req.query.viewer, 40);
			const masked = results.map((p) => {
				const is_mine = !!v && p.author_id === v;
				return {
					...p,
					is_mine,
					author_id:
						is_mine || p.author_id === "ADMIN"
							? p.author_id
							: (p.author_id || "").slice(0, 9) + "...",
				};
			});
			return res.status(200).json(masked);
		}

		if (req.method === "POST") {
			const b = req.body || {};
			// P0 SECURITY FIX: Derive author_id from x-anon-id header, NOT from client body
			const headerId = clean(req.headers["x-anon-id"] || "", 40);
			const admin = await isAdmin(req);
			// Admin callers use 'ADMIN' as author; anon users get their header identity
			const author_id = admin ? "ADMIN" : headerId;
			if (!author_id)
				return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });

			// Admin-only on-demand moderation scan: read-only, audited. Lets an
			// admin check a poll that predates the write-time gate (or that a
			// user report flagged) without deleting or hiding it first.
			if (b.action === "scan") {
				if (!admin) return res.status(403).json({ error: "Admin only" });
				const { data: poll } = await supabase
					.from("polls")
					.select("id,title,options")
					.eq("id", b.poll_id)
					.maybeSingle();
				if (!poll) return res.status(404).json({ error: "Poll not found" });
				// Deep scan: the admin explicitly asked, so the model budget is
				// justified — this catches contextual PII the regexes miss.
				const decision = await evaluateContentDeep(`${poll.title || ""} ${(poll.options || []).join(" ")}`, "direct", null, {
					taskKey: "polls.scan",
				});
				await auditLog("admin", "poll_scan", `${b.poll_id} [${decision.flags.map((f) => f.type).join(",") || "clean"}]`);
				return res.status(200).json({
					id: poll.id,
					flags: decision.flags.map((f) => f.type),
					blocked: decision.blocked,
					message: decision.blocked ? decision.message : "Clean — nothing to block.",
					code: decision.code,
				});
			}
						if (b.action === "closed") {
				// Poll-close notification — notifies the poll's author that it has
				// closed so they can review results. Idempotent per poll.
				const { data: poll } = await supabase
					.from("polls")
					.select("*")
					.eq("id", b.poll_id)
					.maybeSingle();
				if (!poll) return res.status(404).json({ error: "Poll not found" });
				const closed = !!(
					poll.expires_at && new Date(poll.expires_at) < new Date()
				);
				if (!closed)
					return res.status(200).json({ closed: false, notified: false });
				const key = `notifications:${poll.author_id}`;
				const { data: row } = await supabase
					.from("settings")
					.select("value")
					.eq("key", key)
					.maybeSingle();
				const existing = (row?.value?.notifications || []).find(
					(n) => n.type === "poll_closed" && n.poll_id === poll.id,
				);
				if (existing)
					return res
						.status(200)
						.json({ closed: true, notified: false, already_notified: true });
				const notification = {
					id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
					type: "poll_closed",
					title: "Your poll closed",
					body: `“${(poll.title || "").slice(0, 80)}” has closed — results are in.`,
					post_id: poll.post_id || null,
					poll_id: poll.id,
					read: false,
					created_at: new Date().toISOString(),
				};
				const notifications = [
					notification,
					...(row?.value?.notifications || []),
				].slice(0, 100);
				await supabase
					.from("settings")
					.upsert(
						{
							key,
							value: { notifications, updated_at: new Date().toISOString() },
						},
						{ onConflict: "key" },
					);
				// Send email notification when poll closes
				sendPollClosedEmail({
					pollTitle: poll.title,
					pollId: poll.id,
					authorId: poll.author_id,
					postId: poll.post_id,
				}).catch(() => {});
				return res.status(200).json({ closed: true, notified: true });
			}

			if (b.action === "vote") {
				// Session binding: votes are identity-bound (UNIQUE
				// poll_id+author_id), so the header claim must match a live
				// session — otherwise anyone knowing an id votes as them.
				if (!admin) {
					const caller = await verifyCallerIdentity(req, res, author_id);
					if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
				}
				const gate = await checkUser(author_id);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				const { data: poll } = await supabase
					.from("polls")
					.select("*")
					.eq("id", b.poll_id)
					.maybeSingle();
				if (!poll) return res.status(404).json({ error: "Poll not found" });
				if (poll.deleted)
					return res.status(404).json({ error: "Poll not found" });
				if (poll.archived)
					return res.status(400).json({ error: "Poll is archived." });
				if (poll.hidden)
					return res.status(400).json({ error: "Poll is blocked." });
				if (poll.expires_at && new Date(poll.expires_at) < new Date())
					return res.status(400).json({ error: "Poll has ended." });
				const choices = (Array.isArray(b.choices) ? b.choices : [])
					.map(Number)
					.filter(
						(n) =>
							Number.isInteger(n) && n >= 0 && n < (poll.options || []).length,
					);
				if (!choices.length)
					return res.status(400).json({ error: "Select at least one option." });
				if (poll.ptype !== "multi" && choices.length > 1)
					return res.status(400).json({ error: "Only one choice allowed." });
				// A failed write MUST NOT return a fake 200 with zeroed results —
				// that is exactly how votes silently disappear after refresh.
				const { data: existing, error: existingError } = await supabase
					.from("poll_votes")
					.select("id")
					.eq("poll_id", poll.id)
					.eq("author_id", author_id)
					.maybeSingle();
				if (existingError) throw existingError;
				let write = existing
					? await supabase
							.from("poll_votes")
							.update({ choices })
							.eq("id", existing.id)
					: await supabase
							.from("poll_votes")
							.insert({ poll_id: poll.id, author_id, choices });
				// Race safety: two concurrent first-votes can both pass the existence
				// probe and both try to INSERT. With migration 009's UNIQUE
				// (poll_id, author_id) the loser receives a duplicate-key error —
				// convert it to an update of the winning row so the second request
				// CHANGES its vote instead of erroring or creating a second ballot.
				// Any other error still throws (no fake success — see regression suite).
				if (
					write.error &&
					!existing &&
					(write.error.code === "23505" ||
						/duplicate key|unique constraint/i.test(
							String(write.error.message || ""),
						))
				) {
					const { data: winner, error: winnerError } = await supabase
						.from("poll_votes")
						.select("id")
						.eq("poll_id", poll.id)
						.eq("author_id", author_id)
						.maybeSingle();
					if (winnerError) throw winnerError;
					if (winner) {
						write = await supabase
							.from("poll_votes")
							.update({ choices })
							.eq("id", winner.id);
					} else {
						// Winning row vanished mid-flight — retry insert once.
						write = await supabase
							.from("poll_votes")
							.insert({ poll_id: poll.id, author_id, choices });
					}
				}
				if (write.error) throw write.error;
				// Liveness: poll_votes rows are invisible to realtime (no anon
				// policy, by design — voter identity stays private), so without
				// this touch a vote surfaces nowhere until a manual refresh.
				// Bumping the parent row emits one polls UPDATE event carrying
				// zero voter data; readers re-pull totals through /api/polls.
				// Best-effort and AFTER success: it must never fail a ballot
				// that already counted — but it must NOT be silent either.
				// PostgREST resolves with {error} and never throws, so the old
				// bare try/catch was dead code: a failed touch (the sole
				// realtime vote signal) was invisible to every metric and
				// looked identical to a healthy feed. Inspect the result,
				// count it, report it — then still return 200.
				try {
					const { error: touchError } = await supabase
						.from("polls")
						.update({ updated_at: new Date().toISOString() })
						.eq("id", poll.id);
					if (touchError) {
						touchFailureCount += 1;
						trackError(
							new Error(touchError.message || "poll liveness touch failed"),
							{
								scope: "poll_liveness_touch",
								poll_id: poll.id,
								code: touchError.code,
							},
						);
					}
				} catch (touchErr) {
					// Transport-level failure (the only case the old catch covered).
					touchFailureCount += 1;
					trackError(touchErr, {
						scope: "poll_liveness_touch",
						poll_id: poll.id,
					});
				}
				const [withResults] = await attachResults([poll], true);
				// Emit poll.voted event for workforce consumption
				emitEventAndBridge(EVENT_TYPES.REACTION_ADDED, {
					target_id: poll.id,
					target_type: "poll",
					kind: "vote",
					author_id,
				}).catch(() => {});
				// Feed-linked poll totals come from api/_counts.js's 3s/6s SWR
				// cache. The `polls` touch above only signals connected clients;
				// without this a COLD feed load would keep showing the pre-vote
				// `linked_poll_votes` for up to staleTtl.
				invalidateCounts();
				return res.status(200).json(withResults);
			}

			// Create poll
			if (!admin) {
				// Session binding: same impersonation class as votes.
				const caller = await verifyCallerIdentity(req, res, author_id);
				if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
				const gate = await checkUser(author_id);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				if (await rateLimited("polls", author_id, 120, 2))
					return rateLimitResponse(
						res,
						120,
						"Please wait before creating another poll.",
					);
			}
			// Raw text through the gate below; masked only at insert (masking
			// first would blind serverModerate to slurs).
			const title = clean(b.title, 140);
			if (title.length < 5)
				return res
					.status(400)
					.json({ error: "Question must be at least 5 characters." });
			const ptype = ["yesno", "single", "multi"].includes(b.ptype)
				? b.ptype
				: "yesno";
			const options =
				ptype === "yesno"
					? ["Yes", "No"]
					: Array.isArray(b.options)
						? b.options.map((o) => clean(o, 60)).filter(Boolean)
						: [];
			if (ptype !== "yesno" && (options.length < 2 || options.length > 10)) {
				return res.status(400).json({ error: "Provide 2–10 options." });
			}
			// Server-side PII/safety gate — verdict from the unified pipeline
		// (same blocked set the old inline check computed).
			const pollDecision = await evaluateContentDeep(`${title} ${options.join(" ")}`, "direct", null, {
				taskKey: "polls.write",
			});
			if (pollDecision.blocked) {
				const isPII = pollDecision.flags.some(
					(f) => f.type === "privacy" || f.type === "privacy_weak",
				);
				await auditLog(
					"moderation",
					"poll_blocked",
					`${author_id}: ${title.slice(0, 60)} [${pollDecision.flags.map((f) => f.type).join(", ")}]`,
				);
				const pollCode = isPII ? "PII_BLOCKED" : pollDecision.code;
				return res.status(403).json({
					error: messageFor("poll", pollCode),
					code: pollCode,
				});
			}
			const expRaw = b.expires_at;
			const expires_at =
				expRaw && !Number.isNaN(new Date(expRaw).getTime())
					? new Date(expRaw).toISOString()
					: null;
			// Own-post linking rule: a poll may only link to a post authored by
			// the same identity (admins exempt). The client already filters the
			// picker to own posts, but the server is the enforcement point —
			// otherwise anyone could attach polls to anyone else's complaints.
			let linkPostId = b.post_id ? clean(b.post_id, 60) : null;
			if (linkPostId && !admin) {
				const { data: linked } = await supabase
					.from("posts")
					.select("id,author_id")
					.eq("id", linkPostId)
					.maybeSingle();
				if (!linked)
					return res.status(404).json({ error: "Linked post not found." });
				if (linked.author_id !== author_id)
					return res
						.status(403)
						.json({ error: "Polls can only link to your own posts." });
			}
			// The one-poll-per-post rule lives in createPoll() below, so the
			// worker and any agent share it. Map its outcome onto the wire.
			const created = await createPoll({
				title,
				ptype,
				options,
				post_id: linkPostId,
				author_id,
				expires_at,
				admin,
			});
			if (!created.ok) {
				if (created.code === "POST_ALREADY_HAS_POLL") {
					return res
						.status(409)
						.json({ error: created.error.message, code: created.code });
				}
				throw created.error;
			}
			// 200 (not 201) on a retry: nothing new was created, and the client
			// must not learn otherwise.
			return res.status(created.deduped ? 200 : 201).json(created.poll);
		}

		if (req.method === "PUT") {
			const b = req.body || {};
			const admin = await isAdmin(req);
			const { data: poll } = await supabase
				.from("polls")
				.select("*")
				.eq("id", b.id)
				.maybeSingle();
			if (!poll) return res.status(404).json({ error: "Poll not found" });
			// P0 SECURITY FIX: Derive caller identity from x-anon-id header, not client body
			const callerId = clean(req.headers["x-anon-id"] || "", 40);
			const isOwner =
				callerId &&
				callerId !== "ADMIN" &&
				callerId === poll.author_id;
			if (!admin && isOwner) {
				// Session binding before the ban check: the header claim must
				// match a live session, or anyone knowing the id edits as them.
				const caller = await verifyCallerIdentity(req, res, callerId);
				if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
				const gate = await checkUser(callerId);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
			}
			if (!admin && !isOwner)
				return res.status(403).json({ error: "Not authorized" });
			const patch = {};
			if (typeof b.archived === "boolean") patch.archived = b.archived;
			if (typeof b.deleted === "boolean") patch.deleted = b.deleted;
			if (admin && typeof b.hidden === "boolean") patch.hidden = b.hidden;
			if (admin && b.expires_at !== undefined) patch.expires_at = b.expires_at;
			const { data, error } = await supabase
				.from("polls")
				.update(patch)
				.eq("id", b.id)
				.select()
				.single();
			if (error) {
				if (patch.hidden !== undefined && isMissingColumn(error, "hidden"))
					return res.status(400).json({ error: "Poll blocking needs migration 018 (polls.hidden) — not yet applied." });
				throw error;
			}
			if (admin) await auditLog("admin", "update_poll", b.id);
			// hidden/archived/deleted change which polls the feed badge links to.
			invalidateCounts();
			return res.status(200).json(data);
		}

		if (req.method === "DELETE") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			// DELETE bodies are not parsed on some hosts (Vercel drops them),
			// so the id travels in the query string; body accepted as fallback.
			const id = req.query?.id || req.body?.id;
			if (!id) return res.status(400).json({ error: "Missing id" });
			// Delete the poll row FIRST and prove it landed (0 rows => 404):
			// wiping votes before the poll was proven gone used to erase every
			// vote of a poll whose row delete then failed (live poll, zeroed
			// results). poll_votes has no FK on polls, so order is safe.
			const { data: removed, error } = await supabase
				.from("polls")
				.delete()
				.eq("id", id)
				.select("id");
			if (error) throw error;
			// Prove the delete landed instead of no-op + ok:true (row "comes back").
			if (!removed || removed.length === 0)
				return res.status(404).json({ error: "Poll not found" });
			// A failed votes wipe must not ship ok:true with orphaned votes.
			const { error: votesErr } = await supabase
				.from("poll_votes")
				.delete()
				.eq("poll_id", id);
			if (votesErr) throw votesErr;
			await auditLog("admin", "delete_poll", id);
			// The linked poll is gone — pMap must drop it on the next feed read.
			invalidateCounts();
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "polls");
	}
}
