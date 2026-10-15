/**
 * REGRESSION — the pre-publish "fake green".
 *
 * `/api/moderate` (the live preview behind the Submit page) ran the
 * DETERMINISTIC scan only (`evaluateContentAsync`, no model), while the
 * publish path (`_posts.js`) runs the full scan WITH a model judge
 * (`evaluateContentDeep`). Given `sex sex sex sex`, preview answered
 * `200 safe:true flags:[]` and the page painted green — then publish
 * flagged it. The author was congratulated on text the write path
 * rejects.
 *
 * The fix: the preview accepts `aiJudge:true` and runs the same deep
 * evaluation the write path runs (bounded: 8s, preview task key), and
 * reports whether the model actually judged the text:
 * - `aiChecked:true` ONLY when the response carries a real model verdict
 *   (`decision.model_used === true`).
 * - `aiChecked:false` + `aiTimedOut:true` when the model timed out and
 *   the deterministic verdict stands.
 * - `aiChecked:false` on the default deterministic path: the model was
 *   not consulted, so the client must never paint the "AI reviewed" green.
 *
 * No word lists. The model verdict comes from the same pipeline (and the
 * same policy table) the write path enforces.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
	rateLimited: vi.fn(async () => false),
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	rateLimited: authMocks.rateLimited,
	rateLimitResponse: vi.fn(
		(res: { status: (c: number) => { json: (b: unknown) => unknown } }) =>
			res.status(429).json({ error: "rate limited" }),
	),
}));

const pipelineMocks = vi.hoisted(() => ({
	evaluateContentDeep: vi.fn(),
}));
vi.mock("../../api/_safety-pipeline.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../api/_safety-pipeline.js")>();
	return { ...actual, evaluateContentDeep: pipelineMocks.evaluateContentDeep };
});

import handler from "../../api/_moderate.js";

/** Minimal Vercel-style req/res pair; resolves with the parsed body. */
function call(
	text: string,
	opts: { surface?: string; aiJudge?: boolean } = {},
) {
	return new Promise<{ status: number; body: Record<string, unknown> }>(
		(resolve) => {
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
				{
					method: "POST",
					headers: { "x-forwarded-for": "203.0.113.9" },
					body: { text, surface: opts.surface, aiJudge: opts.aiJudge },
				},
				res as never,
			);
		},
	);
}

const categories = (b: Record<string, unknown>) =>
	((b.flags as Array<{ category: string }>) || []).map((f) => f.category);

beforeEach(() => {
	authMocks.rateLimited.mockClear();
	pipelineMocks.evaluateContentDeep.mockReset();
});

describe("aiJudge preview runs the write-path model verdict", () => {
	it("flags 'sex sex sex sex' with aiChecked:true when the model judges it", async () => {
		pipelineMocks.evaluateContentDeep.mockResolvedValue({
			action: "BLOCK_ACTION",
			blocked: true,
			needsReview: true,
			flags: [
				{
					type: "explicit",
					severity: "critical",
					message: "Sexual content is not allowed.",
					source: "llm-judge",
				},
			],
			code: "explicit_blocked",
			model_used: true,
			timedOut: false,
			trace: ["model:sexual-content (high)"],
			policy: "critical-harm",
			classification: "explicit",
		});

		const { body } = await call("sex sex sex sex", { aiJudge: true });

		expect(pipelineMocks.evaluateContentDeep).toHaveBeenCalledWith(
			"sex sex sex sex",
			"queued",
			null,
			{ timeoutMs: 8000, taskKey: "moderation.preview" },
		);
		expect(body.checked).toBe(true);
		expect(body.aiChecked).toBe(true);
		expect(body.aiTimedOut).toBe(false);
		expect(body.serverBlocked).toBe(true);
		expect(categories(body)).toContain("sexual");
	});

	it("reports aiChecked:false + aiTimedOut:true when the model times out", async () => {
		pipelineMocks.evaluateContentDeep.mockResolvedValue({
			action: "ALLOW_ACTION",
			blocked: false,
			needsReview: false,
			flags: [],
			code: "clean",
			model_used: false,
			timedOut: true,
			trace: ["model:timeout"],
		});

		const { body } = await call("the library closes too early", {
			aiJudge: true,
		});

		expect(body.checked).toBe(true);
		expect(body.aiChecked).toBe(false);
		expect(body.aiTimedOut).toBe(true);
		expect(body.safe).toBe(true);
	});

	it("never reports a crashed model call as a pass", async () => {
		pipelineMocks.evaluateContentDeep.mockRejectedValueOnce(
			new Error("provider down"),
		);

		const { body } = await call("the library closes too early", {
			aiJudge: true,
		});

		expect(body.checked).toBe(false);
		expect(body.aiChecked).toBe(false);
		expect(body.aiTimedOut).toBe(false);
	});
});

describe("default preview path stays deterministic and says so", () => {
	it("reports aiChecked:false and never calls the model", async () => {
		const { body } = await call("the library closes too early");

		expect(body.checked).toBe(true);
		expect(body.aiChecked).toBe(false);
		expect(body.aiTimedOut).toBe(false);
		expect(pipelineMocks.evaluateContentDeep).not.toHaveBeenCalled();
	});

	it("rate-limits model previews in their own bucket", async () => {
		pipelineMocks.evaluateContentDeep.mockResolvedValue({
			action: "ALLOW_ACTION",
			blocked: false,
			needsReview: false,
			flags: [],
			code: "clean",
			model_used: true,
			timedOut: false,
		});

		await call("the library closes too early", { aiJudge: true });

		// 60/min: tighter than the free deterministic pass (120/min), but
		// above the ~50/min ceiling of the client's 1200ms settle, so a
		// careful typer never trips it while a looped client cannot burn
		// unbounded provider calls.
		expect(authMocks.rateLimited).toHaveBeenCalledWith(
			"moderation_preview_ai",
			"203.0.113.9",
			60,
			60,
		);
	});

	it("does not consult the model for text too short to judge", async () => {
		const { body } = await call("ab", { aiJudge: true });

		expect(body.aiChecked).toBe(false);
		expect(body.aiTimedOut).toBe(false);
		expect(pipelineMocks.evaluateContentDeep).not.toHaveBeenCalled();
	});
});
