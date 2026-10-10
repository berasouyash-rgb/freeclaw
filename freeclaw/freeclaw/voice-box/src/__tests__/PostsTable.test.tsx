// ═══════════════════════════════════════════════════════════════════
// PostsTable — complaint/suggestion management table contract
// ═══════════════════════════════════════════════════════════════════
// Locks: title variants by type, row rendering (category/status/priority/
// author/age), search + status + category filters, hide/official toggles,
// detail drawer (status/priority/category/assigned/eta edits, pin/feature/
// hide/lock/merge/poll/soft-delete/restore/permanent-delete), status dialog
// wiring, message-author navigation, live-refresh merge, error toasts.
// ═══════════════════════════════════════════════════════════════════

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostsTable from "../pages/admin/PostsTable";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	paginated: vi.fn(),
	getFresh: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	post: vi.fn(),
	get: vi.fn(),
	items: [] as unknown[],
	initialLoading: false,
	loading: false,
	hasMore: false,
	total: 0,
	setItems: vi.fn(),
	softReset: vi.fn(),
	// The real hook calls the fetcher; the mock does not, so tests capture
	// it and drive it directly to inspect the request the table would make.
	fetchFn: null as null | ((p: { cursor: string | null; limit: number }) => unknown),
	// Captured realtime callback so tests can drive refresh() directly.
	realtimeCb: null as null | (() => void | Promise<void>),
}));

