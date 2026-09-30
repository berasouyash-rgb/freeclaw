// ═══════════════════════════════════════════════════════════════════
// Inbox admin state/info writes — every write must be PROVEN before ok:true
// ═══════════════════════════════════════════════════════════════════
// SIBLINGS OF BUG-011/012 (unverified write → false success), queued OPEN in
// docs/QA/BUG-LEDGER.md as BUG-012 residuals + BUG-014:
//
//   1. takeover: thread state is flipped to handoff FIRST, then the "team
//      member has joined" message insert is awaited WITHOUT checking error.
//      A failed insert answers ok:true + audits inbox_takeover while the
//      user sees nothing — the admin believes they are talking to the user.
//   2. send_to_agent: the "message sent to agent" system insert is unchecked,
//      AND a null createTask result still answers 200 ok:true with task:null.
//   3. bulk_action close: the chat_threads status update is unchecked, yet
//      every thread is reported {ok:true} and counted in `processed`.
//   4. dedup_messages / dedup_all: batch deletes are unchecked, yet the
//      response reports removed:N as if the rows were gone.
//   5. PUT mark_read / set_status: updates unchecked, always ok:true.
//
// Contract (same as admin_reply): the write is checked; on failure the call
// fails LOUDLY (never ok:true), no downstream mutation, no audit entry.
// Bulk stays per-item: one thread's failure must not abort the batch, but a
// failed thread reports ok:false and is NOT counted in `processed`.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  threads: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  settings: {} as Record<string, unknown>,
  insertErrors: {} as Record<string, Error | undefined>,
  updateErrors: {} as Record<string, Error | undefined>,
  deleteErrors: {} as Record<string, Error | undefined>,
  upsertErrors: {} as Record<string, Error | undefined>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  deletes: [] as Array<{ table: string; ids: Array<unknown> }>,
  createTaskResult: { id: "task-1", title: "t" } as unknown,
}));

