// Overview extra coverage — dashboard widgets, queue tabs, broadcast/triage wiring
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Overview from "../pages/admin/Overview";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getSlow: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  toast: vi.fn(),
  downloadFile: vi.fn(),
  markUpdates: vi.fn(),
  clearUpdates: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    get: mocks.get,
    getSlow: mocks.getSlow,
    post: mocks.post,
    put: mocks.put,
    del: mocks.del,
  },
}));

vi.mock("../contexts/AppContext", () => ({
  useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/utils")>();
  return { ...actual, downloadFile: mocks.downloadFile };
});

vi.mock("../pages/admin/ActionCenter", () => ({
  default: () => <div data-testid="action-center-stub" />,
}));

vi.mock("../pages/admin/WorkSections", () => ({
  default: () => <div data-testid="work-sections" />,
}));

vi.mock("../components/admin/ThreadDrawer", () => ({
  default: () => <div data-testid="thread-drawer-stub" />,
}));

vi.mock("../lib/useRealtime", () => ({
  useRealtime: () => {},
}));

vi.mock("../hooks/useUpdateSignal", () => ({
  useUpdateSignal: () => ({
    updatesAvailable: 0,
    markUpdatesAvailable: mocks.markUpdates,
    clearUpdates: mocks.clearUpdates,
  }),
}));

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const PROBLEM = {
  id: "post-1",
  type: "problem",
  title: "Common room heater is broken",
  description: "The common room heater is broken again",
  category: "Facilities",
  status: "open",
  priority: "high",
  author_id: "anon_student_1",
  deleted: false,
  created_at: ago(2 * HOUR),
  reactions: { support: 4 },
  comment_count: 2,
};

const SOLVED = {
  id: "post-2",
  type: "solved",
  title: "Lab 3 projector replaced",
  description: "Lab 3 projector replaced",
  category: "Facilities",
  status: "solved",
  priority: "medium",
  author_id: "anon_student_2",
  deleted: false,
  created_at: ago(25 * HOUR),
};

const COMMENT = {
  id: "c1",
  post_id: "post-1",
  body: "Happening again today",
  author_id: "anon_a",
  created_at: ago(5 * 60_000),
};

const REPORT = {
  id: 7,
  target_type: "post",
  target_id: "post-1",
  reason: "spam",
  status: "pending",
  created_at: ago(30 * 60_000),
};

const USER = { id: "anon_test", name: "Anonymous user", total: 1042 };

const POLL = {
  id: "poll-1",
  title: "Extend library hours?",
  total_votes: 20,
  created_at: ago(HOUR),
};

function seedData(
  overrides: Partial<{
    posts: unknown[];
    comments: unknown[];
    reports: unknown[];
    users: unknown[];
    polls: unknown[];
    threads: unknown[];
    alerts: unknown[];
    announcement: unknown;
    fail: string[];
  }> = {},
) {
  const fail = new Set(overrides.fail ?? []);
  const posts = overrides.posts ?? [PROBLEM, SOLVED];
  const reports = overrides.reports ?? [];
  const alerts = overrides.alerts ?? [];

  mocks.getSlow.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/workforce"))
      return fail.has("alerts")
        ? Promise.reject(new Error("alerts unavailable"))
        : { alerts: { alerts }, updated_at: ago(60_000) };
    if (fail.has("posts")) return Promise.reject(new Error("posts unavailable"));
    return posts;
  });

  mocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/comments"))
      return fail.has("comments")
        ? Promise.reject(new Error("comments unavailable"))
        : (overrides.comments ?? [COMMENT]);
    if (path.startsWith("/api/polls"))
      return fail.has("polls")
        ? Promise.reject(new Error("polls unavailable"))
        : (overrides.polls ?? [POLL]);
    if (path.startsWith("/api/reports"))
      return fail.has("reports")
        ? Promise.reject(new Error("reports unavailable"))
        : reports;
    if (path.startsWith("/api/inbox"))
      return fail.has("inbox")
        ? Promise.reject(new Error("inbox unavailable"))
        : (overrides.threads ?? []);
    if (path.startsWith("/api/announce")) return overrides.announcement ?? null;
    return [];
  });

  mocks.post.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "/api/admin" && (body as { action?: string })?.action === "users") {
      if (fail.has("users")) return Promise.reject(new Error("users unavailable"));
      return overrides.users ?? [USER];
    }
    if (path === "/api/workforce") return { ok: true };
    if (path === "/api/announcements")
      return { ok: true, value: { text: "Library hours extended", kind: "info" } };
    return { ok: true };
  });

  mocks.put.mockResolvedValue({});
}

