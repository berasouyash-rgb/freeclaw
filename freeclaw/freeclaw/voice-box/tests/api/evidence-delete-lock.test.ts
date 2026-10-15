// EVIDENCE LOCK — published/held/reported content is never user-deletable.
//
// A student who posts something wrong must not be able to delete the
// evidence: every content hard-delete route (posts, comments, polls) is
// admin-only. These are lock tests — they pin the current enforcement so
// no future change can silently open a user delete path. If a delete
// surface is ever added for users, THESE tests must be updated
// deliberately, with a retention policy (held/reported/flagged rows stay).
import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	auditLog: vi.fn(),
	rateLimited: vi.fn().mockResolvedValue(false),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "" })),
}));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(() => Promise.resolve()),
	emitEventAndBridge: vi.fn(() => Promise.resolve()),
	EVENT_TYPES: {},
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
	recordModerationDecision: vi.fn(() => Promise.resolve()),
	recordSafetyRepost: vi.fn(() => Promise.resolve(false)),
	checkSafetyRepost: vi.fn(() => Promise.resolve({ blocked: false })),
}));
vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContentAsync: vi.fn(async () => ({ blocked: false, flags: [] })),
	evaluateContentDeep: vi.fn(async () => ({ blocked: false, flags: [] })),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
}));

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

beforeEach(() => {
	vi.clearAllMocks();
});

describe("EVIDENCE LOCK: content hard-delete is admin-only", () => {
	it("non-admin DELETE /api/posts → 403, no DB read, nothing deleted", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { id: "post_wrongdoing" },
				body: {},
				headers: { "x-anon-id": "anon_student" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(from).not.toHaveBeenCalled();
	});

	it("non-admin DELETE /api/comments → 403, no DB read, nothing deleted", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: {},
				body: { id: "comment_wrongdoing" },
				headers: { "x-anon-id": "anon_student" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(from).not.toHaveBeenCalled();
	});

	it("non-admin DELETE /api/polls → 403, no DB read, nothing deleted", async () => {
		vi.resetModules();
		const { default: handler } = await import("../../api/_polls.js");
		const res = response();
		await handler(
			{
				method: "DELETE",
				query: { id: "poll_wrongdoing" },
				body: {},
				headers: { "x-anon-id": "anon_student" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(from).not.toHaveBeenCalled();
	});
});
