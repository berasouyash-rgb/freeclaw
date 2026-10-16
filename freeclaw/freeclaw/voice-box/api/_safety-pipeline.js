// ═══════════════════════════════════════════════════════════════════
// SAFETY PIPELINE — one enforcement path for every content surface
// ═══════════════════════════════════════════════════════════════════
// Replaces scattered inline gate logic with an explicit pipeline:
//
//   NORMALIZE → LANGUAGE → CLASSIFY → CONTEXT → POLICY → ACTION
//
// The POLICY table below is the whole enforcement contract in one place:
// each classification maps to an action, a user-facing message, and a
// machine code. Owner policy is explicit here — including the school
// zero-tolerance rule (profanity/slang → BLOCK_ACTION, no stars) —
// instead of buried across regex blocks. Change the table, change the
// platform; every decision cites the row that fired.
//
// Detection itself stays in api/_moderation.js (serverModerate); this
// module interprets verdicts into surface-appropriate actions. Surfaces
// with a human review queue (posts) QUARANTINE review-grade flags;
// surfaces without one (comments, polls) BLOCK them outright.
// ═══════════════════════════════════════════════════════════════════

import { detectLanguage } from "./_translate.js";
import { serverModerate } from "./_moderation.js";
import { contextualModeration, contextualModerationDeep, mergeFlags } from "./_context-moderation.js";

// ─── Enforcement policy table ─────────────────────────────────────
// Order matters: first matching row wins. Each row names the flag types it
// covers, the action per surface kind, and the exact user message/code the
// route must return verbatim (client gates mirror these strings).
const POLICY = [
	{
		id: "pii-leak",
		flagTypes: ["privacy"],
		action: { queued: "BLOCK_ACTION", direct: "BLOCK_ACTION" },
		message:
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
		postMessage:
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove all personal details and try again.",
		code: "PII_BLOCKED",
	},
	{
		id: "school-zero-tolerance",
		flagTypes: ["profanity"],
		action: { queued: "BLOCK_ACTION", direct: "BLOCK_ACTION" },
		message: "This comment violates our safety guidelines and cannot be posted.",
		postMessage:
			"This content violates our safety guidelines and cannot be published. If you are in crisis, please contact a counselor or call a crisis hotline.",
		code: "CONTENT_BLOCKED",
	},
	{
		id: "critical-harm",
		flagTypes: ["violence", "hate_speech", "bullying", "explicit", "coercion"],
		action: { queued: "BLOCK_ACTION", direct: "BLOCK_ACTION" },
		message: "This comment violates our safety guidelines and cannot be posted.",
		postMessage:
			"This content violates our safety guidelines and cannot be published. If you are in crisis, please contact a counselor or call a crisis hotline.",
		code: "CONTENT_BLOCKED",
	},
	{
		id: "threat-review",
		flagTypes: ["threat", "threat_report"],
		action: { queued: "QUARANTINE", direct: "BLOCK_ACTION" },
		message: "This content may contain a threat, so a moderator must review it first.",
		postMessage: null, // queued surface holds for human review instead
		code: "CONTENT_BLOCKED",
	},
	// NOTE — deliberate non-rows (route parity, not oversight): `coercion_report` (victim reports
	// must stay publishable), `coercion_weak` (ambiguous photo threats), and
	// `spam` fall through to ALLOW here because the routes publish them
	// today. Escalating any of these to BLOCK is a one-row policy change
	// with full test visibility — never a silent regex edit.
	{
		id: "accused-person-review",
		flagTypes: ["accusation_weak"],
		action: { queued: "QUARANTINE", direct: "BLOCK_ACTION" },
		message: "This names another person in an accusation, so a moderator must review it first.",
		postMessage: null, // queued surface holds for human review instead
		code: "CONTENT_BLOCKED",
	},
	{
		id: "weak-signal-review",
		flagTypes: ["privacy_weak", "explicit_weak"],
		action: { queued: "QUARANTINE", direct: "BLOCK_ACTION" },
		message: "This comment violates our safety guidelines and cannot be posted.",
		postMessage: null, // queued surface holds for human review instead
		code: "CONTENT_BLOCKED",
	},
	// Appended LAST on purpose: `romantic_weak` is a brand-new flag type, so
	// first-match precedence for every existing row is unchanged. Posts
	// (queued) QUARANTINE to pending_review; comments/polls (direct) BLOCK —
	// _comments.js gates on `decision.blocked` alone, so the direct action is
	// what actually stops a romance comment from publishing. Never critical:
	// a hold, not a 403, so a student reporting harassment ("my boyfriend is
	// threatening me") still reaches a human moderator.
	{
		id: "romance-review",
		flagTypes: ["romantic_weak"],
		action: { queued: "QUARANTINE", direct: "BLOCK_ACTION" },
		message: "This comment violates our safety guidelines and cannot be posted.",
		postMessage: null, // queued surface holds for human review instead
		code: "CONTENT_BLOCKED",
	},
];