async function renderDashboard() {
  render(<Overview />);
  await waitFor(() => expect(screen.getByTestId("admin-dashboard")).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId("work-sections")).toBeTruthy());
}

function captureTabEvents(fn: () => void): unknown[] {
  const seen: unknown[] = [];
  const handler = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener("vb:admin-tab", handler);
  try {
    fn();
  } finally {
    window.removeEventListener("vb:admin-tab", handler);
  }
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedData();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Overview extra — snapshot header and refresh", () => {
  it("should render Dashboard heading with real snapshot counts", async () => {
    await renderDashboard();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByText("SNAPSHOT")).toBeTruthy();
    expect(screen.getByText(/2 posts · 1 comments · 1042 users/)).toBeTruthy();
  });

  it("should refetch when Refresh is clicked", async () => {
    await renderDashboard();
    const before = mocks.getSlow.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    await waitFor(() =>
      expect(mocks.getSlow.mock.calls.length).toBeGreaterThan(before),
    );
  });
});

describe("Overview extra — widgets derive from the snapshot", () => {
  it("should render health, urgency and pipeline sections", async () => {
    await renderDashboard();
    expect(within(screen.getByTestId("dash-health")).getByText("Community health")).toBeTruthy();
    expect(
      screen.getByTestId("dash-urgency").textContent,
    ).toMatch(/AI urgency score/);
    expect(
      within(screen.getByTestId("dash-pipeline")).getByText("Pipeline distribution"),
    ).toBeTruthy();
  });

  it("should render stat tiles with real labels", async () => {
    await renderDashboard();
    const stats = within(screen.getByTestId("dash-stats"));
    for (const label of ["Posts this week", "Resolution rate", "Engagement", "Open reports"]) {
      expect(stats.getByText(label)).toBeTruthy();
    }
  });

  it("should render activity, categories and rhythm visuals", async () => {
    await renderDashboard();
    expect(screen.getByTestId("dash-activity")).toBeTruthy();
    expect(screen.getByTestId("dash-categories")).toBeTruthy();
    expect(screen.getByTestId("dash-rhythm")).toBeTruthy();
  });
});

describe("Overview extra — queue tabs filter the ranked list", () => {
  it("should carry live counts on queue pills", async () => {
    await renderDashboard();
    const pills = within(screen.getByTestId("dash-queues"));
    expect(
      pills.getByRole("button", { name: "Trending queue, 1 item" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(pills.getByRole("button", { name: /Recent queue/ })).toBeTruthy();
    expect(pills.getByRole("button", { name: /Open Issues queue/ })).toBeTruthy();
  });

  it("should re-rank rows when switching queue pills without refetch", async () => {
    seedData({
      posts: [
        { ...PROBLEM, id: "hot-1", title: "Hot issue", status: "reported", reactions: { support: 3 }, comment_count: 2 },
        { ...PROBLEM, id: "cold-1", title: "Cold issue", status: "reported", reactions: {}, comment_count: 0 },
      ],
    });
    await renderDashboard();
    const trend = within(screen.getByTestId("dash-trending"));
    expect(trend.getByText("Hot issue")).toBeTruthy();
    expect(trend.queryByText("Cold issue")).toBeNull();
    fireEvent.click(
      within(screen.getByTestId("dash-queues")).getByRole("button", {
        name: "Recent queue, 2 items",
      }),
    );
    expect(trend.getByText("Cold issue")).toBeTruthy();
  });

  it("should Start and Solve a trending post through the real endpoint", async () => {
    seedData({
      posts: [
        { ...PROBLEM, id: "hot-1", title: "Hot issue", status: "reported", reactions: { support: 3 }, comment_count: 1 },
      ],
    });
    await renderDashboard();
    const trend = within(screen.getByTestId("dash-trending"));
    fireEvent.click(trend.getByRole("button", { name: "Start trending hot-1" }));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
        id: "hot-1",
        status: "in_progress",
      }),
    );
    fireEvent.click(trend.getByRole("button", { name: "Solve trending hot-1" }));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
        id: "hot-1",
        status: "solved",
      }),
    );
  });
});

