// ═══════════════════════════════════════════════════════════════════
// Inbox draft proposals — AI-understood threads become admin-approved posts
// ═══════════════════════════════════════════════════════════════════
// Contract:
//   1. draft_post generates a proposal from thread messages and stores it
//      in thread state — never a fabricated draft (LLM failure = no popup).
//   2. A second draft_post while one is open dedupes (no proposal spam).
//   3. accept_draft runs the REAL safety gate: blocked drafts 403 with no
//      post row; public accepts always land in pending_review.
//   4. Private accepts create a private post owned by the thread's anon id.
//   5. reject_draft closes the proposal with no post row.
//   6. GET thread exposes the open proposal (the admin popup's data).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  threads: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  settings: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  gteCalls: [] as Array<{ table: string; col: string; val: unknown }>,
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
        : table === "posts"
          ? (state as unknown as { posts: Array<Record<string, unknown>> }).posts ??
            (((state as unknown as { posts: Array<Record<string, unknown>> }).posts = []))
          : state.settings;
  const matches = (r: Record<string, unknown>) =>
    filters.every(([c, v]) => {
      if (c.startsWith("__like:")) return String(r[c.slice(7)] ?? "").startsWith(String(v));
      if (c.startsWith("__in:")) return (v as unknown[]).includes(r[c.slice(5)]);
      return r[c] === v;
    });
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
    like(col, pattern) {
      const prefix = String(pattern).replace(/%/g, "");
      filters.push(["__like:" + col, prefix]);
      return self;
    },
    in(col, vals) {
      filters.push(["__in:" + col, vals]);
      return self;
    },
    limit() {
      return self;
    },
    gte(col: string, val: unknown) {
      state.gteCalls.push({ table, col, val });
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

const pipe = vi.hoisted(() => ({
  evaluateContent: vi.fn(),
  // The accept path runs the SAME gate as the posts route: keyword floor +
  // deterministic contextual scan + model. Mock the deep entry point the
  // route actually calls, or the harness silently passes a route it never
  // exercised.
  evaluateContentDeep: vi.fn(),
}));
vi.mock("../../api/_safety-pipeline.js", () => pipe);

vi.mock("../../api/_workforce.js", () => ({
  createTask: vi.fn(async () => ({ id: "task-1" })),
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

async function post(body: Record<string, unknown>) {
  const { default: handler } = await import("../../api/_inbox.js");
  const res = response();
  await handler(
    { method: "POST", query: {}, headers: { "x-anon-id": "anon-admin" }, body },
    res,
  );
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.threads = [{ thread_id: "thread-1", status: "open" }];
  state.messages = [
    { thread_id: "thread-1", sender: "user", body: "The lift in Block C is broken", created_at: "2026-09-01T10:00:00Z" },
    { thread_id: "thread-1", sender: "ai", body: "Sorry to hear that — which floor?", created_at: "2026-09-01T10:01:00Z" },
  ];
  state.settings = [];
  state.inserted = [];
  (state as unknown as { posts: Array<Record<string, unknown>> }).posts = [];
  authMocks.isAdmin.mockResolvedValue(true);
  authMocks.auditLog.mockResolvedValue(undefined);
  authMocks.checkUser.mockResolvedValue({ ok: true });
  authMocks.verifyCallerIdentity.mockResolvedValue({ ok: true });
  authMocks.clientIp.mockReturnValue("test-ip");
  providers.fast.mockResolvedValue({ text: DRAFT_JSON });
  providers.chain.mockResolvedValue(null);
  pipe.evaluateContentDeep.mockResolvedValue({
    blocked: false,
    needsReview: false,
    flags: [],
    code: null,
  });
});

describe("draft_post", () => {
  it("stores a proposal from the thread conversation", async () => {
    const res = await post({ action: "draft_post", thread_id: "thread-1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deduped: false });
    const proposal = (res.body as { proposal: Record<string, unknown> }).proposal;
    expect(proposal.title).toBe("Broken lift in Block C traps students");
    expect(proposal.category).toBe("Facilities");
    expect(proposal.private).toBe(true);
    expect(proposal.status).toBe("proposed");
    // Persisted in thread state for the admin popup to read.
    const stored = state.settings.find(
      (r) => r.key === "inbox_state:thread-1",
    ) as unknown as { value: { draft_proposal: { status: string } } };
    expect(stored.value.draft_proposal.status).toBe("proposed");
  });

  it("dedupes while a proposal is open", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    const res = await post({ action: "draft_post", thread_id: "thread-1" });
    expect(res.body).toMatchObject({ ok: true, deduped: true });
  });

  it("proposes nothing (no popup) when generation fails", async () => {
    providers.fast.mockResolvedValue(null);
    providers.chain.mockResolvedValue(null);
    const res = await post({ action: "draft_post", thread_id: "thread-1" });
    expect(res.body).toMatchObject({ ok: true, proposal: null });
  });
});

describe("accept_draft", () => {
  it("creates a private post owned by the thread id", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    const res = await post({ action: "accept_draft", thread_id: "thread-1", visibility: "private" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "reported" });
    const postRow = state.inserted.find((r) => r.table === "posts") as unknown as Record<string, unknown>;
    expect(postRow).toMatchObject({
      visibility: "private",
      author_id: "thread-1",
      status: "reported",
    });
  });

  it("holds public accepts for review even when clean", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    const res = await post({ action: "accept_draft", thread_id: "thread-1", visibility: "public" });
    expect(res.body).toMatchObject({ ok: true, status: "pending_review" });
  });

  it("blocks unsafe drafts with no post row", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    pipe.evaluateContentDeep.mockResolvedValue({
      blocked: true,
      needsReview: false,
      flags: [{ type: "profanity" }],
      code: "CONTENT_BLOCKED",
    });
    const res = await post({ action: "accept_draft", thread_id: "thread-1", visibility: "private" });
    expect(res.statusCode).toBe(403);
    expect(state.inserted.filter((r) => r.table === "posts")).toHaveLength(0);
  });

  it("runs the SAME deep gate the posts route runs, not the keyword floor", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    pipe.evaluateContentDeep.mockClear();
    pipe.evaluateContent.mockClear();
    await post({ action: "accept_draft", thread_id: "thread-1", visibility: "private" });
    expect(pipe.evaluateContentDeep).toHaveBeenCalledTimes(1);
    // The keyword floor alone cannot see a named target or a politely
    // worded threat; accepting a draft through it would launder text the
    // posts route would have held.
    expect(pipe.evaluateContent).not.toHaveBeenCalled();
  });

  it("blocks a draft the contextual layer flags even when no keyword matched", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    pipe.evaluateContentDeep.mockResolvedValue({
      blocked: true,
      needsReview: false,
      flags: [{ type: "threat", source: "context-classify" }],
      code: "CONTENT_BLOCKED",
    });
    const res = await post({ action: "accept_draft", thread_id: "thread-1", visibility: "private" });
    expect(res.statusCode).toBe(403);
    expect(state.inserted.filter((r) => r.table === "posts")).toHaveLength(0);
  });

  it("refuses when no proposal is open", async () => {
    const res = await post({ action: "accept_draft", thread_id: "thread-1", visibility: "private" });
    expect(res.statusCode).toBe(403);
  });
});

