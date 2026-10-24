/**
 * REGRESSION — the production bug this file exists to prevent.
 *
 * A student comment reading "i will hate you <someone's name>" PUBLISHED with
 * live Reply/Edit/Delete controls. Root cause: `evaluateContent` is keyword
 * based — it has no targeted-hostility detection at all, so the comment
 * resolved to ALLOW and the UI then printed "Content looks good — no issues
 * detected".
 *
 * The contextual classifier (`api/_context-classify.js`) already understood the
 * message and resolved the TARGET by name — it was simply never called from
 * the moderation path. `evaluateContentAsync` is that wiring.
 *
 * This file pins three things:
 *   1. The reported bypass is closed, end to end.
 *   2. The fix does NOT over-block the near-identical harmless sentences.
 *   3. The contextual layer can only tighten a verdict, never loosen it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({ decision: null as unknown }));
// Mock the CONTEXTUAL LAYER, not the classifier: this file verifies the
// policy merge inside `evaluateContentAsync`. The classifier's own mapping is
// covered by `context-moderation-mapping.test.ts`.
vi.mock("../../api/_context-moderation.js", async () => {
	const actual = await vi.importActual<
		typeof import("../../api/_context-moderation.js")
	>("../../api/_context-moderation.js");
	return {
		...actual,
		contextualModeration: vi.fn(async () => {
			const d = ctx.decision as
				| { category?: string; decision?: { reported_or_quoted?: boolean } }
				| null;
			if (!d) return { flags: [], context: null };
			const reported =
				d.decision?.reported_or_quoted === true || d.category === "reported-abuse";
			const flag =
				d.category === "normal"
					? null
					: reported
						? "threat_report"
						: d.category === "threat"
							? "threat"
							: "bullying";
			if (!flag) return { flags: [], context: d };
			return {
				flags: [
					{
						type: flag,
						severity: flag === "threat_report" ? "high" : "critical",
						message: "Contextual analysis",
						source: "context-classify",
					},
				],
				context: d,
			};
		}),
	};
});

import { evaluateContent, evaluateContentAsync } from "../../api/_safety-pipeline.js";

/** Minimal shaped decision, matching what classifyContextual returns. */
function ctxDecision(
	level: string,
	category: string,
	target: string | null,
	reported = false,
) {
	return {
		level,
		emotion: "anger",
		agent: "emotional",
		category,
		confidence: 0.8,
		decision: {
			classification: category,
			confidence: 0.8,
			categories: [category],
			severity: level,
			emotion: "anger",
			target: target ? { kind: "name", value: target } : null,
			explanation_summary: "test",
			recommended_action: "review",
			evidence: ["test"],
			policy_version: "context-v1",
			model_used: false,
			model_agent: null,
			reported_or_quoted: reported,
			language: "latin",
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	ctx.decision = ctxDecision("high", "targeted-harassment", "Dhansiri");
});

describe("REGRESSION: the reported comment no longer publishes", () => {
	it("blocks a named target declaring future hostility", async () => {
		const text = "*\ndhansiri i will hate you\n25/120";
		// Before the fix this resolved to ALLOW. That is the regression.
		expect(evaluateContent(text, "direct", null).blocked).toBe(false);

		const d = await evaluateContentAsync(text, "direct");
		expect(d.blocked || d.needsReview).toBe(true);
		expect(d.flags.map((f: { type: string }) => f.type)).toContain("bullying");
	});
});

describe("contextual layer catches what keywords cannot", () => {
	const HOSTILE: Array<[string, string, string | null]> = [
		["Rahul, I hate you.", "targeted-harassment", "Rahul"],
		["so yes, I hate you.", "targeted-harassment", null],
		["R@hul I h4te you", "targeted-harassment", "Rahul"],
		["Rahul you're dead 💀", "threat", "Rahul"],
		["you're finished", "threat", null],
		["don't come to school tomorrow", "threat", null],
	];

	it.each(HOSTILE)("holds %j for review", async (text, category, target) => {
		ctx.decision = ctxDecision(
			category === "threat" ? "high" : "high",
			category,
			target,
		);
		const d = await evaluateContentAsync(text, "direct");
		expect(d.blocked || d.needsReview).toBe(true);
		expect(d.flags.length).toBeGreaterThan(0);
	});
});

describe("does NOT over-block the near-identical harmless sentences", () => {
	it.each([
		["I hate this homework.", "normal"],
		["Rahul helped me with maths.", "normal"],
		["the canteen food is bad", "normal"],
	])("leaves %j publishable", async (text, category) => {
		ctx.decision = ctxDecision("none", category, null);
		const d = await evaluateContentAsync(text, "direct");
		expect(d.blocked).toBe(false);
	});
});

describe("a report of abuse is held, never mislabelled as an attack", () => {
	it("routes quoted abuse to threat_report, not violence", async () => {
		ctx.decision = ctxDecision("high", "targeted-harassment", null, true);
		const d = await evaluateContentAsync("Rahul said 'I hate you' yesterday.", "queued");
		const types = d.flags.map((f: { type: string }) => f.type);
		// The decisive property: a victim reporting abuse must never be
		// classified as VIOLENCE (i.e. as the perpetrator).
		expect(types).toContain("threat_report");
		expect(types).not.toContain("violence");
		expect(types).not.toContain("bullying");
		// On a surface with a human review queue it is HELD, never published.
		expect(d.blocked).toBe(false);
		expect(d.needsReview).toBe(true);
	});

	it("blocks the report on a surface with no review queue (comments)", async () => {
		ctx.decision = ctxDecision("high", "targeted-harassment", null, true);
		const d = await evaluateContentAsync("Rahul said 'I hate you' yesterday.", "direct");
		// Existing POLICY row: threat-review is BLOCK on direct, QUARANTINE on
		// queued. The important property is WHICH flag fired, not the mode.
		const types = d.flags.map((f: { type: string }) => f.type);
		expect(types).toEqual(["threat_report"]);
		expect(d.policy).toBe("threat-review");
	});
});

describe("the contextual layer can only tighten, never loosen", () => {
	it("keeps the deterministic block even if context reports neutral", async () => {
		ctx.decision = ctxDecision("none", "normal", null);
		const d = await evaluateContentAsync("go kill yourself", "direct");
		expect(d.blocked).toBe(true);
		expect(d.flags.map((f: { type: string }) => f.type)).toContain("violence");
	});

	it("still blocks PII when the context layer says everything is fine", async () => {
		ctx.decision = ctxDecision("none", "normal", null);
		const d = await evaluateContentAsync(
			"email me at john.doe@example.com",
			"direct",
		);
		expect(d.blocked).toBe(true);
	});
});

describe("a contextual failure degrades to the deterministic floor", () => {
	it("still blocks profanity when the classifier returns nothing", async () => {
		ctx.decision = null;
		const d = await evaluateContentAsync("this canteen food sucks", "direct");
		expect(d.blocked).toBe(true);
	});

	it("never converts a provider failure into 'clean'", async () => {
		ctx.decision = null;
		const d = await evaluateContentAsync("the library fan is broken", "direct");
		// Deterministic verdict only — no invented flags, no crash.
		expect(Array.isArray(d.flags)).toBe(true);
		expect(d.blocked).toBe(false);
	});
});
