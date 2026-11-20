// ═══════════════════════════════════════════════════════════════════
// Interaction polish — dialogs, confirm recovery, tabs
// ═══════════════════════════════════════════════════════════════════
// Locks the behaviours the "200 micro-interactions" pass added:
//   1. Dialogs trap Tab and return focus to whatever opened them.
//   2. A dialog never steals focus from an autoFocus primary control.
//   3. A failed confirmation stays open, explains the failure and offers
//      "Try again" instead of swallowing the rejection.
//   4. Tab strips can be driven with ArrowLeft/ArrowRight/Home/End without
//      firing the selection as focus moves.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, Modal, Segmented } from "../components/ui";

function OpenModal() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button onClick={() => setOpen(true)}>open dialog</button>
			<Modal open={open} onClose={() => setOpen(false)} title="Trap test">
				<button>first action</button>
				<button>second action</button>
			</Modal>
		</>
	);
}

describe("dialog focus management", () => {
	it("wraps Tab inside the dialog and restores focus on close", async () => {
		const user = userEvent.setup();
		render(<OpenModal />);
		const trigger = screen.getByRole("button", { name: "open dialog" });
		await user.click(trigger);

		const dialog = screen.getByRole("dialog", { name: "Trap test" });
		await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

		// Walk to the last focusable (second action), then Tab must wrap to the
		// first focusable instead of escaping to the page behind the dialog.
		screen.getByRole("button", { name: "second action" }).focus();
		await user.tab();
		expect(dialog.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Close dialog" }),
		);

		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
		);
		expect(document.activeElement).toBe(trigger);
	});

	it("keeps focus on an autoFocus child instead of the close button", async () => {
		render(
			<Modal open onClose={vi.fn()} title="Focused">
				<input aria-label="case note" autoFocus />
			</Modal>,
		);
		const input = screen.getByRole("textbox", { name: "case note" });
		await waitFor(() => expect(document.activeElement).toBe(input));
	});
});

describe("ConfirmDialog recovery", () => {
	it("shows the failure, stays open, and retries successfully", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		const onConfirm = vi
			.fn()
			.mockRejectedValueOnce(new Error("network down"))
			.mockResolvedValueOnce(undefined);

		render(
			<ConfirmDialog
				open
				onClose={onClose}
				onConfirm={onConfirm}
				title="Dismiss report"
				message="This will close the report."
				confirmLabel="Dismiss"
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Dismiss" }));
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("network down");
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(onConfirm).toHaveBeenCalledTimes(2);
	});

	it("does not fire twice while the action is pending", async () => {
		let release: () => void = () => {};
		const onConfirm = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const user = userEvent.setup();
		render(
			<ConfirmDialog
				open
				onClose={vi.fn()}
				onConfirm={onConfirm}
				title="Working"
				message="…"
			/>,
		);
		const button = screen.getByRole("button", { name: "Confirm" });
		await user.click(button);
		await user.click(button);
		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
		release();
	});
});

describe("tab strip keyboard support", () => {
	it("moves focus with arrows/Home/End without selecting", async () => {
		const onChange = vi.fn();
		render(
			<Segmented
				value="a"
				onChange={onChange}
				options={[
					{ value: "a", label: "Alpha" },
					{ value: "b", label: "Beta" },
					{ value: "c", label: "Gamma" },
				]}
			/>,
		);
		const alpha = screen.getByRole("tab", { name: "Alpha" });
		const beta = screen.getByRole("tab", { name: "Beta" });
		const gamma = screen.getByRole("tab", { name: "Gamma" });

		alpha.focus();
		fireEvent.keyDown(alpha, { key: "ArrowRight" });
		expect(document.activeElement).toBe(beta);
		fireEvent.keyDown(beta, { key: "End" });
		expect(document.activeElement).toBe(gamma);
		fireEvent.keyDown(gamma, { key: "ArrowRight" });
		expect(document.activeElement).toBe(alpha);
		fireEvent.keyDown(alpha, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(gamma);
		fireEvent.keyDown(gamma, { key: "Home" });
		expect(document.activeElement).toBe(alpha);
		// Focus-only roving must not change the selection as a side effect.
		expect(onChange).not.toHaveBeenCalled();
	});
});