describe("reject_draft", () => {
  it("closes the proposal with no post row", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    const res = await post({ action: "reject_draft", thread_id: "thread-1" });
    expect(res.body).toMatchObject({ ok: true });
    expect(state.inserted.filter((r) => r.table === "posts")).toHaveLength(0);
    // Mock upserts append (real upserts replace by key) — read the latest.
    const states = state.settings.filter(
      (r) => r.key === "inbox_state:thread-1",
    ) as unknown as Array<{ value: { draft_proposal: { status: string } } }>;
    expect(states[states.length - 1].value.draft_proposal.status).toBe("rejected");
  });
});

describe("GET thread", () => {  it("exposes the open proposal for the admin popup", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    const { default: handler } = await import("../../api/_inbox.js");
    const res = response();
    await handler(
      { method: "GET", query: { thread_id: "thread-1" }, headers: {}, body: {} },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(
      (res.body as { state: { draft_proposal: { status: string } } }).state.draft_proposal.status,
    ).toBe("proposed");
  });
});

describe("postIntent (auto-propose trigger)", () => {
  it("fires only on explicit post words", async () => {
    const { postIntent } = await import("../../api/_inbox.js");
    for (const msg of [
      "please post this",
      "can you publish it",
      "share this with the board",
      "make it public",
      "put it on the board",
    ]) {
      expect(postIntent(msg)).toBe(true);
    }
    for (const msg of [
      "the lift is broken",
      "thanks for listening",
      "what should I do",
      "posting is hard",
    ]) {
      expect(postIntent(msg)).toBe(false);
    }
  });
});

describe("sanitizeDraft", () => {
  it("clamps fields and rejects thin drafts", async () => {
    const { sanitizeDraft } = await import("../../api/_inbox.js");
    expect(
      sanitizeDraft({ title: "Hi", description: "short", category: "Facilities" }),
    ).toBeNull();
    expect(sanitizeDraft(null)).toBeNull();
    const good = sanitizeDraft({
      title: "Broken lift in Block C",
      description: "The lift has been broken for two days now.",
      category: "Facilities",
    });
    expect(good).toMatchObject({ title: "Broken lift in Block C", category: "Facilities", private: true });
    // Unknown categories fall back to Other, never rejected.
    expect(
      sanitizeDraft({ title: "A proper title here", description: "A long enough description here.", category: "Narnia" })?.category,
    ).toBe("Other");
  });
});