/**
 * Evaluate text through the full pipeline. Pure (no DB): safe to call from
 * any route, worker, or test.
 *
 * @param {string} text raw, unmasked input
 * @param {"queued"|"direct"} surfaceKind posts="queued" (human review exists); comments/polls="direct"
 * @param {object|null} learned optional learned weak-signal stats (posts consult
 *   the admin-approved-pattern store so repeat-approved patterns stop holding)
 * @returns {{action, classification, confidence, policy, reasons[], trace[], flags, language, blocked, needsReview, message, code}}
 */
export function evaluateContent(text, surfaceKind = "direct", learned = null) {
	const trace = [];
	const normalized = String(text || "")
		.normalize("NFKC")
		.trim();
	trace.push(`normalize: ${normalized.length} chars`);
	const lang = detectLanguage(normalized);
	trace.push(`language: ${lang.ok ? lang.language : "und"}${lang.script ? ` (${lang.script})` : ""}`);
	// Same detection function and same concatenated input shape the routes
	// use inline (serverModerate joins title+description itself). The one
	// deliberate delta: NFKC normalization runs first, so full-width/lookalike
	// evasion (ｓｈｉｔ) is judged as its ASCII self — strictly harder to evade
	// than the raw inline call, in the direction of the zero-tolerance rule.
	const mod = serverModerate("", normalized, learned);
	const types = mod.flags.map((f) => f.type);
	trace.push(`classify: [${types.join(", ") || "clean"}]`);
	const row =
		POLICY.find((p) => p.flagTypes.some((t) => types.includes(t))) || null;
	if (!row) {
		return {
			action: "ALLOW",
			classification: "clean",
			confidence: "high",
			policy: null,
			reasons: [],
			trace,
			flags: mod.flags,
			language: lang.ok ? lang.language : "und",
			blocked: false,
			needsReview: mod.requiresReview,
		};
	}
	const action = surfaceKind === "queued" ? row.action.queued : row.action.direct;
	trace.push(`policy:${row.id} → ${action}`);
	return {
		action,
		classification: row.flagTypes.find((t) => types.includes(t)),
		confidence: "high",
		policy: row.id,
		reasons: mod.flags
			.filter((f) => row.flagTypes.includes(f.type))
			.map((f) => f.message),
		trace,
		flags: mod.flags,
		language: lang.ok ? lang.language : "und",
		blocked: action === "BLOCK_ACTION",
		needsReview: mod.requiresReview,
		message:
			surfaceKind === "queued" && row.postMessage ? row.postMessage : row.message,
		code: row.code,
	};
}

/**
 * Full safety evaluation WITH the contextual semantic layer.
 *
 * `evaluateContent` above is intentionally synchronous and keyword-based: it is
 * fast, free, and the hard floor. It cannot tell "I hate this exam" from
 * "Rahul, I hate you" — no keyword list can.
 *
 * This async wrapper adds the deterministic contextual scan
 * (`_context-classify.js`, `useModel:false`, measured ~4ms, no network) as an
 * ADDITIONAL signal, then re-applies the SAME POLICY table. It can only make
 * the verdict stricter, never more permissive: `mergeFlags` keeps the max
 * severity per flag type and never drops one.
 *
 * A contextual failure (provider down, parser error) returns the plain
 * deterministic verdict — the floor stays exactly as authoritative as before.
 */
