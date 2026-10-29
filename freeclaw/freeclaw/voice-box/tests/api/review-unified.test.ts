// ═══════════════════════════════════════════════════════════════════
// UNIFIED REVIEW — one verdict for the content gate and the AI analysis
// ═══════════════════════════════════════════════════════════════════
// The reported bug: the live "content review" blocked a draft while the
// "AI review — safe to publish" panel called the SAME draft safe, because
// the two ran different pipelines. `unifiedReview` merges them so the
// stricter answer wins, and both endpoints (`/api/pre-publish` and
// `/api/moderate?fullReview`) return that same object.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Supabase: thenable no-result chain (no DB required) ────────────
const { supabaseMock } = vi.hoisted(() => {
	const chain: any = {
		select: () => chain,
		eq: () => chain,
		gte: () => chain,
		lte: () => chain,
		ilike: () => chain,
		limit: () => chain,
		order: () => chain,
		insert: () => chain,
		maybeSingle: async () => ({ data: null, error: null }),
		then(resolve: (v: unknown) => void) {
			resolve({ data: null, error: null, count: 0 });
		},
	};
	return { supabaseMock: { from: vi.fn(() => chain) } };
});
vi.mock("../../api/_db-client.js", () => ({ default: supabaseMock }));

// ─── Model: always answers "safe" ──────────────────────────────────
// This is the exact disagreement under test: the AI says the draft is
// clean while the deterministic gate blocks it.
const SAFE_AI = {
	risk_score: 0,
	personal_info_detected: false,
	threats_detected: false,
	bullying_detected: false,
	hate_speech_detected: false,
	doxxing_detected: false,
	blackmail_detected: false,
	explicit_detected: false,
	self_harm_detected: false,
	spam_detected: false,
	privacy_issues: [],
	safety_issues: [],
	spam_issues: [],
	quality_issues: [],
	summary: "Clean submission",
	suggested_category: "Facilities",
	suggested_priority: "low",
	decision: "safe",
	reason: "Content passed all checks",
};

const SPAM_AI = {
	...SAFE_AI,
	risk_score: 45,
	spam_detected: true,
	spam_issues: ["Promotional link"],
	decision: "revision",
	reason: "Looks like promotion",
};

const { aiReply } = vi.hoisted(() => ({ aiReply: { value: "" } }));
vi.mock("../../api/_providers.js", () => ({
	callNvidiaFast: vi.fn(async () => ({ provider: "test", model: "test", text: aiReply.value })),
	callLLMChain: vi.fn(async () => ({ ok: false, degraded: true })),
	callPublicFrontierLLM: vi.fn(async () => null),
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (v: unknown) => String(v ?? "").trim(),
	rateLimited: vi.fn(async () => false),
	rateLimitResponse: vi.fn(),
	auditLog: vi.fn(async () => {}),
	isAdmin: vi.fn(async () => false),
}));

let unifiedReview: (opts: Record<string, unknown>) => Promise<any>;
let toClientReview: (r: any) => any;
let moderate: (req: any, res: any) => Promise<void>;

function res() {
	const r: any = { statusCode: 200, body: null };
	r.status = (c: number) => {
		r.statusCode = c;
		return r;
	};
	r.json = (b: unknown) => {
		r.body = b;
		return r;
	};
	r.setHeader = vi.fn();
	r.end = vi.fn();
	return r;
}

beforeEach(async () => {
	vi.resetModules();
	aiReply.value = JSON.stringify(SAFE_AI);
	const mod = await import("../../api/_pre-publish.js");
	unifiedReview = mod.unifiedReview;
	toClientReview = mod.toClientReview;
	moderate = (await import("../../api/_moderate.js")).default;
});

describe("unifiedReview — the stricter pass wins", () => {
	it("does NOT let a 'safe' AI verdict override the content gate", async () => {
		const result = await unifiedReview({
			text: "fuck this homework",
			surface: "direct",
			contentType: "post",
		});
		// The gate blocks profanity outright on a review-less surface.
		expect(result.gate.blocked).toBe(true);
		expect(result.decision).toBe("high_risk");
		expect(result.riskScore).toBeGreaterThanOrEqual(70);
		// And the flag reaches the merged checks, not just the gate object.
		// Profanity is a conduct/quality finding, so it lands in `quality`.
		expect(result.checks.quality.pass).toBe(false);
		expect(result.checks.quality.issues.length).toBeGreaterThan(0);
	});

	it("lets the analysis raise the verdict for a gate-clean draft", async () => {
		aiReply.value = JSON.stringify(SPAM_AI);
		const result = await unifiedReview({
			text: "the library wifi is slow in the afternoon",
			surface: "queued",
			contentType: "post",
		});
		expect(result.gate.blocked).toBe(false);
		expect(result.decision).toBe("revision");
		expect(result.checks.spam.pass).toBe(false);
		expect(result.checks.spam.issues).toContain("Promotional link");
	});

	it("returns safe only when both passes agree the draft is clean", async () => {
		const result = await unifiedReview({
			text: "the water fountain on the second floor is broken",
			surface: "queued",
			contentType: "post",
		});
		expect(result.gate.blocked).toBe(false);
		expect(result.decision).toBe("safe");
		expect(result.riskScore).toBeLessThan(30);
		for (const key of ["privacy", "safety", "spam", "quality"]) {
			expect(result.checks[key]?.pass).toBe(true);
		}
		expect(result.llmAnalyzed).toBe(true);
	});

	it("exposes one client shape with the merged decision and gate code", async () => {
		const merged = toClientReview(
			await unifiedReview({ text: "fuck this homework", surface: "direct" }),
		);
		expect(merged.decision).toBe("high_risk");
		expect(merged.blocked).toBe(true);
		expect(typeof merged.risk_score).toBe("number");
		expect(merged.checks.quality.pass).toBe(false);
		expect(merged.analysis).toBeTruthy();
	});
});

describe("/api/moderate?fullReview — the live preview is the same verdict", () => {
	it("returns the merged review alongside the gate flags", async () => {
		const r = res();
		await moderate(
			{
				method: "POST",
				headers: {},
				body: { text: "fuck this homework", surface: "direct", aiJudge: true, fullReview: true },
			},
			r,
		);
		expect(r.statusCode).toBe(200);
		expect(r.body.serverBlocked).toBe(true);
		expect(r.body.review).toBeTruthy();
		expect(r.body.review.decision).toBe("high_risk");
		expect(r.body.review.blocked).toBe(true);
		expect(Array.isArray(r.body.flags)).toBe(true);
		expect(r.body.flags.length).toBeGreaterThan(0);
		// The panel and the publish gate describe ONE review.
		expect(r.body.aiChecked).toBe(true);
	});

	it("omits the review on a plain fast check (no model round trip)", async () => {
		const r = res();
		await moderate(
			{ method: "POST", headers: {}, body: { text: "the wifi is slow", surface: "queued" } },
			r,
		);
		expect(r.statusCode).toBe(200);
		expect(r.body.review).toBeNull();
	});
});
