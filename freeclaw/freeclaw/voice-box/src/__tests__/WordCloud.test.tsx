/**
 * TDD Tests for WordCloud Component
 *
 * Proves that:
 * 1. Extracts words from post titles and descriptions
 * 2. Filters out stop words (the, and, for, etc.)
 * 3. Filters words shorter than 4 characters
 * 4. Counts word frequency correctly
 * 5. Shows only words appearing 2+ times
 * 6. Renders up to 28 words
 * 7. Shows empty state when not enough data
 * 8. Clicking a word calls onWordClick
 * 9. Clicking again deselects
 * 10. Has accessible role and label
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WordCloud from "../components/WordCloud";
import type { PostData } from "../types";

function makePosts(words: string[]): PostData[] {
  return words.map((w, i) => ({
    id: `post-${i}`,
    title: w,
    description: "",
    category: "General",
    status: "reported",
    created_at: "2025-07-20T10:00:00Z",
    reactions: {},
    comment_count: 0,
  })) as PostData[];
}

describe("WordCloud", () => {
  describe("empty state", () => {
    it("shows empty message when no posts", () => {
      render(<WordCloud posts={[]} />);
      expect(screen.getByText(/Not enough posts/)).toBeInTheDocument();
    });

    it("shows empty message when all words are stop words", () => {
      const posts = makePosts([
        "the and for this that",
        "the and for this that",
      ]);
      render(<WordCloud posts={posts} />);
      expect(screen.getByText(/Not enough posts/)).toBeInTheDocument();
    });

    it("shows empty message when words appear only once", () => {
      const posts = makePosts([
        "elevator broken hallway",
        "paint peeling wall",
      ]);
      render(<WordCloud posts={posts} />);
      expect(screen.getByText(/Not enough posts/)).toBeInTheDocument();
    });
  });

  describe("word extraction", () => {
    it("extracts meaningful words from posts", () => {
      const posts = makePosts([
        "elevator broken building safety",
        "elevator stuck again safety",
      ]);
      render(<WordCloud posts={posts} />);
      expect(screen.getByText("elevator")).toBeInTheDocument();
      expect(screen.getByText("safety")).toBeInTheDocument();
    });

    it("filters out stop words", () => {
      const posts = makePosts([
        "the elevator is broken and stuck",
        "the elevator is broken and stuck",
      ]);
      render(<WordCloud posts={posts} />);
      expect(screen.queryByText("the")).not.toBeInTheDocument();
      expect(screen.queryByText("and")).not.toBeInTheDocument();
      expect(screen.queryByText("is")).not.toBeInTheDocument();
    });

    it("filters words shorter than 4 characters", () => {
      const posts = makePosts([
        "hi ok no go do it be",
        "hi ok no go do it be",
      ]);
      render(<WordCloud posts={posts} />);
      expect(screen.queryByText("hi")).not.toBeInTheDocument();
      expect(screen.queryByText("ok")).not.toBeInTheDocument();
    });

    it("includes words from tags", () => {
      const posts = [
        {
          id: "p1",
          title: "Report issue",
          description: "",
          category: "General",
          status: "reported",
          created_at: "2025-07-20T10:00:00Z",
          reactions: {},
          comment_count: 0,
          tags: ["elevator", "elevator"],
        },
        {
          id: "p2",
          title: "Another issue",
          description: "",
          category: "General",
          status: "reported",
          created_at: "2025-07-20T10:00:00Z",
          reactions: {},
          comment_count: 0,
          tags: ["elevator"],
        },
      ] as PostData[];
      render(<WordCloud posts={posts} />);
      expect(screen.getByText("elevator")).toBeInTheDocument();
    });
  });

  describe("frequency and ranking", () => {
    it("shows only words appearing 2+ times", () => {
      const posts = makePosts([
        "elevator broken elevator stuck elevator",
        "elevator again broken",
      ]);
      render(<WordCloud posts={posts} />);
      // "elevator" appears 4 times, "broken" appears 2 times
      expect(screen.getByText("elevator")).toBeInTheDocument();
      expect(screen.getByText("broken")).toBeInTheDocument();
      // "stuck" appears once — should not show
      expect(screen.queryByText("stuck")).not.toBeInTheDocument();
    });

    it("limits to 28 words", () => {
      // Create posts with many unique words that each appear 2+ times
      const words = Array.from({ length: 30 }, (_, i) => `word${i}a`);
      const posts = makePosts([
        words.join(" "),
        words.join(" "),
      ]);
      render(<WordCloud posts={posts} />);
      const buttons = screen.getAllByRole("listitem");
      expect(buttons.length).toBeLessThanOrEqual(28);
    });
  });

  describe("interaction", () => {
    it("calls onWordClick when a word is clicked", () => {
      const onWordClick = vi.fn();
      const posts = makePosts([
        "elevator broken elevator stuck",
        "elevator again broken",
      ]);
      render(<WordCloud posts={posts} onWordClick={onWordClick} />);
      fireEvent.click(screen.getByText("elevator"));
      expect(onWordClick).toHaveBeenCalledWith("elevator");
    });

    it("deselects word on second click", () => {
      const onWordClick = vi.fn();
      const posts = makePosts([
        "elevator broken elevator stuck",
        "elevator again broken",
      ]);
      render(<WordCloud posts={posts} onWordClick={onWordClick} />);
      fireEvent.click(screen.getByText("elevator"));
      fireEvent.click(screen.getByText("elevator"));
      expect(onWordClick).toHaveBeenCalledWith(""); // empty string = deselect
    });

    it("clicking different word switches selection", () => {
      const onWordClick = vi.fn();
      const posts = makePosts([
        "elevator broken elevator stuck",
        "elevator again broken",
      ]);
      render(<WordCloud posts={posts} onWordClick={onWordClick} />);
      fireEvent.click(screen.getByText("elevator"));
      fireEvent.click(screen.getByText("broken"));
      expect(onWordClick).toHaveBeenLastCalledWith("broken");
    });
  });

  describe("accessibility", () => {
    it("has role=list with aria-label", () => {
      const posts = makePosts([
        "elevator broken elevator stuck",
        "elevator again broken",
      ]);
      render(<WordCloud posts={posts} />);
      expect(screen.getByRole("list", { name: "Common themes" })).toBeInTheDocument();
    });

    it("each word has role=listitem", () => {
      const posts = makePosts([
        "elevator broken elevator stuck",
        "elevator again broken",
      ]);
      render(<WordCloud posts={posts} />);
      const items = screen.getAllByRole("listitem");
      expect(items.length).toBeGreaterThan(0);
    });

    it("word has descriptive title attribute", () => {
      const posts = makePosts([
        "elevator broken elevator stuck",
        "elevator again broken",
      ]);
      render(<WordCloud posts={posts} />);
      const word = screen.getByText("elevator");
      expect(word).toHaveAttribute("title", expect.stringContaining("elevator"));
    });
  });
});
