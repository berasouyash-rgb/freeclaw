// Inbox thread titles + owner delete_thread — regression tests.
// Titles are server-derived from each thread's earliest user words (never
// AI-invented). delete_thread works for admins (any thread) and owners
// (own thread + session proof); strangers get 403 with zero deletions,
// and state/summary rows go with the thread (no admin-queue residue).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	threads: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
	settings: {} as Record<string, unknown>,
}));

type Chain = Record<string, unknown> & {
	then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
	const eqs: Array<[string, unknown]> = [];
	let likePrefix: { col: string; prefix: string } | null = null;
	let inFilter: { col: string; vals: Array<unknown> } | null = null;
	let op = "select";
	let ordering: { col: string; asc: boolean } | null = null;
	let limitN: number | null = null;
	let single = false;
	const rows = () =>
		table === "chat_threads"
			? state.threads
			: table === "chat_messages"
				? state.messages
				: [];
	const matches = (r: Record<string, unknown>) =>
		eqs.every(([c, v]) => r[c] === v) &&
		(!inFilter || inFilter.vals.includes(r[inFilter.col])) &&
		(!likePrefix ||
			String(r[likePrefix.col] ?? "").startsWith(likePrefix.prefix));
	const self: Chain = {
		then(fn) {
			if (op === "delete") {
				if (table === "settings") {
					for (const k of Object.keys(state.settings))
						if (matches({ key: k })) delete state.settings[k];
				} else {
					const arr = rows();
					for (const r of arr.filter(matches)) arr.splice(arr.indexOf(r), 1);
				}
				fn({ data: null, error: null });
				return;
			}
			if (table === "settings") {
				if (likePrefix) {
					const out = Object.entries(state.settings)
						.filter(([k]) => k.startsWith(likePrefix!.prefix))
						.map(([key, value]) => ({ key, value }));
					fn({ data: out, error: null });
					return;
				}
				const key = eqs.find(([c]) => c === "key")?.[1];
				const value = key !== undefined ? state.settings[String(key)] : undefined;
				fn({ data: value === undefined ? null : { value }, error: null });
				return;
			}
			let out = rows().filter(matches);
			if (ordering)
				out = [...out].sort((a, b) => {
					const av = String(a[ordering!.col] ?? "");
					const bv = String(b[ordering!.col] ?? "");
					return ordering!.asc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
				});
			if (limitN !== null) out = out.slice(0, limitN);
			fn({ data: single ? (out[0] ?? null) : out, error: null });
		},
		select() {
			return self;
		},
		eq(c: string, v: unknown) {
			eqs.push([c, v]);
			return self;
		},
		like(c: string, pattern: unknown) {
			likePrefix = { col: c, prefix: String(pattern).replace(/%/g, "") };
			return self;
		},
		in(c: string, v: Array<unknown>) {
			inFilter = { col: c, vals: v };
			return self;
		},
		order(c: string, o?: { ascending?: boolean }) {
			ordering = { col: c, asc: o?.ascending !== false };
			return self;
		},
		limit(n: number) {
			limitN = n;
			return self;
		},
		gte() {
			return self;
		},
		maybeSingle() {
			single = true;
			return self;
		},
		single() {
			single = true;
			return self;
		},
		insert() {
			return self;
		},
		update() {
			return self;
		},
		upsert() {
			return self;
		},
		delete() {
			op = "delete";
			return self;
		},
	};
	return self;
}

const from = vi.fn((t: string) => chainFor(t));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
}));
vi.mock("../../api/_auth.js", () => ({
	...authMocks,
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	clientIp: () => "test-ip",
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	verifyCallerIdentity: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	EVENT_TYPES: { INBOX_MESSAGE: "inbox_message" },
	emitEventAndBridge: vi.fn(async () => {}),
}));
vi.mock("../../api/_ai-health.js", () => ({ recordAiCall: vi.fn() }));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../api/_moderation.js", () => ({
	serverModerate: vi.fn(() => ({ blocked: false, flags: [] })),
}));
vi.mock("../../api/_slang.js", () => ({ mergeSlang: vi.fn((p) => p ?? null) }));
vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContent: vi.fn(() => ({ blocked: false, flags: [] })),
}));
vi.mock("../../api/_providers.js", () => ({
	callLLMChain: vi.fn(async () => ({})),
	callNvidiaFast: vi.fn(async () => null),
}));
vi.mock("../../api/_notify-prefs.js", () => ({ getNotifyPrefs: vi.fn(async () => ({})) }));
vi.mock("../../api/_workforce.js", () => ({ createTask: vi.fn() }));
vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: vi.fn(() => false),
	TEST_THREAD_ID_RE: /(^test_|_test$)/,
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
	vi.resetModules();
	vi.clearAllMocks();
	state.threads = [];
	state.messages = [];
	state.settings = {};
	authMocks.isAdmin.mockResolvedValue(false);
});

