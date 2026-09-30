// Shared server-side content moderation + PII gate.
// Used by _posts.js, _comments.js, and _polls.js so NO content type can leak
// addresses, phone numbers, emails, or dangerous content to the public.
// Mirrors the pre-publish emergencyRegex whitelists (see _pre-publish.js).

import supabase from "./_db-client.js";
import { hasBlockedTerm } from "./_lexicon.js";

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
	// Lethal verbs are threat wording in ANY inflection — no intent tiebreak
	// and no fixed object list. ("kill you", "killed Rahul",
	// "are killing him"). This is what let a threat through before: the old
	// `\bkill\b` token simply never matched a conjugated verb.
const LETHAL_VERB =
	/\b(?:kill|murder|shoot|stab|strangle|drown|poison)(?:s|ed|ing)?\b/i;

const VIOLENCE_PATTERNS = [
	// Generic targets auto-block as `violence`. A NAMED target is matched too
	// (via the classifier below) so it can be HELD FOR REVIEW rather than
	// silently published.
	/\b(?:kill|murder|shoot|stab|hurt)(?:s|ed|ing)?\s+(?:you|him|her|them|me|us|our|your|my)\b/i,
	/\bbeat\s+(?:you|him|her|them|me|us)\s+up\b/i,
	/\bburn(?:s|ed|ing)?\s+(?:the|this|a|my)\s*(?:school|building|house|classroom)\b/i,
	/\bbomb(?:s|ed|ing)?\s+(?:the|this|a|my)\s*(?:school|building|house|classroom)\b/i,
	/\bbring(?:ing|s)?\s+(?:a\s+)?(?:gun|knife|weapon|bomb)\b/i,
	/\bkill(?:ing|s)?\s+(?:your|him|herself|himself|themselves|my)self\b/i,
	/\bhang(?:ing|s)?\s+(?:your|him|her|my|their)self\b/i,
	/\bkill\s+yourself\b/i,
	/\bkys\b/i,
	/\b(?:want(?:s|ed)?\s+to|going\s+to|will)\s+(?:die|commit\s+suicide)\b/i,
];
// Threat-vs-report context (Rajiv/Rahul rule): identical violent wording
// from the author is a direct threat; quoted/reported wording (a name +
// reporting verb, no first-person intent) is a victim/witness report.
// Reports are preserved for human review but never go public unreviewed.
const THREAT_REPORT_FRAME =
	/\b(?:said|says|saying|told|tells?|telling|threatened?|threatening|threatens?|claimed?|reported?|witnessed?|heard|saw|seen|according to)\b/i;
const FIRST_PERSON_INTENT =
	// First-person AUTHORSHIP, tolerant of typos and of tense: what separates a
	// threat from a report is WHO is speaking, not which modal verb they
	// picked ("i willl kill X" is still first-person). "me"/"my" are
	// excluded on purpose — in "he will kill me" they mark the VICTIM.
	/\b(?:i|i'm|i'll|gonna|going\s+to|want(?:ed|s)?\s+to|wish(?:ed|es)?\s+to|plan(?:ning|s)?\s+to|shall|must)\b/i;
/**
 * Classify violent-wording context. Pure (no I/O).
 * "clean" — no violent wording at all.
 * "direct_threat" — the author voices the threat (first-person intent).
 * "reported_threat" — quoted/reported wording, no first-person intent.
 * "unclear" — violent wording but neither signal; callers fail closed.
 */
export function evaluateContext(text) {
	const t = String(text || "");
	const violent =
		LETHAL_VERB.test(t) ||
		VIOLENCE_PATTERNS.some((p) => p.test(t)) ||
		(DANGEROUS_WORDS.test(t) && FIRST_PERSON_INTENT.test(t));
	if (!violent) return "clean";
	const reported = THREAT_REPORT_FRAME.test(t);
	const firstPerson = FIRST_PERSON_INTENT.test(t);
	if (reported && !firstPerson) return "reported_threat";
	if (firstPerson) return "direct_threat";
	return "unclear";
}
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
	"\\b\\d{1,5}[\\s,/\\-]*[a-zA-Z\\s]+\\b(?:" + PII_STREET_TYPES_AFTER + ")\\b",
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

