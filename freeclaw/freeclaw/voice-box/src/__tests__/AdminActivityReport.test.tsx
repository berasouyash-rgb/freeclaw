// ═══════════════════════════════════════════════════════════════════
// Admin Activity Report — audit summary contract
// ═══════════════════════════════════════════════════════════════════
// Locks the report's honesty guarantees:
//   1. Summary counts come from the rows the server returned, so the
//      summary and the full log can never disagree.
//   2. Period changes re-request with the new period and the same depth.
//   3. A failed load shows an error with a working retry — never an
//      empty report that reads as "no actions happened".
//   4. A truncated window says so instead of implying totality.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivityReport, {
	humanizeAction,
	tally,
} from "../pages/admin/ActivityReport";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	post: vi.fn(),
	downloadFile: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));
vi.mock("../lib/api", () => ({ api: { post: mocks.post } }));
vi.mock("../lib/utils", () => ({
	downloadFile: mocks.downloadFile,
	fmtDate: (v: string) => `ABS(${v})`,
	timeAgo: () => "2h ago",
}));

const ROWS = [
	{
		id: "1",
		actor: "admin",
		action: "update_user",
		detail: "suspended abc for 3 days",
		created_at: "2026-10-29T10:00:00Z",
	},
	{
		id: "2",
		actor: "admin",
		action: "update_user",
		detail: "lifted abc suspension",
		created_at: "2026-10-29T09:00:00Z",
	},
	{
		id: "3",
		actor: "moderation",
		action: "post_removed",
		detail: "spam",
		created_at: "2026-10-29T08:00:00Z",
	},
];

describe("admin activity report", () => {
	beforeEach(() => {
		mocks.toast.mockReset();
		mocks.post.mockReset();
		mocks.downloadFile.mockReset();
		mocks.post.mockResolvedValue({ logs: ROWS, truncated: false });
	});

	it("asks for admin accountability rows with an explicit depth", async () => {
		render(<ActivityReport />);
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
		expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
			action: "admin_accountability",
			period: "week",
			limit: 500,
		});
	});

	it("summarises the returned rows rather than a second request", async () => {
		render(<ActivityReport />);
		expect(await screen.findByText("Breakdown by action")).toBeTruthy();
		// 3 rows total, 2 of them update_user. "Update user" appears three
		// times by design: the most-frequent KPI, the breakdown row, and the
		// action-filter option that lets the admin narrow to it.
		expect(screen.getByText("3")).toBeTruthy();
		expect(screen.getAllByText("Update user")).toHaveLength(3);
		expect(screen.getAllByText("Post removed")).toHaveLength(2);
		expect(mocks.post).toHaveBeenCalledTimes(1);
	});

	it("refetches with the new period when the age filter changes", async () => {
		const user = userEvent.setup();
		render(<ActivityReport />);
		await screen.findByText("Breakdown by action");
		await user.click(screen.getByRole("tab", { name: "Today" }));
		await waitFor(() =>
			expect(mocks.post).toHaveBeenLastCalledWith("/api/admin", {
				action: "admin_accountability",
				period: "today",
				limit: 500,
			}),
		);
	});

	it("shows the chronological rows in the full view", async () => {
		const user = userEvent.setup();
		render(<ActivityReport />);
		await screen.findByText("Breakdown by action");
		await user.click(screen.getByRole("tab", { name: "Full log" }));
		expect(await screen.findByText("suspended abc for 3 days")).toBeTruthy();
		expect(screen.getAllByText("update_user")).toHaveLength(2);
		expect(screen.getByText("ABS(2026-10-29T10:00:00Z)")).toBeTruthy();
	});

	it("surfaces a failure with a retry that reloads", async () => {
		const user = userEvent.setup();
		mocks.post.mockRejectedValueOnce(new Error("admin API unreachable"));
		render(<ActivityReport />);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("admin API unreachable")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: /retry/i }));
		await waitFor(() =>
			expect(screen.getByText("Breakdown by action")).toBeTruthy(),
		);
	});

	it("says a window is truncated instead of implying it is complete", async () => {
		mocks.post.mockResolvedValue({ logs: ROWS, total: 900, truncated: true });
		render(<ActivityReport />);
		expect(
			await screen.findByText(/most recent of 900 matching actions/i),
		).toBeTruthy();
	});

	it("distinguishes an empty period from a failed load", async () => {
		mocks.post.mockResolvedValue({ logs: [], truncated: false });
		render(<ActivityReport />);
		expect(
			await screen.findByText(/No administrative actions recorded/i),
		).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("exports the rows it is showing", async () => {
		const user = userEvent.setup();
		render(<ActivityReport />);
		await screen.findByText("Breakdown by action");
		await user.click(screen.getByRole("button", { name: /csv/i }));
		expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
		const [name, body] = mocks.downloadFile.mock.calls[0]!;
		expect(name).toMatch(/^admin-activity-week-\d{4}-\d{2}-\d{2}\.csv$/);
		expect(body).toContain("update_user");
		expect(body.split("\n")).toHaveLength(ROWS.length + 1);
	});
});

describe("activity report helpers", () => {
	it("humanizes known and unknown actions without dropping either", () => {
		expect(humanizeAction("update_user")).toBe("Update user");
		expect(humanizeAction("revoke_all_sessions")).toBe("Revoke all sessions");
		expect(humanizeAction("brand_new_action")).toBe("Brand new action");
		expect(humanizeAction("")).toBe("Unlabelled action");
	});

	it("tallies deterministically by count then key", () => {
		expect(tally(ROWS, "action")).toEqual([
			{ key: "update_user", count: 2 },
			{ key: "post_removed", count: 1 },
		]);
		expect(tally(ROWS, "actor")).toEqual([
			{ key: "admin", count: 2 },
			{ key: "moderation", count: 1 },
		]);
	});

	it("counts blank actors as unknown rather than merging them into a name", () => {
		expect(
			tally([{ ...ROWS[0]!, actor: "" }], "actor"),
		).toEqual([{ key: "unknown", count: 1 }]);
	});
});
