// ═══════════════════════════════════════════════════════════════════
// Contextual classifier — golden/regression dataset
// ═══════════════════════════════════════════════════════════════════
// Every case here is a failure the keyword-first classifier actually had, or a
// distinction it structurally could not make. The two headline inversions:
//
//   "I hate this homework."   matched the lexicon → flagged HIGH distress
//   "Rahul, I hate you."      matched nothing    → flagged NONE
//
// These run with useModel:false on purpose. Safety behaviour must be correct
// when no model is reachable — that is the whole reason the signal layer is
// deterministic — so none of the contextual guarantees may depend on the LLM.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = {
	callLLMChain: vi.fn(),
	callNvidiaFast: vi.fn().mockResolvedValue(null),
	hasUsableLLM: vi.fn().mockResolvedValue(false),
};

vi.mock("../../api/_providers.js", () => providerMocks);

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
});

/** Analyze with the real production lexicon, deterministic path only. */
async function analyze(text: string) {
	const { analyzeContext } = await import("../../api/_context-classify.js");
	const { EMOTION_LEXICON } = await import("../../api/_inbox.js");
	return analyzeContext(text, { useModel: false, lexicon: EMOTION_LEXICON });
}

describe("contextual classification — the two inverted headline cases", () => {
	it("flags directed abuse that the keyword-first pass missed entirely", async () => {
		// The name is not in any dictionary, and that must not matter.
		const d = await analyze("Rahul, I hate you.");
		expect(d.severity).toBe("high");
		expect(d.classification).toBe("targeted-harassment");
		expect(d.target).toEqual({ kind: "name", value: "Rahul" });
	});

	it("does not escalate ordinary coursework venting", async () => {
		// "hate this" used to be a distress keyword, so this was HIGH.
		for (const vent of ["I hate this homework.", "I hate this exam."]) {
			const d = await analyze(vent);
			expect(d.severity).toBe("mild");
			expect(d.classification).toBe("anger");
			expect(d.target).toBeNull();
		}
	});
});

describe("contextual classification — asserted vs reported", () => {
	it("separates asserted abuse from the same words being reported", async () => {
		const asserted = await analyze("I hate you.");
		const reported = await analyze("Rahul said 'I hate you' yesterday.");
		expect(asserted.severity).toBe("high");
		expect(reported.severity).toBe("mild");
		expect(reported.reported_or_quoted).toBe(true);
		expect(asserted.reported_or_quoted).toBe(false);
	});

	it("separates a quoted threat from an asserted one", async () => {
		const asserted = await analyze("go die.");
		const reported = await analyze("people say 'go die' online");
		expect(asserted.severity).toBe("high");
		expect(asserted.classification).toBe("threat");
		// A REPORTED threat still needs a human look, so it lands at moderate
		// rather than dropping to "mild" like reported name-calling does —
		// below asserted, but never below review-worthy.
		expect(reported.severity).toBe("moderate");
		expect(reported.classification).toBe("reported-abuse");
		expect(reported.reported_or_quoted).toBe(true);
	});

	it("still surfaces reported abuse for review rather than swallowing it", async () => {
		const reported = await analyze("Rahul said 'I hate you' yesterday.");
		expect(reported.recommended_action).toBe("warn");
		expect(reported.categories.length).toBeGreaterThan(0);
	});
});

describe("contextual classification — names and targets", () => {
	it("detects a name in the middle of a sentence as the target", async () => {
		const d = await analyze("Everyone hates him.");
		expect(d.severity).toBe("moderate");
		expect(d.target).toEqual({ kind: "pronoun", value: "him" });
	});

	it("keeps a benign mention of a name harmless", async () => {
		const d = await analyze("Rahul helped me with maths.");
		expect(d.severity).toBe("none");
		expect(d.recommended_action).toBe("allow");
	});

	it("reads a threat against a named person as high risk", async () => {
		const d = await analyze("Rahul I hate you, I will hurt you.");
		expect(d.severity).toBe("high");
		expect(d.classification).toBe("threat");
	});

	it("does not treat ordinary abstract objects as a person target", async () => {
		const d = await analyze("I hate this homework.");
		expect(d.target).toBeNull();
	});
});

