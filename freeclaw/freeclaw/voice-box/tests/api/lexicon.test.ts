// ═══════════════════════════════════════════════════════════════════
// LEXICON — the rebuilt slang/profanity intelligence
// ═══════════════════════════════════════════════════════════════════
// Pins three things the old flat word list could not do:
//   1. EVASION: de-leet, repeated letters, interior separators, spaced-out
//      letters, zero-width and full-width all resolve to the same term.
//   2. HINGLISH: transliterated forms and their real spelling variants.
//   3. NO OVER-BLOCKING: the Scunthorpe class ("class", "grass", "assess")
//      and dotted abbreviations ("u.s.a", "e.g.") still publish.
// Plus a CLIENT/SERVER PARITY guard so the two vocabularies can never drift.
import { describe, expect, it } from "vitest";

import { LEXICON, PROFANITY, SLANG } from "../../api/_wordlists.js";
import { findTerms, hasBlockedTerm } from "../../api/_lexicon.js";
import * as clientLexicon from "../../src/lib/lexicon";

const termsOf = (text: string) => findTerms(text).map((h) => h.term);

describe("evasion resolves to the canonical term", () => {
	it.each([
		["plain", "this is shit"],
		["leet digits", "this is sh1t"],
		["leet symbols", "sh!t happens"],
		["repeated letters", "fuuuck this"],
		["interior dots", "s.h.i.t happens"],
		["interior stars", "f*ck off"],
		["spaced letters", "s h i t happens"],
		["zero-width split", "sh\u200bit happens"],
		["full-width", "this canteen food ｓｕｃｋｓ"],
	])("%s → detected", (_label, text) => {
		expect(hasBlockedTerm(text)).toBe(true);
	});

	it("returns the canonical term regardless of the spelling used", () => {
		expect(termsOf("sh1t")).toContain("shit");
		expect(termsOf("fuuuck")).toContain("fuck");
		expect(termsOf("s h i t")).toContain("shit");
		expect(termsOf("b!tch")).toContain("bitch");
	});
});

describe("Hinglish", () => {
	it.each([
		"yeh warden bilkul bewakoof hai",
		"chup kar yaar",
		"tu pagal hai",
		"kya bakwas hai",
		"wo chomu hai",
		"ganwar log",
		"saala kutta",
		"chutiya banaya",
	])("blocks %j", (text) => {
		expect(hasBlockedTerm(text)).toBe(true);
	});

	it("reads spelling variants of the same Hinglish term", () => {
		expect(termsOf("bewakouf")).toContain("bewakoof");
		expect(termsOf("gaandu")).toContain("gandu");
		expect(termsOf("lauda")).toContain("lodu");
	});
});

describe("no over-blocking (the Scunthorpe class)", () => {
	it.each([
		"the class went to the library",
		"please assist the new student",
		"the grass needs cutting",
		"assess the situation calmly",
		"she passed the test",
		"a massive improvement",
		"the u.s.a report is due",
		"see e.g. the physics notes",
		"class 8b has a test tomorrow",
		"this is so goooooooooood",
		"hello, how are you today?",
		"the canteen food is bad",
	])("leaves %j publishable", (text) => {
		expect(hasBlockedTerm(text)).toBe(false);
	});

	it("does not match a term inside a larger word", () => {
		for (const t of termsOf("classification grass assistant passage")) {
			expect(["ass", "sod", "git"]).not.toContain(t);
		}
	});
});

describe("client mirror cannot drift from the server", () => {
	it("mirrors the vocabulary exactly", () => {
		expect(clientLexicon.LEXICON).toEqual(LEXICON);
		expect(clientLexicon.PROFANITY).toEqual(PROFANITY);
		expect(clientLexicon.SLANG).toEqual(SLANG);
	});

	it("exports the same flattened lists the server does", () => {
		expect([...clientLexicon.PROFANITY].sort()).toEqual(
			[...PROFANITY].sort(),
		);
		expect([...clientLexicon.SLANG].sort()).toEqual([...SLANG].sort());
	});

	it("reaches the same verdict as the server on a corpus", () => {
		const corpus = [
			"this is sh1t",
			"fuuuck this",
			"s h i t happens",
			"s.h.i.t happens",
			"f*ck off",
			"chup kar yaar",
			"yeh warden bilkul bewakoof hai",
			"lauda",
			"the class went to the library",
			"the u.s.a report is due",
			"this canteen food ｓｕｃｋｓ",
			"hello, how are you today?",
		];
		for (const text of corpus) {
			expect(
				clientLexicon.findTerms(text).map((h) => `${h.term}:${h.category}`),
				text,
			).toEqual(findTerms(text).map((h) => `${h.term}:${h.category}`));
		}
	});
});

describe("the rebuilt vocabulary is broader than the old flat list", () => {
	it("carries every old term plus variants", () => {
		// Regression guard on the specific words the old list was built from.
		for (const legacy of ["fuck", "shit", "bitch", "idiot", "bewakoof", "chup kar"]) {
			expect([...PROFANITY, ...SLANG]).toContain(legacy);
		}
		expect(PROFANITY.length).toBeGreaterThan(80);
		expect(SLANG.length).toBeGreaterThan(59);
	});
});
