// ═══════════════════════════════════════════════════════════════════
// Leaderboard page — /leaderboard
// ═══════════════════════════════════════════════════════════════════
// Locks:
//   1. Empty lists render the empty state (never crash on null arrays).
//   2. Unknown row types fall back to problem styling (never white-screen).
//   3. Server error → error card with a working silent retry.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Leaderboard from "../pages/Leaderboard";

const mocks = vi.hoisted(() => ({
	getSlow: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { getSlow: mocks.getSlow },
}));

vi.mock("../lib/utils", () => ({
	STATUS_META: {
		reported: { label: "Reported", color: "#888" },
		solved: { label: "Solved", color: "#16a06a" },
	},
	timeAgo: () => "2d ago",
}));

const EMPTY = {
	problems: [],
	suggestions: [],
	polls: [],
	leaderboard: [],
	ai_activity: [],
};

function renderPage() {
	return render(
		<MemoryRouter>
			<Leaderboard />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSlow.mockResolvedValue({ ...EMPTY });
});

describe("Leaderboard — lists", () => {
	it("renders the empty state when every list is empty", async () => {
		renderPage();
		expect(await screen.findByText("Nothing ranked yet")).toBeInTheDocument();
	});

	it("renders ranked rows with medals and scores", async () => {
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			leaderboard: [
				{ id: "p1", title: "Top post", type: "problem", score: 42 },
				{ id: "p2", title: "Second post", type: "problem", score: 7 },
			],
		});
		renderPage();
		expect(await screen.findByText("Top post")).toBeInTheDocument();
		expect(screen.getByText("Second post")).toBeInTheDocument();
		expect(screen.getByText("🥇")).toBeInTheDocument();
	});

	it("never shows down-votes in the breakdown (support-only by design)", async () => {
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			leaderboard: [
				{
					id: "p1", title: "Hot post", type: "problem", score: 9,
					breakdown: { support: 12, comments: 0, downvotes: 3, freshness: 0, resolution: "—", depth: "—" },
				},
				{ id: "p2", title: "Calm post", type: "problem", score: 3 },
			],
		});
		renderPage();
		expect(await screen.findByText("Hot post")).toBeInTheDocument();
		// Historical down-votes still flow in the data (ranking stability)
		// but no negative-feedback UI is offered anymore.
		expect(screen.queryByText(/Down: 3/)).not.toBeInTheDocument();
		expect(screen.getByText("Support: 12")).toBeInTheDocument();
	});

	it("falls back instead of crashing on an unknown row type", async () => {
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			leaderboard: [{ id: "x1", title: "Weird row", type: "quantum", score: 3 }],
		});
		renderPage();
		expect(await screen.findByText("Weird row")).toBeInTheDocument();
	});

	it("survives null lists from the server", async () => {		mocks.getSlow.mockResolvedValue({
			problems: null,
			suggestions: null,
			polls: null,
			leaderboard: null,
			ai_activity: null,
		});
		renderPage();
		expect(await screen.findByText("Nothing ranked yet")).toBeInTheDocument();
	});

	it("shows no AI activity tab — the board ranks community support only", async () => {
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			ai_activity: [
				{ kind: "execution", label: "agent", detail: "did a thing" },
			],
		});
		renderPage();
		await screen.findByText("Community Leaderboard");
		expect(screen.queryByText(/AI activity/)).toBeNull();
		expect(screen.queryByText("No AI activity yet")).toBeNull();
	});

	it("warns when the server flags ranks as estimates", async () => {
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			estimated: true,
			degraded: true,
			leaderboard: [{ id: "p1", title: "Top post", type: "problem", score: 1 }],
		});
		renderPage();
		expect(await screen.findByText(/ranks may be incomplete/i)).toBeInTheDocument();
	});

	it("stays quiet when ranks are complete", async () => {
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			leaderboard: [{ id: "p1", title: "Top post", type: "problem", score: 1 }],
		});
		renderPage();
		await screen.findByText("Top post");
		expect(screen.queryByText(/ranks may be incomplete/i)).toBeNull();
	});
});

describe("Leaderboard — error state", () => {
	it("shows an error with a working silent retry", async () => {
		mocks.getSlow.mockRejectedValueOnce(new Error("board down"));
		renderPage();
		await screen.findByText("board down");

		mocks.getSlow.mockResolvedValueOnce({
			...EMPTY,
			leaderboard: [{ id: "p1", title: "Top post", type: "problem", score: 1 }],
		});
		fireEvent.click(screen.getByRole("button", { name: /retry/i }));
		expect(await screen.findByText("Top post")).toBeInTheDocument();
	});
});

describe("Leaderboard — live ranks (evolution 2026-10-06)", () => {
	it("re-ranks when scores change, with no clicks", async () => {
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			leaderboard: [
				{ id: "p1", title: "Top post", type: "problem", score: 42 },
				{ id: "p2", title: "Second post", type: "problem", score: 7 },
			],
		});
		renderPage();
		expect(await screen.findByText("Top post")).toBeInTheDocument();

		// Votes elsewhere flip the ranking after this screen loaded.
		mocks.getSlow.mockResolvedValue({
			...EMPTY,
			leaderboard: [
				{ id: "p2", title: "Second post", type: "problem", score: 50 },
				{ id: "p1", title: "Top post", type: "problem", score: 42 },
			],
		});

		// No Refresh click — returning to the tab re-ranks on its own.
		// (Dispatched on document: a window-level focus event trips an
		// undici/jsdom Event-brand check in this environment.)
		document.dispatchEvent(new Event("visibilitychange"));		const { waitFor } = await import("@testing-library/react");
		await waitFor(
			() => {
				const html = document.body.textContent ?? "";
				expect(html.indexOf("Second post")).toBeGreaterThan(-1);
				expect(html.indexOf("Second post")).toBeLessThan(
					html.indexOf("Top post"),
				);
			},
			{ timeout: 15000 },
		);
	});

	it("owns exactly one visibility-guarded revalidation timer", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/pages/Leaderboard.tsx"),
			"utf8",
		);
		const timers = source.match(/setInterval\s*\(/g) || [];
		expect(timers.length).toBe(1);
		expect(source).toContain('document.visibilityState === "hidden"');
		expect(source).toContain("void load(true)");
	});
});
