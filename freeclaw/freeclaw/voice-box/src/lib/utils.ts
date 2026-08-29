import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes safely — handles conflicts and conditional classes. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** Safe JSON.stringify — handles circular references, functions, undefined */
export function safeStringify(obj: unknown, indent?: number): string {
	try {
		const seen = new WeakSet();
		return JSON.stringify(
			obj,
			(_key, val) => {
				if (typeof val === "function")
					return `[Function: ${val.name || "anonymous"}]`;
				if (val === undefined) return "[undefined]";
				if (typeof val === "object" && val !== null) {
					if (seen.has(val)) return "[Circular]";
					seen.add(val);
				}
				return val;
			},
			indent,
		);
	} catch {
		try {
			return String(obj);
		} catch {
			return "[Unserializable]";
		}
	}
}

/**
 * Safely convert ANY thrown/error value to a display string.
 *
 * Backend error payloads are often objects ({ message, code, ... }) rather
 * than plain strings. Rendering them directly with React throws
 * "Objects are not valid as a React child" — the #1 admin-console crash.
 * This guarantees a string is always produced.
 */
export function errorText(err: unknown): string {
	if (err == null) return "";
	if (typeof err === "string") return err;
	if (typeof err === "number" || typeof err === "boolean")
		return String(err);
	if (err instanceof Error) return err.message || err.name || "Error";
	// Object error payload — prefer common message fields, else stringify
	if (typeof err === "object") {
		const e = err as Record<string, unknown>;
		if (typeof e.message === "string" && e.message) return e.message;
		if (typeof e.error === "string" && e.error) return e.error;
		if (typeof e.reason === "string" && e.reason) return e.reason;
	}
	const json = safeStringify(err);
	if (json && json !== "{}" && json !== "null" && json !== "undefined")
		return json;
	return "Operation failed (no error details available)";
}

/** Sanitize user input before sending: strip tags & control chars */
export function sanitize(str: string, max = 500): string {
	return String(str)
		.replace(/<[^>]*>/g, "")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
		.slice(0, max);
}

