/**
 * TDD Tests for PollCard Component
 *
 * Proves that:
 * 1. Renders poll title, options, and vote count
 * 2. Shows "Not voted yet" when no vote
 * 3. Shows "You voted" when voted
 * 4. Enables/disables vote button based on selection
 * 5. Handles single-choice and multi-choice polls
 * 6. Shows results after voting
 * 7. Shows expired/closed state
 * 8. Change vote flow works
 * 9. Accessibility: proper ARIA roles and labels
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PollCard from "../components/PollCard";
import type { PollData } from "../types";

// Mock AppContext
const mockToast = vi.fn();
vi.mock("../contexts/AppContext", () => ({
  useApp: () => ({
    anonId: "test-user-1",
    toast: mockToast,
  }),
}));

// Mock api
vi.mock("../lib/api", () => ({
  api: {
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
  },
  hasAdminSession: () => false,
}));

function makePoll(overrides: Partial<PollData> = {}): PollData {
  return {
    id: "poll-1",
    title: "Should we install solar panels?",
    options: ["Yes", "No", "Maybe"],
    vote_counts: [10, 5, 3],
    total_votes: 18,
    ptype: "single",
    is_mine: false,
    author_id: "other-user",
    ...overrides,
  } as PollData;
}

describe("PollCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders poll title", () => {
      render(<PollCard poll={makePoll()} />);
      expect(screen.getByText("Should we install solar panels?")).toBeInTheDocument();
    });

    it("renders all options", () => {
      render(<PollCard poll={makePoll()} />);
      expect(screen.getByText("Yes")).toBeInTheDocument();
      expect(screen.getByText("No")).toBeInTheDocument();
      expect(screen.getByText("Maybe")).toBeInTheDocument();
    });

    it("renders vote count", () => {
      render(<PollCard poll={makePoll()} />);
      expect(screen.getByText(/18 vote/)).toBeInTheDocument();
    });

    it("says no votes yet instead of identical 0% bars on a voteless poll", () => {
      render(
        <PollCard
          poll={makePoll({ vote_counts: [0, 0, 0], total_votes: 0, archived: true })}
        />,
      );
      expect(screen.getByText(/no votes yet/i)).toBeInTheDocument();
    });

    it("renders poll type label", () => {
      render(<PollCard poll={makePoll()} />);
      expect(screen.getByText(/single choice/)).toBeInTheDocument();
    });

    it("renders yes/no label for yesno polls", () => {
      render(<PollCard poll={makePoll({ ptype: "yesno", options: ["Yes", "No"] })} />);
      expect(screen.getByText(/yes \/ no/)).toBeInTheDocument();
    });

    it("renders multiple choice label for multi polls", () => {
      render(<PollCard poll={makePoll({ ptype: "multi" })} />);
      expect(screen.getByText(/multiple choice/)).toBeInTheDocument();
    });
  });

  describe("vote state", () => {
    it("shows 'Not voted yet' when no vote", () => {
      render(<PollCard poll={makePoll()} />);
      expect(screen.getByText("Not voted yet")).toBeInTheDocument();
    });

    it("shows 'You voted' when voted", () => {
      render(<PollCard poll={makePoll()} myVote={[0]} />);
      expect(screen.getByText("You voted")).toBeInTheDocument();
    });

    it("shows Vote button when not voted", () => {
      render(<PollCard poll={makePoll()} />);
      expect(screen.getByRole("button", { name: "Vote" })).toBeInTheDocument();
    });

    it("shows Change vote button when voted", () => {
      render(<PollCard poll={makePoll()} myVote={[0]} />);
      expect(screen.getByRole("button", { name: /Change vote/ })).toBeInTheDocument();
    });

    it("disables Vote button when nothing selected", () => {
      render(<PollCard poll={makePoll()} />);
      const voteBtn = screen.getByRole("button", { name: "Vote" });
      expect(voteBtn).toBeDisabled();
    });

    it("explains why Vote is disabled when nothing is selected", () => {
      render(<PollCard poll={makePoll()} />);
      const voteBtn = screen.getByRole("button", { name: "Vote" });
      const label =
        voteBtn.getAttribute("title") || voteBtn.getAttribute("aria-label") || "";
      expect(label.toLowerCase()).toContain("select");
    });
  });

  describe("option selection", () => {
    it("selects an option on click", () => {
      render(<PollCard poll={makePoll()} />);
      const yesBtn = screen.getByText("Yes").closest("button")!;
      fireEvent.click(yesBtn);
      expect(yesBtn).toHaveAttribute("aria-checked", "true");
    });

    it("deselects option on second click (single choice)", () => {
      render(<PollCard poll={makePoll()} />);
      const yesBtn = screen.getByText("Yes").closest("button")!;
      fireEvent.click(yesBtn);
      expect(yesBtn).toHaveAttribute("aria-checked", "true");
      fireEvent.click(yesBtn);
      expect(yesBtn).toHaveAttribute("aria-checked", "false");
    });

    it("enables Vote button after selection", () => {
      render(<PollCard poll={makePoll()} />);
      const yesBtn = screen.getByText("Yes").closest("button")!;
      fireEvent.click(yesBtn);
      const voteBtn = screen.getByRole("button", { name: "Vote" });
      expect(voteBtn).not.toBeDisabled();
    });

    it("allows multiple selections for multi-choice polls", () => {
      render(<PollCard poll={makePoll({ ptype: "multi" })} />);
      const yesBtn = screen.getByText("Yes").closest("button")!;
      const noBtn = screen.getByText("No").closest("button")!;
      fireEvent.click(yesBtn);
      fireEvent.click(noBtn);
      expect(yesBtn).toHaveAttribute("aria-checked", "true");
      expect(noBtn).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("single-vote guard", () => {
    it("sends exactly one vote request for two rapid Vote taps", async () => {
      // One tap = one vote. Two taps inside one frame must not fire two
      // requests: the server upserts per author, but a doubled request is a
      // doubled chance at a double count.
      const { api } = await import("../lib/api");
      const postSpy = api.post as ReturnType<typeof vi.fn>;
      postSpy.mockImplementationOnce(() => new Promise(() => {}));
      render(<PollCard poll={makePoll()} />);
      fireEvent.click(screen.getByRole("radio", { name: /Yes/ }));
      const voteBtn = screen.getByRole("button", { name: /^Vote$/ });
      voteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      voteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(() => {
        expect(
          postSpy.mock.calls.filter(([u]) => String(u).includes("/api/polls")),
        ).toHaveLength(1);
      });
    });
  });

  describe("expired/closed polls", () => {
    it("shows Ended badge for expired polls", () => {
      render(
        <PollCard
          poll={makePoll({
            expires_at: "2020-01-01T00:00:00Z",
          })}
        />,
      );
      expect(screen.getByText("Ended")).toBeInTheDocument();
    });

    it("disables options for expired polls", () => {
      render(
        <PollCard
          poll={makePoll({
            expires_at: "2020-01-01T00:00:00Z",
          })}
        />,
      );
      const options = screen.getAllByRole("radio");
      options.forEach((opt) => expect(opt).toBeDisabled());
    });

    it("hides vote button for expired polls", () => {
      render(
        <PollCard
          poll={makePoll({
            expires_at: "2020-01-01T00:00:00Z",
          })}
        />,
      );
      expect(screen.queryByRole("button", { name: "Vote" })).not.toBeInTheDocument();
    });

    it("shows Archived badge for archived polls", () => {
      render(<PollCard poll={makePoll({ archived: true })} />);
      expect(screen.getByText("Archived")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("uses radiogroup for single-choice polls", () => {
      render(<PollCard poll={makePoll({ ptype: "single" })} />);
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    });

    it("uses group for multi-choice polls", () => {
      render(<PollCard poll={makePoll({ ptype: "multi" })} />);
      expect(screen.getByRole("group")).toBeInTheDocument();
    });

    it("options have radio role for single-choice", () => {
      render(<PollCard poll={makePoll({ ptype: "single" })} />);
      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(3);
    });

    it("options have checkbox role for multi-choice", () => {
      render(<PollCard poll={makePoll({ ptype: "multi" })} />);
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(3);
    });

    it("radiogroup has aria-label with poll title", () => {
      render(<PollCard poll={makePoll()} />);
      const group = screen.getByRole("radiogroup");
      expect(group).toHaveAttribute("aria-label", "Should we install solar panels?");
    });
  });

  describe("results display", () => {
    it("shows vote counts and percentages after voting", () => {
      render(<PollCard poll={makePoll()} myVote={[0]} />);
      // After voting, results should show
      expect(screen.getByText(/10/)).toBeInTheDocument(); // vote count for "Yes"
      expect(screen.getByText(/56%/)).toBeInTheDocument(); // 10/18 = 55.6% ≈ 56%
    });

    it("shows accent styling for the selected option during vote change", () => {
      render(<PollCard poll={makePoll()} myVote={[0]} />);
      // After voting, results are shown — the voted option shows a checkmark icon
      // and the accent-soft background when changing vote
      const changeBtn = screen.getByRole("button", { name: /Change vote/ });
      fireEvent.click(changeBtn);
      // Now in changingVote mode — selected option gets accent styling
      const yesBtn = screen.getByText("Yes").closest("button")!;
      expect(yesBtn).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("countdown timer", () => {
    it("shows countdown for polls with future expiry", () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours from now
      render(<PollCard poll={makePoll({ expires_at: futureDate })} />);
      expect(screen.getByText(/ends in/)).toBeInTheDocument();
    });

    it("uses minute precision so no per-second timer re-render is needed", () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      render(<PollCard poll={makePoll({ expires_at: futureDate })} />);
      // ~2h out reads as 1h 59m or 2h 0m depending on render milliseconds —
      // either way it is hours+minutes with no seconds component.
      expect(screen.getByText(/^ends in \d+h \d+m$/)).toBeInTheDocument();
    });
  });
});
