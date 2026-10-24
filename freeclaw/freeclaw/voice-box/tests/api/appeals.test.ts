// Appeals — recourse for safety-blocked content (Phase 1).
// Locks: open filing even for blocked words (classified, never gated),
// idempotent refiles, open-cap, owner-only reads, uphold (notify, no
// publish), overturn (publish + verify + fingerprint clear + notify),
// closed-appeal conflicts, fingerprint removal unit.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	settings: new Map<string, unknown>(),
	posts: [] as Array<Record<string, unknown>>,
	comments: [] as Array<Record<string, unknown>>,
	admin: false,
}));
const auth = vi.hoisted(() => ({
	auditLog: vi.fn(async () => {}),
	notifyUser: vi.fn(async () => true),
	ensureUser: vi.fn(async () => {}),
}));
const pipe = vi.hoisted(() => ({
	evaluateContent: vi.fn(() => ({ flags: [{ type: "profanity" }] })),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));
function mockFrom(table: string) {
	if (table === "settings") {
		return {
			select: () => ({
				eq: (_c: string, key: string) => ({
					maybeSingle: async () => ({
						data: db.settings.has(key) ? { value: db.settings.get(key) } : null,
						error: null,
					}),
				}),
				like: (_c: string, prefix: string) => {
					const stem = prefix.replace(/%$/, "");
					const rows = [...db.settings.entries()]
						.filter(([k]) => k.startsWith(stem))
						.map(([key, value]) => ({ key, value }));
					return Promise.resolve({ data: rows, error: null });
				},
			}),
			upsert: async (row: { key: string; value: unknown }) => {
				db.settings.set(row.key, row.value);
				return { error: null };
			},
		};
	}
	if (table === "posts" || table === "comments") {
		const store = table === "posts" ? db.posts : db.comments;
		return {
			insert: (row: Record<string, unknown>) => {
				store.push({ ...row });
				return {
					select: () => ({
						single: async () => ({ data: { ...row }, error: null }),
					}),
				};
			},
			select: () => ({
				eq: (_c: string, id: string) => ({
					maybeSingle: async () => ({
						data: store.find((r) => r.id === id) || null,
						error: null,
					}),
				}),
			}),
		};
	}
	throw new Error("unexpected table " + table);
}

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn(async () => db.admin),
	ensureUser: auth.ensureUser,
	auditLog: auth.auditLog,
	notifyUser: auth.notifyUser,
	rateLimited: vi.fn(async () => false),
	rateLimitResponse: vi.fn((res) => res.status(429).json({ error: "slow" })),
}));
vi.mock("../../api/_safety-pipeline.js", () => pipe);
vi.mock("../../api/_polls.js", () => ({
	createPoll: vi.fn(async () => ({ ok: true, poll: { id: "poll_overturned" } })),
}));

import handler from "../../api/_appeals.js";
import { clearSafetyRepost, fingerprintSafetyText } from "../../api/_moderation.js";

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
const userHeaders = { "x-anon-id": "anon-1" };

beforeEach(() => {
	vi.clearAllMocks();
	db.settings.clear();
	db.posts.length = 0;
	db.comments.length = 0;
	db.admin = false;
	pipe.evaluateContent.mockReturnValue({ flags: [{ type: "profanity" }] });
});

async function fileAppeal(over: Record<string, unknown> = {}) {
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body: {
				surface: "post",
				author_id: "anon-1",
				title: "Canteen sucks",
				body: "The canteen food sucks every day",
				reason: "honest complaint about food",
				...over,
			},
			headers: userHeaders,
		},
		res,
	);
	return res;
}

describe("POST /api/appeals — filing", () => {
	it("files openly even though the text is blocked (classified, never gated)", async () => {
		const res = await fileAppeal();
		expect(res.statusCode).toBe(201);
		const id = (res.body as { id: string }).id;
		expect(id).toMatch(/^apl_/);
		const stored = db.settings.get(`appeal:${id}`) as Record<string, unknown>;
		expect(stored.status).toBe("open");
		expect(stored.flags).toEqual(["profanity"]);
		expect(auth.auditLog).toHaveBeenCalledWith("moderation", "appeal_filed", expect.any(String));
	});

	it("dedupes a same-text refile to the open appeal (idempotent)", async () => {
		const first = await fileAppeal();
		const second = await fileAppeal();
		expect(second.statusCode).toBe(200);
		expect((second.body as { deduped: boolean }).deduped).toBe(true);
		expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
		expect([...db.settings.keys()].filter((k) => k.startsWith("appeal:"))).toHaveLength(1);
	});

	it("rejects beyond 3 open appeals per author", async () => {
		for (let i = 0; i < 3; i++) await fileAppeal({ title: `Grievance ${i}`, body: `blocked text number ${i} sucks` });
		const res = await fileAppeal({ title: "One too many", body: "extra blocked sucks" });
		expect(res.statusCode).toBe(429);
		expect((res.body as { code: string }).code).toBe("APPEALS_EXHAUSTED");
	});

	it("requires comment appeals to name their post", async () => {
		const res = await fileAppeal({ surface: "comment", post_id: undefined });
		expect(res.statusCode).toBe(400);
	});
});

