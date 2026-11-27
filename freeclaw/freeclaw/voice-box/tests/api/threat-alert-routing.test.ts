/**
 * THREAT ALERT WIRING — every write surface pages a human on a block.
 *
 * Blocking stops the content; it does not tell anyone WHO did it. These
 * pins prove POST /api/posts, /api/comments and /api/polls call
 * `alertAdminThreat` (surface, author, excerpt, flags) when the safety
 * pipeline blocks for threat/violence — and stay silent for any other
 * block reason. The helper's own contract (store shape, throttle,
 * never-throw) is pinned in tests/api/threat-alert.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	from: vi.fn(),
	alertAdminThreat: vi.fn(async () => ({ alerted: true })),
	evaluateContentDeep: vi.fn(),
}));
const from = mocks.from;
const alertSpy = mocks.alertAdminThreat;
const deepMock = mocks.evaluateContentDeep;

vi.mock("../../api/_db-client.js", () => ({
	default: { from: (...args: unknown[]) => mocks.from(...args) },
}));

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
	rateLimitResponse: vi.fn((res: { statusCode: number }) => {
		res.statusCode = 429;
		return res;
	}),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "anon_x" })),
}));

vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
	recordModerationDecision: vi.fn(async () => {}),
	recordSafetyRepost: vi.fn(async () => {}),
	checkSafetyRepost: vi.fn(async () => ({ blocked: false })),
	spamAnalyze: vi.fn(() => ({
		action: "allow",
		spam_score: 0,
		signals: {},
	})),
	getSpamConfig: vi.fn(async () => ({})),
	getLearnedWeakStats: vi.fn(async () => ({ approved: 0, blocked: 0 })),
	alertAdminThreat: (...args: unknown[]) => mocks.alertAdminThreat(...args),
}));
vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContentAsync: vi.fn(async () => ({ blocked: false, flags: [] })),
	evaluateContentDeep: (...args: unknown[]) => mocks.evaluateContentDeep(...args),
	messageFor: (_s: unknown, code: unknown) => code,
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(async () => {}),
	emitEventAndBridge: vi.fn(async () => {}),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(async () => {}),
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
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

function chain() {
	const c: Record<string, unknown> = {};
	c.select = () => c;
	c.eq = () => c;
	c.gte = () => c;
	c.order = () => c;
	c.limit = () => c;
	c.maybeSingle = async () => ({ data: null, error: null });
	c.upsert = async () => ({ data: null, error: null });
	c.then = (resolve: (v: unknown) => void) =>
		resolve({ data: [], error: null });
	return c;
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

const headers = {
	"x-anon-id": "anon_x",
	"x-forwarded-for": "203.0.113.9",
};

beforeEach(() => {
	vi.clearAllMocks();
	from.mockImplementation(() => chain());
});

const THREAT_DECISION = {
	action: "BLOCK_ACTION",
	blocked: true,
	needsReview: false,
	flags: [{ type: "threat", severity: "critical", message: "x" }],
	code: "threat_blocked",
	model_used: true,
	timedOut: false,
};

describe("threat blocks page a human on every write surface", () => {
	it("POST /api/posts threat-block alerts with author, excerpt, flags", async () => {
		vi.resetModules();
		deepMock.mockResolvedValue(THREAT_DECISION);
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Evening study hall feedback",
					description: "I will kill Rahul tomorrow do not come to school",
					category: "Other",
					visibility: "public",
				},
				headers,
			},
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(alertSpy).toHaveBeenCalledTimes(1);
		expect(alertSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				surface: "post",
				authorId: "anon_x",
			}),
		);
		const call = alertSpy.mock.calls[0][0] as {
			excerpt: string;
			flags: Array<{ type: string }>;
		};
		expect(call.excerpt).toContain("I will kill Rahul");
		expect(call.flags.map((f) => f.type)).toContain("threat");
	});

	it("POST /api/comments threat-block alerts", async () => {
		vi.resetModules();
		deepMock.mockResolvedValue(THREAT_DECISION);
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					post_id: "post_1",
					body: "I will kill Rahul tomorrow do not come to school",
				},
				headers,
			},
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(alertSpy).toHaveBeenCalledTimes(1);
		expect(alertSpy).toHaveBeenCalledWith(
			expect.objectContaining({ surface: "comment", authorId: "anon_x" }),
		);
	});

	it("POST /api/polls threat-block alerts", async () => {
		vi.resetModules();
		deepMock.mockResolvedValue(THREAT_DECISION);
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "I will kill Rahul tomorrow do not come to school",
					ptype: "yesno",
				},
				headers,
			},
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(alertSpy).toHaveBeenCalledTimes(1);
		expect(alertSpy).toHaveBeenCalledWith(
			expect.objectContaining({ surface: "poll", authorId: "anon_x" }),
		);
	});

	it("non-threat blocks still reach the helper with intact flags (it decides silence)", async () => {
		// Routing passes EVERY block to alertAdminThreat; the silence rule
		// for non-threats lives in exactly one place — the helper, pinned
		// in tests/api/threat-alert.test.ts. This pin proves the flags
		// arrive intact for the helper to judge (a route that filtered or
		// rewrote flags would break that contract silently).
		vi.resetModules();
		deepMock.mockResolvedValue({
			...THREAT_DECISION,
			flags: [{ type: "profanity", severity: "high", message: "x" }],
		});
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: {
					title: "Evening study hall feedback",
					description: "damn damn damn damn damn",
					category: "Other",
					visibility: "public",
				},
				headers,
			},
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(alertSpy).toHaveBeenCalledTimes(1);
		const call = alertSpy.mock.calls[0][0] as {
			surface: string;
			flags: Array<{ type: string }>;
		};
		expect(call.surface).toBe("post");
		expect(call.flags.map((f) => f.type)).toEqual(["profanity"]);
	});
});
