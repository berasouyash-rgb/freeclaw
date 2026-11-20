import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import BackToTop from "../components/BackToTop";

// Mock haptics
vi.mock("../lib/haptics", () => ({
	triggerHaptic: vi.fn(),
}));

describe("BackToTop", () => {
	beforeEach(() => {
		window.scrollTo = vi.fn();
		Object.defineProperty(window, "scrollY", { value: 0, writable: true });
		Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, writable: true });
		Object.defineProperty(window, "innerHeight", { value: 1000, writable: true });
	});

	it("does not render when window.scrollY <= 350", () => {
		const { container } = render(<BackToTop />);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders when window.scrollY > 350 and calculates progress", () => {
		render(<BackToTop />);

		act(() => {
			window.scrollY = 500;
			window.dispatchEvent(new Event("scroll"));
		});

		const btn = screen.getByRole("button", { name: /scroll back to top/i });
		expect(btn).toBeInTheDocument();
		expect(btn.getAttribute("aria-label")).toContain("50%");
	});

	it("scrolls to top smoothly on click", () => {
		render(<BackToTop />);

		act(() => {
			window.scrollY = 600;
			window.dispatchEvent(new Event("scroll"));
		});

		const btn = screen.getByRole("button", { name: /scroll back to top/i });
		fireEvent.click(btn);

		expect(window.scrollTo).toHaveBeenCalledWith({
			top: 0,
			behavior: "smooth",
		});
	});

	it("scrolls to top when pressing 't' key", () => {
		render(<BackToTop />);

		act(() => {
			window.scrollY = 600;
			window.dispatchEvent(new Event("scroll"));
		});

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }));
		});

		expect(window.scrollTo).toHaveBeenCalledWith({
			top: 0,
			behavior: "smooth",
		});
	});

	it("ignores 't' key when typing in an input element", () => {
		render(<BackToTop />);

		act(() => {
			window.scrollY = 600;
			window.dispatchEvent(new Event("scroll"));
		});

		const input = document.createElement("input");
		document.body.appendChild(input);

		act(() => {
			const event = new KeyboardEvent("keydown", { key: "t" });
			Object.defineProperty(event, "target", { value: input });
			window.dispatchEvent(event);
		});

		expect(window.scrollTo).not.toHaveBeenCalled();
		document.body.removeChild(input);
	});
});
