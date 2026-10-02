// ═══════════════════════════════════════════════════════════════════
// Settings — session recovery control
// ═══════════════════════════════════════════════════════════════════
// The server never re-mints a session on claim (that would hand any
// disclosed anonymous id to whoever asks, and lock the real owner out),
// so an expired or cleared session is a dead end for the old id. The ONLY
// way back is a fresh anonymous id — and the page that must offer it is
// Settings → Account, which is exactly where the server's recovery message
// points. If this control regresses, expired users are bricked with no
// path forward.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../pages/Settings";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	refreshIdentity: vi.fn(),
	get: vi.fn(async () => ({})),
	post: vi.fn(async () => ({})),
	put: vi.fn(async () => ({})),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		post: mocks.post,
		put: mocks.put,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		refreshIdentity: mocks.refreshIdentity,
		setDisplayName: vi.fn(),
		theme: "system",
		setTheme: vi.fn(),
		displayPrefs: { uiScale: 100 },
		setDisplayPrefs: vi.fn(),
		profile: { avatar: "", bio: "", photo: "" },
		setProfile: vi.fn(),
		notifications: [],
		bookmarks: [],
		recentlyViewed: [],
	}),
}));

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	localStorage.setItem("vb:anonId", "anon-test");
});

describe("Settings — session recovery", () => {
	it("offers Start fresh in Account and mints a new local identity on confirm", async () => {
		render(
			<MemoryRouter>
				<Settings />
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Account" }));
		fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));

		// Confirm dialog states the cost honestly: old posts stay published,
		// this device stops owning them.
		expect(
			screen.getByText(/previously published posts stay up/i),
		).toBeInTheDocument();
		// The dialog confirm shares the row's label — it is the second one.
		const confirms = screen.getAllByRole("button", { name: "Start fresh" });
		expect(confirms).toHaveLength(2);
		const confirm = confirms[1];
		expect(confirm).toBeDefined();
		fireEvent.click(confirm!);

		await waitFor(() => {
			expect(mocks.refreshIdentity).toHaveBeenCalledTimes(1);
		});
		const next = localStorage.getItem("vb:anonId");
		expect(next).toBeTruthy();
		expect(next).not.toBe("anon-test");
		expect(next).toMatch(/^anon_/);
		expect(mocks.toast).toHaveBeenCalledWith(
			"Fresh anonymous ID ready",
			"ok",
		);
	});

	it("cancelling the dialog changes nothing", async () => {
		render(
			<MemoryRouter>
				<Settings />
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Account" }));
		fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(localStorage.getItem("vb:anonId")).toBe("anon-test");
		expect(mocks.refreshIdentity).not.toHaveBeenCalled();
	});
});
