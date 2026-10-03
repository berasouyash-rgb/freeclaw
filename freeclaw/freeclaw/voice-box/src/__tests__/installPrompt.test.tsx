import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InstallPrompt, { decideInstallPrompt } from "../components/InstallPrompt";

vi.mock("../lib/identity", () => ({
	lsGet: () => false,
	lsSet: vi.fn(),
}));

vi.mock("../lib/platform", () => ({
	isNativeShell: () => false,
}));

describe("decideInstallPrompt", () => {
	const base = {
		hasDeferred: true,
		dismissed: false,
		standalone: false,
		isIOS: false,
		isNative: false,
	};
	it("offers auto install on first run with a deferred prompt", () => {
		expect(decideInstallPrompt(base)).toBe("auto");
	});
	it("stays silent when dismissed, installed, or native", () => {
		expect(decideInstallPrompt({ ...base, dismissed: true })).toBeNull();
		expect(decideInstallPrompt({ ...base, standalone: true })).toBeNull();
		expect(decideInstallPrompt({ ...base, isNative: true })).toBeNull();
	});
	it("offers iOS manual steps when no install event exists", () => {
		expect(
			decideInstallPrompt({ ...base, hasDeferred: false, isIOS: true }),
		).toBe("ios");
	});
	it("stays silent on desktop with no install event", () => {
		expect(decideInstallPrompt({ ...base, hasDeferred: false })).toBeNull();
	});
});

describe("InstallPrompt", () => {
	it("renders nothing until the browser fires beforeinstallprompt", () => {
		render(<InstallPrompt />);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("shows the install card when the browser offers installation", async () => {
		render(<InstallPrompt />);
		const prompt = vi.fn(async () => {});
		const userChoice = Promise.resolve({ outcome: "accepted" });
		const event = new Event("beforeinstallprompt") as Event & {
			prompt: () => Promise<void>;
			userChoice: Promise<{ outcome: string }>;
		};
		event.prompt = prompt;
		event.userChoice = userChoice;
		// jsdom fires the event synchronously; preventDefault is what the
		// component relies on to capture it.
		event.preventDefault = () => {};
		window.dispatchEvent(event);
		expect(
			await screen.findByRole("dialog", { name: /install voice flow/i }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
		await waitFor(() => {
			expect(prompt).toHaveBeenCalledTimes(1);
		});
		// Accepted → dismissed, never nags again.
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});
});
