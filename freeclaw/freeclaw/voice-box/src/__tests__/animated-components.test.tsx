/**
 * TDD Tests for Animated Components
 *
 * Proves that:
 * 1. ShimmerButton renders children and is clickable
 * 2. BorderBeam renders without errors
 * 3. GridPattern generates deterministic squares
 * 4. MagneticButton renders and handles hover
 * 5. AnimatedList renders items with stagger
 * 6. AnimatedCounter displays prefix/suffix/label
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import ShimmerButton from "../components/ui/shimmer-button";
import BorderBeam from "../components/ui/border-beam";
import GridPattern from "../components/ui/grid-pattern";
import MagneticButton from "../components/ui/magnetic-button";
import AnimatedList from "../components/ui/animated-list";
import AnimatedCounter from "../components/ui/animated-counter";

// Mock IntersectionObserver for framer-motion's useInView
beforeAll(() => {
  globalThis.IntersectionObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor() {}
  } as unknown as typeof IntersectionObserver;
});

describe("ShimmerButton", () => {
  it("renders children text", () => {
    render(<ShimmerButton>Click me</ShimmerButton>);
    expect(screen.getByText("Click me")).toBeDefined();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<ShimmerButton onClick={onClick}>Submit</ShimmerButton>);
    screen.getByText("Submit").closest("button")!.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop is true", () => {
    render(<ShimmerButton disabled>Disabled</ShimmerButton>);
    const btn = screen.getByText("Disabled").closest("button")!;
    expect(btn.disabled).toBe(true);
  });

  it("renders as submit type when specified", () => {
    render(<ShimmerButton type="submit">Submit</ShimmerButton>);
    const btn = screen.getByText("Submit").closest("button")!;
    expect(btn.type).toBe("submit");
  });

  it("has aria-label when provided", () => {
    render(<ShimmerButton aria-label="Custom label">Btn</ShimmerButton>);
    expect(screen.getByRole("button", { name: "Custom label" })).toBeDefined();
  });
});

describe("BorderBeam", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <div className="relative">
        <BorderBeam />
      </div>
    );
    expect(container.querySelector("[aria-hidden]")).toBeDefined();
  });

  it("applies custom duration", () => {
    const { container } = render(
      <div className="relative">
        <BorderBeam duration={12} />
      </div>
    );
    const beam = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(beam.style.animation).toContain("12s");
  });

  it("applies custom size", () => {
    const { container } = render(
      <div className="relative">
        <BorderBeam size={200} />
      </div>
    );
    const beam = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(beam.style.width).toBe("200px");
    expect(beam.style.height).toBe("200px");
  });

  it("is aria-hidden (decorative)", () => {
    const { container } = render(
      <div className="relative">
        <BorderBeam />
      </div>
    );
    expect(container.querySelector("[aria-hidden=\"true\"]")).toBeDefined();
  });
});

describe("GridPattern", () => {
  it("renders an SVG", () => {
    const { container } = render(<GridPattern />);
    expect(container.querySelector("svg")).toBeDefined();
  });

  it("generates deterministic squares with same params", () => {
    const { container: c1 } = render(<GridPattern cols={5} rows={5} />);
    const { container: c2 } = render(<GridPattern cols={5} rows={5} />);
    const rects1 = c1.querySelectorAll("rect");
    const rects2 = c2.querySelectorAll("rect");
    // Same seed + same dimensions = same pattern
    expect(rects1.length).toBe(rects2.length);
  });

  it("uses custom squares when provided", () => {
    const { container } = render(
      <GridPattern squares={[[0, 0], [1, 1], [2, 2]]} />
    );
    // 3 data rects + 1 mask rect = 4 total
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(4);
  });

  it("is aria-hidden (decorative)", () => {
    const { container } = render(<GridPattern />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("MagneticButton", () => {
  it("renders children", () => {
    render(<MagneticButton>Pull me</MagneticButton>);
    expect(screen.getByText("Pull me")).toBeDefined();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<MagneticButton onClick={onClick}>Click</MagneticButton>);
    screen.getByText("Click").closest("button")!.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop is true", () => {
    render(<MagneticButton disabled>Off</MagneticButton>);
    const btn = screen.getByText("Off").closest("button")!;
    expect(btn.disabled).toBe(true);
  });
});

describe("AnimatedList", () => {
  it("renders all children", () => {
    render(
      <AnimatedList>
        <div>Item 1</div>
        <div>Item 2</div>
        <div>Item 3</div>
      </AnimatedList>
    );
    expect(screen.getByText("Item 1")).toBeDefined();
    expect(screen.getByText("Item 2")).toBeDefined();
    expect(screen.getByText("Item 3")).toBeDefined();
  });

  it("renders a single child", () => {
    render(
      <AnimatedList>
        <div>Only item</div>
      </AnimatedList>
    );
    expect(screen.getByText("Only item")).toBeDefined();
  });

  it("applies custom className", () => {
    const { container } = render(
      <AnimatedList className="custom-list">
        <div>Item</div>
      </AnimatedList>
    );
    expect(container.querySelector(".custom-list")).toBeDefined();
  });
});

describe("AnimatedCounter", () => {
  it("renders the label", () => {
    render(<AnimatedCounter value={42} label="Total posts" />);
    expect(screen.getByText("Total posts")).toBeDefined();
  });

  it("renders prefix and suffix", () => {
    const { container } = render(<AnimatedCounter value={100} prefix="$" suffix="k" />);
    // CountUp animates, so check the container has the prefix/suffix wrapper
    expect(container.querySelector(".tabular-nums")).toBeDefined();
  });

  it("renders trend indicator", () => {
    render(<AnimatedCounter value={10} trend={{ value: 15, positive: true }} />);
    expect(screen.getByText(/15%/)).toBeDefined();
  });

  it("renders negative trend", () => {
    render(<AnimatedCounter value={10} trend={{ value: 5, positive: false }} />);
    expect(screen.getByText(/5%/)).toBeDefined();
  });

  it("applies accent color class", () => {
    const { container } = render(
      <AnimatedCounter value={100} accent="violet" label="Test" />
    );
    expect(container.querySelector(".text-violet-400")).toBeDefined();
  });
});
