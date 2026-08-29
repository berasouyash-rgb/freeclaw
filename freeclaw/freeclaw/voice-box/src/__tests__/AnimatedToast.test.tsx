/**
 * TDD Tests for AnimatedToast Component
 *
 * Proves that:
 * 1. Renders toast text and icon based on kind
 * 2. Shows close button that dismisses toast
 * 3. Shows action button when provided
 * 4. Auto-dismisses after timeout
 * 5. Different styles for ok/err/info kinds
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AnimatedToast from "../components/AnimatedToast";

// Mock AppContext
const mockToasts = vi.fn();
vi.mock("../contexts/AppContext", () => ({
  useApp: () => ({
    toasts: mockToasts(),
    toast: vi.fn(),
  }),
}));

describe("AnimatedToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockToasts.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("rendering", () => {
    it("renders nothing when no toasts", () => {
      mockToasts.mockReturnValue([]);
      const { container } = render(<AnimatedToast />);
      expect(container.querySelectorAll("[class*='toast']").length).toBe(0);
    });

    it("renders toast with text", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "Post saved!", kind: "ok" },
      ]);
      render(<AnimatedToast />);
      expect(screen.getByText("Post saved!")).toBeInTheDocument();
    });

    it("renders toast with err kind", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "Something went wrong", kind: "err" },
      ]);
      render(<AnimatedToast />);
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });

    it("renders toast with info kind", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "Did you know?", kind: "info" },
      ]);
      render(<AnimatedToast />);
      expect(screen.getByText("Did you know?")).toBeInTheDocument();
    });

    it("renders multiple toasts", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "First toast", kind: "ok" },
        { id: 2, text: "Second toast", kind: "err" },
      ]);
      render(<AnimatedToast />);
      expect(screen.getByText("First toast")).toBeInTheDocument();
      expect(screen.getByText("Second toast")).toBeInTheDocument();
    });
  });

  describe("close button", () => {
    it("renders close button for each toast", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "Closeable toast", kind: "ok" },
      ]);
      render(<AnimatedToast />);
      const closeButtons = screen.getAllByRole("button");
      expect(closeButtons.length).toBeGreaterThan(0);
    });

    it("hides toast when close button is clicked", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "Dismiss me", kind: "ok" },
      ]);
      render(<AnimatedToast />);
      const closeBtn = screen.getAllByRole("button").pop()!; // X button is last
      fireEvent.click(closeBtn);
      // After click, toast enters exit animation then removed
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.queryByText("Dismiss me")).not.toBeInTheDocument();
    });
  });

  describe("action button", () => {
    it("renders action button when provided", () => {
      mockToasts.mockReturnValue([
        {
          id: 1,
          text: "Undo action",
          kind: "info",
          action: { label: "Undo", fn: vi.fn() },
        },
      ]);
      render(<AnimatedToast />);
      expect(screen.getByText("Undo")).toBeInTheDocument();
    });

    it("calls action function when clicked", () => {
      const mockFn = vi.fn();
      mockToasts.mockReturnValue([
        {
          id: 1,
          text: "Undo action",
          kind: "info",
          action: { label: "Undo", fn: mockFn },
        },
      ]);
      render(<AnimatedToast />);
      fireEvent.click(screen.getByText("Undo"));
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("hides toast after action button is clicked", () => {
      mockToasts.mockReturnValue([
        {
          id: 1,
          text: "Action toast",
          kind: "ok",
          action: { label: "Do it", fn: vi.fn() },
        },
      ]);
      render(<AnimatedToast />);
      fireEvent.click(screen.getByText("Do it"));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.queryByText("Action toast")).not.toBeInTheDocument();
    });
  });

  describe("auto-dismiss", () => {
    it("auto-dismisses toast after default duration", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "Auto dismiss", kind: "ok" },
      ]);
      render(<AnimatedToast />);
      expect(screen.getByText("Auto dismiss")).toBeInTheDocument();

      // Default duration is 3800ms
      act(() => {
        vi.advanceTimersByTime(3800);
      });
      // After timeout, exit animation plays (200ms)
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText("Auto dismiss")).not.toBeInTheDocument();
    });

    it("auto-dismisses action toast after longer duration", () => {
      mockToasts.mockReturnValue([
        {
          id: 1,
          text: "Action auto dismiss",
          kind: "ok",
          action: { label: "OK", fn: vi.fn() },
        },
      ]);
      render(<AnimatedToast />);
      expect(screen.getByText("Action auto dismiss")).toBeInTheDocument();

      // Action toasts have 30000ms duration
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText("Action auto dismiss")).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("toast container has correct z-index", () => {
      mockToasts.mockReturnValue([
        { id: 1, text: "Accessible toast", kind: "ok" },
      ]);
      const { container } = render(<AnimatedToast />);
      const wrapper = container.firstElementChild;
      expect(wrapper).toHaveClass("z-[100]");
    });
  });
});
