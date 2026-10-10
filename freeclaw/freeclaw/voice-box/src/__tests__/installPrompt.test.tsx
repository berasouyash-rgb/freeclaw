import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InstallPrompt, { decideInstallPrompt } from "../components/InstallPrompt";

vi.mock("../lib/identity", () => ({
	lsGet: () => false,
	lsSet: vi.fn(),
}));

vi.mock("../lib/platform", () => ({
	isNativeShell: () => false,
	apiBase: () => "",
}));

// jsdom's default UA contains "linux" → detectDevicePlatform() maps it to
// the windows binary, so the feed below offers a windows release.
const FEED = {
	app: "voice-flow",
	platforms: {
		windows: { version: "2.0.0", url: "https://example.com/app.exe" },
	},
	commit: "abc",
};

function mockFeed(feed: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			json: async () => feed,
		})),
	);
}

beforeEach(() => {
	vi.unstubAllGlobals();
});

describe("decideInstallPrompt", () => {
	const base = {
		hasRelease: true,
		dismissed: false,
		standalone: false,
		isIOS: false,
		isNative: false,
	};
	it("offers the native binary on first run when the feed has one", () => {
		expect(decideInstallPrompt(base)).toBe("native");
	});
	it("stays silent when dismissed, installed, or native", () => {
		expect(decideInstallPrompt({ ...base, dismissed: true })).toBeNull();
		expect(decideInstallPrompt({ ...base, standalone: true })).toBeNull();
		expect(decideInstallPrompt({ ...base, isNative: true })).toBeNull();
	});
	it("offers iOS manual steps when no binary exists", () => {
		expect(
			decideInstallPrompt({ ...base, hasRelease: false, isIOS: true }),
		).toBe("ios");
	});
	it("stays silent on desktop with no release (never a fake button)", () => {
		expect(decideInstallPrompt({ ...base, hasRelease: false })).toBeNull();
	});
});

describe("InstallPrompt", () => {
	it("renders nothing while the feed loads", () => {
		vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
		render(<InstallPrompt />);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("renders nothing when the feed has no release for this device", async () => {
		mockFeed({ app: "voice-flow", platforms: {}, commit: "abc" });
		render(<InstallPrompt />);
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 20));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("renders nothing when the feed is unreachable (never an error banner)", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
		render(<InstallPrompt />);
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 20));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("shows the download card with the real version when the feed has a binary", async () => {
		mockFeed(FEED);
		render(<InstallPrompt />);
		expect(
			await screen.findByRole("dialog", { name: /install voice flow/i }),
		).toBeInTheDocument();
		expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
		const link = screen.getByRole("link", { name: /see downloads/i });
		expect(link.getAttribute("href")).toBe("/download");
	});

	it("dismisses once and never asks again", async () => {
		mockFeed(FEED);
		render(<InstallPrompt />);
		await screen.findByRole("dialog", { name: /install voice flow/i });
		fireEvent.click(screen.getByRole("button", { name: /not now/i }));
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});
});
