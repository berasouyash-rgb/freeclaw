// ═══════════════════════════════════════════════════════════════════
// Relevance — actionable school problem vs noise
// ═══════════════════════════════════════════════════════════════════
// The two cases this layer exists for, taken verbatim from the school's
// own examples:
//
//   "the AC is not working"        → school_problem
//   "my fate is not coming to me"  → not_school_related
//
// The guarantees pinned below, in priority order:
//
//   1. It NEVER blocks. There is no blocked/gate field at all; the author
//      can always post. A confident machine verdict that silences a real
//      complaint is a worse failure than a noisy inbox.
//   2. Distress outranks relevance. A student telling us they are not
//      safe is routed to support, never labelled off-topic.
//   3. Every verdict is explainable: it returns the exact text it matched,
//      so the UI can show the student evidence instead of a vague claim.
//   4. Word boundaries only. This repo already learned that a naive
//      matcher fires on "class"/"grass" while looking for "ass" — "ac"
//      must not match "practice" or "acting".
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import {
	assessRelevance,
	LIMITS,
	POLICY_VERSION,
	ROUTES,
	summarizeRelevance,
	VERDICTS,
} from "../../api/_relevance.js";

describe("the two cases the feature exists for", () => {
	it("calls a broken AC a school problem", () => {
		const r = assessRelevance("the AC is not working");
		expect(r.verdict).toBe("school_problem");
		expect(r.route).toBe("post");
		expect(r.askUserToConfirm).toBe(false);
	});

	it("recognises the same complaint without the capital letters", () => {
		expect(assessRelevance("the ac is not working").verdict).toBe(
			"school_problem",
		);
		expect(assessRelevance("the air conditioner is broken").verdict).toBe(
			"school_problem",
		);
	});

	it("does not treat fatalism as a school problem", () => {
		const r = assessRelevance("my fate is not coming to me");
		expect(r.verdict).toBe("not_school_related");
		// …but it still invites the student to post, and asks them to confirm.
		expect(r.askUserToConfirm).toBe(true);
		expect(r.reasons.some((x) => x.kind === "off_topic")).toBe(true);
	});
});

describe("real school problems", () => {
	const cases = [
		"Our class has had no water since Monday.",
		"the classroom is too hot and the fan does not work",
		"The toilet in the ground floor is dirty and smells bad.",
		"the library closes too early during exam week",
		"sir, class ka fan kharab hai",
		"safai nahi ho rahi canteen me",
		"we have paani nahi in our hostel since yesterday",
		"the bus is always late and there are not enough seats",
	];

	for (const text of cases) {
		it(`accepts: ${text}`, () => {
			expect(assessRelevance(text).verdict).toBe("school_problem");
		});
	}
});

describe("off-topic input is labelled honestly, never blocked", () => {
	const cases = [
		"my fate is not coming to me",
		"I have a crush on her, what should I do",
		"who won the cricket match yesterday",
		"my luck is very bad this year",
	];

	for (const text of cases) {
		it(`flags: ${text}`, () => {
			const r = assessRelevance(text);
			expect(r.verdict).toBe("not_school_related");
			// The critical part: flagged is not rejected.
			expect(r.route).toBe("post_with_note");
		});
	}
});

describe("distress outranks every relevance judgement", () => {
	it("routes a crisis to support instead of calling it off-topic", () => {
		const r = assessRelevance("I feel worthless and I want to die");
		expect(r.route).toBe("support");
		// Never "not_school_related" — that would be cruel and wrong.
		expect(r.verdict).not.toBe("not_school_related");
		expect(r.explanation).toMatch(/support/i);
	});

	it("does not mistake a threat for distress", () => {
		// "I will kill you" is a safety matter, NOT a support matter — the
		// relevance layer must not claim a crisis it did not see.
		const r = assessRelevance("I will kill you");
		expect(r.route).not.toBe("support");
	});

	it("still routes support when the message also mentions school", () => {
		expect(assessRelevance("school is pointless, I want to die").route).toBe(
			"support",
		);
	});
});

describe("word boundaries, not substrings", () => {
	it("does not read \"ac\" out of practice/acting/acrobatics", () => {
		for (const text of [
			"we practised the acrobatics display",
			"the acting workshop was cancelled",
		]) {
			const r = assessRelevance(text);
			expect(
				r.schoolHits.some((h) => h.signal === "facilities"),
				`"${text}" must not match the facilities bucket`,
			).toBe(false);
		}
	});

	it("does not read \"fate\" out of a longer word", () => {
		// "fatal" and "fateful" are different words; \bfate\b must not fire.
		expect(assessRelevance("there was a fatal accident").verdict).not.toBe(
			"not_school_related",
		);
	});
});

describe("transparency", () => {
	it("returns the exact evidence it matched", () => {
		const text = "the AC is not working";
		const r = assessRelevance(text);
		expect(r.reasons.length).toBeGreaterThan(0);
		for (const reason of r.reasons) {
			expect(typeof reason.label).toBe("string");
			expect(reason.label.length).toBeGreaterThan(0);
			// Evidence must be real text from the submission — a fabricated
			// quote is worse than no quote, because the student will argue
			// with it.
			expect(text.toLowerCase()).toContain(reason.evidence.toLowerCase());
		}
	});

	it("always explains itself and states its limits", () => {
		for (const text of ["the AC is not working", "my fate is not coming to me"]) {
			const r = assessRelevance(text);
			expect(r.explanation.length).toBeGreaterThan(10);
			expect(r.limits).toEqual(LIMITS);
		}
	});

	it("exposes the policy version so a verdict is reproducible", () => {
		expect(assessRelevance("anything").policyVersion).toBe(POLICY_VERSION);
	});
});

describe("never blocks, always postable", () => {
	const corpus = [
		"the AC is not working",
		"my fate is not coming to me",
		"I want to die",
		"",
		"   ",
		"a".repeat(9000),
		"the toilet is dirty",
		"cricket match was good",
	];

	it("never returns a blocking signal and only known verdict/route values", () => {
		for (const text of corpus) {
			const r = assessRelevance(text);
			expect(VERDICTS).toContain(r.verdict);
			expect(ROUTES).toContain(r.route);
			// No gate fields exist on the shape at all.
			expect(r).not.toHaveProperty("blocked");
			expect(r).not.toHaveProperty("reject");
			expect(r.askUserToConfirm).toBeTypeOf("boolean");
		}
	});

	it("survives empty and whitespace-only input", () => {
		expect(assessRelevance("").verdict).toBe("unclear");
		expect(assessRelevance("   ").verdict).toBe("unclear");
		expect(assessRelevance(undefined).verdict).toBe("unclear");
	});

	it("bounds very long input instead of scanning unbounded text", () => {
		const r = assessRelevance(`the AC is not working ${"x".repeat(20000)}`);
		expect(r.verdict).toBe("school_problem");
	});

	it("is deterministic — the same text always yields the same verdict", () => {
		const a = assessRelevance("the toilet is dirty");
		const b = assessRelevance("the toilet is dirty");
		expect(a.verdict).toBe(b.verdict);
		expect(a.reasons).toEqual(b.reasons);
	});
});

describe("summarizeRelevance", () => {
	it("gives a one-line summary for logs", () => {
		// One context hit ("ac") + one problem hit ("not working") reads as
		// medium confidence — short but unambiguous. It reaches "high" only
		// when several signals agree.
		expect(summarizeRelevance(assessRelevance("the AC is not working"))).toBe(
			"school_problem/medium",
		);
		expect(summarizeRelevance(null)).toBe("unknown");
	});
});
