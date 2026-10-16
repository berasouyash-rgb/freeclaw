/**
 * SUPPORT ROUTING — genuine pleas never go public.
 *
 * When the platform judges a submission is a cry for help (model-read
 * distress via `needsSupport`, or a deterministic plea via
 * `assessRelevance` route "support"), the write path forces
 * visibility private + status pending_review — the support team sees it,
 * the public feed never does. No client can bypass it: the server
 * enforces, the client only explains (auto-private lock).
 *
 * This is ROUTING, not moderation: nothing is blocked for being a plea,
 * and attack-flagged content stays on the block path (proved below).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	inserted: null as unknown,
};

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

const pipelineMocks = vi.hoisted(() => ({
	evaluateContentDeep: vi.fn(),
}));
vi.mock("../../api/_safety-pipeline.js", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, evaluateContentDeep: pipelineMocks.evaluateContentDeep };
});

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	clientIp: () => "203.0.113.9",
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	notifyUser: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: { statusCode: number; body: unknown }) =>
		Object.assign(res, { statusCode: 429 }),
	),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "anon_plea" })),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	emitEventAndBridge: vi.fn(async () => {}),
	EVENT_TYPES: { POST_CREATED: "post.created" },
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
	getLearnedWeakStats: vi.fn(async () => ({ approved: 0, blocked: 0 })),
	recordModerationDecision: vi.fn(async () => {}),
	recordSafetyRepost: vi.fn(async () => {}),
	checkSafetyRepost: vi.fn(async () => ({ blocked: false })),
	spamAnalyze: vi.fn(() => ({ action: "allow", spam_score: 0, signals: {} })),
	getSpamConfig: vi.fn(async () => ({})),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(),
}));
vi.mock("../../api/_reports.js", () => ({
	strikeSlangAbuse: vi.fn(async () => {}),
}));
vi.mock("../../api/_email.js", () => ({
	sendPostSolvedEmail: vi.fn(async () => {}),
}));
vi.mock("../../api/_counts.js", () => ({
	getRawCounts: vi.fn(async () => ({})),
	invalidateCounts: vi.fn(),
}));

function chainFor(_table: string) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		gte: () => chain,
		order: () => chain,
		limit: () => chain,
		insert: (row: unknown) => {
			state.inserted = row;
			return {
				select: () => ({
					single: async () => ({
						data: { ...(row as object), id: "post_test" },
						error: null,
					}),
				}),
			};
		},
		upsert: async () => ({ data: null, error: null }),
		then: (resolve: (v: unknown) => void) =>
			resolve({ data: [], error: null }),
	};
	return chain;
}

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

function postAs(body: Record<string, unknown>) {
	return {
		method: "POST",
		query: {},
		body,
		headers: { "x-anon-id": "anon_plea", "x-forwarded-for": "203.0.113.9" },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.inserted = null;
	from.mockImplementation((table: string) => chainFor(table));
});

describe("pleas for help are forced private + pending review", () => {
	it("model-read distress with a public ask still inserts private + pending", async () => {
		vi.resetModules();
		pipelineMocks.evaluateContentDeep.mockResolvedValue({
			action: "ALLOW_ACTION",
			blocked: false,
			needsReview: false,
			flags: [],
			code: "clean",
			model_used: true,
			timedOut: false,
			emotion: "anxious",
			level: "moderate",
		});
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			postAs({
				title: "Rahul please help me with this situation",
				description:
					"I do not know what to do anymore and I need someone to help me right now",
				category: "Other",
				visibility: "public",
			}),
			res as never,
		);
		expect(res.statusCode).toBe(201);
		const row = state.inserted as Record<string, unknown>;
		expect(row.visibility).toBe("private");
		expect(row.status).toBe("pending_review");
	});

	it("deterministic plea route (no model needed) is enforced the same way", async () => {
		vi.resetModules();
		// Model saw nothing flaggable and read no distress — the plea
		// routing below comes from the deterministic relevance layer,
		// proving enforcement does not depend on any single signal.
		pipelineMocks.evaluateContentDeep.mockResolvedValue({
			action: "ALLOW_ACTION",
			blocked: false,
			needsReview: false,
			flags: [],
			code: "clean",
			model_used: true,
			timedOut: false,
			emotion: "neutral",
			level: "low",
		});
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			postAs({
				title: "Rahul help me please",
				description:
					"Something happened after class and I need help right now",
				category: "Other",
				visibility: "public",
			}),
			res as never,
		);
		expect(res.statusCode).toBe(201);
		const row = state.inserted as Record<string, unknown>;
		expect(row.visibility).toBe("private");
		expect(row.status).toBe("pending_review");
	});

	it("an ordinary public post is untouched", async () => {
		vi.resetModules();
		pipelineMocks.evaluateContentDeep.mockResolvedValue({
			action: "ALLOW_ACTION",
			blocked: false,
			needsReview: false,
			flags: [],
			code: "clean",
			model_used: true,
			timedOut: false,
			emotion: "neutral",
			level: "low",
		});
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			postAs({
				title: "The canteen food is bad",
				description: "The lunch today was cold and stale again",
				category: "Food",
				visibility: "public",
			}),
			res as never,
		);
		expect(res.statusCode).toBe(201);
		const row = state.inserted as Record<string, unknown>;
		expect(row.visibility).toBe("public");
		expect(row.status).toBe("reported");
	});

	it("attack-flagged content stays on the block path, never support-routed", async () => {
		vi.resetModules();
		pipelineMocks.evaluateContentDeep.mockResolvedValue({
			action: "BLOCK_ACTION",
			blocked: true,
			needsReview: false,
			flags: [{ type: "threat", severity: "critical", message: "x" }],
			code: "threat_blocked",
			model_used: true,
			timedOut: false,
			emotion: "anger",
			level: "high",
		});
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			postAs({
				title: "Evening study hall feedback",
				description: "I will kill Rahul tomorrow do not come to school",
				category: "Other",
				visibility: "public",
			}),
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(state.inserted).toBe(null);
	});
});