const seedInbox = () => {
	state.threads = [
		{ thread_id: "thr1", status: "open", updated_at: "2026-09-29T10:00:00Z" },
		{ thread_id: "thr-empty", status: "open", updated_at: "2026-09-29T10:00:00Z" },
	];
	state.messages = [
		{ id: "m1", thread_id: "thr1", sender: "user", body: "the hostel water problem persists", created_at: "2026-09-29T09:00:00Z", read: true },
		{ id: "m2", thread_id: "thr1", sender: "ai", body: "noted", created_at: "2026-09-29T09:01:00Z", read: true },
		{ id: "m3", thread_id: "thr1", sender: "user", body: "any update", created_at: "2026-09-29T09:02:00Z", read: false },
	];
	state.settings["inbox_state:thr1"] = { agent: "general" };
	state.settings["inbox_summary:thr1"] = { summary: "stale words" };
};

describe("inbox thread titles (derived, never invented)", () => {
	it("titles the admin listing from each thread's earliest user words", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		seedInbox();
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler({ method: "GET", query: { threads: "1" }, body: {}, headers: {}, socket: { remoteAddress: "x" } }, res);
		expect(res.statusCode).toBe(200);
		const rows = res.body as Array<{ thread_id: string; title: string }>;
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.thread_id === "thr1")?.title).toBe(
			"the hostel water problem persists",
		);
		expect(rows.find((r) => r.thread_id === "thr-empty")?.title).toBe("Conversation");
	});

	it("titles the single-thread response the same way", async () => {
		seedInbox();
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{ method: "GET", query: { thread_id: "thr1" }, body: {}, headers: { "x-anon-id": "anon-x" }, socket: { remoteAddress: "x" } },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { title: string }).title).toBe("the hostel water problem persists");
		expect((res.body as { messages: unknown[] }).messages).toHaveLength(3);
	});
});

describe("inbox delete_thread — admin and owner", () => {
	async function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler({ method: "POST", query: {}, body, headers, socket: { remoteAddress: "x" } }, res);
		return res;
	}

	it("lets an admin delete any thread with state and summary rows", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		seedInbox();
		const res = await post({ action: "delete_thread", thread_id: "thr1" }, { "x-admin-token": "tok" });
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true });
		expect(state.threads).toHaveLength(1);
		expect(state.messages).toHaveLength(0);
		expect(state.settings["inbox_state:thr1"]).toBeUndefined();
		expect(state.settings["inbox_summary:thr1"]).toBeUndefined();
		expect(authMocks.auditLog).toHaveBeenCalledWith("admin", "thread_deleted", "Thread thr1 deleted by admin");
	});

	it("lets the owner delete their own thread with session proof", async () => {
		seedInbox();
		state.threads = [{ thread_id: "anon-owner", status: "open", updated_at: "2026-09-29T10:00:00Z" }];
		const res = await post(
			{ action: "delete_thread", thread_id: "anon-owner" },
			{ "x-anon-id": "anon-owner" },
		);
		expect(res.statusCode).toBe(200);
		expect(state.threads).toHaveLength(0);
		expect(authMocks.auditLog).toHaveBeenCalledWith("inbox", "thread_deleted", "Thread anon-owner deleted by owner");
	});

	it("refuses a stranger with 403 and deletes nothing", async () => {
		seedInbox();
		const res = await post(
			{ action: "delete_thread", thread_id: "thr1" },
			{ "x-anon-id": "anon-stranger" },
		);
		expect(res.statusCode).toBe(403);
		expect(state.threads).toHaveLength(2);
		expect(state.messages).toHaveLength(3);
		expect(state.settings["inbox_state:thr1"]).toBeDefined();
	});

	it("refuses an owner whose session proof fails", async () => {
		const { verifyCallerIdentity } = await import("../../api/_auth.js");
		(verifyCallerIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: "Invalid session identity",
		});
		seedInbox();
		state.threads = [{ thread_id: "anon-owner", status: "open", updated_at: "2026-09-29T10:00:00Z" }];
		const res = await post(
			{ action: "delete_thread", thread_id: "anon-owner" },
			{ "x-anon-id": "anon-owner" },
		);
		expect(res.statusCode).toBe(403);
		expect(state.threads).toHaveLength(1);
	});
});
