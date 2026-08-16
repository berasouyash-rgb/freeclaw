// ═══════════════════════════════════════════════════════════════════
// QuickActions — announcement broadcast + one-click triage contract
// ═══════════════════════════════════════════════════════════════════
// Locks: announcement load/publish/clear, kind toggle, publish gating,
// triage queue (filter, sort, slice), verify/start wiring, empty state,
// error toasts.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickActions from "../pages/admin/QuickActions";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: mocks.post },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

const POSTS = [
	{
		id: "old-report",
		title: "Old broken lamp",
		type: "problem",
		status: "reported",
		hidden: false,
		deleted: false,
		created_at: "2026-06-01T10:00:00.000Z",
	},
	{
		id: "new-report",
		title: "Broken lift",
		type: "problem",
		status: "reported",
		hidden: false,
		deleted: false,
		created_at: "2026-07-01T10:00:00.000Z",
	},
	{
		id: "suggestion-post",
		title: "Add a nap room",
		type: "suggestion",
		status: "reported",
		hidden: false,
		deleted: false,
		created_at: "2026-07-02T10:00:00.000Z",
	},
	{
		id: "hidden-post",
		title: "Hidden spam",
		type: "problem",
		status: "reported",
		hidden: true,
		deleted: false,
		created_at: "2026-07-03T10:00:00.000Z",
	},
	{
		id: "deleted-post",
		title: "Deleted post",
		type: "problem",
		status: "reported",
		hidden: false,
		deleted: true,
		created_at: "2026-07-04T10:00:00.000Z",
	},
	{
		id: "working-post",
		title: "Already in progress",
		type: "problem",
		status: "in_progress",
		hidden: false,
		deleted: false,
		created_at: "2026-07-05T10:00:00.000Z",
	},
];

const onStatusChange = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue(null);
	mocks.post.mockResolvedValue({ value: { text: "hi", kind: "info" } });
});

function renderPage(posts = POSTS) {
	return render(
		<QuickActions posts={posts as any} onStatusChange={onStatusChange} />,
	);
}

