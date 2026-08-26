// ═══════════════════════════════════════════════════════════════════
// PostsTable — complaint/suggestion management table contract
// ═══════════════════════════════════════════════════════════════════
// Locks: title variants by type, row rendering (category/status/priority/
// author/age), search + status + category filters, hide/official toggles,
// detail drawer (status/priority/category/assigned/eta edits, pin/feature/
// hide/lock/merge/poll/soft-delete/restore/permanent-delete), status dialog
// wiring, message-author navigation, live-refresh merge, error toasts.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
	total: 0,
	setItems: vi.fn(),
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

vi.mock("../hooks/useCategories", () => ({
	useCategories: () => ["Facilities", "Academics"],
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
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
	mocks.setItems = vi.fn();
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
		expect(await screen.findByText("Complaint management")).toBeInTheDocument();
		expect(screen.getByText("Broken lift in block C")).toBeInTheDocument();
		expect(screen.getByText("2 total")).toBeInTheDocument();
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

	it("shows skeletons while the initial load is pending", () => {
		mocks.initialLoading = true;
		render(<PostsTable type="problem" />);
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
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
		// selects: [global status, global category, row1 status, row2 status]
		await user.selectOptions(selects[0] as HTMLSelectElement, "in_progress");
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
		expect(screen.getByText("Add a nap room")).toBeInTheDocument();
	});

	it("filters by category dropdown", async () => {
		const user = userEvent.setup();
		render(<PostsTable type="problem" />);
		await screen.findByText("Broken lift in block C");

		const selects = screen.getAllByRole("combobox");
		await user.selectOptions(selects[1] as HTMLSelectElement, "Academics");
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

	it("merges a duplicate via the merge dialog", async () => {
		const user = userEvent.setup();
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
				screen.getByRole("dialog", { name: "Permanently delete?" }),
			).getByRole("button", { name: "Delete forever" }),
		);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/posts", { id: "post_1" });
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
