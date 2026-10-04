/**
 * TDD Tests for PostCard Component
 *
 * Proves that:
 * 1. Renders post title, description, category, and status
 * 2. Shows reaction buttons with correct counts
 * 3. Shows bookmark toggle
 * 4. Shows report button
 * 5. Shows trending badge when score is high
 * 6. Shows pinned/featured badges
 * 7. Accessibility: proper ARIA labels and roles
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PostCard from "../components/PostCard";
import type { PostData } from "../types";

// Mock AppContext
const mockToast = vi.fn();
const mockToggleBookmark = vi.fn();
vi.mock("../contexts/AppContext", () => ({
  useApp: () => ({
    anonId: "test-user-1",
    bookmarks: [],
    toggleBookmark: mockToggleBookmark,
    toast: mockToast,
  }),
}));

// Mock api
vi.mock("../lib/api", () => ({
  api: {
    post: vi.fn().mockResolvedValue({
      counts: { support: 6 },
      mine: ["support"],
      toggled: true,
    }),
    put: vi.fn().mockResolvedValue({}),
  },
  hasAdminSession: () => false,
}));

// Mock react-router Link
vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

// Mock ReportDialog and ConfirmDialog
vi.mock("../components/ui", () => ({
  ReportDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div data-testid="report-dialog"><button onClick={onClose}>Close</button></div> : null,
  ConfirmDialog: () => null,
}));

function makePost(overrides: Partial<PostData> = {}): PostData {
  return {
    id: "post-1",
    title: "Broken elevator in Building A",
    description: "The elevator has been broken for 2 days. Nobody can use it.",
    category: "Facilities",
    status: "reported",
    priority: "high",
    type: "problem",
    author_id: "user-1",
    created_at: "2025-07-20T10:00:00Z",
    reactions: { support: 5, disagree: 2 },
    comment_count: 3,
    tags: ["elevator", "safety"],
    ...overrides,
  } as PostData;
}

describe("PostCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders post title", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByText("Broken elevator in Building A")).toBeInTheDocument();
    });

    it("renders post description", () => {
      render(<PostCard post={makePost()} />);
      expect(
        screen.getByText("The elevator has been broken for 2 days. Nobody can use it."),
      ).toBeInTheDocument();
    });

    it("renders category chip", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByText("Facilities")).toBeInTheDocument();
    });

    it("renders status chip", () => {
      render(<PostCard post={makePost({ status: "reported" })} />);
      expect(screen.getByText("Reported")).toBeInTheDocument();
    });

    it("renders the content-type chip so suggestions never read as complaints", () => {
      render(<PostCard post={makePost({ type: "problem" })} />);
      expect(screen.getByText("Problem")).toBeInTheDocument();
    });

    it("labels suggestions distinctly from problems", () => {
      render(<PostCard post={makePost({ type: "suggestion" })} />);
      expect(screen.getByText("Suggestion")).toBeInTheDocument();
    });

    it("labels polls distinctly", () => {
      render(<PostCard post={makePost({ type: "poll" })} />);
      expect(screen.getByText("Poll")).toBeInTheDocument();
    });

    it("tags user-deleted posts", () => {
      render(<PostCard post={makePost({ deleted: true })} />);
      expect(screen.getByText("Deleted by user")).toBeInTheDocument();
    });

    it("shows no deleted tag on live posts", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.queryByText("Deleted by user")).not.toBeInTheDocument();
    });

    it("renders tags", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByText("#elevator")).toBeInTheDocument();
      expect(screen.getByText("#safety")).toBeInTheDocument();
    });

    it("links each hashtag to a tag search", () => {
      render(<PostCard post={makePost()} />);
      expect(
        screen.getByRole("link", { name: "Show all posts tagged elevator" }),
      ).toHaveAttribute("href", "/search?q=%23elevator");
      expect(
        screen.getByRole("link", { name: "Show all posts tagged safety" }),
      ).toHaveAttribute("href", "/search?q=%23safety");
    });

    it("renders a time element", () => {
      render(<PostCard post={makePost()} />);
      // The time display is in a span with text-ink3 class
      const timeEl = document.querySelector(".text-ink3");
      expect(timeEl).toBeInTheDocument();
    });
  });

  describe("reactions", () => {
    // Support-only by design: no Against, no Downvote, anywhere.
    it("renders only the Support button on problems (no Against)", () => {
      render(<PostCard post={makePost({ type: "problem" })} />);
      expect(screen.getByLabelText(/Support/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Against/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Downvote/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Concerned/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Frustrated/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Appreciate/)).not.toBeInTheDocument();
    });

    it("renders only Upvote on suggestions (no Downvote)", () => {
      render(<PostCard post={makePost({ type: "suggestion" })} />);
      expect(screen.getByLabelText(/Upvote/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Downvote/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Against/)).not.toBeInTheDocument();
    });

    it("shows correct reaction counts", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByLabelText(/Support.*5/)).toBeInTheDocument();
    });

    it("marks active reactions with aria-pressed", () => {
      render(<PostCard post={makePost()} myReactions={["support"]} />);
      const supportBtn = screen.getByLabelText(/Support/);
      expect(supportBtn).toHaveAttribute("aria-pressed", "true");
    });

    it("marks inactive reactions with aria-pressed=false", () => {
      render(<PostCard post={makePost()} myReactions={[]} />);
      const supportBtn = screen.getByLabelText(/Support/);
      expect(supportBtn).toHaveAttribute("aria-pressed", "false");
    });

    it("celebrates an activating Support tap with a burst, then cleans up", async () => {
      render(<PostCard post={makePost()} />);
      fireEvent.click(screen.getByLabelText(/Support/));
      expect(screen.getByTestId("support-burst")).toBeInTheDocument();
      await waitFor(
        () => {
          expect(screen.queryByTestId("support-burst")).not.toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it("does not burst when toggling Support off", () => {
      render(<PostCard post={makePost()} myReactions={["support"]} />);
      fireEvent.click(screen.getByLabelText(/Support/));
      expect(screen.queryByTestId("support-burst")).not.toBeInTheDocument();
    });

    it("calls onReacted when reaction is clicked", async () => {
      const onReacted = vi.fn();
      render(<PostCard post={makePost()} onReacted={onReacted} />);
      const supportBtn = screen.getByLabelText(/Support/);
      fireEvent.click(supportBtn);
      // Wait for the async API call
      await vi.waitFor(() => {
        expect(onReacted).toHaveBeenCalled();
      });
    });
  });

  describe("bookmarks", () => {
    it("renders bookmark button", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByLabelText("Bookmark")).toBeInTheDocument();
    });

    it("calls toggleBookmark when clicked", () => {
      render(<PostCard post={makePost()} />);
      const bookmarkBtn = screen.getByLabelText("Bookmark");
      fireEvent.click(bookmarkBtn);
      expect(mockToggleBookmark).toHaveBeenCalledWith("post-1");
    });
  });

  describe("report", () => {
    it("renders report button", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByLabelText("Report this post")).toBeInTheDocument();
    });

    it("opens report dialog on click", () => {
      render(<PostCard post={makePost()} />);
      const reportBtn = screen.getByLabelText("Report this post");
      fireEvent.click(reportBtn);
      expect(screen.getByTestId("report-dialog")).toBeInTheDocument();
    });
  });

  describe("badges", () => {
    it("shows pinned badge when pinned", () => {
      render(<PostCard post={makePost({ pinned: true })} />);
      expect(screen.getByText("Pinned")).toBeInTheDocument();
    });

    it("shows featured badge when featured", () => {
      render(<PostCard post={makePost({ featured: true })} />);
      expect(screen.getByText("Featured")).toBeInTheDocument();
    });

    it("does not show admin moderation controls when not admin", () => {
      render(<PostCard post={makePost({ official: true })} />);
      // Admin section is hidden when hasAdminSession() returns false
      expect(screen.queryByText("Moderation")).not.toBeInTheDocument();
    });

    it("shows private badge when visibility is private", () => {
      render(<PostCard post={makePost({ visibility: "private" })} />);
      expect(screen.getByText(/Private/)).toBeInTheDocument();
    });
  });

  describe("poll integration", () => {
    it("renders linked poll when pollData is provided", () => {
      render(
        <PostCard
          post={makePost({ linked_poll: "poll-1", linked_poll_votes: 12 })}
          pollData={{
            id: "poll-1",
            title: "Should we fix it?",
            options: ["Yes", "No"],
            vote_counts: [10, 2],
            total_votes: 12,
            ptype: "yesno",
            author_id: "user-1",
          }}
        />,
      );
      expect(screen.getByText("Should we fix it?")).toBeInTheDocument();
    });

    it("badge follows the live poll total over the feed snapshot", () => {
      render(
        <PostCard
          post={makePost({ linked_poll: "poll-1", linked_poll_votes: 0 })}
          pollData={{
            id: "poll-1",
            title: "Should we fix it?",
            options: ["Yes", "No"],
            vote_counts: [4, 3],
            total_votes: 7,
            ptype: "yesno",
            author_id: "user-1",
          }}
        />,
      );
      // The feed snapshot says 0; the live poll says 7. The badge must agree
      // with the PollCard rendered directly below it.
      expect(screen.getByRole("status", { name: "Poll with 7 votes" })).toBeInTheDocument();
    });

    it("badge falls back to the feed snapshot before the poll loads", () => {
      render(
        <PostCard post={makePost({ linked_poll: "poll-1", linked_poll_votes: 3 })} />,
      );
      expect(screen.getByRole("status", { name: "Poll with 3 votes" })).toBeInTheDocument();
    });

    it("singularises the badge for a single vote", () => {
      render(
        <PostCard
          post={makePost({ linked_poll: "poll-1", linked_poll_votes: 0 })}
          pollData={{
            id: "poll-1",
            title: "Should we fix it?",
            options: ["Yes", "No"],
            vote_counts: [1, 0],
            total_votes: 1,
            ptype: "yesno",
            author_id: "user-1",
          }}
        />,
      );
      expect(screen.getByRole("status", { name: "Poll with 1 vote" })).toBeInTheDocument();
    });
  });

  describe("comment count", () => {
    it("shows comment count", () => {
      render(<PostCard post={makePost({ comment_count: 7 })} />);
      // The comment link shows the count
      expect(screen.getByText("7")).toBeInTheDocument();
    });
  });

  describe("overlap hardening", () => {
    // Long unbroken user strings must wrap inside the card instead of
    // painting over neighbouring rows (audit: reaction-row text overlapping
    // the category header on real prod titles).
    it("breaks long unbroken title and description tokens", () => {
      const { container } = render(
        <PostCard
          post={makePost({
            title: "x".repeat(200),
            description: "y".repeat(300),
          })}
        />,
      );
      const h3 = container.querySelector("h3");
      expect(h3?.className).toMatch(/break-words/);
      const desc = container.querySelector("h3 + p");
      expect(desc?.className).toMatch(/break-words/);
    });

    // The Deleted-by-user chip must be a sibling of the status chip, never
    // a bordered chip nested inside another bordered chip.
    it("renders the deleted chip beside, not inside, the status chip", () => {
      const { container } = render(
        <PostCard post={makePost({ deleted: true })} />,
      );
      expect(screen.getByText("Deleted by user")).toBeInTheDocument();
      expect(container.querySelector(".chip .chip")).toBeNull();
    });
  });
});
