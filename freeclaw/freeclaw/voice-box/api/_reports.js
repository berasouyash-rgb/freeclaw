// Report queue for moderation

import { isTestArtifact } from "./_artifact-filter.js";
import {
	auditLog,
	checkUser,
	clean,
	cors,
	ensureUser,
	isAdmin,
	notifyUser,
	rateLimited,
	rateLimitResponse,
	verifyCallerIdentity,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";
import { recordSafetyRepost, serverModerate } from "./_moderation.js";
import { scanSlang } from "./_slang.js";
import { recordSlangViolation } from "./_escalation.js";

// ─── Auto-moderation on report ───────────────────────────────────────
// Every validated report now does REAL work, not just queue a row:
//   1. resolve the reported target's author (post/comment/poll)
//   2. auto-strike that author once per target per 24h (spam-proof dedupe)
//   3. push an in-app warning notification so the popup arrives immediately
// The strike shows up on the user's next heartbeat (/api/users) and the
// AppContext heartbeat turns it into a warning toast + notification popup.

const STRIKE_DEDUPE_MS = 24 * 60 * 60 * 1000; // one auto-strike per target per day
const STRIKE_SUSPEND_AT = 3; // 3 auto-strikes in 7 days → auto-suspend 7 days
const STRIKE_BAN_AT = 6; // 6 → auto-ban

// ─── Community targets ──────────────────────────────────────────────
// Community posts are NOT rows in `posts` — they live inside a JSON record in
// the `settings` KV store (key `community:<slug>`). A report on one therefore
// resolves here, not by querying the posts table (which would always miss and
// let the queue report "target already removed" — a fabricated verdict).
const COMMUNITY_TYPES = new Set(["community_post", "community"]);

/** True when a report targets a community, in either the dedicated
 *  target_type form or the `community:`-prefixed post fallback form. */
function isCommunityTarget(targetType, targetId) {
	if (COMMUNITY_TYPES.has(String(targetType || ""))) return true;
	// Fallback rows written when the DB check constraint rejected
	// target_type=community_post: target_id becomes `community:<slug>[::id]`.
	return String(targetType || "") === "post" && String(targetId || "").startsWith("community:");
}

/**
 * True when an insert failed because the `reports.target_type` CHECK
 * constraint rejected the value. Older databases only allow
 * post/comment/poll; posting `community_post` failed the whole request and
 * surfaced as HTTP 500 ("internal server error") to the reporter. PostgREST
 * reports this as 23514, but some deployments answer 400 with the constraint
 * named only in the message, so both shapes are accepted.
 */
function isTargetTypeConstraintError(error) {
	if (!error) return false;
	const code = String(error.code || "");
	const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
	if (code !== "23514" && !/check constraint/i.test(text)) return false;
	return /target_type/i.test(text) || code === "23514";
}

/** Parse `<slug>` or `<slug>::<postId>` (optionally with a `community:` prefix)
 *  into `{ slug, postId }`. Returns null when it isn't a community target. */
function parseCommunityTarget(targetId) {
	let raw = String(targetId || "");
	if (raw.startsWith("community:")) raw = raw.slice("community:".length);
	if (!raw) return null;
	const [slug, postId] = raw.split("::");
	if (!slug) return null;
	return { slug: slug.slice(0, 80), postId: postId ? postId.slice(0, 24) : null };
}

/** Load the full community record from the KV store. */
async function getCommunityRecord(slug) {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", `community:${slug}`)
		.maybeSingle();
	return data?.value ?? null;
}

/** Resolve the author of a reported target. Returns { author_id, title } or null. */
async function resolveTargetAuthor(targetType, targetId) {
	if (!targetId) return null;
	try {
		// Community post / community — lives in the settings KV store.
		if (isCommunityTarget(targetType, targetId)) {
			const parsed = parseCommunityTarget(targetId);
			if (!parsed) return null;
			const c = await getCommunityRecord(parsed.slug);
			if (!c) return null;
			if (!parsed.postId) {
				// The whole community was reported.
				return c.created_by
					? { author_id: c.created_by, title: String(c.name || parsed.slug).slice(0, 60) }
					: null;
			}
			const post = (Array.isArray(c.posts) ? c.posts : []).find((p) => p?.id === parsed.postId);
			return post?.anon_id
				? { author_id: post.anon_id, title: String(post?.text || "").slice(0, 60) }
				: null;
		}
		if (targetType === "comment") {
			const { data } = await supabase
				.from("comments")
				.select("author_id, body")
				.eq("id", targetId)
				.maybeSingle();
			return data?.author_id
				? {
						author_id: data.author_id,
						title: String(data.body || "").slice(0, 60),
					}
				: null;
		}
		if (targetType === "poll") {
			const { data } = await supabase
				.from("polls")
				.select("author_id, title")
				.eq("id", targetId)
				.maybeSingle();
			return data?.author_id
				? {
						author_id: data.author_id,
						title: String(data.title || "").slice(0, 60),
					}
				: null;
		}
		const { data } = await supabase
			.from("posts")
			.select("author_id, title")
			.eq("id", targetId)
			.maybeSingle();
		return data?.author_id
			? {
					author_id: data.author_id,
					title: String(data.title || "").slice(0, 60),
				}
			: null;
	} catch (e) {
		console.error("resolveTargetAuthor error:", e.message);
		return null;
	}
}

/**
 * Resolution verification (spec §23): a report is not resolved merely
 * because an admin clicked "resolved". Compare the claim against the live
 * target — if the target is already gone, the resolution is confirmed; if
 * it is live but violates policy right now, enforce (hide) and report that;
 * if it is live and clean, resolve as reviewed. Never fabricates: an
 * unreadable target yields verified:false, never a false "verified".
 */
async function verifyReportResolution(report) {
	const { target_type, target_id } = report || {};
	const fail = (detail) => ({
		verified: false,
		target_state: "unknown",
		action_taken: "none",
		detail,
	});
	try {
		// Community post / community — verify against the KV record, and hide
		// the offending post (or the whole community) when it still violates.
		if (isCommunityTarget(target_type, target_id)) {
			const parsed = parseCommunityTarget(target_id);
			if (!parsed) return fail("Malformed community target id.");
			const c = await getCommunityRecord(parsed.slug);
			if (!c) return { verified: true, target_state: "gone", action_taken: "none", detail: "Community already removed." };
			if (!parsed.postId) {
				if (c.hidden)
					return { verified: true, target_state: "hidden", action_taken: "none", detail: "Community already hidden." };
				await supabase
					.from("settings")
					.update({ value: { ...c, hidden: true } })
					.eq("key", `community:${parsed.slug}`);
				await auditLog("moderation", "report_resolve_enforced", `community ${parsed.slug} hidden on resolve`);
				return { verified: true, target_state: "hidden", action_taken: "hidden", detail: "Community hidden pending review." };
			}
			const posts = Array.isArray(c.posts) ? c.posts : [];
			const post = posts.find((p) => p?.id === parsed.postId);
			if (!post) return { verified: true, target_state: "gone", action_taken: "none", detail: "Target already removed." };
			const mod = serverModerate("", String(post.text || ""));
			if (mod.blocked) {
				const flagTypes = mod.flags.map((f) => f.type).join(",");
				const next = { ...c, posts: posts.filter((p) => p?.id !== parsed.postId) };
				await supabase.from("settings").update({ value: next }).eq("key", `community:${parsed.slug}`);
				await recordSafetyRepost(supabase, String(post.text || "").slice(0, 300), (mod.flags[0] || {}).type || "policy");
				await auditLog("moderation", "report_resolve_enforced", `community post ${parsed.slug}::${parsed.postId} removed on resolve [${flagTypes}]`);
				return { verified: true, target_state: "hidden", action_taken: "hidden", detail: `Violating community post removed automatically (${flagTypes}).` };
			}
			return { verified: true, target_state: "live", action_taken: "none", detail: "Reviewed: no live violation on target." };
		}
		if (target_type === "comment") {
			const { data, error } = await supabase
				.from("comments")
				.select("id, body, hidden, deleted")
				.eq("id", target_id)
				.maybeSingle();
			if (error) throw error;
			if (!data)
				return { verified: true, target_state: "gone", action_taken: "none", detail: "Target already removed." };
			if (data.hidden || data.deleted)
				return { verified: true, target_state: "hidden", action_taken: "none", detail: "Target already hidden." };
			const mod = serverModerate("", String(data.body || ""));
			if (mod.blocked) {
				const flagTypes = mod.flags.map((f) => f.type).join(",");
				await supabase.from("comments").update({ hidden: true }).eq("id", target_id);
				await recordSafetyRepost(supabase, String(data.body || ""), (mod.flags[0] || {}).type || "policy");
				await auditLog("moderation", "report_resolve_enforced", `comment ${target_id} hidden on resolve [${flagTypes}]`);
				return { verified: true, target_state: "hidden", action_taken: "hidden", detail: `Violating comment hidden automatically (${flagTypes}).` };
			}
			return { verified: true, target_state: "live", action_taken: "none", detail: "Reviewed: no live violation on target." };
		}
		if (target_type === "poll") {
			const { data, error } = await supabase
				.from("polls")
				.select("id, title, deleted")
				.eq("id", target_id)
				.maybeSingle();
			if (error) throw error;
			if (!data || data.deleted)
				return { verified: true, target_state: "gone", action_taken: "none", detail: "Target already removed." };
			const mod = serverModerate(String(data.title || ""), "");
			if (mod.blocked) {
				const flagTypes = mod.flags.map((f) => f.type).join(",");
				await supabase.from("polls").update({ deleted: true }).eq("id", target_id);
				await recordSafetyRepost(supabase, String(data.title || ""), (mod.flags[0] || {}).type || "policy");
				await auditLog("moderation", "report_resolve_enforced", `poll ${target_id} removed on resolve [${flagTypes}]`);
				return { verified: true, target_state: "hidden", action_taken: "hidden", detail: `Violating poll removed automatically (${flagTypes}).` };
			}
			return { verified: true, target_state: "live", action_taken: "none", detail: "Reviewed: no live violation on target." };
		}
		// default: post
		const { data, error } = await supabase
			.from("posts")
			.select("id, title, description, hidden, deleted")
			.eq("id", target_id)
			.maybeSingle();
		if (error) throw error;
		if (!data)
			return { verified: true, target_state: "gone", action_taken: "none", detail: "Target already removed." };
		if (data.hidden || data.deleted)
			return { verified: true, target_state: "hidden", action_taken: "none", detail: "Target already hidden." };
		const mod = serverModerate(String(data.title || ""), String(data.description || ""));
		if (mod.blocked) {
			const flagTypes = mod.flags.map((f) => f.type).join(",");
			await supabase.from("posts").update({ hidden: true }).eq("id", target_id);
			await recordSafetyRepost(supabase, `${data.title || ""} ${data.description || ""}`.slice(0, 300), (mod.flags[0] || {}).type || "policy");
			await auditLog("moderation", "report_resolve_enforced", `post ${target_id} hidden on resolve [${flagTypes}]`);
			return { verified: true, target_state: "hidden", action_taken: "hidden", detail: `Violating post hidden automatically (${flagTypes}).` };
		}
		return { verified: true, target_state: "live", action_taken: "none", detail: "Reviewed: no live violation on target." };
	} catch (err) {
		return fail(`Verification failed: ${err?.message || err}`);
	}
}

/** Enrich admin report rows with target_author_id (batched, bounded). */
async function enrichAdminRows(rows) {
	if (!rows || !rows.length) return rows;
	// Community reports resolve against the settings KV store, not the
	// posts/comments tables — keep them out of the SQL batches below.
	const isCommunityRow = (r) => isCommunityTarget(r.target_type, r.target_id);
	const posts = rows
		.filter((r) => r.target_type === "post" && !isCommunityRow(r))
		.map((r) => r.target_id);
	const comments = rows
		.filter((r) => r.target_type === "comment")
		.map((r) => r.target_id);
	const polls = rows
		.filter((r) => r.target_type === "poll")
		.map((r) => r.target_id);
	const map = {};
	// Availability snapshot: a soft-deleted / hidden target must leave the
	// pending queue while its report row is preserved (spec §3.2 case C).
	const stateMap = {};
	const [{ data: pd }, { data: cd }, { data: pld }] = await Promise.all([
		posts.length
			? supabase
					.from("posts")
					.select("id, author_id, deleted, hidden")
					.in("id", posts.slice(0, 100))
			: Promise.resolve({ data: [] }),
		comments.length
			? supabase
					.from("comments")
					.select("id, author_id, deleted, hidden")
					.in("id", comments.slice(0, 100))
			: Promise.resolve({ data: [] }),
		polls.length
			? supabase
					.from("polls")
					.select("id, author_id")
					.in("id", polls.slice(0, 100))
			: Promise.resolve({ data: [] }),
	]);
	[...(pd || []), ...(cd || [])].forEach((row) => {
		map[row.id] = row.author_id;
		stateMap[row.id] = row.deleted
			? "deleted"
			: row.hidden
				? "hidden"
				: "available";
	});
	(pld || []).forEach((row) => {
		map[row.id] = row.author_id;
		stateMap[row.id] = "available";
	});
	// Community targets: fetch each distinct community once from the KV
	// store and resolve the reported post's author (or the community owner).
	const communityRows = rows.filter(isCommunityRow);
	if (communityRows.length) {
		const slugs = [
			...new Set(
				communityRows
					.map((r) => parseCommunityTarget(r.target_id)?.slug)
					.filter(Boolean),
			),
		].slice(0, 50);
		const records = {};
		if (slugs.length) {
			const { data: kvRows } = await supabase
				.from("settings")
				.select("key, value")
				.in(
					"key",
					slugs.map((s) => `community:${s}`),
				);
			for (const kv of kvRows || []) {
				records[kv.key.slice("community:".length)] = kv.value;
			}
		}
		for (const r of communityRows) {
			const parsed = parseCommunityTarget(r.target_id);
			const c = parsed ? records[parsed.slug] : null;
			if (!c) continue;
			if (!parsed.postId) {
				if (c.created_by) map[r.target_id] = c.created_by;
				continue;
			}
			const post = (Array.isArray(c.posts) ? c.posts : []).find(
				(p) => p?.id === parsed.postId,
			);
			if (post?.anon_id) map[r.target_id] = post.anon_id;
		}
	}
	return rows.map((r) => {
		// Community targets resolve through the KV store; a post no longer
		// present there was deleted. Unknown types are left as "unknown"
		// rather than guessed.
		let targetState = stateMap[r.target_id] || null;
		if (!targetState && isCommunityRow(r)) {
			targetState = map[r.target_id] ? "available" : "deleted";
		}
		return {
			...r,
			target_author_id: map[r.target_id] || null,
			target_state: targetState || "unknown",
		};
	});
}

/**
 * Attach the autonomous workers' OWN evidence to the reports they acted on.
 *
 * WHY: the moderation queue used to show a report's `status` and nothing else,
 * so an admin saw "resolved" with no way to tell whether a human clicked a
 * button or a worker actually removed content and proved it. A status flip is
 * not evidence (spec §0 / §58).
 *
 * The workers already write a structured audit row the moment they act:
 *   worker:report-disposition    -> report_dispositioned
 *   worker:resolution-verification -> false_resolution_reopened
 * with a JSON `detail` naming the report, the disposition, whether enforcement
 * ran, and the observation it was based on. This joins that evidence back onto
 * the row so the UI can show WHAT the AI did and WHY, sourced from the audit
 * trail rather than from a worker's self-report at render time.
 *
 * Additive and fail-open: if the audit store is unreadable the queue still
 * renders — it simply carries no worker evidence rather than a fabricated one.
 */
async function attachWorkerEvidence(rows) {
	if (!rows || !rows.length) return rows;
	const ids = new Set(rows.map((r) => String(r.id)));
	// Only decisions recent enough to describe this queue are worth the read.
	const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
	const { data, error } = await supabase
		.from("activity_logs")
		.select("actor, action, detail, created_at")
		.in("actor", [
			"worker:report-disposition",
			"worker:resolution-verification",
		])
		.gte("created_at", since)
		.order("created_at", { ascending: false })
		.limit(500);
	if (error) return rows;

	const byId = new Map();
	for (const log of data || []) {
		let parsed = null;
		try {
			parsed = JSON.parse(log.detail);
		} catch {
			continue; // a malformed audit row proves nothing; skip it
		}
		const rid = parsed?.report_id == null ? null : String(parsed.report_id);
		if (!rid || !ids.has(rid) || byId.has(rid)) continue;
		// Rows are newest-first, so the first decision for a report wins — the
		// latest thing the worker did, not a stale earlier pass.
		const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
		byId.set(rid, {
			worker: String(log.actor || "").replace(/^worker:/, ""),
			action: log.action,
			disposition: parsed.disposition || null,
			enforced: parsed.enforced === true,
			evidence: parsed.evidence || (flags.length ? flags.join(", ") : null),
			target: parsed.target || null,
			at: log.created_at,
		});
	}
	return rows.map((r) => {
		const ev = byId.get(String(r.id));
		return ev ? { ...r, worker_action: ev } : r;
	});
}

/**
 * Auto-enforce a strike on the reported author (with 24h per-target dedupe
 * and progressive suspension/ban). Returns the outcome for the response.
 */
async function enforceStrike(
	reporterId,
	targetAuthorId,
	targetType,
	targetId,
	reason,
) {
	const outcome = {
		strike_applied: false,
		strikes: 0,
		suspended: false,
		banned: false,
		already_struck: false,
	};
	// Only real anonymous users are strikable — the pre-publish fallback id
	// ('anonymous') and admin are not real accounts.
	if (
		!targetAuthorId ||
		!/^anon_/i.test(targetAuthorId) ||
		targetAuthorId === reporterId ||
		targetAuthorId === "ADMIN"
	)
		return outcome;
	try {
		// Dedupe: only ONE auto-strike per target per 24h, no matter how many
		// people report it — prevents a single report cascade from perma-banning.
		const since = new Date(Date.now() - STRIKE_DEDUPE_MS).toISOString();
		const [recentRes, metaPre] = await Promise.all([
			supabase
				.from("reports")
				.select("id")
				.eq("target_id", targetId)
				.eq("target_type", targetType)
				.gte("created_at", since)
				.limit(20),
			supabase
				.from("users_meta")
				.select("warnings")
				.eq("anon_id", targetAuthorId)
				.maybeSingle(),
		]);
		const recent = recentRes.data || [];
		// Two independent guards against double-striking: (a) another report landed
		// on this target in the last 24h, or (b) an auto_report warning for this
		// exact target already exists in that window. (b) closes the TOCTOU window
		// between the report insert and this check.
		const alreadyWarned = (metaPre?.data?.warnings || []).some(
			(w) =>
				w.source === "auto_report" &&
				w.target_id === targetId &&
				w.at &&
				new Date(w.at) >= new Date(since),
		);
		if (recent.length > 1 || alreadyWarned) {
			outcome.already_struck = true;
			return outcome;
		}

		const { data: meta } = await supabase
			.from("users_meta")
			.select("*")
			.eq("anon_id", targetAuthorId)
			.maybeSingle();
		const warnings = Array.isArray(meta?.warnings) ? meta.warnings : [];
		const strikes = meta?.strikes || 0;
		const next = strikes + 1;
		warnings.push({
			text: `Reported for ${clean(reason, 140)}`,
			at: new Date().toISOString(),
			source: "auto_report",
			target_type: targetType,
			target_id: targetId,
		});
		const patch = {
			strikes: next,
			warnings,
			last_seen: new Date().toISOString(),
		};

		// Progressive enforcement: 3 auto-strikes in a week → 7-day suspension;
		// 6 → permanent ban. Both are reversible by admin.
		const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();
		const weekStrikes = warnings.filter(
			(w) => w.at && new Date(w.at) >= new Date(lastWeek),
		).length;
		if (next >= STRIKE_BAN_AT) {
			patch.banned = true;
			outcome.banned = true;
		} else if (weekStrikes >= STRIKE_SUSPEND_AT) {
			patch.suspended_until = new Date(Date.now() + 7 * 86400000).toISOString();
			outcome.suspended = true;
		}

		const { error: updErr } = await supabase
			.from("users_meta")
			.update(patch)
			.eq("anon_id", targetAuthorId);
		if (updErr) {
			console.error("enforceStrike update failed:", updErr.message);
			return outcome;
		}
		outcome.strike_applied = true;
		outcome.strikes = next;

		// Immediate warning popup: the user's heartbeat detects the strike bump
		// and fires the toast; the notification store makes it visible instantly
		// even before the next heartbeat.
		if (outcome.banned) {
			await notifyUser(
				targetAuthorId,
				"warning",
				"Account permanently banned",
				"This anonymous ID has been permanently banned from posting after repeated reports.",
			);
		} else if (outcome.suspended) {
			await notifyUser(
				targetAuthorId,
				"warning",
				"Account temporarily suspended",
				`Your anonymous ID is suspended for 7 days after multiple reports.`,
			);
		} else {
			await notifyUser(
				targetAuthorId,
				"warning",
				`Strike ${next} issued`,
				`Your content was reported for: ${clean(reason, 140)}`,
			);
		}
	} catch (e) {
		console.error("enforceStrike error:", e.message);
	}
	return outcome;
}

// ── Slang escalation ───────────────────────────────────────────
// School zero-tolerance already 403s ANY slang content at write time.
// This adds the author-level consequence the content block alone lacks,
// WITHOUT auto-punishing anyone:
//   * every UNIQUE slang term in a blocked submission counts 1 violation
//     (repeating the same term in one post does not farm extra counts —
//     the caller de-duplicates with a Set);
//   * the counter is SEPARATE from `users_meta.strikes`, which is owned by
//     the human report ladder (STRIKE_SUSPEND_AT / STRIKE_BAN_AT). Reusing
//     that column would let automated slang hits suspend or ban an account
//     with no moderator in the loop;
//   * at ESCALATE_AT violations an admin is notified and decides the scope
//     (full block / browse only / feed only) or dismisses it — see
//     _escalation.js resolveEscalation().
// Best-effort: never throws, never delays the caller's 403.
const SLANG_VIOLATION_TERMS = 1;
export async function strikeSlangAbuse(authorId, targetType, text) {
	const outcome = { strike_applied: false, violations: 0, escalated: false, already_escalated: false };
	try {
		if (!authorId || !/^anon_/i.test(authorId) || authorId === "ADMIN") return outcome;
		// Unique terms only: one term = one violation, however often it repeats
		// inside this submission.
		const terms = new Set(scanSlang(String(text || "")).map((h) => h.term));
		if (terms.size < SLANG_VIOLATION_TERMS) return outcome;
		const rec = await recordSlangViolation(authorId, terms.size, {
			targetType,
			terms: [...terms].slice(0, 20),
		});
		outcome.strike_applied = rec.violations > 0;
		outcome.violations = rec.violations;
		outcome.escalated = rec.escalated;
		outcome.already_escalated = rec.already_escalated;
	} catch (e) {
		console.error("strikeSlangAbuse error:", e.message);
	}
	return outcome;
}
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const { data, error } = await supabase
				.from("reports")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(300);
			if (error) throw error;
			// Full-site zero-fuzz: hide reports filed with test/fuzz reasons ("test",
			// "qa", gibberish) so the moderation queue reads clean. The reported
			// targets themselves are also hidden by the posts/comments/polls filters.
			// Rows stay intact in the DB; they are only hidden.
			const cleanRows = (data || []).filter((r) => !isTestArtifact(r.reason));
			// Enrich every row with the reported target's author (admin-only surface,
			// so no privacy concern) so the Reports UI can moderate directly without
			// a per-row client lookup. The reports table has no author column, so this
			// is resolved live — batched per target type for a bounded number of queries.
			const enriched = await enrichAdminRows(cleanRows);
			// Fold the workforce's own audit evidence onto the rows it acted on, so
			// the queue shows real AI work instead of a status field.
			const withEvidence = await attachWorkerEvidence(enriched);
			return res.status(200).json(withEvidence);
		}

		if (req.method === "POST") {
			const b = req.body || {};
			// P0 SECURITY FIX: Derive author_id from x-anon-id header, NOT from client body
			const headerId = clean(req.headers["x-anon-id"] || "", 40);
			const admin = await isAdmin(req);
			const author_id = headerId || (admin ? "ADMIN" : "");
			if (!author_id)
				return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });
			// Session binding: reports are attributed by author_id, so the
			// header claim must match a live session — otherwise anyone
			// knowing an id files reports as them.
			if (!admin) {
				const caller = await verifyCallerIdentity(req, res, author_id);
				if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
			}
			const gate = await checkUser(author_id, "report_create");
			if (!gate.ok) return res.status(403).json({ error: gate.error });
			if (await rateLimited("reports", author_id, 300, 10)) {
				return rateLimitResponse(
					res,
					300,
					"Slow down — max 10 reports per 5 minutes.",
				);
			}
			const target_type = [
				"post",
				"comment",
				"poll",
				"community_post",
				"community",
			].includes(b.target_type)
				? b.target_type
				: "post";
			// A community target is `community:<slug>::<postId>` — the 60-char cap
			// used for opaque post ids truncated it, so parseCommunityTarget()
			// lost the post id and the queue named the whole community as the
			// subject. Community ids get room; everything else keeps the tight cap.
			const idLimit = isCommunityTarget(target_type, b.target_id) ? 160 : 60;
			const row = {
				target_id: clean(b.target_id, idLimit),
				target_type,
				reason: clean(b.reason, 300) || "No reason given",
				author_id,
			};
			if (!row.target_id)
				return res.status(400).json({ error: "Missing target" });
			let { data, error } = await supabase
				.from("reports")
				.insert(row)
				.select()
				.single();
			// Constraint-safe fallback: when the database still only allows
			// post/comment/poll, store the community report in the equivalent
			// form the resolver already understands (target_type=post plus a
			// `community:` id) instead of failing the reporter with a 500.
			if (isTargetTypeConstraintError(error)) {
				const fallback = {
					...row,
					target_type: "post",
					target_id: row.target_id.startsWith("community:")
						? row.target_id
						: `community:${row.target_id}`,
				};
				const retry = await supabase
					.from("reports")
					.insert(fallback)
					.select()
					.single();
				if (!retry.error) {
					data = retry.data;
					error = null;
					// Keep every downstream step (author resolution, strike
					// attribution, audit trail) pointed at what was stored.
					row.target_type = fallback.target_type;
					row.target_id = fallback.target_id;
				}
			}
			if (error) throw error;

			// ── Real moderation work happens HERE, right after the report lands ──
			// Ensure the reporter has a users_meta row (heartbeat normally does it).
			await ensureUser(author_id);
			const target = await resolveTargetAuthor(row.target_type, row.target_id);
			const enforcement = target
				? await enforceStrike(
						author_id,
						target.author_id,
						target_type,
						row.target_id,
						row.reason,
					)
				: {
						strike_applied: false,
						strikes: 0,
						suspended: false,
						banned: false,
						already_struck: false,
					};
			await auditLog(
				"moderation",
				"report_filed",
				`${row.target_type} ${row.target_id} by ${author_id}${enforcement.strike_applied ? " — auto-strike " + enforcement.strikes : ""}`,
			);
			// Emit event for workforce consumption (fire-and-forget)
			emitEventAndBridge(EVENT_TYPES.USER_REPORTED, {
				target_id: row.target_id,
				target_type: row.target_type,
				author_id,
				strike_applied: enforcement.strike_applied,
				strikes: enforcement.strikes,
			}).catch(() => {});
			// Privacy: the report row only goes back to the reporter. Never leak the
			// full author id of the reported user (the UI truncates it everywhere
			// else); admins get resolved authors via the admin-gated GET endpoint.
			return res
				.status(201)
				.json({
					...data,
					enforcement: {
						strike_applied: enforcement.strike_applied,
						strikes: enforcement.strikes,
					},
				});
		}

		if (req.method === "PUT") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const b = req.body || {};

			// Bulk: clear reports whose target no longer exists (soft-deleted
			// or removed). Preserves every report row and records one audit
			// entry — the queue stops showing dead reports (spec §3.2 case C).
			if (b.action === "dismiss_unavailable") {
				const ids = Array.isArray(b.ids)
					? b.ids.map((id) => clean(id, 60)).filter(Boolean).slice(0, 100)
					: [];
				if (!ids.length)
					return res.status(400).json({ error: "ids must be a non-empty array" });
				const { data: rows, error: readErr } = await supabase
					.from("reports")
					.select("id, target_type, target_id, reason, status")
					.in("id", ids);
				if (readErr) throw readErr;
				const enriched = await enrichAdminRows(rows || []);
				const stale = enriched.filter(
					(r) =>
						r.status !== "dismissed" &&
						r.status !== "resolved" &&
						(r.target_state === "deleted" || r.target_state === "hidden"),
				);
				const staleIds = stale.map((r) => r.id);
				if (staleIds.length) {
					const { error } = await supabase
						.from("reports")
						.update({ status: "dismissed" })
						.in("id", staleIds);
					if (error) throw error;
					await auditLog(
						"admin",
						"dismiss_unavailable_reports",
						JSON.stringify({
							count: staleIds.length,
							ids: staleIds,
							reason: "content_unavailable",
						}),
					);
				}
				return res.status(200).json({
					ok: true,
					dismissed: staleIds.length,
					skipped: ids.length - staleIds.length,
					ids: staleIds,
				});
			}

			// Read the row first: resolution is verified against the live
			// target (spec §23), never just a status flip.
			const { data: existing, error: readErr } = await supabase
				.from("reports")
				.select("id, target_type, target_id, reason, status")
				.eq("id", b.id)
				.maybeSingle();
			if (readErr) throw readErr;
			if (!existing) return res.status(404).json({ error: "Report not found" });
			// Validated state machine: unknown values are rejected instead of
			// being written verbatim (which silently created unqueryable rows).
			const nextStatus = clean(b.status, 20) || "resolved";
			const allowedStatuses = [
				"open",
				"pending",
				"under_review",
				"resolved",
				"dismissed",
			];
			if (!allowedStatuses.includes(nextStatus))
				return res.status(400).json({
					error: `status must be one of ${allowedStatuses.join(", ")}`,
				});
			const { data, error } = await supabase
				.from("reports")
				.update({ status: nextStatus })
				.eq("id", b.id)
				.select()
				.single();
			if (error) throw error;
			const previousStatus = existing.status || "open";
			const auditAction =
				nextStatus === "resolved"
					? "resolve_report"
					: nextStatus === "dismissed"
						? "dismiss_report"
						: nextStatus === "pending" || nextStatus === "open"
							? "reopen_report"
							: "review_report";
			const note = clean(b.reason, 200);
			let verification = {
				verified: true,
				target_state: "unknown",
				action_taken: "none",
				detail: "Status updated.",
			};
			if (nextStatus === "resolved") {
				verification = await verifyReportResolution(existing);
			}
			await auditLog(
				"admin",
				auditAction,
				JSON.stringify({
					report: b.id,
					from: previousStatus,
					to: nextStatus,
					target: `${existing.target_type}:${existing.target_id}`,
					verified: verification.verified,
					target_state: verification.target_state,
					action_taken: verification.action_taken,
					...(note ? { note } : {}),
				}),
			);
			return res.status(200).json({
				...data,
				previous_status: previousStatus,
				verification,
			});
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "reports");
	}
}
