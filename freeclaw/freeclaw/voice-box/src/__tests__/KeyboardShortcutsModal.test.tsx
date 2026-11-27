import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import KeyboardShortcutsModal from "../components/KeyboardShortcutsModal";

describe("KeyboardShortcutsModal", () => {
	it("renders shortcuts when open", () => {
		const onClose = vi.fn();
		render(<KeyboardShortcutsModal open={true} onClose={onClose} />);

		expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		expect(screen.getByText("Open Command Palette")).toBeInTheDocument();
		expect(screen.getByText("Next post in feed")).toBeInTheDocument();
		expect(screen.getByText("Support / Upvote post")).toBeInTheDocument();
	});

	it("does not render when closed", () => {
		const onClose = vi.fn();
		const { container } = render(
			<KeyboardShortcutsModal open={false} onClose={onClose} />
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("calls onClose on Escape key press", () => {
		const onClose = vi.fn();
		render(<KeyboardShortcutsModal open={true} onClose={onClose} />);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when clicking close button", () => {
		const onClose = vi.fn();
		render(<KeyboardShortcutsModal open={true} onClose={onClose} />);

		const closeBtn = screen.getByLabelText("Close keyboard shortcuts");
		fireEvent.click(closeBtn);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
