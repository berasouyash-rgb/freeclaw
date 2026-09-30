// ═══════════════════════════════════════════════════════════════════
// CONTEXTUAL CLASSIFIER — meaning first, lexicon second
// ═══════════════════════════════════════════════════════════════════
// The classifier this replaces was keyword-FIRST: a lexicon hit returned a
// severity and nothing else ever ran. That inverts the two cases that matter
// most for a school platform:
//
//   "I hate this homework."     matched the lexicon → flagged HIGH
//   "Rahul, I hate you."        matched nothing    → flagged NONE
//
// and it could not distinguish native abuse from REPORTED abuse at all, so
// "Rahul said 'I hate you' yesterday" and "I hate you" scored identically.
//
// This module treats lexicon hits as EVIDENCE. It first extracts deterministic
// signals that carry the context a word list cannot see — who is being
// addressed (names, vocatives, pronouns, second person), whether the hostile
// text is asserted or quoted/reported, which script/language is in play — and
// composes them into a bounded severity. A model then refines the answer
// INSIDE those bounds. Two rules stay deterministic on purpose, because safety
// must never depend on a model being reachable or well-behaved:
//
//   • the crisis floor — self-harm language can never be reasoned away
//   • output allowlisting — a garbage or prompt-injected reply can only
//     produce a value from the fixed enums below, never a novel one
//
// Layering (mirrors the intended pipeline, not a single `.includes()` call):
//   normalize → signals → deterministic severity → model refinement →
//   bounded merge → structured decision
//
// The decision is structured and never mutates state directly: AI reasons,
// policy enforces. Callers decide what to do with `recommended_action`.
import { recordAiCall } from "./_ai-health.js";
import { callLLMChain, callNvidiaFast } from "./_providers.js";

/** Bumped whenever the signal rules or prompt change, for audit traceability. */
export const POLICY_VERSION = "context-v1";

/** The single severity vocabulary. Reused as the UI's canonical `level`, so
 *  there is exactly one set of names between classifier and dashboard — two
 *  vocabularies is the drift bug this whole area has already suffered once. */
export const SEVERITIES = ["none", "mild", "moderate", "high", "critical"];

/** Structured outcomes. `block` is deliberately never auto-recommended here:
 *  this layer classifies, the deterministic moderation gate punishes. */
export const ACTIONS = ["allow", "warn", "limit", "review", "block", "escalate"];

const SEVERITY_RANK = new Map(SEVERITIES.map((s, i) => [s, i]));
const atLeast = (a, b) => (SEVERITY_RANK.get(a) >= SEVERITY_RANK.get(b) ? a : b);

const ACTION_BY_SEVERITY = {
	none: "allow",
	mild: "warn",
	moderate: "limit",
	high: "review",
	critical: "escalate",
};

const EMOTION_FOR_NEW_CATEGORY = {
	threat: "anger",
	"targeted-harassment": "anger",
	"reported-abuse": "neutral",
};

const VALID_EMOTIONS = [
	"none",
	"frustrated",
	"anxious",
	"sad",
	"angry",
	"positive",
	"neutral",
	"critical_distress",
	"anger",
];
const VALID_AGENTS = ["general", "emotional"];

// ─── Normalization ─────────────────────────────────────────────────
// Zero-width characters are the classic way to slip a word past a matcher,
// and smart quotes would otherwise break every quoted-speech rule below.
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060]/g;
const SMART_SINGLE_RE = /[\u2018\u2019\u201A\u201B\u2032]/g;
const SMART_DOUBLE_RE = /[\u201C\u201D\u201E\u201F\u2033]/g;

export function normalizeText(text) {
	if (typeof text !== "string") return "";
	return text
		.replace(ZERO_WIDTH_RE, "")
		.replace(SMART_SINGLE_RE, "'")
		.replace(SMART_DOUBLE_RE, '"')
		.replace(/\s+/g, " ")
		.trim();
}

