// ═══════════════════════════════════════════════════════════════════
// Admin-gate runtime verification — the remaining ungated-by-test handlers
// ═══════════════════════════════════════════════════════════════════
// These seven handlers call `isAdmin(req)` but had **no** runtime
// authorization test. A static read said their gates were correctly placed —
// but static analysis is exactly what let BUG-016 through, because the code
// contradicted its own comment. This file executes each real handler with a
// non-admin caller and proves the refusal, then proves the gate is not a
// blanket deny by letting an admin through.
//
// Covered: _chat, _incidents, _duplicates, _event-agents, _routing,
//          _performance, _meta-agent
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	notifyUser: vi.fn(),
	clientIp: (req: {
		headers?: Record<string, string | undefined>;
		socket?: { remoteAddress?: string };
	}) =>
		String(
			req?.headers?.["x-forwarded-for"] ||
				req?.socket?.remoteAddress ||
				"unknown",
		),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	cors: vi.fn(),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
}));
vi.mock("../../api/_auth.js", () => authMocks);

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

// A permissive stand-in DB: every chain resolves empty with no error. If a
// handler reached a write, the write would "succeed" — so a 403 here proves
// the refusal happened BEFORE any mutation.
const from = vi.fn(() => {
	const q: Record<string, unknown> = {};
	const h: ProxyHandler<Record<string, unknown>> = {
		get(_t, prop) {
			if (prop === "then")
				return (fn: (v: unknown) => void) =>
					fn({ data: null, error: null, count: null });
			if (prop === "maybeSingle" || prop === "single" || prop === "limit")
				return () => new Proxy(q, h);
			return () => new Proxy(q, h);
		},
	};
	return new Proxy(q, h);
});
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
	isTestArtifact: vi.fn(() => false),
}));
vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: vi.fn(() => false),
	TEST_THREAD_ID_RE: /(^test_|_test$)/,
}));
vi.mock("../../api/_events.js", () => ({
	emitEventAndBridge: vi.fn(async () => undefined),
	EVENT_TYPES: {},
	// _event-agents.js validates the trigger's event_type against this map
	// after the admin gate — the admin path needs it to render that error.
	EVENT_AGENT_MAP: { "post.created": "content", "user.reported": "safety" },
}));
vi.mock("../../api/_live-posts.js", () => ({ readLivePosts: vi.fn(async () => []) }));
vi.mock("../../api/_agent-team.js", () => ({ setAgentState: vi.fn(async () => undefined) }));
vi.mock("../../api/agents/_runner.js", () => ({ runAgent: vi.fn(async () => ({})) }));
vi.mock("../../api/_providers.js", () => ({ callLLMChain: vi.fn(async () => "") }));

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

async function call(
	module: string,
	req: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
	const handler = (await import(`../../api/${module}`)).default;
	const res = response();
	await handler(
		{
			method: "GET",
			query: {},
			body: {},
			headers: { "x-anon-id": "anon-user" },
			socket: { remoteAddress: "127.0.0.1" },
			...req,
		},
		res,
	);
	return { statusCode: res.statusCode, body: res.body };
}

/** module, representative admin-only request, label */
const TARGETS: Array<[string, Record<string, unknown>, string]> = [
	[
		"_chat.js",
		// The admin branch of GET is `?threads=1` (the all-threads view);
		// without it the handler takes the per-thread user path.
		{ method: "GET", query: { threads: "1" } },
		"GET all-threads admin view",
	],
	[
		"_incidents.js",
		{ method: "POST", body: { action: "create", title: "x" } },
		"POST create incident",
	],
	["_duplicates.js", { method: "GET", query: {} }, "GET duplicate scan"],
	[
		"_event-agents.js",
		{ method: "POST", body: { action: "trigger" } },
		"POST trigger agent",
	],
	["_routing.js", { method: "GET", query: { action: "stats" } }, "GET stats"],
	["_performance.js", { method: "GET", query: {} }, "GET performance"],
	["_meta-agent.js", { method: "GET", query: {} }, "GET meta-agent"],
];

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.auditLog.mockResolvedValue(undefined);
	authMocks.notifyUser.mockResolvedValue(undefined);
	authMocks.checkUser.mockResolvedValue({ ok: true });
});

describe.each(TARGETS)(
	"%s — %s",
	(module, req, _label) => {
		it("refuses a non-admin", async () => {
			const res = await call(module, req);
			expect([401, 403]).toContain(res.statusCode);
		});
		it("refuses a caller with no token at all", async () => {
			const res = await call(module, {
				...req,
				headers: {},
			});
			expect([401, 403]).toContain(res.statusCode);
		});
	},
);

