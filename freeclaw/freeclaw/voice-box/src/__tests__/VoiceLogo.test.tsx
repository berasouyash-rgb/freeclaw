// ═══════════════════════════════════════════════════════════════════
// VoiceLogo — brand mark contract.
// ═══════════════════════════════════════════════════════════════════
// Pins: labelled vs decorative a11y, rendered size, three sound arcs,
// static mode (no animation class), unique gradient ids per instance.
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import VoiceLogo from "../components/VoiceLogo";

describe("VoiceLogo", () => {
  it("renders labelled with size and three sound arcs", () => {
    const { container } = render(<VoiceLogo size={48} label="Voice Flow" />);
    const svg = screen.getByRole("img", { name: "Voice Flow" });
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute("width")).toBe("48");
    expect(svg.getAttribute("height")).toBe("48");
    expect(container.querySelectorAll(".vb-logo-arcs path")).toHaveLength(3);
  });

  it("is aria-hidden without a label (decorative brand use)", () => {
    const { container } = render(<VoiceLogo size={36} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector("[role]")).toBeNull();
  });

  it("defaults to animated, with a static mode for reduced motion", () => {
    const { container, rerender } = render(<VoiceLogo size={36} />);
    expect(container.querySelector("svg")?.className.baseVal).toMatch(
      /vb-logo-anim/,
    );
    rerender(<VoiceLogo size={36} animated={false} />);
    expect(container.querySelector("svg")?.className.baseVal).toMatch(
      /vb-logo-static/,
    );
  });

  it("uses unique gradient ids per instance", () => {
    const { container } = render(
      <>
        <VoiceLogo size={36} />
        <VoiceLogo size={36} />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) =>
      g.getAttribute("id"),
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