vi.mock("../lib/api", () => ({
	api: {
		paginated: mocks.paginated,
		getFresh: mocks.getFresh,
		put: mocks.put,
		del: mocks.del,
		post: mocks.post,
		get: mocks.get,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../hooks/useInfiniteScroll", () => ({
	useInfiniteScroll: (fn: (p: { cursor: string | null; limit: number }) => unknown) => {
		mocks.fetchFn = fn;
		return {
			items: mocks.items as any[],
			loading: mocks.loading ?? false,
			initialLoading: mocks.initialLoading ?? false,
			hasMore: mocks.hasMore ?? false,
			total: mocks.total ?? 0,
			sentinelRef: { current: null },
			loadMore: vi.fn(),
			reset: vi.fn(),
			softReset: mocks.softReset ?? vi.fn(),
			replaceItems: vi.fn(),
			setItems: mocks.setItems ?? vi.fn(),
		};
	},
}));

vi.mock("../hooks/useCategories", () => ({
	useCategories: () => ["Facilities", "Academics"],
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (_topics: unknown, cb: () => void | Promise<void>) => {
		mocks.realtimeCb = cb;
	},
}));

vi.mock("../lib/utils", () => ({
	CATEGORIES: ["Facilities", "Academics"],
	PRIORITY_META: {
		low: { label: "Low", color: "#8e8ea5" },
		medium: { label: "Medium", color: "#d98a0b" },
		high: { label: "High", color: "#e2574c" },
		critical: { label: "Critical", color: "#dc4b4b" },
	},
	STATUS_META: {
		reported: { label: "Reported", color: "#dc4b4b" },
		open: { label: "Open", color: "#5652d6" },
		pending_review: { label: "Pending Review", color: "#d98a0b" },
		in_progress: { label: "In Progress", color: "#16a06a" },
		solved: { label: "Solved", color: "#16a06a" },
		archived: { label: "Archived", color: "#888" },
		hidden: { label: "Hidden", color: "#888" },
	},
	sanitize: (s: string) => s,
	timeAgo: () => "2d ago",
}));

vi.mock("../components/Confetti", () => ({ fireConfetti: vi.fn() }));

vi.mock("../components/ui", () => ({
	ConfirmDialog: ({ open, onClose, onConfirm, title, confirmLabel }: any) =>
		open ? (
			<div role="dialog" aria-label={title}>
				<button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
	PromptDialog: ({ open, onSubmit, onClose, title, submitLabel }: any) =>
		open ? (
			<div role="dialog" aria-label={title}>
				<p>{title}</p>
				<button onClick={() => onSubmit("target_post_1")}>
					{submitLabel || "Save"}
				</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
	StatusDialog: ({ open, onClose, onSubmit, statusLabel }: any) =>
		open ? (
			<div role="dialog" aria-label="status">
				<p>{statusLabel}</p>
				<button onClick={() => onSubmit("public note")}>Confirm status</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
}));

vi.mock("../components/ExportCSVButton", () => ({
	default: ({ label }: any) => <button>{label}</button>,
}));

const POST = {
	id: "post_1",
	title: "Broken lift in block C",
	description: "Stuck for two hours",
	category: "Facilities",
	priority: "high",
	status: "reported",
	author_id: "anon_alpha",
	created_at: "2026-07-01T10:00:00.000Z",
	hidden: false,
	official: false,
	pinned: false,
	featured: false,
	locked: false,
	deleted: false,
	assigned_to: "",
	eta: "",
	admin_reply: "",
	admin_notes: "",
};

const POST2 = {
	...POST,
	id: "post_2",
	title: "Add a nap room",
	category: "Academics",
	status: "in_progress",
	author_id: "anon_beta",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.items = [POST, POST2];
	mocks.total = 2;
	mocks.initialLoading = false;
	mocks.loading = false;
	mocks.hasMore = false;
	mocks.setItems = vi.fn();
	mocks.softReset = vi.fn();
	mocks.fetchFn = null;
	mocks.realtimeCb = null;
	mocks.paginated.mockResolvedValue({ data: [POST, POST2], nextCursor: null, total: 2 });
	mocks.getFresh.mockResolvedValue({ data: [POST, POST2], total: 2 });
	mocks.put.mockResolvedValue({});
	mocks.del.mockResolvedValue({ ok: true });
	mocks.post.mockResolvedValue({ ok: true });
	vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("PostsTable — variants and list rendering", () => {
	it("renders the complaint title for type=problem", async () => {
		render(<PostsTable type="problem" />);
		expect(await screen.findByText(/Complaint Management/i)).toBeInTheDocument();
		expect(screen.getByText("Broken lift in block C")).toBeInTheDocument();
		// Header shows filtered / total so the filter chain is visible
		expect(screen.getByText(/2 filtered\s*\/\s*2 total/)).toBeInTheDocument();
	});

	it("renders the suggestions title for type=suggestion", async () => {
		render(<PostsTable type="suggestion" />);
		expect(await screen.findByText("Suggestions")).toBeInTheDocument();
	});

	it("renders row metadata: category, author, age", async () => {
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		// 'Facilities' also appears as a category <option> — scope to the table
		const row = screen.getByText("Broken lift in block C").closest("tr") as HTMLElement;
		expect(within(row).getByText("Facilities")).toBeInTheDocument();
		expect(within(row).getByText("anon_alpha".slice(0, 10))).toBeInTheDocument();
		expect(within(row).getByText("2d ago")).toBeInTheDocument();
	});

	it("shows the empty state when no posts match", async () => {
		mocks.items = [];
		mocks.total = 0;
		render(<PostsTable type="problem" />);
		expect(await screen.findByText("No posts match your filters.")).toBeInTheDocument();
	});

	it("shows skeletons while the FIRST load is pending (nothing on screen yet)", () => {
		mocks.items = [];
		mocks.initialLoading = true;
		render(<PostsTable type="problem" />);
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
	});

	// SMOOTHNESS: a filter change used to blank the whole table to skeletons
	// (reset() cleared the rows), so every pause while typing in the debounced
	// search box flashed an empty table and popped the rows back in. The rows
	// already on screen must stay put while the new page loads.
	it("keeps the rows on screen while a reload is pending instead of flashing skeletons", async () => {
		const user = userEvent.setup();
		const { rerender } = render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		// Hook enters the reload state with the previous page still held.
		mocks.initialLoading = true;
		mocks.items = [POST, POST2];
		rerender(<PostsTable type="problem" />);
		// priority=high matches both seeded rows, so the rows that stay on
		// screen are proof the table was NOT replaced by a skeleton block.
		await user.selectOptions(
			screen.getByLabelText("Filter by priority"),
			"high",
		);
		expect(screen.getByText("Broken lift in block C")).toBeInTheDocument();
		expect(screen.getByText("Add a nap room")).toBeInTheDocument();
		expect(document.querySelectorAll(".skeleton").length).toBe(0);
	});

	// SMOOTHNESS: the pager footer must occupy the same space whether it is
	// loading, done, or idle — otherwise the page height changes under the
	// reader on every page boundary.
	it("renders a single stable pager slot across loading and done states", async () => {
		mocks.hasMore = true;
		mocks.loading = true;
		const { rerender } = render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		expect(screen.getByTestId("pager-slot")).toBeInTheDocument();
		const loadingText = screen.getByTestId("pager-slot").textContent ?? "";

		mocks.loading = false;
		mocks.hasMore = false;
		rerender(<PostsTable type="problem" />);
		const doneSlot = screen.getByTestId("pager-slot");
		expect(doneSlot).toBeInTheDocument();
		// Same element, different message — the slot never disappears.
		expect(doneSlot.textContent).not.toBe(loadingText);
	});

	it("renders per-row status selects with the current status selected", async () => {
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		const sel = screen.getByLabelText("Status for Broken lift in block C");
		expect(sel).toHaveValue("reported");
	});
});

describe("PostsTable — filters", () => {
	it("filters by search across title", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.type(
			screen.getByPlaceholderText("Search title, author ID, post ID…"),
			"nap",
		);
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
		expect(screen.getByText("Add a nap room")).toBeInTheDocument();
	});

	it("filters by author ID", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.type(
			screen.getByPlaceholderText("Search title, author ID, post ID…"),
			"anon_alpha",
		);
		expect(screen.getByText("Broken lift in block C")).toBeInTheDocument();
		expect(screen.queryByText("Add a nap room")).not.toBeInTheDocument();
	});

	it("filters by status dropdown", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const selects = screen.getAllByRole("combobox");
		// selects: [date range, global status, global category, row1 status, row2 status]
		await user.selectOptions(selects[1] as HTMLSelectElement, "in_progress");
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
		expect(screen.getByText("Add a nap room")).toBeInTheDocument();
	});

	it("filters by category dropdown", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const selects = screen.getAllByRole("combobox");
		await user.selectOptions(selects[2] as HTMLSelectElement, "Academics");
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
		expect(screen.getByText("Add a nap room")).toBeInTheDocument();
	});

	it("clearing the search restores all rows", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const input = screen.getByPlaceholderText("Search title, author ID, post ID…");
		await user.type(input, "zzz");
		expect(screen.getByText("No posts match your filters.")).toBeInTheDocument();
		await user.clear(input);
		expect(screen.getByText("Broken lift in block C")).toBeInTheDocument();
		expect(screen.getByText("Add a nap room")).toBeInTheDocument();
	});
});