describe("Overview extra — triage and broadcast", () => {
  it("should Verify a triage post and resolve its report", async () => {
    seedData({
      posts: [{ ...PROBLEM, id: "post-9", title: "Triage me", status: "reported" }],
      reports: [{ ...REPORT, target_id: "post-9" }],
    });
    await renderDashboard();
    const triage = within(screen.getByTestId("dash-triage"));
    expect(triage.getByText("1 waiting")).toBeTruthy();
    fireEvent.click(triage.getByRole("button", { name: "Verify post post-9" }));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
        id: "post-9",
        status: "verified",
      }),
    );
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith("/api/reports", {
        id: 7,
        status: "resolved",
      }),
    );
  });

  it("should publish a broadcast through the announcements endpoint", async () => {
    await renderDashboard();
    const band = within(screen.getByTestId("dash-broadcast"));
    fireEvent.change(band.getByLabelText("Announcement text"), {
      target: { value: "Library hours extended" },
    });
    fireEvent.click(band.getByRole("button", { name: "Publish announcement" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/api/announcements", {
        text: "Library hours extended",
        kind: "info",
      }),
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Announcement published — visible to every visitor",
        "ok",
      ),
    );
  });

  it("should show Remove when a live announcement is active", async () => {
    seedData({
      announcement: { text: "Exam week hours", kind: "warning", at: ago(60_000) },
    });
    await renderDashboard();
    const band = within(screen.getByTestId("dash-broadcast"));
    expect(band.getByText(/Live now \(warning\): Exam week hours/)).toBeTruthy();
    expect(band.getByRole("button", { name: "Remove announcement" })).toBeTruthy();
  });
});

describe("Overview extra — navigation, layout and failures", () => {
  it("should dispatch vb:admin-tab for jump-row queues and keep Action Center hidden", async () => {
    await renderDashboard();
    expect(screen.queryByTestId("action-center-stub")).toBeNull();
    const nav = within(screen.getByRole("navigation", { name: "Admin queues" }));
    const dispatched = captureTabEvents(() => {
      fireEvent.click(nav.getByRole("button", { name: /Reports/ }));
    });
    expect(dispatched).toEqual(["reports"]);
    fireEvent.click(screen.getByRole("button", { name: "Action Center" }));
    expect(screen.getByTestId("action-center-stub")).toBeTruthy();
  });

  it("should surface an empty trending queue honestly", async () => {
    seedData({ posts: [{ ...PROBLEM, reactions: {}, comment_count: 0 }] });
    await renderDashboard();
    expect(screen.getByText("No trending issues right now.")).toBeTruthy();
  });

  it("should name the failed source and keep the rest visible", async () => {
    seedData({ fail: ["users"] });
    render(<Overview />);
    await waitFor(() =>
      expect(screen.getByText(/Some sources failed: users/)).toBeTruthy(),
    );
    expect(screen.getByTestId("dash-health")).toBeTruthy();
  });

  it("should reorder cards with arrow keys, persist, and reset", async () => {
    await renderDashboard();
    const dash = screen.getByTestId("admin-dashboard");
    const orderOf = (unit: string) =>
      Number(
        dash.querySelector(`[data-unit="${unit}"]`)?.getAttribute("style")?.match(/order:\s*(\d+)/)?.[1] ?? -1,
      );
    expect(orderOf("inbox")).toBeLessThan(orderOf("stats"));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Reorder Emergency inbox section" }),
      { key: "ArrowDown" },
    );
    expect(JSON.parse(localStorage.getItem("vb:admin-layout") || "[]")[1]).toBe("inbox");
    fireEvent.click(screen.getByRole("button", { name: "Reset dashboard layout" }));
    const fresh = dash.querySelector('[data-unit="inbox"]') as HTMLElement;
    expect(fresh.style.order).toBe("0");
  });

  it("should count emergency inbox threads and collapse the digest", async () => {
    seedData({
      threads: [
        {
          thread_id: "thr_crit_1",
          status: "open",
          handoff: false,
          last_sender: "user",
          unread: 2,
          last_at: ago(10 * 60_000),
          last_message: "I need help right now",
          emotion: { level: "critical" },
        },
      ],
    });
    await renderDashboard();
    const digest = within(screen.getByTestId("dash-inbox-digest"));
    expect(digest.getByText(/1 critical/)).toBeTruthy();
    expect(digest.getByText("I need help right now")).toBeTruthy();
    fireEvent.click(digest.getByRole("button", { name: "Collapse emergency inbox" }));
    expect(digest.queryByText("I need help right now")).toBeNull();
    fireEvent.click(digest.getByRole("button", { name: "Expand emergency inbox" }));
    expect(digest.getByText("I need help right now")).toBeTruthy();
  });
});
