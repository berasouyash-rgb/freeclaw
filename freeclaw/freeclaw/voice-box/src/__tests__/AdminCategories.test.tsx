// ═══════════════════════════════════════════════════════════════════
// Admin Categories — categories manager contract
// ═══════════════════════════════════════════════════════════════════
// Locks the admin categories manager behavior:
//   1. Loads the stored list from GET /api/categories
//   2. Add    → PUT /api/categories { categories: [...prev, name] }
//   3. Remove → PUT /api/categories without the chip
//   4. Reset  → PUT /api/categories with the default CATEGORIES
// Duplicate names are rejected locally without a PUT.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Categories from "../pages/admin/Categories";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));
vi.mock("../lib/api", () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock("../lib/utils", () => ({
	CATEGORIES: ["Default1", "Default2", "Default3"],
	CAT_EMOJI: { Academics: "A", Facilities: "F", Food: "F" },
}));

const STORED = ["Academics", "Facilities", "Food", "Security"];

describe("Admin Categories", () => {
	beforeEach(() => {
		mocks.toast.mockReset();
		mocks.get.mockReset();
		mocks.put.mockReset();
		mocks.get.mockResolvedValue({ categories: STORED });
		mocks.put.mockResolvedValue({ categories: STORED });
	});

	it("loads and displays the stored categories", async () => {
		render(<Categories />);
		expect(await screen.findByText(/Academics/)).toBeTruthy();
		expect(screen.getByText(/Facilities/)).toBeTruthy();
		expect(screen.getByText(/Food/)).toBeTruthy();
	});

	it("adds a category and persists via PUT", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		await user.type(screen.getByPlaceholderText(/category name/i), "NewCat");
		mocks.put.mockResolvedValue({ categories: [...STORED, "NewCat"] });
		await user.click(screen.getByRole("button", { name: /add/i }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/categories", {
				categories: ["Academics", "Facilities", "Food", "Security", "NewCat"],
			});
		});
		expect(await screen.findByText(/NewCat/)).toBeTruthy();
		expect(mocks.toast).toHaveBeenCalledWith("Categories saved", "ok");
	});

	it("rejects a duplicate category without a PUT", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		await user.type(screen.getByPlaceholderText(/category name/i), "academics");
		await user.click(screen.getByRole("button", { name: /add/i }));
		expect(mocks.put).not.toHaveBeenCalled();
		expect(mocks.toast).toHaveBeenCalledWith("Category already exists", "err");
	});

	it("removes a category via PUT", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		mocks.put.mockResolvedValue({ categories: ["Facilities", "Food"] });
		await user.click(screen.getByRole("button", { name: /remove academics/i }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/categories", {
				categories: ["Facilities", "Food", "Security"],
			});
		});
	});

	it("resets to the defaults via PUT", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		await user.click(
			screen.getByRole("button", { name: /reset to defaults/i }),
		);
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/categories", {
				categories: ["Default1", "Default2", "Default3"],
			});
		});
	});

	it("toasts when the initial load fails", async () => {
		mocks.get.mockRejectedValue(new Error("categories down"));
		render(<Categories />);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("categories down", "err");
		});
	});

	it("toasts when the initial load fails with a non-Error", async () => {
		mocks.get.mockRejectedValue("plain failure");
		render(<Categories />);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Could not load categories",
				"err",
			);
		});
	});

	it("rejects saving fewer than 3 categories without a PUT", async () => {
		const user = userEvent.setup();
		mocks.get.mockResolvedValue({ categories: ["Only", "Two"] });
		render(<Categories />);
		await screen.findByText(/Only/);

		await user.click(screen.getByRole("button", { name: /remove only/i }));
		await waitFor(() => {
			expect(mocks.put).not.toHaveBeenCalled();
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"At least 3 categories are required",
			"err",
		);
	});

	it("toasts when saving fails", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		mocks.put.mockRejectedValue(new Error("save down"));
		await user.type(screen.getByPlaceholderText(/category name/i), "NewCat");
		await user.click(screen.getByRole("button", { name: /add/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("save down", "err");
		});
	});

	it("toasts when saving fails with a non-Error", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		mocks.put.mockRejectedValue("plain failure");
		await user.type(screen.getByPlaceholderText(/category name/i), "NewCat");
		await user.click(screen.getByRole("button", { name: /add/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Could not save categories",
				"err",
			);
		});
	});

	it("ignores the Enter key when the name is blank", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		const input = screen.getByPlaceholderText(/category name/i);
		await user.type(input, "{Enter}");
		expect(mocks.put).not.toHaveBeenCalled();
	});

	it("adds via the Enter key on the input", async () => {
		const user = userEvent.setup();
		render(<Categories />);
		await screen.findByText(/Academics/);
		mocks.put.mockResolvedValue({ categories: [...STORED, "EnterCat"] });
		await user.type(
			screen.getByPlaceholderText(/category name/i),
			"EnterCat{Enter}",
		);
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/categories", {
				categories: ["Academics", "Facilities", "Food", "Security", "EnterCat"],
			});
		});
		expect(await screen.findByText(/EnterCat/)).toBeTruthy();
	});
});
