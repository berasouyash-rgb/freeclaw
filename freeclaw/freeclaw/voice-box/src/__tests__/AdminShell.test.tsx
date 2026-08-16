// ═══════════════════════════════════════════════════════════════════
// Admin console shell — navigation, default tab, View site
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • default tab is Dashboard (not Ops Center) — the outcome-first home
//   • View site link jumps straight into the user space
//   • sidebar group navigation switches tabs
//   • tab search (⌘K) finds and opens sections
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Admin from "../pages/Admin";

// Keep session helpers real (sessionStorage) but stub every API call.
vi.mock("../lib/api", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../lib/api")>();
	return {
		...mod,
		api: {
			get: vi.fn(async () => ({ valid: true })),
			getSlow: vi.fn(async () => []),
			post: vi.fn(async () => ({ token: "t", expires_at: "x" })),
			put: vi.fn(async () => ({})),
			del: vi.fn(async () => ({})),
			getLong: vi.fn(async () => []),
			postLong: vi.fn(async () => []),
		},
	};
});

vi.mock("../lib/retryLazy", () => ({
	retryLazy: () => () => <div data-testid="lazy-tab" />,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		theme: "light",
		toggleTheme: vi.fn(),
		toast: vi.fn(),
	}),
}));

vi.mock("../lib/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../lib/utils")>();
	return { ...mod, sha256: vi.fn(async () => "hash") };
});

const FUTURE = String(Date.now() + 3600_000);

function asAdmin() {
	sessionStorage.setItem(
		"vb:adminAuth",
		JSON.stringify({ token: "t", exp: FUTURE }),
	);
}

function renderShell() {
	return render(
		<MemoryRouter>
			<Admin />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	asAdmin();
});

describe("Admin console shell", () => {
	it("defaults to the Dashboard tab on open", async () => {
		renderShell();
		await waitFor(() => {
			const dash = screen.getByRole("button", { name: /^Dashboard$/ });
			expect(dash.getAttribute("aria-current")).toBe("page");
		});
	});

	it("shows a View site link straight to the user space", async () => {
		renderShell();
		// Present in both the sidebar and the top bar
		const links = await screen.findAllByRole("link", { name: /View site/ });
		expect(links.length).toBeGreaterThanOrEqual(1);
		expect(links[0]!.getAttribute("href")).toBe("/");
	});

	it("navigates to the Ops Center via the sidebar", async () => {
		renderShell();
		const ops = await screen.findByRole("button", { name: /Ops Center/ });
		fireEvent.click(ops);
		await waitFor(() => {
			expect(ops.getAttribute("aria-current")).toBe("page");
		});
		// The Dashboard tab is no longer current
		expect(
			screen.getByRole("button", { name: /^Dashboard$/ }).getAttribute(
				"aria-current",
			),
		).toBeNull();
	});

	it("finds and opens a section via tab search", async () => {
		renderShell();
		const search = await screen.findByLabelText("Search admin sections");
		fireEvent.change(search, { target: { value: "polls" } });
		// The search dropdown + the sidebar both list Polls — pick the dropdown
		// result (it is scoped to the open search panel below the input).
		const results = await screen.findAllByRole("button", { name: /^Polls/ });
		const dropdownResult = results.find(
			(b) => b.closest("div.absolute") !== null,
		);
		fireEvent.click(dropdownResult ?? results[0]!);
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /^Polls/ }).getAttribute(
					"aria-current",
				),
			).toBe("page");
		});
	});

	it("shows the sign-out control", async () => {
		renderShell();
		await screen.findAllByRole("link", { name: /View site/ });
		expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
	});
});
