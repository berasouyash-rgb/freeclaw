/**
 * REGRESSION — moderation must UNDERSTAND, not just match lists.
 *
 * `evaluateContent` (keyword/PII-regex gates) plus the deterministic
 * contextual scan cannot see meaning that has no listed token:
 *   - "dm me on insta at cool dot rahul dot 12" (PII with no @, no digits)
 *   - politely-worded threats, unnamed targets, grooming patterns
 *
 * `evaluateContentDeep` adds a bounded real-model judgment that can only
 * ADD flags. This file pins, with mocked providers (no network):
 *   1. The model catches contextual PII the deterministic pass misses.
 *   2. The model is SKIPPED when deterministic already blocks (cost/latency).
 *   3. Timeout/outage/malformed output fall back to deterministic — and say so.
 *   4. Weak model signals quarantine on queued surfaces, not block.
 *   5. Repeat checks reuse the verdict instead of paying twice.
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

beforeEach(() => {
	// resetAllMocks (not clearAllMocks): the Once-queues must be drained too,
	// or a mockResolvedValueOnce from one test fires inside the next test.
	vi.resetAllMocks();
	clearDeepCache();
	providers.callNvidiaFast.mockResolvedValue(null);
	providers.callLLMChain.mockResolvedValue(null);
});

describe("model catches what no list contains", () => {
	it("blocks contextual PII the deterministic pass misses", async () => {
		const text = "dm me on insta at cool dot rahul dot 12, I reply fast";
		// Premise guard: if deterministic ever catches this, the test name lies.
		const baseTypes = evaluateContent(text, "direct", null).flags.map((f) => f.type);
		expect(baseTypes).not.toContain("privacy");
		expect(baseTypes).not.toContain("privacy_weak");

		providers.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "test-model",
			text: modelText({
				severity: "high",
				categories: ["privacy"],
				target: null,
				confidence: 0.9,
				explanation: "contains a social handle inviting contact",
			}),
		});
		const d = await evaluateContentDeep(text, "direct", null, {
			taskKey: "test.deep",
		});
		expect(d.model_used).toBe(true);
		expect(d.blocked).toBe(true);
		expect(d.flags.map((f) => f.type)).toContain("privacy");
		expect(d.code).toBe("PII_BLOCKED");
	});
});

describe("cost control: the model is skipped when already blocked", () => {
	it("never calls a provider for deterministically-blocked text", async () => {
		const d = await evaluateContentDeep(
			"this canteen food is fucking disgusting, you morons",
			"direct",
			null,
			{ taskKey: "test.deep" },
		);
		expect(d.blocked).toBe(true);
		expect(d.model_used).toBe(false);
		expect(d.model_skipped).toBe("already-blocked");
		expect(providers.callNvidiaFast).not.toHaveBeenCalled();
		expect(providers.callLLMChain).not.toHaveBeenCalled();
	});
});

describe("failure honesty: timeouts, outages, garbage", () => {
	it("falls back to deterministic on provider timeout and says so", async () => {
		providers.callNvidiaFast.mockImplementationOnce(() => new Promise(() => {}));
		providers.callLLMChain.mockImplementationOnce(() => new Promise(() => {}));
		const text = "we need more bins in the cafeteria";
		const d = await evaluateContentDeep(text, "direct", null, {
			timeoutMs: 150,
			taskKey: "test.deep",
		});
		expect(d.model_used).toBe(false);
		expect(d.timedOut).toBe(true);
		// Deterministic verdict stands: clean text stays clean.
		expect(d.blocked).toBe(false);
		expect(d.flags).toEqual([]);
	});

	it("ignores unparsable model output", async () => {
		providers.callNvidiaFast.mockResolvedValueOnce({
			provider: "nvidia-fast",
			model: "test-model",
			text: "hello world, no json here",
		});
		const d = await evaluateContentDeep("the library closes too early", "direct", null, {
			taskKey: "test.deep",
		});
		expect(d.model_used).toBe(false);
		expect(d.blocked).toBe(false);
	});

	it("treats total provider outage as no-signal, not as clean-by-AI", async () => {
		const d = await evaluateContentDeep("the library closes too early", "direct", null, {
			taskKey: "test.deep",
		});
		expect(d.model_used).toBe(false);
		expect(d.blocked).toBe(false);
	});
});

describe("weak model signals route to review, not auto-block, on queued surfaces", () => {
	it("quarantines mild privacy on posts while blocking it on comments", async () => {
		const text = "rahul sharma from class 8b says the lab stays closed";
		// Premise guard: the privacy_weak flag below must come from the
		// model, not from a deterministic pattern this test forgot about.
		const baseTypes = evaluateContent(text, "queued", null).flags.map((f) => f.type);
		expect(baseTypes).not.toContain("privacy");
		expect(baseTypes).not.toContain("privacy_weak");
		providers.callNvidiaFast.mockResolvedValue({
			provider: "nvidia-fast",
			model: "test-model",
			text: modelText({
				severity: "moderate",
				categories: ["privacy"],
				target: "Rahul Sharma",
				confidence: 0.7,
				explanation: "name plus school class may identify a student",
			}),
		});
		const queued = await evaluateContentDeep(text, "queued", null, { taskKey: "test.deep" });
		expect(queued.flags.map((f) => f.type)).toContain("privacy_weak");
		expect(queued.blocked).toBe(false);
		expect(queued.action).toBe("QUARANTINE");

		clearDeepCache();
		const direct = await evaluateContentDeep(text, "direct", null, { taskKey: "test.deep" });
		expect(direct.flags.map((f) => f.type)).toContain("privacy_weak");
		expect(direct.blocked).toBe(true);
	});
});

describe("repeat checks reuse the verdict", () => {
	it("calls the provider once for identical text", async () => {
		// A flag-producing verdict: only then does evaluateContentDeep
		// report model_used:true, and only a cached reuse keeps the
		// provider count at one across two evaluations.
		providers.callNvidiaFast.mockResolvedValue({
			provider: "nvidia-fast",
			model: "test-model",
			text: modelText({
				severity: "moderate",
				categories: ["privacy"],
				target: null,
				confidence: 0.8,
				explanation: "name plus school class may identify a student",
			}),
		});
		const text = "arjun mehta from class 9c says the gym stays closed";
		const first = await evaluateContentDeep(text, "direct", null, { taskKey: "test.deep" });
		const second = await evaluateContentDeep(text, "direct", null, { taskKey: "test.deep" });
		expect(first.model_used).toBe(true);
		expect(second.model_used).toBe(true);
		expect(first.flags.map((f) => f.type)).toContain("privacy_weak");
		expect(second.flags.map((f) => f.type)).toContain("privacy_weak");
		expect(providers.callNvidiaFast).toHaveBeenCalledTimes(1);
	});
});