// Obfuscation: school users write "h4te" and "k1ll" precisely to slip past a
// matcher. Digits only — mapping punctuation would turn "kys!" into "kysi"
// and break the word boundary that makes the lexicon safe.
const LEET_DIGITS = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b" };

/** Matching-only copy: lowercased and de-leeted. Never shown to users. */
export function normalizeForMatch(text) {
	return normalizeText(text)
		.toLowerCase()
		.replace(/[0134578]/g, (c) => LEET_DIGITS[c] || c);
}

/** Word-boundary alternation with escaped literals. Substring matching makes
 *  "rag" fire on "average"/"storage"/"fragment"; `\b` on both ends is the
 *  difference between a lexicon and a false-positive generator. */
export function buildWordRe(words, flags = "i") {
	const escaped = words
		.filter((w) => typeof w === "string" && w.length > 0)
		.map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		// Longest first so "kill myself" wins over "kill".
		.sort((a, b) => b.length - a.length);
	if (!escaped.length) return null;
	return new RegExp(`\\b(?:${escaped.join("|")})\\b`, flags);
}

// ─── Intent lexicons ───────────────────────────────────────────────
// These are a DIFFERENT axis from a courtesy/profanity word list: they encode
// threat and directed hostility, which is what school-safety escalation needs.
// They are one signal among many — never the verdict.
const THREAT_TERMS = [
	"kill", "kys", "kms", "kill yourself", "kill urself", "unalive",
	"unalive yourself", "die", "you should die", "go die", "drop dead",
	"dead", "death", "die tomorrow", "end you", "end your life",
	"disappear", "you should disappear", "hurt", "hurt you", "harm you",
	"beat", "beat you up", "hit you", "slap", "punch", "stab", "shoot",
	"choke", "strangle", "break your", "smash your", "destroy you",
	"finish you", "finished", "you are finished", "yer finished",
	"don't come to school", "dont come to school", "don't come here",
	"dont come here", "don't come back", "dont come back",
	"mat aana", "mat aa",
	"gonna get you", "going to get you", "i will get you", "we will get you",
	"jaan se", "jaan se maar", "khoon", "khatam", "maar", "maro",
	"marunga", "marungi", "pitai", "pitunga", "thrash him", "jump him",
];

const HOSTILITY_TERMS = [
	"hate", "hates", "hated", "hate you", "hate him", "hate her",
	"stupid", "idiot", "idiotic", "dumb", "moron", "fool", "retard",
	"ugly", "loser", "worthless", "pathetic", "useless", "creep", "freak",
	"shut up", "shutup", "nobody likes you", "no one likes you",
	"trash", "garbage", "scum", "waste of space", "weirdo",
	"pagal", "chutiya", "bewakoof", "harami", "haraami", "kutta", "kutti",
	"saala", "sala", "kamina", "bhadwa", "nalayak", "nikamma", "tatti",
	"bhosdi", "gandu", "madarchod", "nalle",
];

/** Overlap with the blocking lexicons, reported as evidence only. */
const PROFANITY_RE = [
	"fuck", "fucking", "shit", "bitch", "bastard", "asshole", "dick",
	"pussy", "whore", "slut", "cunt", "motherfucker", "bullshit", "wtf",
];

const CRISIS_TERMS = [
	"suicide", "kill myself", "killing myself", "end my life",
	"ending my life", "end it all", "ending it all", "want to die",
	"wanna die", "wish i was dead", "better off dead", "self harm",
	"self-harm", "hurt myself", "harming myself", "cut myself", "cutting myself",
	"no reason to live", "can't go on", "cant go on", "not worth living",
	"marna chahta", "marna chahti", "jaan de dunga", "khud ko nuksan",
	"khudkushi", "morte chai", "nijeke aghat", "atmahatya",
];

