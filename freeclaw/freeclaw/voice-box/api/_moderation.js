// Shared server-side content moderation + PII gate.
// Used by _posts.js, _comments.js, and _polls.js so NO content type can leak
// addresses, phone numbers, emails, or dangerous content to the public.
// Mirrors the pre-publish emergencyRegex whitelists (see _pre-publish.js).

import supabase from "./_db-client.js";

// ─── Self-learning feedback loop (weak signals ONLY) ─────────────
// Admin decisions feed back into confidence: every time an admin APPROVES a
// post that was held on a privacy_weak signal, the counter rises; explicit
// rejections raise blocked. Once approvals are decisively dominant
// (>=5 approvals AND >=3x rejections), NEW weak-only holds on POSTS are
// auto-approved instead of queued. Hard signals (full privacy / violence /
// hate_speech) are NEVER learnable — the safety floor is absolute.
const LEARN_KEY = "moderation_learned";
const LEARN_APPROVE_THRESHOLD = 5;
const LEARN_RATIO_REQUIRED = 3;

async function readLearned() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", LEARN_KEY)
			.maybeSingle();
		return data?.value?.privacy_weak || { approved: 0, blocked: 0 };
	} catch {
		return { approved: 0, blocked: 0 };
	}
}

export async function recordModerationDecision(flagType, approved) {
	try {
		if (flagType !== "privacy_weak") return; // safety floor: only weak signals learn
		const cur = await readLearned();
		const next = {
			privacy_weak: {
				approved: cur.approved + (approved ? 1 : 0),
				blocked: cur.blocked + (approved ? 0 : 1),
				updated_at: new Date().toISOString(),
			},
		};
		await supabase
			.from("settings")
			.upsert({ key: LEARN_KEY, value: next }, { onConflict: "key" });
	} catch {
		/* learning is best-effort; never break the moderation path */
	}
}

export async function getLearnedWeakStats() {
	return readLearned();
}


const DANGEROUS_WORDS =
	/\b(?:kill|murder|shoot|stab|bomb|weapon|gun|knife|suicide|suicidal|die|dead|death)\b/i;
const VIOLENCE_PATTERNS = [
	/kill\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend|classmate|teacher|student)/i,
	/murder\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend)/i,
	/shoot\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend)/i,
	/stab\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend)/i,
	/beat\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend)\s+up/i,
	/hurt\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend)/i,
	/burn\s+(?:the|this|a|my)\s*(?:school|building|house|classroom)/i,
	/bomb\s+(?:the|this|a|my)\s*(?:school|building|house|classroom)/i,
	/bring(?:ing)?\s+(?:a\s+)?(?:gun|knife|weapon|bomb)/i,
];
const SLURS =
	/\b(?:nigger|nigga|faggot|fag|kike|spic|chink|wop|cunt|retard|retarded|tranny|dyke|paki)\b/i;

// ─── Server-side PII detection (privacy gate — anonymous platform) ──
const PII_STREET_TYPES =
	"street|st|strret|sreet|stree|stre|avenue|ave|avnue|avenu|road|rd|roed|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|way|close|gardens|park|heights|colony|nagar|town|city|village|housing|society|sector|phase|block|building|howrag|howrah|bally";
// Strict whitelist — generic English words (park, block, city, town, village, area,
// place, way, lane, drive, building, phase, etc.) are excluded so legit sentences
// like "Students live in hostel block 3" or "Kids play in the park" are never blocked.
const PII_STREET_TYPES_AFTER =
	"street|st|stree|strret|sreet|stre|avenue|avenu|avnue|ave|road|rd|roed|boulevard|blvd|ln|dr|ct|pl|colony|nagar|howrag|howrah|bally";
