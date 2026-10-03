// db-stats dry run — the estimate mirrors the janitor's real predicates
// (retention_config hours on updated_at with the enable toggle; 30-day age
// outs). If _cleanup.js changes a predicate, this file must fail until the
// mirror is updated.
import { describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({
  default: { from: mockFrom },
}));

vi.mock("../../api/_auth.js", () => ({
  cors: vi.fn(),
  isAdmin: vi.fn(async () => true),
  auditLog: vi.fn(async () => {}),
  sanitizeError: undefined,
}));

import handler from "../../api/_db-stats.js";

const COUNTS = {
  posts: 7,
  comments: 5,
  reactions: 3,
  chat_messages: 2,
  activity_logs: 4,
  agent_conversations: 1,
  polls: 6,
  agent_executions: 9,
  agent_insights: 8,
};

function tableMock(table, retention) {
  const q = {};
  const chain = () => q;
  q.select = vi.fn(chain);
  q.eq = vi.fn(chain);
  q.lte = vi.fn(chain);
  q.maybeSingle = vi.fn(async () => ({
    data: { value: retention },
    error: null,
  }));
  q.then = (resolve) =>
    Promise.resolve({ count: COUNTS[table] ?? 0, error: null }).then(resolve);
  return q;
}

function setup(retention = { user_delete_hours: 5, auto_delete_enabled: true }) {
  vi.clearAllMocks();
  mockFrom.mockImplementation((table) => tableMock(table, retention));
}

function response() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn();
  res.end = vi.fn();
  return res;
}

describe("GET /api/db_stats — janitor-mirroring dry run", () => {
  it("reports what the next janitor pass would delete", async () => {
    setup();
    const res = response();
    await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const dry = res.body.dry_run;
    // retention 5h: all 7 deleted-flagged posts qualify in the mock
    expect(dry.user_deleted_posts).toBe(7);
    expect(dry.old_comments).toBe(5);
    expect(dry.old_reactions).toBe(3);
    expect(dry.old_chat_messages).toBe(2);
    expect(dry.old_activity_logs).toBe(4);
    expect(dry.old_agent_conversations).toBe(1);
    expect(dry.old_archived_polls).toBe(6);
    expect(dry.old_agent_executions).toBe(9);
    expect(dry.old_agent_insights).toBe(8);
    expect(dry.total_would_delete).toBe(7 + 5 + 3 + 2 + 4 + 1 + 6 + 9 + 8);
    expect(dry.retention_hours).toBe(5);
    expect(dry.auto_delete_skipped).toBe(false);
    // widget projection carries counts only — no flags or totals
    expect(res.body.dry_run_counts).toEqual({
      user_deleted_posts: 7,
      old_comments: 5,
      old_reactions: 3,
      old_chat_messages: 2,
      old_activity_logs: 4,
      old_agent_conversations: 1,
      old_archived_polls: 6,
      old_agent_executions: 9,
      old_agent_insights: 8,
    });
  });

  it("reports zero user-deleted posts when the toggle is off", async () => {
    setup({ user_delete_hours: 5, auto_delete_enabled: false });
    const res = response();
    await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
    expect(res.body.dry_run.user_deleted_posts).toBe(0);
    expect(res.body.dry_run.auto_delete_skipped).toBe(true);
  });

  it("estimates 0 for a disabled janitor class and names it", async () => {
    setup({ user_delete_hours: 5, auto_delete_enabled: true, classes: { comments: false } });
    const res = response();
    await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
    expect(res.body.dry_run.old_comments).toBe(0);
    expect(res.body.dry_run.old_reactions).toBe(3);
    expect(res.body.dry_run.skipped_classes).toEqual(["comments"]);
  });

  it("keeps the legacy stale_data block untouched", async () => {
    setup();
    const res = response();
    await handler({ method: "GET", query: {}, body: {}, headers: {} }, res);
    expect(res.body.stale_data).toBeDefined();
    expect(typeof res.body.stale_data.soft_deleted_posts).toBe("number");
  });
});
