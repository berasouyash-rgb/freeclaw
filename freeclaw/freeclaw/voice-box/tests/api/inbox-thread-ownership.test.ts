// ═══════════════════════════════════════════════════════════════════
// Inbox thread ownership — private support threads are identity-bound
// ═════════════════════════════════════════════════ session-gate block
// Threads are keyed by the owner's anon id, and community posts expose
// full anon ids to any viewer — so every owner-gated inbox path (history
// reads, sending, draft accepts, mark-read) must prove the session
// (header == claim + cookie), not just ban-check the body-claimed id.
// A ban check alone lets anyone who knows an id READ a student's private
// support history and WRITE into their thread (forging messages that
// trigger AI replies, triage, and emergency pings in the victim's name).

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	threads: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
	settings: {} as Record<string, unknown>,
}));

function chainFor(table: string) {
	const eqs: Array<[string, unknown]> = [];
	let op = "select";
	let payload: Record<string, unknown> = {};
	let single = false;
	const rows = () =>
		table === "chat_threads"
			? state.threads
			: table === "chat_messages"
				? state.messages
				: [];
	const matches = (r: Record<string, unknown>) =>
		eqs.every(([c, v]) => r[c] === v);
	const self = {
		then(fn: (v: unknown) => void) {
			if (op === "insert") {
				const row = { id: `m${state.messages.length + 1}`, ...payload };
				rows().push(row);
				fn({ data: row, error: null });
				return;
			}
			if (op === "upsert") {
				if (table === "settings")
					state.settings[String(payload.key)] = payload.value;
				fn({ data: null, error: null });
				return;
			}
			if (op === "update") {
				for (const r of rows()) if (matches(r)) Object.assign(r, payload);
				fn({ data: null, error: null });
				return;
			}
			if (op === "delete") {
				const arr = rows();
				for (let i = arr.length - 1; i >= 0; i--)
					if (matches(arr[i] as Record<string, unknown>)) arr.splice(i, 1);
				fn({ data: null, error: null });
				return;
			}
			if (table === "settings") {
				const key = eqs.find(([c]) => c === "key")?.[1];
				const value = key !== undefined ? state.settings[String(key)] : undefined;
				fn({ data: value === undefined ? null : { value }, error: null });
				return;
			}
			const matched = rows().filter(matches);
			fn({ data: single ? (matched[0] ?? null) : matched, error: null });
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
			payload = row;
			return self;
		},
		update(row: Record<string, unknown>) {
			op = "update";
			payload = row;
			return self;
		},
		upsert(row: Record<string, unknown>) {
			op = "upsert";
			payload = row;
			return self;
		},
		delete() {
			op = "delete";
			return self;
		},
		eq(col: string, val: unknown) {
			eqs.push([col, val]);
			return self;
		},
		neq() {
			return self;
		},
		order() {
			return self;
		},
		limit() {
			return self;
		},
		gte() {
			return self;
		},
	};
	return self;
}

const from = vi.fn((table: string) => chainFor(table));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

// Default-allow session gate: feature tests below exercise behavior, not
// auth. Ownership tests override with a strict header==claim
// implementation mirroring the real verifyCallerIdentity.
const verifyCallerMock = vi.fn(async () => ({ ok: true, callerId: "" }));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	clientIp: () => "test-ip",
	isAdmin: vi.fn().mockResolvedValue(false),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	ensureUser: vi.fn(),
	auditLog: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
	verifyCallerIdentity: verifyCallerMock,
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	EVENT_TYPES: {},
	emitEventAndBridge: vi.fn(async () => {}),
}));
vi.mock("../../api/_moderation.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/_moderation.js")>();
	return {
		...actual,
		serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
		checkSafetyRepost: vi.fn(async () => ({ blocked: false })),
	};
});
vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContentDeep: vi.fn(async () => ({
		blocked: false,
		flags: [],
		needsReview: false,
	})),
}));
vi.mock("../../api/_providers.js", () => ({
	callLLMChain: vi.fn(async () => {
		throw new Error("LLM must not be reached in these paths");
	}),
	callNvidiaFast: vi.fn(async () => {
		throw new Error("LLM must not be reached in these paths");
	}),
}));
vi.mock("../../api/_notify-prefs.js", () => ({
	getNotifyPrefs: vi.fn(async () => ({ ai_chat_enabled: false })),
}));
vi.mock("../../api/_workforce.js", () => ({
	createTask: vi.fn(async () => ({ id: "task-1" })),
}));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../api/_ai-health.js", () => ({
	recordAiCall: vi.fn(),
}));
vi.mock("../../api/_slang.js", () => ({
	mergeSlang: vi.fn((s: unknown) => s),
}));
vi.mock("../../api/_context-classify.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/_context-classify.js")>();
	return {
		...actual,
	};
});
vi.mock("../../api/_context-moderation.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/_context-moderation.js")>();
	return {
		...actual,
	};
});

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

