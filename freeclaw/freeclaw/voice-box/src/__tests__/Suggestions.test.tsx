// ═══════════════════════════════════════════════════════════════════
// Suggestions feed — default behavior regression tests
// ═══════════════════════════════════════════════════════════════════
// Verifies:
//   • Default sort is "new" (not top)
//   • No "Open" status filter exists
//   • Status filter tabs are "All" and "Accepted" only
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSlow: vi.fn(async () => []),
	get: vi.fn(async () => []),
	post: vi.fn(async () => ({})),
}));

vi.mock("../lib/api", () => ({
	api: mocks,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "test-anon",
		bookmarks: [],
		toggleBookmark: vi.fn(),
		toast: vi.fn(),
		theme: "dark",
	}),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => {},
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSlow.mockResolvedValue([]);
	mocks.get.mockResolvedValue([]);
});

describe("Suggestions — default feed behavior", () => {
	it("renders without crashing", async () => {
		const { default: Suggestions } = await import("../pages/Suggestions");
		render(
			<MemoryRouter>
				<Suggestions />
			</MemoryRouter>,
		);
		expect(screen.getByText(/suggestions/i)).toBeInTheDocument();
	});

	it("does not show 'Open' in the status filter", async () => {
		const { default: Suggestions } = await import("../pages/Suggestions");
		render(
			<MemoryRouter>
				<Suggestions />
			</MemoryRouter>,
		);
		// All segmented buttons — none should say "Open"
		const allButtons = screen.getAllByRole("tab");
		const labels = allButtons.map((b) => b.textContent?.toLowerCase().trim());
		expect(labels).not.toContain("open");
	});

	it("shows 'All' and 'Accepted' as status filter options", async () => {
		const { default: Suggestions } = await import("../pages/Suggestions");
		render(
			<MemoryRouter>
				<Suggestions />
			</MemoryRouter>,
		);
		expect(screen.getByRole("tab", { name: /all/i })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /accepted/i })).toBeInTheDocument();
	});

	it("defaults to 'new' sort (Newest button is selected)", async () => {
		const { default: Suggestions } = await import("../pages/Suggestions");
		render(
			<MemoryRouter>
				<Suggestions />
			</MemoryRouter>,
		);
		const newestBtn = screen.getByRole("tab", { name: /newest/i });
		expect(newestBtn).toHaveAttribute("aria-selected", "true");
	});
});
