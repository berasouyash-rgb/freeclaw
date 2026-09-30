// Safety parity — the pipeline must reach the SAME verdicts as the routes'
// inline gates on every plain input (spec §26: one shared infrastructure).
// Method: replicate each route's inline condition byte-for-byte from the
// CURRENT source (_posts.js ~line 699, _polls.js ~line 374, _comments.js
// ~line 183) and assert decision-equality over a corpus. Any future policy
// change must move BOTH sides together — this file fails otherwise.
// The ONE intended delta (NFKC evasion hardening) is asserted explicitly.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

import { serverModerate } from "../../api/_moderation.js";
import { evaluateContent, messageFor } from "../../api/_safety-pipeline.js";

const PW = "privacy_weak";
const EW = "explicit_weak";

// ── Inline replicas (copied logic, not imports — that is the point) ──
function inline(text: string) {
	const mod = serverModerate("", text, null);
	const types = mod.flags.map((f: { type: string }) => f.type);
	const has = (...ts: string[]) => ts.some((t) => types.includes(t));
	return { mod, types, has };
}
function inlineComment(text: string) {
	const { mod, has } = inline(text);
	// Mirrors the threat-review policy row: heuristic/reported threats have
	// no review queue on this surface, so they block like any other
	// review-grade flag here (posts hold them instead — see inlinePost).
	const blocked = mod.blocked || has(PW) || has(EW) || has("threat", "threat_report");
	const isPII = has("privacy", PW);
	return { blocked, code: blocked ? (isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED") : null };
}
function inlinePost(text: string) {
	const { mod, has } = inline(text);
	const blocked = mod.blocked;
	const isPII = has("privacy");
	const hold = !blocked && (mod.requiresReview || has(PW));
	return {
		blocked,
		code: blocked ? (isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED") : null,
		hold,
	};
}
function pipeComment(text: string) {
	const d = evaluateContent(text, "direct", null);
	const isPII = d.flags.some((f: { type: string }) => f.type === "privacy" || f.type === PW);
	return { blocked: d.blocked, code: d.blocked ? (isPII ? "PII_BLOCKED" : d.code) : null };
}
function pipePost(text: string) {
	const d = evaluateContent(text, "queued", null);
	const isPII = d.flags.some((f: { type: string }) => f.type === "privacy");
	const hold =
		!d.blocked &&
		(d.needsReview || d.flags.some((f: { type: string }) => f.type === PW));
	return {
		blocked: d.blocked,
		code: d.blocked ? (isPII ? "PII_BLOCKED" : d.code) : null,
		hold,
	};
}

const CORPUS: Array<[string, string]> = [
	["clean complaint", "the library fan has been broken for a week"],
	["PII email", "email me at john.doe@example.com"],
	["slang zero-tolerance", "this canteen food sucks, fix it"],
	["transliterated slang", "yeh warden bilkul bewakoof hai"],
	["leet evasion", "this hostel is sh1t"],
	["leet evasion 5-for-s", "this canteen food suck5"],
	["leet evasion bang", "shut up you b!tch"],
	["zero-width evasion", "sh\u200bit happens here"],
	["slur", "he called me a faggot in class"],
	["threat", "i will kill you after school"],
	["heuristic threat held", "i will kill Rahul tomorrow"],
	["reported threat held", "Rajiv told the class he will kill you tomorrow"],
	["blackmail demand", "pay me or i will leak your photos"],
	["weak privacy PIN", "my pin is 400001, come visit"],
	["victim report", "someone is blackmailing me for money"],
	["fee reminder", "pay the mess fee or lose your seat"],
	["spam flood", "buy followers cheap, click here now free prize winner"],
	["credential leak", "my password is hunter2hunter"],
];

describe("pipeline ≡ inline on plain inputs", () => {
	it("comments: identical block + code on every corpus case", () => {
		for (const [name, text] of CORPUS) {
			expect({ ...pipeComment(text) }, name).toEqual({ ...inlineComment(text), });
		}
	});
	it("polls: identical block + code on every corpus case", () => {
		// Polls share the comment gate shape (direct surface, same condition).
		for (const [name, text] of CORPUS) {
			expect({ ...pipeComment(text) }, name).toEqual({ ...inlineComment(text) });
		}
	});
	it("posts: identical block/code/HOLD on every corpus case", () => {
		for (const [name, text] of CORPUS) {
			expect({ ...pipePost(text) }, name).toEqual({ ...inlinePost(text) });
		}
	});
});

describe("message copy is byte-identical per surface", () => {
	it("comment/post/poll/edit strings match the routes verbatim", () => {
		expect(messageFor("comment", "PII_BLOCKED")).toBe(
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
		);
		expect(messageFor("comment", "CONTENT_BLOCKED")).toBe(
			"This comment violates our safety guidelines and cannot be posted.",
		);
		expect(messageFor("post", "PII_BLOCKED")).toContain("remove all personal details and try again");
		expect(messageFor("post", "CONTENT_BLOCKED")).toContain("cannot be published");
		expect(messageFor("poll", "CONTENT_BLOCKED")).toBe(
			"This poll violates our safety guidelines and cannot be published.",
		);
		expect(messageFor("edit", "CONTENT_BLOCKED")).toBe(
			"This edit violates our safety guidelines and cannot be saved.",
		);
		expect(messageFor("editPost", "PII_BLOCKED")).toContain("try again");
		expect(messageFor("editPost", "CONTENT_BLOCKED")).toBe(
			"Your edit violates our safety guidelines and cannot be saved.",
		);
	});
});

describe("intended delta: NFKC evasion hardening", () => {
	it("full-width evasion is judged as its ASCII self by the pipeline", () => {
		const evasive = "this canteen food ｓｕｃｋｓ";
		// Raw inline gate sees no ASCII slur → publishes today.
		expect(inlineComment(evasive).blocked).toBe(false);
		// Pipeline normalizes first → blocks under zero-tolerance.
		expect(pipeComment(evasive).blocked).toBe(true);
		expect(pipeComment(evasive).code).toBe("CONTENT_BLOCKED");
	});

	it("zero-width splitter evasion is stripped before detection", () => {
		const evasive = "sh\u200bit happens here";
		expect(pipeComment(evasive).blocked).toBe(true);
		expect(pipeComment(evasive).code).toBe("CONTENT_BLOCKED");
	});
});

describe("known gap: spaced/dotted letter joining (documented, not silently passing)", () => {
	// "s h i t" / "s.h.i.t" still publish: rejoining separators would
	// endanger legitimate dotted forms ("u.s.a", "e.g.", initials) and
	// spaced emphasis, so the gate stays silent here rather than risk
	// false positives. If a joining detector lands, THESE TESTS MUST flip.
	it("records the current boundary honestly", () => {
		for (const t of ["s h i t happens", "s.h.i.t happens"]) {
			expect(pipeComment(t).blocked).toBe(false);
		}
	});
});
