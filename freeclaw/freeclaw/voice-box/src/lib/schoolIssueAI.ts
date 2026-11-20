/**
 * VoiceFlow AI Problem Validation & Slang Monitor
 *
 * 1. Validates whether student submissions describe concrete, actionable
 *    school/campus infrastructure & academic issues (broken switch, fan, AC,
 *    water cooler, lab gear, library books, safety hazards) versus personal
 *    relationship/gossip/trivia ("my friend is not talking to me").
 *
 * 2. Monitors respectful school language across posts, comments, and DRAFTS,
 *    counting slang occurrences even before submission to ensure only clean
 *    students earn the Verified Voice badge.
 */

import { storeGet, storeSet } from "./storage";

export interface ProblemValidationResult {
	isRealProblem: boolean;
	category: "infrastructure" | "academic" | "safety_health" | "personal_social" | "trivial";
	actionabilityScore: number; // 0 - 100
	badge: {
		text: string;
		emoji: string;
		colorClass: string;
		bgClass: string;
		borderClass: string;
	};
	summary: string;
	adminPriority: "high_physical" | "normal" | "low_personal";
	guidance?: string;
}

const INFRASTRUCTURE_TERMS = [
	"switch", "electric", "socket", "wire", "spark", "plug", "short circuit",
	"fan", "ac", "air conditioner", "cooler", "water cooler", "tap", "leak", "pipe",
	"washroom", "toilet", "bench", "desk", "chair", "board", "blackboard", "whiteboard",
	"projector", "smartboard", "screen", "bulb", "tube light", "light", "flicker", "window",
	"glass", "door", "lock", "handle", "stair", "staircase", "railing", "drain", "sewage",
	"canteen", "cafeteria", "hygiene", "food", "drinking water", "water dispenser"
];

const ACADEMIC_TERMS = [
	"textbook", "book", "library", "lab", "apparatus", "microscope", "chemical", "flask",
	"computer", "mouse", "keyboard", "pc", "software", "exam", "syllabus", "period",
	"timetable", "schedule", "teacher", "class", "chalk", "duster", "sports", "ball", "kit"
];

const SAFETY_TERMS = [
	"hazard", "danger", "fire", "extinguisher", "first aid", "medical", "injury", "hurt",
	"emergency", "slippery", "broken glass", "pest", "spider", "snake", "sanitation"
];

const PERSONAL_SOCIAL_TERMS = [
	"my friend", "best friend", "not talking", "ignored me", "rude to me", "stole my eraser",
	"crush", "boyfriend", "girlfriend", "secret", "gossip", "bored", "boring", "sleepy",
	"i don't like", "dislike", "hate someone", "fighting", "talk to me", "angry with me"
];

// Common inappropriate slang / vulgarity patterns
const SLANG_PATTERNS = [
	/\b(bastard|bitch|asshole|idiot|stupid|dumb|moron|crap|shit|fuck|fucking|hell|damn|dick|piss|loser)\b/i,
	/\b(chutiya|saala|kamina|harami|madarchod|bhenchod|gandu|lauda|bhadwa)\b/i,
	/\b(noob|trash|sucks? ass|wtf|stfu|lmao dead|kys)\b/i,
];

const SLANG_COUNT_KEY = "vb:slangDraftCount";

/**
 * Validates whether a complaint or suggestion addresses a real, actionable school issue.
 */
