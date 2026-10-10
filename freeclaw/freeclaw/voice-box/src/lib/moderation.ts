/**
 * Client-side content moderation system
 * Detects profanity, slurs, dangerous content, blackmail, spam, and repeated words.
 * Returns structured results with severity levels for live UI feedback.
 */

// Profanity + slang detection is NOT a local word-list scan any more: it runs
// the same spelling-proof matcher the server gate uses (src/lib/lexicon.ts
// mirrors api/_wordlists.js + api/_lexicon.js), so "sh1t", "shiiiit",
// "s.h.i.t", "s h i t" and the Hinglish variants are caught before sending —
// and "class"/"grass"/"passage" are still not. See tests/api/lexicon-parity.
import { PROFANITY as PROFANITY_WORDS, SLANG as SLANG_WORDS, findTerms } from "./lexicon";

export type Severity = "none" | "low" | "medium" | "high" | "critical";

export interface ModerationFlag {
	category: string;
	severity: Severity;
	message: string;
	matched: string; // the word/phrase that triggered it
}

export interface ModerationResult {
	safe: boolean;
	overallSeverity: Severity;
	flags: ModerationFlag[];
	maskedText: string; // text with bad words masked
	score: number; // 0 = clean, 100 = worst
	/**
	 * The authoritative server verdict, present only on results that came
	 * from `/api/moderate`. The local word-list scan cannot answer this
	 * question — it has no notion of a target, so it cannot tell
	 * "Dhansiri, I will hate you" from "I hate this exam". Callers must
	 * treat `undefined` as "not known", never as "false".
	 */
	serverBlocked?: boolean;
	/** False when the server check itself failed. A failed check is not a pass. */
	checked?: boolean;
	/**
	 * Advisory: is this an actionable school problem, or noise?
	 *
	 * Present only on results from `/api/moderate`. `undefined`/`null` means
	 * "not known" (the check has not run, or it failed) — callers must never
	 * render an absent verdict as a positive claim about the content.
	 *
	 * This NEVER blocks. There is deliberately no `blocked` field: the write
	 * path is the only authority on what may be published, and a confident
	 * machine judgement that silences a real complaint is a worse failure
	 * than a noisy inbox.
	 */
	relevance?: RelevanceResult | null;
}

/** The exact text evidence behind one relevance signal. */
export interface RelevanceReason {
	kind: "distress" | "problem" | "school" | "off_topic";
	signal: string;
	label: string;
	/** The literal substring that matched, for the "why" shown to the author. */
	evidence: string;
}

export type RelevanceVerdict =
	| "school_problem"
	| "unclear"
	| "not_school_related";
export type RelevanceRoute = "post" | "post_with_note" | "support";

/** Output of `api/_relevance.js`, mirrored here for the UI. */
export interface RelevanceResult {
	policyVersion: string;
	verdict: RelevanceVerdict;
	route: RelevanceRoute;
	confidence: "low" | "medium" | "high";
	reasons: RelevanceReason[];
	explanation: string;
	/** True when the author is invited (never required) to double-check. */
	askUserToConfirm: boolean;
	limits: string[];
}

// ─── Word lists ───────────────────────────────────────────────────

// Racial/ethnic slurs and hate speech
const SLUR_WORDS = [
	"nigger",
	"nigga",
	"niggas",
	"niggers",
	"faggot",
	"faggots",
	"fag",
	"fags",
	"faggy",
	"kike",
	"kikes",
	"spic",
	"spics",
	"spick",
	"chink",
	"chinks",
	"wop",
	"wops",
	"dago",
	"dagos",
	"cracker",
	"crackers",
	"honkey",
	"honkies",
	"gook",
	"gooks",
	"towelhead",
	"towelheads",
	"raghead",
	"ragheads",
	"darkie",
	"darkies",
	"coon",
	"coons",
	"jungle bunny",
	"wetback",
	"wetbacks",
	"beaner",
	"beaners",
	"gringo",
	"redskin",
	"redskins",
	"injun",
	"hick",
	"hicks",
	"tranny",
	"trannies",
	"shemale",
	"dyke",
	"dykes",
	"lesbo",
	"paki",
	"pakis",
	"boche",
	"kraut",
	"krauts",
	"nazi",
	"nazis",
];