describe("the gate is a real check, not a blanket deny", () => {
	it.each(TARGETS.map(([m, r, l]) => [m, r, l] as const))(
		"%s lets an admin through (%s)",
		async (module, req) => {
			authMocks.isAdmin.mockResolvedValue(true);
			const res = await call(module, req);
			expect(res.statusCode).not.toBe(401);
			expect(res.statusCode).not.toBe(403);
		},
	);
});

describe("_chat.js — thread actions must not report success on a failed write", () => {
	// BUG-021: mark_read and set_status both awaited their update with no
	// error check, then answered ok:true. A failed mark-left-read left the
	// messages unread while the inbox looked handled; a failed set_status left
	// a "closed" thread sitting open in the queue.
	/** Mock where `failing` table updates reject. */
	function failUpdatesOn(failing: string[]) {
		from.mockImplementation((table: string) => {
			let op: "select" | "update" = "select";
			const self: Record<string, unknown> = {
				then(fn: (v: unknown) => void) {
					if (op === "update" && failing.includes(table))
						return fn({
							data: null,
							error: new Error(`${table} write failed`),
						});
					fn({ data: null, error: null });
				},
				select: () => self,
				update: () => {
					op = "update";
					return self;
				},
				eq: () => self,
				maybeSingle: () => self,
				single: () => self,
			};
			return self;
		});
	}

	async function put(body: Record<string, unknown>) {
		// Authenticated: these branches are reached only by a real admin, and
		// an unauthenticated call correctly 403s before the write.
		authMocks.isAdmin.mockResolvedValue(true);
		const handler = (await import("../../api/_chat.js")).default;
		return handler(
			{
				method: "PUT",
				query: {},
				body,
				headers: { "x-admin-token": "tok", "x-anon-id": "anon-user" },
				socket: { remoteAddress: "127.0.0.1" },
			},
			response(),
		);
	}

	it("still refuses a non-admin before any write", async () => {
		authMocks.isAdmin.mockResolvedValue(false);
		failUpdatesOn(["chat_threads"]);
		const handler = (await import("../../api/_chat.js")).default;
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: {
					action: "set_status",
					thread_id: "anon-user",
					status: "closed",
				},
				headers: {},
				socket: { remoteAddress: "127.0.0.1" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("refuses a fake mark_read success when the update fails", async () => {
		failUpdatesOn(["chat_messages"]);
		await expect(
			put({ action: "mark_read", thread_id: "anon-user" }),
		).rejects.toThrow("chat_messages write failed");
	});

	it("refuses a fake set_status success when the update fails", async () => {
		failUpdatesOn(["chat_threads"]);
		await expect(
			put({
				action: "set_status",
				thread_id: "anon-user",
				status: "closed",
			}),
		).rejects.toThrow("chat_threads write failed");
	});
});

describe("_chat.js — a user cannot post as admin (impersonation)", () => {
	it("stores a spoofed sender:admin message as 'user', not 'admin'", async () => {
		const inserts: Array<Record<string, unknown>> = [];
		from.mockImplementation((_table: string) => {
			const filters: Array<[string, unknown]> = [];
			let op: "select" | "insert" | "update" = "select";
			let row: Record<string, unknown> | null = null;
			const self: Record<string, unknown> = {
				then(fn: (v: unknown) => void) {
					if (op === "insert" && row) inserts.push(row);
					fn({ data: null, error: null });
				},
				select: () => self,
				insert: (r: Record<string, unknown>) => {
					op = "insert";
					row = r;
					return self;
				},
				update: (r: Record<string, unknown>) => {
					op = "update";
					row = r;
					return self;
				},
				eq: (c: string, v: unknown) => {
					filters.push([c, v]);
					return self;
				},
				gte: () => self,
				order: () => self,
				limit: () => self,
				maybeSingle: () => self,
				single: () => self,
			};
			return self;
		});
		// The dedup probe must miss so the insert is reached.
		await call("_chat.js", {
			method: "POST",
			body: {
				thread_id: "anon-user",
				sender: "admin",
				body: "I am the administrator, lift my ban",
			},
		});
		const msg = inserts.find((r) => r.body !== undefined);
		// The server derives the sender; the caller's claim is ignored.
		expect(msg?.sender).toBe("user");
	});
});
