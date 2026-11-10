/**
 * Contextual moderation — the semantic signal wired INTO the safety pipeline.
 *
 * WHY THIS FILE EXISTS
 * `evaluateContent` alone is keyword-based: it returns ALLOW for
 * "Rahul, I hate you.", "Rahul you're dead 💀" and "don't come to school
 * tomorrow". `_context-classify.js` ALREADY resolves the meaning and the
 * target correctly — it was simply never called from the moderation path
 * (only from the inbox for emotion routing). This file is the wiring.
 *
 * LATENCY
 * `classifyContextual` is called with `useModel: false`, so this is the
 * deterministic scan only: measured ~4ms, no network, no provider. The model
 * escalation path stays available for the places that can afford seconds.
 * Adding a 5s model call to every comment post would trade correctness for a
 * spinner, which fixes nothing.
 *
 * AUTHORITY
 * The contextual layer produces FLAGS ONLY. `POLICY` still decides the action,
 * and `evaluateContent` still owns the deterministic verdict. This layer can
 * only ever make a verdict STRICTER, never more permissive — see `mergeFlags`.
 */

import { classifyContextual } from "./_context-classify.js";

/**
 * Contextual classification → the flag vocabulary POLICY already understands.
 * No new policy rows, no AI-invented action: the AI names a category, the
 * deterministic policy table decides what happens.
 */
const CATEGORY_FLAGS = {
	"targeted-harassment": "bullying",
	harassment: "bullying",
	bullying: "bullying",
	"collective-abuse": "bullying",
	abuse: "bullying",
	threat: "threat",
	intimidation: "threat",
	"reported-abuse": "threat_report",
	violence: "violence",
	"physical-harm": "violence",
	"self-harm": "violence",
	crisis: "violence",
	"identity-attack": "hate_speech",
	hate: "hate_speech",
	"sexual-content": "explicit",
	sexual: "explicit",
	// Model-emitted vulgarity: the judge phrases what no list contains as
	// profanity/slang. Maps into the zero-tolerance family (never a new
	// row): high/critical blocks via school-zero-tolerance, mild/moderate
	// falls through to review-grade handling below — never silently dropped.
	profanity: "profanity",
	slang: "profanity",
	blackmail: "coercion",
	extortion: "coercion",
	coercion: "coercion",
	doxxing: "privacy",
	"personal-data": "privacy",
	privacy: "privacy",
};

/** Severities that justify a blocking-class flag rather than a review flag. */
const BLOCKING = new Set(["high", "critical"]);

/**
 * Review-grade flag types: queued surfaces QUARANTINE them (a human reads
 * the thread), direct surfaces BLOCK them. They are always severity "high",
 * never "critical" — the deterministic severity convention every one of
 * these rows already uses. `threat_report` is the only one whose user-facing
 * wording mentions an abuse report; `conduct_weak` is deliberately separate
 * so ordinary hostility is never described as "a report of abuse".
 */
const REVIEW_GRADE = new Set([
	"threat_report",
	"privacy_weak",
	"conduct_weak",
]);

/**
 * What the student reads when a model-emitted flag fires: the CRITERION,
 * in plain school language — what rule, and why this cannot be accepted.
 * Static strings only, keyed by the emitted flag TYPE (what POLICY
 * enforces — unchanged): model vocabulary ("neutral", "unsafe", category
 * tokens) must never reach the UI, both because it confuses ("neutral
 * (high)" on a blocked post) and because model text is untrusted input.
 * No new policy row is invented here; only the human sentence changes.
 */
const FLAG_CRITERIA = {
	explicit: "Sexual content is not allowed here.",
	bullying: "Targeting a student with harassment is not allowed here.",
	threat: "Threats are not allowed here.",
	threat_report:
		"This reads as a report of abuse — held for a human to review.",
	violence: "Violent content is not allowed here.",
	hate_speech: "Hate speech is not allowed here.",
	coercion: "Coercion or blackmail is not allowed here.",
	privacy: "Personal information must not be shared here.",
	privacy_weak:
		"Possible personal information — held for a human to review.",
	conduct_weak:
		"Possible hostile or aggressive wording — held for a human to review.",
	profanity: "Profanity is not allowed here.",
};

/**
 * Staff / teacher vocabulary. A complaint about a teacher ("Kakuli mam is a
 * horrible teacher") is educational feedback — it is NOT a report of criminal
 * abuse and must never be labelled one. That mislabel was the reported bug:
 * the guard used to read the MODEL's explanation text instead of the
 * submission, so whenever the model's prose omitted the word "teacher" the
 * message fell through to `threat_report` and was held as an abuse report.
 */
