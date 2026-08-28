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
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

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

/** Resolve the author of a reported target. Returns { author_id, title } or null. */
async function resolveTargetAuthor(targetType, targetId) {
	if (!targetId) return null;
	try {
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

/** Enrich admin report rows with target_author_id (batched, bounded). */
async function enrichAdminRows(rows) {
	if (!rows || !rows.length) return rows;
	const posts = rows
		.filter((r) => r.target_type === "post")
		.map((r) => r.target_id);
	const comments = rows
		.filter((r) => r.target_type === "comment")
		.map((r) => r.target_id);
	const polls = rows
		.filter((r) => r.target_type === "poll")
		.map((r) => r.target_id);
	const map = {};
	const [{ data: pd }, { data: cd }, { data: pld }] = await Promise.all([
		posts.length
			? supabase
					.from("posts")
					.select("id, author_id")
					.in("id", posts.slice(0, 100))
			: Promise.resolve({ data: [] }),
		comments.length
			? supabase
					.from("comments")
					.select("id, author_id")
					.in("id", comments.slice(0, 100))
			: Promise.resolve({ data: [] }),
		polls.length
			? supabase
					.from("polls")
					.select("id, author_id")
					.in("id", polls.slice(0, 100))
			: Promise.resolve({ data: [] }),
	]);
	[...(pd || []), ...(cd || []), ...(pld || [])].forEach((row) => {
		map[row.id] = row.author_id;
	});
	return rows.map((r) => ({
		...r,
		target_author_id: map[r.target_id] || null,
	}));
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
			return res.status(200).json(enriched);
		}

		if (req.method === "POST") {
			const b = req.body || {};
			// P0 SECURITY FIX: Derive author_id from x-anon-id header, NOT from client body
			const headerId = clean(req.headers["x-anon-id"] || "", 40);
			const admin = await isAdmin(req);
			const author_id = headerId || (admin ? "ADMIN" : "");
			if (!author_id)
				return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });
			const gate = await checkUser(author_id);
			if (!gate.ok) return res.status(403).json({ error: gate.error });
			if (await rateLimited("reports", author_id, 300, 10)) {
				return rateLimitResponse(
					res,
					300,
					"Slow down — max 10 reports per 5 minutes.",
				);
			}
			const target_type = ["post", "comment", "poll"].includes(b.target_type)
				? b.target_type
				: "post";
			const row = {
				target_id: clean(b.target_id, 60),
				target_type,
				reason: clean(b.reason, 300) || "No reason given",
				author_id,
			};
			if (!row.target_id)
				return res.status(400).json({ error: "Missing target" });
			const { data, error } = await supabase
				.from("reports")
				.insert(row)
				.select()
				.single();
			if (error) throw error;

			// ── Real moderation work happens HERE, right after the report lands ──
			// Ensure the reporter has a users_meta row (heartbeat normally does it).
			await ensureUser(author_id);
			const target = await resolveTargetAuthor(target_type, row.target_id);
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
			const { data, error } = await supabase
				.from("reports")
				.update({ status: clean(b.status, 20) || "resolved" })
				.eq("id", b.id)
				.select()
				.single();
			if (error) throw error;
			await auditLog("admin", "resolve_report", String(b.id));
			return res.status(200).json(data);
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "reports");
	}
}
