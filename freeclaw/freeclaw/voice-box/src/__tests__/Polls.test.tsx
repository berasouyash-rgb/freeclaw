// Polls page — /polls
// Locks:
//   1. Duplicate same-question rows collapse to one card (highest votes).
//   2. Vote/delete actions and Refresh re-read fresh (never stale cache).
//   3. Active / Ended tabs filter by expiry.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Polls from "../pages/Polls";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	getFresh: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ anonId: "anon-test", toast: vi.fn() }),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, getFresh: mocks.getFresh, post: vi.fn() },
	hasAdminSession: () => false,
}));

function poll(over: Record<string, unknown> = {}) {
	return {
		id: `poll_${Math.random().toString(36).slice(2, 8)}`,
		title: "Best canteen dish?",
		ptype: "single",
		options: ["Biryani", "Noodles"],
		total_votes: 3,
		vote_counts: { 0: 2, 1: 1 },
		created_at: "2026-09-01T00:00:00.000Z",
		expires_at: null,
		archived: false,
		deleted: false,
		...over,
	};
}

function renderPage() {
	return render(
		<MemoryRouter>
			<Polls />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockImplementation((url: string) => {
		if (String(url).includes("voter=")) return Promise.resolve([]);
		return Promise.resolve([poll({ id: "a" })]);
	});
	mocks.getFresh.mockImplementation((url: string) => {
		if (String(url).includes("voter=")) return Promise.resolve([]);
		return Promise.resolve([poll({ id: "a" })]);
	});
});

describe("Polls page", () => {
	it("renders the poll list", async () => {
		renderPage();
		expect(await screen.findByText("Best canteen dish?")).toBeInTheDocument();
	});

	it("collapses duplicate same-question rows into one card", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (String(url).includes("voter=")) return Promise.resolve([]);
			return Promise.resolve([
				poll({ id: "dup-1", total_votes: 1 }),
				poll({ id: "dup-2", total_votes: 2 }),
			]);
		});
		renderPage();
		const titles = await screen.findAllByText("Best canteen dish?");
		expect(titles).toHaveLength(1);
		// Canonical row kept: the one with more votes.
		expect(screen.getByText(/2 votes/)).toBeInTheDocument();
	});

	it("Refresh re-reads fresh, bypassing the GET cache", async () => {
		renderPage();
		await screen.findByText("Best canteen dish?");
		mocks.get.mockClear();
		mocks.getFresh.mockClear();
		fireEvent.click(screen.getByRole("button", { name: /refresh polls/i }));
		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalled();
		});
		expect(mocks.get).not.toHaveBeenCalled();
	});

	it("Ended tab shows only finished polls", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (String(url).includes("voter=")) return Promise.resolve([]);
			return Promise.resolve([
				poll({ id: "live", title: "Live question" }),
				poll({
					id: "old",
					title: "Old question",
					expires_at: "2020-01-01T00:00:00.000Z",
				}),
			]);
		});
		renderPage();
		expect(await screen.findByText("Live question")).toBeInTheDocument();
		expect(screen.queryByText("Old question")).toBeNull();
		fireEvent.click(screen.getByText(/ended & archived/i));
		expect(await screen.findByText("Old question")).toBeInTheDocument();
		expect(screen.queryByText("Live question")).toBeNull();
	});
});