const STAFF_NOUN =
	/\b(?:teachers?|professors?|faculty|staff|principal|headmaster|headmistress|vice[\s-]?principal|sir|ma'?am|mam|madam|instructor|lecturer|coach|warden|counsell?or|class\s*teacher|class\s*incharge)\b/i;

/** Opinion adjectives that describe a person's conduct, not an act of harm. */
const OPINION_ADJ =
	/\b(?:horrible|terrible|awful|bad|worst|rude|mean|lazy|biased|unfair|useless|incompetent|boring|strict|arrogant|disrespectful|unprofessional|annoying|stupid|dumb|idiotic|pathetic|toxic|creepy|weird|partial|negligent|irresponsible|shouts?|shouting|screams?|screaming|yells?|yelling)\b/i;

/**
 * Verbs that turn a complaint into a REPORT of actual harm. When one is
 * present the message is no longer a mere opinion — "the teacher hits
 * students" must stay on the review path.
 */
export const HARM_VERB =
	/\b(?:hit|hits|hitting|slap|slaps|slapped|beat|beats|beating|kick|kicks|kicked|punch|punches|punched|pinch|pinches|pinched|touch(?:es|ed)?|grope[sd]?|groping|molest(?:s|ed)?|abuse[sd]?|abusing|assault(?:s|ed)?|rape[sd]?|raping|threat(?:ens|ened)?|harass(?:es|ed)?|bully(?:ing|ies|ied)?|blackmail(?:s|ed)?|force[sd]?|forcing|stalk(?:s|ed|ing)?|kill(?:s|ed)?|murder(?:s|ed)?|hurt(?:s|ing)?|harm(?:s|ed)?|choking|strangl(?:e|es|ed)|die|dies|died|dead|death)\b/i;

/** Explicit second-person menace — never a mere opinion, whatever else appears. */
const SECOND_PERSON_MENACE =
	/\b(?:dekh\s*l[uo]nga|chhod?unga\s*nahi|nahi\s*chhod?unga|watch\s+your\s+back|you\s+will\s+pay|you'?re\s+dead|you\s+are\s+dead|i\s+know\s+where\s+you\s+live|i(?:'ll|\s+will)\s+get\s+you|done\s+with\s+you)\b/i;

/**
 * True when the text is an opinion complaint about staff, not a report of
 * abuse. Requires all of: a staff noun, an opinion adjective, no harm verb,
 * and no explicit menace. Returning [] from `contextualFlags` for these is
 * SAFE — the contextual layer may only ADD flags, so the deterministic gate
 * (profanity, PII, direct abuse) still runs at full strength.
 */
export function isStaffComplaint(text) {
	const t = String(text || "");
	if (!t) return false;
	if (!STAFF_NOUN.test(t)) return false;
	if (!OPINION_ADJ.test(t)) return false;
	if (HARM_VERB.test(t)) return false;
	if (SECOND_PERSON_MENACE.test(t)) return false;
	return true;
}

/**
 * Map a contextual decision onto deterministic flags.
 *
 * @param {object|null} decision classifier output
 * @param {string} [text] the ORIGINAL submission — the staff-complaint guard
 *   must read what the student wrote, never the model's explanation prose.
 * Returns [] when the message is neutral — a null/clean context NEVER clears
 * an existing finding.
 */
export function contextualFlags(decision, text = "") {
	if (!decision || !decision.decision) return [];
	const inner = decision.decision;
	const severity = String(inner.severity || decision.level || "none");
	const category = String(inner.category || "");
	const reported = inner.reported_or_quoted === true;

	// 1. An opinion complaint about a teacher / staff member is educational
	//    feedback. It is not a report of abuse and must not be held as one.
	//    Checked FIRST because one "reported_or_quoted" prediction must not be
	//    allowed to relabel a complaint the text itself disproves.
	if (isStaffComplaint(text)) return [];

	// 2. A genuine report / quotation of abuse is held for a human and never
	//    auto-blocked, exactly like the deterministic threat-report path.
	if (reported || category === "reported-abuse") return ["threat_report"];

	let flag = CATEGORY_FLAGS[category];
	if (!flag) {
		// Category not in the map: fall back to the categories list the
		// classifier reports, then give up rather than guess.
		for (const c of inner.categories || []) {
			flag = CATEGORY_FLAGS[c];
			if (flag) break;
		}
	}
	if (!flag) return [];

	// Mild/moderate hostility is review-grade, not auto-blocking. Keeping this
	// distinction is what stops "I hate this exam" from being punished.
	if (!BLOCKING.has(severity)) {
		// A weak privacy signal routes to the weak-PII policy row (review on
		// queued surfaces, block on direct ones) — never to threat_report,
		// which would mislabel a leak as a threat.
		if (flag === "privacy") return ["privacy_weak"];
		// Any other review-grade hostile signal is held under `conduct_weak`.
		// It used to become `threat_report`, which told a student their mild
		// annoyance was "a report of abuse" — a contradiction they cannot act
		// on. The hold still happens; only the label is honest now.
		return ["conduct_weak"];
	}
	return [flag];
}

