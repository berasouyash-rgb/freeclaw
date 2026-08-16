// ═══════════════════════════════════════════════════════════════════
// CommentMod — comment moderation contract
// ═══════════════════════════════════════════════════════════════════
// Locks: list rendering, search filter (body + author), hide/unhide toggle,
// delete with ConfirmDialog, loading skeletons, empty state, error toasts.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommentMod from "../pages/admin/CommentMod";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	paginated: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	items: [] as unknown[],
	initialLoading: false,
	total: 0,
	setItems: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { paginated: mocks.paginated, put: mocks.put, del: mocks.del },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../hooks/useInfiniteScroll", () => ({
	useInfiniteScroll: () => ({
		items: mocks.items as any[],
		loading: false,
		initialLoading: mocks.initialLoading ?? false,
		hasMore: false,
		total: mocks.total ?? 0,
		sentinelRef: { current: null },
		loadMore: vi.fn(),
		reset: vi.fn(),
		replaceItems: vi.fn(),
		setItems: mocks.setItems ?? vi.fn(),
	}),
}));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "3h ago",
}));

vi.mock("../components/ui", () => ({
	ConfirmDialog: ({ open, onClose, onConfirm, title, confirmLabel }: any) =>
		open ? (
			<div role="dialog" aria-label={title}>
				<p>{title}</p>
				<button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
}));

const COMMENTS = [
	{
		id: "c1",
		body: "This lift is dangerous",
		author_id: "anon_alpha",
		post_id: "post_1",
		created_at: "2026-07-01T10:00:00.000Z",
		hidden: false,
		deleted: false,
	},
	{
		id: "c2",
		body: "Great suggestion!",
		author_id: "anon_beta",
		post_id: "post_2",
		created_at: "2026-07-02T10:00:00.000Z",
		hidden: true,
		deleted: true,
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.items = [...COMMENTS];
	mocks.total = 2;
	mocks.initialLoading = false;
	mocks.setItems = vi.fn();
	mocks.paginated.mockResolvedValue({ data: COMMENTS, nextCursor: null, total: 2 });
	mocks.put.mockResolvedValue({ ok: true });
	mocks.del.mockResolvedValue({ ok: true });
});

function renderPage() {
	return render(<CommentMod />);
}

describe("CommentMod — list rendering", () => {
	it("renders comments with author, post and age", async () => {
		renderPage();
		expect(await screen.findByText("This lift is dangerous")).toBeInTheDocument();
		expect(screen.getByText(/anon_alpha/)).toBeInTheDocument();
		expect(screen.getByText(/on post_1/)).toBeInTheDocument();
		expect(screen.getByText("2 total")).toBeInTheDocument();
	});

	it("shows hidden and user-deleted markers", async () => {
		renderPage();
		await screen.findByText("Great suggestion!");
		expect(screen.getByText(/user-deleted/)).toBeInTheDocument();
		expect(screen.getByText(/hidden/)).toBeInTheDocument();
	});

	it("shows the empty state when no comments exist", async () => {
		mocks.items = [];
		mocks.total = 0;
		renderPage();
		expect(await screen.findByText("No comments found.")).toBeInTheDocument();
	});

	it("shows skeletons while the initial load is pending", () => {
		mocks.initialLoading = true;
		renderPage();
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
	});
});

describe("CommentMod — search", () => {
	it("filters by comment body text", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		await user.type(
			screen.getByPlaceholderText("Search comment text or author ID…"),
			"dangerous",
		);
		expect(screen.getByText("This lift is dangerous")).toBeInTheDocument();
		expect(screen.queryByText("Great suggestion!")).not.toBeInTheDocument();
	});

	it("filters by author ID", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		await user.type(
			screen.getByPlaceholderText("Search comment text or author ID…"),
			"anon_beta",
		);
		expect(screen.queryByText("This lift is dangerous")).not.toBeInTheDocument();
		expect(screen.getByText("Great suggestion!")).toBeInTheDocument();
	});

	it("clearing the query restores all comments", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		const input = screen.getByPlaceholderText("Search comment text or author ID…");
		await user.type(input, "zzz");
		expect(screen.getByText("No comments found.")).toBeInTheDocument();
		await user.clear(input);
		expect(screen.getByText("This lift is dangerous")).toBeInTheDocument();
	});
});

describe("CommentMod — moderation actions", () => {
	it("hides a comment via PUT and updates the list", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		await user.click(screen.getByTitle("Hide"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/comments", {
				id: "c1",
				hidden: true,
			});
		});
	});

	it("unhides a comment via PUT", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Great suggestion!");

		await user.click(screen.getByTitle("Unhide"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/comments", {
				id: "c2",
				hidden: false,
			});
		});
	});

	it("deletes a comment after confirmation", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		const card = screen.getByText("This lift is dangerous").closest(".card") as HTMLElement;
		await user.click(within(card).getByTitle("Delete"));
		await user.click(
			within(screen.getByRole("dialog", { name: "Delete comment?" })).getByRole(
				"button",
				{ name: "Delete" },
			),
		);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/comments", { id: "c1" });
		});
		expect(mocks.toast).toHaveBeenCalledWith("Deleted", "ok");
	});

	it("does not delete when the dialog is cancelled", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		const card = screen.getByText("This lift is dangerous").closest(".card") as HTMLElement;
		await user.click(within(card).getByTitle("Delete"));
		await user.click(
			within(screen.getByRole("dialog", { name: "Delete comment?" })).getByRole(
				"button",
				{ name: "Cancel" },
			),
		);
		expect(mocks.del).not.toHaveBeenCalled();
	});

	it("toasts an error when hiding fails", async () => {
		mocks.put.mockRejectedValue(new Error("hide boom"));
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		await user.click(screen.getByTitle("Hide"));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("hide boom", "err");
		});
	});

	it("toasts an error when deleting fails", async () => {
		mocks.del.mockRejectedValue(new Error("del boom"));
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("This lift is dangerous");

		const card = screen.getByText("This lift is dangerous").closest(".card") as HTMLElement;
		await user.click(within(card).getByTitle("Delete"));
		await user.click(
			within(screen.getByRole("dialog", { name: "Delete comment?" })).getByRole(
				"button",
				{ name: "Delete" },
			),
		);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("del boom", "err");
		});
	});
});
