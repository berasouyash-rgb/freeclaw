// ═══════════════════════════════════════════════════════════════════
// LEXICON MATCHER — spelling-proof, boundary-safe term detection
// ═══════════════════════════════════════════════════════════════════
// The vocabulary lives in api/_wordlists.js. This module owns the
// MECHANICAL evasion layer that a flat word list cannot express:
//
//   "sh1t"       → de-leet            → shit
//   "fuuuck"     → repeat collapse    → fuck
//   "s.h.i.t"    → interior separators→ shit
//   "f*ck"       → interior symbols   → fck   (a listed variant)
//   "s h i t"    → single-letter join → shit
//   "sh<ZWSP>it" → invisible strip    → shit
//   "ｓｕｃｋｓ"     → NFKC               → sucks
//
// TWO RULES THAT KEEP THIS FROM OVER-BLOCKING (the Scunthorpe class):
//   1. Matching is TOKEN EQUALITY after folding — never substring search.
//      `\bass\b` never fires inside "class", "grass", or "assess", because
//      the whole token "class" simply is not a term in the set.
//   2. Every fold is *candidate generation checked against the set*, not a
//      rewrite of the text. A fold that produces a non-term changes nothing.
//
// Pure and dependency-light (imports only the vocabulary) so it is safe to
// call synchronously on every write, and mirrorable in the client.
// ═══════════════════════════════════════════════════════════════════

import { LEXICON, PHRASE_TERMS, SINGLE_TOKEN_TERMS } from "./_wordlists.js";

/** Digit/symbol → letter substitutions people actually type. */
const LEET_MAP = {
	0: "o",
	1: "i",
	3: "e",
	4: "a",
	5: "s",
	7: "t",
	8: "b",
	$: "s",
	"@": "a",
	"!": "i",
	"+": "t",
};

const LEET_RE = /[0134578$@!+]/g;
/** Zero-width joiners/spaces, BOM, soft hyphen, word joiner. */
const INVISIBLE_RE = /[\u200b-\u200d\ufeff\u00ad\u2060]/g;
/** Separators that can sit between the letters of one obfuscated word. */
const SEP_RE = /[\s.\-_*·•]+/g;
/**
 * A "token": alphanumerics joined by interior separators, so "s.h.i.t" and
 * "f*ck" arrive as ONE token and can be folded whole. Never matches across a
 * space — that case is handled by `joinSeparatedLetters`.
 */
const TOKEN_RE = /[a-z0-9$@!+]+(?:[._*\-][a-z0-9$@!+]+)*/g;

/**
 * Collapse a run of 3+ repeated characters down to `to` of them.
 * Runs of exactly 2 are left alone on purpose — "class", "assess" and
 * "passing" must not degrade into a term.
 */
export function collapseRepeats(value, to = 1) {
	return String(value).replace(/(.)\1{2,}/g, (_m, ch) => ch.repeat(to));
}

/** Lowercased, visible-only, NFKC-normalized copy used for matching. */
export function normalizeForMatch(value) {
	return String(value == null ? "" : value)
		.normalize("NFKC")
		.replace(INVISIBLE_RE, "")
		.toLowerCase();
}

/** Apply the digit/symbol → letter map. */
export function foldLeet(value) {
	return String(value).replace(LEET_RE, (c) => LEET_MAP[c] || c);
}

/**
 * Join runs of single letters separated by separators or spaces:
 * "s h i t" → "shit", "s.h.i.t" → "shit", "f u c k" → "fuck".
 * Requires 3+ units, so ordinary abbreviations ("e.g.", "u.s.a", "a.m.")
 * are left untouched — and even when they are joined, the joined string is
 * only ever *checked against the set*, never trusted on its own.
 */
export function joinSeparatedLetters(value) {
	return String(value).replace(
		/\b(?:[a-z0-9][\s.\-_*·•]{1,2}){2,}[a-z0-9]\b/g,
		(m) => m.replace(SEP_RE, ""),
	);
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** canonical/variant → the entry it belongs to. */
const CANONICAL_OF = new Map();
const META_OF = new Map();
for (const entry of LEXICON) {
	const canonical = entry.term.toLowerCase();
	const meta = { category: entry.category, severity: entry.severity || "high" };
	CANONICAL_OF.set(canonical, canonical);
	META_OF.set(canonical, meta);
	for (const v of entry.variants || []) {
		const variant = String(v).toLowerCase();
		CANONICAL_OF.set(variant, canonical);
		META_OF.set(variant, meta);
	}
}

/** Pre-compiled, `\b`-anchored phrase patterns (multi-word entries). */
const PHRASE_RES = PHRASE_TERMS.map((t) => ({
	term: t,
	re: new RegExp(`\\b${escapeRe(t)}\\b`, "g"),
}));

/**
 * Every folded form of one token that could be a listed term.
 * Bounded (≤ ~12 strings) so the hot path stays cheap.
 */
function tokenForms(token) {
	const forms = new Set();
	const add = (v) => {
		if (v) forms.add(v);
	};
	const noSymbols = token.replace(/[^a-z0-9]/g, "");
	for (const base of [token, noSymbols]) {
		add(base);
		const folded = foldLeet(base);
		add(folded);
		const c1 = collapseRepeats(base, 1);
		add(c1);
		add(foldLeet(c1));
		const c2 = collapseRepeats(base, 2);
		add(c2);
		add(foldLeet(c2));
	}
	return forms;
}

/**
 * Every blocked term in `text`, with its position and the surface form that
 * matched, for evidence and masking. Pure — no state, no I/O.
 *
 * @returns {{ term: string, category: string, severity: string, matched: string, index: number }[]}
 */
export function findTerms(rawText) {
	const hits = [];
	if (rawText == null) return hits;
	const seen = new Set();
	const push = (resolved, surface, index) => {
		const canonical = CANONICAL_OF.get(resolved) || resolved;
		if (!META_OF.has(canonical)) return;
		const key = `${canonical}@${index}`;
		if (seen.has(key)) return;
		seen.add(key);
		const meta = META_OF.get(canonical);
		hits.push({
			term: canonical,
			category: meta.category,
			severity: meta.severity,
			matched: surface,
			index,
		});
	};

	const normalized = normalizeForMatch(rawText);
	if (!normalized) return hits;
	const joined = joinSeparatedLetters(normalized);
	// The joined pass catches "s h i t"; the plain pass keeps exact indices
	// for ordinary text. Both are candidate sets — neither is authoritative
	// until a form matches the vocabulary.
	const passes = joined !== normalized ? [normalized, joined] : [normalized];

	for (const pass of passes) {
		for (const { term, re } of PHRASE_RES) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(pass)) !== null) {
				push(term, m[0], m.index);
				if (!m[0].length) re.lastIndex += 1;
			}
		}
		TOKEN_RE.lastIndex = 0;
		let m;
		while ((m = TOKEN_RE.exec(pass)) !== null) {
			const surface = m[0];
			for (const form of tokenForms(surface)) {
				if (SINGLE_TOKEN_TERMS.has(form)) {
					push(form, surface, m.index);
					break;
				}
			}
			if (!surface.length) TOKEN_RE.lastIndex += 1;
		}
	}

	hits.sort((a, b) => a.index - b.index);
	return hits;
}

/** True when any blocked profanity/slang term is present (any spelling). */
export function hasBlockedTerm(text) {
	return findTerms(text).length > 0;
}

/** The first hit, or null. Callers that only need the verdict use this. */
export function firstTerm(text) {
	const hits = findTerms(text);
	return hits.length ? hits[0] : null;
}