describe("GET /api/appeals — owner-only reads", () => {
	it("a user sees only their own appeals", async () => {
		await fileAppeal();
		const other = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { surface: "post", author_id: "anon-2", title: "X sucks", body: "Y sucks", reason: "r" },
				headers: { "x-anon-id": "anon-2" },
			},
			other,
		);
		expect(other.statusCode).toBe(201);
		const mine = response();
		await handler({ method: "GET", query: {}, body: {}, headers: userHeaders }, mine);
		expect(mine.statusCode).toBe(200);
		expect((mine.body as { total: number }).total).toBe(1);
	});

	it("admins see everything", async () => {
		await fileAppeal();
		db.admin = true;
		const res = response();
		await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
		expect((res.body as { total: number }).total).toBe(1);
	});
});

describe("PUT /api/appeals — review", () => {
	it("rejects non-admin review", async () => {
		const filed = await fileAppeal();
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: (filed.body as { id: string }).id, decision: "uphold" }, headers: userHeaders },
			res,
		);
		expect(res.statusCode).toBe(401);
	});

	it("uphold closes with a receipt and publishes nothing", async () => {
		const filed = await fileAppeal();
		db.admin = true;
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: { id: (filed.body as { id: string }).id, decision: "uphold", note: "slur, stands" },
				headers: {},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { status: string }).status).toBe("upheld");
		expect(db.posts).toHaveLength(0);
		expect(auth.notifyUser).toHaveBeenCalledWith("anon-1", "info", expect.stringContaining("stays down"), expect.any(String));
	});

	it("overturn publishes the post, verifies, clears the fingerprint, notifies", async () => {
		db.settings.set("safety_repost_blocklist", {
			items: [{ fp: fingerprintSafetyText("Canteen sucks The canteen food sucks every day"), rule: "profanity", attempts: 1 }],
		});
		const filed = await fileAppeal();
		const id = (filed.body as { id: string }).id;
		db.admin = true;
		const res = response();
		await handler({ method: "PUT", query: {}, body: { id, decision: "overturn" }, headers: {} }, res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ status: "overturned", verified: true, fingerprint_cleared: true });
		expect(db.posts).toHaveLength(1);
		expect(db.posts[0].status).toBe("reported");
		const blocklist = (db.settings.get("safety_repost_blocklist") as { items: unknown[] }).items;
		expect(blocklist).toHaveLength(0);
		expect(auth.notifyUser).toHaveBeenCalledWith("anon-1", "info", expect.stringContaining("live"), expect.any(String));
	});

	it("overturn publishes a comment against its post", async () => {
		const filed = await fileAppeal({ surface: "comment", post_id: "p1", parent_id: null });
		db.admin = true;
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: (filed.body as { id: string }).id, decision: "overturn" }, headers: {} },
			res,
		);
		expect(res.body).toMatchObject({ status: "overturned", verified: true });
		expect(db.comments).toHaveLength(1);
		expect(db.comments[0].post_id).toBe("p1");
	});

	it("a closed appeal conflicts instead of double-deciding", async () => {
		const filed = await fileAppeal();
		db.admin = true;
		const id = (filed.body as { id: string }).id;
		const first = response();
		await handler({ method: "PUT", query: {}, body: { id, decision: "uphold" }, headers: {} }, first);
		expect(first.statusCode).toBe(200);
		const second = response();
		await handler({ method: "PUT", query: {}, body: { id, decision: "overturn" }, headers: {} }, second);
		expect(second.statusCode).toBe(409);
		expect((second.body as { code: string }).code).toBe("APPEAL_CLOSED");
		expect(db.posts).toHaveLength(0);
	});
});

describe("clearSafetyRepost", () => {
	it("removes the matching fingerprint and reports absence honestly", async () => {
		db.settings.set("safety_repost_blocklist", { items: [{ fp: fingerprintSafetyText("alpha beta gamma delta"), rule: "x", attempts: 2 }] });
		const supabase = (await import("../../api/_db-client.js")).default;
		expect(await clearSafetyRepost(supabase, "alpha beta gamma delta")).toBe(true);
		expect(await clearSafetyRepost(supabase, "alpha beta gamma delta")).toBe(false);
		expect(await clearSafetyRepost(supabase, "unrelated text here")).toBe(false);
	});
});