/** Where hostile text is addressing the reader/another person, not an object. */
const SECOND_PERSON_RE = /\b(you|u|ur|your|yours|you're|youre|yall|ya|tum|tumhe|tu|tera|teri|tujhe|apni|apna)\b/i;
const THIRD_PERSON_OBJ_RE = /\b(him|her|them|us|usko|use|unko|unhe)\b/i;

/** Collective/"everyone" framing: "everyone hates him" is a statement ABOUT a
 *  person — real harassment, but a step below direct address. */
const COLLECTIVE_RE = /\b(everyone|everybody|all of us|the whole class|sab log|sabko|sob)\b/i;

const REPORTING_RE =
	/\b(said|says|saying|told|tells|telling|wrote|writing|posted|commented|messaged|texted|shared|quoted|claimed|reported|screenshot|screened)\b/i;

/** Tokens that are capitalised for reasons other than being a name. Without
 *  this, "Everyone", "Monday" and "School" all read as people. */
const NON_NAME_WORDS = new Set([
	"i", "im", "i'm", "ive", "i've", "id", "a", "an", "the", "my", "me", "we",
	"our", "us", "he", "she", "they", "it", "this", "that", "these", "those",
	"there", "here", "what", "when", "where", "why", "how", "who", "whom",
	"everyone", "everybody", "someone", "somebody", "anyone", "nobody",
	"people", "school", "class", "teacher", "sir", "maam", "madam", "miss",
	"mrs", "mr", "ms", "dr", "today", "tomorrow", "yesterday", "tonight",
	"monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
	"sunday", "january", "february", "march", "april", "may", "june", "july",
	"august", "september", "october", "november", "december", "also", "and",
	"but", "so", "yes", "no", "ok", "okay", "please", "because", "if", "then",
	"than", "just", "really", "very", "not", "omg", "lol", "bro", "dude",
	"guys", "yaar", "bhai", "behen", "please", "thanks", "thank", "hi",
	"hello", "hey", "good", "bad", "sorry", "why", "every", "all", "some",
	"many", "most", "few", "one", "two", "three", "first", "last", "next",
	"new", "old", "big", "small", "am", "is", "are", "was", "were", "be",
	"been", "have", "has", "had", "do", "does", "did", "can", "could", "will",
	"would", "should", "must", "might", "get", "got", "go", "going", "come",
	"came", "make", "made", "take", "took", "give", "gave", "know", "think",
	"want", "need", "feel", "felt", "look", "looks", "seem", "seems",
]);

/** Peer address words — a real addressee, but not an identifiable person. */
const PEER_ADDRESS = new Set(["bro", "dude", "guys", "yaar", "bhai", "behen", "sis", "brother", "sister"]);

/**
 * Builds the `{ keywordDetect, levelByCategory, emotionByCategory }` bundle the
 * composer expects from a category → word-list map. One implementation of the
 * word-boundary + first-match rule, so a caller cannot reintroduce the
 * substring matching (`includes("rag")` firing on "average") by hand.
 */
export function makeEmotionLexicon(emotionKeywords, maps = {}) {
	const compiled = Object.entries(emotionKeywords || {})
		.map(([category, words]) => [category, buildWordRe(words)])
		.filter(([, re]) => !!re);
	return {
		keywordDetect(text) {
			const value = typeof text === "string" ? text : "";
			for (const [category, re] of compiled) {
				re.lastIndex = 0;
				if (re.test(value)) return category;
			}
			return null;
		},
		levelByCategory: maps.levelByCategory || {},
		emotionByCategory: maps.emotionByCategory || {},
	};
}

// ─── Deterministic signal extraction (pure, no I/O) ────────────────

/** Character ranges of quoted spans — used to separate asserted from quoted. */
function quotedSpans(text) {
	const spans = [];
	const re = /"([^"]{1,400})"|'([^']{1,400})'/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		spans.push([m.index, m.index + m[0].length]);
		if (spans.length >= 10) break;
	}
	return spans;
}

const insideSpans = (index, spans) => spans.some(([a, b]) => index >= a && index < b);

