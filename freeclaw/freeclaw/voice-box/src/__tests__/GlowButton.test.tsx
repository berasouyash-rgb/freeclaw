// ═══════════════════════════════════════════════════════════════════
// GlowButton — animated glowing border + glassmorphism button contract
// ═══════════════════════════════════════════════════════════════════
//   1. Renders children with the button role and accessible name
//   2. onClick fires on click; type passthrough honored
//   3. disabled and busy states: button disabled, busy shows spinner
//   4. Variant/size/className/animate/pulse/icon props respected
//   5. aria-label overrides the accessible name
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sparkles } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import GlowButton from "../components/GlowButton";

describe("GlowButton", () => {
	it("renders children with the button role", () => {
		render(<GlowButton>Send</GlowButton>);
		expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
	});

	it("fires onClick when clicked", async () => {
		const user = userEvent.setup();
		const onClick = vi.fn();
		render(<GlowButton onClick={onClick}>Go</GlowButton>);
		await user.click(screen.getByRole("button", { name: "Go" }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("honors the type prop (submit)", () => {
		render(<GlowButton type="submit">Save</GlowButton>);
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).type,
		).toBe("submit");
	});

	it("renders the icon when provided", () => {
		render(
			<GlowButton icon={<Sparkles data-testid="glow-icon" />}>
				Shine
			</GlowButton>,
		);
		expect(screen.getByTestId("glow-icon")).toBeTruthy();
	});

	it("disables the button via the disabled prop", () => {
		render(<GlowButton disabled>Locked</GlowButton>);
		expect(
			(screen.getByRole("button", { name: "Locked" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("shows a spinner and disables while busy", () => {
		render(<GlowButton busy>Working</GlowButton>);
		const btn = screen.getByRole("button", {
			name: "Working",
		}) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		// Loader2 has role="status" and aria-hidden on the SVG; assert via class
		expect(btn.querySelector(".animate-spin")).toBeTruthy();
	});

	it("uses the larger spinner size for the lg busy state", () => {
		render(
			<GlowButton busy size="lg">
				Big busy
			</GlowButton>,
		);
		const btn = screen.getByRole("button", {
			name: "Big busy",
		}) as HTMLButtonElement;
		const spin = btn.querySelector(".animate-spin");
		expect(spin).toBeTruthy();
		expect(spin?.getAttribute("width")).toBe("18");
	});

	it("applies variant, size, and extra className", () => {
		const { container } = render(
			<GlowButton variant="cyan" size="lg" className="extra-class">
				Big
			</GlowButton>,
		);
		const btn = container.querySelector("button");
		expect(btn?.className).toContain("px-8 py-4");
		expect(btn?.className).toContain("extra-class");
	});

	it("freezes the border animation when animate=false", () => {
		const { container } = render(
			<GlowButton animate={false}>Still</GlowButton>,
		);
		const style = container.querySelector("style");
		expect(style?.textContent).toContain("animation: none");
	});

	it("omits the pulse keyframe usage when pulse=false", () => {
		const { container } = render(<GlowButton pulse={false}>Quiet</GlowButton>);
		const style = container.querySelector("style");
		expect(style?.textContent).toContain("glow-btn-pulse");
		// When pulse is false the .glow-btn has no animation declaration
		expect(style?.textContent).not.toMatch(/animation: glow-btn-pulse/);
	});

	it("defaults to the violet variant and inline animation styles", () => {
		const { container } = render(<GlowButton>Default</GlowButton>);
		const style = container.querySelector("style");
		expect(style?.textContent).toContain("--glow-a:#8b5cf6");
		expect(style?.textContent).toContain("glow-btn-rotate 3s linear infinite");
	});

	it("uses aria-label as the accessible name", () => {
		render(<GlowButton aria-label="Send message">Unnamed</GlowButton>);
		expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
	});
});
