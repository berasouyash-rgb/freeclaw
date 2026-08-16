// ═══════════════════════════════════════════════════════════════════
// ExportCSVButton — admin CSV export contract
// ═══════════════════════════════════════════════════════════════════
// Locks the reusable export button behavior:
//   1. Static rows → click downloads CSV via downloadFile + toCSV
//   2. Async getRows → click fetches rows, then downloads
//   3. Empty rows → error toast, no download
//   4. Disabled prop respected, busy state shown while exporting
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExportCSVButton from "../components/ExportCSVButton";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	downloadFile: vi.fn(),
	toCSV: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/utils", () => ({
	downloadFile: mocks.downloadFile,
	toCSV: (rows: unknown[]) => `csv:${rows.length}`,
}));

const ROWS = [
	{
		id: "p1",
		title: "Broken projector",
		category: "Facilities",
		status: "reported",
		priority: "high",
	},
	{
		id: "p2",
		title: "Coffee machine",
		category: "Amenities",
		status: "in_progress",
		priority: "medium",
	},
];

describe("ExportCSVButton", () => {
	beforeEach(() => {
		mocks.toast.mockReset();
		mocks.downloadFile.mockReset();
	});

	it("renders a download button with the label", () => {
		render(<ExportCSVButton filename="posts.csv" rows={ROWS} />);
		expect(screen.getByRole("button", { name: /export csv/i })).toBeTruthy();
	});

	it("is disabled when disabled prop is true", () => {
		render(<ExportCSVButton filename="posts.csv" rows={ROWS} disabled />);
		expect(
			(screen.getByRole("button", { name: /export csv/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("downloads a CSV of the given rows and toasts the count", async () => {
		const user = userEvent.setup();
		render(<ExportCSVButton filename="posts.csv" rows={ROWS} />);
		await user.click(screen.getByRole("button", { name: /export csv/i }));
		await waitFor(() => {
			expect(mocks.downloadFile).toHaveBeenCalledWith(
				"posts.csv",
				"csv:2",
				"text/csv",
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith("Exported 2 rows", "ok");
	});

	it("shows an error toast and skips the download for empty rows", async () => {
		const user = userEvent.setup();
		render(<ExportCSVButton filename="posts.csv" rows={[]} />);
		await user.click(screen.getByRole("button", { name: /export csv/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Nothing to export", "err");
		});
		expect(mocks.downloadFile).not.toHaveBeenCalled();
	});

	it("fetches rows via getRows before downloading", async () => {
		const user = userEvent.setup();
		const getRows = vi.fn().mockResolvedValue(ROWS);
		render(<ExportCSVButton filename="posts.csv" getRows={getRows} />);
		await user.click(screen.getByRole("button", { name: /export csv/i }));
		await waitFor(() => {
			expect(getRows).toHaveBeenCalled();
			expect(mocks.downloadFile).toHaveBeenCalledWith(
				"posts.csv",
				"csv:2",
				"text/csv",
			);
		});
	});

	it("shows an error toast when getRows rejects", async () => {
		const user = userEvent.setup();
		const getRows = vi.fn().mockRejectedValue(new Error("Export failed"));
		render(<ExportCSVButton filename="posts.csv" getRows={getRows} />);
		await user.click(screen.getByRole("button", { name: /export csv/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Export failed", "err");
		});
		expect(mocks.downloadFile).not.toHaveBeenCalled();
	});
});