// Dangerous / threatening content patterns
const DANGEROUS_PATTERNS: Array<{
	pattern: RegExp;
	message: string;
	severity: Severity;
	/** Structural coercion (mirrors the server engine). Victim reports
	 *  demote these to review-only in moderateContent — never block victims. */
	coercion?: boolean;
}> = [
	// Self-harm
	{
		pattern:
			/\b(?:kill\s+(?:my\s+)?self|suicide|suicidal|end\s+(?:my\s+)?life|want\s+to\s+die|going\s+to\s+kill|overdose)\b/i,
		message: "This content mentions self-harm. A counselor has been notified.",
		severity: "critical",
	},
	// Directed self-harm abuse (schoolyard "kys") — always blocking, even
	// without first-person framing. Mirrors the server violence gate.
	{
		pattern: /\b(?:kys|kill\s+yourself|hang\s+yourself)\b/i,
		message: "Directing self-harm at anyone is strictly prohibited.",
		severity: "critical",
	},
	// Violence threats — broad patterns
	{
		pattern:
			/\b(?:kill\s+(?:you|him|her|them|my|our|someone|anyone|everybody|nobody|people|person|friend|classmate|teacher|student|parent|family|brother|sister|nobody))\b/i,
		message: "Threats of violence are taken seriously and will be reported.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:gonna\s+kill|going\s+to\s+kill|will\s+kill|want\s+to\s+kill|wish\s+(?:you|he|she|they)\s+(?:were|was)\s+dead)\b/i,
		message: "Threats of violence are taken seriously and will be reported.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:murder\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i,
		message: "Threats of violence are taken seriously and will be reported.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:shoot\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i,
		message:
			"Mentions of gun violence are flagged for immediate safety review.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:stab\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i,
		message: "Threats of violence are taken seriously and will be reported.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:beat\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend)\s+up)\b/i,
		message: "Threats of violence are taken seriously and will be reported.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:hurt\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i,
		message: "Threats of violence are taken seriously and will be reported.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:burn\s+(?:you|him|her|them|my|our|the|this|a)\s*(?:school|building|house|home|classroom|bus|car)?)\b/i,
		message: "Threats of arson are flagged for immediate safety review.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:bomb\s+(?:you|him|her|them|my|our|the|this|a)\s*(?:school|building|house|home|classroom|bus|car)?)\b/i,
		message: "Threats of bombing are flagged for immediate safety review.",
		severity: "critical",
	},
	// Weapons
	{
		pattern:
			/\b(?:bring(?:ing)?\s+(?:a\s+)?(?:gun|knife|weapon|blade|bomb|explosive))\b/i,
		message: "Mentions of weapons are flagged for safety review.",
		severity: "high",
	},
	// Drugs
	{
		pattern:
			/\b(?:buying|selling|selling|trafficking|deal(?:ing)?\s+(?:in\s+)?)\s*(?:drugs|cocaine|heroin|meth|weed|marijuana|lsd|ecstasy|xanax|adderall|opioid|fentanyl)\b/i,
		message: "Drug-related content is flagged for review.",
		severity: "high",
	},
	// Blackmail / extortion keywords (advisory: the server blocks only
	// structural demands, so bare words warn high instead of blocking).
	{
		pattern:
			/\b(?:blackmail|extort|extortion|pay\s+(?:me|us)\s+or)\b/i,
		message: "Possible extortion language — a human will review this.",
		severity: "high",
		coercion: true,
	},
	{
		pattern:
			/\b(?:if\s+you\s+(?:don(?:'t|t)?|do\s+not)\s+(?:pay|give|send|do)\s+\w+.*?(?:i(?:'ll| will)|gonna|going\s+to)\s+(?:expose|share|post|leak|send))\b/i,
		message: "Extortion attempts are automatically flagged.",
		severity: "critical",
		coercion: true,
	},
	// Structural coercion — mirrors the server engine (api/_moderation.js)
	// so live feedback matches the publish verdict: perpetrator demands
	// block, victim reports only ever hold for review (see the demotion
	// step in moderateContent).
	{
		pattern:
			/\b(?:pay(?: me)?|send(?: me)?|give(?: me)?|transfer)\b[^.!?]{0,60}\b(?:or\s+(?:else|i(?:'ll| will))|otherwise|then\s+i(?:'ll| will)|,\s*i(?:'ll| will))\b[^.!?]{0,80}\b(?:leak|leaks|leaked|leaking|post|posts|posted|posting|share|shared|sharing|expose|exposed|exposing|tell\s+(?:everyone|everybody|all|them|the\s+(?:class|school|group|world))|upload|publish|send\s+(?:it|them|those|your))\b/i,
		message:
			"Blackmail demand detected — coercion is blocked. If someone is doing this to you, report them instead.",
		severity: "critical",
		coercion: true,
	},
	{
		pattern:
			/\b(?:i(?:'ll| will)|gonna|going\s+to)\b[^.!?]{0,40}\b(?:post|publish|share|leak|drop|expose|upload)\b[^.!?]{0,40}\b(?:your|ur)\b[^.!?]{0,40}\b(?:address|number|phone|location|where you live|secret|secrets)\b/i,
		message:
			"Doxxing threat detected — threatening to publish someone's private details is blocked.",
		severity: "critical",
		coercion: true,
	},
	{
		pattern:
			/\bdo\s+(?:as\s+i\s+say|what\s+i\s+say)\b[^.!?]{0,60}\b(?:or\s+(?:else|i(?:'ll| will))|otherwise)\b/i,
		message: "Coercive threat detected — intimidation is blocked.",
		severity: "critical",
		coercion: true,
	},
	{
		pattern:
			/\b(?:i(?:'ll| will)|gonna|going\s+to)\b[^.!?]{0,40}\b(?:post|publish|share|leak|drop|expose|upload)\b[^.!?]{0,40}\b(?:your|ur)\b[^.!?]{0,40}\b(?:address|number|phone|location|where you live|secret|secrets)\b/i,
		message:
			"Doxxing threat detected — threatening to publish someone's private details is blocked.",
		severity: "critical",
		coercion: true,
	},
	{
		pattern:
			/\bdo\s+(?:as\s+i\s+say|what\s+i\s+say)\b[^.!?]{0,60}\b(?:or\s+(?:else|i(?:'ll| will))|otherwise)\b/i,
		message: "Coercive threat detected — intimidation is blocked.",
		severity: "critical",
		coercion: true,
	},
	{
		pattern:
			/\b(?:i(?:'ll| will)|gonna|going\s+to)\b[^.!?]{0,40}\b(?:post|publish|share|leak|drop|expose|upload)\b[^.!?]{0,40}\b(?:your|ur)\b[^.!?]{0,40}\b(?:photo|pic|picture|video|videos|selfie)\b/i,
		message:
			"Possible photo-sharing threat — a human will review this before it goes public.",
		severity: "high",
	},
	// Sexualized photo solicitation/sharing ("hot pics", "pic hot phots") —
	// mirrors the server explicit gate so live feedback matches the publish
	// verdict: blocked, with or without a named student.
	{
		pattern:
			/\bhot\s+(?:pics?|photos?|phots?|pictures?|videos?|selfies?)\b|\b(?:pics?|photos?|phots?|pictures?)\b[^.!?]{0,4}\bhot\b/i,
		message:
			"Sexualized photo language is blocked — describe the incident without those terms and a human will review it.",
		severity: "critical",
	},
	// Doxxing
	{
		pattern:
			/\b(?:dox(?:ing|ed)?|doxx(?:ing|ed)?|releasing?\s+(?:your|their|the)\s+(?:address|phone|real\s+name|info(?:rmation)?))\b/i,
		message: "Sharing personal information without consent is forbidden.",
		severity: "high",
		coercion: true,
	},
	// Generic threat patterns
	{
		pattern:
			/\b(?:i(?:'ll| will)\s+(?:get\s+you|destroy\s+you|end\s+you|ruin\s+your\s+life|make\s+your\s+life\s+(?:a\s+)?hell))\b/i,
		message:
			"Threats and intimidation are taken seriously and will be reported.",
		severity: "critical",
	},
	{
		pattern:
			/\b(?:you(?:'ll| will)\s+(?:regret\s+this|be\s+sorry|pay\s+for\s+this))\b/i,
		message: "Intimidating language is flagged for review.",
		severity: "high",
	},
];

// Victim reports ("someone is blackmailing me") must never be blocked:
// the server holds them for human review, so live feedback must agree.
const COERCION_VICTIM_RE =
	/\b(?:someone|somebody|some\s+one|he|she|they|this\s+(?:guy|person|boy|girl|man))\b[^.!?]{0,40}\b(?:blackmail(?:ing|ed|s)?|threaten(?:ed|ing|s)?|extort(?:ing|ed|s)?|forcing\s+me)\b|\b(?:blackmail(?:ing|ed)?|threaten(?:ed|ing)?|extort(?:ing|ed)?)\s+(?:me|him|her|them|us)\b/i;

// Spam patterns
const SPAM_PATTERNS: Array<{
	pattern: RegExp;
	message: string;
	severity: Severity;
}> = [
	{
		pattern:
			/\b(?:buy\s+now|click\s+here|free\s+money|easy\s+cash|earn\s+\$|make\s+\$\d|work\s+from\s+home|limited\s+time\s+offer|act\s+now|congratulations\s+you(?:'ve| have)\s+won)\b/i,
		message: "Looks like spam or advertising.",
		severity: "medium",
	},
	{
		pattern: /https?:\/\/[^\s]+(?:bit\.ly|tinyurl|t\.co|shorturl|goo\.gl)/i,
		message: "Shortened links are flagged for review.",
		severity: "low",
	},
	{
		pattern: /(.)\1{5,}/,
		message: "Excessive repeated characters detected.",
		severity: "low",
	},
];

// ─── Helpers ──────────────────────────────────────────────────────

function normalize(text: string): string {
	return text
		.toLowerCase()
		// Preserve Unicode letters and digits (Hindi, Bengali, etc.) — only strip
		// punctuation and symbols so repeated-word detection works for all languages.
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Check for repeated words (e.g., "bad bad bad bad bad") */
function detectRepeatedWords(text: string): ModerationFlag[] {
	const flags: ModerationFlag[] = [];
	const words = normalize(text).split(" ");
	let count = 1;
	for (let i = 1; i <= words.length; i++) {
		if (
			i < words.length &&
			words[i] === words[i - 1] &&
			words[i] &&
			words[i]!.length > 2
		) {
			count++;
		} else {
			const prevWord = words[i - 1] ?? "";
			if (count >= 4) {
				flags.push({
					category: "spam",
					severity: "medium",
					message: `Word "${prevWord}" repeated ${count} times — this looks like spam.`,
					matched: prevWord,
				});
			}
			count = 1;
		}
	}
	return flags;
}

/** Check for ALL CAPS (shouting) */
function detectAllCaps(text: string): ModerationFlag[] {
	const flags: ModerationFlag[] = [];
	const stripped = text.replace(/[^a-zA-Z]/g, "");
	if (stripped.length < 10) return flags;
	const upperCount = (stripped.match(/[A-Z]/g) || []).length;
	if (upperCount / stripped.length > 0.85 && stripped.length > 15) {
		flags.push({
			category: "quality",
			severity: "low",
			message:
				"Writing in ALL CAPS can feel like shouting. Consider using normal case.",
			matched: text.slice(0, 40),
		});
	}
	return flags;
}

/** Check for excessive exclamation marks */
function detectExcessivePunctuation(text: string): ModerationFlag[] {
	const flags: ModerationFlag[] = [];
	const exclamations = (text.match(/!/g) || []).length;
	if (exclamations >= 5) {
		flags.push({
			category: "quality",
			severity: "low",
			message: `Excessive exclamation marks (${exclamations}) — try to keep punctuation minimal.`,
			matched: "!",
		});
	}
	return flags;
}

/** Check for email addresses, phone numbers, street addresses, and name+location PII */
function detectPII(text: string): ModerationFlag[] {
	const flags: ModerationFlag[] = [];
	if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(text)) {
		flags.push({
			category: "privacy",
			severity: "medium",
			message:
				"Email addresses detected — this is an anonymous platform. Remove personal contact info.",
			matched:
				text.match(
					/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
				)?.[0] || "",
		});
	}
	if (
		/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text)
	) {
		flags.push({
			category: "privacy",
			severity: "medium",
			message:
				"Phone number detected — this is an anonymous platform. Remove personal contact info.",
			matched:
				text.match(
					/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
				)?.[0] || "",
		});
	}

	// ── Address & name+location PII ──────────────────────────────
	// Strict whitelist for the "number AFTER street" pattern — only unambiguous
	// street words. Excludes common English words (place, way, park, block, phase,
	// lane, drive, court, close, gardens, heights, sector, housing, society, etc.)
	// that would false-positive on phrases like "first place 5" or "phase 2".
	const STREET_TYPES_AFTER =
		"street|st|stree|strret|sreet|stre|avenue|avenu|avnue|ave|road|rd|roed|boulevard|blvd|ln|dr|ct|pl|colony|nagar|howrag|howrah|bally";

	// "123 Main Street" — number BEFORE street keyword
	if (
		new RegExp(
			"\\b\\d{1,5}\\s+[a-zA-Z\\s]+\\b(?:" + STREET_TYPES_AFTER + ")\\b",
			"i",
		).test(text)
	) {
		flags.push({
			category: "privacy",
			severity: "high",
			message:
				"Street address detected — this is an anonymous platform. Please remove your home address.",
			matched: text.slice(0, 60),
		});
	}

	// "Bally Street 123" — number AFTER street keyword
	if (
		new RegExp(
			"\\b[a-zA-Z\\s]+\\b(?:" + STREET_TYPES_AFTER + ")\\s+\\d{1,5}\\b",
			"i",
		).test(text)
	) {
		flags.push({
			category: "privacy",
			severity: "high",
			message:
				"Street address detected — this is an anonymous platform. Please remove your home address.",
			matched: text.slice(0, 60),
		});
	}

	// "Kauli lives in Bally Street 123" — NAME + lives/stays/resides + location	// Multi-word names ("MAAM KAULI") + digits in location ("STREE 123") — the
	// single-word-only `[A-Z][a-zA-Z]+` used to let "MAAM KAULI LIVES IN STREE 123" through.
	// Uses the STRICT whitelist (STREET_TYPES_AFTER): generic words like park, block, city,
	// town, village, area, place, way, lane, drive, building, phase are excluded so legit
	// sentences ("Students live in hostel block 3", "Kids play in the park") are never flagged.
	if (
		new RegExp(
			"\\b(?:[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,2})\\s+(?:lives?|stays?|resides?|resid|living)\\s+(?:at|in|on|near)\\s+[A-Za-z0-9\\s]+\\b(?:" +
				STREET_TYPES_AFTER +
				")\\b",
			"i",
		).test(text)
	) {
		flags.push({
			category: "privacy",
			severity: "high",
			message:
				"Personal name with address detected — sharing someone's home address is not allowed on this anonymous platform.",
			matched: text.slice(0, 60),
		});
	}

	// ── Leaked secrets (mirrors the server engine) ──────────────
	// Assignment or vendor prefix required — plain words never match.
	const CRED_CHECKS: Array<[RegExp, string]> = [
		[/(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, "password"],
		[/\bapi[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}['"]?/gi, "API key"],
		[/\b(?:auth[_-]?token|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?\S+['"]?/gi, "token"],
		[/\btoken\s*[:=]\s*['"]?[A-Za-z0-9_\-.~+/=]{8,}['"]?/gi, "token"],
		[/\bsk-[A-Za-z0-9]{20,}\b/g, "API key"],
		[/\bgh[pousr]_[A-Za-z0-9]{36}\b/g, "token"],
		[/\bAKIA[0-9A-Z]{16}\b/g, "API key"],
		[/\bxox[bpras]-[A-Za-z0-9-]+\b/g, "token"],
		[/\bBearer\s+[A-Za-z0-9\-._~+/]{10,}={0,2}\b/g, "token"],
	];
	for (const [re, label] of CRED_CHECKS) {
		re.lastIndex = 0;
		const m = text.match(re);
		if (m) {
			flags.push({
				category: "privacy",
				severity: "critical",
				message: `Exposed ${label} detected — secrets must never be posted publicly. Remove it to continue.`,
				matched: m[0].slice(0, 60),
			});
			break;
		}
	}

	return flags;
}

/** Check for someone posting another person's name in a negative context (bullying) */
function detectBullyingPatterns(text: string): ModerationFlag[] {
	const flags: ModerationFlag[] = [];
	// "Mr./Mrs./Ms./Teacher [Name] is" followed by insults
	if (
		/\b(?:mr|mrs|ms|miss|teacher|professor|coach|principal|sir|ma(?:'am|am))\s+\w+\s+(?:is|are|was)\s+(?:a\s+)?(?:bad|terrible|awful|horrible|worst|stupid|idiot|dumb|ugly|fat|disgusting|pathetic|useless)\b/i.test(
			text,
		)
	) {
		flags.push({
			category: "bullying",
			severity: "high",
			message:
				"Content appears to target a specific person with insults. Please keep feedback constructive.",
			matched: text.slice(0, 60),
		});
	}
	return flags;
}

// ─── Main moderation function ─────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = {
	none: 0,
	low: 1,
	medium: 2,
	high: 3,
	critical: 4,
};

function worstSeverity(flags: ModerationFlag[]): Severity {
	let worst: Severity = "none";
	for (const f of flags) {
		if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[worst]) worst = f.severity;
	}
	return worst;
}

function severityScore(severity: Severity): number {
	switch (severity) {
		// moderateContent only ever pushes low/medium/high/critical flags, so a
		// 'none' severity never reaches this switch — the arm is unreachable.
		/* v8 ignore next -- @preserve */
		case "none":
			return 0;
		case "low":
			return 10;
		case "medium":
			return 35;
		case "high":
			return 70;
		case "critical":
			return 100;
	}
}

/** Mask a word with asterisks, keeping first letter */
function maskWord(word: string): string {
	// maskWord is only called with a regex \b match of a PROFANITY_WORDS or
	// SLUR_WORDS entry, and every entry is 3+ characters — unreachable guard.
	/* v8 ignore next -- @preserve */
	if (word.length <= 1) return "*";
	return word[0] + "*".repeat(word.length - 1);
}

const escapeMaskRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One `\b`-anchored alternation per list, built ONCE at module load.
 * The old version compiled a fresh RegExp per word and ran one full pass of
 * the string for each — ~450 regex rebuilds and full-text scans on every
 * (debounced) keystroke. Longest-first ordering keeps "bullshit" from being
 * half-matched as "shit".
 */
function buildMaskRe(words: string[]): RegExp {
	const alternation = [...words]
		.sort((a, b) => b.length - a.length)
		.map(escapeMaskRe)
		.join("|");
	return new RegExp(`\\b(?:${alternation})\\b`, "gi");
}

const PROFANITY_MASK_RE = buildMaskRe(PROFANITY_WORDS);
const SLANG_MASK_RE = buildMaskRe(SLANG_WORDS);
const SLUR_MASK_RE = buildMaskRe(SLUR_WORDS);

/** Replace every blocked word in text with its masked version. */
function maskWith(text: string, re: RegExp): string {
	re.lastIndex = 0;
	return text.replace(re, (m) => maskWord(m));
}

/**
 * Moderate content — returns flags, overall severity, and masked text.
 * Run this on the CLIENT for instant UI feedback before submission.
 *
 * Evasion parity with the server (api/_moderation.js serverModerate, enforced
 * in-request by api/_safety-pipeline.js): the word-list loops below run on
 * NFKC-normalized text, and profanity/slang get a leet-folded token pass
 * with the server's exact substitution map and changed-guard. Without this
 * the submit button stays enabled for sh1t/ｓｕｃｋｓ while the server 403s.
 */
export function moderateContent(text: string): ModerationResult {
	const flags: ModerationFlag[] = [];
	// NFKC first: full-width/lookalike evasion is judged as its ASCII self.
	// Then strip invisible format chars (zero-width joiners/spaces, BOM,
	// soft hyphens) — same strip as serverModerate, no visible prose impact.
	const folded = text
		.normalize("NFKC")
		.replace(/[\u200b-\u200d\ufeff\u00ad]/g, "");

	// 1. Profanity + slang — ONE spelling-proof pass through the shared mirror
	// of the server matcher. The old code ran three separate loops (exact list,
	// exact slang, whole-token leet) and still missed repeated letters,
	// interior separators, and spaced-out letters, so the client could show
	// "no issues" on text the server would 403. Same folds as the server now.
	for (const hit of findTerms(folded)) {
		const label = hit.category === "slang" ? "Slang" : "Profanity";
		flags.push({
			category: "profanity",
			severity: "high",
			message: `${label} detected: "${hit.matched}" — please remove or rephrase.`,
			matched: hit.matched,
		});
	}

	// 2. Slur check
	for (const word of SLUR_WORDS) {
		const regex = new RegExp(
			`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
			"gi",
		);
		const match = folded.match(regex);
		if (match) {
			flags.push({
				category: "hate_speech",
				severity: "critical",
				message: `Hate speech detected: "${match[0]}" — this is strictly prohibited.`,
				matched: match[0],
			});
		}
	}

	// 3. Dangerous content
	for (const { pattern, message, severity, coercion } of DANGEROUS_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			flags.push({
				category: coercion ? "coercion" : "dangerous",
				severity,
				message,
				matched: match[0],
			});
		}
	}

	// 4. Spam patterns
	for (const { pattern, message, severity } of SPAM_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			flags.push({ category: "spam", severity, message, matched: match[0] });
		}
	}

	// 5. Repeated words
	flags.push(...detectRepeatedWords(text));

	// 6. ALL CAPS
	flags.push(...detectAllCaps(text));

	// 7. Excessive punctuation
	flags.push(...detectExcessivePunctuation(text));

	// 8. PII (email/phone)
	flags.push(...detectPII(text));

	// 8b. Victim-report handling — mirrors the server: a victim describing
	// coercion is never blocked live; they always get a review note, whether
	// or not a coercion flag fired (server holds these for a human too).
	if (COERCION_VICTIM_RE.test(text)) {
		const kept = flags.filter((f) => f.category !== "coercion");
		kept.push({
			category: "coercion_report",
			severity: "high",
			message:
				"Possible coercion report — you can post this; a human will review it.",
			matched: text.slice(0, 60),
		});
		flags.length = 0;
		flags.push(...kept);
	}

	// 9. Bullying patterns
	flags.push(...detectBullyingPatterns(text));

	// Compute overall
	const overallSeverity = worstSeverity(flags);
	const score = flags.reduce(
		(max, f) => Math.max(max, severityScore(f.severity)),
		0,
	);

	// Mask profanity, slang and slurs in text
	let maskedText = text;
	maskedText = maskWith(maskedText, PROFANITY_MASK_RE);
	maskedText = maskWith(maskedText, SLANG_MASK_RE);
	maskedText = maskWith(maskedText, SLUR_MASK_RE);

	return {
		safe: overallSeverity === "none" || overallSeverity === "low",
		overallSeverity,
		flags: [...new Map(flags.map((f) => [f.message, f])).values()], // dedupe by message
		maskedText,
		score: Math.min(100, score),
	};
}

/**
 * Quick check: is this content blocked entirely? (critical severity or
 * profanity = cannot submit — school zero-tolerance: no stars, the server
 * 403s the same set in-request, so the client must agree before sending)
 */
export function isBlocked(result: ModerationResult): boolean {
	return (result?.flags ?? []).some(
		(f) => f.severity === "critical" || f.category === "profanity",
	);
}

/**
 * Server-parity gate for anonymous write surfaces (posts, polls, comments).
 * Mirrors the server's hard verdict — the SAME `serverModerate().blocked`
 * check `api/_posts.js`, `api/_polls.js`, and `api/_comments.js` each enforce
 * on RAW text before insert:
 *
 *   blocked = any flag with severity "critical", category "privacy",
 *   or category "profanity"
 *
 * Strong personal information — email, phone, street address — is a hard 403
 * on every one of those routes: comments and polls have no review queue, and
 * posts 403 strong PII outright (only WEAK signals route to review). Profanity
 * and slang are likewise a hard 403 everywhere — school zero-tolerance: no
 * stars are published, the user removes the language and resubmits. The
 * client must hard-block the same set before sending, or the user gets an
 * unexplained failure after an optimistic "sent" row — and the request must
 * carry RAW text, because a masked word reads as stars and blinds this check
 * on both sides.
 *
 * Weak/ambiguous signals (`privacy_weak`/`explicit_weak`) exist only
 * server-side — the server stays authoritative and its
 * PII_BLOCKED/CONTENT_BLOCKED message is surfaced verbatim through the toast
 * on a rejected request.
 */
export function isBlockedByServer(result: ModerationResult): boolean {
	// `result` arrives over the network and may be a partial shape without
	// `flags`. A missing list is "not blocked", never an exception — this one
	// guard covers every caller (Submit, Comments, polls).
	return (result?.flags ?? []).some(
		(f) =>
			f.severity === "critical" ||
			f.category === "privacy" ||
			f.category === "profanity",
	);
}

/** Server-verbatim rejection messages (api/_comments.js 403 bodies). Used for
 *  the pre-submit client gate so the wording the user sees before sending is
 *  identical to what the server would have returned. COMMENT_BLOCK_PII_MSG is
 *  byte-identical to api/_polls.js's PII 403, so polls reuse it. */
export const COMMENT_BLOCK_PII_MSG =
	"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.";
export const COMMENT_BLOCK_CONTENT_MSG =
	"This comment violates our safety guidelines and cannot be posted.";

/** Server-verbatim rejection messages for the Submit surface:
 *  api/_posts.js (POST) and api/_polls.js (POST) 403 bodies. */
export const POST_BLOCK_PII_MSG =
	"Personal information detected (address, phone, or email). This is an anonymous platform — please remove all personal details and try again.";
export const POST_BLOCK_CONTENT_MSG =
	"This content violates our safety guidelines and cannot be published. If you are in crisis, please contact a counselor or call a crisis hotline.";
export const POLL_BLOCK_CONTENT_MSG =
	"This poll violates our safety guidelines and cannot be published.";

/** Pick the server's rejection message for a blocked comment result: privacy
 *  flags → the PII message, anything else → the generic safety message. */
export function commentBlockMessage(result: ModerationResult): string {
	return (result?.flags ?? []).some((f) => f.category === "privacy")
		? COMMENT_BLOCK_PII_MSG
		: COMMENT_BLOCK_CONTENT_MSG;
}

/** Pick the server's rejection message for a Submit-surface block: `kind`
 *  selects the route's exact 403 wording (post vs poll), privacy flags select
 *  the PII variant — so the pre-send toast is byte-identical to the 403 the
 *  server would have returned. */
export function submitBlockMessage(
	result: ModerationResult,
	kind: "post" | "poll",
): string {
	const pii = (result?.flags ?? []).some((f) => f.category === "privacy");
	if (kind === "poll") {
		return pii ? COMMENT_BLOCK_PII_MSG : POLL_BLOCK_CONTENT_MSG;
	}
	return pii ? POST_BLOCK_PII_MSG : POST_BLOCK_CONTENT_MSG;
}

// ─── Pre-publish advisory verdict (POST /api/pre-publish) ──────────

/**
 * The four checks `api/_pre-publish.js` can report. The client renders a
 * check ONLY when the server actually sent one: an absent check is "not
 * verified", which must never be drawn as a green pass.
 */
export const PREPUB_CHECK_KEYS = [
	"privacy",
	"safety",
	"spam",
	"quality",
] as const;

export type PrePubCheckKey = (typeof PREPUB_CHECK_KEYS)[number];

export interface PrePubCheck {
	pass: boolean;
	issues: string[];
}

export interface PrePubAnalysis {
	llm_analyzed?: boolean;
	estimated_resolution_time?: string;
	priority?: string;
	department?: string;
	summary?: string;
}

/**
 * The advisory pre-publish verdict, as the CLIENT may safely use it.
 *
 * `decision` is `"safe" | "revision" | "high_risk"` on the wire (see
 * api/_pre-publish.js). It stays a plain string here on purpose: an
 * unrecognised value must be handled as "unknown", never coerced into one of
 * the three the UI knows how to colour.
 */
export interface PrePubResult {
	decision: string;
	reason: string;
	risk_score: number;
	review_id?: string;
	checks?: Partial<Record<PrePubCheckKey, PrePubCheck>>;
	analysis?: PrePubAnalysis;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

function asIssues(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((i): i is string => typeof i === "string")
		: [];
}

/**
 * Coerce an untrusted `/api/pre-publish` body into `PrePubResult`.
 *
 * A response is not a schema. The advisory verdict is produced by an LLM
 * pipeline behind a lambda: it can arrive partial (a check that did not run),
 * degraded (a fallback path that skips a section), proxied, or from an older
 * deploy. The submit page used to index `checks.privacy`, `checks.safety`, …
 * unconditionally, so ONE missing check threw during render and React
 * unmounted the entire page — form, appeal panel, publish button, all gone,
 * with no error UI to explain it.
 *
 * Normalizing here is the single point of truth: every field the page reads is
 * present, of the right type, and coerced toward "unknown" rather than toward
 * reassurance.
 */
export function normalizePrePubResult(raw: unknown): PrePubResult {
	const source = asRecord(raw);

	// Only checks the server actually reported survive. A check entry that is
	// present but malformed is kept as a FAILED check (with no issues listed)
	// rather than dropped: the server did not say it passed.
	const rawChecks = asRecord(source.checks);
	const checks: Partial<Record<PrePubCheckKey, PrePubCheck>> = {};
	for (const key of PREPUB_CHECK_KEYS) {
		if (!(key in rawChecks)) continue;
		const check = asRecord(rawChecks[key]);
		checks[key] = { pass: check.pass === true, issues: asIssues(check.issues) };
	}

	const rawAnalysis = asRecord(source.analysis);
	const hasAnalysis = Object.keys(rawAnalysis).length > 0;

	const risk = Number(source.risk_score);
	const decision = typeof source.decision === "string" ? source.decision : "";

	return {
		decision,
		reason: typeof source.reason === "string" ? source.reason : "",
		// An unreadable score is 0, not NaN: NaN renders as "NaN/100" and an
		// invalid CSS width, both worse than an honest zero.
		risk_score: Number.isFinite(risk) ? Math.min(100, Math.max(0, risk)) : 0,
		...(typeof source.review_id === "string"
			? { review_id: source.review_id }
			: {}),
		...(Object.keys(checks).length > 0 ? { checks } : {}),
		...(hasAnalysis
			? {
					analysis: {
						llm_analyzed: rawAnalysis.llm_analyzed === true,
						...(typeof rawAnalysis.estimated_resolution_time === "string"
							? {
									estimated_resolution_time:
										rawAnalysis.estimated_resolution_time,
								}
							: {}),
						...(typeof rawAnalysis.priority === "string"
							? { priority: rawAnalysis.priority }
							: {}),
						...(typeof rawAnalysis.department === "string"
							? { department: rawAnalysis.department }
							: {}),
						...(typeof rawAnalysis.summary === "string"
							? { summary: rawAnalysis.summary }
							: {}),
					},
				}
			: {}),
	};
}

/**
 * Get human-readable summary of moderation issues
 */
export function getModerationSummary(result: ModerationResult): string {
	if (result?.safe) return "";
	const flags = result?.flags ?? [];
	const critical = flags.filter((f) => f.severity === "critical");
	const high = flags.filter((f) => f.severity === "high");
	const medium = flags.filter((f) => f.severity === "medium");
	const parts: string[] = [];
	if (critical.length) parts.push(`${critical.length} critical issue(s)`);
	if (high.length) parts.push(`${high.length} serious issue(s)`);
	if (medium.length) parts.push(`${medium.length} warning(s)`);
	return parts.join(", ") || "Content needs review";
}
