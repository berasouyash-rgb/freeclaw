// Native-shell app update prompt — "Update detected: Update now / Later".
// Layout checks once (deferred past first paint); Update now opens the fresh
// installer, Later snoozes 24h. Web never sees the dialog (checker returns
// null there). Queries scope to the update dialog by accessible name —
// Layout also renders an onboarding tutorial dialog that must not match.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "../components/Layout";

const mocks = vi.hoisted(() => ({
	checkForAppUpdate: vi.fn(
		async (): Promise<unknown> => null,
	),
	snoozeUpdate: vi.fn(),
	open: vi.fn(),
}));

vi.mock("../lib/appUpdate", () => ({
	checkForAppUpdate: mocks.checkForAppUpdate,
	snoozeUpdate: mocks.snoozeUpdate,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		theme: "light",
		toggleTheme: vi.fn(),
		notifications: [],
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
	api: { get: vi.fn(async () => null), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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

function updateDialog() {
	return screen.queryByRole("dialog", { name: /new version is ready/i });
}

async function settleUpdateCheck() {
	await act(async () => {
		vi.advanceTimersByTime(5000);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	window.open = mocks.open;
});

afterEach(() => {
	vi.useRealTimers();
});

const UPDATE = {
	platform: "android",
	version: "2.1.0",
	url: "https://example.com/app.apk",
	notes: "Live feed fixes",
};

describe("Layout app update prompt", () => {
	it("stays hidden when no update is available", async () => {
		mocks.checkForAppUpdate.mockResolvedValue(null);
		renderLayout();
		await settleUpdateCheck();
		expect(updateDialog()).toBeNull();
	});

	it("shows Update detected with Update now / Later", async () => {
		mocks.checkForAppUpdate.mockResolvedValue(UPDATE);
		renderLayout();
		await settleUpdateCheck();
		expect(updateDialog()).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /update now/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^later$/i })).toBeInTheDocument();
		expect(screen.getByText("Live feed fixes")).toBeInTheDocument();
	});

	it("Later snoozes and dismisses", async () => {
		mocks.checkForAppUpdate.mockResolvedValue(UPDATE);
		renderLayout();
		await settleUpdateCheck();
		fireEvent.click(screen.getByRole("button", { name: /^later$/i }));
		expect(mocks.snoozeUpdate).toHaveBeenCalledTimes(1);
		expect(updateDialog()).toBeNull();
	});

	it("Update now opens the installer URL and dismisses", async () => {
		mocks.checkForAppUpdate.mockResolvedValue(UPDATE);
		renderLayout();
		await settleUpdateCheck();
		fireEvent.click(screen.getByRole("button", { name: /update now/i }));
		expect(mocks.open).toHaveBeenCalledWith(
			"https://example.com/app.apk",
			"_blank",
			"noopener",
		);
		expect(updateDialog()).toBeNull();
	});
});