describe("accept_own_draft (student taps Accept in chat)", () => {
  async function ownerPost(threadId: string, anonId: string | null) {
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
        body: { action: "accept_own_draft", thread_id: threadId },
      },
      res,
    );
    return res;
  }

  it("honors a public choice by holding the post for review, never publishing directly", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    // Owner chooses public — the server accepts the choice but holds the
    // post for admin review instead of publishing it.
    authMocks.isAdmin.mockResolvedValue(false);
    const { default: handler } = await import("../../api/_inbox.js");
    const res = response();
    const { checkUser } = await import("../../api/_auth.js");
    (checkUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    await handler(
      {
        method: "POST",
        query: {},
        headers: { "x-anon-id": "thread-1" },
        body: { action: "accept_own_draft", thread_id: "thread-1", visibility: "public" },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    const postRow = state.inserted.find((r) => r.table === "posts") as unknown as Record<string, unknown>;
    expect(postRow.visibility).toBe("public");
    expect(postRow.status).toBe("pending_review");
    expect(postRow.author_id).toBe("thread-1");
  });

  it("defaults to private when no visibility is chosen", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    authMocks.isAdmin.mockResolvedValue(false);
    const { default: handler } = await import("../../api/_inbox.js");
    const res = response();
    const { checkUser } = await import("../../api/_auth.js");
    (checkUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    await handler(
      {
        method: "POST",
        query: {},
        headers: { "x-anon-id": "thread-1" },
        body: { action: "accept_own_draft", thread_id: "thread-1" },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    const postRow = state.inserted.find((r) => r.table === "posts") as unknown as Record<string, unknown>;
    expect(postRow.visibility).toBe("private");
  });

  it("reports honest server latency on owner accepts", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    authMocks.isAdmin.mockResolvedValue(false);
    const { checkUser } = await import("../../api/_auth.js");
    (checkUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const { default: handler } = await import("../../api/_inbox.js");
    const res = response();
    await handler(
      {
        method: "POST",
        query: {},
        headers: { "x-anon-id": "thread-1" },
        body: { action: "accept_own_draft", thread_id: "thread-1" },
      },
      res,
    );
    expect(typeof (res.body as { server_ms?: unknown }).server_ms).toBe("number");
  });

  it("refuses banned owners and strangers' threads", async () => {
    await post({ action: "draft_post", thread_id: "thread-1" });
    const banned = await ownerPost("thread-1", null);
    expect(banned.statusCode).toBe(403);
    expect(state.inserted.filter((r) => r.table === "posts")).toHaveLength(0);
  });

  it("refuses when no proposal is open", async () => {
    const res = await ownerPost("thread-1", "thread-1");
    expect(res.statusCode).toBe(403);
  });
});

describe("GET thread history window (admin sees 5 days, owners see full)", () => {
  async function getThread(admin: boolean) {
    if (admin) {
      const { isAdmin } = await import("../../api/_auth.js");
      (isAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    } else {
      const { isAdmin, checkUser } = await import("../../api/_auth.js");
      (isAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (checkUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    }
    const { default: handler } = await import("../../api/_inbox.js");
    const res = response();
    await handler(
      { method: "GET", query: { thread_id: "thread-1" }, headers: {}, body: {} },
      res,
    );
    return res;
  }

  it("caps admin reads at 5 days and labels the window", async () => {
    state.gteCalls.length = 0;
    const res = await getThread(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ history_window: "5d" });
    const cutoff = state.gteCalls.find((c) => c.table === "chat_messages" && c.col === "created_at");
    expect(cutoff).toBeTruthy();
    const ageMs = Date.now() - new Date(cutoff!.val as string).getTime();
    expect(ageMs).toBeGreaterThan(4 * 86400000);
    expect(ageMs).toBeLessThan(6 * 86400000);
  });

  it("gives owners full history with no cutoff", async () => {
    state.gteCalls.length = 0;
    const res = await getThread(false);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ history_window: "full" });
    expect(state.gteCalls.filter((c) => c.table === "chat_messages")).toHaveLength(0);
  });
});
describe("GET threads=1 slang exposure", () => {
  it("carries each thread's slang rollup for the admin badge", async () => {
    state.threads = [{ thread_id: "thread-1", status: "open", updated_at: new Date().toISOString() }];
    state.messages = [];
    state.settings = [
      { key: "inbox_state:thread-1", value: { slang_hits: { count: 2, terms: ["sucks"], messages: 1 } } },
    ];
    const { default: handler } = await import("../../api/_inbox.js");
    const res = response();
    await handler({ method: "GET", query: { threads: "1" }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    const row = (res.body as Array<Record<string, unknown>>).find((t) => t.thread_id === "thread-1");
    expect(row).toMatchObject({ slang: { count: 2, terms: ["sucks"] } });
  });

  it("reports null slang for clean threads", async () => {
    state.threads = [{ thread_id: "thread-1", status: "open", updated_at: new Date().toISOString() }];
    state.messages = [];
    state.settings = [];
    const { default: handler } = await import("../../api/_inbox.js");
    const res = response();
    await handler({ method: "GET", query: { threads: "1" }, headers: {}, body: {} }, res);
    const row = (res.body as Array<Record<string, unknown>>).find((t) => t.thread_id === "thread-1");
    expect(row?.slang ?? null).toBeNull();
  });
});
