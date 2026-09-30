/**
 * REGRESSION — the false "Content looks good — no issues detected" claim.
 *
 * The Submit page ran a CLIENT-SIDE word list (PROFANITY_WORDS +
 * SLANG_WORDS) and, on an empty result, told the student their content was
 * clean. Given:
 *
 *   * dhansiri i will hate you
 *   * 25/120
 *
 * that list contains nothing, so the page rendered a green "no issues
 * detected" on a targeted threat. A name is not a word-list entry, so only a
 * CONTEXTUAL engine can separate this from "I hate this exam".
 *
 * `api/_moderate.js` is the wiring: it runs the deterministic contextual scan
 * (`useModel:false`, no provider call) and returns the authoritative verdict.
 *
 * This file pins:
 *   1. The reported text is now caught.
 *   2. Near-identical harmless sentences are NOT caught.
 *   3. A FAILED check is never reported as a pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	// Never rate-limit in tests; the limiter is exercised elsewhere.
	rateLimited: vi.fn(async () => false),
	rateLimitResponse: vi.fn((res: { status: (c: number) => { json: (b: unknown) => unknown } }) =>
		res.status(429).json({ error: "rate limited" }),
	),
}));

import handler from "../../api/_moderate.js";

/** Minimal Vercel-style req/res pair; resolves with the parsed body. */
function call(text: string, method = "POST", surface?: string) {
	return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
		const res = {
			statusCode: 200,
			body: undefined as unknown,
			headers: {} as Record<string, string>,
			setHeader(k: string, v: string) {
				this.headers[k] = v;
			},
			getHeader(k: string) {
				return this.headers[k];
			},
			end() {
				resolve({ status: res.statusCode, body: res.body });
			},
			status(c: number) {
				res.statusCode = c;
				return this;
			},
			json(b: unknown) {
				res.body = b;
				resolve({ status: res.statusCode, body: b });
				return this;
			},
		};
		handler(
			{ method, headers: { "x-forwarded-for": "203.0.113.9" }, body: { text, surface } },
			res as never,
		);
	});
}

const types = (b: Record<string, unknown>) =>
	((b.flags as Array<{ category: string }>) || []).map((f) => f.category);

describe("REGRESSION: the reported submission is no longer called clean", () => {
	it("flags 'dhansiri i will hate you' instead of reporting no issues", async () => {
		const { body } = await call("*\ndhansiri i will hate you\n25/120");

		// Before this fix the client word list returned ZERO flags and the UI
		// printed "Content looks good - no issues detected". That is the bug.
		expect(body.checked).toBe(true);
		expect(body.serverBlocked).toBe(true);
		expect(types(body)).toContain("bullying");
	});
});

describe("contextual layer catches what a word list cannot", () => {
	it.each([
		["Rahul, I hate you.", "bullying"],
		["R@hul I h4te you", "bullying"],
		["Dhansiri, I will hate you", "bullying"],
		["Rahul you're dead", "threat"],
		["don't come to school tomorrow", "threat"],
		["you are finished", "threat"],
	])("blocks %j as %s", async (text, expected) => {
		const { body } = await call(text);
		expect(body.serverBlocked).toBe(true);
		expect(types(body)).toContain(expected);
	});
});

describe("does NOT over-block the near-identical harmless sentences", () => {
	it.each([
		["I hate this homework."],
		["I hate this exam so much"],
		["Rahul helped me with maths."],
		["the canteen food is bad"],
		["we need more bins in the cafeteria"],
		["the library closes too early"],
		// A reporting VERB is not a report of abuse. Any neutral sentence
		// containing said/says/told used to be flagged `threat_report`, which
		// held or blocked ordinary feedback. See the reported-gating fix in
		// `_context-classify.js`.
		["the notice says the lab closes at 4"],
		["the teacher told us the exam moved to friday"],
	])("leaves %j publishable", async (text) => {
		const { body } = await call(text);
		expect(body.serverBlocked).toBe(false);
		expect(body.flags).toEqual([]);
		expect(body.overallSeverity).toBe("none");
	});
});

describe("a report of abuse is held, not mislabelled as an attack", () => {
	it("routes quoted abuse to threat, never to violence", async () => {
		const { body } = await call("Rahul said 'I hate you' yesterday.");
		const t = types(body);
		expect(t).toContain("threat");
		expect(t).not.toContain("violence");
		// Queued surface (posts) holds for review rather than auto-blocking.
		expect(body.serverBlocked).toBe(false);
	});
});

describe("PII is still caught by the deterministic floor", () => {
	it("blocks a posted email address", async () => {
		const { body } = await call("email me at john.doe@example.com");
		expect(body.serverBlocked).toBe(true);
	});
});

describe("the preview uses the caller's write-path surface", () => {
	// REGRESSION: the endpoint hardcoded "queued", so a poll (direct surface:
	// review-grade flags block outright) previewed as publishable while the
	// server 403'd it on submit. The UI said fine; the write said no.
	it("holds weak PII for review on queued, blocks it on direct", async () => {
		const text = "my pin is 123456 call me";
		const queued = await call(text, "POST", "queued");
		expect(types(queued.body)).toContain("privacy");
		expect(queued.body.serverBlocked).toBe(false);
		expect(queued.body.surface).toBe("queued");

		const direct = await call(text, "POST", "direct");
		expect(types(direct.body)).toContain("privacy");
		expect(direct.body.serverBlocked).toBe(true);
		expect(direct.body.surface).toBe("direct");
	});

	it("defaults an unknown surface to queued, never to a third behavior", async () => {
		const { body } = await call("the canteen food is bad", "POST", "nonsense");
		expect(body.surface).toBe("queued");
		expect(body.serverBlocked).toBe(false);
	});
});

describe("a FAILED check is never reported as a pass", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("returns checked:false rather than a clean verdict when the pipeline throws", async () => {
		const pipeline = await import("../../api/_safety-pipeline.js");
		const spy = vi
			.spyOn(pipeline, "evaluateContentAsync")
			.mockRejectedValueOnce(new Error("provider exploded"));

		const { body } = await call("a perfectly ordinary school complaint");
		spy.mockRestore();

		// The whole point: a broken check must not read as "no issues".
		expect(body.checked).toBe(false);
		expect(body.safe).toBe(false);
	});
});

describe("input handling", () => {
	it("rejects non-POST", async () => {
		const { status, body } = await call("x", "GET");
		expect(status).toBe(405);
		expect(body.error).toBe("Method not allowed");
	});

	it("short-circuits on trivially short text", async () => {
		const { body } = await call("a");
		expect(body.checked).toBe(true);
		expect(body.flags).toEqual([]);
	});
});