describe("PostsTable — row quick actions", () => {
	it("hides a post via the eye toggle and re-shows", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const row = screen.getByText("Broken lift in block C").closest("tr") as HTMLElement;
		await user.click(within(row).getByTitle("Hide post (flag)"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_1",
				hidden: true,
			});
		});
	});

	it("toggles official status via the shield button", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const row = screen.getByText("Broken lift in block C").closest("tr") as HTMLElement;
		await user.click(within(row).getByTitle("Mark official"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_1",
				official: true,
			});
		});
	});

	it("toasts an error when the hide toggle fails", async () => {
		mocks.put.mockRejectedValue(new Error("hide boom"));
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const row = screen.getByText("Broken lift in block C").closest("tr") as HTMLElement;
		await user.click(within(row).getByTitle("Hide post (flag)"));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("hide boom", "err");
		});
	});
});

describe("PostsTable — detail drawer", () => {
	it("opens the detail drawer on row click with edit controls", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByText("Broken lift in block C"));
		expect(screen.getByText("post_1 · by anon_alpha")).toBeInTheDocument();
		// Title appears in both the table row and the drawer — the drawer h2 is
		// the detail view heading
		expect(screen.getByRole("heading", { name: "Broken lift in block C" })).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Private moderator notes…")).toBeInTheDocument();
	});

	it("locks background scroll while the drawer is open (no scroll chaining)", async () => {
		const user = userEvent.setup();
		const { unmount } = render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByText("Broken lift in block C"));
		expect(document.body.style.overflow).toBe("hidden");
		// The scrollable panel must contain overscroll so wheel/touch
		// scrolling never drives the page behind it.
		const panel = screen
			.getByRole("heading", { name: "Broken lift in block C" })
			.closest("div.fixed")!
			.querySelector(".overflow-y-auto")!;
		expect(panel.classList.contains("overscroll-contain")).toBe(true);

		// Closing (unmount here) restores the previous overflow.
		unmount();
		expect(document.body.style.overflow).toBe("");
	});



	it("pins and features from the drawer", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Pin" }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post_1",
			pinned: true,
		});

		await user.click(screen.getByRole("button", { name: "Feature" }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post_1",
			featured: true,
		});
	});

	it("locks comments and hides from the drawer", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Lock comments" }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post_1",
			locked: true,
		});

		await user.click(screen.getByRole("button", { name: "Hide" }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post_1",
			hidden: true,
		});
	});

	it("shows who deleted a user-deleted post and when", async () => {
		mocks.items = [
			{
				...POST,
				deleted: true,
				author_id: "anon_alpha",
				updated_at: "2026-09-26T10:00:00.000Z",
			},
		];
		mocks.total = 1;
		render(<PostsTable type="problem" />);
		expect(await screen.findByText(/Deleted by user/)).toBeInTheDocument();
	});

	it("soft-deletes and restores a post", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Soft delete" }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post_1",
			deleted: true,
		});
	});

	it("rejects a held post with a public reason and hides it", async () => {
		const user = userEvent.setup();
		mocks.items = [{ ...POST, status: "pending_review" }];
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Reject" }));
		const dialog = screen.getByRole("dialog", { name: "status" });
		await user.click(within(dialog).getByRole("button", { name: "Confirm status" }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_1",
				status: "archived",
				status_note: "public note",
				hidden: true,
			});
		});
	});

	it("finds exact-duplicate spam and merges it into the open post", async () => {
		const user = userEvent.setup();
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/duplicates") && body?.action === "merge")
				return Promise.resolve({ merged: 1, kept: "post_1" });
			if (String(url).includes("/api/duplicates"))
				return Promise.resolve({
					post: { id: "post_1" },
					duplicates: [
						{ id: "post_9", title: "Broken lift in block C", category: "Facilities", status: "reported", similarity: 100 },
					],
				});
			return Promise.resolve({});
		});
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Find duplicates" }));
		expect(await screen.findByRole("button", { name: /Merge post_9/ })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /Merge post_9/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/duplicates",
				{ action: "merge", keep_post_id: "post_1", merge_ids: ["post_9"] },
			);
		});
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_9",
				hidden: true,
				status_note: "Merged into post_1",
			});
		});
	});

	it("removes an exact-duplicate spam post without merging", async () => {
		const user = userEvent.setup();
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/duplicates"))
				return Promise.resolve({
					post: { id: "post_1" },
					duplicates: [
						{ id: "post_9", title: "Broken lift in block C", category: "Facilities", status: "reported", similarity: 100 },
					],
				});
			return Promise.resolve({});
		});
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Find duplicates" }));
		expect(await screen.findByRole("button", { name: /Remove post_9/ })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /Remove post_9/ }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_9",
				deleted: true,
			});
		});
	});

	it("merges a duplicate via the merge dialog", async () => {		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Merge duplicate" }));
		const dialog = screen.getByRole("dialog", { name: "Merge duplicate" });
		await user.click(within(dialog).getByRole("button", { name: "Merge" }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_1",
				merged_into: "target_post_1",
				hidden: true,
				status_note: "Merged into target_post_1",
			});
		});
	});

	it("converts a post to a linked poll via the poll dialog", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Convert to poll" }));
		await user.click(
			within(screen.getByRole("dialog", { name: "Convert to poll" })).getByRole(
				"button",
				{ name: "Create poll" },
			),
		);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/polls", {
				title: "Do you agree: Broken lift in block C?",
				ptype: "yesno",
				post_id: "post_1",
				author_id: "ADMIN",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Linked poll created", "ok");
	});

	it("permanently deletes after the dangerous confirm", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Permanently delete" }));
		await user.click(
			within(
				screen.getByRole("dialog", { name: 'Permanently delete "Broken lift in block C"?' }),
			).getByRole("button", { name: "Delete forever" }),
		);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/posts?id=post_1", { id: "post_1" });
		});
		expect(mocks.toast).toHaveBeenCalledWith("Permanently deleted", "ok");
	});

	it("opens the status dialog when a row status changes and submits the note", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const sel = screen.getByLabelText("Status for Broken lift in block C");
		await user.selectOptions(sel, "solved");
		const dialog = screen.getByRole("dialog", { name: "status" });
		await user.click(
			within(dialog).getByRole("button", { name: "Confirm status" }),
		);
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_1",
				status: "solved",
				status_note: "public note",
			});
		});
	});

	it("saves the assigned moderator on blur when changed", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		const input = screen.getByPlaceholderText("e.g. Ms. Rivera");
		await user.type(input, "Ms. Lee");
		fireEvent.blur(input);
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_1",
				assigned_to: "Ms. Lee",
			});
		});
	});

	it("wires Message author to the inbox tab", async () => {
		const listener = vi.fn();
		window.addEventListener("vb:admin-tab", listener);
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Message author" }));
		expect(sessionStorage.getItem("vb:adminChatTarget")).toBe("anon_alpha");
		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({ detail: "inbox" }),
			);
		});
		window.removeEventListener("vb:admin-tab", listener);
		sessionStorage.removeItem("vb:adminChatTarget");
	});

	it("wires Author controls to the users tab with the author preselected", async () => {
		const listener = vi.fn();
		window.addEventListener("vb:admin-tab", listener);
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Author controls" }));
		expect(sessionStorage.getItem("vb:adminUserTarget")).toBe("anon_alpha");
		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({ detail: "users" }),
			);
		});
		window.removeEventListener("vb:admin-tab", listener);
		sessionStorage.removeItem("vb:adminUserTarget");
	});

	it("shows Convert to project only for suggestions", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="suggestion" />);
		await screen.findByText("Suggestions");
		await user.click(screen.getByText("Add a nap room"));

		await user.click(screen.getByRole("button", { name: "Convert to project" }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_2",
				type: "problem",
				status: "in_progress",
				status_note: "Accepted as project",
			});
		});
	});

	it("merges live-refresh rows without crashing when getFresh fails", async () => {
		mocks.getFresh.mockRejectedValue(new Error("stale"));
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		// transient failure keeps current rows
		expect(screen.getByText("Add a nap room")).toBeInTheDocument();
	});
});