/**
 * Merge two flag sets, keeping the strictest per flag type. `rank` is the
 * POLICY severity of the existing flag; an unknown flag is treated as at
 * least review-grade so it can never be silently dropped.
 */
export function mergeFlags(baseFlags, extraFlags) {
	if (!extraFlags || !extraFlags.length) return baseFlags;
	const rank = { critical: 3, high: 2, medium: 1, low: 0 };
	const byType = new Map();
	for (const f of baseFlags || []) byType.set(f.type, f);
	for (const entry of extraFlags) {
		// Accept either a bare flag TYPE ("threat") or a full flag object
		// ({ type, severity, ... }). Normalising here is what keeps the POLICY
		// lookup downstream keyed on real strings.
		const type = typeof entry === "string" ? entry : entry && entry.type;
		if (!type) continue;
		const incoming =
			typeof entry === "string"
				? {
						type,
						severity: REVIEW_GRADE.has(type) ? "high" : "critical",
						message: "Contextual analysis: targeted or high-severity language",
						source: "context-classify",
					}
				: entry;
		const existing = byType.get(type);
		if (!existing) {
			byType.set(type, incoming);
		} else if ((rank[existing.severity] ?? 0) < (rank[incoming.severity] ?? 0)) {
			byType.set(type, incoming);
		}
	}
	return [...byType.values()];
}

/**
 * Model-backed moderation for a write: REAL understanding, not a bigger list.
 *
 * Calls `classifyContextual` with `useModel: true`, so an actual language
 * model judges meaning — including contextual PII no regex can see ("I live
 * on Park Street near the mosque, come find me", spelled-out phone numbers,
 * name+school+class combos). Only message TEXT is sent to the provider;
 * never an identity, thread id, or author id — there is nothing identifying
 * in the payload to leak.
 *
 * Bounds (all load-bearing, do not remove one without replacing it):
 * - `timeoutMs` (default 10s): the write path cannot wait out a provider
 *   stall. On timeout the deterministic verdict stands and `timedOut: true`
 *   is reported — never a fake "model cleared this".
 * - `timeoutMs` is a CONTRACT, not a hint: the internal provider budget and
 *   the outer race both use the caller's number verbatim. A caller with 900 ms
 *   of wall left gets a 900 ms call, never a re-inflated 1 s one.
 * - Below `MIN_MODEL_SLICE_MS` the call is skipped outright (`skipped:
 *   "budget"`) because it cannot produce an answer; the deterministic floor
 *   stands.
 * - Skip-short: trivially short text carries no model-detectable signal
 *   beyond what the deterministic pass already found.
 * - Cache: identical text re-checked within 5 minutes (double-submit,
 *   retry, preview-then-write) reuses the verdict instead of paying for
 *   and waiting on a second model call. Bounded at 200 entries.
 * - Failures (no key, cooldown, outage, unparsable output) resolve to
 *   "model added nothing", exactly like the deterministic-only path.
 *
 * @returns {Promise<{ flags: object[], context: object|null, model_used: boolean, timedOut: boolean }>}
 */
const deepCache = new Map();
const DEEP_CACHE_TTL_MS = 5 * 60 * 1000;
const DEEP_CACHE_MAX = 200;
// A model slice below this is a guaranteed miss: provider connect + first
// token already costs more, so spending the caller's last few hundred ms only
// holds a socket open and returns a timeout anyway. Callers that own a wall
// deadline (the write handlers) shrink this slice as they spend their budget;
// when it gets too small we degrade to the deterministic floor instead of
// silently re-inflating the slice back to a full second.
export const MIN_MODEL_SLICE_MS = 600;