/**
 * Who the message is aimed at. Deliberately structural — no list of student
 * names exists or should exist. A vocative ("Rahul, …"), a mid-sentence
 * capital that is not a stopword, a third-person object pronoun, or second
 * person all indicate a person target; "I hate this homework" targets an
 * object and therefore has none.
 */
export function detectTarget(text) {
	if (!text) return null;

	// 1. Vocative — "Rahul, ..." (the comma is what makes it address).
	const vocative = text.match(/(?:^|[.!?,]\s+)([A-Z][a-z]{1,20})\s*[,!]/);
	if (vocative) {
		const lower = vocative[1].toLowerCase();
		if (PEER_ADDRESS.has(lower)) return { kind: "peer", value: lower };
		if (!NON_NAME_WORDS.has(lower)) return { kind: "name", value: vocative[1] };
	}

	// 2. A capital mid-sentence that is not a stopword — "everyone hates Rahul".
	const capRe = /\b([A-Z][a-z]{2,20})\b/g;
	let m;
	while ((m = capRe.exec(text)) !== null) {
		const lower = m[1].toLowerCase();
		if (NON_NAME_WORDS.has(lower)) continue;
		const before = text.slice(0, m.index).trimEnd();
		const atSentenceStart = before === "" || /[.!?]$/.test(before);
		if (atSentenceStart) continue;
		return { kind: "name", value: m[1] };
	}

	// 3. Third-person object pronoun.
	const third = text.match(THIRD_PERSON_OBJ_RE);
	if (third) return { kind: "pronoun", value: third[1].toLowerCase() };

	// 4. Second person — the reader is the target.
	const second = text.match(SECOND_PERSON_RE);
	if (second) return { kind: "second-person", value: "you" };

	return null;
}

/** Which script the message is in — evidence for the model, and proof that a
 *  transliterated lexicon alone would miss content. */
export function detectScript(text) {
	if (/[\u0900-\u097F]/.test(text)) return "devanagari";
	if (/[\u0980-\u09FF]/.test(text)) return "bengali";
	if (/[\u0B80-\u0BFF]/.test(text)) return "tamil";
	if (/[\u0C00-\u0C7F]/.test(text)) return "telugu";
	return "latin";
}

/**
 * Every cheap, explainable signal, extracted once. Pure: same input, same
 * output, no network, no clock. This is what makes classification work even
 * when no model is reachable — the failure mode that used to silently
 * degrade to "keyword matched or nothing".
 */
