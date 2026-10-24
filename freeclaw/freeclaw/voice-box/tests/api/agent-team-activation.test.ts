// ═══════════════════════════════════════════════════════════════════
// AgentTeam activation id validation — the id must be proven safe before it
// becomes an object key.
// ═══════════════════════════════════════════════════════════════════
// DEFECT (logged REAL-but-LOW in docs/QA/BUG-LEDGER.md iteration 11):
// `activate` / `deactivate` / `setAutonomous` only checked `if (!b.id)`,
// then ran `state[b.id] = {...}` on a plain object. `b.id = "__proto__"`
// invokes the prototype setter (prototype mutation, entry invisible to
// Object.keys yet readable back), while `constructor` / `prototype` create
// phantom entries that persist into the `agent_activation_state` settings
// row — and the audit log recorded e.g. "Activated agent: __proto__" as if
// a real agent changed state.
//
// Admin-only, so data-integrity (not privilege escalation) — but the audit
// trail must never certify a state change that did not happen to a real key.
//
// Contract:
//   1. id must be a string, 1–80 chars, [a-zA-Z0-9_-] only.
//   2. `__proto__`, `constructor`, `prototype` are refused outright.
//   3. Refusal is 400 with no state write and no audit entry.
//   4. Well-formed ids — including `custom-*` ids for agents registered on
//      another instance — keep working. There is deliberately NO existence
//      allowlist: customAgents is in-memory while activation state persists
//      in the DB, so an allowlist would wrongly reject activations after a
//      cold start.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  upsertErrors: {} as Record<string, Error | undefined>,
}));

function chainFor(table: string) {
  const eqs: Array<[string, unknown]> = [];
  let op: "select" | "upsert" = "select";
  let patch: Record<string, unknown> = {};
  const self = {
    then(fn: (v: unknown) => void) {
      if (op === "upsert") {
        const err = state.upsertErrors[table];
        fn({ data: null, error: err ?? null });
        if (!err && table === "settings")
          state.settings[String(patch.key)] = patch.value;
        return;
      }
      const key = eqs.find(([c]) => c === "key")?.[1];
      const value =
        key !== undefined ? state.settings[String(key)] : undefined;
      fn({ data: value === undefined ? null : { value }, error: null });
    },
    select() {
      return self;
    },
    maybeSingle() {
      return self;
    },
    single() {
      return self;
    },
    upsert(row: Record<string, unknown>) {
      op = "upsert";
      patch = row;
      return self;
    },
    eq(col: string, val: unknown) {
      eqs.push([col, val]);
      return self;
    },
  };
  return self;
}