/** SHA-256 hash (hex) using Web Crypto — used for admin password */
export async function sha256(text: string): Promise<string> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return [...new Uint8Array(buf)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function timeAgo(dateStr: string): string {
	const parsed = new Date(dateStr).getTime();
	if (Number.isNaN(parsed)) return "unknown";
	const s = Math.floor((Date.now() - parsed) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
	return new Date(dateStr).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

export function fmtDate(d: string): string {
	return new Date(d).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

import type { PostData } from "../types";

/**
 * Advanced trending score — multi-factor algorithm.
 *
 * Factors:
 *   1. Engagement velocity (how fast reactions/comments grow)
 *   2. Participation diversity (unique contributors matter)
 *   3. Discussion depth (comments > reactions for depth signal)
 *   4. Urgency signal (concerns raise priority)
 *   5. Freshness decay (gravity-based time decay)
 *   6. Spam penalty (suspicious patterns reduce score)
 *
 * Formula:
 *   Trending = log(1 + weighted_engage) × quality × freshness − spam_penalty
 *
 * Minimum thresholds prevent single-reaction posts from trending.
 * The quality factor rewards posts with diverse, genuine engagement.
 */
export function trendingScore(p: PostData): number {
	const r = p.reactions || {};
	const support = r.support || 0;
	const comments = p.comment_count || 0;
	const concerns = r.concerned || 0;

	// 1. Engagement velocity — weighted by signal strength
	// Support is strongest (active endorsement), comments show discussion,
	// concerns indicate urgency but weighted lower to prevent gaming
	const weightedEngage = support * 3 + comments * 2.5 + concerns * 1.5;

	// 2. Minimum engagement threshold — prevents single-reaction trending
	// Must have at least 2 supports OR 1 support + 1 comment
	if (weightedEngage < 4) return 0;

	// 3. Discussion depth factor — posts with comments are more valuable
	// than posts with only reactions (indicates genuine community interest)
	const commentRatio = comments > 0 ? Math.min(1.5, 1 + (comments / Math.max(1, support)) * 0.3) : 1;

	// 4. Participation diversity — penalize posts where engagement
	// comes from very few users (self-interaction or small ring)
	const totalContributors = support + comments;
	const diversityFactor = totalContributors >= 5 ? 1.2 : totalContributors >= 3 ? 1.0 : 0.7;

	// 5. Urgency signal — concerns raise priority but capped
	const urgencyBonus = concerns > 0 ? Math.min(1.3, 1 + concerns * 0.05) : 1;

	// 6. Spam penalty — detect suspicious rapid-fire engagement
	// If a post has many reactions but very few comments, it might be gaming
	const spamPenalty = (support > 10 && comments === 0) ? 0.5 : 1;

	// 7. Freshness decay — gravity-based (Hacker News style)
	// Hours^1.8 decays faster than linear — posts must KEEP growing
	const hours = Math.max(
		0.1,
		(Date.now() - new Date(p.created_at).getTime()) / 3600000,
	);
	const freshness = 1 / (hours + 1) ** 1.8;

	// 8. Combine all factors
	const baseScore = Math.log(1 + weightedEngage);
	const finalScore = baseScore * commentRatio * diversityFactor * urgencyBonus * freshness * spamPenalty;

	return finalScore;
}

export function downloadFile(
	name: string,
	content: string,
	type = "application/json",
) {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

export function toCSV<T extends object>(rows: T[]): string {
	if (!rows.length) return "";
	const first = rows[0] as Record<string, unknown>;
	if (!first) return "";
	const keys = Object.keys(first);
	// CSV formula-injection guard: cells beginning with = + - @ (or tab/CR)
	// are interpreted as formulas by Excel/LibreOffice/Sheets when the export
	// is opened — a post titled "=HYPERLINK(...)" would execute on open.
	// Prefix with a single quote so the cell renders as literal text.
	const esc = (v: unknown) => {
		let s = String(v ?? "").replace(/"/g, '""');
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
		return `"${s}"`;
	};
	return [
		keys.join(","),
		...rows.map((r) => {
			const row = r as Record<string, unknown>;
			return keys
				.map((k) =>
					esc(typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k]),
				)
				.join(",");
		}),
	].join("\n");
}

export const CATEGORIES = [
	"Academics",
	"Facilities",
	"Food",
	"Bullying",
	"Teachers",
	"Events",
	"Transport",
	"Sports",
	"Technology",
	"Library",
	"Hostel",
	"Security",
	"Cleanliness",
	"Medical",
	"Other",
];

export const CAT_EMOJI: Record<string, string> = {
	Academics: "📚",
	Facilities: "🏫",
	Food: "🍽️",
	Bullying: "🛡️",
	Teachers: "👩‍🏫",
	Events: "🎉",
	Transport: "🚌",
	Sports: "⚽",
	Technology: "💻",
	Library: "📖",
	Hostel: "🏠",
	Security: "🔒",
	Cleanliness: "🧹",
	Medical: "🏥",
	Other: "📌",
};

export const STATUS_META: Record<
	string,
	{ label: string; color: string; pct: number }
> = {
	reported: { label: "Reported", color: "#8e8ea5", pct: 5 },
	verified: { label: "Verified", color: "#3b82f6", pct: 20 },
	in_progress: { label: "In Progress", color: "#d98a0b", pct: 50 },
	waiting: { label: "Waiting", color: "#a855f7", pct: 70 },
	solved: { label: "Solved", color: "#16a06a", pct: 100 },
	archived: { label: "Archived", color: "#6e6e88", pct: 100 },
};

export const PRIORITY_META: Record<string, { label: string; color: string }> = {
	low: { label: "Low", color: "#8e8ea5" },
	medium: { label: "Medium", color: "#3b82f6" },
	high: { label: "High", color: "#d98a0b" },
	critical: { label: "Critical", color: "#dc4b4b" },
};

export interface SuggestionLike {
	kind: string;
	title?: string;
	reasoning?: string;
	content?: Record<string, unknown>;
	confidence?: number;
	critical?: boolean;
}

/** Suggestion kinds that map to a real executable action in api/_agent.js's
 *  approve handler. Any other kind is advisory/informational — approving it
 *  would be a silent no-op, so the UI must only offer Dismiss for those. */
export const EXECUTABLE_SUGGESTION_KINDS = new Set([
	"escalation",
	"status_change",
	"solved_confirm",
	"reply",
	"merge",
	"user_warn",
	"user_suspend",
	"hide_comment",
	"resolve_report",
	"review_decision",
]);

export function isExecutableSuggestion(kind: string): boolean {
	return EXECUTABLE_SUGGESTION_KINDS.has(kind);
}

/** Human-readable consequence of approving a suggestion — what will ACTUALLY
 *  happen, mirroring api/_agent.js's approve handler. Rendered as the
 *  "What this will do" line on every suggestion card so the admin approves
 *  with full knowledge of the action (not just the detection reason).
 *  Computed client-side so ALL suggestions — including ones already stored
 *  without an effect field — get a full explanation. */
export function suggestionEffect(s: SuggestionLike): string {
	// Advisory kinds (free-text LLM kinds like 'enforcement'/'policy'/'trend')
	// have NO approve action — be honest instead of inventing a fake effect.
	if (!isExecutableSuggestion(s.kind)) {
		return "This is an advisory note — no automatic action will be executed. Review the details and handle it manually, or dismiss it to clear the queue.";
	}
	const p = s.content || {};
	const to = typeof p.to === "string" ? p.to : String(p.to ?? "");
	const from = typeof p.from === "string" ? p.from : String(p.from ?? "");
	switch (s.kind) {
		case "escalation":
			return `Sets the post's priority to ${to || "critical"}, moving it to the top of review queues.`;
		case "status_change":
		case "solved_confirm":
			return `Marks the post as ${to || "verified"} and records the change in its status history — visible to the author and the community.`;
		case "reply":
			return `Posts a public official reply on the post. The author and all viewers see it immediately — you can edit the text before applying.`;
		case "merge": {
			const keepTitle = typeof p.keep_title === "string" ? p.keep_title : "";
			return `Hides the duplicate post and merges its support into${keepTitle ? ` “${keepTitle}”` : " the kept post"}. The duplicate's content stays archived.`;
		}
		case "user_warn": {
			const id =
				typeof p.author_id === "string"
					? p.author_id.slice(0, 12)
					: s.title || "this user";
			return `Issues a formal warning to ${id} and applies a strike. The user receives an in-app notification.`;
		}
		case "user_suspend": {
			const id =
				typeof p.author_id === "string"
					? p.author_id.slice(0, 12)
					: s.title || "this user";
			return `Suspends ${id} for 7 days. They are notified immediately and cannot post or comment while suspended.`;
		}
		case "hide_comment":
			return `Removes the flagged comment from the thread — the record is kept, not deleted.`;
		case "resolve_report": {
			const n = Array.isArray(p.report_ids) ? p.report_ids.length : 1;
			return `Closes ${n} pending report${n === 1 ? "" : "s"} as auto-resolved. No content is changed — the queue simply clears them.`;
		}
		case "review_decision":
			return `Only clears this reminder — no content is touched. The final approve/reject decision stays with you in Reports → Pre-publish.`;
		default:
			return from || to
				? `Applies the change immediately (${from || "current"} → ${to}) and records it in the audit trail.`
				: `Applies the approved action immediately and records it in the audit trail.`;
	}
}