export function extractSignals(rawText) {
	const text = normalizeText(rawText);
	// Lexicons match against the de-leeted copy; target detection and the
	// model keep the original casing and spelling.
	const norm = normalizeForMatch(rawText);

	const findHits = (re) => {
		const hits = [];
		if (!re) return hits;
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(norm)) !== null) {
			hits.push({ term: m[0], index: m.index });
			if (hits.length >= 25) break;
			if (m[0].length === 0) re.lastIndex += 1;
		}
		return hits;
	};

	const crisisHits = findHits(THREAT_CRISIS_RE);
	const threatHits = findHits(THREAT_RE);
	const hostilityHits = findHits(HOSTILITY_RE);
	const profanityHits = findHits(PROFANITY_ONLY_RE);

	const spans = quotedSpans(text);
	const reporting = REPORTING_RE.test(text);

	// Quoted if ANY hostile term sits inside quotes. A term outside the quotes
	// means the writer is asserting it themselves, however much they quote.
	const hostileHits = [...threatHits, ...hostilityHits];
	const quotedHostility =
		hostileHits.length > 0 && hostileHits.every((h) => insideSpans(h.index, spans));

	const target = detectTarget(text);
	const secondPerson = SECOND_PERSON_RE.test(text);

	return {
		text,
		// The de-leeted copy, for lexicon matching (emotion keywords included).
		matchText: norm,
		language: detectScript(text),
		crisisHits,
		threatHits,
		hostilityHits,
		profanityHits,
		quotedSpans: spans,
		// "Reported" only means something when there IS hostile/threat content
		// to report. A neutral sentence that merely contains a reporting verb
		// ("the notice says the lab closes at 4", "he told us about the exam")
		// is not a report of abuse. Treating it as one pushed a `threat_report`
		// flag through POLICY for every sentence containing said/says/told, so
		// ordinary feedback was quarantined or blocked, and a privacy leak was
		// mislabelled as a threat.
		reported:
			(reporting && (threatHits.length > 0 || hostilityHits.length > 0)) ||
			quotedHostility,
		quotedHostility,
		// Reported speech is only a *defence* when the text is described, not
		// asserted. "Rahul said I hate you" and "Rahul said 'I hate you'" both
		// count; "I hate you" does not.
		hasHostility: hostilityHits.length > 0,
		hasThreat: threatHits.length > 0,
		hasCrisis: crisisHits.length > 0,
		target,
		secondPerson,
		collective: COLLECTIVE_RE.test(text),
		tokens: norm.split(/[^a-z0-9\u0900-\u097F\u0980-\u09FF']+/i).filter(Boolean),
	};
}

// Built once at module load (the lexicons are constants).
const THREAT_CRISIS_RE = buildWordRe(CRISIS_TERMS);
const THREAT_RE = buildWordRe(THREAT_TERMS);
const HOSTILITY_RE = buildWordRe(HOSTILITY_TERMS);
const PROFANITY_ONLY_RE = buildWordRe(PROFANITY_RE);

// ─── Deterministic decisions ───────────────────────────────────────

/**
 * Composes a severity from signals alone. Every branch is explainable and
 * testable without a model, and the ordering is the policy:
 *
 *   crisis                                   → critical
 *   threat, directed or not                  → high
 *   threat, reported                         → moderate
 *   hostility aimed at an addressed person   → high
 *   hostility aimed at a third party         → moderate
 *   hostility, reported only                 → mild (still surfaced)
 *   hostility with no person target          → mild ("I hate this homework")
 *   distress / anxiety / sadness language    → high / moderate / moderate
 *   courtesy words alone (slang, profanity)  → none (the gate handles those)
 */
export function composeDecision(signals, lexicon = {}) {
	const { levelByCategory = {}, emotionByCategory = {} } = lexicon;
	const categories = [];
	const evidence = [];
	let severity = "none";
	let category = "neutral";

	// The category names the DECISIVE signal: it only follows a severity that
	// actually raised the verdict, so a friendly word can never relabel a threat.
	const raise = (s, cat) => {
		const next = atLeast(severity, s);
		if (SEVERITY_RANK.get(next) > SEVERITY_RANK.get(severity) && cat) category = cat;
		severity = next;
	};
	let emotionCategory = null;

	if (signals.hasCrisis) {
		return {
			severity: "critical",
			category: "critical",
			categories: ["self-harm"],
			target: signals.target,
			confidence: 0.95,
			emotion: emotionByCategory.critical || "critical_distress",
			explanation:
				"Self-harm or crisis language is present. Escalated deterministically — this floor is never model-decided.",
			evidence: signals.crisisHits.map((h) => `crisis:${h.term}`),
		};
	}

	if (signals.hasThreat) {
		categories.push("threat");
		evidence.push(...signals.threatHits.map((h) => `threat:${h.term}`));
		if (signals.reported) raise("moderate", "reported-abuse");
		else raise("high", "threat");
	}

	if (signals.hasHostility) {
		const directed = !!signals.target;
		const addressed =
			directed &&
			(signals.target.kind === "name" ||
				signals.target.kind === "second-person" ||
				signals.target.kind === "peer");

		if (signals.reported) {
			raise("mild", "reported-abuse");
			if (!categories.includes("reported-abuse")) categories.push("reported-abuse");
		} else if (addressed) {
			raise("high", "targeted-harassment");
			categories.push("targeted-harassment");
		} else if (directed) {
			raise("moderate", "targeted-harassment");
			categories.push("targeted-harassment");
		} else {
			raise("mild", "anger");
			categories.push("anger");
		}
		evidence.push(...signals.hostilityHits.map((h) => `hostility:${h.term}`));
	}

	if (signals.profanityHits.length) {
		categories.push("profanity");
		evidence.push(...signals.profanityHits.map((h) => `profanity:${h.term}`));
	}

	// Emotion lexicon — the writer's own state. A hit that does not decide the
	// verdict still shapes the reported emotion and the thread routing, so
	// "thank you" stays positive and "I am so stressed" still routes warmly.
	const lexiconCategory = lexicon.keywordDetect
		? lexicon.keywordDetect(signals.matchText)
		: null;
	if (lexiconCategory) {
		categories.push(lexiconCategory);
		const mapped = levelByCategory[lexiconCategory] || "none";
		raise(signals.reported ? "mild" : mapped, lexiconCategory);
		if (severity === "none") emotionCategory = lexiconCategory;
	}

	if (signals.collective && severity !== "none" && severity !== "critical") {
		evidence.push("collective-framing");
	}

	const unique = [...new Set(categories)];
	// Name the decisive category, falling back to the writer's own emotion when
	// nothing decisive fired, so "positive" and "sad" are still reported.
	const reportedCategory = category !== "neutral" ? category : emotionCategory || "neutral";
	return {
		severity,
		category: reportedCategory,
		categories: unique,
		target: signals.target,
		confidence: severity === "none" ? 0.6 : 0.75,
		explanation: explain(category, signals),
		evidence,
		// Emotion string for the UI: the new intent categories map onto "anger",
		// lexicon categories keep their configured name.
		emotion:
			emotionByCategory[category] ||
			EMOTION_FOR_NEW_CATEGORY[category] ||
			emotionByCategory[emotionCategory] ||
			"neutral",
	};
}

function explain(category, signals) {
	const who = signals.target ? `${signals.target.kind}:${signals.target.value}` : "no person target";
	switch (category) {
		case "critical":
			return "Crisis language directed at the writer.";
		case "threat":
			return `Threat language present (${who})${signals.reported ? ", reported rather than asserted" : ""}.`;
		case "targeted-harassment":
			return `Hostile language aimed at ${who}${signals.reported ? ", quoted/reported" : ""}.`;
		case "reported-abuse":
			return "Hostile language that the writer is reporting or quoting, not asserting.";
		case "anger":
			return "Frustration or dislike with no person being targeted.";
		case "positive":
			return "Positive tone.";
		default:
			return signals.tokens.length === 0 ? "Empty message." : "No safety or emotional signal.";
	}
}

// ─── Model refinement (optional, bounded) ──────────────────────────

const SYSTEM_PROMPT = `You classify one message written by an anonymous student on a school feedback platform.

Judge MEANING AND CONTEXT, not keywords. The same word is not the same act:
- "I hate this homework."          → venting about a task, no person targeted
- "Rahul, I hate you."             → harassment aimed at a person
- "Rahul said 'I hate you'."       → the writer is REPORTING abuse, not committing it
- "Rahul helped me with maths."    → harmless
- "go kys" / "you're finished" / "don't come to school tomorrow" → credible threat
- Hinglish and mixed language are normal: "ye bahut weird hai" is a complaint, not a threat
- A name is a TARGET, never an unknown word. Do not fail because a name is unfamiliar.
- A quoted sentence inside quotes is reported speech unless the writer also asserts it outside the quotes.
- Personal information: this platform is anonymous. Email addresses, phone
  numbers, street addresses are leaks — but so are combinations that identify
  someone without a single obvious token: a name plus school plus class
  ("Rahul Sharma, class 8B"), a name plus a find-me-here description ("I live
  on Park Street near the mosque, come find me"), a social handle inviting
  contact ("dm me on insta @rahul.12"). Spelled-out numbers ("nine eight one
  ...") are still a phone number. Flag these as privacy even when no single
  word looks suspicious. Vague civic speech ("MG Road has potholes") is not PII.
- School safety: sexual content involving minors, grooming patterns
  (an older person soliciting private contact with a student), blackmail or
  extortion ("pay or I share the photo"), and posting someone else's private
  information are high or critical — never mild.

Reply with ONLY a JSON object, no prose, no markdown:
{"severity":"none|mild|moderate|high|critical","categories":["..."],
 "target":"name or null","confidence":0.0,"explanation":"one short sentence"}

severity: none = harmless · mild = rude or venting · moderate = needs a look ·
high = harassment/bullying/threat · critical = danger to life or immediate safety.
Allowed category tokens: self-harm, threat, targeted-harassment, bullying,
reported-abuse, distress, anxiety, sadness, anger, profanity, slang, privacy,
positive, neutral.
Keep one short explanation sentence. Never invent facts not in the message.
Never quote personal details (names, addresses, numbers, handles) in the
explanation — describe the finding, e.g. "contains a phone number".`;

function refinePrompt(signals, deterministic) {
	return `Message: "${signals.text.slice(0, 600)}"

Deterministic pre-scan (evidence, NOT a verdict — override it if the context justifies):
- person target: ${signals.target ? `${signals.target.kind} (${signals.target.value})` : "none"}
- asserted or reported/quoted: ${signals.reported ? "reported/quoted" : "asserted"}
- threat terms: ${signals.threatHits.map((h) => h.term).join(", ") || "none"}
- hostile terms: ${signals.hostilityHits.map((h) => h.term).join(", ") || "none"}
- crisis terms: ${signals.crisisHits.map((h) => h.term).join(", ") || "none"}
- script/language: ${signals.language}
- provisional severity: ${deterministic.severity}

Classify the message.`;
}

/** Strict allowlist parse. Anything unrecognised is dropped, never passed on. */
export function parseModelDecision(rawText, fallback) {
	try {
		const match = String(rawText || "").match(/\{[\s\S]*\}/);
		if (!match) return null;
		const parsed = JSON.parse(match[0]);
		// `level` is accepted as an alias for `severity`: models routinely echo
		// the field name from an older prompt, and rejecting a correct answer
		// purely on the spelling of its key would be a self-inflicted outage.
		// Both spellings are still validated against the same fixed enum.
		const rawSeverity = parsed?.severity ?? parsed?.level;
		const severity = SEVERITIES.includes(rawSeverity) ? rawSeverity : null;
		if (!severity) return null;
		const categories = Array.isArray(parsed.categories)
			? parsed.categories.filter((c) => typeof c === "string").slice(0, 8)
			: [];
		const confidence =
			typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
				? parsed.confidence
				: fallback.confidence;
		return {
			severity,
			categories,
			confidence,
			// An unrecognised agent is discarded here rather than surfacing
			// later; the caller falls back to routing by severity.
			agent: VALID_AGENTS.includes(parsed.agent) ? parsed.agent : null,
			emotion: VALID_EMOTIONS.includes(parsed.emotion) ? parsed.emotion : null,
			target:
				typeof parsed.target === "string" && parsed.target.length <= 40
					? { kind: "name", value: parsed.target }
					: parsed.target === null
						? null
						: fallback.target,
			explanation:
				typeof parsed.explanation === "string"
					? parsed.explanation.slice(0, 240)
					: fallback.explanation,
		};
	} catch {
		return null;
	}
}

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
	]);
}

