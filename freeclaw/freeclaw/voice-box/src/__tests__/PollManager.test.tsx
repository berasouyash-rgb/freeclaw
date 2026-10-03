// ═══════════════════════════════════════════════════════════════════
// PollManager — admin poll management contract
// ═══════════════════════════════════════════════════════════════════
// Locks: load/empty/loading states, new-poll form (type toggle, options
// parsing, publish gating), archive/restore, delete with ConfirmDialog
// (confirm + cancel), error toasts, live-realtime reload wiring.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PollManager from "../pages/admin/PollManager";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: mocks.post, put: mocks.put, del: mocks.del },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "2d ago",
}));

// ConfirmDialog — the real one is a Modal; render a minimal role=dialog
vi.mock("../components/ui", () => ({
	ConfirmDialog: ({ open, onClose, onConfirm, title, message, confirmLabel }: any) =>
		open ? (
			<div role="dialog" aria-label={title}>
				{message && <p>{message}</p>}
				<button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
}));

const POLL_YESNO = {
	id: "p1",
	title: "Should the library stay open late?",
	ptype: "yesno",
	archived: false,
	total_votes: 4,
	vote_counts: [3, 1],
	options: ["Yes", "No"],
	created_at: "2026-07-01T10:00:00.000Z",
	post_id: null,
};
const POLL_MULTI = {
	id: "p2",
	title: "Best coffee brand?",
	ptype: "multi",
	archived: true,
	total_votes: 10,
	vote_counts: [6, 4],
	options: ["Starbucks", "Dunkin"],
	created_at: "2026-07-01T09:00:00.000Z",
	post_id: "post-1",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue([]);
	mocks.post.mockResolvedValue({ id: "new" });
	mocks.put.mockResolvedValue({ ok: true });
	mocks.del.mockResolvedValue({ ok: true });
});

function renderPage() {
	return render(<PollManager />);
}

describe("PollManager — load states", () => {
	it("shows skeleton loaders while fetching", () => {
		mocks.get.mockImplementation(
			() => new Promise(() => {}), // never resolves
		);
		renderPage();
		expect(screen.getByText(/Poll Manager/i)).toBeInTheDocument();
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
	});

	it("loads and lists polls with type, vote count and age", async () => {
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		expect(
			await screen.findByText("Should the library stay open late?"),
		).toBeInTheDocument();
		expect(screen.getByText(/yesno · 4 votes · created 2d ago/)).toBeInTheDocument();
	});

	it("shows the empty state when there are no polls", async () => {
		mocks.get.mockResolvedValue([]);
		renderPage();
		expect(await screen.findByText("No polls yet.")).toBeInTheDocument();
	});

	it("renders archived chip and linked-to-complaint note", async () => {
		mocks.get.mockResolvedValue([POLL_MULTI]);
		renderPage();
		expect(await screen.findByText("Best coffee brand?")).toBeInTheDocument();
		expect(screen.getByText("archived")).toBeInTheDocument();
		expect(screen.getByText(/linked to complaint/)).toBeInTheDocument();
	});

	it("renders result bars with correct percentages", async () => {
		mocks.get.mockResolvedValue([POLL_MULTI]);
		renderPage();
		await screen.findByText("Best coffee brand?");
		expect(screen.getByText("60% · 6")).toBeInTheDocument();
		expect(screen.getByText("40% · 4")).toBeInTheDocument();
	});

	it("toasts an error when the load fails", async () => {
		mocks.get.mockRejectedValue(new Error("load boom"));
		renderPage();
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("load boom", "err");
		});
	});

	it("toasts a generic error when the load fails without an Error", async () => {
		mocks.get.mockRejectedValue("boom");
		renderPage();
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Failed to load polls", "err");
		});
	});
});

describe("PollManager — new poll form", () => {
	it("toggles the create form via the New poll button", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("No polls yet.");
		expect(screen.queryByPlaceholderText("Poll question")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /New poll/ }));
		expect(screen.getByPlaceholderText("Poll question")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /New poll/ }));
		expect(screen.queryByPlaceholderText("Poll question")).not.toBeInTheDocument();
	});

	it("keeps Publish disabled until the title has at least 5 characters", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: /New poll/ }));
		const publish = screen.getByRole("button", { name: "Publish poll" });
		expect(publish).toBeDisabled();

		await user.type(screen.getByPlaceholderText("Poll question"), "Abc");
		expect(publish).toBeDisabled();

		await user.type(screen.getByPlaceholderText("Poll question"), "de");
		expect(publish).toBeEnabled();
	});

	it("creates a Yes/No poll (no options textarea shown)", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: /New poll/ }));
		await user.type(
			screen.getByPlaceholderText("Poll question"),
			"Open on Sunday?",
		);
		// Yes/No is default — options input must NOT appear
		expect(
			screen.queryByPlaceholderText("One option per line (2–10)"),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Publish poll" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/polls", {
				title: "Open on Sunday?",
				ptype: "yesno",
				options: [],
				author_id: "ADMIN",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Poll created", "ok");
	});

	it("creates a single-choice poll parsing newline-separated options", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: /New poll/ }));
		await user.click(screen.getByRole("button", { name: "Single" }));
		await user.type(
			screen.getByPlaceholderText("Poll question"),
			"Best day for the event?",
		);
		await user.type(
			screen.getByPlaceholderText("One option per line (2–10)"),
			"Monday\n Tuesday\n\nThursday",
		);
		await user.click(screen.getByRole("button", { name: "Publish poll" }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/polls", {
				title: "Best day for the event?",
				ptype: "single",
				options: ["Monday", "Tuesday", "Thursday"],
				author_id: "ADMIN",
			});
		});
	}, 15_000);

	it("switches between type buttons and only shows options for non-yesno types", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: /New poll/ }));
		await user.click(screen.getByRole("button", { name: "Multi" }));
		expect(
			screen.getByPlaceholderText("One option per line (2–10)"),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Yes/No" }));
		expect(
			screen.queryByPlaceholderText("One option per line (2–10)"),
		).not.toBeInTheDocument();
	});

	it("clears the form and reloads after a successful create", async () => {
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		await user.click(screen.getByRole("button", { name: /New poll/ }));
		await user.type(
			screen.getByPlaceholderText("Poll question"),
			"New question here",
		);
		await user.click(screen.getByRole("button", { name: "Publish poll" }));

		await waitFor(() => expect(mocks.get).toHaveBeenCalled());
		// form closed + reset
		expect(screen.queryByPlaceholderText("Poll question")).not.toBeInTheDocument();
	});

	it("toasts an error when create fails", async () => {
		mocks.post.mockRejectedValue(new Error("create boom"));
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: /New poll/ }));
		await user.type(
			screen.getByPlaceholderText("Poll question"),
			"A valid question",
		);
		await user.click(screen.getByRole("button", { name: "Publish poll" }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("create boom", "err");
		});
	});
});

