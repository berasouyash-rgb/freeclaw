// ═══════════════════════════════════════════════════════════════════
// Inbox AI-once — one user message, exactly one AI reply, fast path first
// ═══════════════════════════════════════════════════════════════════
// User report: "AI is sending two times" and replies "taking too long".
// Root cause (code-read, api/_inbox.js): the AI reply insert lives
// INSIDE the outer Promise.race. When the race times out, the catch
// path inserts the offline fallback — and the orphaned aiWork inserts
// the real reply when the LLM finally answers. Two AI rows, one message.
//
// Contract:
//   1. Slow LLM (past the race) → fallback only. A late real reply must
//      NEVER be inserted afterwards (abandoned work stays abandoned).
//   2. Fast LLM → exactly one AI row, returned inline as auto_reply.
//   3. No duplicate user rows, no double state clobber from orphans.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	threads: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
	settings: [] as Array<Record<string, unknown>>,
}));

type Chain = Record<string, unknown> & {
	then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
	const filters: Array<[string, unknown]> = [];
	let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
	let patch: Record<string, unknown> | null = null;
	let single = false;
	let orderCol: string | null = null;
	let orderAsc = true;
	let limitN: number | null = null;
	const gteF: Array<[string, string]> = [];
	const rows = () =>
		table === "chat_threads"
			? state.threads
			: table === "chat_messages"
				? state.messages
				: state.settings;
	const matches = (r: Record<string, unknown>) =>
		filters.every(([c, v]) => r[c] === v) &&
		gteF.every(([c, v]) => String(r[c] ?? "") >= v);
	const self: Chain = {
		then(fn) {
			if (op === "insert" || op === "upsert") {
				const row = {
					id: `row-${state.messages.length + state.threads.length + state.settings.length + 1}`,
					created_at: new Date().toISOString(),
					...(patch ?? {}),
				};
				rows().push(row);
				fn({ data: single ? row : [row], error: null });
				return;
			}
			if (op === "update") {
				for (const r of rows().filter(matches)) Object.assign(r, patch);
				fn({ data: rows().filter(matches), error: null });
				return;
			}
			let matched = rows().filter(matches);
			if (orderCol)
				matched = [...matched].sort((a, b) =>
					orderAsc
						? String(a[orderCol!] ?? "") < String(b[orderCol!] ?? "")
							? -1
							: 1
						: String(a[orderCol!] ?? "") > String(b[orderCol!] ?? "")
							? -1
							: 1,
				);
			if (limitN !== null) matched = matched.slice(0, limitN);
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
		order(col: string, opts?: { ascending?: boolean }) {
			orderCol = col;
			orderAsc = opts?.ascending !== false;
			return self;
		},
		like() {
			return self;
		},
		ilike() {
			return self;
		},
		in() {
			return self;
		},
		limit(n: number) {
			limitN = n;
			return self;
		},
		gte(col: string, val: string) {
			gteF.push([col, val]);
			return self;
		},
		lte() {
			return self;
		},
		neq() {
			return self;
		},
		range() {
			return self;
		},
	};
	return self;
}

const from = vi.fn((table: string) => chainFor(table));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const providers = vi.hoisted(() => ({
	fast: vi.fn(),
	chain: vi.fn(),
}));
vi.mock("../../api/_providers.js", () => ({
	callNvidiaFast: providers.fast,
	callLLMChain: providers.chain,
}));

const classifyFn = vi.hoisted(() => vi.fn());
vi.mock("../../api/_context-classify.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../api/_context-classify.js")>();
	return { ...actual, classifyContextual: classifyFn };
});

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(false),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	// Mirrors the real helper: sets Retry-After and returns a 429 so a
	// test can only pass if the caller actually bailed out with a limit.
	rateLimitResponse: vi.fn(
		(
			res: {
				setHeader: (k: string, v: string) => unknown;
				status: (n: number) => { json: (b: unknown) => unknown };
			},
			retryAfterSeconds = 60,
			message = "Too many requests",
		) => {
			res.setHeader("Retry-After", String(retryAfterSeconds));
			return res.status(429).json({
				error: message,
				retry_after: retryAfterSeconds,
			});
		},
	),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true })),
	clientIp: vi.fn(() => "test-ip"),
	auditLog: vi.fn(async () => {}),
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

const THREAD = "anon_test123";

async function studentMessage(
	body: string,
	extra: Record<string, unknown> = {},
) {
	const { default: handler } = await import("../../api/_inbox.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			headers: { "x-anon-id": THREAD },
			body: { thread_id: THREAD, sender: "user", body, ...extra },
		},
		res,
	);
	return res;
}

const stateRows = () =>
	state.settings.filter((r) => String(r.key ?? "").startsWith("inbox_state:"));

const aiRows = () =>
	state.messages.filter((m) => m.sender === "ai");
const userRows = () =>
	state.messages.filter((m) => m.sender === "user");

beforeEach(() => {
	vi.clearAllMocks();
	state.threads = [];
	state.messages = [];
	state.settings = [];
	from.mockImplementation((table: string) => chainFor(table));
	classifyFn.mockResolvedValue({
		level: "none",
		emotion: "calm",
		agent: "general",
	});
	process.env.VB_AI_TIMEOUT_MS = "80";
	return () => {
		delete process.env.VB_AI_TIMEOUT_MS;
	};
});

