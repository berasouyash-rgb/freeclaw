// ═══════════════════════════════════════════════════════════════════
// MODERATION PREVIEW — the authoritative pre-publish check
// ═══════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
// The Submit page used to run a CLIENT-SIDE word-list scan and, on an
// empty flag list, print "Content looks good — no issues detected".
// That claim was false. Given:
//
//   * dhansiri i will hate you
//   * 25/120
//
// the word list contains no profanity and no slang, so the client
// reported zero flags and the UI congratulated the student on
// publishing a targeted threat.
//
// A name is not a word-list entry, so the only thing that can
// distinguish "I hate this exam" from "Dhansiri, I will hate you" is
// a CONTEXTUAL engine. `api/_context-classify.js` already does that
// (it resolves the target by name, without a dictionary of names).
// This endpoint is the wiring that puts it in front of the author.
//
// WHAT IT IS NOT
// This is NOT the authority for whether content may be published.
// `_posts.js` / `_polls.js` / `_comments.js` re-run the same pipeline
// on write and their verdict is the one that counts. This exists so
// the UI can stop lying to a real user before they hit submit.
//
// LATENCY
// `evaluateContentAsync` runs the DETERMINISTIC contextual scan with
// `useModel: false` — measured ~0-14ms, no network, no provider. A
// model call here would put a multi-second spinner in front of every
// keystroke, which is the "hide it behind a spinner" antipattern.
// ═══════════════════════════════════════════════════════════════════

import { cors, rateLimited, rateLimitResponse } from "./_auth.js";
import { evaluateContentAsync } from "./_safety-pipeline.js";

/** Server flag type -> the client-facing category vocabulary. */
const CATEGORY = {
	violence: "violence",
	hate_speech: "hate",
	bullying: "bullying",
	harassment: "bullying",
	explicit: "sexual",
	sexual: "sexual",
	coercion: "coercion",
	blackmail: "coercion",
	threat: "threat",
	threat_report: "threat",
	privacy: "privacy",
	privacy_weak: "privacy",
	profanity: "profanity",
	self_harm: "violence",
	crisis: "violence",
};

/** The client's Severity union. Anything unknown degrades to "medium". */
const SEVERITIES = ["none", "low", "medium", "high", "critical"];

function toSeverity(value) {
	const v = String(value || "").toLowerCase();
	return SEVERITIES.includes(v) ? v : "medium";
}

/** Worst severity across a flag list. */
function worstSeverity(flags) {
	const rank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
	return flags.reduce(
		(worst, f) => (rank[f.severity] > rank[worst] ? f.severity : worst),
		"none",
	);
}

/** Flags are a 0-100 score for the client's severity meter. */
function scoreOf(flags) {
	if (!flags.length) return 0;
	const worst = worstSeverity(flags);
	return { none: 0, low: 20, medium: 45, high: 75, critical: 100 }[worst];
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		// Bounded: this runs on every debounce while typing.
		const text = String(req.body?.text || "").slice(0, 8000);
		if (text.trim().length < 3) {
			return res.status(200).json({
				safe: true,
				overallSeverity: "none",
				flags: [],
				maskedText: text,
				score: 0,
				serverBlocked: false,
				action: "ALLOW_ACTION",
				policy: null,
				context: null,
				checked: true,
			});
		}

		// Rate limit: max 120 checks per IP per minute. Typing fires one
		// request per debounce; a paste-and-hold would otherwise be a cheap
		// amplification of the moderation work.
		if (
			await rateLimited(
				"moderation_preview",
				req.headers["x-forwarded-for"] || "anon",
				60,
				120,
			)
		) {
			return rateLimitResponse(
				res,
				"Too many checks. Wait a moment.",
			);
		}

		// The surface MUST match the write path that will publish this text:
		// posts go through the "queued" surface (human review queue exists),
		// polls and comments through "direct" (no queue — review-grade flags
		// block outright). Evaluating a poll as "queued" told the author it
		// was publishable while the server 403'd it. Unknown values fall back
		// to "queued", never to an invented third surface.
		const surface = req.body?.surface === "direct" ? "direct" : "queued";
		const decision = await evaluateContentAsync(text, surface);

		const flags = (decision.flags || [])
			.map((f) => ({
				category: CATEGORY[f.type] || f.type,
				severity: toSeverity(f.severity),
				message: f.message || f.type,
				// The contextual layer reports evidence, not a single matched
				// token. Never invent a "matched word" — a false quote is worse
				// than no quote, because a student will argue with it.
				matched: f.source === "context-classify" ? "" : (f.matched || ""),
				source: f.source || "deterministic",
			}))
			.filter((f) => f.category && f.message);

		const overallSeverity = worstSeverity(flags);
		const serverBlocked = decision.blocked === true;

		return res.status(200).json({
			safe: flags.length === 0,
			overallSeverity,
			flags,
			maskedText: text,
			score: scoreOf(flags),
			// Authoritative "the server will reject this" signal, so the
			// client gate does not have to re-derive policy from categories.
			serverBlocked,
			// Echo the surface so the client (and tests) can prove the
			// verdict was computed for the right write path.
			surface,
			action: decision.action,
			policy: decision.policy || null,
			classification: decision.classification || null,
			// The contextual reasoning, for the "why" an author is shown.
			context: decision.trace?.length
				? { trace: decision.trace }
				: null,
			checked: true,
		});
	} catch (error) {
		// A broken moderation check must NOT be reported to the user as
		// "no issues detected". Say the check failed.
		return res.status(200).json({
			safe: false,
			overallSeverity: "none",
			flags: [],
			maskedText: "",
			score: 0,
			serverBlocked: false,
			action: "UNKNOWN",
			policy: null,
			context: null,
			checked: false,
			// A static, non-leaking message. `sanitizeError` SENDS a response of
			// its own (and is keyed on `res`), so calling it inside this 200 body
			// both leaked `err.message` and threw `res.status is not a function`
			// on a raw Error — turning a caught failure into an unhandled one.
			error: "Moderation check failed",
		});
	}
}
