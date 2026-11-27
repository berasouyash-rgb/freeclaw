// Contextual risk scoring — VEILED / IMPLIED INTIMIDATION.
//
// Reported case: a post that never states a threat ("Enjoy It While It Lasts" /
// "You seem pretty comfortable with the way things are right now. I wonder if
// you'll feel the same way a little later.") scored 0/100 and published with no
// review at all. That is wrong in the dangerous direction, but calling it a
// threat is wrong in the other direction: the wording MAY imply intimidation
// and does NOT establish one on its own. The correct outcome is a human review
// with the surrounding thread in view.
//
// Contract under test:
//   1. The reported case is NOT safe and NOT high_risk — it lands "revision"
//      with risk_score 40 and threats_detected === false.
//   2. Ordinary venting / a single weak marker stays safe (no false positives).
//   3. Quoting or describing someone else's words stays safe.
//   4. The signal is deterministic, so it holds on the LLM-down path too.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
	const queryChain: any = {
		select: () => queryChain,
		eq: () => queryChain,
		gte: () => queryChain,
		lte: () => queryChain,
		limit: () => queryChain,
		order: () => queryChain,
		insert: () => queryChain,
		maybeSingle: async () => ({ data: null, error: null }),
		then(resolve: (v: unknown) => void) {
			resolve({ data: null, error: null, count: 0 });
		},
	};
	const supabaseMock = { from: vi.fn(() => queryChain) };
	return { supabaseMock };
});

vi.mock("../../api/_db-client.js", () => ({ default: supabaseMock }));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

function makeRes() {
	const res: any = {
		status: vi.fn(() => res),
		json: vi.fn(() => res),
		end: vi.fn(() => res),
		setHeader: vi.fn(() => res),
	};
	return res;
}

let handler: (req: any, res: any) => Promise<void>;
let detectVeiledIntimidation: (text: string) => { flagged: boolean; hits: number };
let VEILED_INTIMIDATION_ISSUE: string;
let authorSeq = 0;

async function runEmergency(body: Record<string, unknown>) {
	mockFetch.mockReset();
	mockFetch.mockRejectedValue(new Error("nvidia down"));
	const res = makeRes();
	await handler(
		{
			method: "POST",
			query: {},
			headers: {},
			body: {
				content_type: "post",
				author_id: `anon-veiled-${authorSeq++}`,
				...body,
			},
		},
		res,
	);
	expect(res.json).toHaveBeenCalled();
	return res.json.mock.calls[0][0] as {
		decision: string;
		risk_score: number;
		analysis: { priority: string; llm_analyzed: boolean };
		checks: { safety: { pass: boolean; issues: string[] } };
	};
}

const REPORTED_CASE =
	"You seem pretty comfortable with the way things are right now. I wonder if you'll feel the same way a little later.";

beforeAll(async () => {
	vi.resetModules();
	process.env.NVIDIA_API_KEY = "test-key";
	const mod = await import("../../api/_pre-publish.js");
	handler = mod.default;
	detectVeiledIntimidation = mod.detectVeiledIntimidation;
	VEILED_INTIMIDATION_ISSUE = mod.VEILED_INTIMIDATION_ISSUE;
});

afterAll(() => {
	delete process.env.NVIDIA_API_KEY;
});

beforeEach(() => {
	mockFetch.mockReset();
});

describe("veiled intimidation — deterministic probe", () => {
	it("flags the reported case (strong marker + stacked weak markers)", () => {
		const result = detectVeiledIntimidation(`Enjoy It While It Lasts\n${REPORTED_CASE}`);
		expect(result.flagged).toBe(true);
		expect(result.hits).toBeGreaterThanOrEqual(2);
	});

	it("flags a single strong marker", () => {
		expect(detectVeiledIntimidation("enjoy it while it lasts").flagged).toBe(true);
		expect(detectVeiledIntimidation("sooner than you think").flagged).toBe(true);
	});

	it("does NOT flag ordinary venting", () => {
		for (const text of [
			"The canteen food is terrible and disgusting",
			"Bruh, the wifi sucks and the bus is always late",
			"we'll see how the match goes tomorrow",
			"I wonder if you'll like the new canteen menu",
			"The test was mid and the teacher is lowkey scary",
			"Things will change next term when the new principal arrives",
		]) {
			expect(detectVeiledIntimidation(text).flagged, text).toBe(false);
		}
	});

	it("does NOT flag someone quoting or reporting another person", () => {
		expect(
			detectVeiledIntimidation(
				"He said to enjoy it while it lasts and that I'd feel the same way a little later.",
			).flagged,
		).toBe(false);
		expect(
			detectVeiledIntimidation(
				"She told me we'll see what happens and to wait and see who laughs.",
			).flagged,
		).toBe(false);
	});
});

describe("veiled intimidation — publish decision (LLM down)", () => {
	it("holds the reported case for review: revision @ 40, never high_risk, never safe", async () => {
		const payload = await runEmergency({
			title: "Enjoy It While It Lasts",
			description: REPORTED_CASE,
		});
		expect(payload.decision).toBe("revision");
		expect(payload.risk_score).toBe(40);
		// Held for a human, never hard-blocked and never called a threat.
		expect(payload.decision).not.toBe("high_risk");
		expect(payload.analysis.priority).toBe("high");
		expect(payload.checks.safety.pass).toBe(false);
		expect(payload.checks.safety.issues).toContain(VEILED_INTIMIDATION_ISSUE);
		// The label must not trip the severe-category matcher that forces
		// high_risk, otherwise the "may imply" nuance is lost.
		expect(VEILED_INTIMIDATION_ISSUE).not.toMatch(/THREAT|HATE|BLACKMAIL|SELF-HARM/);
	});

	it("keeps ordinary venting safe with risk 0", async () => {
		const payload = await runEmergency({
			title: "Canteen complaint",
			description: "The canteen food is terrible and the queues are always long.",
		});
		expect(payload.decision).toBe("safe");
		expect(payload.risk_score).toBe(0);
		expect(payload.checks.safety.issues).not.toContain(VEILED_INTIMIDATION_ISSUE);
	});
});
