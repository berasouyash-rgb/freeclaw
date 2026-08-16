// Approval-only AI Agent.
// The agent can DRAFT suggestions (status changes, replies, escalations, merges)
// but can NEVER act on the database itself. Every suggestion requires explicit
// admin approval; approving applies the change and writes a permanent audit log.
// Suggestions expire after 48 hours automatically.

import { auditLog, clean, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import {
	EXECUTABLE_SUGGESTION_KINDS,
	PROACTIVE_SUGGESTION_KINDS,
} from "./_suggestion-kinds.js";

const EXPIRY_MS = 48 * 60 * 60 * 1000;
const ADVISORY_EXPIRY_MS = 24 * 60 * 60 * 1000; // informational notes age out fast
const DAY = 86400000;

// Kinds that must NOT be force-expired at the fast 24h advisory rate:
// executable actions (they await real approval) and proactive detections
// (legit findings with their own AiPanel UI and suggestedActions).
export const KEEP_KINDS = [
	...EXECUTABLE_SUGGESTION_KINDS,
	...PROACTIVE_SUGGESTION_KINDS,
];

/** Push an in-app warning notification (mirrors _reports.js / _admin.js). */
async function notifyUser(anonId, type, title, body) {
	if (!anonId || anonId === "ADMIN") return;
	try {
		const key = `notifications:${anonId}`;
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", key)
			.maybeSingle();
		const notifications = data?.value?.notifications || [];
		notifications.unshift({
			id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
			type,
			title,
			body,
			read: false,
			created_at: new Date().toISOString(),
		});
		await supabase
			.from("settings")
			.upsert(
				{
					key,
					value: {
						notifications: notifications.slice(0, 100),
						updated_at: new Date().toISOString(),
					},
				},
				{ onConflict: "key" },
			);
	} catch (e) {
		console.error("notifyUser error:", e.message);
	}
}

/**
 * Heuristic suggestion generator — now covers the FULL moderation surface:
 * posts (escalation/verify/reply/merge), reports (triage, orphan closes),
 * users (strike escalation, at-risk warn/suspend), flagged comments, and
 * the pre-publish review queue. Deterministic; returns ranked suggestions.
 */
function generateSuggestions({ posts, reports, users, comments, preReviews }) {
	const out = [];
	const now = Date.now();
	const urgentWords =
		/\b(urgent|danger|unsafe|injur|threat|bully|harass|emergency|fire|leak|assault)\b/i;

	// ── Post suggestions ──────────────────────────────────────────
	for (const p of posts) {
		if (p.deleted || p.hidden || p.type !== "problem") continue;
		const support = p.reactions?.support || 0;
		const comments = p.comment_count || 0;
		const ageDays = (now - +new Date(p.created_at)) / DAY;

		if (
			p.status === "reported" &&
			(urgentWords.test(p.title + " " + p.description) ||
				["Bullying", "Security", "Medical"].includes(p.category)) &&
			p.priority !== "critical"
		) {
			out.push({
				kind: "escalation",
				target_id: p.id,
				critical: true,
				title: `Escalate “${p.title}” to critical priority`,
				content: { field: "priority", from: p.priority, to: "critical" },
				confidence: 0.8,
				reasoning: `“${p.title}” is in a safety-sensitive category (${p.category}) or contains urgency language, but is still priority “${p.priority}” and unverified after ${ageDays.toFixed(1)} day(s). Recommend escalating to critical.`,
			});
		}

		if (
			p.status === "reported" &&
			(support >= 3 || comments >= 3) &&
			ageDays > 0.5
		) {
			out.push({
				kind: "status_change",
				target_id: p.id,
				critical: false,
				title: `Mark “${p.title}” as Verified`,
				content: { field: "status", from: p.status, to: "verified" },
				confidence: 0.72,
				reasoning: `“${p.title}” has ${support} supports and ${comments} comments but hasn't been triaged in ${ageDays.toFixed(1)} day(s). Recommend marking as Verified to show the community it was seen.`,
			});
		}

		if (p.status === "solved" && !p.admin_reply) {
			out.push({
				kind: "reply",
				target_id: p.id,
				critical: false,
				title: `Post an official reply on “${p.title}”`,
				content: {
					field: "admin_reply",
					from: "",
					to: `This issue has been resolved. Thank you for reporting “${p.title}” — please let us know if it happens again.`,
				},
				confidence: 0.75,
				reasoning: `“${p.title}” was marked solved but has no official reply. A short public reply closes the loop and builds trust.`,
			});
		}
	}

	// ── Merge suggestions: strong word overlap in same category ──
	const words = (t) =>
		new Set(
			String(t)
				.toLowerCase()
				.split(/\W+/)
				.filter((w) => w.length > 4),
		);
	const open = posts.filter(
		(p) => !p.deleted && !p.hidden && !p.merged_into && p.type === "problem",
	);
	for (let i = 0; i < open.length; i++) {
		for (let j = i + 1; j < open.length; j++) {
			if (open[i].category !== open[j].category) continue;
			const wi = words(open[i].title + " " + open[i].description);
			const wj = words(open[j].title + " " + open[j].description);
			const overlap = [...wi].filter((w) => wj.has(w)).length;
			if (overlap >= 4) {
				const [keep, dup] =
					(open[i].reactions?.support || 0) >= (open[j].reactions?.support || 0)
						? [open[i], open[j]]
						: [open[j], open[i]];
				out.push({
					kind: "merge",
					target_id: dup.id,
					critical: false,
					title: `Merge “${dup.title}” into “${keep.title}”`,
					content: {
						field: "merged_into",
						from: "",
						to: keep.id,
						keep_title: keep.title,
					},
					confidence: 0.65,
					reasoning: `“${dup.title}” appears to duplicate “${keep.title}” (${overlap} shared key words, same category). Merging combines their support.`,
				});
				break;
			}
		}
	}

	// ── Report triage ─────────────────────────────────────────────
	const pendingReports = (reports || []).filter((r) => r.status === "pending");
	const byTarget = {};
	pendingReports.forEach((r) => {
		byTarget[r.target_id] = byTarget[r.target_id] || [];
		byTarget[r.target_id].push(r);
	});
	for (const [targetId, list] of Object.entries(byTarget)) {
		const p = posts.find((x) => x.id === targetId);
		const ageDays = list.reduce(
			(a, r) => Math.max(a, (now - +new Date(r.created_at)) / DAY),
			0,
		);
		// 2+ independent reports on the same post → escalate to high for review
		if (
			list.length >= 2 &&
			p &&
			!p.hidden &&
			!p.deleted &&
			p.priority !== "high" &&
			p.priority !== "critical"
		) {
			out.push({
				kind: "escalation",
				target_id: targetId,
				critical: false,
				title: `Multiple reports on “${p.title}”`,
				content: { field: "priority", from: p.priority, to: "high" },
				confidence: 0.85,
				reasoning: `“${p.title}” received ${list.length} independent reports. Escalating to high priority so it gets reviewed first.`,
			});
		}
		// Stale pending reports (> 7 days) → auto-resolve them
		if (ageDays > 7) {
			out.push({
				kind: "resolve_report",
				target_id: targetId,
				critical: false,
				title: `Close ${list.length} stale report(s) on “${(p?.title || targetId).slice(0, 40)}”`,
				content: {
					field: "reports",
					from: "pending",
					to: "auto_resolved",
					report_ids: list.map((r) => r.id),
				},
				confidence: 0.6,
				reasoning: `${list.length} report(s) on this target have been pending for ${ageDays.toFixed(1)} day(s). Closing them keeps the queue focused on fresh issues.`,
			});
		}
	}

	// ── User moderation (strike ladder) ───────────────────────────
	for (const u of users || []) {
		if (u.banned || u.anon_id === "ADMIN") continue;
		const strikes = u.strikes || 0;
		const suspended =
			u.suspended_until && new Date(u.suspended_until) > new Date();
		if (suspended) continue;
		// 2 strikes → suggest a manual warning review
		if (strikes >= 2 && strikes < 3) {
			out.push({
				kind: "user_warn",
				target_id: u.anon_id,
				target_type: "user",
				critical: false,
				title: `User ${u.anon_id.slice(0, 10)}… has ${strikes} strikes — review`,
				content: {
					field: "strikes",
					from: strikes,
					to: strikes,
					author_id: u.anon_id,
				},
				confidence: 0.7,
				reasoning: `This anonymous user has ${strikes} strikes. A manual warning (or letting the next auto-strike suspend them) keeps repeat offenders in check.`,
			});
		}
		// 3+ strikes and still active → suggest a 7-day suspension
		if (strikes >= 3 && !u.banned) {
			out.push({
				kind: "user_suspend",
				target_id: u.anon_id,
				target_type: "user",
				critical: true,
				title: `Suspend user ${u.anon_id.slice(0, 10)}… (${strikes} strikes)`,
				content: {
					field: "suspended_until",
					from: "—",
					to: "+7 days",
					author_id: u.anon_id,
				},
				confidence: 0.82,
				reasoning: `This user has accumulated ${strikes} strikes without cooling down. A 7-day suspension protects the community while staying reversible.`,
			});
		}
	}

	// ── Flagged comment moderation ────────────────────────────────
	for (const c of comments || []) {
		if (c.deleted || c.hidden) continue;
		const ageDays = (now - +new Date(c.created_at)) / DAY;
		if (c.flagged && ageDays < 14) {
			out.push({
				kind: "hide_comment",
				target_id: c.id,
				target_type: "comment",
				critical: false,
				title: `Hide flagged comment on “${(posts.find((p) => p.id === c.post_id)?.title || c.post_id).slice(0, 40)}”`,
				content: { field: "hidden", from: false, to: true, comment_id: c.id },
				confidence: 0.68,
				reasoning: `A comment was flagged by the moderation engine. Hiding it removes it from the thread without deleting the record.`,
			});
		}
	}

	// ── Pre-publish review queue aging ────────────────────────────
	for (const pr of preReviews || []) {
		const ageDays = (now - +new Date(pr.created_at || now)) / DAY;
		if (ageDays > 1) {
			out.push({
				kind: "review_decision",
				target_id: pr.key,
				target_type: "review",
				critical: false,
				title: `Decide on review item “${String(pr.title || pr.content_type || "content").slice(0, 40)}”`,
				content: {
					field: "decision",
					from: "pending",
					to: "approve|reject",
					review_key: pr.key,
				},
				confidence: 0.55,
				reasoning: `This pre-publish review item has waited ${ageDays.toFixed(1)} day(s). Approve, reject, or keep it private to clear the queue.`,
			});
		}
	}

	// Rank: critical first, then confidence, then age
	return out
		.sort(
			(a, b) =>
				(b.critical ? 1 : 0) - (a.critical ? 1 : 0) ||
				(b.confidence || 0) - (a.confidence || 0),
		)
		.slice(0, 12);
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		if (req.method === "GET") {
			// auto-expire old suggestions (48h) and stale advisory notes (24h —
			// informational only, they must not clutter the approval queue).
			const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
			await supabase
				.from("agent_suggestions")
				.update({ status: "expired" })
				.eq("status", "pending")
				.lt("created_at", cutoff);
			const advisoryCutoff = new Date(
				Date.now() - ADVISORY_EXPIRY_MS,
			).toISOString();
			await supabase
				.from("agent_suggestions")
				.update({ status: "expired" })
				.eq("status", "pending")
				.lt("created_at", advisoryCutoff)
				.not("kind", "in", `("${KEEP_KINDS.join('","')}")`);
			const { data, error } = await supabase
				.from("agent_suggestions")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(100);
			if (error) throw error;
			return res.status(200).json(data);
		}

		const b = req.body || {};

		if (req.method === "POST" && b.action === "generate") {
			const [postsRes, reportsRes, usersRes, commentsRes, reviewRes] =
				await Promise.all([
					supabase.from("posts").select("*").limit(1000),
					supabase.from("reports").select("*").limit(200),
					supabase
						.from("users_meta")
						.select("anon_id,strikes,warnings,banned,suspended_until")
						.limit(500),
					supabase
						.from("comments")
						.select("id,post_id,flagged,hidden,deleted,created_at")
						.eq("deleted", false)
						.limit(500),
					supabase
						.from("settings")
						.select("key,value")
						.like("key", "pre_publish_review:%")
						.limit(50),
				]);
			const posts = postsRes.data || [];
			// enrich posts with real engagement counts
			const ids = posts.map((p) => p.id);
			const [{ data: reactions }, { data: comments }] = await Promise.all([
				supabase
					.from("reactions")
					.select("target_id,kind")
					.in("target_id", ids.length ? ids : ["_"]),
				supabase
					.from("comments")
					.select("post_id")
					.in("post_id", ids.length ? ids : ["_"])
					.eq("deleted", false),
			]);
			const rMap = {};
			const cMap = {};
			(reactions || []).forEach((r) => {
				rMap[r.target_id] = rMap[r.target_id] || {};
				rMap[r.target_id][r.kind] = (rMap[r.target_id][r.kind] || 0) + 1;
			});
			(comments || []).forEach((c) => {
				cMap[c.post_id] = (cMap[c.post_id] || 0) + 1;
			});
			const enriched = posts.map((p) => ({
				...p,
				reactions: rMap[p.id] || {},
				comment_count: cMap[p.id] || 0,
			}));

			const suggestions = generateSuggestions({
				posts: enriched,
				reports: reportsRes.data || [],
				users: usersRes.data || [],
				comments: commentsRes.data || [],
				preReviews: (reviewRes.data || []).map((row) => ({
					key: row.key,
					...row.value,
				})),
			});
			// skip ones already pending for the same target+kind
			const { data: existing } = await supabase
				.from("agent_suggestions")
				.select("target_id,kind")
				.eq("status", "pending");
			const dupe = new Set(
				(existing || []).map((e) => `${e.kind}:${e.target_id}`),
			);
			const fresh = suggestions.filter(
				(s) => !dupe.has(`${s.kind}:${s.target_id}`),
			);
			if (fresh.length) {
				const { error } = await supabase.from("agent_suggestions").insert(
					fresh.map((s) => ({
						kind: s.kind,
						target_id: s.target_id,
						target_type: "post",
						title: s.title,
						content: s.content,
						confidence: s.confidence,
						reasoning: s.reasoning,
						critical: s.critical,
						status: "pending",
					})),
				);
				if (error) throw error;
			}
			await auditLog(
				"ai-agent",
				"generate_suggestions",
				`${fresh.length} new suggestion(s) drafted (read-only; awaiting admin approval)`,
			);
			return res.status(200).json({ created: fresh.length });
		}

		if (req.method === "PUT") {
			const { data: sug } = await supabase
				.from("agent_suggestions")
				.select("*")
				.eq("id", b.id)
				.maybeSingle();
			if (!sug) return res.status(404).json({ error: "Suggestion not found" });
			// Idempotent: dismissing/approving an already-resolved suggestion is a
			// no-op, not an error — a stale list, an expired suggestion, or a
			// double-click must not surface a 400 to the admin.
			if (sug.status !== "pending")
				return res.status(200).json({ ok: true, already: true });

			if (b.action === "dismiss") {
				await supabase
					.from("agent_suggestions")
					.update({
						status: "dismissed",
						resolved_at: new Date().toISOString(),
						outcome: "Dismissed by admin — no action was taken.",
					})
					.eq("id", b.id);
				await auditLog(
					"admin",
					"agent_dismiss",
					`Dismissed AI suggestion #${b.id} (${sug.kind}): ${String(sug.title || sug.reasoning).slice(0, 120)}`,
				);
				return res.status(200).json({ ok: true });
			}

			if (b.action === "approve") {
				// Critical suggestions require the confirmed flag (second-step confirmation)
				if (sug.critical && b.confirmed !== true) {
					return res
						.status(400)
						.json({
							error:
								"This is a critical/safety suggestion — second-step confirmation required.",
						});
				}
				const p = sug.content || {};
				let outcome = "";

				// ── User moderation (warn / suspend) ─────────────────────
				if (sug.kind === "user_warn") {
					const authorId = p.author_id || sug.target_id;
					const { data: meta } = await supabase
						.from("users_meta")
						.select("*")
						.eq("anon_id", authorId)
						.maybeSingle();
					const warnings = Array.isArray(meta?.warnings) ? meta.warnings : [];
					warnings.push({
						text: "Warning applied from AI suggestion (admin approved)",
						at: new Date().toISOString(),
						source: "agent",
					});
					const { error } = await supabase
						.from("users_meta")
						.update({
							warnings,
							strikes: (meta?.strikes || 0) + 1,
							last_seen: new Date().toISOString(),
						})
						.eq("anon_id", authorId);
					if (error) throw error;
					await notifyUser(
						authorId,
						"warning",
						"Official warning issued",
						"A moderator reviewed your account and issued a warning. Repeated issues may lead to suspension.",
					);
					outcome = `Approved — warned user ${authorId} (strike +1)`;
				} else if (sug.kind === "user_suspend") {
					const authorId = p.author_id || sug.target_id;
					const { error } = await supabase
						.from("users_meta")
						.update({
							suspended_until: new Date(Date.now() + 7 * DAY).toISOString(),
							last_seen: new Date().toISOString(),
						})
						.eq("anon_id", authorId);
					if (error) throw error;
					await notifyUser(
						authorId,
						"warning",
						"Account temporarily suspended",
						"Your anonymous ID is suspended for 7 days after review by the moderation team.",
					);
					outcome = `Approved — suspended user ${authorId} for 7 days`;
				} else if (sug.kind === "hide_comment") {
					const { error } = await supabase
						.from("comments")
						.update({ hidden: true })
						.eq("id", p.comment_id || sug.target_id);
					if (error) throw error;
					outcome = `Approved — hid flagged comment ${p.comment_id || sug.target_id}`;
				} else if (sug.kind === "resolve_report") {
					const ids =
						Array.isArray(p.report_ids) && p.report_ids.length
							? p.report_ids
							: [sug.target_id];
					const { error } = await supabase
						.from("reports")
						.update({ status: p.to || "auto_resolved" })
						.in("id", ids);
					if (error) throw error;
					outcome = `Approved — resolved ${ids.length} report(s) on ${sug.target_id}`;
				} else if (sug.kind === "review_decision") {
					// Approving a review-decision suggestion is a REMINDER, not a
					// destructive action: the pending content must never be deleted
					// without an explicit publish/reject choice (data-loss guard). The
					// admin decides in Reports → Pre-publish; we only clear the nudge.
					outcome = `Noted — decide on ${p.review_key || sug.target_id} in Reports → Pre-publish (content kept; no action taken)`;
				} else {
					// ── Post suggestions (status / priority / reply / merge) ──
					// Guard: ONLY these five kinds may write a posts-table patch. Any
					// other kind reaching here is a free-text/advisory suggestion
					// (LLM-generated, e.g. 'enforcement'/'policy'/'stale_report') with
					// NO executable action — approving must fail loudly instead of
					// silently writing an empty patch and logging a fake completion.
					if (
						![
							"status_change",
							"solved_confirm",
							"escalation",
							"reply",
							"merge",
						].includes(sug.kind)
					) {
						return res.status(400).json({
							error: `“${sug.kind}” is an advisory suggestion with no executable action — dismiss it to clear the queue (no state was changed).`,
						});
					}
					const patch = {};
					const targetStatus = p.to || p.status;
					if (sug.kind === "status_change" || sug.kind === "solved_confirm") {
						patch.status = targetStatus;
						const map = {
							reported: 5,
							verified: 20,
							in_progress: 50,
							waiting: 70,
							solved: 100,
							archived: 100,
						};
						patch.progress = map[targetStatus] ?? 20;
						const { data: post } = await supabase
							.from("posts")
							.select("status_history")
							.eq("id", sug.target_id)
							.maybeSingle();
						patch.status_history = [
							...(post?.status_history || []),
							{
								status: targetStatus,
								at: new Date().toISOString(),
								note:
									p.status_note ||
									"Applied from AI suggestion (admin approved)",
							},
						];
					}
					if (sug.kind === "escalation") patch.priority = p.to || "critical";
					if (sug.kind === "reply")
						patch.admin_reply = clean(b.edited_text, 1000) || p.to || p.reply;
					if (sug.kind === "merge") {
						patch.merged_into = p.to || p.merge_into;
						patch.hidden = true;
					}
					patch.updated_at = new Date().toISOString();
					const { error } = await supabase
						.from("posts")
						.update(patch)
						.eq("id", sug.target_id);
					if (error) throw error;
					outcome = `Approved by admin — applied ${sug.kind} on ${sug.target_id} (${p.from || "—"} → ${String(p.to || targetStatus).slice(0, 60)})`;
				}

				await supabase
					.from("agent_suggestions")
					.update({
						status: "approved",
						resolved_at: new Date().toISOString(),
						outcome,
					})
					.eq("id", b.id);
				await auditLog(
					"admin",
					"agent_approve",
					`Approved AI suggestion #${b.id} (${sug.kind}) on ${sug.target_id}: ${outcome.slice(0, 80)}`,
				);
				return res.status(200).json({ ok: true });
			}

			return res.status(400).json({ error: "Unknown action" });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "agent");
	}
}
