// ═══════════════════════════════════════════════════════════════════
// SolvingBoard page — /board
// ═══════════════════════════════════════════════════════════════════
// Locks:
//   1. Status columns render with counts.
//   2. Posts with an unknown/future status land in "Needs triage"
//      instead of vanishing silently.
//   3. Server error → error card with a working silent retry.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SolvingBoard, { topUnanswered } from "../pages/SolvingBoard";

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
	CAT_EMOJI: { Facilities: "🏫" },
	timeAgo: () => "2d ago",
}));

vi.mock("../components/PurgeCountdown", () => ({
	default: () => null,
}));

const POST = {
	id: "p1",
	title: "Broken lift",
	description: "stuck",
	category: "Facilities",
	status: "reported",
	progress: 10,
	created_at: "2026-07-01T10:00:00.000Z",
};

function renderPage() {
	return render(
		<MemoryRouter>
			<SolvingBoard />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSlow.mockResolvedValue([POST]);
});

describe("SolvingBoard — columns", () => {
	it("renders status columns with the post inside", async () => {
		renderPage();
		// The title appears twice: once in the Unanswered spotlight, once in
		// its status column — both must link to the same post.
		const titles = await screen.findAllByText("Broken lift");
		expect(titles).toHaveLength(2);
		expect(screen.getByText("Reported")).toBeInTheDocument();
	});

	it("parks unknown-status posts in Needs triage instead of dropping them", async () => {
		mocks.getSlow.mockResolvedValue([
			{ ...POST, id: "px", title: "Future state post", status: "quantum" },
		]);
		renderPage();
		expect(await screen.findByText("Needs triage")).toBeInTheDocument();
		expect(screen.getByText("Future state post")).toBeInTheDocument();
	});

	it("labels the waiting column Working on, matching the rest of the app", async () => {
		mocks.getSlow.mockResolvedValue([
			{ ...POST, id: "w1", title: "Being fixed now", status: "waiting" },
		]);
		renderPage();
		expect(await screen.findByText("Being fixed now")).toBeInTheDocument();
		expect(screen.getByText("Working on")).toBeInTheDocument();
	});

	it("spotlights unanswered reported posts, most supported first", async () => {
		mocks.getSlow.mockResolvedValue([
			{ ...POST, id: "r1", title: "Quiet issue", status: "reported", reactions: { support: 1 } },
			{ ...POST, id: "r2", title: "Loud issue", status: "reported", reactions: { support: 9 } },
			{ ...POST, id: "s1", title: "Solved already", status: "solved", reactions: { support: 99 } },
		]);
		renderPage();
		const section = await screen.findByLabelText("Unanswered issues needing attention");
		expect(section).toBeInTheDocument();
		const rows = section.querySelectorAll("a");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain("Loud issue");
	});

	it("stays silent when nothing is unanswered", async () => {
		mocks.getSlow.mockResolvedValue([
			{ ...POST, id: "s1", title: "All fixed", status: "solved" },
		]);
		renderPage();
		await screen.findByText("All fixed");
		expect(screen.queryByLabelText("Unanswered issues needing attention")).toBeNull();
	});
});

describe("topUnanswered", () => {
	it("ranks reported posts by support and ignores the rest", () => {
		const out = topUnanswered([
			{ id: "a", status: "reported", reactions: { support: 2 } },
			{ id: "b", status: "reported", reactions: { support: 5 } },
			{ id: "c", status: "solved", reactions: { support: 50 } },
		] as never);
		expect(out.map((p) => p.id)).toEqual(["b", "a"]);
	});
});

describe("SolvingBoard — error state", () => {
	it("shows an error with a working retry", async () => {
		mocks.getSlow.mockRejectedValueOnce(new Error("board down"));
		renderPage();
		await screen.findByText("board down");

		mocks.getSlow.mockResolvedValueOnce([POST]);
		fireEvent.click(screen.getByRole("button", { name: /retry/i }));
		expect(await screen.findAllByText("Broken lift")).not.toHaveLength(0);
	});
});
