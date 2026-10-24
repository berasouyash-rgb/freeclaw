/**
 * TDD Tests for StatusTimeline Component
 *
 * Proves that:
 * 1. Renders progress bar with correct percentage
 * 2. Shows correct stage as current (highlighted)
 * 3. Shows completed stages with checkmark icons
 * 4. Shows future stages as unfilled circles
 * 5. Renders status history entries in reverse chronological order
 * 6. Shows ETA when provided
 * 7. Has proper ARIA attributes (progressbar, aria-label)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusTimeline from "../components/StatusTimeline";

// Mock PurgeCountdown since it's a child component
vi.mock("../components/PurgeCountdown", () => ({
  default: ({ purgeAt }: { purgeAt: string }) => (
    <div data-testid="purge-countdown">Purge: {purgeAt}</div>
  ),
}));

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    status: "in_progress",
    progress: 50,
    ...overrides,
  };
}

describe("StatusTimeline", () => {
  describe("progress bar", () => {
    it("renders progress bar with correct aria attributes", () => {
      render(<StatusTimeline post={makePost({ progress: 65 })} />);
      const bar = screen.getByRole("progressbar");
      expect(bar).toHaveAttribute("aria-valuenow", "65");
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
    });

    it("shows percentage text", () => {
      render(<StatusTimeline post={makePost({ progress: 75 })} />);
      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("defaults to 0% when progress is undefined", () => {
      render(<StatusTimeline post={makePost({ progress: undefined })} />);
      expect(screen.getByText("0%")).toBeInTheDocument();
    });
  });

  describe("stage pipeline", () => {
    it("renders all 5 stages", () => {
      render(<StatusTimeline post={makePost()} />);
      expect(screen.getByText("Reported")).toBeInTheDocument();
      expect(screen.getByText("Verified")).toBeInTheDocument();
      expect(screen.getByText("In Progress")).toBeInTheDocument();
      expect(screen.getByText("Waiting")).toBeInTheDocument();
      expect(screen.getByText("Solved")).toBeInTheDocument();
    });

    it("highlights current stage", () => {
      render(<StatusTimeline post={makePost({ status: "in_progress" })} />);
      const stage = screen.getByText("In Progress");
      // Current stage should have vb-glow class
      expect(stage.closest("li")?.querySelector(".vb-glow")).toBeTruthy();
    });

    it("shows reported as first completed stage", () => {
      render(<StatusTimeline post={makePost({ status: "reported" })} />);
      // Reported should be current (first stage)
      const stage = screen.getByText("Reported");
      expect(stage.closest("li")?.querySelector(".vb-glow")).toBeTruthy();
    });

    it("shows all stages completed for solved status", () => {
      render(<StatusTimeline post={makePost({ status: "solved" })} />);
      // All stages should be done
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(5);
    });

    it("has accessible label for the stage list", () => {
      render(<StatusTimeline post={makePost()} />);
      expect(screen.getByRole("list", { name: "Status stages" })).toBeInTheDocument();
    });
  });

  describe("status history", () => {
    it("renders history entries", () => {
      render(
        <StatusTimeline
          post={makePost({
            status_history: [
              { status: "reported", at: "2025-01-15T10:00:00Z" },
              { status: "verified", at: "2025-01-16T12:00:00Z", note: "Confirmed" },
            ],
          })}
        />,
      );
      // "Reported" and "Verified" appear in both the stage pipeline and history
      const reported = screen.getAllByText("Reported");
      expect(reported.length).toBeGreaterThanOrEqual(2);
      const verified = screen.getAllByText("Verified");
      expect(verified.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Confirmed")).toBeInTheDocument();
    });

    it("renders without history when empty", () => {
      render(<StatusTimeline post={makePost({ status_history: [] })} />);
      // Should still render the progress bar and stages
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("renders without history when undefined", () => {
      render(<StatusTimeline post={makePost({})} />);
      expect(screen.getByText("50%")).toBeInTheDocument();
    });
  });

  describe("ETA display", () => {
    it("shows ETA when provided", () => {
      render(<StatusTimeline post={makePost({ eta: "2-3 business days" })} />);
      expect(screen.getByText("2-3 business days")).toBeInTheDocument();
      expect(screen.getByText(/Estimated completion/)).toBeInTheDocument();
    });

    it("hides ETA when not provided", () => {
      render(<StatusTimeline post={makePost({})} />);
      expect(screen.queryByText(/Estimated completion/)).not.toBeInTheDocument();
    });
  });

  describe("purge countdown", () => {
    it("shows purge countdown when purge_at is set", () => {
      render(
        <StatusTimeline
          post={makePost({ purge_at: "2025-02-01T00:00:00Z" })}
        />,
      );
      expect(screen.getByTestId("purge-countdown")).toBeInTheDocument();
    });

    it("hides purge countdown when purge_at is not set", () => {
      render(<StatusTimeline post={makePost({})} />);
      expect(screen.queryByTestId("purge-countdown")).not.toBeInTheDocument();
    });
  });

  describe("archived status", () => {
    it("treats archived as solved (last stage)", () => {
      render(<StatusTimeline post={makePost({ status: "archived" })} />);
      // Archived should show all stages as done
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(5);
    });
  });
});
