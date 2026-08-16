// ═══════════════════════════════════════════════════════════════════
// Saved page — server-persisted bookmarks
// ═══════════════════════════════════════════════════════════════════
// Locks the /saved contract:
//   1. Shows every bookmarked post (ids from useApp().bookmarks).
//   2. Empty state when there are no saved posts.
//   3. "Remove" on a card untoggles the bookmark.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Saved from "../pages/Saved";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	bookmarks: ["p1", "p2"] as string[],
	toggleBookmark: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		bookmarks: mocks.bookmarks,
		toggleBookmark: mocks.toggleBookmark,
	}),
}));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "2d ago",
	CAT_EMOJI: { Facilities: "🏫" },
	STATUS_META: { reported: { label: "Reported", color: "#888", pct: 5 } },
	PRIORITY_META: { medium: { label: "Medium", color: "#888" } },
	trendingScore: () => 0,
}));

vi.mock("../components/PostCard", () => ({
	__esModule: true,
	default: ({
		post,
		onReacted,
	}: {
		post: { id: string; title: string; description: string };
		onReacted?: () => void;
	}) => (
		<article>
			<h3>{post.title}</h3>
			<p>{post.description}</p>
			<button onClick={onReacted}>react</button>
		</article>
	),
}));

const POSTS = [
	{
		id: "p1",
		type: "problem",
		title: "Broken projector",
		description: "Needs fixing",
		category: "Facilities",
		priority: "medium",
		status: "reported",
		reactions: {},
		comment_count: 0,
		created_at: "2026-07-01T10:00:00.000Z",
	},
	{
		id: "p2",
		type: "problem",
		title: "Cafeteria food",
		description: "Cold again",
		category: "Food",
		priority: "medium",
		status: "reported",
		reactions: {},
		comment_count: 0,
		created_at: "2026-07-01T10:00:00.000Z",
	},
];

function renderPage() {
	return render(
		<MemoryRouter>
			<Saved />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.bookmarks.splice(0, mocks.bookmarks.length, "p1", "p2");
});

describe("Saved — post list", () => {
	it("loads and shows every saved post", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts?ids=")) return Promise.resolve([...POSTS]);
			return Promise.resolve([]);
		});
		renderPage();

		await screen.findByText("Broken projector");
		expect(screen.getByText("Cafeteria food")).toBeInTheDocument();
		expect(mocks.get).toHaveBeenCalledWith(
			expect.stringContaining("/api/posts?ids="),
		);
	});
});

describe("Saved — empty state", () => {
	it("shows an empty state when nothing is bookmarked", async () => {
		mocks.bookmarks.splice(0, mocks.bookmarks.length);
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts?ids=")) return Promise.resolve([]);
			return Promise.resolve([]);
		});
		renderPage();

		await screen.findByText(/nothing saved/i);
	});
});

describe("Saved — remove", () => {
	it("unbookmarks a post when Remove is clicked", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts?ids=")) return Promise.resolve([...POSTS]);
			return Promise.resolve([]);
		});
		const user = userEvent.setup();
		renderPage();

		await screen.findByText("Broken projector");
		const remove = screen.getAllByRole("button", { name: /remove/i })[0];
		await user.click(remove as HTMLElement);

		await waitFor(() => {
			expect(mocks.toggleBookmark).toHaveBeenCalledWith("p1");
		});
		expect(mocks.toast).toHaveBeenCalledWith("Removed from saved", "ok");
	});
});

describe("Saved — load failure and retry", () => {
	it("shows the error message and reloads via Retry", async () => {
		mocks.get.mockRejectedValueOnce(new Error("saved posts down"));
		const user = userEvent.setup();
		renderPage();

		await screen.findByText("saved posts down");
		expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();

		// Retry succeeds and renders the posts
		mocks.get.mockResolvedValueOnce([...POSTS]);
		await user.click(screen.getByRole("button", { name: /retry/i }));
		await screen.findByText("Broken projector");
	});

	it("falls back to a generic message when the error is not an Error", async () => {
		mocks.get.mockRejectedValueOnce("plain string failure");
		renderPage();

		await screen.findByText("Could not load saved posts");
	});
});

describe("Saved — refresh when posts are missing", () => {
	it("shows the refresh card and reloads when clicked", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts?ids=")) return Promise.resolve([]);
			return Promise.resolve([]);
		});
		const user = userEvent.setup();
		renderPage();

		// bookmarks exist but the fetch returned nothing
		await screen.findByText(/loading or have been removed/i);
		mocks.get.mockResolvedValueOnce([...POSTS]);
		await user.click(screen.getByRole("button", { name: /refresh/i }));
		await screen.findByText("Broken projector");
	});
});

describe("Saved — reaction reload", () => {
	it("reloads the list when a post reaction fires", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts?ids=")) return Promise.resolve([...POSTS]);
			return Promise.resolve([]);
		});
		const user = userEvent.setup();
		renderPage();

		await screen.findByText("Broken projector");
		const callsBefore = mocks.get.mock.calls.length;
		const reactBtn = screen.getAllByRole("button", { name: /^react$/i })[0]!;
		await user.click(reactBtn);

		await waitFor(() => {
			expect(mocks.get.mock.calls.length).toBeGreaterThan(callsBefore);
		});
	});
});