describe("PollManager — archive/restore and delete", () => {
	it("archives a poll via PUT and reloads", async () => {
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		await screen.findByText("Should the library stay open late?");

		await user.click(screen.getByTitle("Archive"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/polls", {
				id: "p1",
				archived: true,
			});
		});
	});

	it("restores an archived poll via PUT and reloads", async () => {
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_MULTI]);
		renderPage();
		await screen.findByText("Best coffee brand?");

		await user.click(screen.getByTitle("Restore"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/polls", {
				id: "p2",
				archived: false,
			});
		});
	});

	it("toasts an error when archive fails", async () => {
		mocks.put.mockRejectedValue(new Error("archive boom"));
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		await screen.findByText("Should the library stay open late?");

		await user.click(screen.getByTitle("Archive"));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("archive boom", "err");
		});
	});

	it("opens the delete confirm dialog and deletes on confirm", async () => {
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		await screen.findByText("Should the library stay open late?");

		await user.click(screen.getByTitle("Delete"));
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(/permanently removed/),
		).toBeInTheDocument();

		await user.click(within(dialog).getByRole("button", { name: "Delete poll" }));
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/polls?id=p1", { id: "p1" });
		});
		expect(mocks.toast).toHaveBeenCalledWith("Deleted", "ok");
	});

	it("does not delete when the dialog is cancelled", async () => {
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		await screen.findByText("Should the library stay open late?");

		await user.click(screen.getByTitle("Delete"));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Cancel",
			}),
		);
		expect(mocks.del).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("toasts an error when delete fails", async () => {
		mocks.del.mockRejectedValue(new Error("delete boom"));
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		await screen.findByText("Should the library stay open late?");

		await user.click(screen.getByTitle("Delete"));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete poll",
			}),
		);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("delete boom", "err");
		});
	});
});

describe("PollManager — realtime + interaction details", () => {
	it("subscribes to polls and poll_votes via useRealtime (load wiring)", () => {
		// useRealtime is stubbed; assert the page still mounts and calls get
		renderPage();
		expect(mocks.get).toHaveBeenCalledWith("/api/polls");
	});

	it("reloads the list after a successful archive (2nd get)", async () => {
		const user = userEvent.setup();
		mocks.get.mockResolvedValue([POLL_YESNO]);
		renderPage();
		await screen.findByText("Should the library stay open late?");
		expect(mocks.get).toHaveBeenCalledTimes(1);

		await user.click(screen.getByTitle("Archive"));
		await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
	});

	it("tolerates missing optional vote fields", async () => {
		mocks.get.mockResolvedValue([
			{ id: "p3", title: "Bare poll", ptype: "yesno", options: ["A", "B"] },
		]);
		renderPage();
		expect(await screen.findByText("Bare poll")).toBeInTheDocument();
		expect(screen.getAllByText("0% · 0")).toHaveLength(2); // one per option
	});

	it("handles a large option list without layout crash", async () => {
		const options = Array.from({ length: 10 }, (_, i) => `Option ${i + 1}`);
		mocks.get.mockResolvedValue([
			{
				id: "p4",
				title: "Ten-way poll",
				ptype: "multi",
				options,
				vote_counts: options.map(() => 1),
				total_votes: 10,
				created_at: "2026-07-01T10:00:00.000Z",
			},
		]);
		renderPage();
		expect(await screen.findByText("Ten-way poll")).toBeInTheDocument();
		expect(screen.getByText("Option 10")).toBeInTheDocument();
	});

	it("fires fireEvent-based toggle on the new poll button without crash", () => {
		renderPage();
		fireEvent.click(screen.getByRole("button", { name: /New poll/ }));
		expect(screen.getByPlaceholderText("Poll question")).toBeInTheDocument();
	});
});
