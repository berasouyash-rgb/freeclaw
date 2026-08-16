// ═══════════════════════════════════════════════════════════════════
// Pre-Publish Review Queue API — admin moderation endpoint
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/pre-review contract (route mount per _index.js routes
// table — /api/pre-publish is a different, POST-only endpoint):
//   1. GET  → list pending review items (settings key `pre_publish_review:*`)
//   2. POST → approve | reject | keep_private | ban
//   3. Every write is error-checked (FIX-#2): a failed ban upsert must
//      500 AND keep the item in the queue — never silently drop the ban.
//   4. Admin-only → 403 without a valid token.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
let settingsDeleteFn = vi.fn();
let usersMetaUpsertFn = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(true),
	auditLog: vi.fn().mockResolvedValue({ error: null }),
	notifyUser: vi.fn(),
}));

type TableState = {
	settingsList?: { data?: unknown; error?: unknown };
	settingsGet?: { data?: unknown; error?: unknown };
	settingsUpdate?: { error?: unknown };
	settingsDelete?: { error?: unknown };
	usersMetaSelect?: { data?: unknown; error?: unknown };
	usersMetaUpsert?: { error?: unknown };
	postsInsert?: { error?: unknown };
};

function mockTables(state: TableState = {}) {
	from.mockImplementation((table: string) => {
		if (table === "settings") {
			return {
				select: vi.fn(() => ({
					like: vi.fn(() => ({
						order: async () => state.settingsList ?? { data: [], error: null },
					})),
					eq: vi.fn(() => {
						const q = Promise.resolve({ data: undefined, error: null });
						return Object.assign(q, {
							maybeSingle: async () =>
								state.settingsGet ?? { data: null, error: null },
						});
					}),
				})),
				update: vi.fn(() => ({
					eq: async () => state.settingsUpdate ?? { error: null },
				})),
				delete: (settingsDeleteFn = vi.fn(() => ({
					eq: async () => state.settingsDelete ?? { error: null },
				}))),
				insert: vi.fn(() => state.postsInsert ?? { error: null }),
			};
		}
		if (table === "users_meta") {
			return {
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: async () =>
							state.usersMetaSelect ?? { data: null, error: null },
					})),
				})),
				upsert: (usersMetaUpsertFn = vi.fn(
					() => state.usersMetaUpsert ?? { error: null },
				)),
			};
		}
		if (table === "posts") {
			return {
				insert: vi.fn(() => state.postsInsert ?? { error: null }),
			};
		}
		return {};
	});
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

const QUEUE_ITEM = {
	key: "pre_publish_review:abc123",
	value: {
		id: "abc123",
		title: "High-risk content",
		content_type: "problem",
		author_id: "anon-9",
		category: "Other",
		priority: "high",
	},
};

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	settingsDeleteFn = vi.fn();
	usersMetaUpsertFn = vi.fn();
	mockTables();
});

describe("GET /api/pre-publish/review", () => {
	it("lists pending review items", async () => {
		mockTables({ settingsList: { data: [QUEUE_ITEM], error: null } });
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{ method: "GET", body: {}, headers: { "x-admin-token": "t" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			total: 1,
			items: [{ key: QUEUE_ITEM.key, id: "abc123", author_id: "anon-9" }],
		});
	});

	it("500s when the queue query fails", async () => {
		mockTables({ settingsList: { data: null, error: { message: "db down" } } });
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{ method: "GET", body: {}, headers: { "x-admin-token": "t" } },
			res,
		);
		expect(res.statusCode).toBe(500);
		expect(res.body).toMatchObject({ error: expect.any(String) });
	});
});

describe("POST /api/pre-publish/review — validation", () => {
	it("403s without admin auth", async () => {
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{ method: "POST", body: { key: "k", action: "approve" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("400s when key or action is missing", async () => {
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{ method: "POST", body: { key: "k" }, headers: { "x-admin-token": "t" } },
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("400s on an unknown action", async () => {
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: "k", action: "nuke" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
	});

	it("404s when the review item is missing", async () => {
		mockTables({ settingsGet: { data: null, error: null } });
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: "pre_publish_review:missing", action: "approve" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(404);
	});
});

describe("POST /api/pre-publish/review — actions", () => {
	it("approve inserts the post and clears the queue item", async () => {
		mockTables({ settingsGet: { data: QUEUE_ITEM, error: null } });
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: QUEUE_ITEM.key, action: "approve" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, action: "approve" });
		const insertCall = from.mock.calls.find(([t]) => t === "posts");
		expect(insertCall).toBeTruthy();
		expect(settingsDeleteFn).toHaveBeenCalled();
	});

	it("approve with a failing post insert → 500 and queue item kept", async () => {
		mockTables({
			settingsGet: { data: QUEUE_ITEM, error: null },
			postsInsert: { error: new Error("insert failed") },
		});
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: QUEUE_ITEM.key, action: "approve" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(500);
		expect(settingsDeleteFn).not.toHaveBeenCalled();
	});

	it("ban upserts banned:true with an appended warning and clears the item", async () => {
		mockTables({
			settingsGet: { data: QUEUE_ITEM, error: null },
			usersMetaSelect: {
				data: {
					anon_id: "anon-9",
					strikes: 2,
					warnings: [{ text: "old", at: "x" }],
				},
				error: null,
			},
		});
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: QUEUE_ITEM.key, action: "ban" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, action: "ban" });
		expect(usersMetaUpsertFn).toHaveBeenCalledWith(
			expect.objectContaining({ anon_id: "anon-9", banned: true, strikes: 3 }),
			{ onConflict: "anon_id" },
		);
		const upsertArg = usersMetaUpsertFn.mock.calls[0][0];
		expect(upsertArg.warnings).toHaveLength(2);
		expect(settingsDeleteFn).toHaveBeenCalled();
	});

	it("ban with a failing upsert → 500 and the queue item is KEPT (FIX-#2)", async () => {
		mockTables({
			settingsGet: { data: QUEUE_ITEM, error: null },
			usersMetaSelect: {
				data: { anon_id: "anon-9", strikes: 0, warnings: [] },
				error: null,
			},
			usersMetaUpsert: { error: new Error("upsert failed") },
		});
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: QUEUE_ITEM.key, action: "ban" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(500);
		// The item must NOT be deleted — a retry must be possible, and a silent
		// "banned" that never persisted is exactly the bug this test forbids.
		expect(settingsDeleteFn).not.toHaveBeenCalled();
	});

	it("ban without an author_id → 400", async () => {
		mockTables({
			settingsGet: {
				data: { key: "k", value: { id: "x", author_id: "anonymous" } },
				error: null,
			},
		});
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: "k", action: "ban" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(usersMetaUpsertFn).not.toHaveBeenCalled();
	});

	it("keep_private with a failing update → 500 and item kept", async () => {
		mockTables({
			settingsGet: { data: QUEUE_ITEM, error: null },
			settingsUpdate: { error: new Error("update failed") },
		});
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: QUEUE_ITEM.key, action: "keep_private" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(500);
		expect(settingsDeleteFn).not.toHaveBeenCalled();
	});

	it("queue delete failure after a committed action still returns 200 (no admin retry duplication)", async () => {
		mockTables({
			settingsGet: { data: QUEUE_ITEM, error: null },
			settingsDelete: { error: new Error("delete failed") },
		});
		const { default: handler } = await import(
			"../../api/_pre-publish-review.js"
		);
		const res = response();
		await handler(
			{
				method: "POST",
				body: { key: QUEUE_ITEM.key, action: "approve" },
				headers: { "x-admin-token": "t" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true });
	});
});