describe("inbox AI-once", () => {
	it("fast LLM → exactly one AI row, returned inline", async () => {
		providers.fast.mockResolvedValueOnce({
			ok: true,
			text: "Hello! How can I help you today?",
			provider: "test",
			model: "test-model",
		});
		const res = await studentMessage("hello there");
		expect(res.statusCode).toBe(201);
		const body = res.body as { auto_reply?: { body?: string } };
		expect(body.auto_reply?.body).toContain("How can I help");
		expect(userRows()).toHaveLength(1);
		expect(aiRows()).toHaveLength(1);
	});

	it("slow LLM past the race → fallback only, late reply never lands", async () => {
		// Lane 1 fails fast; lane 2 (chain) hangs past the 80ms test race.
		providers.fast.mockRejectedValueOnce(new Error("fast down"));
		let resolveChain!: (v: unknown) => void;
		providers.chain.mockImplementationOnce(
			() => new Promise((r) => { resolveChain = r; }),
		);
		const res = await studentMessage("hello there");
		expect(res.statusCode).toBe(201);
		const body = res.body as {
			auto_reply?: { body?: string; metadata?: Record<string, unknown> };
		};
		expect(body.auto_reply?.metadata?.offline_fallback).toBe(true);
		expect(aiRows()).toHaveLength(1);
		// The orphaned generation finally answers — it must be dropped.
		resolveChain!({
			ok: true,
			text: "late real reply that must never land",
			provider: "test",
			model: "test-model",
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(aiRows()).toHaveLength(1);
		expect(
			state.messages.some((m) =>
				String(m.body ?? "").includes("must never land"),
			),
		).toBe(false);
		expect(userRows()).toHaveLength(1);
	});
});

// ═══════════════════════════════════════════════════════════════════
// Write-path integrity pins — lost-update + injection + network backstop
// ═══════════════════════════════════════════════════════════════════
// Regression guards for the final state write in the user-message path:
//   1. The final write must re-apply the draft nudge the suggest write
//      persisted AFTER the hoisted snapshot — otherwise the nudge is
//      silently lost (the student gets re-nagged / re-proposed).
//   2. Attachment URLs are stored and later rendered in the admin
//      origin — a javascript: URL there is stored XSS. Only http(s)
//      may persist; anything else is a loud 400 with nothing written.
//   3. Anon ids are self-mintable, so a per-identity message limit is
//      bypassed by switching ids. The IP-keyed backstop must trip.
// ═══════════════════════════════════════════════════════════════════

describe("inbox write-path integrity", () => {
	it("final state write keeps the draft nudge written after its snapshot", async () => {
		providers.fast.mockResolvedValue({
			ok: true,
			text: "Sorry to hear that — I can help with this.",
			provider: "test",
			model: "test-model",
		});
		const res = await studentMessage(
			"The lift in Block C is broken and water keeps dripping from the ceiling",
		);
		expect(res.statusCode).toBe(201);
		expect((res.body as { draft_suggested?: boolean }).draft_suggested).toBe(
			true,
		);

		const stateWrites = stateRows().filter(
			(r) => r.key === `inbox_state:${THREAD}`,
		);
		// suggest write + final write both ran
		expect(stateWrites.length).toBeGreaterThanOrEqual(2);

		const final = stateWrites[stateWrites.length - 1] as {
			value: Record<string, unknown>;
		};
		// the final write ran (it is the one that bumps the counter)
		expect(final.value.message_count).toBe(1);
		// ...and re-applied the nudge the suggest write persisted
		expect(final.value.draft_suggestion).toMatchObject({
			status: "suggested",
		});
	});

	it("rejects a non-http(s) attachment URL without persisting the message", async () => {
		const res = await studentMessage("please check this file", {
			attachment_url: "javascript:alert(document.cookie)",
		});
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toBe(
			"Invalid attachment URL (http/https only)",
		);
		expect(state.messages).toHaveLength(0);
	});

	it("accepts an https attachment URL and stores it on the message", async () => {
		const url = "https://files.example.com/report.png";
		const res = await studentMessage("please check this photo", {
			attachment_url: url,
		});
		expect(res.statusCode).toBe(201);
		expect(
			state.messages.some((m) => m.attachment_url === url),
		).toBe(true);
	});

	it("IP backstop trips for one network — minted anon ids cannot bypass it", async () => {
		providers.fast.mockResolvedValue({
			ok: true,
			text: "ok",
			provider: "test",
			model: "test-model",
		});
		let limited: { statusCode: number; body?: unknown } | null = null;
		let sends = 0;
		// The per-identity bucket is mocked open, so only the IP-keyed
		// backstop can stop this. Its module-level counter accumulates
		// across tests in this file, so trip it within a bounded loop.
		for (let i = 0; i < 40 && !limited; i++) {
			const r = await studentMessage(`hello there ${i}`);
			sends++;
			if (r.statusCode !== 201) limited = r;
		}
		expect(limited).not.toBeNull();
		expect(limited!.statusCode).toBe(429);
		expect((limited!.body as { error: string }).error).toContain(
			"Too many messages from this network",
		);
		expect(sends).toBeLessThanOrEqual(40);
	});
});
