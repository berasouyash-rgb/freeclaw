// Posts API — admin-action author notices + hidden self-view contract.
// Locks two user-visible promises:
//   1. An admin hide/unhide/status/reply on someone else's post notifies the
//      author (previously silent — posts vanished from My Activity with no
//      explanation and no notification).
//   2. Authors always see their OWN hidden posts (badged in My Activity),
//      while strangers never do.
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminState = vi.hoisted(() => ({ isAdmin: false }));
const authMocks = vi.hoisted(() => ({
	notifyUser: vi.fn(async () => true),
	auditLog: vi.fn(async () => true),
}));
const store = vi.hoisted(() => ({ posts: [] as Record<string, unknown>[] }));

type Cond = { op: string; col: string; val: unknown };
function matches(row: Record<string, unknown>, conds: Cond[]) {
	return conds.every(({ op, col, val }) => {
		const v = row[col];
		if (op === "eq") return v === val;
		if (op === "neq") return v !== val;
		if (op === "in") return (val as unknown[]).includes(v);
		return true;
	});
}

function builder(table: string) {
	const conds: Cond[] = [];
	let updatePayload: Record<string, unknown> | null = null;
	const rows = () =>
		((store as Record<string, Record<string, unknown>[] | undefined>)[table] ??
			[]) as Record<string, unknown>[];
	const b: Record<string, unknown> = {
		select: () => b,
		eq: (col: string, val: unknown) => {
			conds.push({ op: "eq", col, val });
			return b;
		},
		neq: (col: string, val: unknown) => {
			conds.push({ op: "neq", col, val });
			return b;
		},
		in: (col: string, val: unknown) => {
			conds.push({ op: "in", col, val });
			return b;
		},
		lt: () => b,
		gte: () => b,
		order: () => b,
		limit: () => b,
		update: (payload: Record<string, unknown>) => {
			updatePayload = payload;
			return b;
		},
		insert: () => b,
		upsert: () => b,
		delete: () => b,
		maybeSingle: async () => {
			const row = rows().find((r) => matches(r, conds));
			return { data: row ? { ...row } : null, error: null };
		},
		single: async () => {
			const row = rows().find((r) => matches(r, conds));
			if (updatePayload && row) Object.assign(row, updatePayload);
			// Supabase returns a fresh result object. Do not return the stored row
			// itself: the handler must retain the pre-update snapshot when it
			// compares old and new values for notifications/auditing.
			return { data: row ? { ...row } : null, error: null };
		},
		then: (resolve: (v: unknown) => void) =>
			Promise.resolve({
				data: rows().filter((r) => matches(r, conds)),
				error: null,
			}).then(resolve),
	};
	return b;
}

vi.mock("../../api/_db-client.js", () => ({
	default: { from: (table: string) => builder(table) },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn(async () => adminState.isAdmin),
	checkUser: vi.fn(async () => ({ ok: true })),
	ensureUser: vi.fn(),
	auditLog: authMocks.auditLog,
	notifyUser: authMocks.notifyUser,
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "Too many requests" }),
	),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(() => Promise.resolve()),
	emitEventAndBridge: vi.fn(() => Promise.resolve()),
	EVENT_TYPES: { POST_STATUS_CHANGED: "x", POST_CREATED: "y" },
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: () => ({ blocked: false, requiresReview: false, flags: [] }),
	recordSafetyRepost: () => Promise.resolve(false),
	checkSafetyRepost: () => Promise.resolve({ blocked: false }),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
}));

import { notifyUser } from "../../api/_auth.js";

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

const BASE_POST = {
	id: "p1",
	type: "problem",
	title: "Broken cooler on floor two",
	description: "No water since morning",
	category: "Facilities",
	status: "open",
	priority: "medium",
	author_id: "anon-author",
	visibility: "public",
	hidden: false,
	deleted: false,
	created_at: "2026-09-01T00:00:00Z",
	updated_at: "2026-09-01T00:00:00Z",
	admin_reply: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	adminState.isAdmin = false;
	store.posts = [{ ...BASE_POST }];
});

describe("PUT admin actions notify the author", () => {
	it("notifies on admin hide", async () => {
		adminState.isAdmin = true;
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: "p1", hidden: true }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(notifyUser).toHaveBeenCalledWith(
			"anon-author",
			"info",
			"Post hidden by moderators",
			expect.stringContaining("temporarily hidden"),
		);
	});

	it("notifies on admin unhide with success tone", async () => {
		adminState.isAdmin = true;
		store.posts = [{ ...BASE_POST, hidden: true }];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: "p1", hidden: false }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(notifyUser).toHaveBeenCalledWith(
			"anon-author",
			"success",
			"Post visible again",
			expect.any(String),
		);
	});

	it("notifies on admin status change", async () => {
		adminState.isAdmin = true;
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "p1", status: "in_progress" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(notifyUser).toHaveBeenCalledWith(
			"anon-author",
			"info",
			"Update on your post: in progress",
			expect.stringContaining("in progress"),
		);
	});

	it("notifies on admin reply", async () => {
		adminState.isAdmin = true;
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "p1", admin_reply: "Plumber called for Monday" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(notifyUser).toHaveBeenCalledWith(
			"anon-author",
			"info",
			"Admin replied to your post",
			expect.stringContaining("Plumber called"),
		);
	});

	it("does NOT notify on the owner's own edits", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: "p1", locked: true },
				headers: { "x-anon-id": "anon-author" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(notifyUser).not.toHaveBeenCalled();
	});
});

describe("GET author listing hides nothing from the author", () => {
	it("includes the author's own hidden post on self-view", async () => {
		store.posts = [{ ...BASE_POST, hidden: true }];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { author: "anon-author", viewer: "anon-author" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const rows = res.body as Array<{ id: string }>;
		expect(rows.map((r) => r.id)).toContain("p1");
	});

	it("still hides it from strangers", async () => {
		store.posts = [{ ...BASE_POST, hidden: true }];
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { author: "anon-author", viewer: "anon-other" },
				body: {},
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body as unknown[]).toEqual([]);
	});
});