// ══════════════════════════════════════════════════════════════════
// Filters must reach the SERVER, not just the loaded page.
//
// The table pages 30 rows at a time. Filtering in the browser therefore
// only ever filtered the rows that happened to be loaded: choosing
// "Today" searched the 30 most recent posts of all time, so the date
// filter appeared broken and the row counts it reported were not real
// totals. These tests pin the contract that every filter is sent as a
// query param, and that changing one refetches from the first page.
// ══════════════════════════════════════════════════════════════════
describe("PostsTable — filters run server-side", () => {
	/**
	 * Drive the table's real fetcher and return the filter params it sends.
	 * Calling the captured fetcher (rather than the hook) is what makes this
	 * an assertion about the request, not about rendered markup.
	 */
	const sentFilters = async () => {
		mocks.paginated.mockClear();
		await mocks.fetchFn?.({ cursor: null, limit: 30 });
		const params = mocks.paginated.mock.calls[0]?.[1] as {
			query?: Record<string, string | null>;
		};
		return params?.query ?? {};
	};

	it("sends no filter params on an unfiltered load", async () => {
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const q = await sentFilters();
		expect(q.status).toBeNull();
		expect(q.category).toBeNull();
		expect(q.priority).toBeNull();
		expect(q.q).toBeNull();
		expect(q.from).toBeNull();
		expect(q.to).toBeNull();
	});

	it("sends the date range as ISO bounds so the server can filter", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.selectOptions(
			screen.getByLabelText("Filter by date range"),
			"last_30_days",
		);

		const q = await sentFilters();
		expect(q.from).toBeTruthy();
		expect(q.to).toBeTruthy();
		const from = new Date(q.from as string).getTime();
		const to = new Date(q.to as string).getTime();
		const days = (to - from) / 86_400_000;
		// ~30-day window (the upper bound is padded by a day on purpose).
		expect(days).toBeGreaterThan(30);
		expect(days).toBeLessThan(33);
	});

	it("sends status, category and priority as server params", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.selectOptions(
			screen.getByLabelText("Filter by status"),
			"solved",
		);
		expect((await sentFilters()).status).toBe("solved");

		await user.selectOptions(
			screen.getByLabelText("Filter by category"),
			"Academics",
		);
		expect((await sentFilters()).category).toBe("Academics");

		await user.selectOptions(
			screen.getByLabelText("Filter by priority"),
			"high",
		);
		expect((await sentFilters()).priority).toBe("high");
	});

	it("debounces search before it reaches the server", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.type(screen.getByPlaceholderText(/search/i), "lift");

		// Immediately after typing the debounce has not elapsed, so the
		// request still carries no term — typing does not fire a request
		// per keystroke.
		expect((await sentFilters()).q).toBeNull();

		await waitFor(
			async () => {
				expect((await sentFilters()).q).toBe("lift");
			},
			{ timeout: 2000 },
		);
	});
});