const VICTIM = "victim_1";
const ATTACKER = "attacker_9";

function strictGate() {
	verifyCallerMock.mockImplementation(
		async (req: unknown, _res: unknown, claimed: string) => {
			const h = String(
				(req as { headers?: Record<string, string> })?.headers?.["x-anon-id"] || "",
			).toLowerCase();
			if (h && h === String(claimed).toLowerCase())
				return { ok: true, callerId: claimed };
			return { ok: false, status: 403, error: "Cannot operate on another user's data" };
		},
	);
}

function authed(anonId: string) {
	return { "x-anon-id": anonId };
}

function seedVictimThread() {
	state.threads = [{ thread_id: VICTIM, status: "open" }];
	state.messages = [
		{
			id: "m1",
			thread_id: VICTIM,
			sender: "user",
			body: "I am being bullied and I am scared",
			read: false,
			created_at: "2026-07-15T00:00:00Z",
		},
	];
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state.threads = [];
	state.messages = [];
	state.settings = {};
	verifyCallerMock.mockReset();
	verifyCallerMock.mockResolvedValue({ ok: true, callerId: "" });
	from.mockImplementation((table: string) => chainFor(table));
});

describe("inbox thread ownership — reads", () => {
	it("refuses message history to a session that does not own the thread", async () => {
		strictGate();
		seedVictimThread();
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{ method: "GET", query: { thread_id: VICTIM }, headers: authed(ATTACKER), body: {} },
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("serves full history to the owning session", async () => {
		strictGate();
		seedVictimThread();
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{ method: "GET", query: { thread_id: VICTIM }, headers: authed(VICTIM), body: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { messages: unknown[] }).messages).toHaveLength(1);
	});
});

describe("inbox thread ownership — writes", () => {
	it("refuses messages forged into another student's thread", async () => {
		strictGate();
		seedVictimThread();
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				headers: authed(ATTACKER),
				body: { thread_id: VICTIM, body: "forget it, everything is fine" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		// Nothing landed in the victim's thread.
		expect(
			state.messages.filter((m) => (m as { body: string }).body === "forget it, everything is fine"),
		).toHaveLength(0);
	});

	it("accepts messages from the owning session", async () => {
		strictGate();
		seedVictimThread();
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				headers: authed(VICTIM),
				body: { thread_id: VICTIM, body: "hello, I need help" },
			},
			res,
		);
		expect(res.statusCode).toBe(201);
		expect(
			state.messages.filter((m) => (m as { body: string }).body === "hello, I need help"),
		).toHaveLength(1);
	});

	it("refuses draft accepts from a foreign session", async () => {
		strictGate();
		seedVictimThread();
		// An open proposal: without the ownership gate the forged accept
		// would sail through into a published post in the victim's name.
		state.settings[`inbox_state:${VICTIM}`] = {
			draft_proposal: {
				status: "proposed",
				title: "Fix the library",
				description: "Longer opening hours please",
				category: "Other",
			},
		};
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				headers: authed(ATTACKER),
				body: { action: "accept_own_draft", thread_id: VICTIM, visibility: "private" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("refuses mark_read from a foreign session without touching rows", async () => {
		strictGate();
		seedVictimThread();
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				headers: authed(ATTACKER),
				body: { action: "mark_read", thread_id: VICTIM },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(
			(state.messages[0] as { read: boolean }).read,
		).toBe(false);
	});
});
