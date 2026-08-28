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

// ═══════════════════════════════════════════════════════════════════
// REAL SPAM DETECTION — multi-signal analysis
// ═══════════════════════════════════════════════════════════════════
// Each signal produces a 0-100 sub-score. The final spam_score is a
// weighted average. Content is flagged when score >= threshold.
// ALL signals are deterministic — no LLM calls for spam detection.
// ═══════════════════════════════════════════════════════════════════

// In-memory velocity tracking (IP → {count, firstSeen, lastSeen})
const _velocity = new Map();
const VELOCITY_WINDOW_MS = 60000; // 1 minute window
const VELOCITY_MAX = 5; // max posts per minute per IP

// In-memory content fingerprint cache (for cross-session similarity)
const _fingerprints = new Map(); // fingerprint → {text, count, firstSeen}
const FINGERPRINT_MAX = 500;
const FINGERPRINT_EXPIRY_MS = 3600000; // 1 hour

// Suspicious TLD patterns
const SPAM_URL_PATTERNS = /bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|buff\.ly|ow\.ly|shorte\.st|adf\.ly|bc\.vc|cutt\.ly|rb\.gy|shorturl\.at|\.(tk|ml|ga|cf|gq|buzz|xyz|top|work|click|download|link|info|date|racing|win|bid|loan|gift|review|stream|account|cricket|science|party|gdn)$/i;

/**
 * Compute a text fingerprint for similarity comparison.
 * Normalizes text, removes common words, produces a set of 3-word shingles.
 */
function computeFingerprint(text) {
	const stopWords = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","to","of","in","for","on","with","at","by","from","as","into","through","during","before","after","above","below","between","out","off","over","under","again","further","then","once","here","there","when","where","why","how","all","each","every","both","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","just","because","but","and","or","if","while","about","up","its","it","this","that","these","those","i","me","my","we","our","you","your","he","him","his","she","her","they","them","their","what","which","who","whom"]);
	const words = text.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !stopWords.has(w));
	if (words.length < 3) return new Set();
	const shingles = new Set();
	for (let i = 0; i <= words.length - 3; i++) {
		shingles.add(`${words[i]}_${words[i+1]}_${words[i+2]}`);
	}
	return shingles;
}

/**
 * Jaccard similarity between two shingle sets.
 */
function jaccardSimilarity(a, b) {
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const s of a) if (b.has(s)) intersection++;
	const union = a.size + b.size - intersection;
	return union > 0 ? intersection / union : 0;
}

// ─── Link density signal ───────────────────────────────────────
function linkDensityScore(text) {
	const urlCount = (text.match(/https?:\/\/|www\./gi) || []).length;
	const wordCount = text.split(/\s+/).length;
	if (wordCount === 0) return 0;
	const ratio = urlCount / wordCount;
	// >20% words are URLs → very spammy
	if (ratio > 0.5) return 100;
	if (ratio > 0.3) return 80;
	if (ratio > 0.2) return 60;
	if (ratio > 0.1) return 40;
	if (urlCount >= 3) return 30;
	if (urlCount >= 2) return 15;
	return 0;
}

// ─── Suspicious URL signal ─────────────────────────────────────
function suspiciousUrlScore(text) {
	const urls = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) || [];
	if (urls.length === 0) return 0;
	let suspicious = 0;
	for (const url of urls) {
		if (SPAM_URL_PATTERNS.test(url)) suspicious++;
		// Very long URLs are often spam redirects
		if (url.length > 120) suspicious++;
	}
	if (suspicious === 0) return 0;
	return Math.min(100, (suspicious / urls.length) * 100);
}

// ─── Word repetition signal ────────────────────────────────────
function repetitionScore(text) {
	const words = text.toLowerCase().split(/\s+/);
	if (words.length < 5) return 0;
	const counts = {};
	for (const w of words) {
		if (w.length > 3) counts[w] = (counts[w] || 0) + 1;
	}
	const maxCount = Math.max(...Object.values(counts), 0);
	const uniqueWords = Object.keys(counts).length;
	if (uniqueWords === 0) return 0;
	// Low unique-to-total ratio = high repetition
	const ratio = maxCount / words.length;
	if (ratio > 0.3) return 100;
	if (ratio > 0.2) return 70;
	if (ratio > 0.15) return 50;
	if (maxCount >= 5) return 30;
	if (maxCount >= 3) return 15;
	return 0;
}

// ─── ALL CAPS / excessive punctuation ──────────────────────────
function formattingScore(text) {
	let score = 0;
	// ALL CAPS ratio
	const alpha = text.replace(/[^a-zA-Z]/g, "");
	if (alpha.length > 10) {
		const capsRatio = (alpha.replace(/[^A-Z]/g, "").length) / alpha.length;
		if (capsRatio > 0.8) score += 40;
		else if (capsRatio > 0.6) score += 20;
	}
	// Excessive punctuation
	const exclamations = (text.match(/!/g) || []).length;
	const questions = (text.match(/\?/g) || []).length;
	if (exclamations > 5) score += 30;
	else if (exclamations > 3) score += 15;
	if (questions > 5) score += 20;
	// Emoji spam
	const emojis = (text.match(/[\u{1F600}-\u{1F9FF}]/gu) || []).length;
	if (emojis > 10) score += 20;
	return Math.min(100, score);
}

// ─── Short / empty / gibberish ─────────────────────────────────
function qualityScore(text) {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length < 3) return 80; // too short
	if (words.length < 6) return 30;
	// High ratio of non-alpha characters = likely gibberish
	const alphaRatio = (text.replace(/[^a-zA-Z]/g, "").length) / text.length;
	if (alphaRatio < 0.4) return 70;
	if (alphaRatio < 0.6) return 40;
	return 0;
}

