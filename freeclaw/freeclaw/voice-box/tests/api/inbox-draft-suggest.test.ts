// ═══════════════════════════════════════════════════════════════════
// Inbox proactive draft suggestion — the nudge before the draft
// ═══════════════════════════════════════════════════════════════════
// Contract:
//   1. shouldSuggestDraft is pure: problem described, NO explicit
//      post-intent words, no open proposal, no prior suggestion outcome.
//   2. Explicit intent belongs to the full-draft path, never the nudge.
//   3. request_own_draft (explicit tap) generates through the SAME
//      proposeDraft pipeline + dedupe as every other trigger.
//   4. dismiss_draft_suggestion is owner-proofed and idempotent.
//   5. Strangers (wrong thread) are denied before any state read.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	threads: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
	settings: [] as Array<Record<string, unknown>>,
	inserted: [] as Array<Record<string, unknown>>,
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
			if (op === "insert" || op === "upsert") {
				const row = { ...(patch ?? {}) };
				rows().push(row);
				state.inserted.push({ table, ...row });
				fn({ data: single ? row : [row], error: null });
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
		order() {
			return self;
		},
		like() {
			return self;
		},
		in() {
			return self;
		},
		limit() {
			return self;
		},
		gte() {
			return self;
		},
		lte() {
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

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	checkUser: vi.fn(),
	verifyCallerIdentity: vi.fn(),
	clientIp: vi.fn(),
}));
vi.mock("../../api/_auth.js", () => ({
	...authMocks,
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
	clientIp: vi.fn(() => "test-ip"),
	verifyCallerIdentity: vi.fn(async () => ({ ok: true })),
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

const DRAFT_JSON = JSON.stringify({
	title: "Broken lift in Block C traps students",
	description: "The lift in Block C has been broken for two days and students are taking the stairs with heavy bags.",
	category: "Facilities",
	private: true,
});

function ownerPost(body: Record<string, unknown>, anonId: string | null) {
	return (async () => {
		authMocks.isAdmin.mockResolvedValue(false);
		const { checkUser } = await import("../../api/_auth.js");
		(checkUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			anonId ? { ok: true } : { ok: false, error: "banned" },
		);
		const { default: handler } = await import("../../api/_inbox.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				headers: anonId ? { "x-anon-id": anonId } : {},
				body,
			},
			res,
		);
		return res;
	})();
}

function threadState(): Record<string, unknown> {
	// Mock upserts append (real upserts replace by key) — read the latest.
	const rows = state.settings.filter((r) => r.key === "inbox_state:thread-1");
	return (
		(rows[rows.length - 1] as unknown as { value: Record<string, unknown> })
			?.value ?? {}
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	state.threads = [{ thread_id: "thread-1", status: "open" }];
	state.messages = [
		{ thread_id: "thread-1", sender: "user", body: "The lift in Block C is broken", created_at: "2026-09-01T10:00:00Z" },
	];
	state.settings = [];
	state.inserted = [];
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.auditLog.mockResolvedValue(undefined);
	authMocks.checkUser.mockResolvedValue({ ok: true });
	authMocks.verifyCallerIdentity.mockResolvedValue({ ok: true });
	authMocks.clientIp.mockReturnValue("test-ip");
	providers.fast.mockResolvedValue({ text: DRAFT_JSON });
	providers.chain.mockResolvedValue(null);
});

describe("shouldSuggestDraft (pure decision contract)", () => {
	it("suggests when a problem is described with no explicit intent and clean state", async () => {
		const { shouldSuggestDraft } = await import("../../api/_inbox.js");
		expect(
			shouldSuggestDraft(true, "The lift in Block C is broken", {}),
		).toBe(true);
	});

	it("never suggests on explicit post-intent (full-draft path owns it)", async () => {
		const { shouldSuggestDraft } = await import("../../api/_inbox.js");
		expect(shouldSuggestDraft(true, "please post this", {})).toBe(false);
	});

	it("never suggests when no problem was described", async () => {
		const { shouldSuggestDraft } = await import("../../api/_inbox.js");
		expect(shouldSuggestDraft(false, "thanks for listening", {})).toBe(false);
	});

	it("never suggests while a proposal is open", async () => {
		const { shouldSuggestDraft } = await import("../../api/_inbox.js");
		expect(
			shouldSuggestDraft(true, "the lift is still broken", {
				draft_proposal: { status: "proposed" },
			}),
		).toBe(false);
	});

	it("never re-suggests after dismiss", async () => {
		const { shouldSuggestDraft } = await import("../../api/_inbox.js");
		expect(
			shouldSuggestDraft(true, "the lift is still broken", {
				draft_suggestion: { status: "dismissed" },
			}),
		).toBe(false);
	});

	it("never re-suggests after a suggestion was already shown", async () => {
		const { shouldSuggestDraft } = await import("../../api/_inbox.js");
		expect(
			shouldSuggestDraft(true, "the lift is still broken", {
				draft_suggestion: { status: "suggested" },
			}),
		).toBe(false);
	});

	it("never suggests after the suggestion was accepted", async () => {
		const { shouldSuggestDraft } = await import("../../api/_inbox.js");
		expect(
			shouldSuggestDraft(true, "the lift is still broken", {
				draft_suggestion: { status: "accepted" },
			}),
		).toBe(false);
	});
});

describe("request_own_draft (student taps Generate)", () => {
	it("generates through the shared pipeline and returns the draft card payload", async () => {
		const res = await ownerPost(
			{ action: "request_own_draft", thread_id: "thread-1" },
			"thread-1",
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, draft_proposed: true });
		const draft = (res.body as { draft: Record<string, unknown> }).draft;
		expect(draft.title).toBe("Broken lift in Block C traps students");
		expect(threadState().draft_suggestion).toMatchObject({ status: "accepted" });
	});

	it("dedupes while a proposal is open (no second generation)", async () => {
		await ownerPost({ action: "request_own_draft", thread_id: "thread-1" }, "thread-1");
		providers.fast.mockClear();
		const res = await ownerPost(
			{ action: "request_own_draft", thread_id: "thread-1" },
			"thread-1",
		);
		expect(res.body).toMatchObject({ ok: true, deduped: true });
		expect(providers.fast).not.toHaveBeenCalled();
	});

	it("proposes nothing when generation fails (no fabricated draft)", async () => {
		providers.fast.mockResolvedValue(null);
		providers.chain.mockResolvedValue(null);
		const res = await ownerPost(
			{ action: "request_own_draft", thread_id: "thread-1" },
			"thread-1",
		);
		expect(res.body).toMatchObject({ ok: true, draft_proposed: false });
	});

	it("denies strangers before any state read", async () => {
		const { verifyCallerIdentity } = await import("../../api/_auth.js");
		(verifyCallerIdentity as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: "Invalid session identity",
		});
		const res = await ownerPost(
			{ action: "request_own_draft", thread_id: "thread-1" },
			"victim_1",
		);
		expect(res.statusCode).toBe(403);
	});
});

describe("dismiss_draft_suggestion (student taps Not now)", () => {
	it("records dismissal so the nudge never returns", async () => {
		const res = await ownerPost(
			{ action: "dismiss_draft_suggestion", thread_id: "thread-1" },
			"thread-1",
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true });
		expect(threadState().draft_suggestion).toMatchObject({ status: "dismissed" });
	});

	it("is idempotent (dismissing twice still succeeds)", async () => {
		await ownerPost({ action: "dismiss_draft_suggestion", thread_id: "thread-1" }, "thread-1");
		const res = await ownerPost(
			{ action: "dismiss_draft_suggestion", thread_id: "thread-1" },
			"thread-1",
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true });
	});

	it("denies strangers", async () => {
		const { verifyCallerIdentity } = await import("../../api/_auth.js");
		(verifyCallerIdentity as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: "Invalid session identity",
		});
		const res = await ownerPost(
			{ action: "dismiss_draft_suggestion", thread_id: "thread-1" },
			"victim_1",
		);
		expect(res.statusCode).toBe(403);
	});
});
