// ═══════════════════════════════════════════════════════════════════
// conversation-assist — sibling of the inbox classifier
// ═══════════════════════════════════════════════════════════════════
// This endpoint had its own EMOTIONAL_KEYWORDS and its own `includes()`
// matching, so it carried the same two defects independently of the inbox:
// substring false positives, and a second vocabulary ("distressed"/"angry")
// that no consumer understood. It now routes through the shared contextual
// engine, which is what these tests pin.
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

async function analyze(text: string) {
	const { analyzeContext } = await import("../../api/_context-classify.js");
	const { EMOTION_LEXICON } = await import("../../api/_conversation-assist.js");
	return analyzeContext(text, { useModel: false, lexicon: EMOTION_LEXICON });
}

describe("conversation-assist — contextual routing", () => {
	it("does not read 'along' as 'alone'", async () => {
		// The old `lower.includes("alone")` matched "along", so agreeing with a
		// plan was classified as sadness.
		const d = await analyze("let's go along with the plan");
		expect(d.severity).toBe("none");
		expect(d.emotion).toBe("neutral");
	});

	it("still detects genuine isolation", async () => {
		const d = await analyze("i feel so alone in this class");
		expect(d.emotion).toBe("sad");
		expect(d.severity).toBe("moderate");
	});

	it("escalates a threat even though its own lexicon has no threat word", async () => {
		// Proves the contextual engine runs here, not just the local list.
		const d = await analyze("bro go kys");
		expect(d.severity).toBe("high");
		expect(d.recommended_action).toBe("review");
	});

	it("emits only canonical severities", async () => {
		const { SEVERITIES } = await import("../../api/_context-classify.js");
		for (const text of [
			"i am panicking before the test",
			"this is so unfair",
			"thank you for listening",
			"you're dead",
		]) {
			expect(SEVERITIES).toContain((await analyze(text)).severity);
		}
	});
});