/**
 * Decides whether the model is needed at all. A confident deterministic
 * verdict — a crisis floor, a threat, or an explicit emotion-lexicon hit —
 * is already the answer, so paying a network round-trip for it only adds
 * latency and cost on the hot path.
 */
function needsModel(deterministic, signals) {
	if (deterministic.severity === "critical") return false;
	if (signals.hasThreat || signals.hasHostility) return false;
	if (deterministic.category !== "neutral") return false;
	return true;
}

/**
 * Full contextual analysis. Returns the structured decision shape the
 * platform uses everywhere: AI reasons, this function never mutates state.
 */
export async function analyzeContext(rawText, options = {}) {
	const {
		lexicon = {},
		useModel = true,
		taskKey = "inbox.emotion",
	} = options;

	const signals = extractSignals(rawText);
	const deterministic = composeDecision(signals, lexicon);

	let decision = deterministic;
	let modelUsed = false;

	if (useModel && needsModel(deterministic, signals)) {
		const lane = { used: null, startedAt: Date.now() };
		let result = null;
		try {
			result = await withTimeout(callNvidiaFast(SYSTEM_PROMPT, refinePrompt(signals, deterministic), 10000), 11000).catch(() => null);
			lane.used = "nvidia-fast";
			if (!result?.text) {
				result = await withTimeout(callLLMChain(SYSTEM_PROMPT, refinePrompt(signals, deterministic), [], "high"), 20000).catch(() => null);
				lane.used = "chain";
			}
			const parsed = result?.text ? parseModelDecision(result.text, deterministic) : null;
			if (parsed) {
				modelUsed = true;
				// The merge is bounded, not obedient: the model may refine
				// severity, but it can never drop below the deterministic
				// floor for a protective signal, and crisis can never be
				// talked down.
				const floor =
					deterministic.severity === "critical"
						? "critical"
						: signals.reported
							? "none"
							: deterministic.severity;
				decision = {
					...deterministic,
					severity: atLeast(parsed.severity, floor),
					categories: [...new Set([...deterministic.categories, ...parsed.categories])],
					confidence: parsed.confidence,
					// A valid model emotion is preferred — it is the nuanced read the
					// deterministic pass cannot make; otherwise the local one stands.
					emotion: parsed.emotion || deterministic.emotion,
					target: parsed.target ?? deterministic.target,
					explanation: parsed.explanation || deterministic.explanation,
					modelSeverity: parsed.severity,
					modelAgent: parsed.agent,
				};
			}
			recordAiCall(taskKey, {
				ok: !!parsed,
				latencyMs: Date.now() - lane.startedAt,
				lane: lane.used,
			});
		} catch {
			recordAiCall(taskKey, { ok: false, latencyMs: Date.now() - lane.startedAt, lane: lane.used || "none" });
			// Deterministic severity stands. Never crash, never claim success.
		}
	}

	return {
		classification: decision.category,
		confidence: decision.confidence,
		categories: decision.categories,
		severity: decision.severity,
		emotion: decision.emotion,
		target: decision.target,
		explanation_summary: decision.explanation,
		recommended_action: ACTION_BY_SEVERITY[decision.severity] || "allow",
		evidence: decision.evidence || [],
		policy_version: POLICY_VERSION,
		model_used: modelUsed,
		model_agent: decision.modelAgent || null,
		reported_or_quoted: signals.reported,
		language: signals.language,
	};
}

/**
 * The canonical {level, emotion, agent} triple every consumer already reads,
 * now backed by the contextual decision above. `agent` routes the thread:
 * genuinely emotional content goes to the emotional-support agent, everything
 * else stays with the general assistant.
 */
export async function classifyContextual(rawText, options = {}) {
	const decision = await analyzeContext(rawText, options);
	const level = decision.severity;
	return {
		level,
		emotion: VALID_EMOTIONS.includes(decision.emotion) ? decision.emotion : "neutral",
		// A model-proposed agent is honoured only through the same allowlist
		// path as everything else, and never below the severity floor.
		agent: resolveAgent(level, decision.model_agent),
		category: decision.classification,
		confidence: decision.confidence,
		decision,
	};
}

/** Allowlisted model agent, with critical always forced to the emotional agent. */
export function resolveAgent(level, modelAgent) {
	if (level === "critical") return "emotional";
	return VALID_AGENTS.includes(modelAgent) ? modelAgent : level === "none" || level === "mild" ? "general" : "emotional";
}
