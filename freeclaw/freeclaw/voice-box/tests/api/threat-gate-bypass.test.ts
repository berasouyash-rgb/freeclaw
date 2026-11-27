// Threat-gate bypass — a single-character typo must not disable violence
// detection.
//
// BUG (found in production): the comment "i willl kill rahul" PUBLISHED with
// Reply/Edit/Delete controls. Root cause: threat detection required EITHER
//   (a) VIOLENCE_PATTERNS — violent verb + a CLOSED list of pronoun objects
//       (you/him/her/them/my/our/someone/...); a proper NAME was not a member,
//       so "kill rahul" never matched, nor
//   (b) DANGEROUS_WORDS AND FIRST_PERSON_INTENT — where DANGEROUS_WORDS used
//       \bkill\b (so "killed" never matched) and FIRST_PERSON_INTENT required
//       the exact token "i will" (so "i willl" failed on one typo).
// A one-character typo in the intent word flipped the entire gate to "clean"
// and the threat went public unreviewed.
//
// These tests pin the corrected contract:
//   * violent verbs are matched morphologically (kill/killed/killing/...),
//   * the object slot accepts a proper name, not just pronouns,
//   * first-person intent survives typos,
//   * anything violent that cannot be classified FAILS CLOSED to review —
//     it must never resolve to "clean"/publishable,
//   * the Rajiv/Rahul rule still holds: a VICTIM quoting a threat is
//     threat_report (reviewed, never auto-blocked, never public unreviewed).
import { describe, expect, it } from "vitest";
import { evaluateContext, serverModerate } from "../../api/_moderation.js";

const THREATS_BLOCKED = [
	// The exact production string, plus the typo variants around it.
	"i willl kill rahul",
	"i willl kill you",
	"I WILLL KILL RAHUL",
	"i wll kill rahul",
	"i wil kill rahul",
	"i well kill rahul",
	// A bare verb + a PROPER NAME (the shape that slipped through entirely).
	"kill rahul",
	"i am going to kill rahul",
	"gonna kill rahul",
	// Morphology: the dangerous word as a past participle / progressive.
	"rahul is going to be killed",
	"they are killing rahul tomorrow",
	"rahul got murdered",
	// Other verbs with a proper-name object.
	"i will murder rahul",
	"i will shoot rahul",
	"i will stab rahul",
];

describe("threat gate — typo and morphology tolerance (BUG: threat published)", () => {
	it.each(THREATS_BLOCKED)(
		"never reports %j as clean/publishable",
		(text) => {
			expect(evaluateContext(text)).not.toBe("clean");
		},
	);

	it.each(THREATS_BLOCKED)("never lets %j through the public write gate", (text) => {
		const r = serverModerate(text, text);
		expect(r.blocked || r.requiresReview).toBe(true);
	});

	it("rates a first-person threat as direct_threat despite the typo", () => {
		expect(evaluateContext("i willl kill rahul")).toBe("direct_threat");
	});

	it("keeps the two-tier policy: generic targets hard-block, named targets review", () => {
		// Established contract (threat-context.test.ts): "I will kill you" is
		// critical `violence` and auto-blocks; "I will kill Rahul" names a
		// person, so it is held for a human as `threat`. BOTH must be kept out
		// of the public feed — the bug was that the typo let it publish at all.
		const generic = serverModerate("i willl kill you", "i willl kill you");
		expect(generic.blocked).toBe(true);
		expect(generic.flags.map((f: { type: string }) => f.type)).toContain(
			"violence",
		);

		const named = serverModerate("i willl kill rahul", "i willl kill rahul");
		expect(named.flags.map((f: { type: string }) => f.type)).toContain("threat");
		expect(named.requiresReview).toBe(true);
		expect(named.flags.map((f: { type: string }) => f.type)).not.toContain(
			"violence",
		);
	});
});

describe("threat gate — fail closed on unclassifiable violence", () => {
	const UNCLEAR_BUT_VIOLENT = [
		"kill you!!", // pre-existing contract: violent, no clear signal
		"kill rahul",
		"rahul is going to be killed",
	];

	it.each(UNCLEAR_BUT_VIOLENT)(
		"holds %j for review rather than publishing it",
		(text) => {
			const r = serverModerate(text, text);
			expect(r.blocked || r.requiresReview).toBe(true);
			// Never silently clean.
			expect(r.flags.length).toBeGreaterThan(0);
		},
	);

	it("keeps genuinely ordinary complaints publishable", () => {
		for (const ok of [
			"The canteen food is bad",
			"the lift is broken again",
			"my bus was late today",
			"the exam was too hard",
			"water is not coming in floor 2",
			"",
		]) {
			const r = serverModerate(ok, ok);
			expect(r.blocked).toBe(false);
			expect(evaluateContext(ok)).toBe("clean");
		}
	});
});

describe("threat gate — the Rajiv/Rahul rule still protects victims", () => {
	// Regression guard: broadening detection must NOT start auto-blocking
	// victims who quote a threat. Those stay unreviewed-public but reviewable.
	const REPORTS = [
		"Rajiv told the class he will kill you tomorrow",
		"Rahul said someone will stab him",
		"he threatened to kill me in the corridor",
		"she said she will murder someone",
	];

	it.each(REPORTS)("keeps %j as a reviewable report", (text) => {
		const r = serverModerate(text, text);
		// Never auto-blocked (the victim's voice must survive)…
		expect(r.blocked).toBe(false);
		// …and never public unreviewed.
		expect(r.requiresReview).toBe(true);
		expect(r.flags.map((f: { type: string }) => f.type)).toContain("threat_report");
		expect(evaluateContext(text)).toBe("reported_threat");
	});

	it("still blocks when first-person intent hides inside a quoting frame", () => {
		expect(evaluateContext("He said it, but I will kill you myself")).toBe(
			"direct_threat",
		);
		const r = serverModerate(
			"He said it, but I willl kill you myself",
			"He said it, but I willl kill you myself",
		);
		expect(r.blocked).toBe(true);
	});
});
