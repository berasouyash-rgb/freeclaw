// ═══════════════════════════════════════════════════════════════════
// AI Systems console — renders measured health, never estimates.
// ═══════════════════════════════════════════════════════════════════
// Pins: registry rows render with live stats merged; empty rings show an
// honest "no data yet" state (not zeros dressed as measurements); warnings
// list demotion/low-success issues; failures show an explicit error with
// retry; refresh re-fetches on tap.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiSystems from "../pages/admin/AiSystems";

const getMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({
  api: { get: getMock },
}));

const HEALTHY = {
  status: "healthy",
  checks: {
    ai: {
      status: "ok",
      tasks: {
        transcribe: {
          calls: 20,
          errors: 1,
          successRate: 0.95,
          p50: 800,
          p95: 1500,
          lastLane: "groq",
          lastOk: true,
          demoted: [],
        },
      },
      registry: [
        {
          key: "transcribe",
          owner: "api/_transcribe.js",
          description: "Server speech-to-text.",
          adminOnly: false,
          lanes: [{ provider: "groq" }],
          fallback: "none",
          rate: {},
          kill: "none",
        },
        {
          key: "assist.suggest",
          owner: "api/_assist.js",
          description: "Typing suggestions.",
          adminOnly: false,
          lanes: [],
          fallback: "local",
          rate: {},
          kill: "none",
        },
      ],
    },
  },
};

const WARNING = {
  status: "degraded",
  checks: {
    ai: {
      status: "warning",
      issues: ["transcribe: lane(s) demoted (groq)"],
      tasks: {
        transcribe: {
          calls: 10,
          errors: 6,
          successRate: 0.4,
          p50: 900,
          p95: 2000,
          lastLane: "groq",
          lastOk: false,
          demoted: ["groq"],
        },
      },
      registry: (HEALTHY.checks.ai.registry as Array<unknown>).slice(0, 1),
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue(HEALTHY);
});

describe("AiSystems console", () => {
  it("renders registry rows merged with live stats", async () => {
    render(<AiSystems />);
    expect(await screen.findByText("transcribe")).toBeInTheDocument();
    expect(screen.getByText("assist.suggest")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("1500ms")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("shows no-data-yet instead of invented zeros for unobserved tasks", async () => {
    render(<AiSystems />);
    await screen.findByText("transcribe");
    // assist.suggest has no live stats in HEALTHY.tasks.
    const rows = screen.getAllByTestId("ai-task-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("no data yet")).toBeInTheDocument();
    expect(
      screen.getByText(/No AI calls observed|no data yet/i),
    ).toBeInTheDocument();
  });

  it("lists demotion issues when the check warns", async () => {
    getMock.mockResolvedValue(WARNING);
    render(<AiSystems />);
    expect(await screen.findByTestId("ai-warning")).toBeInTheDocument();
    expect(
      screen.getByText("transcribe: lane(s) demoted (groq)"),
    ).toBeInTheDocument();
    expect(screen.getByText("demoted: groq")).toBeInTheDocument();
  });

  it("shows an explicit error with retry on fetch failure", async () => {
    getMock.mockRejectedValueOnce(new Error("health down"));
    render(<AiSystems />);
    expect(await screen.findByText("health down")).toBeInTheDocument();
    getMock.mockResolvedValue(HEALTHY);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.getByText("transcribe")).toBeInTheDocument();
    });
  });

  it("re-fetches on explicit Refresh tap", async () => {
    render(<AiSystems />);
    await screen.findByText("transcribe");
    expect(getMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledTimes(2);
    });
  });
});