const from = vi.fn((table: string) => chainFor(table));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  auditLog: vi.fn(),
}));
vi.mock("../../api/_auth.js", () => ({
  ...authMocks,
  cors: vi.fn(),
  clean: (s: unknown) => String(s ?? ""),
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
  vi.resetModules();
  vi.clearAllMocks();
  state.settings = {};
  state.upsertErrors = {};
  authMocks.isAdmin.mockResolvedValue(true);
  authMocks.auditLog.mockResolvedValue(undefined);
});

async function post(body: Record<string, unknown>) {
  const { default: handler } = await import("../../api/_agent-team.js");
  const res = response();
  await handler(
    { method: "POST", query: {}, headers: {}, body },
    res,
  );
  return res;
}

function storedAgents(): Record<string, unknown> {
  return (
    (state.settings["agent_activation_state"] as { agents?: object })
      ?.agents ?? {}
  ) as Record<string, unknown>;
}

describe("POST /api/agent-team activation — id validation", () => {
  it("activates a well-formed built-in id", async () => {
    const res = await post({ action: "activate", id: "meta-orchestrator" });
    expect(res.statusCode).toBe(200);
    expect(
      (storedAgents()["meta-orchestrator"] as { active?: boolean })?.active,
    ).toBe(true);
    expect(authMocks.auditLog).toHaveBeenCalledWith(
      "admin",
      "agent_activate",
      expect.stringContaining("meta-orchestrator"),
    );
  });

  it("keeps activating well-formed custom ids (no existence allowlist)", async () => {
    const res = await post({ action: "activate", id: "custom-1727-ab12cd" });
    expect(res.statusCode).toBe(200);
    expect(
      (storedAgents()["custom-1727-ab12cd"] as { active?: boolean })?.active,
    ).toBe(true);
  });

  it("deactivates a well-formed id", async () => {
    const res = await post({ action: "deactivate", id: "meta-orchestrator" });
    expect(res.statusCode).toBe(200);
    expect(
      (storedAgents()["meta-orchestrator"] as { active?: boolean })?.active,
    ).toBe(false);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses activate with id %j and writes nothing",
    async (id) => {
      const res = await post({ action: "activate", id });
      expect(res.statusCode).toBe(400);
      expect(storedAgents()).toEqual({});
      expect(authMocks.auditLog).not.toHaveBeenCalled();
    },
  );

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses deactivate with id %j and writes nothing",
    async (id) => {
      const res = await post({ action: "deactivate", id });
      expect(res.statusCode).toBe(400);
      expect(storedAgents()).toEqual({});
      expect(authMocks.auditLog).not.toHaveBeenCalled();
    },
  );

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses setAutonomous with id %j and writes nothing",
    async (id) => {
      const res = await post({
        action: "setAutonomous",
        id,
        autonomous: true,
      });
      expect(res.statusCode).toBe(400);
      expect(storedAgents()).toEqual({});
      expect(authMocks.auditLog).not.toHaveBeenCalled();
    },
  );

  it.each(["../x", "a b", "a/b", "", "x".repeat(81), 123, {}, null])(
    "refuses malformed id %j",
    async (id) => {
      const res = await post({ action: "activate", id: id as string });
      expect(res.statusCode).toBe(400);
      expect(storedAgents()).toEqual({});
    },
  );

  it("leaves Object.prototype untouched by a __proto__ attempt", async () => {
    await post({ action: "activate", id: "__proto__" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(storedAgents(), "__proto__"),
    ).toBe(false);
  });
});

describe("POST /api/agent-team activation — persistence must be proven", () => {
  // SIBLING of the id-validation defect above, same false-success family:
  // saveActivationState updated the in-memory cache FIRST, then swallowed a
  // failed settings upsert (console.error only) — so activate answered
  // ok:true + audited while the row never landed. This instance believed the
  // agent was (de)activated; every other instance and every cold start did
  // not. The cache must only advance on proven persistence.
  it("fails loudly when the activation state cannot be persisted", async () => {
    state.upsertErrors.settings = new Error("persist failed");
    await expect(
      post({ action: "activate", id: "meta-orchestrator" }),
    ).rejects.toThrow("persist failed");
    expect(authMocks.auditLog).not.toHaveBeenCalled();
    expect(storedAgents()).toEqual({});
  });

  it("does not poison the cache with the unpersisted change", async () => {
    state.upsertErrors.settings = new Error("persist failed");
    await expect(
      post({ action: "activate", id: "meta-orchestrator" }),
    ).rejects.toThrow();
    // Failure cleared: the next write must build on the last PROVEN state,
    // not on the change that never landed.
    state.upsertErrors = {};
    const res = await post({ action: "deactivate", id: "ceo-intelligence" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(storedAgents())).toEqual(["ceo-intelligence"]);
  });

  it("fails loudly when a deactivation cannot be persisted", async () => {
    state.upsertErrors.settings = new Error("persist failed");
    await expect(
      post({ action: "deactivate", id: "meta-orchestrator" }),
    ).rejects.toThrow("persist failed");
    expect(authMocks.auditLog).not.toHaveBeenCalledWith(
      "admin",
      "agent_deactivate",
      expect.anything(),
    );
  });
});
