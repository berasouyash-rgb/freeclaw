// ═══════════════════════════════════════════════════════════════════
// AI analyze — log hygiene: summary content never reaches a log sink
// ═══════════════════════════════════════════════════════════════════
// Contract:
//   1. Admin-only analyze keeps its behavior: a meaningful LLM summary
//      is accepted (200 + engine), anything else falls back to the
//      heuristic analysis (200) — never a fake success.
//   2. The summary text itself is derived from student feedback
//      (names, rooms, phone numbers, incidents) — NO log line may carry
//      summary content, on either the accepted path or the
//      invalid-result path. Logs get the engine and lengths only.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = {
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(true),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	clientIp: vi.fn().mockReturnValue("203.0.113.7"),
	rateLimited: vi.fn().mockReturnValue(false),
	rateLimitResponse: vi.fn(
		(res: { status: (n: number) => { json: (b: unknown) => unknown } }, seconds: number) =>
			res.status(429).json({ error: "rate limited", retry_after: seconds }),
	),
};

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock("../../api/_observability.js", () => ({ logger: loggerMock }));
// The analyze branch imports the deck module, which pulls the DB client —
// analyze never queries the DB itself, so a dummy suffices.
vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));
const providerMocks = { callLLMChain: vi.fn() };
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

// The PII marker stands in for real student content — if any stringified
// log argument ever contains it, summary text leaked into a log sink.
const PII = "PII-MARKER John Smith room 12B 555-0100";

const POSTS = [
	{
		id: "p1",
		title: "Locker room incident",
		description: "Someone's wallet went missing after PE.",
		category: "Safety",
		priority: "high",
		status: "open",
		reactions: { support: 4 },
		comment_count: 2,
		created_at: "2026-10-01T09:00:00.000Z",
	},
];

async function analyze(llmText: string) {
	providerMocks.callLLMChain.mockResolvedValueOnce({
		ok: true,
		provider: "test",
		model: "unit",
		text: llmText,
	});
	const { default: handler } = await import("../../api/_ai.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body: { task: "analyze", posts: POSTS },
			headers: {},
		},
		res,
	);
	return res;
}

/** Every argument of every log call, JSON-stringified and joined. */
function allLogOutput(consoleWarnSpy: ReturnType<typeof vi.spyOn>) {
	const calls = [
		...loggerMock.info.mock.calls,
		...loggerMock.warn.mock.calls,
		...loggerMock.error.mock.calls,
		...(consoleWarnSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls,
	];
	return JSON.stringify(calls);
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(true);
});

describe("POST /api/ai { task: analyze } — log hygiene", () => {
	it("accepts the LLM result but logs engine + length only, never summary content", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const res = await analyze(
				JSON.stringify({
					summary: PII,
					ranked_issues: [],
					duplicate_clusters: [],
					safety_alerts: [],
					weekly_insights: {},
				}),
			);
			// Behavior unchanged: the valid summary was accepted…
			expect(res.statusCode).toBe(200);
			expect((res.body as { engine?: string }).engine).toBe("test:unit");
			// …and the accepted-path log line fired…
			expect(loggerMock.info).toHaveBeenCalledWith(
				"ai",
				"LLM result accepted",
				expect.objectContaining({ engine: "test:unit" }),
			);
			// …but no log sink anywhere saw the summary text.
			expect(allLogOutput(warnSpy)).not.toContain("PII-MARKER");
			expect(allLogOutput(warnSpy)).not.toContain("555-0100");
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("invalid-result path warns with type/length only — still never summary content", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			// summary is an object → fails validation → invalid-result warn.
			const res = await analyze(
				JSON.stringify({
					summary: { leaked: PII },
					ranked_issues: [],
					duplicate_clusters: [],
					safety_alerts: [],
					weekly_insights: {},
				}),
			);
			// Behavior unchanged: honest heuristic fallback, still 200.
			expect(res.statusCode).toBe(200);
			// The invalid-result warn actually fired (the pin targets it)…
			expect(warnSpy).toHaveBeenCalled();
			// …without the summary object ever reaching the console.
			expect(allLogOutput(warnSpy)).not.toContain("PII-MARKER");
		} finally {
			warnSpy.mockRestore();
		}
	});
});
