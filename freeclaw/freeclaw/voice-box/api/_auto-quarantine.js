// ═══════════════════════════════════════════════════════════════════
// 24/7 AUTONOMOUS SAFETY SENTINEL & AUTO-QUARANTINE ENGINE
// ═══════════════════════════════════════════════════════════════════
// Scans published posts across the entire platform 24/7.
// If any post is found to violate safety, privacy, personal name (PII),
// faculty-targeting, gibberish/quality, harassment, or platform policies,
// this agent immediately removes it from public view (hidden = true),
// records the violation audit trail (read back as hidden_by: "agent" and
// quarantine_reason on the API response) until an admin reviews or restores it.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { auditLog, isCronAuthorized, notifyUser } from "./_auth.js";
import { serverModerate } from "./_moderation.js";

const COURTESY_WORDS = new Set([
	"yes", "no", "dear", "hello", "hi", "hey", "thanks", "thank", "sorry",
	"please", "morning", "evening", "afternoon", "excuse", "pardon",
	"welcome", "ok", "okay", "alright", "right", "good", "both", "our",
	"your", "to", "the", "a", "an", "by", "with", "for", "and", "or",
	"you", "me", "us", "them", "all",
]);

const GENERIC_AFTER_TITLE = new Set([
	"here", "there", "said", "told", "asked", "was", "is", "are", "were",
	"did", "does", "do", "has", "have", "had", "can", "could", "will",
	"would", "should", "must", "name", "names", "room", "cabin", "office",
	"desk", "evaluation", "feedback", "meeting", "union", "staff", "student", "students",
	"that", "the", "about", "to", "in", "on", "at", "who", "which", "my", "our", "your", "his", "her",
]);

/**
 * Detects faculty names, teacher references, or personal names in text.
 */
