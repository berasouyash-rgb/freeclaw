// ═══════════════════════════════════════════════════════════════════
// onboarding-tutorial — first-run overlay contract
// ═══════════════════════════════════════════════════════════════════
// Locks: Tutorial (first-visit open, vb:tutorialDone persistence,
// /admin suppression, 4-step flow, Skip/X/backdrop finish, step
// indicators, Tab focus trap, resetTutorial re-trigger), Onboarding
// (vb:onboarded gate, 3-step flow, progress bar, Skip/X/backdrop
// finish, focus trap).
// ═══════════════════════════════════════════════════════════════════

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Onboarding from "../components/Onboarding";
import Tutorial, { resetTutorial } from "../components/Tutorial";

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	window.history.pushState({}, "", "/");
});

// ─── Tutorial ───────────────────────────────────────────────────────

describe("Tutorial", () => {
	it("opens on first visit and shows the first step", () => {
		render(<Tutorial />);
		const dialog = screen.getByRole("dialog", { name: "Welcome tutorial" });
		expect(dialog).toBeInTheDocument();
		expect(screen.getByText("You are 100% anonymous")).toBeInTheDocument();
		expect(
			screen.getByText(/No names, emails, or tracking/),
		).toBeInTheDocument();
	});

	it("stays hidden when already completed", () => {
		localStorage.setItem("vb:tutorialDone", JSON.stringify(true));
		render(<Tutorial />);
		expect(
			screen.queryByRole("dialog", { name: "Welcome tutorial" }),
		).not.toBeInTheDocument();
	});

	it("never opens on /admin routes", () => {
		window.history.pushState({}, "", "/admin");
		render(<Tutorial />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("walks through all four steps and completes", async () => {
		const user = userEvent.setup();
		render(<Tutorial />);
		for (const title of [
			"Report problems & share ideas",
			"Vote in polls",
			"Watch things get solved",
		]) {
			await user.click(screen.getByRole("button", { name: /Next/ }));
			expect(screen.getByText(title)).toBeInTheDocument();
		}
		await user.click(
			screen.getByRole("button", { name: /Start using Voice Flow/ }),
		);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:tutorialDone")).toBe("true");
	});

	it("closes and remembers via the Skip button", async () => {
		const user = userEvent.setup();
		render(<Tutorial />);
		await user.click(screen.getByRole("button", { name: "Skip" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:tutorialDone")).toBe("true");
	});

	it("closes via the X close button", async () => {
		const user = userEvent.setup();
		render(<Tutorial />);
		await user.click(screen.getByRole("button", { name: "Skip tutorial" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:tutorialDone")).toBe("true");
	});

	it("closes and persists when the backdrop is clicked", async () => {
		const user = userEvent.setup();
		render(<Tutorial />);
		const dialog = screen.getByRole("dialog", { name: "Welcome tutorial" });
		await user.click(dialog.querySelector(".absolute.inset-0") as Element);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:tutorialDone")).toBe("true");
	});

	it("renders four step indicators with the active one widened", () => {
		render(<Tutorial />);
		const dialog = screen.getByRole("dialog", { name: "Welcome tutorial" });
		const dots = dialog.querySelectorAll("div[aria-hidden] > span");
		expect(dots).toHaveLength(4);
		expect(dots[0]).toHaveStyle({ width: "20px" });
		expect(dots[1]).toHaveStyle({ width: "6px" });
	});

	it("traps focus: Tab wraps from the last control to the first", () => {
		render(<Tutorial />);
		screen.getByRole("button", { name: /Next/ }).focus();
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Skip tutorial" }),
		);
	});

	it("traps focus: Shift+Tab wraps from the first control to the last", () => {
		render(<Tutorial />);
		screen.getByRole("button", { name: "Skip tutorial" }).focus();
		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Tab",
				shiftKey: true,
				bubbles: true,
			}),
		);
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: /Next/ }),
		);
	});

	it("resetTutorial re-opens a completed tutorial at step zero", async () => {
		localStorage.setItem("vb:tutorialDone", JSON.stringify(true));
		render(<Tutorial />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

		await act(async () => {
			resetTutorial();
		});

		await waitFor(() =>
			expect(
				screen.getByRole("dialog", { name: "Welcome tutorial" }),
			).toBeInTheDocument(),
		);
		expect(screen.getByText("You are 100% anonymous")).toBeInTheDocument();
		expect(localStorage.getItem("vb:tutorialDone")).toBe("false");
	});
});

// ─── Onboarding ─────────────────────────────────────────────────────

describe("Onboarding", () => {
	it("opens for first-time visitors and shows the first step", () => {
		render(<Onboarding />);
		const dialog = screen.getByRole("dialog", { name: "Welcome tour" });
		expect(dialog).toBeInTheDocument();
		expect(screen.getByText("Your voice, fully anonymous")).toBeInTheDocument();
	});

	it("stays hidden after onboarding is dismissed", () => {
		localStorage.setItem("vb:onboarded", JSON.stringify(true));
		render(<Onboarding />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("advances through the three steps and completes", async () => {
		const user = userEvent.setup();
		render(<Onboarding />);
		for (const title of [
			"Nothing traces back to you",
			"Watch things actually get fixed",
		]) {
			await user.click(screen.getByRole("button", { name: /Next/ }));
			expect(screen.getByText(title)).toBeInTheDocument();
		}
		await user.click(screen.getByRole("button", { name: /Start speaking up/ }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:onboarded")).toBe("true");
	});

	it("skips from the footer Skip button", async () => {
		const user = userEvent.setup();
		render(<Onboarding />);
		await user.click(screen.getByRole("button", { name: "Skip" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:onboarded")).toBe("true");
	});

	it("closes via the X close button and remembers", async () => {
		const user = userEvent.setup();
		render(<Onboarding />);
		await user.click(screen.getByRole("button", { name: "Skip tour" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:onboarded")).toBe("true");
	});

	it("closes when the backdrop is clicked", async () => {
		const user = userEvent.setup();
		render(<Onboarding />);
		const dialog = screen.getByRole("dialog", { name: "Welcome tour" });
		await user.click(dialog.querySelector(".absolute.inset-0") as Element);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(localStorage.getItem("vb:onboarded")).toBe("true");
	});

	it("renders a three-segment progress bar that fills as you advance", async () => {
		const user = userEvent.setup();
		render(<Onboarding />);
		const dialog = screen.getByRole("dialog", { name: "Welcome tour" });
		const bar = dialog.querySelector(".absolute.top-0");
		expect(bar).not.toBeNull();
		const segments = bar!.querySelectorAll("div");
		expect(segments).toHaveLength(3);
		expect(segments[0]).toHaveStyle({ background: "var(--vb-accent)" });
		expect(segments[1]).toHaveStyle({ background: "var(--vb-surface2)" });
		await user.click(screen.getByRole("button", { name: /Next/ }));
		expect(segments[1]).toHaveStyle({ background: "var(--vb-accent)" });
	});

	it("traps focus: Shift+Tab wraps from the first control to the last", () => {
		render(<Onboarding />);
		screen.getByRole("button", { name: "Skip tour" }).focus();
		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Tab",
				shiftKey: true,
				bubbles: true,
			}),
		);
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: /Next/ }),
		);
	});
});
