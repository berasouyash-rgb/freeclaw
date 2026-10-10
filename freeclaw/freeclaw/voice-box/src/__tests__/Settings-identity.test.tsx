// ═══════════════════════════════════════════════════════════════════
// Settings — session recovery control + cross-device pairing
// ═══════════════════════════════════════════════════════════════════
// The server never re-mints a session on claim (that would hand any
// disclosed anonymous id to whoever asks, and lock the real owner out),
// so an expired or cleared session is a dead end for the old id. The ONLY
// way back is pairing: a live device issues a 6-digit code and redeeming
// it hands this device the id AND a session cookie (the page that must
// offer it is Settings → Account, which is exactly where the server's
// recovery message points). If these controls regress, cleared-session
// users are bricked with no path forward — or adopt an id they can never
// write with (storage swapped, session denied, silent dead end).
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
	isSessionDeadError: vi.fn((e: unknown) => {
		void e;
		return false;
	}),
	anon: "anon-test",
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		post: mocks.post,
		put: mocks.put,
	},
	isSessionDeadError: mocks.isSessionDeadError,
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
	// mockReset (not just clear) drops one-shot queues left behind by a
	// failed assertion, then the defaults below re-arm the happy path.
	mocks.post.mockReset();
	mocks.post.mockImplementation(async () => ({}));
	mocks.isSessionDeadError.mockReset();
	mocks.isSessionDeadError.mockImplementation(() => false);
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

describe("Settings — identity pairing across devices", () => {
	function openAccount() {
		render(
			<MemoryRouter>
				<Settings />
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Account" }));
	}

	// `post` is declared as vi.fn(async () => ({})) — an empty params tuple —
	// so mock.calls can't be destructured without a widening cast.
	function identityLinkCalls(): unknown[][] {
		return (mocks.post.mock.calls as unknown[][]).filter(
			([path]) => path === "/api/identity-link",
		);
	}

	it("reveals this device's identity code only on explicit tap", async () => {
		mocks.anon = "anon_testdevice01";
		localStorage.setItem("vb:anonId", "anon_testdevice01");
		openAccount();
		expect(screen.queryByLabelText("Your identity link code")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Show my identity code" }),
		);
		const code = await screen.findByLabelText("Your identity link code");
		expect(code.textContent).toMatch(/^VF-/);
		// Verification copy must not oversell: the identity code encodes the
		// id but cannot take it over — pairing (a live session) is the only
		// adoption path.
		expect(
			screen.getByText(/verification only/i),
		).toBeInTheDocument();
		expect(
			screen.queryByLabelText("Pairing code"),
		).not.toBeNull();
	});

	it("rejects a mistyped pairing code without touching the identity", async () => {
		openAccount();
		fireEvent.change(screen.getByLabelText("Pairing code"), {
			target: { value: "12ab" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));
		expect(await screen.findByText(/6 digits/i)).toBeInTheDocument();
		// No redeem request, no dialog, no local id change.
		expect(
			identityLinkCalls().length > 0,
		).toBe(false);
		expect(localStorage.getItem("vb:anonId")).toBe("anon-test");
		expect(mocks.refreshIdentity).not.toHaveBeenCalled();
	});

	it("flags a VF identity code pasted into the pairing input", async () => {
		openAccount();
		fireEvent.change(screen.getByLabelText("Pairing code"), {
			target: { value: "VF-NOPE-00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));
		// The alert disambiguates from the "Show my identity code" button,
		// which would also match a bare /identity code/ text query.
		expect(await screen.findByRole("alert")).toHaveTextContent(
			/identity code/i,
		);
		expect(
			identityLinkCalls().length > 0,
		).toBe(false);
		expect(localStorage.getItem("vb:anonId")).toBe("anon-test");
	});

	it("mints a pairing code only when asked, showing its window", async () => {
		mocks.post.mockResolvedValueOnce({ code: "482913", expires_in: 300 });
		openAccount();
		fireEvent.click(screen.getByRole("button", { name: "Show my pairing code" }));
		const code = await screen.findByLabelText("Your pairing code");
		expect(code.textContent).toBe("482913");
		expect(screen.getByText(/valid for 5 minutes/i)).toBeInTheDocument();
		expect(mocks.post).toHaveBeenCalledWith("/api/identity-link", {
			action: "issue",
		});
	});

	it("explains that a session-dead device can't issue a pairing code", async () => {
		mocks.post.mockRejectedValueOnce(new Error("Invalid session identity"));
		mocks.isSessionDeadError.mockReturnValueOnce(true);
		openAccount();
		fireEvent.click(screen.getByRole("button", { name: "Show my pairing code" }));
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(/no active session to pair from/i);
		expect(screen.queryByLabelText("Your pairing code")).toBeNull();
	});

	it("pairs only after confirmation, adopting the server's identity", async () => {
		mocks.anon = "anon_testdevice01";
		localStorage.setItem("vb:anonId", "anon_testdevice01");
		openAccount();
		fireEvent.change(screen.getByLabelText("Pairing code"), {
			target: { value: "123456" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));
		// Confirm dialog states the cost before anything changes — no
		// request has gone out yet and this device's id is untouched.
		expect(
			await screen.findByText(/adopt the linked identity/i),
		).toBeInTheDocument();
		expect(localStorage.getItem("vb:anonId")).toBe("anon_testdevice01");
		expect(
			identityLinkCalls().length > 0,
		).toBe(false);

		mocks.post.mockResolvedValueOnce({
			ok: true,
			anon_id: "anon_abcdefghij1234",
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair devices" }));
		await waitFor(() => {
			expect(localStorage.getItem("vb:anonId")).toBe("anon_abcdefghij1234");
		});
		expect(mocks.post).toHaveBeenCalledWith("/api/identity-link", {
			action: "redeem",
			code: "123456",
		});
		expect(mocks.refreshIdentity).toHaveBeenCalledTimes(1);
		expect(mocks.toast).toHaveBeenCalledWith(
			"Devices linked — one ID everywhere now",
			"ok",
		);
	});

	it("restores this device's own session when the code returns its id", async () => {
		mocks.anon = "anon_testdevice01";
		localStorage.setItem("vb:anonId", "anon_testdevice01");
		openAccount();
		fireEvent.change(screen.getByLabelText("Pairing code"), {
			target: { value: "654321" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));
		mocks.post.mockResolvedValueOnce({
			ok: true,
			anon_id: "anon_testdevice01",
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair devices" }));
		await waitFor(() => {
			expect(mocks.refreshIdentity).toHaveBeenCalledTimes(1);
		});
		// Same id: nothing local changed, but the redeem's Set-Cookie gives
		// this device a live session again — the recovery path.
		expect(localStorage.getItem("vb:anonId")).toBe("anon_testdevice01");
		expect(mocks.toast).toHaveBeenCalledWith(
			"This device already uses that ID — session restored",
			"ok",
		);
	});

	it("shows the server's redeem failure and leaves the id alone", async () => {
		mocks.anon = "anon_testdevice01";
		localStorage.setItem("vb:anonId", "anon_testdevice01");
		openAccount();
		fireEvent.change(screen.getByLabelText("Pairing code"), {
			target: { value: "999999" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));
		mocks.post.mockRejectedValueOnce(new Error("Pairing code expired"));
		fireEvent.click(screen.getByRole("button", { name: "Pair devices" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			/Pairing code expired/i,
		);
		expect(localStorage.getItem("vb:anonId")).toBe("anon_testdevice01");
		expect(mocks.refreshIdentity).not.toHaveBeenCalled();
		expect(mocks.toast).not.toHaveBeenCalled();
	});
});
