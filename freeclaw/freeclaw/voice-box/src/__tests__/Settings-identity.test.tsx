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
	anon: "anon-test",
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
		anonId: mocks.anon,
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
	mocks.anon = "anon-test";
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

describe("Settings — identity linking across devices", () => {
	function openAccount() {
		render(
			<MemoryRouter>
				<Settings />
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Account" }));
	}

	it("reveals this device's link code only on explicit tap", async () => {
		mocks.anon = "anon_testdevice01";
		localStorage.setItem("vb:anonId", "anon_testdevice01");
		openAccount();
		expect(screen.queryByLabelText("Your identity link code")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Show my link code" }),
		);
		const code = await screen.findByLabelText("Your identity link code");
		expect(code.textContent).toMatch(/^VF-/);
		expect(
			screen.getByText(/anyone with this code owns your posts/i),
		).toBeInTheDocument();
	});

	it("rejects a mistyped code without touching the identity", async () => {
		openAccount();
		fireEvent.change(screen.getByLabelText("Identity link code"), {
			target: { value: "VF-NOPE-00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Link this device" }));
		expect(
			await screen.findByText(/doesn't look right/i),
		).toBeInTheDocument();
		expect(localStorage.getItem("vb:anonId")).toBe("anon-test");
		expect(mocks.refreshIdentity).not.toHaveBeenCalled();
	});

	it("adopts a valid code only after confirmation", async () => {
		mocks.anon = "anon_testdevice01";
		localStorage.setItem("vb:anonId", "anon_testdevice01");
		openAccount();
		// A code minted for a different identity.
		const { createLinkCode } = await import("../lib/identity");
		const code = createLinkCode("anon_abcdefghij1234")!;
		fireEvent.change(screen.getByLabelText("Identity link code"), {
			target: { value: code },
		});
		fireEvent.click(screen.getByRole("button", { name: "Link this device" }));
		// Confirm dialog states the cost before anything changes.
		expect(
			await screen.findByText(/adopt the linked identity/i),
		).toBeInTheDocument();
		expect(localStorage.getItem("vb:anonId")).toBe("anon_testdevice01");
		fireEvent.click(screen.getByRole("button", { name: "Link devices" }));
		await waitFor(() => {
			expect(localStorage.getItem("vb:anonId")).toBe("anon_abcdefghij1234");
		});
		expect(mocks.refreshIdentity).toHaveBeenCalledTimes(1);
		expect(mocks.toast).toHaveBeenCalledWith(
			"Devices linked — one ID everywhere now",
			"ok",
		);
	});
});