describe("QuickActions — announcement broadcast", () => {
	it("loads an existing announcement and renders it with a remove button", async () => {
		mocks.get.mockResolvedValue({
			text: "Library hours extended",
			kind: "success",
		});
		renderPage();
		expect(await screen.findByText("Library hours extended")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Remove announcement" }),
		).toBeInTheDocument();
	});

	it("renders the composer when no announcement exists", async () => {
		renderPage();
		expect(
			await screen.findByLabelText("Quick action announcement text"),
		).toBeInTheDocument();
		expect(screen.getByPlaceholderText(/Library hours extended/)).toBeInTheDocument();
	});

	it("keeps Publish disabled for empty or whitespace-only text", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByLabelText("Quick action announcement text");
		const publish = screen.getByRole("button", { name: /Publish/ });
		expect(publish).toBeDisabled();

		await user.type(
			screen.getByLabelText("Quick action announcement text"),
			"   ",
		);
		expect(publish).toBeDisabled();
	});

	it("publishes an announcement via POST and shows the live banner", async () => {
		mocks.post.mockResolvedValue({
			value: { text: "Exam week schedule", kind: "info" },
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByLabelText("Quick action announcement text");

		await user.type(
			screen.getByLabelText("Quick action announcement text"),
			"Exam week schedule",
		);
		await user.click(screen.getByRole("button", { name: /Publish/ }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/announcement", {
				text: "Exam week schedule",
				kind: "info",
			});
		});
		expect(await screen.findByText("Exam week schedule")).toBeInTheDocument();
		expect(mocks.toast).toHaveBeenCalledWith(
			"Announcement is now live for everyone 📣",
			"ok",
		);
	});

	it("switches the announcement kind to warning and success", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByLabelText("Quick action announcement text");

		await user.click(screen.getByRole("button", { name: "warning" }));
		await user.click(screen.getByRole("button", { name: "success" }));
		await user.type(
			screen.getByLabelText("Quick action announcement text"),
			"Maintenance window",
		);
		await user.click(screen.getByRole("button", { name: /Publish/ }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/announcement", {
				text: "Maintenance window",
				kind: "success",
			});
		});
	});

	it("clears a live announcement via POST clear", async () => {
		mocks.get.mockResolvedValue({ text: "Old banner", kind: "info" });
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Old banner");

		await user.click(screen.getByRole("button", { name: "Remove announcement" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/announcement", {
				clear: true,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Announcement removed", "ok");
		expect(screen.queryByText("Old banner")).not.toBeInTheDocument();
	});

	it("toasts an error when publishing fails", async () => {
		mocks.post.mockRejectedValue(new Error("publish boom"));
		const user = userEvent.setup();
		renderPage();
		await screen.findByLabelText("Quick action announcement text");

		await user.type(
			screen.getByLabelText("Quick action announcement text"),
			"Will fail",
		);
		await user.click(screen.getByRole("button", { name: /Publish/ }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("publish boom", "err");
		});
	});

	it("tolerates a failed announcement load without crashing", async () => {
		mocks.get.mockRejectedValue(new Error("load boom"));
		renderPage();
		expect(
			await screen.findByLabelText("Quick action announcement text"),
		).toBeInTheDocument();
	});
});

describe("QuickActions — triage queue", () => {
	it("shows the caught-up empty state when nothing needs triage", async () => {
		renderPage([]);
		expect(
			await screen.findByText("All caught up — no new reports waiting. ✨"),
		).toBeInTheDocument();
	});

	it("lists only visible, unreviewed problem posts — excludes suggestions/hidden/deleted/in_progress", async () => {
		renderPage();
		await screen.findByText("Broken lift");
		expect(screen.getByText("Broken lift")).toBeInTheDocument();
		expect(screen.getByText("Old broken lamp")).toBeInTheDocument();
		// Excluded categories
		expect(screen.queryByText("Add a nap room")).not.toBeInTheDocument();
		expect(screen.queryByText("Hidden spam")).not.toBeInTheDocument();
		expect(screen.queryByText("Deleted post")).not.toBeInTheDocument();
		expect(screen.queryByText("Already in progress")).not.toBeInTheDocument();
	});

	it("orders the triage queue oldest-first", async () => {
		renderPage();
		await screen.findByText("Broken lift");
		const rows = screen.getAllByText(/Broken lift|Old broken lamp/);
		expect(rows[0]).toHaveTextContent("Old broken lamp");
		expect(rows[1]).toHaveTextContent("Broken lift");
	});

	it("shows the waiting count chip", async () => {
		renderPage();
		await screen.findByText("2 waiting");
	});

	it("wires Verify to onStatusChange(verified)", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken lift");

		// Row: the flex container wrapping the title + Verify + Start buttons
		const row = screen.getByText("Broken lift").closest(".flex") as HTMLElement;
		const verifyBtn = within(row)
			.getAllByRole("button")
			.find((b) => b.textContent?.includes("Verify")) as HTMLElement;
		await user.click(verifyBtn);
		expect(onStatusChange).toHaveBeenCalledWith("new-report", "verified");
	});

	it("wires Start to onStatusChange(in_progress)", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken lift");

		const row = screen.getByText("Broken lift").closest(".flex") as HTMLElement;
		const startBtn = within(row)
			.getAllByRole("button")
			.find((b) => b.textContent?.includes("Start")) as HTMLElement;
		await user.click(startBtn);
		expect(onStatusChange).toHaveBeenCalledWith("new-report", "in_progress");
	});

	it("caps the triage queue at 4 items", async () => {
		const many = Array.from({ length: 6 }, (_, i) => ({
			id: `r${i}`,
			title: `Report ${i}`,
			type: "problem",
			status: "reported",
			hidden: false,
			deleted: false,
			created_at: `2026-07-0${i + 1}T10:00:00.000Z`,
		}));
		renderPage(many as any);
		expect(await screen.findByText("4 waiting")).toBeInTheDocument();
		expect(screen.getByText("Report 3")).toBeInTheDocument();
		expect(screen.queryByText("Report 4")).not.toBeInTheDocument();
		expect(screen.queryByText("Report 5")).not.toBeInTheDocument();
	});
});
