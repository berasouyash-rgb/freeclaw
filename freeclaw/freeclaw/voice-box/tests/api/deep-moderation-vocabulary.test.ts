/**
 * LOCK — model-emitted category vocabulary maps to policy flags.
 *
 * Live-verified (2026-10-14 smoke: paraphrased violence, coded hate, novel
 * coercion, dogpiling, exclusion, grooming-literal, stalking): the judge
 * phrases into THESE mapped tokens, and every one lands blocked-or-held,
 * never published. This file locks that contract with mocked providers so
 * a future edit to the flag map that drops a family fails loudly here
 * instead of silently publishing live (the exact "sex sex" failure mode).
 *
 * All tests below pass on current code by design — they are locks, not
 * red-first pins. The red-first work for this area lives in
 * deep-moderation-sexual.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({
	callNvidiaFast: vi.fn(),
	callLLMChain: vi.fn(),
}));
vi.mock("../../api/_providers.js", () => providers);

import { evaluateContentDeep } from "../../api/_safety-pipeline.js";
import { clearDeepCache } from "../../api/_context-moderation.js";

function modelText(obj: unknown) {
	return JSON.stringify(obj);
}

function flagVerdict(severity: string, categories: string[]) {
	return {
		provider: "test-model",
		model: "test-model",
		text: modelText({
			severity,
			categories,
			target: null,
			confidence: 0.9,
			explanation: "test verdict",
		}),
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	clearDeepCache();
	providers.callNvidiaFast.mockResolvedValue(null);
	providers.callLLMChain.mockResolvedValue(null);
});

const CLEAN_TEXT = "the library fan is broken";

describe("model category vocabulary stays fully mapped", () => {
	it.each([
		["violence", "violence"],
		["hate", "hate_speech"],
		["harassment", "bullying"],
		["intimidation", "threat"],
		["coercion", "coercion"],
		["blackmail", "coercion"],
		["doxxing", "privacy"],
	])(
		"model verdict %j lands on flag %j and never publishes",
		async (category, flag) => {
			// Premise guard: deterministic must not already catch this —
			// else the test would pass without exercising the model path.
			providers.callNvidiaFast.mockResolvedValueOnce(
				flagVerdict("high", [category]),
			);
			const d = await evaluateContentDeep(CLEAN_TEXT, "direct", null, {
				taskKey: "test.deep",
			});
			expect(d.model_used).toBe(true);
			expect(d.flags.map((f: { type: string }) => f.type)).toContain(flag);
			expect(d.blocked).toBe(true);
		},
	);

	it("queued surfaces hold (not publish) on high-severity mapped verdicts", async () => {
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("high", ["violence"]),
		);
		const d = await evaluateContentDeep(CLEAN_TEXT, "queued", null, {
			taskKey: "test.deep",
		});
		expect(d.blocked).toBe(true);
		expect(d.flags.map((f: { type: string }) => f.type)).toContain("violence");
	});
});
