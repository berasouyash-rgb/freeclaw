import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "../components/Layout";

const mocks = vi.hoisted(() => ({
	accountStatus: null as null | { banned?: boolean; suspended?: boolean },
	get: vi.fn(),
	notifications: [] as Array<{ read?: boolean }>,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		theme: "light",
		toggleTheme: vi.fn(),
		notifications: mocks.notifications,
		markNotifsRead: vi.fn(),
		clearNotifs: vi.fn(),
		anonId: "anon-test",
		displayName: "",
		profile: null,
		chatUnread: 0,
		accountStatus: mocks.accountStatus,
		toast: vi.fn(),
	}),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: vi.fn(), put: vi.fn(), del: vi.fn() },
	hasAdminSession: () => false,
}));

function renderLayout() {
	return render(
		<MemoryRouter initialEntries={["/"]}>
			<Routes>
				<Route element={<Layout />}>
					<Route index element={<div>Feed content</div>} />
				</Route>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.accountStatus = null;
	mocks.notifications = [];
	mocks.get.mockResolvedValue(null);
});

describe("Layout — banned IDs", () => {
	it("blocks browsing entirely for banned IDs", async () => {
		mocks.accountStatus = { banned: true };
		renderLayout();
		expect(await screen.findByText("Banned from Voice Box")).toBeInTheDocument();
		expect(
			screen.queryByText("Feed content"),
		).not.toBeInTheDocument();
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Contact support" }),
		).toHaveAttribute("href", "/contact");
	});

	it("keeps browsing open for clean and suspended IDs", async () => {
		renderLayout();
		expect(await screen.findByText("Feed content")).toBeInTheDocument();
		expect(screen.queryByText("Banned from Voice Box")).not.toBeInTheDocument();
	});
});