const PII_EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PII_PHONE_RE =
	/\b(?:(?:\+?\d{1,3})[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const PII_PHONE_RE_LOOSE = /\+?\d[\d\s\-()]{7,}/;
const PII_ADDR_NUM_BEFORE = new RegExp(
	"\\b\\d{1,5}\\s+[a-zA-Z\\s]+\\b(?:" + PII_STREET_TYPES_AFTER + ")\\b",
	"i",
);
const PII_ADDR_NUM_AFTER = new RegExp(
	"\\b[a-zA-Z\\s]+\\b(?:" + PII_STREET_TYPES_AFTER + ")\\s+\\d{1,5}\\b",
	"i",
);
// Multi-word names ("MAAM KAULI") + digits in location ("STREE 123") — fixes the
// single-word-only `[A-Z][a-zA-Z]+` that let "MAAM KAULI LIVES IN STREE 123" through.
// Uses the STRICT whitelist so legit sentences are never hard-blocked; the reported
// case still matches (stree + howrag are in the strict list).
const PII_NAME_LOC = new RegExp(
	"\\b(?:[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,2})\\s+(?:lives?|stays?|resides?|resid|living)\\s+(?:at|in|on|near)\\s+[A-Za-z0-9\\s]+\\b(?:" +
		PII_STREET_TYPES_AFTER +
		")\\b",
	"i",
);

// Address without a street number, e.g. "model town, kolkata", "vip road",
// "gandhi nagar". Any named place ending in a street type counts as partial PII.
const PII_ADDR_NO_NUM = new RegExp(
	"\\b(?:" +
		PII_STREET_TYPES_AFTER +
		")\\b(?:\\s*,\\s*[A-Za-z]{2,}|\\s+[A-Za-z]{2,}(?:\\s+[A-Za-z]{2,})?)?\\s*$",
	"i",
);

// 6-digit Indian PIN codes, optionally prefixed with pin/pincode/zip labels
const PII_PINCODE =
	/\b(?:pin|pincode|pin code|zip|zipcode|zip code)?\s*\d{6}\b/i;

// Room-level addresses: "room 204", "room no 12", "flat b", "house 45", "block c"
const PII_ROOM_ADDR =
	/\b(?:room|flat|house|apartment|apt|block|building)\s*(?:no|number|nr)?\s*[a-z0-9]{1,4}\b/i;

/**
 * Server-side content moderation — catches what the client misses.
 * Returns { blocked, flags, requiresReview }.
 * - PII (address/phone/email) is always BLOCKING: on an anonymous platform a
 *   leaked address must never go public.
 * - Violence threats and slurs are blocking (critical).
 * - Lower-severity flags set requiresReview so the caller can queue for review.
 */
export function serverModerate(title, description, learned = null) {
	const text = `${title} ${description}`;
	const flags = [];
	// Learning verdict for weak-only content (set below)
	let autoApproveWeak = false;

	// Check for violence threats
	for (const pattern of VIOLENCE_PATTERNS) {
		if (pattern.test(text)) {
			flags.push({
				type: "violence",
				severity: "critical",
				message: "Violence threat detected",
			});
			break;
		}
	}

	// Check for dangerous words
	if (DANGEROUS_WORDS.test(text) && flags.length === 0) {
		// Only flag if it's combined with threatening context
		if (/\b(?:i(?:'ll| will)|gonna|going\s+to|want\s+to|wish)\b/i.test(text)) {
			flags.push({
				type: "threat",
				severity: "high",
				message: "Potential threat detected",
			});
		}
	}

	// Check for slurs
	if (SLURS.test(text)) {
		flags.push({
			type: "hate_speech",
			severity: "critical",
			message: "Hate speech detected",
		});
	}

	// ── PII — email / phone / street address / name+address ─────
	if (PII_EMAIL_RE.test(text))
		flags.push({
			type: "privacy",
			severity: "high",
			message: "Email address detected",
		});
	// Strip date-like strings (2026-07-30, 07/30/2026) AND academic-year ranges
	// (2026-2027, 2026-27) BEFORE the loose phone scan so legitimate posts mentioning
	// exam/deadline dates or school years are never blocked as PII.
	const textNoDates = text.replace(
		/\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s*[-/]\s*(?:19|20)?\d{2}\b/g,
		" ",
	);
	if (PII_PHONE_RE.test(text) || PII_PHONE_RE_LOOSE.test(textNoDates))
		flags.push({
			type: "privacy",
			severity: "high",
			message: "Phone number detected",
		});
	if (PII_ADDR_NUM_BEFORE.test(text) || PII_ADDR_NUM_AFTER.test(text))
		flags.push({
			type: "privacy",
			severity: "high",
			message: "Street address detected",
		});
	if (PII_NAME_LOC.test(text))
		flags.push({
			type: "privacy",
			severity: "high",
			message: "Personal name with address detected",
		});
	// Weaker signals: pin codes, room-level addresses, street names without numbers.
	// Posts route these to pending_review (never published); comments/polls hard-block.
	if (PII_PINCODE.test(text))
		flags.push({
			type: "privacy_weak",
			severity: "high",
			message: "PIN code detected",
		});
	if (PII_ROOM_ADDR.test(text))
		flags.push({
			type: "privacy_weak",
			severity: "high",
			message: "Room-level address detected",
		});
	if (PII_ADDR_NO_NUM.test(text))
		flags.push({
			type: "privacy_weak",
			severity: "high",
			message: "Partial address detected",
		});

	// Check for spam patterns (same words repeated 10+ times)
	const words = text.toLowerCase().split(/\s+/);
	const wordCounts = {};
	for (const w of words) {
		if (w.length > 3) wordCounts[w] = (wordCounts[w] || 0) + 1;
	}
	const maxCount = Math.max(...Object.values(wordCounts), 0);
	if (maxCount >= 10) {
		flags.push({
			type: "spam",
			severity: "medium",
			message: "Spam-like content detected",
		});
	}

	// ── Learned-confidence adjustment (weak signals only) ──────────
	// When the admin track record says weak PII flags are almost always
	// approved, a weak-ONLY flag set no longer forces pending_review.
	// Any hard flag in the mix keeps full blocking/review behavior.
	const weakOnly =
		flags.length > 0 && flags.every((f) => f.type === "privacy_weak");
	if (
		weakOnly &&
		learned &&
		learned.approved >= LEARN_APPROVE_THRESHOLD &&
		learned.approved >= learned.blocked * LEARN_RATIO_REQUIRED
	) {
		autoApproveWeak = true;
		for (const f of flags) f.downgraded = true;
	}

	return {
		// PII is treated as blocking: on an anonymous platform a leaked
		// address/phone/email must never go public.
		blocked: flags.some(
			(f) => f.severity === "critical" || f.type === "privacy",
		),
		flags,
		requiresReview: flags.length > 0 && !autoApproveWeak,
		autoApproveWeak,
	};
}

// Date-like strings (2026-07-30, 07/30/2026) and academic-year ranges
// (2026-2027, 2026-27) are protected during masking so exam/deadline years
// are never redacted as phone numbers (same strip rule as serverModerate).
const DATE_LIKE_RE =
	/\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s*[-/]\s*(?:19|20)?\d{2}\b/g;
const DATE_SENTINEL = "\uE000"; // private-use codepoint — cannot collide with user text

/**
 * Outbound PII redaction — defense-in-depth for LLM provider calls.
 *
 * The write-time gates above block PII from ever being published, but
 * conversation context and tool results sent to external LLM APIs (e.g. the
 * configured NVIDIA NIM endpoint) can still echo older content or
 * privacy_weak signals (pin codes, room addresses). maskPII scrubs any
 * residual emails, phones, addresses, and pin codes before a request leaves
 * the server, preserving sentence structure with placeholders.
 *
 * Non-string input is returned untouched so it can be applied safely to
 * every message field.
 */
export function maskPII(text) {
	if (typeof text !== "string" || text.length === 0) return text;

	// Protect date-like strings so the loose phone pass skips them.
	const dates = [];
	let work = text.replace(DATE_LIKE_RE, (m) => {
		dates.push(m);
		return `${DATE_SENTINEL}D${dates.length - 1}${DATE_SENTINEL}`;
	});

	work = work
		.replace(PII_EMAIL_RE, "[EMAIL]")
		.replace(PII_PHONE_RE, "[PHONE]")
		.replace(PII_PHONE_RE_LOOSE, "[PHONE]")
		// Name+location FIRST: if the address-number rules run first they consume
		// the trailing street word ("...STREE 123 AND BALLY HOWRAG" → "...STREE
		// [ADDRESS]") and the name+verb phrase can no longer be matched. Matching
		// the whole phrase up front redacts the name with the address.
		.replace(PII_NAME_LOC, "[ADDRESS]")
		.replace(PII_ADDR_NUM_BEFORE, "[ADDRESS]")
		.replace(PII_ADDR_NUM_AFTER, "[ADDRESS]")
		.replace(PII_PINCODE, "[PINCODE]")
		.replace(PII_ROOM_ADDR, "[ADDRESS]")
		.replace(PII_ADDR_NO_NUM, "[ADDRESS]");

	if (dates.length === 0) return work;
	return work.replace(
		new RegExp(`${DATE_SENTINEL}D\\d+${DATE_SENTINEL}`, "g"),
		(m) => {
			const idx = Number(m.slice(2, -1));
			return dates[idx] !== undefined ? dates[idx] : m;
		},
	);
}
