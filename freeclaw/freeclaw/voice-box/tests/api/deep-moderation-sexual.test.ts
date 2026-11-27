/**
 * REGRESSION — model-detected sexual/vulgar content must never drop.
 *
 * Live finding (2026-10-12): "sex sex sex" PUBLISHED. The model DID see it
 * (live probe: severity mild, categories ["profanity"], "Repeated sexual
 * term ... vulgar language") — but `contextualFlags` has no "profanity" or
 * "slang" entry, so the verdict fell through the map to [] and the post
 * published. Same hole for anything the model phrases outside the mapped
 * vocabulary. The prompt additionally never offers sexual-content tokens,
 * so the judge understates ("mild profanity" for repeated sexual content).
 *
 * This file pins, with mocked providers (no network):
 *   1. Model-flagged sexual content blocks on every surface (lock: mapping
 *      already exists — the prompt fix relies on this contract).
 *   2. Model-flagged vulgarity is HELD, never published (RED: dropped today).
 *   3. Sexual-harm victim reports are held, never blocked (victim safety).
 *   4. Outage verdicts are NOT cached (RED: a stalled verdict whitelists the
 *      text for 5 minutes today).
 *   5. Neutral health discussion stays publishable (no prudish over-block).
 *
 * Deliberately NOT word lists: no match-terms are added anywhere. The fix
 * teaches the judge categories (prompt) and stops dropping its verdicts
 * (flag map). Deterministic patterns are byte-untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({
	callNvidiaFast: vi.fn(),
	callLLMChain: vi.fn(),
}));
vi.mock("../../api/_providers.js", () => providers);

import { evaluateContent, evaluateContentDeep } from "../../api/_safety-pipeline.js";
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

const SEX3 = "sex sex sex";

function deterministicTypes(text: string, surface: "queued" | "direct") {
	return evaluateContent(text, surface, null).flags.map(
		(f: { type: string }) => f.type,
	);
}

describe("model-flagged sexual content blocks everywhere", () => {
	it("blocks sexual-content/high on posts and comments", async () => {
		// Premise guard: deterministic must NOT already catch this — else
		// this test would pass without ever exercising the model path.
		expect(deterministicTypes(SEX3, "direct")).not.toContain("explicit");
		expect(deterministicTypes(SEX3, "direct")).not.toContain("profanity");
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("high", ["sexual-content"]),
		);
		const direct = await evaluateContentDeep(SEX3, "direct", null, {
			taskKey: "test.deep",
		});
		expect(direct.model_used).toBe(true);
		expect(direct.blocked).toBe(true);
		expect(direct.flags.map((f: { type: string }) => f.type)).toContain(
			"explicit",
		);

		clearDeepCache();
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("high", ["sexual-content"]),
		);
		const queued = await evaluateContentDeep(SEX3, "queued", null, {
			taskKey: "test.deep",
		});
		expect(queued.blocked).toBe(true);
		expect(queued.flags.map((f: { type: string }) => f.type)).toContain(
			"explicit",
		);
	});
});

describe("model-flagged vulgarity is held, never published", () => {
	it("holds mild profanity for review on posts", async () => {
		expect(deterministicTypes(SEX3, "queued")).not.toContain("profanity");
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("mild", ["profanity"]),
		);
		const d = await evaluateContentDeep(SEX3, "queued", null, {
			taskKey: "test.deep",
		});
		expect(d.model_used).toBe(true);
		// Held for a human — never silently published, never auto-blocked.
		expect(d.flags.length).toBeGreaterThan(0);
		expect(d.blocked || d.needsReview).toBe(true);
	});

	it("blocks mild profanity where no review queue exists (comments)", async () => {
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("mild", ["profanity"]),
		);
		const d = await evaluateContentDeep(SEX3, "direct", null, {
			taskKey: "test.deep",
		});
		expect(d.blocked).toBe(true);
	});
});

describe("sexual-harm victim reports are held, never blocked", () => {
	const REPORT =
		"a senior boy touched me inappropriately in the corridor yesterday, I want to report him";
	it("holds the report on posts without blocking", async () => {
		// Premise guard: the hold below must come from the MODEL verdict,
		// not from a deterministic pattern this test forgot about.
		const base = deterministicTypes(REPORT, "queued");
		expect(base).not.toContain("explicit");
		expect(base).not.toContain("profanity");
		expect(base).not.toContain("coercion");
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("high", ["reported-abuse"]),
		);
		const d = await evaluateContentDeep(REPORT, "queued", null, {
			taskKey: "test.deep",
		});
		expect(d.model_used).toBe(true);
		expect(d.flags.map((f: { type: string }) => f.type)).toContain(
			"threat_report",
		);
		expect(d.blocked).toBe(false);
		expect(d.needsReview).toBe(true);
	});
});

describe("outage verdicts are never cached", () => {
	it("re-asks the model instead of reusing a stalled verdict", async () => {
		const text = "the library fan is broken";
		providers.callNvidiaFast.mockResolvedValue(null);
		providers.callLLMChain.mockResolvedValue(null);
		const first = await evaluateContentDeep(text, "direct", null, {
			taskKey: "test.deep",
		});
		expect(first.model_used).toBe(false);
		expect(first.blocked).toBe(false);
		const second = await evaluateContentDeep(text, "direct", null, {
			taskKey: "test.deep",
		});
		expect(second.model_used).toBe(false);
		// A cached outage would serve the second check with ZERO new calls.
		expect(providers.callNvidiaFast).toHaveBeenCalledTimes(2);
	});
});

describe("neutral health discussion stays publishable", () => {
	it("does not flag health education", async () => {
		const text = "we need better health education in schools";
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("none", ["neutral"]),
		);
		const d = await evaluateContentDeep(text, "direct", null, {
			taskKey: "test.deep",
		});
		expect(d.blocked).toBe(false);
	});
});