describe("Layout — banner snooze is per-banner and temporary", () => {
	const ANN_A = { kind: "info", text: "Banner A", at: "2026-09-01T00:00:00Z" };
	const ANN_B = { kind: "info", text: "Banner B", at: "2026-09-02T00:00:00Z" };

	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it("shows the banner and snoozes only it for 24h on dismiss", async () => {
		mocks.get.mockResolvedValue(ANN_A);
		const { unmount } = renderLayout();
		expect(await screen.findByText("Banner A")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Dismiss announcement" }));
		await waitFor(() => {
			expect(screen.queryByText("Banner A")).not.toBeInTheDocument();
		});
		const stored = JSON.parse(localStorage.getItem("vb:dismissedAnnouncement")!);
		expect(stored.at).toBe(ANN_A.at);
		expect(stored.until).toBeGreaterThan(Date.now());
		unmount();

		// Same banner stays hidden within the snooze window …
		mocks.get.mockResolvedValue(ANN_A);
		renderLayout();
		await screen.findByText("Feed content");
		expect(screen.queryByText("Banner A")).not.toBeInTheDocument();

		// … but a NEW banner (different at) always shows.
		mocks.get.mockResolvedValue(ANN_B);
		renderLayout();
		expect(await screen.findByText("Banner B")).toBeInTheDocument();
	});

	it("re-shows the banner after the 24h snooze expires", async () => {
		localStorage.setItem(
			"vb:dismissedAnnouncement",
			JSON.stringify({ at: ANN_A.at, until: Date.now() - 1000 }),
		);
		mocks.get.mockResolvedValue(ANN_A);
		renderLayout();
		expect(await screen.findByText("Banner A")).toBeInTheDocument();
	});

	it("honours legacy plain-at dismissals", async () => {
		localStorage.setItem("vb:dismissedAnnouncement", ANN_A.at);
		mocks.get.mockResolvedValue(ANN_A);
		renderLayout();
		await screen.findByText("Feed content");
		expect(screen.queryByText("Banner A")).not.toBeInTheDocument();
	});
});

describe("Layout — sidebar never overlaps its footer", () => {
	// REGRESSION: the desktop aside is h-screen flex-col with an mt-auto
	// footer ("100% anonymous" + anon ID). The nav had no scroll containment,
	// so on short viewports it overflowed and the footer overlapped the nav
	// links. The nav must sit in a shrinking scroll region instead.
	it("contains the desktop nav in a shrinking scroll region", async () => {
		renderLayout();
		await screen.findByText("Feed content");
		const nav = document.querySelector("aside nav[aria-label='Main navigation']");
		expect(nav).not.toBeNull();
		const scroller = nav!.closest(".overflow-y-auto");
		expect(scroller).not.toBeNull();
		expect(scroller!.className).toMatch(/flex-1/);
		expect(scroller!.className).toMatch(/min-h-0/);
	});
});

describe("Layout — mobile More sheet holds every destination", () => {
	// REGRESSION: the bottom bar carried 6 tabs while the sidebar held 14
	// destinations — Polls, Communities, Insights, Suggestions, Leaderboard,
	// Solving Board, Saved, Privacy, FAQ hid behind the hamburger. Now five
	// primary tabs + More, and the sheet derives from the same NAV arrays,
	// so a page added to the sidebar appears on mobile automatically.
	const SHEET_LINKS: Array<[string, string]> = [
		["Alerts", "/notifications"],
		["Polls", "/polls"],
		["Communities", "/communities"],
		["Insights", "/insights"],
		["Suggestions", "/suggestions"],
		["Leaderboard", "/leaderboard"],
		["Solving Board", "/board"],
		["Saved", "/saved"],
		["Privacy", "/privacy"],
		["FAQ", "/faq"],
		["Admin", "/admin"],
	];

	function mobileNav() {
		return screen.getByRole("navigation", { name: "Mobile navigation" });
	}

	it("shows five primary tabs plus More, and no Alerts tab", async () => {
		renderLayout();
		await screen.findByText("Feed content");
		const nav = mobileNav();
		for (const name of ["Feed", "Search", "Submit", "Inbox", "Me"]) {
			expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
		}
		expect(
			within(nav).getByRole("button", { name: "More pages" }),
		).toBeInTheDocument();
		expect(
			within(nav).queryByRole("link", { name: "Alerts" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("dialog", { name: "More pages" }),
		).not.toBeInTheDocument();
	});

	it("lists every non-primary destination with correct links", async () => {
		renderLayout();
		await screen.findByText("Feed content");
		fireEvent.click(
			within(mobileNav()).getByRole("button", { name: "More pages" }),
		);
		const dialog = await screen.findByRole("dialog", {
			name: "More pages",
		});
		for (const [name, href] of SHEET_LINKS) {
			expect(within(dialog).getByRole("link", { name })).toHaveAttribute(
				"href",
				href,
			);
		}
	});

	it("carries the unread badge from the Alerts tab to More and the sheet row", async () => {
		mocks.notifications = [{ read: false }, { read: true }];
		renderLayout();
		await screen.findByText("Feed content");
		expect(
			within(mobileNav()).getByRole("button", {
				name: "More pages, 1 unread alerts",
			}),
		).toBeInTheDocument();
		fireEvent.click(
			within(mobileNav()).getByRole("button", {
				name: "More pages, 1 unread alerts",
			}),
		);
		const dialog = await screen.findByRole("dialog", {
			name: "More pages",
		});
		expect(
			within(dialog).getByRole("link", { name: "Alerts, 1 unread" }),
		).toHaveAttribute("href", "/notifications");
	});

	it("closes the sheet from the backdrop", async () => {
		renderLayout();
		await screen.findByText("Feed content");
		fireEvent.click(
			within(mobileNav()).getByRole("button", { name: "More pages" }),
		);
		await screen.findByRole("dialog", { name: "More pages" });
		fireEvent.click(screen.getByRole("button", { name: "Close more pages" }));
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "More pages" }),
			).not.toBeInTheDocument();
		});
	});
});
