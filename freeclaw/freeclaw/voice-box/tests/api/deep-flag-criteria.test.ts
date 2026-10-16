/**
 * REGRESSION — the "AI neutral" confusion.
 *
 * Live finding: `sex sex sex sex` was correctly flagged `explicit` by the
 * model judge, but the flag message read "AI review: neutral (high)".
 * The template interpolated the model's TOP-LEVEL summary fields
 * (`result.category` = the deterministic "neutral" the merge never
 * overwrote, `result.level` = severity) instead of the criterion that
 * actually fired. A student told "neutral (high)" cannot know WHY the
 * content cannot be accepted — and "neutral" reads as safe.
 *
 * The fix: model-emitted flags carry a static, criterion-based message
 * per flag type (what rule fired, in plain school language). Static —
 * never model text — so a weird model token can never reach the UI, and
 * no new policy row is invented: the flag TYPE (what POLICY enforces)
 * is untouched, only the human sentence changes.
 *
 * Deliberately NOT word lists: no match-terms anywhere.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({
	callNvidiaFast: vi.fn(),
	callLLMChain: vi.fn(),
}));
vi.mock("../../api/_providers.js", () => providers);

import { evaluateContent, evaluateContentDeep } from "../../api/_safety-pipeline.js";
import { clearDeepCache } from "../../api/_context-moderation.js";

function flagVerdict(severity: string, categories: string[]) {
	return {
		provider: "test-model",
		model: "test-model",
		text: JSON.stringify({
			severity,
			categories,
			target: "Rahul",
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

function deterministicTypes(text: string, surface: "queued" | "direct") {
	return evaluateContent(text, surface, null).flags.map(
		(f: { type: string }) => f.type,
	);
}

function modelFlagsOf(decision: {
	flags: Array<{ type: string; message: string; source: string }>;
}) {
	return decision.flags.filter(
		(f: { source: string }) => f.source === "context-model",
	);
}

describe("model flags state the criterion, never 'neutral'", () => {
	it("sexual-content flag says WHY: sexual content, not 'neutral (high)'", async () => {
		const text = "sex sex sex";
		// Premise guard: the deterministic pass must not flag this — else
		// the message under test could come from the deterministic path.
		expect(deterministicTypes(text, "queued")).not.toContain("explicit");
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("high", ["sexual-content"]),
		);

		const decision = await evaluateContentDeep(text, "queued", null, {
			taskKey: "test.criteria",
		});
		const modelFlags = modelFlagsOf(decision);
		expect(modelFlags.length).toBeGreaterThan(0);
		expect(modelFlags.map((f) => f.type)).toContain("explicit");
		for (const f of modelFlags) {
			expect(f.message).toMatch(/sexual content/i);
			expect(f.message).not.toMatch(/neutral/i);
		}
	});

	it("indirect targeting flag names harassment, not a model-vocabulary leak", async () => {
		const text = "we all know about Rahul and the lab incident";
		expect(deterministicTypes(text, "queued")).toEqual([]);
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("high", ["targeted-harassment"]),
		);

		const decision = await evaluateContentDeep(text, "queued", null, {
			taskKey: "test.criteria",
		});
		const modelFlags = modelFlagsOf(decision);
		expect(modelFlags.map((f) => f.type)).toContain("bullying");
		for (const f of modelFlags) {
			expect(f.message).toMatch(/harassment/i);
			expect(f.message).not.toMatch(/neutral/i);
		}
	});

	it("threat flag states the criterion even when the model summary says neutral", async () => {
		const text = "someone should teach Rahul a lesson after class";
		expect(deterministicTypes(text, "queued")).not.toContain("threat");
		providers.callNvidiaFast.mockResolvedValueOnce(
			flagVerdict("high", ["threat"]),
		);

		const decision = await evaluateContentDeep(text, "queued", null, {
			taskKey: "test.criteria",
		});
		const modelFlags = modelFlagsOf(decision);
		expect(modelFlags.map((f) => f.type)).toContain("threat");
		for (const f of modelFlags) {
			expect(f.message).toMatch(/threat/i);
			expect(f.message).not.toMatch(/neutral/i);
		}
	});
});