export function validateSchoolProblem(title: string, description: string): ProblemValidationResult {
	const text = `${title} ${description}`.toLowerCase().trim();

	// Match categories
	const hasInfra = INFRASTRUCTURE_TERMS.some((term) => text.includes(term));
	const hasAcademic = ACADEMIC_TERMS.some((term) => text.includes(term));
	const hasSafety = SAFETY_TERMS.some((term) => text.includes(term));
	const hasPersonal = PERSONAL_SOCIAL_TERMS.some((term) => text.includes(term));

	// Physical or campus safety problem
	if (hasSafety) {
		return {
			isRealProblem: true,
			category: "safety_health",
			actionabilityScore: 95,
			badge: {
				text: "Campus Safety & Health Priority",
				emoji: "🚨",
				colorClass: "text-rose-800 dark:text-rose-300",
				bgClass: "bg-rose-500/10",
				borderClass: "border-rose-500/30",
			},
			summary: "Actionable campus safety or health condition requiring direct maintenance attention.",
			adminPriority: "high_physical",
		};
	}

	if (hasInfra) {
		return {
			isRealProblem: true,
			category: "infrastructure",
			actionabilityScore: 90,
			badge: {
				text: "Verified Campus Infrastructure Issue",
				emoji: "🔧",
				colorClass: "text-emerald-800 dark:text-emerald-300",
				bgClass: "bg-emerald-500/10",
				borderClass: "border-emerald-500/30",
			},
			summary: "Physical campus facility or hardware needing repair or maintenance (e.g. electrical, plumbing, furniture).",
			adminPriority: "high_physical",
		};
	}

	if (hasAcademic) {
		return {
			isRealProblem: true,
			category: "academic",
			actionabilityScore: 85,
			badge: {
				text: "Verified Academic Resource Request",
				emoji: "📚",
				colorClass: "text-blue-600 dark:text-blue-400",
				bgClass: "bg-blue-500/10",
				borderClass: "border-blue-500/30",
			},
			summary: "Academic, lab equipment, or library resource concern for educational improvement.",
			adminPriority: "normal",
		};
	}

	if (hasPersonal) {
		return {
			isRealProblem: false,
			category: "personal_social",
			actionabilityScore: 25,
			badge: {
				text: "Personal / Social Concern",
				emoji: "💬",
				colorClass: "text-amber-600 dark:text-amber-400",
				bgClass: "bg-amber-500/10",
				borderClass: "border-amber-500/30",
			},
			summary: "Interpersonal or peer dynamic. Best suited for direct peer communication or school counselor guidance.",
			adminPriority: "low_personal",
			guidance: "VoiceFlow is dedicated to school facilities, academics, and campus life improvements. For personal friendship advice, consider speaking directly with your counselor or homeroom teacher.",
		};
	}

	// Default fallback: length and quality heuristic
	if (text.length > 25) {
		return {
			isRealProblem: true,
			category: "infrastructure",
			actionabilityScore: 70,
			badge: {
				text: "Community School Note",
				emoji: "🏫",
				colorClass: "text-accent dark:text-violet-400",
				bgClass: "bg-accent/10",
				borderClass: "border-accent/30",
			},
			summary: "School environment submission for campus feedback.",
			adminPriority: "normal",
		};
	}

	return {
		isRealProblem: false,
		category: "trivial",
		actionabilityScore: 20,
		badge: {
			text: "Brief / Unactionable Note",
			emoji: "ℹ️",
			colorClass: "text-ink3",
			bgClass: "bg-surface2",
			borderClass: "border-border",
		},
		summary: "Text is very brief. Please provide specific details on what needs to be fixed.",
		adminPriority: "low_personal",
		guidance: "Please describe the exact room, location, or equipment to help the school administration address it.",
	};
}

/**
 * Checks content (including in drafts) for slang or inappropriate words.
 * If inDraft is true and slang is found, increments the draft slang counter.
 */
export function checkContentSlang(text: string, inDraft = false): {
	hasSlang: boolean;
	matches: string[];
	message?: string;
} {
	if (!text || !text.trim()) {
		return { hasSlang: false, matches: [] };
	}

	const matched: string[] = [];
	for (const pattern of SLANG_PATTERNS) {
		const m = text.match(pattern);
		if (m) {
			matched.push(m[0]);
		}
	}

	if (matched.length > 0) {
		if (inDraft) {
			incrementSlangDraftCount();
		}
		return {
			hasSlang: true,
			matches: matched,
			message: `Respectful language policy: Inappropriate words detected ("${matched.join('", "')}"). VoiceFlow requires respectful communication across all school posts and drafts.`,
		};
	}

	return { hasSlang: false, matches: [] };
}

/**
 * Reads user's cumulative slang count in drafts.
 */
export function getSlangDraftCount(): number {
	try {
		const raw = storeGet(SLANG_COUNT_KEY);
		return raw ? parseInt(raw, 10) || 0 : 0;
	} catch {
		return 0;
	}
}

export function incrementSlangDraftCount(): number {
	try {
		const count = getSlangDraftCount() + 1;
		storeSet(SLANG_COUNT_KEY, String(count));
		return count;
	} catch {
		return 0;
	}
}

export function resetSlangDraftCount(): void {
	try {
		storeSet(SLANG_COUNT_KEY, "0");
	} catch {
		/* ignore */
	}
}
