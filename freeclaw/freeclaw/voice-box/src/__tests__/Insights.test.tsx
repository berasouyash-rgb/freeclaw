// ═══════════════════════════════════════════════════════════════════
// Community Insights page — /insights
// ═══════════════════════════════════════════════════════════════════
// Locks the contract:
//   1. Loads /api/insights and renders the stat tiles.
//   2. Renders the category breakdown bars.
//   3. Renders the 14-day trend.
//   4. Server error → error message with Retry.
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Insights from "../pages/Insights";

const mocks = vi.hoisted(() => ({
	getSlow: vi.fn(),
	toast: vi.fn(),
}));

// The page subscribes for realtime updates; without this mock jsdom would
// open a real production supabase WebSocket. Wiring assertions live in
// DerivedPages.realtime.test.tsx.
vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => {},
}));

vi.mock("../lib/api", () => ({
	api: { getSlow: mocks.getSlow },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/utils", () => ({
	STATUS_META: {
		reported: { label: "Reported", color: "#888", pct: 5 },
		solved: { label: "Solved", color: "#16a06a", pct: 100 },
		in_progress: { label: "In Progress", color: "#d98a0b", pct: 50 },
	},
	PRIORITY_META: {},
	CAT_EMOJI: {},
}));

const PAYLOAD = {
	totals: {
		posts: 120,
		comments: 340,
		reactions: 890,
		polls: 14,
		poll_votes: 520,
		open: 30,
		solved: 90,
		participants: 76,
	},
	by_category: [
		{ category: "Academics", count: 40, solved: 30 },
		{ category: "Facilities", count: 25, solved: 10 },
	],
	by_status: [
		{ status: "reported", count: 15 },
		{ status: "solved", count: 90 },
		{ status: "in_progress", count: 15 },
	],
	trend: Array.from({ length: 15 }, (_, i) => ({
		date: `2026-07-${String(i + 1).padStart(2, "0")}`,
		posts: i,
		comments: i * 2,
	})),
	top_categories: [{ category: "Academics", count: 40 }],
	generated_at: "2026-08-01T00:00:00.000Z",
};

function renderPage() {
	return render(
		<MemoryRouter>
			<Insights />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSlow.mockResolvedValue(PAYLOAD);
});

describe("Insights — stats", () => {
	it("renders the stat tiles from totals", async () => {
		renderPage();
		await screen.findByText("120");
		expect(screen.getByText("340")).toBeInTheDocument();
		expect(screen.getByText("890")).toBeInTheDocument();
		expect(screen.getByText("76")).toBeInTheDocument();
	});

	it("renders the category breakdown", async () => {
		renderPage();
		await screen.findByText("Academics");
		expect(screen.getByText("Facilities")).toBeInTheDocument();
	});

	it("renders every trend bucket, but thins the axis labels", () => {
		renderPage();
		return screen.findByText("Academics").then(() => {
			// Every day still gets a bar — each carries its own title with the
			// day's real numbers, so the chart loses no information.
			const bars = document.querySelectorAll("[title*='posts']");
			expect(bars.length).toBe(15);

			// REGRESSION: the axis used to label all 15 days. At 8px each label
			// needs ~28px, so 15 of them forced the page 66px wider than a 375px
			// phone. Labels are now every 3rd day plus the last.
			const labels = screen.getAllByText(/jul/i);
			expect(labels.length).toBeGreaterThanOrEqual(3);
			expect(labels.length).toBeLessThan(15);
		});
	});

	it("falls back to the raw date string for unparseable dates", async () => {
		mocks.getSlow.mockResolvedValue({
			...PAYLOAD,
			trend: [{ date: "not-a-date", posts: 3, comments: 4 }],
		});
		renderPage();
		await screen.findByText("not-a-date");
	});
});

describe("Insights — error state", () => {
	it("shows an error with a working retry", async () => {
		mocks.getSlow.mockRejectedValueOnce(new Error("Insights unavailable"));
		const user = userEvent.setup();
		renderPage();

		await screen.findByText(/insights unavailable/i);
		const retry = screen.getByRole("button", { name: /retry/i });
		mocks.getSlow.mockResolvedValueOnce(PAYLOAD);
		await user.click(retry);
		await screen.findByText("Academics");
	});

	it("coerces string counts instead of rendering NaN bars", async () => {
		mocks.getSlow.mockResolvedValue({
			...PAYLOAD,
			totals: { ...PAYLOAD.totals, posts: "120", comments: "340" },
			by_category: [{ category: "Academics", count: "40", solved: "30" }],
			trend: [{ date: "2026-07-01", posts: "3", comments: "4" }],
		});
		const { container } = renderPage();
		await screen.findByText("Academics");
		// No NaN anywhere: tiles coerce, bars get numeric widths.
		expect(container.textContent).not.toMatch(/NaN/);
		expect(screen.getByText("120")).toBeInTheDocument();
	});
});
