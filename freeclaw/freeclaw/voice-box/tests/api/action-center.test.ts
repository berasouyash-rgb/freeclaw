import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  cors: vi.fn(),
  isAdmin: vi.fn(),
  auditLog: vi.fn(),
}));

const dbMocks = vi.hoisted(() => {
  const state = {
    read: { data: { value: { tasks: [] } }, error: null as unknown },
    write: { data: null, error: null as unknown },
    fromCalls: 0,
  };

  const makeQuery = () => {
    const query: Record<string, unknown> = {};
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => state.read),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(state.write).then(resolve, reject),
    };
    Object.assign(query, chain);
    return chain;
  };

  const from = vi.fn(() => {
    state.fromCalls += 1;
    return makeQuery();
  });

  return {
    state,
    client: { from },
    from,
  };
});

vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_db-client.js", () => ({ default: dbMocks.client }));
vi.mock("../../api/_error.js", () => ({
  sanitizeError: (res: { status: (code: number) => { json: (body: unknown) => unknown } }, err: unknown) => {
    const message = err instanceof Error ? err.message : "Action Center unavailable";
    return res.status(500).json({ error: message });
  },
}));
vi.mock("../../api/_observability.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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
  req: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
  const handler = (await import("../../api/_action-center.js")).default;
  const res = response();
  await handler(
    {
      method: "GET",
      query: {},
      body: {},
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      ...req,
    },
    res,
  );
  return { statusCode: res.statusCode, body: res.body };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.isAdmin.mockResolvedValue(true);
  dbMocks.state.read = { data: { value: { tasks: [] } }, error: null };
  dbMocks.state.write = { data: null, error: null };
  dbMocks.state.fromCalls = 0;
});

describe("Action Center API truthfulness boundary", () => {
  it("rejects a non-admin summary read before touching the database", async () => {
    authMocks.isAdmin.mockResolvedValue(false);

    const result = await call({ method: "GET", query: { action: "summary" } });

    expect(result.statusCode).toBe(403);
    expect(dbMocks.from).not.toHaveBeenCalled();
  });

  it("does not turn a settings read error into an empty summary", async () => {
    dbMocks.state.read = {
      data: null,
      error: new Error("database unavailable"),
    };

    const result = await call({ method: "GET", query: { action: "summary" } });

    expect(result.statusCode).toBe(500);
    expect(result.body).not.toMatchObject({ open: 0, total: 0 });
  });

  it("does not acknowledge a task when persistence fails", async () => {
    dbMocks.state.read = {
      data: { value: { tasks: [{ id: "ACT-1", status: "OPEN", title: "Review" }] } },
      error: null,
    };
    dbMocks.state.write = { data: null, error: new Error("write failed") };

    const result = await call({
      method: "POST",
      body: { action: "acknowledge", task_id: "ACT-1" },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body).not.toMatchObject({ status: "ACKNOWLEDGED" });
  });

  it("returns a bounded timestamped summary to an authenticated admin", async () => {
    const result = await call({ method: "GET", query: { action: "summary" } });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      total: 0,
      open: 0,
      critical: 0,
      generated_at: expect.any(String),
    });
  });
});
