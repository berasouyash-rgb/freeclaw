// ═══════════════════════════════════════════════════════════════════
// AI narrate task — Gamma-style presenter notes from the live deck spec
// ═══════════════════════════════════════════════════════════════════
// Contract:
//   1. Admin-only (403 before any chain call), POST-only like all ai tasks.
//   2. The brief is identity-free aggregates (the deck spec) — never raw
//      user rows. Raw LLM text never mutates state; it returns notes only.
//   3. LLM success → { engine: "provider:model", notes } with all seven
//      slide keys, each a short string. Anything else → deterministic
//      rule-built notes with engine "rules" (honest fallback, never fake).
//   4. A degraded chain (no keys) short-circuits to the rule notes —
//      the admin is told AI is unavailable, not served silence.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = {
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	clientIp: vi.fn().mockReturnValue("203.0.113.7"),
	// Default: never throttled. Tests for the gate override this.
	rateLimited: vi.fn().mockReturnValue(false),
	rateLimitResponse: vi.fn((res: { status: (n: number) => { json: (b: unknown) => unknown } }, seconds: number) =>
		res.status(429).json({ error: "rate limited", retry_after: seconds }),
	),
};

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// The narrate branch imports the deck module (rule-note builder), which
// pulls the DB client — narrate never queries, so a dummy suffices.
vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

const providerMocks = {
	callLLMChain: vi.fn(),
};

vi.mock("../../api/_providers.js", () => providerMocks);

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

const BRIEF = {
	totals: {
		posts: 5,
		open: 4,
		solved: 1,
		reports_open: 1,
		reports_resolved: 1,
		polls: 1,
		votes: 2,
	},
	by_category: [{ category: "Transport", open: 2, solved: 0, total: 2 }],
	by_status: [
		{ status: "reported", count: 3 },
		{ status: "solved", count: 1 },
	],
	top_supported: [
		{
			id: "p1",
			title: "Bus late every day",
			category: "Transport",
			status: "reported",
			support: 3,
			upvote: 0,
			score: 3,
		},
	],
	top_polls: [{ id: "poll-1", title: "Fix the bus?", total: 2 }],
	solved_by_week: [{ week: "2026-10-05", solved: 1 }],
	recommendations: [
		{ rule: "category-dominance", text: "Transport dominates the queue." },
	],
};

async function narrate(admin: boolean, brief: unknown = BRIEF) {
	authMocks.isAdmin.mockResolvedValue(admin);
	const { default: handler } = await import("../../api/_ai.js");
	const res = response();
	await handler(
		{ method: "POST", query: {}, body: { task: "narrate", brief }, headers: {} },
		res,
	);
	return res;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(false);
});

describe("POST /api/ai { task: narrate }", () => {
	it("denies non-admins before touching the provider chain", async () => {
		const res = await narrate(false);
		expect(res.statusCode).toBe(403);
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("throttles narration when the rate limiter trips (admin loop cannot burn provider quota)", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		authMocks.rateLimited.mockReturnValueOnce(true);
		const res = await narrate(true);
		expect(res.statusCode).toBe(429);
		expect(authMocks.rateLimited).toHaveBeenCalledWith(
			"ai_narrate",
			"203.0.113.7",
			60000,
			10,
		);
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("rejects an oversized brief before touching the provider chain", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const huge = { ...BRIEF, junk: "x".repeat(30000) };
		const res = await narrate(true, huge);
		expect(res.statusCode).toBe(413);
		expect(providerMocks.callLLMChain).not.toHaveBeenCalled();
	});

	it("forwards the presenter's prompt to the chain", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			ok: true,
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				notes: {
					cover: "c",
					complaints: "c",
					feed: "c",
					reports: "c",
					polls: "c",
					trends: "c",
					actions: "c",
				},
			}),
		});
		authMocks.isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_ai.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "narrate", brief: BRIEF, prompt: "For parents, reassuring tone" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const chainInput = String(providerMocks.callLLMChain.mock.calls[0]?.[1] ?? "");
		expect(chainInput).toContain("For parents, reassuring tone");
	});

	it("caps an overlong prompt instead of pasting it raw", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			ok: true,
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				notes: {
					cover: "c",
					complaints: "c",
					feed: "c",
					reports: "c",
					polls: "c",
					trends: "c",
					actions: "c",
				},
			}),
		});
		authMocks.isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_ai.js");
		const res = response();
		const tail = "TAIL-MARKER- never-should-appear";
		await handler(
			{
				method: "POST",
				query: {},
				body: { task: "narrate", brief: BRIEF, prompt: `${"x".repeat(600)}${tail}` },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const chainInput = String(providerMocks.callLLMChain.mock.calls[0]?.[1] ?? "");
		expect(chainInput).not.toContain(tail);
	});

	it("ignores a non-string prompt without crashing", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			ok: true,
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				notes: {
					cover: "c",
					complaints: "c",
					feed: "c",
					reports: "c",
					polls: "c",
					trends: "c",
					actions: "c",
				},
			}),
		});
		authMocks.isAdmin.mockResolvedValue(true);
		const { default: handler } = await import("../../api/_ai.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { task: "narrate", brief: BRIEF, prompt: 42 }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { engine: string }).engine).toBe("test:test-model");
	});

	it("returns engine-labeled LLM notes when the chain answers", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			ok: true,
			provider: "test",
			model: "test-model",
			text: JSON.stringify({
				notes: {
					cover: "Five posts in scope, four still open.",
					complaints: "Transport dominates — start there.",
					feed: "One of five resolved so far.",
					reports: "One report awaits a human.",
					polls: "Fix the bus leads the vote.",
					trends: "One solve this week.",
					actions: "One rule-fired move on the table.",
				},
			}),
		});
		const res = await narrate(true);
		expect(res.statusCode).toBe(200);
		const body = res.body as { engine: string; notes: Record<string, string> };
		expect(body.engine).toBe("test:test-model");
		expect(body.notes.complaints).toBe("Transport dominates — start there.");
		expect(Object.keys(body.notes).sort()).toEqual([
			"actions",
			"complaints",
			"cover",
			"feed",
			"polls",
			"reports",
			"trends",
		]);
	});

	it("falls back to deterministic rule notes when the chain is degraded", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			ok: false,
			degraded: true,
			text: "",
			provider: null,
			model: null,
		});
		const res = await narrate(true);
		expect(res.statusCode).toBe(200);
		const body = res.body as { engine: string; notes: Record<string, string> };
		expect(body.engine).toBe("rules");
		expect(body.notes.complaints).toBe(
			"Transport holds 2 of 4 open items (50%) — fix this category first.",
		);
	});

	it("falls back to rule notes when the LLM invents keys or blanks", async () => {
		providerMocks.callLLMChain.mockResolvedValueOnce({
			ok: true,
			provider: "test",
			model: "test-model",
			text: JSON.stringify({ notes: { cover: "", complaints: "ok", extra: "x" } }),
		});
		const res = await narrate(true);
		const body = res.body as { engine: string; notes: Record<string, string> };
		expect(body.engine).toBe("rules");
		expect(body.notes.cover).toContain("5 posts in scope");
	});

	it("falls back to rule notes when the chain throws", async () => {
		providerMocks.callLLMChain.mockRejectedValueOnce(new Error("down"));
		const res = await narrate(true);
		const body = res.body as { engine: string; notes: Record<string, string> };
		expect(body.engine).toBe("rules");
		expect(body.notes.polls).toContain("Fix the bus?");
	});
});