export async function evaluateContentAsync(text, surfaceKind = "direct", learned = null) {
	const base = evaluateContent(text, surfaceKind, learned);
	let extra;
	try {
		extra = await contextualModeration(text);
	} catch {
		return base;
	}
	if (!extra || !extra.flags || !extra.flags.length) return base;

	const merged = mergeFlags(base.flags || [], extra.flags);
	const types = merged.map((f) => f.type);
	const row = POLICY.find((p) => p.flagTypes.some((t) => types.includes(t))) || null;
	if (!row) return base;

	const trace = [...(base.trace || []), `context:${extra.context?.category || "?"}`];
	const action = surfaceKind === "queued" ? row.action.queued : row.action.direct;
	return {
		...base,
		action,
		classification: row.flagTypes.find((t) => types.includes(t)),
		policy: row.id,
		reasons: merged
			.filter((f) => row.flagTypes.includes(f.type))
			.map((f) => f.message),
		trace,
		flags: merged,
		blocked: action === "BLOCK_ACTION" || merged.some((f) => f.severity === "critical"),
		needsReview: true,
		message:
			surfaceKind === "queued" && row.postMessage ? row.postMessage : row.message,
		code: row.code,
	};
}

/**
 * Full safety evaluation WITH a real language model judging meaning.
 *
 * Layers, in order — each can only ADD flags, never remove:
 *   1. `evaluateContent` — synchronous keyword/PII gates (the hard floor).
 *   2. `contextualModeration` — deterministic contextual scan (~ms).
 *   3. `contextualModerationDeep` — an actual model reads the WHOLE message
 *      and judges meaning: targeted harassment with no listed word, threats
 *      phrased politely, and contextual PII no regex can see (addresses
 *      without numbers, spelled-out phone digits, name+school+class combos,
 *      social handles inviting contact).
 *
 * Cost/latency honesty (not a spinner — a bounded wait with a floor):
 * - If layers 1+2 already block, the model is SKIPPED: the verdict cannot
 *   get stricter than BLOCK, so a model call would burn money and seconds
 *   for zero decision value. `model_used: false`, `model_skipped` says why.
 * - Otherwise the model runs under `timeoutMs` (default 10s). On timeout,
 *   outage, missing keys, or unparsable output, the deterministic verdict
 *   stands and `model_used: false` is reported — never a fake "AI cleared".
 * - Only message TEXT reaches the provider. No identity, thread id, or
 *   author id is ever in the payload — there is nothing to leak.
 */
export async function evaluateContentDeep(
	text,
	surfaceKind = "direct",
	learned = null,
	{ timeoutMs = 10000, taskKey = "moderation.deep" } = {},
) {
	const base = await evaluateContentAsync(text, surfaceKind, learned);
	if (base.blocked) {
		return { ...base, model_used: false, model_skipped: "already-blocked", timedOut: false };
	}
	let deep;
	try {
		deep = await contextualModerationDeep(text, { timeoutMs, taskKey });
	} catch {
		return { ...base, model_used: false, timedOut: false };
	}
	if (!deep || !deep.flags || !deep.flags.length) {
		return {
			...base,
			// The model may have run and honestly found nothing — that is NOT the
			// same as "the model was unavailable". Report what actually happened
			// (`contextualModerationDeep` distinguishes them); collapsing both to
			// false made a real, paid judgment look like a provider outage.
			model_used: deep?.model_used === true,
			timedOut: deep?.timedOut === true,
			// The model's emotional read travels with the verdict even when
			// there is no policy flag: a plea for help ("Rahul help me")
			// carries no flaggable content, but the write path and the
			// preview need the read to route it to private+support instead
			// of public. Present ONLY when the model actually ran — never
			// infer one from a skip, a timeout, or an outage.
			emotion: deep?.model_used === true ? (deep?.context?.emotion ?? null) : null,
			level: deep?.model_used === true ? (deep?.context?.level ?? null) : null,
			trace: [...(base.trace || []), `model:${deep?.timedOut ? "timeout" : "no-signal"}`],
		};
	}
	const merged = mergeFlags(base.flags || [], deep.flags);
	const types = merged.map((f) => f.type);
	const row = POLICY.find((p) => p.flagTypes.some((t) => types.includes(t))) || null;
	if (!row) return { ...base, model_used: true, timedOut: false, emotion: deep?.context?.emotion ?? null, level: deep?.context?.level ?? null };
	const action = surfaceKind === "queued" ? row.action.queued : row.action.direct;
	return {
		...base,
		action,
		classification: row.flagTypes.find((t) => types.includes(t)),
		policy: row.id,
		reasons: merged
			.filter((f) => row.flagTypes.includes(f.type))
			.map((f) => f.message),
		trace: [...(base.trace || []), `model:${deep.context?.category || "?"} (${deep.context?.level || "?"})`],
		flags: merged,
		blocked: action === "BLOCK_ACTION" || merged.some((f) => f.severity === "critical"),
		needsReview: true,
		message:
			surfaceKind === "queued" && row.postMessage ? row.postMessage : row.message,
		code: row.code,
		model_used: true,
		timedOut: false,
		// Same support-signal contract as the no-flag path above: the
		// emotion and level travel whenever the model actually judged the text.
		emotion: deep?.context?.emotion ?? null,
		level: deep?.context?.level ?? null,
	};
}

