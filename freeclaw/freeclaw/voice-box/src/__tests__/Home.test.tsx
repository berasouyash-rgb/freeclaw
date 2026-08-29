// ═══════════════════════════════════════════════════════════════════
// Home feed — default behavior regression tests
// ═══════════════════════════════════════════════════════════════════
// Verifies:
//   • Default sort is "newest" (not trending)
//   • No "open" status filter tab exists
//   • Status filter tabs are "all" and "solved" only
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	get: vi.fn(async () => []),
	getSlow: vi.fn(async () => []),
	getSlowFresh: vi.fn(async () => []),
	getFresh: vi.fn(async () => []),
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

vi.mock("../hooks/useCategories", () => ({
	useCategories: () => ["Facilities", "Academics"],
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => {},
}));

// Lazy-loaded components that need mocking
vi.mock("../components/CountUp", () => ({
	default: ({ children }: { children: number }) => <span>{children}</span>,
}));
vi.mock("../components/GlowButton", () => ({
	default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
		<button {...props}>{children}</button>
	),
}));
vi.mock("../components/PostCard", () => ({
	default: ({ post }: { post: { title: string } }) => (
		<article data-testid="post-card">{post.title}</article>
	),
	PostCard: ({ post }: { post: { title: string } }) => (
		<article data-testid="post-card">{post.title}</article>
	),
}));
vi.mock("../components/RecapCard", () => ({
	default: () => <div data-testid="recap-card" />,
}));
vi.mock("../components/Trend", () => ({
	default: () => <div />,
	Sparkline: () => <div />,
}));
vi.mock("../components/WordCloud", () => ({
	default: () => <div />,
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSlow.mockResolvedValue([]);
	mocks.getSlowFresh.mockResolvedValue([]);
	mocks.get.mockResolvedValue([]);
	mocks.getFresh.mockResolvedValue([]);
});

// We can't easily render the full Home page with all its lazy imports,
// so we test the behavior by examining the module's exported defaults.
// Instead, we import the component and check its initial state via rendering.

describe("Home — default feed behavior", () => {
	it("renders without crashing", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		// Should render the hero section at minimum
		expect(screen.getByText(/speak up/i)).toBeInTheDocument();
	});

	it("does not show 'Open' in the status filter tabs", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		// The status filter should only have "all" and "solved" — no "open"
		const allTabs = screen.getAllByRole("tab");
		const tabLabels = allTabs.map((t) => t.textContent?.toLowerCase().trim());
		expect(tabLabels).not.toContain("open");
	});

	it("shows 'All' and 'Solved' as status filter options", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		expect(screen.getByRole("tab", { name: /all/i })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /solved/i })).toBeInTheDocument();
	});

	it("defaults to 'newest' sort (newest button is selected)", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		// The sort segmented control should have "Newest" selected
		const newestBtn = screen.getByRole("tab", { name: /newest/i });
		expect(newestBtn).toHaveAttribute("aria-selected", "true");
	});
});
