// Chat titles + owner delete — regression tests.
// Titles are server-derived from the reporter's first words (never
// AI-invented, so no hallucinated names). DELETE works for admins (as
// before) and for owners (thread keyed by their own anon id, session
// proof required); strangers get 403 and nothing is deleted.
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	clientIp: () => "127.0.0.1",
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	cors: vi.fn(),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	verifyCallerIdentity: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
}));
vi.mock("../../api/_auth.js", () => authMocks);

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
}));
vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: vi.fn(() => false),
	TEST_THREAD_ID_RE: /(^test_|_test$)/,
}));

// Tiny in-memory supabase double: threads + messages tables.
const db = vi.hoisted(() => ({
	threads: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
	deleted: [] as Array<{ table: string; id: unknown }>,
}));

function chain(table: string) {
	const filters: Array<[string, unknown]> = [];
	let op = "select";
	let ordering: { col: string; asc: boolean } | null = null;
	let limitN: number | null = null;
	const rows = () =>
		(table === "chat_threads" ? db.threads : db.messages).filter((r) =>
			filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
		);
	const self: Record<string, unknown> = {
		select: () => self,
		eq: (c: string, v: unknown) => {
			filters.push([c, v]);
			return self;
		},
		order: (c: string, o?: { ascending?: boolean }) => {
			ordering = { col: c, asc: o?.ascending !== false };
			return self;
		},
		limit: (n: number) => {
			limitN = n;
			return self;
		},
		maybeSingle: () => self,
		single: () => self,
		delete: () => {
			op = "delete";
			return self;
		},
		update: () => self,
		insert: () => self,
		then: (fn: (v: unknown) => void) => {
			if (op === "delete") {
				for (const r of rows())
					db.deleted.push({
						table,
						id: (r as Record<string, unknown>).thread_id ?? (r as Record<string, unknown>).id,
					});
				if (table === "chat_threads")
					db.threads = db.threads.filter((r) => !rows().includes(r));
				if (table === "chat_messages")
					db.messages = db.messages.filter((r) => !rows().includes(r));
				fn({ data: null, error: null });
				return;
			}
			let out = rows();
			if (ordering)
				out = [...out].sort((a, b) => {
					const av = String((a as Record<string, unknown>)[ordering!.col] ?? "");
					const bv = String((b as Record<string, unknown>)[ordering!.col] ?? "");
					return ordering!.asc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
				});
			if (limitN !== null) out = out.slice(0, limitN);
			fn({ data: out, error: null });
		},
	};
	return self;
}
const from = vi.fn((t: string) => chain(t));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		setHeader() {
			return res;
		},
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(body: unknown) {
			res.body = body;
			return res;
		},
		end() {
			return res;
		},
	};
	return res;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	db.threads = [];
	db.messages = [];
	db.deleted = [];
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.checkUser.mockResolvedValue({ ok: true });
	authMocks.verifyCallerIdentity.mockResolvedValue({ ok: true });
});

async function call(
	method: string,
	opts: { query?: Record<string, unknown>; body?: Record<string, unknown>; headers?: Record<string, string> },
) {
	const { default: handler } = await import("../../api/_chat.js");
	const res = response();
	await handler(
		{
			method,
			query: opts.query ?? {},
			body: opts.body ?? {},
			headers: opts.headers ?? {},
			socket: { remoteAddress: "127.0.0.1" },
		},
		res,
	);
	return res;
}

const seedThread = () => {
	db.threads = [{ thread_id: "t1", status: "open", updated_at: "2026-09-29T10:00:00Z" }];
	db.messages = [
		{ id: "m1", thread_id: "t1", sender: "user", body: "my canteen food complaint here", created_at: "2026-09-29T09:00:00Z", read: true },
		{ id: "m2", thread_id: "t1", sender: "ai", body: "noted", created_at: "2026-09-29T09:01:00Z", read: true },
		{ id: "m3", thread_id: "t1", sender: "user", body: "also the water", created_at: "2026-09-29T09:02:00Z", read: false },
	];
};

describe("chat thread titles (derived, never invented)", () => {
	it("titles the threads listing from the reporter's first words", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		seedThread();
		const res = await call("GET", { query: { threads: "1" }, headers: { "x-admin-token": "tok" } });
		expect(res.statusCode).toBe(200);
		const rows = res.body as Array<{ title: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe("my canteen food complaint here");
	});

	it("falls back to Conversation on empty threads", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		db.threads = [{ thread_id: "t9", status: "open", updated_at: "2026-09-29T10:00:00Z" }];
		const res = await call("GET", { query: { threads: "1" }, headers: { "x-admin-token": "tok" } });
		const rows = res.body as Array<{ title: string }>;
		expect(rows[0].title).toBe("Conversation");
	});

	it("titles the single-thread response the same way", async () => {
		seedThread();
		const res = await call("GET", {
			query: { thread_id: "t1" },
			headers: { "x-anon-id": "anon-owner" },
		});
		expect(res.statusCode).toBe(200);
		expect((res.body as { title: string }).title).toBe("my canteen food complaint here");
		expect((res.body as { messages: unknown[] }).messages).toHaveLength(3);
	});
});

describe("chat DELETE — admin and owner", () => {
	it("lets an admin delete any thread and audits it", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		seedThread();
		const res = await call("DELETE", {
			body: { thread_id: "t1" },
			headers: { "x-admin-token": "tok" },
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(db.threads).toHaveLength(0);
		expect(db.messages).toHaveLength(0);
		expect(authMocks.auditLog).toHaveBeenCalledWith("chat", "thread_deleted", "t1 by admin");
	});

	it("lets the owner delete their own thread with session proof", async () => {
		seedThread();
		db.threads = [{ thread_id: "anon-owner", status: "open", updated_at: "2026-09-29T10:00:00Z" }];
		db.messages = [{ id: "m1", thread_id: "anon-owner", sender: "user", body: "hi", created_at: "2026-09-29T09:00:00Z", read: true }];
		const res = await call("DELETE", {
			body: { thread_id: "anon-owner" },
			headers: { "x-anon-id": "anon-owner" },
		});
		expect(res.statusCode).toBe(200);
		expect(db.threads).toHaveLength(0);
		expect(authMocks.verifyCallerIdentity).toHaveBeenCalled();
		expect(authMocks.auditLog).toHaveBeenCalledWith("chat", "thread_deleted", "anon-owner by owner");
	});

	it("refuses a stranger with 403 and deletes nothing", async () => {
		seedThread();
		const res = await call("DELETE", {
			body: { thread_id: "t1" },
			headers: { "x-anon-id": "anon-stranger" },
		});
		expect(res.statusCode).toBe(403);
		expect(db.threads).toHaveLength(1);
		expect(db.messages).toHaveLength(3);
		expect(db.deleted).toHaveLength(0);
	});

	it("refuses an owner whose session proof fails", async () => {
		authMocks.verifyCallerIdentity.mockResolvedValueOnce({ ok: false, status: 403, error: "Invalid session identity" });
		seedThread();
		db.threads = [{ thread_id: "anon-owner", status: "open", updated_at: "2026-09-29T10:00:00Z" }];
		const res = await call("DELETE", {
			body: { thread_id: "anon-owner" },
			headers: { "x-anon-id": "anon-owner" },
		});
		expect(res.statusCode).toBe(403);
		expect(db.threads).toHaveLength(1);
	});
});
