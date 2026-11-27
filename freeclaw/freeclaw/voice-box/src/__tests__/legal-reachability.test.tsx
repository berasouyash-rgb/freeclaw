// ════════════════════════════════════════════════════════════════════
// The legal pages must be REACHABLE, not merely routed.
//
// `/terms`, `/privacy` and `/accessibility` were all fully written and all
// registered in App.tsx's route table — and Terms and Accessibility had
// zero links anywhere in the application. A Terms of Use that no user can
// find does not satisfy the requirement it was written for, so this test
// asserts on rendered navigation, not on the route table (which was
// already green while the feature was broken).
//
// Mock shape follows src/__tests__/Layout.test.tsx.
// ════════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Layout, { NAV_ALL } from "../components/Layout";

const mocks = vi.hoisted(() => ({
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
		accountStatus: null,
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
	mocks.notifications = [];
	mocks.get.mockResolvedValue(null);
});

const LEGAL_PAGES = [
	{ href: "/terms", name: /terms/i },
	{ href: "/privacy", name: /privacy/i },
	{ href: "/accessibility", name: /accessibility/i },
];

describe("legal pages are reachable from the navigation", () => {
	it("lists every legal page in the nav model", () => {
		const paths = NAV_ALL.map((n) => n.to);
		for (const { href } of LEGAL_PAGES) {
			expect(paths).toContain(href);
		}
	});

	it.each(LEGAL_PAGES)(
		"renders a real link to $href a user can activate",
		({ href, name }) => {
			renderLayout();
			const links = screen.getAllByRole("link", { name });
			expect(links.length).toBeGreaterThan(0);
			// The anchor must actually point at the route, not merely exist.
			expect(
				links.some((el) => el.getAttribute("href") === href),
			).toBe(true);
		},
	);

	it("gives the legal pages human-recognisable labels", () => {
		const labels = NAV_ALL.map((n) => n.label);
		expect(labels).toContain("Terms");
		expect(labels).toContain("Privacy");
		expect(labels).toContain("Accessibility");
	});
});