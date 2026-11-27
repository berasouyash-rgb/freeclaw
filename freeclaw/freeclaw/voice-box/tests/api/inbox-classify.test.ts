// ═══════════════════════════════════════════════════════════════════
// Inbox emotion classification — LLM output validation
// ═══════════════════════════════════════════════════════════════════
// A garbage or prompt-injected model reply must never plant arbitrary
// level/emotion/agent strings into thread state. Critical always routes
// to the emotional agent, even when the model disagrees.
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

describe("classifyEmotion — output validation", () => {
	it("matches Hindi distress keywords without any LLM", async () => {
		const { classifyEmotion } = await import("../../api/_inbox.js");
		expect(await classifyEmotion("mujhe bahut gussa aa raha hai")).toEqual({
			level: "high",
			emotion: "anger",
			agent: "emotional",
		});
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
		expect(providerMocks.callNvidiaFast).not.toHaveBeenCalled();
	});

	it("matches Bengali sadness keywords without any LLM", async () => {
		const { classifyEmotion } = await import("../../api/_inbox.js");
		expect(await classifyEmotion("amar mon kharap lagche")).toEqual({
			level: "moderate",
			emotion: "sad",
			agent: "emotional",
		});
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("keywords never emit a level outside the canonical UI vocabulary", async () => {
		const { classifyEmotion } = await import("../../api/_inbox.js");
		const canonical = ["critical", "high", "moderate", "mild", "none"];
		const samples = [
			"mujhe bahut gussa aa raha hai", // distress keyword
			"amar mon kharap lagche", // sad keyword
			"i am so stressed about exams", // anxious keyword
			"thank you so much for the help", // positive keyword
			"marna chahti hoon", // critical keyword
		];
		for (const sample of samples) {
			expect(canonical).toContain((await classifyEmotion(sample)).level);
		}
	});

	it("does not fire distress on words that merely contain a keyword", async () => {
		const { classifyEmotion } = await import("../../api/_inbox.js");
		providerMocks.callLLMChain.mockResolvedValue(undefined);
		// "average", "storage" and "fragment" all contain "rag"; before the
		// word-boundary fix every one of these was classified as distress.
		for (const benign of [
			"my average in maths is 80",
			"the storage room is locked",
			"we wrote a fragment yesterday",
		]) {
			expect(await classifyEmotion(benign)).toEqual({
				level: "none",
				emotion: "neutral",
				agent: "general",
			});
		}
	});

	it("keeps a genuine standalone rag/ragging hit at high", async () => {
		const { classifyEmotion } = await import("../../api/_inbox.js");
		expect((await classifyEmotion("the seniors are ragging him")).level).toBe(
			"high",
		);
	});
	it("sanitizes garbage level/emotion/agent strings to safe defaults", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				level: "over9000",
				emotion: "<script>alert(1)</script>",
				agent: "root",
			}),
		});
		const { classifyEmotion } = await import("../../api/_inbox.js");
		expect(await classifyEmotion("I feel a bit off today")).toEqual({
			level: "none",
			emotion: "neutral",
			agent: "general",
		});
	});

	it("forces the emotional agent when the level is critical", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				level: "critical",
				emotion: "sad",
				agent: "general",
			}),
		});
		const { classifyEmotion } = await import("../../api/_inbox.js");
		const out = await classifyEmotion("things seem grey and heavy lately");
		expect(out.level).toBe("critical");
		expect(out.agent).toBe("emotional");
	});

	it("accepts a valid classification untouched", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				level: "mild",
				emotion: "anxious",
				agent: "emotional",
			}),
		});
		const { classifyEmotion } = await import("../../api/_inbox.js");
		expect(await classifyEmotion("tomorrow makes my stomach flutter")).toEqual({
			level: "mild",
			emotion: "anxious",
			agent: "emotional",
		});
	});

	it("falls back to the safe default when the LLM throws", async () => {
		providerMocks.callLLMChain.mockRejectedValueOnce(new Error("down"));
		const { classifyEmotion } = await import("../../api/_inbox.js");
		expect(await classifyEmotion("something happened")).toEqual({
			level: "none",
			emotion: "neutral",
			agent: "general",
		});
	});
});

describe("generateReply — provider lanes", () => {
	const thread = { handoff: false, agent: "general" };
	const calm = { level: "none", emotion: "neutral", agent: "general" };

	it("uses the fast NVIDIA lane first and tags the engine", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "nvidia/nemotron-3.5-lightning-30b-a3b",
			text: "I hear you — tell me more about what happened.",
		});
		const { generateReply } = await import("../../api/_inbox.js");
		const out = await generateReply("Someone took my pen", thread, calm, false);
		expect(out.reply).toContain("I hear you");
		expect(out.engine).toContain("nvidia-fast");
		expect(out.handoff).toBe(false);
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("falls back to the chain when the fast lane is empty", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce(null);
		providerMocks.callLLMChain.mockResolvedValueOnce({
			provider: "test",
			model: "test-model",
			text: "Thanks for sharing that with me today.",
		});
		const { generateReply } = await import("../../api/_inbox.js");
		const out = await generateReply("Today was okay I guess", thread, calm, false);
		expect(out.reply).toContain("Thanks for sharing");
		expect(out.engine).toContain("test");
	});

	it("returns the honest offline reply (tagged) when everything fails", async () => {
		providerMocks.callNvidiaFast.mockResolvedValueOnce(null);
		providerMocks.callLLMChain.mockRejectedValueOnce(new Error("down"));
		const { generateReply } = await import("../../api/_inbox.js");
		const out = await generateReply("Are you there still?", thread, calm, false);
		expect(out.engine).toBe("offline");
		expect(out.reply).toMatch(/connection issue/i);
		expect(out.handoff).toBe(false);
	});

	it("stays quiet when an admin took over", async () => {
		const { generateReply } = await import("../../api/_inbox.js");
		const out = await generateReply("hello?", { handoff: true, agent: "general" }, calm, true);
		expect(out.reply).toBeNull();
		expect(out.handoff).toBe(true);
		expect(providerMocks.callNvidiaFast).not.toHaveBeenCalled();
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});
});