type Chain = Record<string, unknown> & {
  then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
  const eqs: Array<[string, unknown]> = [];
  let inFilter: { col: string; vals: Array<unknown> } | null = null;
  let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  let patch: Record<string, unknown> = {};
  let single = false;
  const rows = () =>
    table === "chat_threads"
      ? state.threads
      : table === "chat_messages"
        ? state.messages
        : [];
  const matches = (r: Record<string, unknown>) =>
    eqs.every(([c, v]) => r[c] === v) &&
    (!inFilter || inFilter.vals.includes(r[inFilter.col]));

  const self: Chain = {
    then(fn) {
      if (op === "insert") {
        const err = state.insertErrors[table];
        fn({ data: null, error: err ?? null });
        if (!err) rows().push({ ...patch });
        return;
      }
      if (op === "upsert") {
        const err = state.upsertErrors[table];
        fn({ data: null, error: err ?? null });
        if (!err && table === "settings")
          state.settings[String(patch.key)] = patch.value;
        return;
      }
      if (op === "update") {
        const err = state.updateErrors[table];
        fn({ data: null, error: err ?? null });
        if (!err) {
          state.updates.push({ table, patch: { ...patch } });
          for (const r of rows()) if (matches(r)) Object.assign(r, patch);
        }
        return;
      }
      if (op === "delete") {
        const err = state.deleteErrors[table];
        fn({ data: null, error: err ?? null });
        if (!err) {
          const arr = rows();
          const gone = arr.filter(matches);
          state.deletes.push({
            table,
            ids: gone.map((r) => r.id),
          });
          for (const r of gone) arr.splice(arr.indexOf(r), 1);
        }
        return;
      }
      // select
      if (table === "settings") {
        const key = eqs.find(([c]) => c === "key")?.[1];
        const value =
          key !== undefined ? state.settings[String(key)] : undefined;
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
      eqs.push([col, val]);
      return self;
    },
    in(col: string, vals: Array<unknown>) {
      inFilter = { col, vals };
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

const workforceMocks = vi.hoisted(() => ({ createTask: vi.fn() }));
vi.mock("../../api/_workforce.js", () => ({
  createTask: (...a: Array<unknown>) =>
    workforceMocks.createTask(...a) as unknown,
}));

let tokenSeq = 0;
const authMocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  auditLog: vi.fn(),
}));
vi.mock("../../api/_auth.js", () => ({
  ...authMocks,
  cors: vi.fn(),
  clean: (s: unknown) => String(s ?? ""),
  clientIp: () => "test-ip",
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
vi.mock("../../api/_events.js", () => ({
  EVENT_TYPES: { INBOX_MESSAGE: "inbox_message" },
  emitEventAndBridge: vi.fn(async () => {}),
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
  state.messages = [];
  state.settings = {};
  state.insertErrors = {};
  state.updateErrors = {};
  state.deleteErrors = {};
  state.upsertErrors = {};
  state.updates = [];
  state.deletes = [];
  state.createTaskResult = { id: "task-1", title: "t" };
  workforceMocks.createTask.mockImplementation(async () => state.createTaskResult);
  authMocks.isAdmin.mockResolvedValue(true);
  authMocks.auditLog.mockResolvedValue(undefined);
});

async function post(body: Record<string, unknown>) {
  const { default: handler } = await import("../../api/_inbox.js");
  const res = response();
  tokenSeq++;
  await handler(
    {
      method: "POST",
      query: {},
      headers: { "x-admin-token": `tok-${tokenSeq}` },
      body: { thread_id: "thread-1", ...body },
    },
    res,
  );
  return res;
}

async function put(body: Record<string, unknown>) {
  const { default: handler } = await import("../../api/_inbox.js");
  const res = response();
  await handler(
    {
      method: "PUT",
      query: {},
      headers: { "x-admin-token": "tok-put" },
      body,
    },
    res,
  );
  return res;
}

function threadState() {
  return state.settings["inbox_state:thread-1"] as
    | { handoff?: boolean; agent?: string }
    | undefined;
}

describe("POST /api/inbox takeover — the handoff message must exist", () => {
  it("stores the handoff message, flips state, and audits on success", async () => {
    const res = await post({ action: "takeover" });
    expect(res.statusCode).toBe(200);
    expect(
      state.messages.some(
        (m) => m.sender === "admin" && String(m.body).includes("joined"),
      ),
    ).toBe(true);
    expect(threadState()?.handoff).toBe(true);
    expect(authMocks.auditLog).toHaveBeenCalledWith(
      "admin",
      "inbox_takeover",
      expect.stringContaining("thread-1"),
    );
  });

  it("fails loudly when the handoff message cannot be stored", async () => {
    state.insertErrors.chat_messages = new Error("handoff message lost");
    await expect(post({ action: "takeover" })).rejects.toThrow(
      "handoff message lost",
    );
  });

  it("does not flip state or audit a takeover whose message did not land", async () => {
    state.insertErrors.chat_messages = new Error("handoff message lost");
    await expect(post({ action: "takeover" })).rejects.toThrow();
    expect(threadState()?.handoff).not.toBe(true);
    expect(authMocks.auditLog).not.toHaveBeenCalledWith(
      "admin",
      "inbox_takeover",
      expect.anything(),
    );
  });
});

describe("POST /api/inbox send_to_agent — task and notice must both land", () => {
  it("creates the task, stores the notice, and audits on success", async () => {
    const res = await post({
      action: "send_to_agent",
      agent_id: "facilities",
      body: "Look at the lift",
    });
    expect(res.statusCode).toBe(200);
    expect(
      state.messages.some(
        (m) =>
          m.sender === "system" && String(m.body).includes("facilities"),
      ),
    ).toBe(true);
    expect(authMocks.auditLog).toHaveBeenCalledWith(
      "admin",
      "inbox_agent_msg",
      expect.stringContaining("thread-1"),
    );
  });

  it("answers 500 — not ok:true with task:null — when no task is created", async () => {
    state.createTaskResult = null;
    const res = await post({
      action: "send_to_agent",
      agent_id: "facilities",
      body: "Look at the lift",
    });
    expect(res.statusCode).toBe(500);
  });

  it("fails loudly when the agent notice cannot be stored", async () => {
    state.insertErrors.chat_messages = new Error("notice lost");
    await expect(
      post({
        action: "send_to_agent",
        agent_id: "facilities",
        body: "Look at the lift",
      }),
    ).rejects.toThrow("notice lost");
    expect(authMocks.auditLog).not.toHaveBeenCalledWith(
      "admin",
      "inbox_agent_msg",
      expect.anything(),
    );
  });
});

describe("POST /api/inbox bulk_action — per-thread honesty", () => {
  it("closes the thread and counts it processed on success", async () => {
    const res = await post({
      action: "bulk_action",
      bulk_action: "close",
      thread_ids: ["thread-1"],
    });
    expect(res.statusCode).toBe(200);
    expect(
      (res.body as { processed: number }).processed,
    ).toBe(1);
    expect(state.threads[0]?.status).toBe("closed");
  });

  it("reports ok:false and excludes the thread from processed on failure", async () => {
    state.updateErrors.chat_threads = new Error("close failed");
    const res = await post({
      action: "bulk_action",
      bulk_action: "close",
      thread_ids: ["thread-1"],
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      processed: number;
      results: Array<{ thread_id: string; ok: boolean }>;
    };
    expect(body.results[0]?.ok).toBe(false);
    expect(body.processed).toBe(0);
    expect(state.threads[0]?.status).toBe("open");
  });
});

describe("POST /api/inbox dedup_messages — removed means deleted", () => {
  const DUPES = () => [
    {
      id: "m-1",
      thread_id: "thread-1",
      sender: "user",
      body: "same",
      created_at: "2026-09-27T10:00:00.000Z",
    },
    {
      id: "m-2",
      thread_id: "thread-1",
      sender: "user",
      body: "same",
      created_at: "2026-09-27T10:00:05.000Z",
    },
  ];

  it("deletes the duplicate and reports the real count", async () => {
    state.messages = DUPES();
    const res = await post({ action: "dedup_messages" });
    expect(res.statusCode).toBe(200);
    expect((res.body as { removed: number }).removed).toBe(1);
    expect(state.messages.map((m) => m.id)).toEqual(["m-1"]);
  });

  it("fails loudly instead of reporting removed:1 when the delete fails", async () => {
    state.messages = DUPES();
    state.deleteErrors.chat_messages = new Error("delete failed");
    await expect(post({ action: "dedup_messages" })).rejects.toThrow(
      "delete failed",
    );
    expect(state.messages).toHaveLength(2);
  });
});

describe("PUT /api/inbox — mark_read and set_status prove their writes", () => {
  it("fails loudly when mark_read cannot be stored", async () => {
    state.updateErrors.chat_messages = new Error("mark failed");
    await expect(
      put({ action: "mark_read", thread_id: "thread-1" }),
    ).rejects.toThrow("mark failed");
  });

  it("fails loudly when set_status cannot be stored", async () => {
    state.updateErrors.chat_threads = new Error("status failed");
    await expect(
      put({ action: "set_status", thread_id: "thread-1", status: "closed" }),
    ).rejects.toThrow("status failed");
    expect(state.threads[0]?.status).toBe("open");
  });

  it("still marks read and sets status on success", async () => {
    const r1 = await put({ action: "mark_read", thread_id: "thread-1" });
    expect(r1.statusCode).toBe(200);
    const r2 = await put({
      action: "set_status",
      thread_id: "thread-1",
      status: "closed",
    });
    expect(r2.statusCode).toBe(200);
    expect(state.threads[0]?.status).toBe("closed");
  });
});
