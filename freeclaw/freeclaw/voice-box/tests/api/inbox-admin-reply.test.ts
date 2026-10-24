// ═══════════════════════════════════════════════════════════════════
// Inbox admin_reply — the reply must be PROVEN stored before the API says ok
// ═══════════════════════════════════════════════════════════════════
// REGRESSION: `admin_reply` destructured ONLY `data` from the insert —
// `error` was discarded entirely. So when the reply insert failed the handler
// still: marked the thread handed-off to the admin, marked the user's
// messages READ, wrote an "inbox_reply" audit entry, and answered
// `200 { ok: true, message: null }`.
//
// Impact: the admin's support reply was never delivered, the user's unread
// messages were silently consumed, and the audit trail claimed a reply that
// does not exist. This is the platform's core support workflow.
//
// Contract:
//   1. The reply insert must be checked (`error`) and must return a row.
//   2. No downstream state mutation (handoff flag, thread status, mark-read,
//      audit) may run unless the reply is proven persisted.
//   3. A failure surfaces loudly — never ok:true.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	threads: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
	settings: [] as Array<Record<string, unknown>>,
	insertErrors: {} as Record<string, Error | undefined>,
	upsertErrors: {} as Record<string, Error | undefined>,
	inserted: [] as Array<Record<string, unknown>>,
	updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
	markReadCalls: 0,
}));

type Chain = Record<string, unknown> & {
	then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
	const filters: Array<[string, unknown]> = [];
	let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
	let patch: Record<string, unknown> | null = null;
	let single = false;
	const rows = () =>
		table === "chat_threads"
			? state.threads
			: table === "chat_messages"
				? state.messages
				: state.settings;

	const matches = (r: Record<string, unknown>) =>
		filters.every(([c, v]) => r[c] === v);

	const self: Chain = {
		then(fn) {
			if (op === "insert") {
				const err = state.insertErrors[table];
				if (err) {
					fn({ data: null, error: err });
					return;
				}
				const row = { ...(patch ?? {}) };
				state.inserted.push(row);
				rows().push(row);
				fn({ data: single ? row : [row], error: null });
				return;
			}
			if (op === "upsert") {
				const err = state.upsertErrors[table];
				if (err) {
					fn({ data: null, error: err });
					return;
				}
				const row = { ...(patch ?? {}) };
				rows().push(row);
				fn({ data: row, error: null });
				return;
			}
			if (op === "update") {
				state.updates.push({ table, patch: patch ?? {} });
				// Mark-read is the `.eq("sender","user")` update.
				if (table === "chat_messages" && filters.length) {
					state.markReadCalls++;
					for (const r of rows()) if (matches(r)) r.read = true;
				}
				fn({ data: null, error: null });
				return;
			}
			const matched = rows().filter(matches);
			if (single) {
				fn({ data: matched[0] ?? null, error: null });
				return;
			}
			fn({ data: matched, error: null });
		},
		select() {
			return self;
		},
		single() {
			single = true;
			return self;
		},
		maybeSingle() {
			single = true;
			return self;
		},
		insert(row: Record<string, unknown>) {
			op = "insert";
			patch = row;
			return self;
		},
		update(row: Record<string, unknown>) {
			op = "update";
			patch = row;
			return self;
		},
		upsert(row: Record<string, unknown>) {
			op = "upsert";
			patch = row;
			return self;
		},
		delete() {
			op = "delete";
			return self;
		},
		eq(col: string, val: unknown) {
			filters.push([col, val]);
			return self;
		},
	};
	return self;
}

const from = vi.fn((table: string) => chainFor(table));

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

// create_task routes through the workforce queue; only its return value
// matters here, so it is stubbed to the "task created" happy path.
const workforceMocks = vi.hoisted(() => ({
	createTask: vi.fn(),
}));
vi.mock("../../api/_workforce.js", () => ({
	createTask: workforceMocks.createTask,
	...(workforceMocks.createTask ? {} : {}),
}));

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	clientIp: (req: {
		headers?: Record<string, string | undefined>;
		socket?: { remoteAddress?: string };
	}) =>
		String(
			req?.headers?.["x-forwarded-for"] ||
				req?.socket?.remoteAddress ||
				"unknown",
		),
}));
vi.mock("../../api/_auth.js", () => ({
	...authMocks,
	cors: vi.fn(),
	clean: (s: unknown) => String(s ?? ""),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
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
		setHeader() {
			return res;
		},
	};
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	state.threads = [{ thread_id: "thread-1", status: "open" }];
	state.messages = [{ thread_id: "thread-1", sender: "user", body: "help", read: false }];
	state.settings = [];
	state.insertErrors = {};
	state.upsertErrors = {};
	state.inserted = [];
	state.updates = [];
	state.markReadCalls = 0;
	authMocks.isAdmin.mockResolvedValue(true);
	authMocks.auditLog.mockResolvedValue(undefined);
	workforceMocks.createTask.mockResolvedValue({ id: "task-1", title: "Fix lift" });
});