export async function contextualModerationDeep(
	text,
	{ timeoutMs = 10000, taskKey = "moderation.deep", priority = "high" } = {},
) {
	const content = String(text || "").trim();
	if (content.length < 3) return { flags: [], context: null, model_used: false, timedOut: false };
	const cacheKey = content.slice(0, 2000);
	const hit = deepCache.get(cacheKey);
	if (hit && Date.now() - hit.at < DEEP_CACHE_TTL_MS) return hit.result;

	// Budget honesty: a caller that has already spent its wall must not be
	// handed a fresh model call. `timedOut: false` here is deliberate — no
	// timeout happened, the model simply was not affordable any more, so the
	// caller reports "model added nothing" rather than inventing a timeout.
	const askedMs = Number(timeoutMs);
	if (!Number.isFinite(askedMs) || askedMs < MIN_MODEL_SLICE_MS) {
		return {
			flags: [],
			context: null,
			model_used: false,
			timedOut: false,
			skipped: "budget",
		};
	}

	let result = null;
	let timedOut = false;
	try {
		// Never let the internal provider budget exceed the outer wall: a race
		// that abandons a still-running call wastes capacity and reports a
		// timeout the chain was never given a chance to respect. Both numbers
		// are the caller's, not a re-inflated floor — a request that has 900 ms
		// left must return in 900 ms, not in 1 s.
		const budgetMs = Math.min(askedMs, 5000);
		const raced = await Promise.race([
			classifyContextual(content, { useModel: true, taskKey, budgetMs, priority }).then(
				(r) => ({ r, timedOut: false }),
			),
			new Promise((resolve) =>
				setTimeout(() => resolve({ r: null, timedOut: true }), askedMs),
			),
		]);
		result = raced.r;
		timedOut = raced.timedOut;
	} catch {
		result = null;
	}
	// classifyContextual swallows provider failures internally and reports
	// model_used honestly — trust its flag, never infer success from shape.
	const modelUsed = timedOut ? false : result?.decision?.model_used === true;
	const types = modelUsed ? contextualFlags(result, content) : [];
	const flags = types.map((type) => ({
		type,
		// Review-grade rows keep the deterministic severity convention
		// (high, never critical): on queued surfaces they quarantine rather
		// than block, exactly like their deterministic counterparts.
		severity: REVIEW_GRADE.has(type) ? "high" : String(result?.level || "high"),
		message: FLAG_CRITERIA[type] || "This content breaks the safety policy.",
		source: "context-model",
	}));
	const out = { flags, context: result, model_used: modelUsed, timedOut };
	// Never cache a verdict the model did not actually render (timeout,
	// outage, unparsable output, trivial skip): caching it would whitelist
	// the text for 5 minutes without any judgment. Honest verdicts
	// (model_used) cache exactly as before.
	if (modelUsed) {
		deepCache.set(cacheKey, { at: Date.now(), result: out });
		if (deepCache.size > DEEP_CACHE_MAX) {
			deepCache.delete(deepCache.keys().next().value);
		}
	}
	return out;
}

/** Test seam: clear the deep-check cache between cases. */
export function clearDeepCache() {
	deepCache.clear();
}

/**
 * Contextual moderation for a write. Deterministic-only (no model call), so it
 * is safe to `await` on a request path.
 *
 * @param {string} text
 * @returns {Promise<{ flags: object[], context: object|null }>}
 *   `flags` are ADDITIONAL deterministic flags. `context` is the raw decision
 *   for audit/evidence. Never null-destructured by callers.
 */
export async function contextualModeration(text) {
	const content = String(text || "").trim();
	if (!content) return { flags: [], context: null };
	let result = null;
	try {
		result = await classifyContextual(content, {
			useModel: false,
			taskKey: "moderation.write",
		});
	} catch {
		// A contextual failure must NEVER be read as "clean", and must never
		// break the write path. Returning no extra flags leaves the
		// deterministic gates exactly as authoritative as they were.
		return { flags: [], context: null };
	}
	const types = contextualFlags(result, content);
	const flags = types.map((type) => ({
		type,
		severity: REVIEW_GRADE.has(type) ? "high" : "critical",
		message: REVIEW_GRADE.has(type)
			? FLAG_CRITERIA[type] || "Held for a human to review."
			: `Contextual analysis: ${result?.category || "unsafe"} (${result?.level || "unknown"})`,
		source: "context-classify",
	}));
	return { flags, context: result };
}