describe("PostsTable — realtime refresh stability", () => {
	// THE DELETE GLITCH: deleting a row shifts the server page-1 boundary up
	// by one, so the refreshed page contains an OLDER post the admin has never
	// seen. The merge classified "unknown to this list" as "brand new" and
	// prepended it — so after every delete a random old post teleported in
	// from the top (or parked and popped in later). Backfill belongs at the
	// BOTTOM, where it actually sits in the feed.
	it("appends page-boundary backfill after a delete instead of prepending it", async () => {
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		const OLDER = {
			...POST2,
			id: "post_older",
			title: "Older unseen post",
			created_at: "2026-06-01T10:00:00.000Z",
		};
		mocks.getFresh.mockResolvedValue({
			data: [{ ...POST }, { ...POST2 }, OLDER],
			total: 3,
		});
		mocks.setItems.mockClear();
		await act(async () => {
			await mocks.realtimeCb?.();
		});
		// Realtime only raises the badge now — the admin pulls the snapshot
		// explicitly. Drive the merge through the manual Refresh button.
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Refresh list" }));
		await waitFor(() => {
			expect(mocks.setItems).toHaveBeenCalled();
		});
		const arrays = mocks.setItems.mock.calls
			.map((c) => c[0])
			.filter((a): a is unknown[] => Array.isArray(a));
		const merged = arrays.at(-1) as { id: string }[];
		expect(merged[0]?.id).toBe("post_1");
		expect(merged[merged.length - 1]?.id).toBe("post_older");
	});

	it("prepends a genuinely newer post at the top", async () => {
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		const NEWER = {
			...POST,
			id: "post_new",
			title: "Just submitted",
			created_at: "2026-08-01T10:00:00.000Z",
		};
		mocks.getFresh.mockResolvedValue({
			data: [NEWER, { ...POST }, { ...POST2 }],
			total: 3,
		});
		mocks.setItems.mockClear();
		await act(async () => {
			await mocks.realtimeCb?.();
		});
		// Badge first, explicit pull second — same Refresh-button path.
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Refresh list" }));
		await waitFor(() => {
			expect(mocks.setItems).toHaveBeenCalled();
		});
		const arrays = mocks.setItems.mock.calls
			.map((c) => c[0])
			.filter((a): a is unknown[] => Array.isArray(a));
		const merged = arrays.at(-1) as { id: string }[];
		expect(merged[0]?.id).toBe("post_new");
	});

	it("refetches with the active filter chain so rows and totals never jump", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.selectOptions(
			screen.getByLabelText("Filter by status"),
			"in_progress",
		);
		await user.selectOptions(
			screen.getByLabelText("Filter by priority"),
			"high",
		);
		await user.selectOptions(
			screen.getByLabelText("Filter by date range"),
			"last_30_days",
		);

		mocks.getFresh.mockClear();
		await act(async () => {
			await mocks.realtimeCb?.();
		});
		// The explicit pull carries the filters — realtime alone fetches nothing.
		await user.click(screen.getByRole("button", { name: "Refresh list" }));
		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalled();
		});

		const url = String(mocks.getFresh.mock.calls.at(-1)?.[0] ?? "");
		expect(url).toContain("status=in_progress");
		expect(url).toContain("priority=high");
		expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}T/);
		expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}T/);
	});

	it("never resurrects a hard-deleted row on realtime refresh", async () => {
		const user = userEvent.setup();
		const { rerender } = render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: "Permanently delete" }));
		await user.click(
			within(
				screen.getByRole("dialog", { name: 'Permanently delete "Broken lift in block C"?' }),
			).getByRole("button", { name: "Delete forever" }),
		);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/posts?id=post_1", { id: "post_1" });
		});
		// Production state after delete: row filtered out of the list.
		mocks.items = [POST2];
		rerender(<PostsTable type="problem" />);
		await screen.findByText("Add a nap room");
		// The server still returns the deleted row (stale read / lag), as
		// fresh objects the way a real JSON response would — plus one
		// legitimate change so the refresh has real work to apply.
		mocks.getFresh.mockResolvedValue({
			data: [{ ...POST }, { ...POST2, title: "Edited title" }],
			total: 2,
		});
		mocks.setItems.mockClear();
		expect(mocks.realtimeCb).toBeTypeOf("function");
		await act(async () => {
			await mocks.realtimeCb?.();
		});
		await user.click(screen.getByRole("button", { name: "Refresh list" }));
		await waitFor(() => {
			expect(mocks.setItems).toHaveBeenCalled();
		});
		const arrays = mocks.setItems.mock.calls
			.map((c) => c[0])
			.filter((a) => Array.isArray(a));
		expect(arrays.length).toBeGreaterThan(0);
		for (const arr of arrays) {
			expect(arr.find((p: { id: string }) => p.id === "post_1")).toBeUndefined();
		}
	});

	it("parks newcomers behind a pill while scrolled deep instead of prepending", async () => {
		Object.defineProperty(window, "scrollY", {
			configurable: true,
			value: 800,
		});
		try {
			render(<PostsTable type="problem" />);
			await screen.findByText("Broken lift in block C");
			const POST3 = { ...POST2, id: "post_3", title: "Brand new post" };
			mocks.getFresh.mockResolvedValue({ data: [POST3, POST, POST2], total: 3 });
			await act(async () => {
				await mocks.realtimeCb?.();
			});
			// The badge appears first; "View updates" pulls the snapshot, and
			// the deep-scroll park logic holds the row behind the pill.
			await userEvent
				.setup()
				.click(screen.getByRole("button", { name: /View 1 new update/ }));
			// Pill appears with the parked count; the row is NOT injected.
			expect(
				await screen.findByRole("button", { name: /1 new post/ }, { timeout: 3000 }),
			).toBeInTheDocument();
			expect(screen.queryByText("Brand new post")).not.toBeInTheDocument();
			// Clicking the pill flushes the parked row to the top.
			await userEvent.setup().click(screen.getByRole("button", { name: /1 new post/ }));
			const updaters = mocks.setItems.mock.calls
				.map((c) => c[0])
				.filter((f) => typeof f === "function");
			expect(updaters.length).toBeGreaterThan(0);
			const last = updaters[updaters.length - 1] as (prev: typeof POST2[]) => typeof POST2[];
			const next = last([POST, POST2]);
			expect(next[0]).toMatchObject({ id: "post_3" });
		} finally {
			Object.defineProperty(window, "scrollY", {
				configurable: true,
				value: 0,
			});
		}
	});
});