async function callCreateTask() {
	const { default: handler } = await import("../../api/_inbox.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			headers: { "x-anon-id": "anon-1" },
			body: {
				action: "create_task",
				thread_id: "thread-1",
				body: "The lift in block C is broken",
				agent_id: "facilities",
			},
		},
		res,
	);
	return res;
}

describe("POST /api/inbox set_ai_mode — the platform-wide AI kill switch", () => {
	async function callSetAiMode(enabled: boolean) {
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				headers: { "x-anon-id": "anon-1" },
				// The action sits behind the shared thread_id validation gate, so
				// the request carries a valid one even though the toggle is
				// platform-wide.
				body: { action: "set_ai_mode", enabled, thread_id: "thread-1" },
			},
			res,
		);
		return res;
	}

	it("persists the new AI mode", async () => {
		const res = await callSetAiMode(false);
		expect(res.statusCode).toBe(200);
		expect((res.body as { enabled: boolean }).enabled).toBe(false);
		expect(
			state.settings.some(
				(s) =>
					s.key === "inbox_ai_config" &&
					(s.value as { enabled?: boolean })?.enabled === false,
			),
		).toBe(true);
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"inbox_ai_mode",
			expect.stringContaining("disabled"),
		);
	});

	// REGRESSION: the upsert was unchecked, so a failed kill-switch write was
	// reported as applied and audited as "disabled platform-wide" while AI
	// replies stayed ON for every user. Safety-relevant: this toggle exists to
	// turn the behaviour off.
	it("never reports a kill switch as applied when the write failed", async () => {
		state.upsertErrors.settings = new Error("ai mode write failed");
		await expect(callSetAiMode(false)).rejects.toThrow("ai mode write failed");
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"inbox_ai_mode",
			expect.anything(),
		);
	});
});

describe("POST /api/inbox create_task", () => {
	it("creates the task and records the confirmation in the thread", async () => {
		const res = await callCreateTask();
		expect(res.statusCode).toBe(201);
		expect(workforceMocks.createTask).toHaveBeenCalled();
		const systemMsg = state.inserted.find(
			(m) => m.sender === "system",
		) as Record<string, unknown> | undefined;
		expect(systemMsg).toBeDefined();
		expect(systemMsg?.thread_id).toBe("thread-1");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"inbox_task",
			expect.stringContaining("thread-1"),
		);
	});

	// REGRESSION: the system-message insert was unchecked, so the task could
	// be created while the conversation silently showed no confirmation.
	it("fails loudly when the thread confirmation cannot be written", async () => {
		state.insertErrors.chat_messages = new Error("confirmation insert failed");
		await expect(callCreateTask()).rejects.toThrow(
			"confirmation insert failed",
		);
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"inbox_task",
			expect.stringContaining("thread-1"),
		);
	});
});

async function callReply(body = "We are on it") {
	const { default: handler } = await import("../../api/_inbox.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			headers: { "x-anon-id": "anon-1" },
			body: { action: "admin_reply", thread_id: "thread-1", body },
		},
		res,
	);
	return res;
}

describe("POST /api/inbox admin_reply", () => {
	it("stores the reply and reports the persisted message", async () => {
		const res = await callReply();
		expect(res.statusCode).toBe(200);
		expect((res.body as { ok: boolean }).ok).toBe(true);
		expect(state.inserted).toHaveLength(1);
		expect(state.inserted[0]).toMatchObject({
			thread_id: "thread-1",
			sender: "admin",
			body: "We are on it",
		});
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"inbox_reply",
			"Admin replied to thread-1",
		);
	});

	it("fails loudly when the reply insert errors — no false success", async () => {
		state.insertErrors.chat_messages = new Error("reply insert failed");
		await expect(callReply()).rejects.toThrow("reply insert failed");
	});

	it("does not consume the user's unread messages when the reply was not stored", async () => {
		state.insertErrors.chat_messages = new Error("reply insert failed");
		await expect(callReply()).rejects.toThrow("reply insert failed");
		// The user must not lose their unread flag, and no reply may be audited.
		expect(state.messages[0]?.read).toBe(false);
		expect(state.markReadCalls).toBe(0);
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"inbox_reply",
			"Admin replied to thread-1",
		);
	});

	it("fails when the insert reports success but persists no row", async () => {
		// A driver that resolves `{ data: null, error: null }` must not be
		// reported as a delivered reply.
		const { default: handler } = await import("../../api/_inbox.js");
		const realFrom = from.getMockImplementation()!;
		from.mockImplementation((table: string) => {
			if (table !== "chat_messages") return realFrom(table);
			const c = chainFor(table);
			c.then = (fn: (v: unknown) => void) => fn({ data: null, error: null });
			return c;
		});
		try {
			const res = response();
			await expect(
				handler(
					{
						method: "POST",
						query: {},
						headers: { "x-anon-id": "anon-1" },
						body: { action: "admin_reply", thread_id: "thread-1", body: "hi" },
					},
					res,
				),
			).rejects.toThrow();
		} finally {
			from.mockImplementation(realFrom);
		}
	});
});
