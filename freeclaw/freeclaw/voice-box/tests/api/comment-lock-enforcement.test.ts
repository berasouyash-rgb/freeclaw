// ═══════════════════════════════════════════════════════════════════
// Comment-block enforcement — lock purges, resurrection stays buried
// ═══════════════════════════════════════════════════════════════════
// A locked post claims "comments off". Two invariants keep that honest:
//   1. PUT /api/posts { locked: true } soft-deletes ALL existing comments
//      on the post and reports the count (comments_purge). Re-locking an
//      already-locked post purges nothing and reports nothing. A failed
//      purge audits loudly and rides the response — never silently.
//   2. PUT /api/comments cannot un-delete / un-hide a comment whose post
//      is locked (owner restore or admin unlock) — 403 post_locked. The
//      post must be unlocked first; the lock keeps the purge buried.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
	post: null as unknown,
	comment: null as unknown,
	purgeRows: [] as unknown[],
	purgeError: null as unknown,
	updates: [] as unknown[],
	audits: [] as Array<{ actor: string; action: string; detail: string }>,
	isAdmin: true,
	callerId: "",
};

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn(() => Promise.resolve(store.isAdmin)),
	checkUser: vi.fn(() => Promise.resolve({ ok: true })),
	ensureUser: vi.fn(),
	auditLog: vi.fn((actor: string, action: string, detail: string) => {
		store.audits.push({ actor, action, detail });
		return Promise.resolve(true);
	}),
	notifyUser: vi.fn(() => Promise.resolve(true)),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn(() => Promise.resolve(false)),
	rateLimitResponse: vi.fn((res: { status: (c: number) => { json: (b: unknown) => unknown } }) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: store.callerId })),
}));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(() => Promise.resolve()),
	emitEventAndBridge: vi.fn(() => Promise.resolve()),
	EVENT_TYPES: { POST_STATUS_CHANGED: "POST_STATUS_CHANGED" },
}));

vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../api/_email.js", () => ({
	sendPostSolvedEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../api/_cache.js", () => ({
	staleWhileRevalidate: vi.fn(() =>
		Object.assign(vi.fn(async () => []), { invalidate: vi.fn() }),
	),
	cacheClear: vi.fn(),
}));

vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: () => false,
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
	evaluateContentDeep: vi.fn(async () => ({
		action: "ALLOW",
		blocked: false,
		flags: [],
		code: "clean",
	})),
	messageFor: vi.fn(() => "blocked"),
}));
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

// Minimal thenable PostgREST chain. Resolution depends on the terminal op:
// update on comments → the purge result; update on posts → the merged row;
// maybeSingle → the stored row for that table.
function chainFor(table: string) {
	const chain = {
		op: "select",
		updated: false,
		patch: null as unknown,
		select(_col?: unknown) {
			return this;
		},
		eq() {
			return this;
		},
		or() {
			return this;
		},
		maybeSingle() {
			this.op = "maybeSingle";
			return this;
		},
		single() {
			this.op = "single";
			return this;
		},
		update(patch: unknown) {
			this.updated = true;
			this.patch = patch;
			if (table === "posts") store.updates.push(patch);
			return this;
		},
		then(fn: (v: unknown) => void) {
			if (this.updated && table === "comments") {
				fn({ data: store.purgeRows, error: store.purgeError });
				return;
			}
			if (this.updated && table === "posts") {
				fn({
					data: { ...(store.post as Record<string, unknown>), ...(this.patch as Record<string, unknown>) },
					error: null,
				});
				return;
			}
			if (this.op === "maybeSingle" || this.op === "single") {
				fn({ data: table === "posts" ? store.post : store.comment, error: null });
				return;
			}
			fn({ data: [], error: null });
		},
	};
	return chain;
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(store, {
		post: null,
		comment: null,
		purgeRows: [],
		purgeError: null,
		updates: [],
		audits: [],
		isAdmin: true,
		callerId: "",
	});
	from.mockImplementation((table: string) => chainFor(table));
});

const adminReq = (body: Record<string, unknown>) => ({
	method: "PUT",
	query: {},
	body,
	headers: {},
});

describe("PUT /api/posts lock purges existing comments", () => {
	it("soft-deletes every visible comment and reports the count", async () => {
		store.post = { id: "p1", title: "T", author_id: "anon-9", locked: false, status_history: [] };
		store.purgeRows = [{ id: "c1" }, { id: "c2" }];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(adminReq({ id: "p1", locked: true }) as never, res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ comments_purge: { ok: true, purged: 2 } });
		expect(store.audits.some((a) => a.action === "lock_purged_comments")).toBe(true);
	});

	it("re-locking an already-locked post purges nothing and reports nothing", async () => {
		store.post = { id: "p1", title: "T", author_id: "anon-9", locked: true, status_history: [] };
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(adminReq({ id: "p1", locked: true }) as never, res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).not.toHaveProperty("comments_purge");
		expect(store.audits.some((a) => a.action.startsWith("lock_purge"))).toBe(false);
	});

	it("a failed purge still locks, audits loudly, and says so in the response", async () => {
		store.post = { id: "p1", title: "T", author_id: "anon-9", locked: false, status_history: [] };
		store.purgeError = new Error("db down");
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(adminReq({ id: "p1", locked: true }) as never, res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ locked: true, comments_purge: { ok: false, purged: 0 } });
		expect(store.audits.some((a) => a.action === "lock_purge_failed")).toBe(true);
	});
});

describe("PUT /api/comments cannot resurrect on a locked post", () => {
	function ownerReq(body: Record<string, unknown>) {
		return {
			method: "PUT",
			query: {},
			body,
			headers: { "x-anon-id": "anon-2" },
		};
	}

	beforeEach(() => {
		store.isAdmin = false;
		store.callerId = "anon-2";
		store.comment = { id: "c1", post_id: "p1", author_id: "anon-2", deleted: true, hidden: false };
	});

	it("owner un-delete on a locked post → 403 post_locked", async () => {
		store.post = { id: "p1", locked: true };
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(ownerReq({ id: "c1", deleted: false }) as never, res as never);
		expect(res.statusCode).toBe(403);
		expect(res.body).toMatchObject({ code: "post_locked" });
	});

	it("admin un-hide on a locked post → 403 post_locked", async () => {
		store.isAdmin = true;
		store.post = { id: "p1", locked: true };
		store.comment = { id: "c1", post_id: "p1", author_id: "anon-9", deleted: false, hidden: true };
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: "c1", hidden: false }, headers: {} } as never,
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(res.body).toMatchObject({ code: "post_locked" });
	});

	it("restore on an unlocked post still works", async () => {
		store.post = { id: "p1", locked: false };
		const { default: handler } = await import("../../api/_comments.js");
		const res = response();
		await handler(ownerReq({ id: "c1", deleted: false }) as never, res as never);
		expect(res.statusCode).toBe(200);
	});
});