// Explicit sexual sharing/solicitation — always BLOCKING. Word-boundary
// anchored so victim reports in clinical language ("harassed", "touched
// inappropriately", "eve-teasing") never match; only unambiguous sharing
// terms and propositions do.
const EXPLICIT_BLOCK = new RegExp(
	"\\b(?:nudes?|porn|pornographic|xxx|onlyfans|only\\s*fans|sex\\s*tapes?|sugar\\s*dadd(?:y|ies)|sugar\\s*bab(?:y|ies))\\b",
	"i",
);
const EXPLICIT_NAKED_PIC =
	/\bnaked\s+(?:pics?|photos?|videos?|selfies?|pictures?)\b/i;
// "hot pics/photos" solicitation or sharing, either order, including
// the common "phots" typo. "hot" alone never matches (weather, food,
// "hot lunch"); hot-first requires adjacency ("hot lunch photos" stays
// clean); noun-first allows a 4-char window ("pic hot") so ordinary
// prose like "photos in the hot sun" stays publishable.
const EXPLICIT_HOT_PIC =
	/\bhot\s+(?:pics?|photos?|phots?|pictures?|videos?|selfies?)\b|\b(?:pics?|photos?|phots?|pictures?)\b[^.!?]{0,4}\bhot\b/i;
// Coercion — perpetrator demands paired with exposure threats.
// "Pay me or I'll leak your photos", "send nudes or I post your address".
// Kept narrow (demand verb + or-else connector + exposure verb) so fee
// reminders ("pay the mess fee or lose your seat") never match.
// Victim reports ("someone is blackmailing me") are held for human review,
// never blocked — blocking them would silence the victim.
const BLACKMAIL_DEMAND =
	/\b(?:pay(?: me)?|send(?: me)?|give(?: me)?|transfer)\b[^.!?]{0,60}\b(?:or\s+(?:else|i(?:'ll| will))|otherwise|then\s+i(?:'ll| will)|,\s*i(?:'ll| will))\b[^.!?]{0,80}\b(?:leak|leaks|leaked|leaking|post|posts|posted|posting|share|shared|sharing|expose|exposed|exposing|tell\s+(?:everyone|everybody|all|them|the\s+(?:class|school|group|world))|upload|publish|send\s+(?:it|them|those|your))\b/i;
const DOX_THREAT =
	/\b(?:i(?:'ll| will)|gonna|going\s+to)\b[^.!?]{0,40}\b(?:post|publish|share|leak|drop|expose|upload)\b[^.!?]{0,40}\b(?:your|ur)\b[^.!?]{0,40}\b(?:address|number|phone|location|where you live|secret|secrets)\b/i;
// Photo/video sharing threats are ambiguous (event photos are legit), so
// they are HELD for human review rather than blocked.
const DOX_THREAT_PHOTO =
	/\b(?:i(?:'ll| will)|gonna|going\s+to)\b[^.!?]{0,40}\b(?:post|publish|share|leak|drop|expose|upload)\b[^.!?]{0,40}\b(?:your|ur)\b[^.!?]{0,40}\b(?:photo|pic|picture|video|videos|selfie)\b/i;
const DO_AS_I_SAY =
	/\bdo\s+(?:as\s+i\s+say|what\s+i\s+say)\b[^.!?]{0,60}\b(?:or\s+(?:else|i(?:'ll| will))|otherwise)\b/i;
const COERCION_VICTIM_REPORT =
	/\b(?:someone|somebody|some\s+one|he|she|they|this\s+(?:guy|person|boy|girl|man))\b[^.!?]{0,40}\b(?:blackmail(?:ing|ed|s)?|threaten(?:ed|ing|s)?|extort(?:ing|ed|s)?|forcing\s+me)\b|\b(?:blackmail(?:ing|ed)?|threaten(?:ed|ing)?|extort(?:ing|ed)?)\s+(?:me|him|her|them|us)\b/i;
// Ambiguous sexualization � HELD for human review on posts (never public
// auto), blocked on comments/polls which have no review queue.
const EXPLICIT_HOLD = /\b(?:sexy|hookups?)\b/i;


// Leaked secrets — passwords, API keys, tokens (spec §14). All require an
// assignment or a vendor prefix, so plain words ("I forgot my password",
// "secret santa") never match. BLOCKING like PII: a leaked credential must
// never go public on an anonymous platform.
const CRED_PATTERNS = [
	{ re: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, label: "password" },
	{ re: /\bapi[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_\-]{8,}['"]?/gi, label: "api key" },
	{ re: /\b(?:auth[_-]?token|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?\S+['"]?/gi, label: "token" },
	{ re: /\btoken\s*[:=]\s*['"]?[A-Za-z0-9_\-.~+/=]{8,}['"]?/gi, label: "token" },
	{ re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: "api key" },
	{ re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g, label: "token" },
	{ re: /\bAKIA[0-9A-Z]{16}\b/g, label: "api key" },
	{ re: /\bxox[bpras]-[A-Za-z0-9-]+\b/g, label: "token" },
	{ re: /\bBearer\s+[A-Za-z0-9\-._~+/]{10,}={0,2}\b/g, label: "token" },
];

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
 * - Violence threats and slurs are blocking (critical). Quoted/reported
 *   threats are held for review instead (threat_report) — never public,
 *   never silently dropped.
 * - Lower-severity flags set requiresReview so the caller can queue for review.
 */
export function serverModerate(title, description, learned = null) {
	// Strip invisible format characters first: zero-width joiners/spaces and
	// soft hyphens have no visible presence in prose — their only function
	// here is splitting banned words (sh​it). Fingerprints already drop them.
	const text = `${title} ${description}`.replace(/[\u200b-\u200d\ufeff\u00ad]/g, "");
	const flags = [];
	// Learning verdict for weak-only content (set below)
	let autoApproveWeak = false;

	// Threat-vs-report context (Rajiv/Rahul rule): a victim quoting a threat
	// ("Rajiv said he will kill me") is held for human review — never
	// auto-blocked (reports must survive) and never public unreviewed.
	// Direct threats from the author block exactly as before.
	// evaluateContext is the ONLY classifier; the routing reads its verdict
	// instead of re-testing brittle regexes. That duplication is exactly what
	// let a single-character typo disable the whole gate.
	const threatCtx = evaluateContext(text);
	// Generic-target violence auto-blocks. A NAMED target ("kill Rahul") is
	// held for a human instead, because naming someone is precisely the case
	// where a false positive would silence a real victim.
	// Unambiguous directed-harm patterns block outright — they need no
	// first-person intent ("go kill yourself", "kys" have none).
	const violenceHit = VIOLENCE_PATTERNS.some((p) => p.test(text));
	// Anything violent that is neither a confident direct hit nor a confirmed
	// report stays `threat`, which is HELD FOR REVIEW and never published.
	const threatHit = !violenceHit && threatCtx !== "clean";

	if (threatCtx === "reported_threat" && (violenceHit || threatHit)) {
		flags.push({
			type: "threat_report",
			severity: "high",
			message: "Reported threat — needs human review",
		});
	} else if (violenceHit) {
		flags.push({
			type: "violence",
			severity: "critical",
			message: "Violence threat detected",
		});
	} else if (threatHit) {
		flags.push({
			type: "threat",
			severity: "high",
			message: "Potential threat detected",
		});
	}

	// Check for slurs
	if (SLURS.test(text)) {
		flags.push({
			type: "hate_speech",
			severity: "critical",
			message: "Hate speech detected",
		});
	}

	// ── Profanity & slang — SCHOOL ZERO-TOLERANCE ─────────────────
	// A school platform publishes no stars: any profanity or slang hit is a
	// blocking `profanity` flag on every public write surface (posts,
	// comments, polls all 403 on `blocked` below — immediate, in-request).
	// Private support surfaces (inbox/chat) keep masking instead of blocking
	// so students can still ask for help. Victim reports that quote an insult
	// are still held to this bar: rephrase without the word to publish.
	// Detection lives in api/_lexicon.js so the blocking gate, the slang
	// finder, and the client mirror all run the SAME spelling-proof match:
	// de-leet, repeat collapse, interior separators, single-letter joining,
	// zero-width/NFKC, plus the Hinglish variants — instead of one flat list
	// that only matched spelling for spelling.
	if (hasBlockedTerm(text)) {
		flags.push({
			type: "profanity",
			severity: "high",
			message: "Profanity or slang detected — remove the language and resubmit",
		});
	}

	// Direct bullying — the author abusing someone ("you are an idiot",
	// "you suck", "shut up"). Victim reports describing others carry
	// reporting verbs/nouns and pass through to human review layers
	// instead of auto-blocking.
	const BULLY_WORDS =
		/\b(idiot|loser|ugly|fat|disgusting|pathetic|worthless|trash|moron|dumb|no one likes you|everyone hates you|you suck|shut up)\b/i;
	const DIRECT_ABUSE =
		/\b(you\s+are|you're|you\s+will|you\s+should|you\s+deserve)\s+(a\s+)?(idiot|stupid|loser|ugly|fat|disgusting|pathetic|worthless|trash|moron|dumb|terrible|horrible|worst)/i;
	const REPORTING_CTX =
		/\b(reported?|complains?|complained|describes?|described|mentions?|mentioned|tells?|told|says?|said|claims?|claimed|witnessed?|saw|heard|student|teacher|staff|someone|they|he|she|bully|bullying|threats?|harassment)\b/i;
	if (
		BULLY_WORDS.test(text) &&
		(DIRECT_ABUSE.test(text) ||
			(/\byou\b/i.test(text) && !REPORTING_CTX.test(text)))
	) {
		flags.push({
			type: "bullying",
			severity: "critical",
			message: "Bullying language detected",
		});
	}

	// ── PII — email / phone / street address / name+address ─────
	if (PII_EMAIL_RE.test(text))
		flags.push({
			type: "privacy",
			severity: "high",
			message: "Email address detected",
		});
	// Leaked secrets — passwords, API keys, tokens. Same blocking class as
	// PII: a leaked credential must never go public.
	for (const { re, label } of CRED_PATTERNS) {
		re.lastIndex = 0;
		if (re.test(text)) {
			flags.push({
				type: "privacy",
				severity: "high",
				message: `Exposed ${label} detected`,
			});
			break;
		}
	}
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
	// ── Named accusation — a named person accused of wrongdoing ────
	// "Student Rahul accused of blackmailing a peer" names a real-seeming
	// person in an allegation. Published blind, that is defamation by the
	// platform; a human verifies first. WEAK (never blocking): posts go to
	// pending_review, comments/polls are blocked (no queue there).
	// Sentence-initial capitalized words are skipped — ordinary
	// capitalization ("Rahul stole my pen" at a sentence start still counts
	// only if a LATER capitalized name appears; leading words are never
	// names by themselves).
	const ACCUSE_VERBS =
		/\b(accuse[sd]?|accusing|blackmail(?:s|ed|ing)?|extort(?:s|ed|ing|ion)?|threaten(?:s|ed|ing)?|harass(?:es|ed|ing|ment)?|bull(?:y|ies|ied|ying)|assault(?:s|ed|ing)?|molest(?:s|ed|ing)?|steal(?:s|ing)?|stole|stolen|cheat(?:s|ed|ing)?|framed?|framing|blam(?:e[sd]?|ing))\b/i;
	const GENERIC_CAPITALIZED =
		/^(?:The|This|That|These|Those|Students?|Teachers?|Staff|School|Class|Classes|Someone|Nobody|Everybody|Anyone|My|Our|His|Her|Their|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|English|Hindi|Library|Canteen|Hostel|Block)$/i;
	if (ACCUSE_VERBS.test(text)) {
		const names = text
			.split(/(?<=[.!?])\s+/)
			.flatMap((sentence) => sentence.split(/\s+/).slice(1))
			.map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ""))
			.filter(
				(w) => /^[A-Z][a-z]{2,}$/.test(w) && !GENERIC_CAPITALIZED.test(w),
			);
		const seen = [...new Set(names)];
		if (seen.length > 0) {
			flags.push({
				type: "accusation_weak",
				severity: "high",
				message: `Named person in an accusation ("${seen.slice(0, 3).join('", "')}") — needs review`,
			});
		}
	}
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
	// Street type + comma + Capitalized place mid-text ("Park Street,
	// Kolkata, come visit"). The place must start uppercase (checked against
	// the ORIGINAL case) so "cross the road, be careful" never flags; bare
	// street mentions without a place stay the LLM layer's job — they are
	// genuinely ambiguous civic speech ("MG Road has potholes").
	const midAddr = new RegExp(
		"\\b(?:" + PII_STREET_TYPES_AFTER + ")\\b\\s*,\\s*([A-Za-z]{3,})",
		"i",
	).exec(text);
	if (midAddr && /^[A-Z]/.test(midAddr[1]))
		flags.push({
			type: "privacy_weak",
			severity: "high",
			message: "Partial address detected",
		});
	// Self-located street mention: "I live on Park Street", "we stay near
	// MG Road". No name/number needed — verb + street is itself a location
	// disclosure. WEAK (never blocking): area-level civic speech shares the
	// shape ("living on Park Street face waterlogging") and a human
	// disambiguates in review; nothing publishes blind either way.
	if (
		new RegExp(
			"\\b(?:lives?|living|stays?|staying|resides?|residing)\\s+(?:at|in|on|near)\\s+[A-Za-z0-9\\s]+\\b(?:" +
				PII_STREET_TYPES_AFTER +
				")\\b",
			"i",
		).test(text)
	)
		flags.push({
			type: "privacy_weak",
			severity: "high",
			message: "Possible self-located address — needs review",
		});

	// Explicit sexual sharing/solicitation — always BLOCKING (severity
	// critical feeds `blocked` below). No reporting-context exemption: even
	// framed as a report, sexual imagery must go through a human, never
	// straight to public. Ambiguous sexualization ("sexy", "hookup") only
	// HELDS: posts → pending_review, comments/polls → blocked (no queue).
	if (EXPLICIT_BLOCK.test(text) || EXPLICIT_NAKED_PIC.test(text) || EXPLICIT_HOT_PIC.test(text)) {
		flags.push({
			type: "explicit",
			severity: "critical",
			message: "Explicit sexual content detected",
		});
	} else if (EXPLICIT_HOLD.test(text)) {
		flags.push({
			type: "explicit_weak",
			severity: "high",
			message: "Possible sexual content — needs review",
		});
	}

	// Coercion — blackmail, extortion, doxxing threats (spec §14/§15).
	// Perpetrator demands BLOCK (critical); victim reports are HELD for
	// human review and never blocked — the check order matters.
	if (COERCION_VICTIM_REPORT.test(text)) {
		flags.push({
			type: "coercion_report",
			severity: "high",
			message: "Possible blackmail/extortion report — needs review",
		});
	} else if (
		BLACKMAIL_DEMAND.test(text) ||
		DOX_THREAT.test(text) ||
		DO_AS_I_SAY.test(text)
	) {
		flags.push({
			type: "coercion",
			severity: "critical",
			message: "Blackmail/extortion demand detected",
		});
	} else if (DOX_THREAT_PHOTO.test(text)) {
		flags.push({
			type: "coercion_weak",
			severity: "high",
			message: "Possible photo-sharing threat — needs review",
		});
	}

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
		// address/phone/email must never go public. Profanity/slang is
		// likewise blocking (school zero-tolerance: no stars, immediate
		// 403 on every public write surface).
		blocked: flags.some(
			(f) =>
				f.severity === "critical" ||
				f.type === "privacy" ||
				f.type === "profanity",
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
		.replace(/(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, "[CREDENTIAL]")
		.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "[CREDENTIAL]")
		.replace(/\bgh[pousr]_[A-Za-z0-9]{36}\b/g, "[CREDENTIAL]")
		.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[CREDENTIAL]")
		.replace(/\bxox[bpras]-[A-Za-z0-9-]+\b/g, "[CREDENTIAL]")
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
 * @param {string} ip - Client IP (via clientIp: x-real-ip / rightmost XFF / socket)
 * @param {Array} recentPosts - Recent posts for cross-session similarity (optional)
 * @returns {{ spam_score, signals, action, details }}
 */
export function spamAnalyze(title, description, authorId, ip, recentPosts = [], cfg = SPAM_THRESHOLDS) {
	const thresholds = normalizeSpamConfig(cfg);
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

	// Determine action — thresholds come from admin settings (spam_config),
	// so the deployment can tune sensitivity without a code change.
	let action = "allow"; // score < flag
	if (spam_score >= thresholds.quarantine) action = "quarantine";
	else if (spam_score >= thresholds.review) action = "review";
	else if (spam_score >= thresholds.flag) action = "flag";

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

// ═══════════════════════════════════════════════════════════════
// ADMIN-TUNABLE SPAM SENSITIVITY (settings key `spam_config`)
// ═══════════════════════════════════════════════════════════════
// The flag/review/quarantine thresholds were hardcoded; admins had no way to
// tune false positives (too aggressive) or false negatives (too lax).
// Defaults preserve the previous behaviour exactly.

export const SPAM_THRESHOLDS = Object.freeze({ flag: 40, review: 60, quarantine: 80 });

/** Clamp any partial config to a valid threshold set. Invalid / out-of-range
 *  values fall back to defaults; ordering is enforced (flag < review < quarantine). */
export function normalizeSpamConfig(raw) {
	const num = (v, dflt) => {
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : dflt;
	};
	let flag = num(raw?.flag, SPAM_THRESHOLDS.flag);
	let review = num(raw?.review, SPAM_THRESHOLDS.review);
	let quarantine = num(raw?.quarantine, SPAM_THRESHOLDS.quarantine);
	// Enforce ordering — a config with review <= flag would make "review" dead.
	if (review <= flag) review = Math.min(100, flag + 5);
	if (quarantine <= review) quarantine = Math.min(100, review + 5);
	return { flag, review, quarantine };
}

/** Read the deployment's spam config from the settings store. Any failure
 *  returns the defaults — moderation must never go down because config did. */
export async function getSpamConfig(supabase) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "spam_config")
			.maybeSingle();
		const raw = data?.value;
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		return normalizeSpamConfig(parsed);
	} catch {
		return normalizeSpamConfig(null);
	}
}

// ═══════════════════════════════════════════════════════════════
// SAFETY REPOST GUARD (settings key `safety_repost_blocklist`)
// Fingerprints of safety-blocked/hidden text; matching reposts are rejected
// with SAFETY_REPOST_BLOCKED plus an attempt counter. Fingerprint-only
// storage (never raw text). serverModerate stays the primary gate.
// ═══════════════════════════════════════════════════════════════

export const SAFETY_REPOST_KEY = "safety_repost_blocklist";
const SAFETY_REPOST_MAX = 200;
// Below this normalized length a fingerprint is too generic to enforce
// (a bare phone number is 10 digits; anything shorter risks collisions).
const SAFETY_FP_MIN_LEN = 8;

/** Pure: normalize text to a comparable fingerprint. "" = too short to enforce. */
export function fingerprintSafetyText(text) {
	if (typeof text !== "string" || !text) return "";
	const fp = text
		.toLowerCase()
		.normalize("NFKC")
		.replace(/[^a-z0-9]/g, "");
	return fp.length >= SAFETY_FP_MIN_LEN ? fp : "";
}

async function readSafetyBlocklist(client) {
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", SAFETY_REPOST_KEY)
			.maybeSingle();
		const items = data?.value?.items;
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
}

/** Record a safety-blocked/hidden text. Best-effort; never throws. Returns true when stored. */
export async function recordSafetyRepost(client, text, rule) {
	try {
		const fp = fingerprintSafetyText(text);
		if (!fp) return false;
		const items = await readSafetyBlocklist(client);
		const now = new Date().toISOString();
		const hit = items.find((e) => e?.fp === fp);
		if (hit) {
			hit.attempts = (hit.attempts || 1) + 1;
			hit.last_at = now;
		} else {
			items.unshift({ fp, rule: String(rule || "policy"), attempts: 1, first_at: now, last_at: now });
		}
		await client.from("settings").upsert(
			{ key: SAFETY_REPOST_KEY, value: { items: items.slice(0, SAFETY_REPOST_MAX), updated_at: now } },
			{ onConflict: "key" },
		);
		return true;
	} catch {
		return false;
	}
}

/** Check a submission against the blocklist. Never throws; fail-open (fail-closed is serverModerate's job). */
export async function checkSafetyRepost(client, text) {
	try {
		const fp = fingerprintSafetyText(text);
		if (!fp) return { blocked: false };
		const items = await readSafetyBlocklist(client);
		const hit = items.find((e) => e?.fp === fp);
		if (!hit) return { blocked: false };
		return { blocked: true, rule: hit.rule || "policy", attempts: hit.attempts || 1 };
	} catch {
		return { blocked: false };
	}
}

/**
 * Remove a fingerprint from the safety blocklist (appeal overturn path).
 * A vindicated text must not keep tripping SAFETY_REPOST_BLOCKED on
 * resubmission. Best-effort; returns true when an entry was removed.
 */
export async function clearSafetyRepost(client, text) {
	try {
		const fp = fingerprintSafetyText(text);
		if (!fp) return false;
		const items = await readSafetyBlocklist(client);
		const kept = items.filter((e) => e?.fp !== fp);
		if (kept.length === items.length) return false;
		await client.from("settings").upsert(
			{ key: SAFETY_REPOST_KEY, value: { items: kept, updated_at: new Date().toISOString() } },
			{ onConflict: "key" },
		);
		return true;
	} catch {
		return false;
	}
}
