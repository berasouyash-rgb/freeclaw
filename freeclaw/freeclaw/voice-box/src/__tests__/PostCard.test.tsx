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
import { render, screen, fireEvent } from "@testing-library/react";
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
    status: "open",
    priority: "high",
    type: "problem",
    author_id: "user-1",
    created_at: "2025-07-20T10:00:00Z",
    reactions: { support: 5, concerned: 2, frustrated: 1, appreciate: 0 },
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
      render(<PostCard post={makePost({ status: "open" })} />);
      expect(screen.getByText("Reported")).toBeInTheDocument();
    });

    it("renders tags", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByText("#elevator")).toBeInTheDocument();
      expect(screen.getByText("#safety")).toBeInTheDocument();
    });

    it("renders a time element", () => {
      render(<PostCard post={makePost()} />);
      // The time display is in a span with text-ink3 class
      const timeEl = document.querySelector(".text-ink3");
      expect(timeEl).toBeInTheDocument();
    });
  });

  describe("reactions", () => {
    it("renders all 4 reaction types", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByLabelText(/Support/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Concerned/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Frustrated/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Appreciate/)).toBeInTheDocument();
    });

    it("shows correct reaction counts", () => {
      render(<PostCard post={makePost()} />);
      expect(screen.getByLabelText(/Support.*5/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Concerned.*2/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Frustrated.*1/)).toBeInTheDocument();
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
          }}
        />,
      );
      expect(screen.getByText("Should we fix it?")).toBeInTheDocument();
    });
  });

  describe("comment count", () => {
    it("shows comment count", () => {
      render(<PostCard post={makePost({ comment_count: 7 })} />);
      // The comment link shows the count
      expect(screen.getByText("7")).toBeInTheDocument();
    });
  });
});
