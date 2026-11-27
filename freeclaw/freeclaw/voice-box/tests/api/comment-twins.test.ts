// Comment twin-submit protection — retry-after-timeout, double-tap past the
// client cooldown, and offline-queue flush can deliver the same comment
// twice. Posts already return the original row (200 + deduped:true) for same
// author + normalized title + category within 90s; comments had no such
// guard, so twins landed as separate rows (visible double comments).
// These tests pin the same contract for comments: same author + same post +
// same thread (parent_id) + exact normalized body within 90s → 200 with the
// original row, no second insert.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
	id: string;
	post_id: string;
	parent_id: string | null;
	body: string;
	author_id: string;
	deleted: boolean;
	hidden: boolean;
	created_at: string;
}

const db = {
	comments: [] as Row[],
	posts: [
		{ id: "p1", locked: false, visibility: "public", author_id: "anon-1" },
	],
};

let insertCalls = 0;

function chainFor(table: string) {
	const ops: string[] = [];
	const chain: Record<string, unknown> = {
		select() {
			ops.push("select");
			return chain;
		},
		eq() {
			ops.push("eq");
			return chain;
		},
		gte() {
			ops.push("gte");
			return chain;
		},
		order() {
			ops.push("order");
			return chain;
		},
		limit() {
			ops.push("limit");
			return chain;
		},
		maybeSingle() {
			ops.push("maybeSingle");
			return chain;
		},
		single() {
			ops.push("single");
			return chain;
		},
		update() {
			ops.push("update");
			return chain;
		},
		insert(row: unknown) {
			ops.push("insert");
			insertCalls++;
			// The real table defaults created_at to now(); the twin scan
			// compares against it, so the fake must stamp it too.
			const r = { created_at: new Date().toISOString(), ...(row as Row) };
			db.comments.push(r);
			return chain;
		},
		delete() {
			ops.push("delete");
			return chain;
		},
		then(fn: (v: unknown) => void) {
			if (table === "posts" && ops.includes("maybeSingle")) {
				fn({ data: db.posts[0], error: null });
				return;
			}
			if (table === "posts" && ops.includes("update")) {
				fn({ data: null, error: null });
				return;
			}
			if (table === "comments" && ops.includes("insert")) {
				fn({ data: db.comments[db.comments.length - 1], error: null });
				return;
			}
			// Twin-scan select on comments: return current rows (the route
			// filters by time/deleted/normalized body itself).
			fn({ data: [...db.comments], error: null });
		},
	};
	return chain;
}

vi.mock("../../api/_db-client.js", () => ({
	default: { from: (t: string) => chainFor(t) },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) =>
		(res as { status: (c: number) => { json: (b: unknown) => void } })
			.status(429)
			.json({ error: "Too many requests" }),
	),
	// Default-allow session gate: the route under test binds writes to the
	// session, and these behavior tests do not model auth failures.
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
	EVENT_TYPES: { COMMENT_CREATED: "comment.created" },
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({
		blocked: false,
		requiresReview: false,
		flags: [],
	})),
	recordSafetyRepost: vi.fn(async () => false),
	checkSafetyRepost: vi.fn(async () => ({ blocked: false })),
}));
const pipelineMocks = vi.hoisted(() => ({
	evaluateContent: vi.fn(() => ({
		action: "ALLOW",
		blocked: false,
		needsReview: false,
		flags: [],
		code: "OK",
	})),
}));
pipelineMocks.evaluateContentAsync = vi.fn(async (...a: unknown[]) =>
	pipelineMocks.evaluateContent(...(a as [])),
);
pipelineMocks.evaluateContentDeep = vi.fn(async (...a: unknown[]) =>
	pipelineMocks.evaluateContent(...(a as [])),
);
vi.mock("../../api/_safety-pipeline.js", () => pipelineMocks);

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

function postReq(body: Record<string, unknown>) {
	return {
		method: "POST",
		headers: { "x-anon-id": "anon-1" },
		body,
		query: {},
	};
}

beforeEach(() => {
	db.comments = [];
	insertCalls = 0;
	vi.clearAllMocks();
});

describe("comment twin-submit protection", () => {
	it("returns the original row instead of a twin on rapid repost", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		const payload = {
			post_id: "p1",
			parent_id: null,
			body: "The projector lamp needs replacing.",
		};
		const r1 = response();
		await handler(postReq(payload) as never, r1 as never);
		expect(r1.statusCode).toBe(201);

		const r2 = response();
		await handler(postReq(payload) as never, r2 as never);
		expect(r2.statusCode).toBe(200);
		expect((r2.body as { deduped?: boolean }).deduped).toBe(true);
		expect(insertCalls).toBe(1);
		expect(db.comments).toHaveLength(1);
	});

	it("does not dedupe genuinely different bodies", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		for (const body of ["First thought here.", "Second thought here."]) {
			const r = response();
			await handler(
				postReq({ post_id: "p1", parent_id: null, body }) as never,
				r as never,
			);
			expect(r.statusCode).toBe(201);
		}
		expect(db.comments).toHaveLength(2);
	});

	it("does not dedupe the same words in different threads", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		// Same words, different parent (top-level vs a reply thread).
		for (const parent_id of [null, "c-other"]) {
			const r = response();
			await handler(
				postReq({
					post_id: "p1",
					parent_id,
					body: "Thanks for sharing this update.",
				}) as never,
				r as never,
			);
			expect(r.statusCode).toBe(201);
		}
		expect(db.comments).toHaveLength(2);
	});

	it("ignores deleted twins — a fresh repost after delete is legitimate", async () => {
		const { default: handler } = await import("../../api/_comments.js");
		const payload = {
			post_id: "p1",
			parent_id: null,
			body: "The water cooler is leaking again.",
		};
		const r1 = response();
		await handler(postReq(payload) as never, r1 as never);
		expect(r1.statusCode).toBe(201);
		db.comments[0]!.deleted = true;

		const r2 = response();
		await handler(postReq(payload) as never, r2 as never);
		expect(r2.statusCode).toBe(201);
		expect(db.comments).toHaveLength(2);
	});
});
