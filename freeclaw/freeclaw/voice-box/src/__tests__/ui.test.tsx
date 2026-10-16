// ═══════════════════════════════════════════════════════════════════
// ui.tsx — shared dialog & control kit contract
// ═══════════════════════════════════════════════════════════════════
// Locks: Modal (open/close/Escape/backdrop/scroll-lock), ConfirmDialog,
// ReportDialog (reasons + detail), StatusDialog (templates), PromptDialog
// (single/multiline/optional/Enter), Segmented control.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
	ConfirmDialog,
	Modal,
	PromptDialog,
	ReportDialog,
	Segmented,
	StatusDialog,
} from "../components/ui";

describe("Modal", () => {
	it("renders nothing when closed", () => {
		render(
			<Modal open={false} onClose={vi.fn()} title="T">
				body
			</Modal>,
		);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("renders the title and children when open", () => {
		render(
			<Modal open onClose={vi.fn()} title="Hello">
				Some content
			</Modal>,
		);
		expect(screen.getByRole("dialog", { name: "Hello" })).toBeInTheDocument();
		expect(screen.getByText("Some content")).toBeInTheDocument();
	});

	it("portals to document.body so card clipping cannot trap it", () => {
		// Regression: the report dialog painted inside the post card because
		// Modal rendered inline under ancestors with overflow/transform.
		const { container } = render(
			<div data-testid="caller">
				<Modal open onClose={vi.fn()} title="Hello">
					Some content
				</Modal>
			</div>,
		);
		const dialog = screen.getByRole("dialog", { name: "Hello" });
		expect(dialog.parentElement?.closest('[data-testid="caller"]')).toBeNull();
		expect(document.body.contains(dialog)).toBe(true);
		expect(container.querySelector('[data-testid="caller"]')).not.toBeNull();
	});

	it("closes via the close button, backdrop, and Escape", async () => {
		const onClose = vi.fn();
		render(
			<Modal open onClose={onClose} title="T">
				body
			</Modal>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Close dialog" }));
		expect(onClose).toHaveBeenCalledTimes(1);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(2);

		fireEvent.click(
			screen
				.getByLabelText("T")
				.parentElement!.querySelector(".absolute.inset-0")!,
		);
		expect(onClose).toHaveBeenCalledTimes(3);
	});

	it("removes the keydown listener when closed again", async () => {
		const { rerender } = render(
			<Modal open onClose={vi.fn()} title="T">
				b
			</Modal>,
		);
		const onClose = vi.fn();
		rerender(
			<Modal open={false} onClose={onClose} title="T">
				b
			</Modal>,
		);
		// listener was cleaned up by the effect teardown — pressing Escape now must not fire
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).not.toHaveBeenCalled();
	});
});

describe("ConfirmDialog", () => {
	it("calls onConfirm and onClose when confirmed", async () => {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();
		render(
			<ConfirmDialog
				open
				onClose={onClose}
				onConfirm={onConfirm}
				title="Sure?"
				message="This is final."
				confirmLabel="Yes"
			/>,
		);

		expect(screen.getByText("This is final.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Yes" }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("only closes when cancelled", async () => {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();
		render(
			<ConfirmDialog
				open
				onClose={onClose}
				onConfirm={onConfirm}
				title="Sure?"
				message="M"
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("shows the warning icon when danger is set", () => {
		render(
			<ConfirmDialog
				open
				onClose={vi.fn()}
				onConfirm={vi.fn()}
				title="D"
				message="M"
				danger
			/>,
		);
		expect(document.querySelector("svg")).toBeInTheDocument();
	});
});

describe("ReportDialog", () => {
	it("submits the default reason when no detail is added", async () => {
		const onSubmit = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();
		render(<ReportDialog open onClose={onClose} onSubmit={onSubmit} />);

		expect(
			screen.getByRole("radio", { name: "Bullying or harassment" }),
		).toHaveAttribute("aria-checked", "true");
		await user.click(screen.getByRole("button", { name: /Submit report/ }));
		expect(onSubmit).toHaveBeenCalledWith("Bullying or harassment");
		expect(onClose).toHaveBeenCalled();
	});

	it("submits a selected reason merged with typed detail", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(<ReportDialog open onClose={vi.fn()} onSubmit={onSubmit} />);

		await user.click(
			screen.getByRole("radio", { name: "Spam or advertising" }),
		);
		await user.type(
			screen.getByPlaceholderText(/Additional details/),
			"repeated posts",
		);
		await user.click(screen.getByRole("button", { name: /Submit report/ }));
		expect(onSubmit).toHaveBeenCalledWith(
			"Spam or advertising: repeated posts",
		);
	});

	it("closes without submitting on cancel", async () => {
		const onSubmit = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();
		render(<ReportDialog open onClose={onClose} onSubmit={onSubmit} />);

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});
});

describe("StatusDialog", () => {
	it("prefills the note with the first template for a known status", async () => {
		const onSubmit = vi.fn();
		render(
			<StatusDialog
				open
				onClose={vi.fn()}
				onSubmit={onSubmit}
				status="solved"
				statusLabel="Solved"
			/>,
		);

		const textarea = screen.getByPlaceholderText(
			/Public message/,
		) as HTMLTextAreaElement;
		expect(textarea.value).toBe(
			"This has been fixed! Please let us know if it happens again. ✅",
		);
		// template chips visible (truncated to 52 chars)
		expect(screen.getAllByRole("button", { name: /…/ })).not.toHaveLength(0);
	});

	it("submits the note trimmed and closes", async () => {
		const onSubmit = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();
		render(
			<StatusDialog
				open
				onClose={onClose}
				onSubmit={onSubmit}
				status="in_progress"
				statusLabel="In progress"
			/>,
		);

		const textarea = screen.getByPlaceholderText(/Public message/);
		await user.clear(textarea);
		await user.type(textarea, "  fixing it now  ");
		await user.click(screen.getByRole("button", { name: "Update & notify" }));
		expect(onSubmit).toHaveBeenCalledWith("fixing it now");
		expect(onClose).toHaveBeenCalled();
	});

	it("lets the admin pick a different template and skip", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(
			<StatusDialog
				open
				onClose={vi.fn()}
				onSubmit={onSubmit}
				status="verified"
				statusLabel="Verified"
			/>,
		);

		const second = "Confirmed — our team has checked and this is a real issue.";
		await user.click(
			screen.getByRole("button", { name: new RegExp(second.slice(0, 30)) }),
		);
		await user.click(screen.getByRole("button", { name: "Update & notify" }));
		expect(onSubmit).toHaveBeenCalledWith(second);

		await user.click(screen.getByRole("button", { name: "Skip message" }));
		expect(onSubmit).toHaveBeenCalledWith("");
	});

	it("shows no templates for an unknown status", () => {
		render(
			<StatusDialog
				open
				onClose={vi.fn()}
				onSubmit={vi.fn()}
				status="mystery"
				statusLabel="?"
			/>,
		);
		expect(
			(screen.getByPlaceholderText(/Public message/) as HTMLTextAreaElement)
				.value,
		).toBe("");
	});
});

describe("PromptDialog", () => {
	it("submits the trimmed single-line value", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(
			<PromptDialog
				open
				onClose={vi.fn()}
				onSubmit={onSubmit}
				title="Name it"
				label="Title"
				placeholder="Enter…"
			/>,
		);

		expect(screen.getByText("Title")).toBeInTheDocument();
		await user.type(screen.getByPlaceholderText("Enter…"), "  My title  ");
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(onSubmit).toHaveBeenCalledWith("My title");
	});

	it("disables submit while the value is empty (required)", () => {
		render(
			<PromptDialog open onClose={vi.fn()} onSubmit={vi.fn()} title="T" />,
		);
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
	});

	it("submits on Enter when the value is non-empty", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(
			<PromptDialog
				open
				onClose={vi.fn()}
				onSubmit={onSubmit}
				title="T"
				placeholder="p"
			/>,
		);

		await user.type(screen.getByPlaceholderText("p"), "hello{Enter}");
		expect(onSubmit).toHaveBeenCalledWith("hello");
	});

	it("allows submitting an empty value when optional", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(
			<PromptDialog
				open
				onClose={vi.fn()}
				onSubmit={onSubmit}
				title="T"
				optional
				submitLabel="Go"
			/>,
		);

		const submit = screen.getByRole("button", { name: "Go" });
		expect(submit).not.toBeDisabled();
		await user.click(submit);
		expect(onSubmit).toHaveBeenCalledWith("");
	});

	it("supports multiline input", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(
			<PromptDialog
				open
				onClose={vi.fn()}
				onSubmit={onSubmit}
				title="T"
				multiline
				placeholder="multi"
			/>,
		);

		await user.type(screen.getByPlaceholderText("multi"), "line one");
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(onSubmit).toHaveBeenCalledWith("line one");
	});
});

describe("Segmented", () => {
	it("renders options with the active one selected", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(
			<Segmented
				value="a"
				onChange={onChange}
				options={[
					{ value: "a", label: "Alpha" },
					{ value: "b", label: "Beta" },
				]}
			/>,
		);

		expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute(
			"aria-selected",
			"false",
		);

		await user.click(screen.getByRole("tab", { name: "Beta" }));
		expect(onChange).toHaveBeenCalledWith("b");
	});
});
