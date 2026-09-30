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
import SolvingBoard from "../pages/SolvingBoard";

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
		expect(await screen.findByText("Broken lift")).toBeInTheDocument();
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
});

describe("SolvingBoard — error state", () => {
	it("shows an error with a working retry", async () => {
		mocks.getSlow.mockRejectedValueOnce(new Error("board down"));
		renderPage();
		await screen.findByText("board down");

		mocks.getSlow.mockResolvedValueOnce([POST]);
		fireEvent.click(screen.getByRole("button", { name: /retry/i }));
		expect(await screen.findByText("Broken lift")).toBeInTheDocument();
	});
});
