// ═══════════════════════════════════════════════════════════════════
// 24/7 AUTONOMOUS SAFETY SENTINEL & AUTO-QUARANTINE ENGINE
// ═══════════════════════════════════════════════════════════════════
// Scans published posts across the entire platform 24/7.
// If any post is found to violate safety, privacy, personal name (PII),
// faculty-targeting, gibberish/quality, harassment, or platform policies,
// this agent immediately removes it from public view (hidden = true),
// records the violation audit trail, and marks it as 'hidden_by: agent'
// until an admin explicitly reviews or restores it.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { auditLog, notifyUser } from "./_auth.js";
import { serverModerate } from "./_moderation.js";
import {
	moderateContent,
	detectGibberishOrLowQuality,
} from "../src/lib/moderation.ts";

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
	const category = String(post.category || "Other");
	const combined = `${title}\n\n${description}`.trim();

	if (!title) {
		return {
			shouldQuarantine: true,
			reason: "Empty or missing post title",
			rule: "invalid_content",
			severity: "medium",
		};
	}

	// 1. Comprehensive Client/Server Content Moderation
	const modRes = moderateContent(combined);
	const serverMod = serverModerate(title, description);

	// Check for Faculty / Personal Name Privacy Flags
	const facultyHit =
		(modRes.privacyFlags && modRes.privacyFlags.length > 0) ||
		(serverMod.flags &&
			serverMod.flags.some(
				(f) =>
					(f.type === "privacy" || f.category === "privacy") &&
					(f.message?.toLowerCase().includes("name") ||
						f.message?.toLowerCase().includes("teacher") ||
						f.message?.toLowerCase().includes("faculty") ||
						f.message?.toLowerCase().includes("sir") ||
						f.message?.toLowerCase().includes("mam")),
			));

	if (facultyHit) {
		const msg =
			modRes.privacyFlags?.[0]?.message ||
			serverMod.flags?.find((f) => f.type === "privacy" || f.category === "privacy")?.message ||
			"Privacy violation: contains faculty or personal name";
		return {
			shouldQuarantine: true,
			reason: msg,
			rule: "privacy_faculty_name",
			severity: "critical",
			flags: modRes.privacyFlags || serverMod.flags,
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

	// 4. Blocked flags from unified moderateContent
	if (modRes.blocked || modRes.coercionBlock) {
		const worstFlag = modRes.flags?.[0];
		return {
			shouldQuarantine: true,
			reason: worstFlag?.message || "Violates platform safety policy",
			rule: worstFlag?.category || "safety_violation",
			severity: "critical",
			flags: modRes.flags,
		};
	}

	// 5. Targeted Personal Attack or Threat patterns
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
 * - Marks hidden = true, hidden_by = "agent"
 * - Sets status = "pending_review"
 * - Stores quarantine_reason and timestamp
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

	const patch = {
		hidden: true,
		hidden_by: "agent",
		quarantine_reason: reason,
		quarantined_at: now,
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

	// Notify author privately so they know their post was placed in review
	if (post.author_id) {
		await notifyUser(
			post.author_id,
			`Your post "${post.title?.slice(0, 40)}" was temporarily placed in review by the safety agent.`,
			"moderation",
			post.id,
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
				});
			}
		}
	}

	return {
		scanned: list.length,
		quarantined: quarantinedItems.length,
		items: quarantinedItems,
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

	const isCron = req.headers["x-vercel-cron"] || req.query?.cron === "1";
	const hasAdmin = Boolean(req.headers["x-admin-token"] || req.admin);

	if (!isCron && !hasAdmin) {
		return res.status(401).json({ error: "Unauthorized: admin or cron authorization required" });
	}

	const limit = Math.min(200, Math.max(1, parseInt(String(req.query?.limit || req.body?.limit || "100"), 10)));
	const result = await scanAllPublishedPosts({ limit });

	return res.status(200).json({
		ok: true,
		...result,
	});
}
