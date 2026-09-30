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
 * Map a contextual decision onto deterministic flags.
 * Returns [] when the message is neutral — a null/clean context NEVER clears
 * an existing finding.
 */
export function contextualFlags(decision) {
	if (!decision || !decision.decision) return [];
	const inner = decision.decision;
	const severity = String(inner.severity || decision.level || "none");
	const category = String(inner.category || "");
	const reported = inner.reported_or_quoted === true;

	// A report of abuse is held for a human and never auto-blocked, exactly
	// like the deterministic threat-report path.
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
	if (!BLOCKING.has(severity) && flag !== "threat_report") {
		// A weak privacy signal routes to the weak-PII policy row (review on
		// queued surfaces, block on direct ones) — never to threat_report,
		// which would mislabel a leak as a threat.
		if (flag === "privacy") return ["privacy_weak"];
		// Every other review-grade hostile signal is surfaced as a report for a
		// human to look at — never auto-blocked. (This used to be written as a
		// ternary whose two arms were identical; behaviour is unchanged.)
		return ["threat_report"];
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
						severity:
							type === "threat_report" || type === "privacy_weak" ? "high" : "critical",
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

export async function contextualModerationDeep(
	text,
	{ timeoutMs = 10000, taskKey = "moderation.deep" } = {},
) {
	const content = String(text || "").trim();
	if (content.length < 3) return { flags: [], context: null, model_used: false, timedOut: false };
	const cacheKey = content.slice(0, 2000);
	const hit = deepCache.get(cacheKey);
	if (hit && Date.now() - hit.at < DEEP_CACHE_TTL_MS) return hit.result;

	let result = null;
	let timedOut = false;
	try {
		const raced = await Promise.race([
			classifyContextual(content, { useModel: true, taskKey }).then(
				(r) => ({ r, timedOut: false }),
			),
			new Promise((resolve) =>
				setTimeout(() => resolve({ r: null, timedOut: true }), Math.max(1000, timeoutMs)),
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
	const types = modelUsed ? contextualFlags(result) : [];
	const flags = types.map((type) => ({
		type,
		// Review-grade rows keep the deterministic severity convention
		// (high, never critical): on queued surfaces they quarantine rather
		// than block, exactly like their deterministic counterparts.
		severity: type === "threat_report" || type === "privacy_weak" ? "high" : String(result?.level || "high"),
		message: `AI review: ${result?.category || "unsafe"} (${result?.level || "unknown"})`,
		source: "context-model",
	}));
	const out = { flags, context: result, model_used: modelUsed, timedOut };
	deepCache.set(cacheKey, { at: Date.now(), result: out });
	if (deepCache.size > DEEP_CACHE_MAX) {
		deepCache.delete(deepCache.keys().next().value);
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
	const types = contextualFlags(result);
	const flags = types.map((type) => ({
		type,
		severity: type === "threat_report" || type === "privacy_weak" ? "high" : "critical",
		message: `Contextual analysis: ${result?.category || "unsafe"} (${result?.level || "unknown"})`,
		source: "context-classify",
	}));
	return { flags, context: result };
}
