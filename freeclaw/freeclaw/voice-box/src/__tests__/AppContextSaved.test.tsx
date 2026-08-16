// ═══════════════════════════════════════════════════════════════════
// AppContext — server-persisted bookmarks (saved posts)
// ═══════════════════════════════════════════════════════════════════
// Locks the saved-posts sync contract:
//   1. On mount the provider fetches /api/saved?user_id and merges the
//      server list into local bookmarks.
//   2. toggleBookmark persists the change to /api/saved (fire-and-forget).
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../contexts/AppContext";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	lsSet: vi.fn(),
}));

vi.mock("../lib/identity", () => ({
	getAnonId: () => "anon-test",
	getDisplayName: () => "",
	setDisplayName: () => {},
	getProfile: () => ({ avatar: "", bio: "" }),
	setProfile: (p: { avatar?: string; bio?: string }) => p,
	lsGet: (_k: string, d: unknown) => d,
	lsSet: mocks.lsSet,
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: mocks.post },
}));

function Probe() {
	const { bookmarks, toggleBookmark } = useApp();
	return (
		<div>
			<span data-testid="bookmark-count">{bookmarks.length}</span>
			<button onClick={() => toggleBookmark("p1")}>toggle</button>
		</div>
	);
}

beforeAll(() => {
	if (!window.matchMedia) {
		// @ts-expect-error jsdom stub
		window.matchMedia = () => ({
			matches: false,
			addListener: () => {},
			removeListener: () => {},
		});
	}
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockImplementation((url: string) => {
		if (url.includes("/api/saved"))
			return Promise.resolve({ saved: ["s1", "s2"], count: 2 });
		return Promise.resolve({});
	});
	mocks.post.mockResolvedValue({});
});

describe("AppProvider — saved posts sync", () => {
	it("merges the server saved list into bookmarks on mount", async () => {
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);

		await waitFor(() => {
			expect(mocks.get).toHaveBeenCalledWith(
				expect.stringContaining("/api/saved?user_id=anon-test"),
			);
		});
		await waitFor(() => {
			expect(screen.getByTestId("bookmark-count")).toHaveTextContent("2");
		});
	});

	it("persists a bookmark toggle to /api/saved", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);

		// Wait for initial merge (s1, s2) so the toggle computes the right direction
		await waitFor(() => {
			expect(screen.getByTestId("bookmark-count")).toHaveTextContent("2");
		});

		await user.click(screen.getByRole("button", { name: /toggle/i }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/saved",
				expect.objectContaining({
					user_id: "anon-test",
					post_id: "p1",
					saved: true,
				}),
			);
		});
		expect(screen.getByTestId("bookmark-count")).toHaveTextContent("3");
	});
});