/**
 * Real multi-signal spam analysis.
 * 
 * @param {string} title - Post title
 * @param {string} description - Post description
 * @param {string} authorId - Author anonymous ID
 * @param {string} ip - Client IP (from x-forwarded-for)
 * @param {Array} recentPosts - Recent posts for cross-session similarity (optional)
 * @returns {{ spam_score, signals, action, details }}
 */
export function spamAnalyze(title, description, authorId, ip, recentPosts = []) {
	const text = `${title} ${description}`;
	const signals = {};
	let totalScore = 0;
	let weightSum = 0;

	// 1. Content similarity (weight: 25)
	const fingerprint = computeFingerprint(text);
	let maxSimilarity = 0;
	let mostSimilar = null;
	for (const fp of _fingerprints.values()) {
		const sim = jaccardSimilarity(fingerprint, fp.text);
		if (sim > maxSimilarity) {
			maxSimilarity = sim;
			mostSimilar = fp;
		}
	}
	// Also check against recent posts from DB
	for (const rp of recentPosts) {
		const rpFp = computeFingerprint(`${rp.title || ""} ${rp.description || ""}`);
		const sim = jaccardSimilarity(fingerprint, rpFp);
		if (sim > maxSimilarity) {
			maxSimilarity = sim;
			mostSimilar = { text: rpFp, source: "recent_post" };
		}
	}
	signals.content_similarity = {
		score: Math.round(maxSimilarity * 100),
		detail: maxSimilarity > 0.5 ? `Similar to recent content (${Math.round(maxSimilarity * 100)}% match)` : null,
	};
	totalScore += signals.content_similarity.score * 25;
	weightSum += 25;

	// 2. Posting velocity (weight: 20)
	const now = Date.now();
	const vel = _velocity.get(ip) || { count: 0, firstSeen: now, lastSeen: now };
	// Reset if window expired
	if (now - vel.firstSeen > VELOCITY_WINDOW_MS) {
		vel.count = 0;
		vel.firstSeen = now;
	}
	vel.count++;
	vel.lastSeen = now;
	_velocity.set(ip, vel);
	const velocityRatio = vel.count / VELOCITY_MAX;
	signals.posting_velocity = {
		score: Math.min(100, Math.round(velocityRatio * 100)),
		detail: vel.count > 3 ? `${vel.count} posts in last minute` : null,
	};
	totalScore += signals.posting_velocity.score * 20;
	weightSum += 20;

	// 3. Link density (weight: 15)
	signals.link_density = {
		score: linkDensityScore(text),
		detail: linkDensityScore(text) > 40 ? "High URL-to-text ratio" : null,
	};
	totalScore += signals.link_density.score * 15;
	weightSum += 15;

	// 4. Suspicious URLs (weight: 10)
	signals.suspicious_urls = {
		score: suspiciousUrlScore(text),
		detail: suspiciousUrlScore(text) > 40 ? "Contains URL shorteners or suspicious TLDs" : null,
	};
	totalScore += signals.suspicious_urls.score * 10;
	weightSum += 10;

	// 5. Word repetition (weight: 10)
	signals.repetition = {
		score: repetitionScore(text),
		detail: repetitionScore(text) > 40 ? "Excessive word repetition" : null,
	};
	totalScore += signals.repetition.score * 10;
	weightSum += 10;

	// 6. Formatting abuse (weight: 10)
	signals.formatting = {
		score: formattingScore(text),
		detail: formattingScore(text) > 40 ? "Excessive caps, punctuation, or emoji" : null,
	};
	totalScore += signals.formatting.score * 10;
	weightSum += 10;

	// 7. Content quality (weight: 10)
	signals.quality = {
		score: qualityScore(text),
		detail: qualityScore(text) > 40 ? "Very short or low-quality content" : null,
	};
	totalScore += signals.quality.score * 10;
	weightSum += 10;

	// Final weighted score
	const spam_score = weightSum > 0 ? Math.round(totalScore / weightSum) : 0;

	// Determine action
	let action = "allow"; // score < 40
	if (spam_score >= 80) action = "quarantine";
	else if (spam_score >= 60) action = "review";
	else if (spam_score >= 40) action = "flag";

	// Store fingerprint for future similarity checks
	const fpKey = `${authorId}_${now}`;
	if (_fingerprints.size >= FINGERPRINT_MAX) {
		// Evict oldest
		const oldest = _fingerprints.keys().next().value;
		if (oldest) _fingerprints.delete(oldest);
	}
	_fingerprints.set(fpKey, { text: fingerprint, count: 1, firstSeen: now });

	// Cleanup expired fingerprints
	for (const [k, v] of _fingerprints) {
		if (now - v.firstSeen > FINGERPRINT_EXPIRY_MS) _fingerprints.delete(k);
	}

	// Cleanup expired velocity entries
	for (const [k, v] of _velocity) {
		if (now - v.lastSeen > VELOCITY_WINDOW_MS * 2) _velocity.delete(k);
	}

	return {
		spam_score,
		signals,
		action,
		details: {
			author_id: authorId,
			ip,
			fingerprint_size: fingerprint.size,
			similar_content_found: maxSimilarity > 0.3,
		},
	};
}

/**
 * Cleanup old velocity and fingerprint data.
 */
export function cleanupSpamData() {
	const now = Date.now();
	for (const [k, v] of _velocity) {
		if (now - v.lastSeen > VELOCITY_WINDOW_MS * 5) _velocity.delete(k);
	}
	for (const [k, v] of _fingerprints) {
		if (now - v.firstSeen > FINGERPRINT_EXPIRY_MS) _fingerprints.delete(k);
	}
}