export function getPolicyTable() {	return POLICY.map((p) => ({
		id: p.id,
		flagTypes: [...p.flagTypes],
		action: { ...p.action },
		code: p.code,
	}));
}

/**
 * What counts as a genuine cry for help — a model judgment, never a list.
 * `needsSupport` is the SINGLE rule both the preview (auto-private) and
 * the write path (force private+review) obey, so they can never disagree
 * about the same text. A plea routes to support only when ALL hold:
 * - the model actually judged the text (model_used),
 * - it read distress (critical_distress/anxious/sad) at moderate or worse
 *   (mild exam nerves stay a normal post — forcing those private would
 *   punish ordinary venting),
 * - no attack flag fired (threats stay on the block path, never the
 *   support path — "I will kill" is stopped, not sheltered).
 */
const SUPPORT_EMOTIONS = new Set(["critical_distress", "anxious", "sad"]);
const SUPPORT_LEVELS = new Set(["moderate", "high", "critical"]);
const ATTACK_TYPES = new Set([
	"threat",
	"violence",
	"hate_speech",
	"coercion",
	"explicit",
	"bullying",
	"profanity",
]);

export function needsSupport(decision) {
	if (!decision || decision.model_used !== true) return false;
	if (!SUPPORT_EMOTIONS.has(decision.emotion)) return false;
	if (!SUPPORT_LEVELS.has(decision.level)) return false;
	if (
		(decision.flags || []).some((f) => f && ATTACK_TYPES.has(f.type))
	)
		return false;
	return true;
}

// ─── Surface copy table ─────────────────────────────────────────
// The POLICY table decides the code; this table renders it. Every
// user-facing safety string on every write surface lives here — byte for
// byte what the routes returned inline — so rewiring a route to the
// pipeline cannot silently change copy (client gates mirror these).
const SURFACE_MESSAGES = {
	comment: {
		PII_BLOCKED:
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
		CONTENT_BLOCKED: "This comment violates our safety guidelines and cannot be posted.",
	},
	edit: {
		PII_BLOCKED:
			"Personal information detected in your edit (address, phone, or email). This is an anonymous platform — please remove personal details.",
		CONTENT_BLOCKED: "This edit violates our safety guidelines and cannot be saved.",
	},
	editPost: {
		PII_BLOCKED:
			"Personal information detected in your edit (address, phone, or email). This is an anonymous platform — please remove all personal details and try again.",
		CONTENT_BLOCKED: "Your edit violates our safety guidelines and cannot be saved.",
	},
	post: {
		PII_BLOCKED:
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove all personal details and try again.",
		CONTENT_BLOCKED:
			"This content violates our safety guidelines and cannot be published. If you are in crisis, please contact a counselor or call a crisis hotline.",
	},
	poll: {
		PII_BLOCKED:
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
		CONTENT_BLOCKED: "This poll violates our safety guidelines and cannot be published.",
	},
};

/** User-facing message for a surface + decision code. Pure. */
export function messageFor(surface, code) {
	const table = SURFACE_MESSAGES[surface] || SURFACE_MESSAGES.comment;
	return table[code] || table.CONTENT_BLOCKED;
}

export default { evaluateContent, evaluateContentDeep, getPolicyTable, messageFor };
