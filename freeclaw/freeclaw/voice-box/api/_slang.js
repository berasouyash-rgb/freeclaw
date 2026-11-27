// Slang finder — detection harness for chat language (school + Hinglish).
//
// Separate from the BLOCKING gates on purpose: SLANG entries are rude but
// often conversational ("this canteen food sucks" energy), so the moderation
// pipeline decides publish/hold/block while THIS module only reports what it
// saw: which terms, where, how many.
//
// Matching runs through api/_lexicon.js — the SAME spelling-proof matcher the
// blocking gate and the client use. The old version built its own regex from
// the raw list, so it could only see a term spelled exactly as listed while
// the gate saw "sh1t"/"shiiiit"/"s.h.i.t"; admins triaging tone in the inbox
// were therefore shown a strictly worse picture than the one that blocked the
// message. One matcher, one vocabulary (api/_wordlists.js) — the finder can
// never drift from enforcement.
import { SLANG } from "./_wordlists.js";
import { findTerms } from "./_lexicon.js";

export const SLANG_TERM_COUNT = SLANG.length;

/** Every slang hit with its position: [{ term, index }]. Pure, no I/O. */
export function scanSlang(text) {
	if (typeof text !== "string" || !text) return [];
	return findTerms(text)
		.filter((hit) => hit.category === "slang")
		.slice(0, 50)
		.map((hit) => ({ term: hit.term, index: hit.index }));
}

/** Thread-level rollup: { count, terms: unique (max 20), at }. */
export function slangSummary(text, at) {
	const hits = scanSlang(text);
	const terms = [];
	for (const h of hits) {
		if (!terms.includes(h.term)) terms.push(h.term);
		if (terms.length >= 20) break;
	}
	return {
		count: hits.length,
		terms,
		at: at || new Date().toISOString(),
	};
}

/** Merge one message's hits into thread state's slang_hits (capped). */
export function mergeSlang(prev, text, at) {
	const next = slangSummary(text, at);
	if (next.count === 0) return prev || null;
	const terms = [...((prev && prev.terms) || [])];
	for (const t of next.terms) {
		if (!terms.includes(t)) terms.push(t);
		if (terms.length >= 20) break;
	}
	return {
		count: ((prev && prev.count) || 0) + next.count,
		terms,
		messages: ((prev && prev.messages) || 0) + 1,
		at: next.at,
	};
}