// ══════════════════════════════════════════════════════════════════
// PostsTable — bulk delete contract (§7/§8: bulk ops are high-risk).
// Locks: only selected rows are removed; partial failures keep the
// failed rows and report honestly; tombstoned rows never resurrect on
// a stale realtime refresh after a bulk delete.
// ══════════════════════════════════════════════════════════════════
describe("PostsTable — bulk status", () => {
	it("reports partial success instead of silently clearing the selection", async () => {
		const user = userEvent.setup();
		mocks.put.mockImplementation((_path: string, body: { id?: string }) =>
			body.id === "post_1"
				? Promise.reject(new Error("protected"))
				: Promise.resolve({ status: "solved" }),
		);
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByRole("checkbox", { name: "Select all visible posts" }));
		await user.selectOptions(screen.getByLabelText("Bulk status change"), "solved");
		await user.click(screen.getByRole("button", { name: "Confirm status" }));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Updated 1 of 2 posts", "err");
		});
		expect(mocks.put).toHaveBeenCalledTimes(2);
	});
});

describe("PostsTable — bulk delete", () => {
	it("deletes only the selected rows and reports the honest count", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByRole("checkbox", { name: "Select Broken lift in block C" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.click(
			within(
				screen.getByRole("dialog", { name: "Delete 1 posts?" }),
			).getByRole("button", { name: "Delete all" }),
		);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/posts?id=post_1", { id: "post_1" });
		});
		expect(mocks.del).not.toHaveBeenCalledWith(
			expect.stringContaining("post_2"),
			expect.anything(),
		);
		expect(mocks.toast).toHaveBeenCalledWith("Deleted 1 of 1 posts", "ok");
	});

	it("deletes every selected row via select-all", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByRole("checkbox", { name: "Select all visible posts" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.click(
			within(
				screen.getByRole("dialog", { name: "Delete 2 posts?" }),
			).getByRole("button", { name: "Delete all" }),
		);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/posts?id=post_1", { id: "post_1" });
			expect(mocks.del).toHaveBeenCalledWith("/api/posts?id=post_2", { id: "post_2" });
		});
		expect(mocks.toast).toHaveBeenCalledWith("Deleted 2 of 2 posts", "ok");
	});

	it("keeps failed rows and reports partial failure honestly", async () => {
		const user = userEvent.setup();
		mocks.del.mockRejectedValueOnce(new Error("protected"));
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByRole("checkbox", { name: "Select all visible posts" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.click(
			within(
				screen.getByRole("dialog", { name: "Delete 2 posts?" }),
			).getByRole("button", { name: "Delete all" }),
		);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Deleted 1 of 2 posts", "err");
		});
	});

	it("never resurrects bulk-deleted rows on a stale realtime refresh", async () => {
		const user = userEvent.setup();
		const { rerender } = render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByRole("checkbox", { name: "Select Broken lift in block C" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.click(
			within(
				screen.getByRole("dialog", { name: "Delete 1 posts?" }),
			).getByRole("button", { name: "Delete all" }),
		);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/posts?id=post_1", { id: "post_1" });
		});
		// Production state after delete: row filtered out of the list.
		mocks.items = [POST2];
		rerender(<PostsTable type="problem" />);
		await screen.findByText("Add a nap room");
		// The server still returns the deleted row (stale read / lag).
		mocks.getFresh.mockResolvedValue({
			data: [{ ...POST }, POST2],
			total: 2,
		});
		mocks.setItems.mockClear();
		await act(async () => {
			await mocks.realtimeCb?.();
		});
		// Pull explicitly so the tombstone filter actually runs — without the
		// click this loop would assert over zero arrays and prove nothing.
		// Correct outcome here is NO list update at all: the stale deleted
		// row filters out and the merged list equals what is shown.
		await user.click(screen.getByRole("button", { name: "Refresh list" }));
		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument();
		});
		const arrays = mocks.setItems.mock.calls
			.map((c) => c[0])
			.filter((a) => Array.isArray(a));
		for (const arr of arrays) {
			expect(arr.find((p) => p.id === "post_1")).toBeUndefined();
		}
	});
});