export function detectFacultyOrPersonalName(text) {
	if (!text || typeof text !== "string") return null;

	// 1. Postfix honorifics: "[name] mam/sir/miss" (e.g. "kauli mam", "sharma sir", "gupta ma'am")
	const POSTFIX_HONORIFIC_RE = /\b([a-zA-Z]{3,20})\s+(?:mam|maam|ma'am|madam|sir|miss)\b/gi;
	let match;
	while ((match = POSTFIX_HONORIFIC_RE.exec(text)) !== null) {
		const target = (match[1] || "").toLowerCase();
		if (!COURTESY_WORDS.has(target)) {
			return {
				matched: match[0],
				message: `Faculty/personal name detected ("${match[0]}") — VoiceFlow strictly protects campus anonymity. Real names cannot be published.`,
			};
		}
	}

	// 2. Prefix titles: "tecaher kauli", "teacher kauli", "faculty sharma", "prof verma"
	const PREFIX_TITLE_RE = /\b(?:teacher|tecaher|techer|teachr|faculty|faclty|faculity|prof|proff|professor|principal|princpal|headmaster|headmistress|warden|hod|dean)\s+([a-zA-Z]{2,20})\b/gi;
	while ((match = PREFIX_TITLE_RE.exec(text)) !== null) {
		const word = (match[1] || "").toLowerCase();
		if (word && !GENERIC_AFTER_TITLE.has(word)) {
			return {
				matched: match[0],
				message: `Teacher/faculty name detected ("${match[0]}") — VoiceFlow strictly protects campus anonymity. Real names cannot be published.`,
			};
		}
	}

	// 3. Combined teacher + name + honorific ("tecaher kauli mam", "teacher sharma sir")
	const TEACHER_NAME_MAM_RE = /\b(?:tecaher|teacher|techer|teachr|faculty|faclty|prof|proff)\s+([a-zA-Z]{2,20})\s+(?:mam|maam|ma'am|madam|sir|miss)\b/i;
	const tMatch = text.match(TEACHER_NAME_MAM_RE);
	if (tMatch) {
		return {
			matched: tMatch[0],
			message: `Teacher name detected ("${tMatch[0]}") — VoiceFlow is strictly anonymous. Real names cannot be published.`,
		};
	}

	// 4. Reporting/complaining phrase naming a teacher/staff ("told our tecaher kauli mam")
	const REPORT_NAME_RE = /\b(?:told|telling|complained\s+to|spoke\s+to|talked\s+to|informed|reported\s+to|went\s+to)\s+(?:our\s+)?(?:tecaher|teacher|techer|faculty|prof)?\s*([a-zA-Z]{2,20})\s*(?:mam|maam|ma'am|madam|sir|miss)\b/i;
	const rMatch = text.match(REPORT_NAME_RE);
	if (rMatch) {
		return {
			matched: rMatch[0],
			message: `Reporting a named teacher/faculty member ("${rMatch[0]}") — submit privately to administration instead of public posts.`,
		};
	}

	return null;
}

/**
 * Detects keyboard mash, interior punctuation, or corrupted low-quality words.
 */
export function detectGibberishOrLowQuality(text) {
	if (!text || typeof text !== "string") return null;

	// Words with interior punctuation like "shou;d", "asdd;ac"
	const punctuationInWordMatch = text.match(/\b[a-zA-Z]{2,}[;:{}|\\<>[\]~`][a-zA-Z]{1,}\b/);
	if (punctuationInWordMatch) {
		return [
			{
				category: "quality",
				severity: "medium",
				message: `Garbled spelling or punctuation within word ("${punctuationInWordMatch[0]}"). Please use clear, complete words.`,
				matched: punctuationInWordMatch[0],
			},
		];
	}

	// Keyboard mash tokens
	const tokens = text.toLowerCase().split(/\s+/).map((w) => w.replace(/^[^a-z]+|[^a-z]+$/g, "")).filter(Boolean);
	for (const token of tokens) {
		if (token.length >= 6 && /(.)\1{4,}/.test(token)) {
			return [
				{
					category: "quality",
					severity: "medium",
					message: `Repeated character mash ("${token}").`,
					matched: token,
				},
			];
		}
		if (token.length >= 7 && /[bcdfghjklmnpqrstvwxyz]{6,}/i.test(token)) {
			return [
				{
					category: "quality",
					severity: "medium",
					message: `Unpronounceable consonant cluster ("${token}").`,
					matched: token,
				},
			];
		}
	}

	return [];
}

/**
 * Evaluates an existing post record for policy or privacy violations.
 * Returns a decision object indicating whether the post must be quarantined.
 */
export async function evaluatePostForQuarantine(post) {
	if (!post || typeof post !== "object") {
		return { shouldQuarantine: false };
	}

	const title = String(post.title || "").trim();
	const description = String(post.description || "").trim();
	const combined = `${title}\n\n${description}`.trim();

	if (!title) {
		return {
			shouldQuarantine: true,
			reason: "Empty or missing post title",
			rule: "invalid_content",
			severity: "medium",
		};
	}

	// 1. Check for Faculty / Personal Name Privacy Flags
	const facultyHit = detectFacultyOrPersonalName(combined);
	if (facultyHit) {
		return {
			shouldQuarantine: true,
			reason: facultyHit.message,
			rule: "privacy_faculty_name",
			severity: "critical",
			flags: [facultyHit],
		};
	}

	// 2. Gibberish, keyboard mash, or corrupt text (e.g. "we shou;d asddm ac")
	const gibberishFlags = detectGibberishOrLowQuality(combined);
	if (gibberishFlags && gibberishFlags.length > 0) {
		return {
			shouldQuarantine: true,
			reason: gibberishFlags[0]?.message || "Low quality or keyboard mash detected",
			rule: "quality_gibberish",
			severity: "high",
			flags: gibberishFlags,
		};
	}

	// 3. Core Server Moderation Engine (Profanity, Harassment, Hate, Self-harm, Threats, PII)
	const serverMod = serverModerate(title, description);
	if (serverMod.blocked) {
		const worstFlag = serverMod.flags?.[0];
		const flagCategory = worstFlag?.category || worstFlag?.type || "safety";
		const flagReason = worstFlag?.message || worstFlag?.reason || "Violates campus safety policies";
		return {
			shouldQuarantine: true,
			reason: `Content blocked by safety rules: ${flagReason} (${flagCategory})`,
			rule: `moderation_${flagCategory}`,
			severity: "critical",
			flags: serverMod.flags,
		};
	}

	// 4. Targeted Personal Attack or Threat patterns
	const lower = combined.toLowerCase();
	if (
		/i will (find|beat|harm|kill|leak|expose|destroy|ruin) you/i.test(lower) ||
		/watch your back/i.test(lower) ||
		/die in a/i.test(lower)
	) {
		return {
			shouldQuarantine: true,
			reason: "Direct intimidation or threat detected",
			rule: "violence_intimidation",
			severity: "critical",
		};
	}

	// Clean post
	return { shouldQuarantine: false };
}

/**
 * Quarantines a post immediately:
 * - Marks hidden = true
 * - Sets status = "pending_review"
 * - Records the agent and reason in status_history + the audit-tagged
 *   admin_notes line (existing columns only)
 * - Appends to status_history and admin_notes
 * - Logs to security audit log
 */
export async function quarantinePostByAgent(
	post,
	evaluation,
	{ agentName = "24/7 AI Safety Sentinel" } = {},
) {
	if (!post?.id) return { success: false, error: "Missing post id" };

	const now = new Date().toISOString();
	const reason = evaluation.reason || "Flagged for public safety review";
	const auditNote = `[${agentName} Auto-Quarantine]: ${reason} (Rule: ${evaluation.rule || "unknown"})`;

	const statusHistory = Array.isArray(post.status_history)
		? [...post.status_history]
		: [];
	statusHistory.push({
		status: "pending_review",
		at: now,
		by: agentName,
		note: `Auto-quarantined from public view: ${reason}`,
	});

	const adminNotes = post.admin_notes
		? `${post.admin_notes}\n${auditNote}`
		: auditNote;

	// Only columns that exist on `posts`. The old patch also wrote
	// hidden_by / quarantine_reason / quarantined_at, which were never part of
	// the schema: PostgREST rejected EVERY quarantine write with 42703, so the
	// sentinel reported "scanned" but never hid a single post, and the admin
	// "restore" action 500'd for the same reason. Provenance now lives in the
	// audit-tagged admin_notes line (written below) and in status_history,
	// which the admin feed reads back — no schema change required.
	const patch = {
		hidden: true,
		status: "pending_review",
		updated_at: now,
		admin_notes: adminNotes,
		status_history: statusHistory,
	};

	const { error } = await supabase
		.from("posts")
		.update(patch)
		.eq("id", post.id);

	if (error) {
		console.error(`[AutoQuarantine] Failed to quarantine post ${post.id}:`, error);
		return { success: false, error: error.message };
	}

	// Audit trail
	await auditLog(
		"agent_moderation",
		"post_quarantined",
		`${post.id} (${post.title?.slice(0, 50)}): ${reason}`,
	);

	// Notify author privately so they know their post was placed in review.
	// Argument order matters: (anonId, type, title, body, opts) — the old call
	// passed the sentence as the TYPE, so the notice was stored with a
	// sentence for a type and the post id as its body.
	if (post.author_id) {
		await notifyUser(
			post.author_id,
			"moderation",
			"Your post is under review",
			`"${post.title?.slice(0, 40) || "Your post"}" was temporarily placed in review by the safety agent.`,
			{ postId: post.id },
		).catch(() => {});
	}

	return {
		success: true,
		id: post.id,
		hidden: true,
		hidden_by: "agent",
		reason,
	};
}

/**
 * Scans all currently visible comments across the database.
 * Quarantines (hidden = true) any comments violating privacy, faculty name or safety policies.
 */
export async function scanAllPublishedComments({
	limit = 100,
	agentName = "24/7 AI Safety Sentinel",
} = {}) {
	const { data: comments, error } = await supabase
		.from("comments")
		.select("id, post_id, body, author_id, hidden, deleted, created_at")
		.eq("hidden", false)
		.eq("deleted", false)
		.order("created_at", { ascending: false })
		.limit(limit);

	if (error) {
		console.error("[AutoQuarantine] Error fetching comments:", error);
		return { scanned: 0, quarantined: 0, items: [], error: error.message };
	}

	const list = comments || [];
	const quarantinedItems = [];

	for (const comm of list) {
		const text = comm.body || "";
		if (!text.trim()) continue;

		// 1. Faculty / Personal Name
		const facultyHit = detectFacultyOrPersonalName(text);
		// 2. Server Moderation (Profanity, threats, harassment)
		const modHit = serverModerate("", text);

		if (facultyHit || modHit.blocked) {
			const reason = facultyHit?.message || modHit.flags?.[0]?.message || "Violates comment safety policies";
			const { error: updErr } = await supabase
				.from("comments")
				.update({ hidden: true })
				.eq("id", comm.id);

			if (!updErr) {
				quarantinedItems.push({
					id: comm.id,
					post_id: comm.post_id,
					reason,
					type: "comment",
				});
				await auditLog(
					"agent_moderation",
					"comment_quarantined",
					`Comment ${comm.id} on post ${comm.post_id}: ${reason} by ${agentName}`,
				).catch(() => {});
			}
		}
	}

	return {
		scanned: list.length,
		quarantined: quarantinedItems.length,
		items: quarantinedItems,
	};
}

/**
 * Scans all active polls across the platform.
 * Archives / deletes any poll whose title or options contain inappropriate content.
 */
export async function scanAllPublishedPolls({
	limit = 50,
	agentName = "24/7 AI Safety Sentinel",
} = {}) {
	const { data: polls, error } = await supabase
		.from("polls")
		.select("id, title, options, deleted, archived, created_at")
		.eq("deleted", false)
		.eq("archived", false)
		.order("created_at", { ascending: false })
		.limit(limit);

	if (error) {
		console.error("[AutoQuarantine] Error fetching polls:", error);
		return { scanned: 0, quarantined: 0, items: [], error: error.message };
	}

	const list = polls || [];
	const quarantinedItems = [];

	for (const poll of list) {
		let optText = "";
		if (Array.isArray(poll.options)) {
			optText = poll.options.map((o) => typeof o === "string" ? o : o?.text || o?.title || "").join(" ");
		}
		const combined = `${poll.title || ""} ${optText}`.trim();
		if (!combined) continue;

		const facultyHit = detectFacultyOrPersonalName(combined);
		const modHit = serverModerate(poll.title || "", optText);

		if (facultyHit || modHit.blocked) {
			const reason = facultyHit?.message || modHit.flags?.[0]?.message || "Violates poll safety policies";
			const { error: updErr } = await supabase
				.from("polls")
				.update({ archived: true, deleted: true })
				.eq("id", poll.id);

			if (!updErr) {
				quarantinedItems.push({
					id: poll.id,
					title: poll.title,
					reason,
					type: "poll",
				});
				await auditLog(
					"agent_moderation",
					"poll_quarantined",
					`Poll ${poll.id} (${poll.title?.slice(0, 40)}): ${reason} by ${agentName}`,
				).catch(() => {});
			}
		}
	}

	return {
		scanned: list.length,
		quarantined: quarantinedItems.length,
		items: quarantinedItems,
	};
}

/**
 * Scans all currently public, non-hidden published posts in the database.
 * Quarantines any posts that violate current safety policies.
 */
export async function scanAllPublishedPosts({
	limit = 100,
	agentName = "24/7 AI Safety Sentinel",
} = {}) {
	// Query active public posts
	const { data: posts, error } = await supabase
		.from("posts")
		.select("*")
		.eq("hidden", false)
		.eq("deleted", false)
		.order("created_at", { ascending: false })
		.limit(limit);

	if (error) {
		console.error("[AutoQuarantine] Error fetching published posts:", error);
		return { scanned: 0, quarantined: 0, error: error.message };
	}

	const list = posts || [];
	const quarantinedItems = [];

	for (const post of list) {
		const evaluation = await evaluatePostForQuarantine(post);
		if (evaluation.shouldQuarantine) {
			const res = await quarantinePostByAgent(post, evaluation, { agentName });
			if (res.success) {
				quarantinedItems.push({
					id: post.id,
					title: post.title,
					category: post.category,
					reason: evaluation.reason,
					rule: evaluation.rule,
					type: "post",
				});
			}
		}
	}

	// Also perform safety scans on active comments and polls for full platform immunity
	const [commResult, pollResult] = await Promise.all([
		scanAllPublishedComments({ limit: Math.min(limit, 50), agentName }),
		scanAllPublishedPolls({ limit: Math.min(limit, 30), agentName }),
	]);

	const totalQuarantined = quarantinedItems.length + commResult.quarantined + pollResult.quarantined;
	const allItems = [...quarantinedItems, ...commResult.items, ...pollResult.items];

	return {
		scanned: list.length + commResult.scanned + pollResult.scanned,
		quarantined: totalQuarantined,
		posts_quarantined: quarantinedItems.length,
		comments_quarantined: commResult.quarantined,
		polls_quarantined: pollResult.quarantined,
		items: allItems,
		timestamp: new Date().toISOString(),
	};
}

/**
 * API route handler for /api/quarantine-scan:
 * Allows administrators or automated cron triggers to initiate a scan across published posts.
 */
export default async function handler(req, res) {
	if (req.method === "OPTIONS") {
		return res.status(204).end();
	}

	// Header PRESENCE is not authorization. The old check accepted any value in
	// `x-admin-token` (or a bare `x-vercel-cron: 1`) and would let an
	// unauthenticated caller mass-quarantine the whole feed. isCronAuthorized
	// compares CRON_SECRET constant-time and falls back to a real admin
	// session, failing closed.
	if (!(await isCronAuthorized(req))) {
		return res.status(401).json({ error: "Unauthorized: admin or cron authorization required" });
	}

	const limit = Math.min(200, Math.max(1, parseInt(String(req.query?.limit || req.body?.limit || "100"), 10)));
	const result = await scanAllPublishedPosts({ limit });

	return res.status(200).json({
		ok: true,
		...result,
	});
}