describe("contextual classification — obfuscation and multilingual", () => {
	it("sees through digit substitution", async () => {
		const d = await analyze("R@hul I h4te you");
		expect(d.severity).toBe("high");
	});

	it("keeps a word boundary so punctuation does not break a match", async () => {
		// De-leeting maps digits only; mapping "!" would turn "kys!" into
		// "kysi" and silently drop the hit.
		const d = await analyze("kys!");
		expect(d.severity).toBe("high");
		expect(d.classification).toBe("threat");
	});

	it("classifies a Hinglish third-party threat", async () => {
		const d = await analyze("Rahul ko bol don't come here");
		expect(d.severity).toBe("high");
		expect(d.classification).toBe("threat");
	});

	it("preserves the Hinglish and Bengali emotion readings", async () => {
		const hi = await analyze("mujhe bahut gussa aa raha hai");
		expect(hi.tonal_emotion ?? hi.emotion).toBe("anger");
		expect(hi.severity).toBe("high");

		const bn = await analyze("amar mon kharap lagche");
		expect(bn.emotion).toBe("sad");
		expect(bn.severity).toBe("moderate");
	});
});

describe("contextual classification — the deterministic floor", () => {
	it("never lets a model talk a crisis down", async () => {
		providerMocks.callNvidiaFast.mockResolvedValue({
			provider: "nvidia-fast",
			model: "test",
			text: JSON.stringify({
				severity: "none",
				severity_alias: "none",
				categories: ["neutral"],
				confidence: 0.99,
				explanation: "just chatting",
			}),
		});
		const { analyzeContext } = await import("../../api/_context-classify.js");
		const { EMOTION_LEXICON } = await import("../../api/_inbox.js");
		const d = await analyzeContext("marna chahti hoon", {
			useModel: true,
			lexicon: EMOTION_LEXICON,
		});
		expect(d.severity).toBe("critical");
		expect(d.recommended_action).toBe("escalate");
	});

	it("does not call a model at all when the message is already decided", async () => {
		const { analyzeContext } = await import("../../api/_context-classify.js");
		await analyzeContext("Rahul, I hate you.", { useModel: true });
		expect(providerMocks.callNvidiaFast).not.toHaveBeenCalled();
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});
});

describe("contextual classification — structured decision contract", () => {
	it("returns the full auditable decision shape", async () => {
		const d = await analyze("Rahul, I hate you.");
		for (const key of [
			"classification",
			"confidence",
			"categories",
			"severity",
			"explanation_summary",
			"recommended_action",
			"evidence",
			"policy_version",
		]) {
			expect(d).toHaveProperty(key);
		}
		expect(d.policy_version).toBe("context-v1");
		expect(Array.isArray(d.categories)).toBe(true);
		expect(d.evidence.some((e: string) => e.startsWith("hostility:"))).toBe(true);
	});

	it("only ever emits severities and actions from the fixed enums", async () => {
		const { SEVERITIES, ACTIONS } = await import("../../api/_context-classify.js");
		for (const text of [
			"Rahul, I hate you.",
			"I hate this homework.",
			"go die.",
			"people say 'go die' online",
			"Rahul helped me with maths.",
			"marna chahti hoon",
			"thank you so much",
		]) {
			const d = await analyze(text);
			expect(SEVERITIES).toContain(d.severity);
			expect(ACTIONS).toContain(d.recommended_action);
		}
	});
});

describe("contextual classification — no false positives on benign text", () => {
	it("does not fire on words that merely contain a lexicon entry", async () => {
		for (const benign of [
			"my average in maths is 80",
			"the storage room is locked",
			"we wrote a fragment yesterday",
			"i want to work alongside the seniors",
		]) {
			const d = await analyze(benign);
			expect(d.severity).toBe("none");
			expect(d.recommended_action).toBe("allow");
		}
	});
});
