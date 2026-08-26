// ═══════════════════════════════════════════════════════════════════
// Advanced Search page — /search
// ═══════════════════════════════════════════════════════════════════
// Locks the contract:
//   1. Renders the search input + type/category/status filters.
//   2. Submitting a query calls /api/search and renders post results
//      (linked to /post/:id).
//   3. Empty results → "No results" state.
//   4. Server error → error message with Retry.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Search from "../pages/Search";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	toast: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "2d ago",
	CATEGORIES: ["Academics", "Facilities"],
	CAT_EMOJI: { Facilities: "🏫" },
	STATUS_META: {
		reported: { label: "Reported", color: "#888", pct: 5 },
		solved: { label: "Solved", color: "#16a06a", pct: 100 },
	},
	PRIORITY_META: { medium: { label: "Medium", color: "#888" } },
}));

const POST_RESULT = {
	type: "post",
	id: "p1",
	title: "Broken projector",
	description: "Needs fixing in room 3",
	category: "Facilities",
	status: "reported",
	priority: "medium",
	created_at: "2026-07-01T10:00:00.000Z",
	relevance_score: 4,
};
const COMMENT_RESULT = {
	type: "comment",
	id: "c1",
	post_id: "p1",
	body: "Also happens in room 5",
	created_at: "2026-07-01T10:00:00.000Z",
	relevance_score: 1,
};
const POLL_RESULT = {
	type: "poll",
	id: "pl1",
	title: "Best cafe",
	ptype: "single",
	category: "Facilities",
	created_at: "2026-07-01T10:00:00.000Z",
	relevance_score: 2,
};

function renderPage() {
	return render(
		<MemoryRouter>
			<Search />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue({
		results: [],
		total: 0,
		query: "",
		page: 1,
		pages: 0,
	});
});

describe("Search — filters render", () => {
	it("renders the input and all filter selects", () => {
		renderPage();
		expect(screen.getByLabelText(/search everything/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/filter by type/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/filter by category/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/filter by status/i)).toBeInTheDocument();

	});
});

describe("Search — query flow", () => {
	it("submits a query and renders post results linked to /post/:id", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/search")) {
				return Promise.resolve({
					results: [POST_RESULT],
					total: 1,
					query: "projector",
					page: 1,
					pages: 1,
				});
			}
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		renderPage();

		await user.type(screen.getByLabelText(/search everything/i), "projector");
		await user.keyboard("{Enter}");

		await screen.findByText("Broken projector");
		expect(screen.getByText(/1 result/i)).toBeInTheDocument();
		expect(mocks.get).toHaveBeenCalledWith(
			expect.stringContaining("/api/search?q=projector"),
		);
		expect(
			screen.getByRole("link", { name: /broken projector/i }),
		).toHaveAttribute("href", "/post/p1");
	});

	it("renders comment results linked to the parent post", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/search")) {
				return Promise.resolve({
					results: [COMMENT_RESULT],
					total: 1,
					query: "room",
					page: 1,
					pages: 1,
				});
			}
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		renderPage();

		await user.type(screen.getByLabelText(/search everything/i), "room");
		await user.keyboard("{Enter}");

		await screen.findByText(/also happens in room 5/i);
		expect(
			screen.getByRole("link", { name: /also happens in room 5/i }),
		).toHaveAttribute("href", "/post/p1");
	});

	it("passes selected filters to the API", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.type(screen.getByLabelText(/search everything/i), "food");
		await user.selectOptions(screen.getByLabelText(/filter by type/i), "posts");
		await user.selectOptions(
			screen.getByLabelText(/filter by status/i),
			"solved",
		);
		await waitFor(() => {
			const searchCalls = mocks.get.mock.calls.filter(([u]) =>
				String(u).includes("/api/search"),
			);
			expect(searchCalls.length).toBeGreaterThan(0);
			const url = String(searchCalls[searchCalls.length - 1]?.[0] ?? "");
			expect(url).toContain("type=posts");
			expect(url).toContain("status=solved");
		});
	});

	it("passes the selected category filter to the API", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.type(screen.getByLabelText(/search everything/i), "food");
		await user.selectOptions(
			screen.getByLabelText(/filter by category/i),
			"Academics",
		);

		await waitFor(() => {
			const searchCalls = mocks.get.mock.calls.filter(([u]) =>
				String(u).includes("/api/search"),
			);
			expect(searchCalls.length).toBeGreaterThan(0);
			expect(String(searchCalls[searchCalls.length - 1]?.[0] ?? "")).toContain(
				"category=Academics",
			);
		});
	});

	it("renders poll results linked to /polls and counts them in the tiles", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (String(url).includes("/api/search")) {
				return Promise.resolve({
					results: [POLL_RESULT],
					total: 1,
					query: "cafe",
					page: 1,
					pages: 1,
				});
			}
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		renderPage();

		await user.type(screen.getByLabelText(/search everything/i), "cafe");
		await user.keyboard("{Enter}");

		await screen.findByText("Best cafe");
		expect(screen.getByRole("link", { name: /best cafe/i })).toHaveAttribute(
			"href",
			"/polls",
		);
		// Polls stat tile is rendered with its count (the type-filter option "Polls" is also on page, so disambiguate by card content)
		expect(
			screen
				.getAllByText("Polls")
				.some((el) => el.closest(".card")?.textContent?.includes("1")),
		).toBe(true);
	});
});

describe("Search — empty and error states", () => {
	it("shows a no-results state when nothing matches", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.type(screen.getByLabelText(/search everything/i), "zzz");
		await user.keyboard("{Enter}");

		await screen.findByText(/no results/i);
	});

	it("shows an error with a working retry", async () => {
		// Only the search call fails; the mount-time categories fetch stays benign.
		mocks.get.mockImplementation((url: string) =>
			String(url).includes("/api/search")
				? Promise.reject(new Error("Search is down"))
				: Promise.resolve({ categories: undefined }),
		);
		const user = userEvent.setup();
		renderPage();

		await user.type(screen.getByLabelText(/search everything/i), "projector");
		await user.keyboard("{Enter}");

		await screen.findByText(/search is down/i);
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

		// Retry recovers on the second attempt
		mocks.get.mockImplementation((url: string) =>
			String(url).includes("/api/search")
				? Promise.resolve({
						results: [POST_RESULT],
						total: 1,
						query: "projector",
						page: 1,
						pages: 1,
					})
				: Promise.resolve({}),
		);
		await user.click(screen.getByRole("button", { name: /retry/i }));
		await screen.findByText("Broken projector");
	});
});
