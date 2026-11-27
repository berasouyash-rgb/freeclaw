/**
 * SUPPORT SIGNAL — the model's emotional read must reach the write path.
 *
 * A genuine cry for help ("Rahul help me", "save me") carries no policy
 * flag — there is nothing to block — but the model DOES read the emotion
 * (anxious/sad/critical_distress). Today that read dies inside the
 * pipeline: `evaluateContentDeep` returns flags but never the emotion,
 * so the write path cannot route pleas to private+support and the
 * preview cannot auto-activate private mode. The evidence (a student
 * asking for help) stays public by default.
 *
 * The fix threads `emotion` through on model paths ONLY (model_used).
 * Skip/timeout/outage paths report no emotion — never infer one, and
 * never treat "unknown" as a signal. Policy (what counts as distress)
 * lives in `needsSupport`, tested separately — this file pins transport.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({
	callNvidiaFast: vi.fn(),
	callLLMChain: vi.fn(),
}));
vi.mock("../../api/_providers.js", () => providers);

import { evaluateContentDeep, needsSupport } from "../../api/_safety-pipeline.js";
import { clearDeepCache } from "../../api/_context-moderation.js";

function modelVerdict(obj: unknown) {
	return {
		provider: "test-model",
		model: "test-model",
		text: JSON.stringify(obj),
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	clearDeepCache();
	providers.callNvidiaFast.mockResolvedValue(null);
	providers.callLLMChain.mockResolvedValue(null);
});

describe("emotion transport (model ran)", () => {
	it("passes the model's emotion through when it finds no policy flag", async () => {
		// Plea with no actionable content: deterministic sees nothing,
		// the model reads anxiety. The pipeline must not swallow that.
		providers.callNvidiaFast.mockResolvedValueOnce(
			modelVerdict({
				severity: "moderate",
				categories: [],
				target: "Rahul",
				emotion: "anxious",
				confidence: 0.9,
				explanation: "plea for help",
			}),
		);
		const decision = await evaluateContentDeep("Rahul help me please", "queued", null, {
			taskKey: "test.support",
		});
		expect(decision.model_used).toBe(true);
		expect(decision.flags).toEqual([]);
		expect(decision.emotion).toBe("anxious");
	});

	it("passes emotion through alongside flags on attack verdicts", async () => {
		providers.callNvidiaFast.mockResolvedValueOnce(
			modelVerdict({
				severity: "high",
				categories: ["threat"],
				target: "Rahul",
				emotion: "anger",
				confidence: 0.9,
				explanation: "threat",
			}),
		);
		const decision = await evaluateContentDeep(
			"someone should teach Rahul a lesson after class",
			"queued",
			null,
			{ taskKey: "test.support" },
		);
		expect(decision.model_used).toBe(true);
		expect(decision.emotion).toBe("anger");
	});
});

describe("emotion transport (model did not run)", () => {
	it("reports no emotion when the deterministic floor already blocked", async () => {
		// "Rahul you're dead" trips the deterministic threat gate, so the
		// model is skipped — nothing was read, nothing may be reported.
		const decision = await evaluateContentDeep("Rahul you're dead", "queued", null, {
			taskKey: "test.support",
		});
		expect(decision.model_used).toBe(false);
		expect(decision.emotion ?? null).toBe(null);
	});

	it("reports no emotion on provider outage", async () => {
		providers.callNvidiaFast.mockResolvedValueOnce(null);
		providers.callLLMChain.mockResolvedValueOnce(null);
		const decision = await evaluateContentDeep(
			"the library closes too early",
			"queued",
			null,
			{ taskKey: "test.support" },
		);
		expect(decision.model_used).toBe(false);
		expect(decision.emotion ?? null).toBe(null);
	});
});

describe("needsSupport: one rule for preview and write path", () => {
	const base = {
		model_used: true,
		emotion: "anxious",
		level: "moderate",
		flags: [],
	};
	it.each([
		["plea at moderate", { ...base }, true],
		["crisis at high", { ...base, emotion: "critical_distress", level: "high" }, true],
		["sad at critical", { ...base, emotion: "sad", level: "critical" }, true],
	])("routes %s to support", (_name, decision, expected) => {
		expect(needsSupport(decision)).toBe(expected);
	});
	it.each([
		["mild nerves stay a normal post", { ...base, level: "mild" }, false],
		["positive emotion is not distress", { ...base, emotion: "positive", level: "high" }, false],
		["neutral emotion is not distress", { ...base, emotion: "neutral", level: "high" }, false],
		["model outage is not a signal", { ...base, model_used: false }, false],
		["timeout without model is not a signal", { model_used: false, emotion: "anxious", level: "high", flags: [] }, false],
		["no decision is not a signal", null, false],
		["threat stays on the block path", { model_used: true, emotion: "anger", level: "high", flags: [{ type: "threat" }] }, false],
		["attack with distressed emotion still blocks", { ...base, level: "high", flags: [{ type: "bullying" }] }, false],
		["explicit content is never support-routed", { ...base, level: "high", flags: [{ type: "explicit" }] }, false],
	])("does NOT route %s to support", (_name, decision, expected) => {
		expect(needsSupport(decision)).toBe(expected);
	});
});
