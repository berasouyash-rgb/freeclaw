// ═══════════════════════════════════════════════════════════════════
// Notifications page — moderation-kind contract
// ═══════════════════════════════════════════════════════════════════
// Locks the fix for: server-sent moderation notifications (warning, ban,
// suspension…) crashed the page because KIND_META had no entry for them
// (meta.icon threw on undefined). Every known kind renders; unknown
// future kinds degrade to info instead of white-screening.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Notifications from "../pages/Notifications";
import type { NotificationKind } from "../types";

const state = vi.hoisted(() => ({
	notifs: [
		{
			id: "n1",
			kind: "warning",
			title: "Official warning issued",
			body: "Be nice",
			at: "2026-08-16T10:00:00.000Z",
			read: false,
		},
		{
			id: "n2",
			kind: "ban",
			title: "Account permanently banned",
			body: "Stop",
			at: "2026-08-16T11:00:00.000Z",
			read: false,
		},
		{
			id: "n3",
			kind: "info",
			title: "Hello",
			body: "World",
			link: "/post/1",
			at: "2026-08-16T12:00:00.000Z",
			read: true,
		},
	] as unknown[],
}));

const WARNING = state.notifs[0];
const BAN = state.notifs[1];
const INFO = state.notifs[2];

const mocks = vi.hoisted(() => ({
	markNotifsRead: vi.fn(),
	markNotifRead: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		notifications: state.notifs,
		markNotifsRead: mocks.markNotifsRead,
		markNotifRead: mocks.markNotifRead,
		clearNotifs: vi.fn(),
	}),
}));

function renderPage() {
	return render(
		<MemoryRouter>
			<Notifications />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	state.notifs = [WARNING, BAN, INFO];
});

describe("Notifications — moderation kinds", () => {
	it("renders warning/ban notifications without crashing", async () => {
		renderPage();
		expect(
			await screen.findByText("Official warning issued"),
		).toBeInTheDocument();
		expect(screen.getByText("Account permanently banned")).toBeInTheDocument();
		// severity filter buttons exist for the new kinds
		expect(screen.getByRole("button", { name: /Warning/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Ban/ })).toBeInTheDocument();
	});

	it("shows an unknown future kind as info instead of crashing", async () => {
		state.notifs = [
			{
				id: "n9",
				kind: "quantum" as unknown as NotificationKind,
				title: "Future notice",
				body: "from tomorrow",
				at: "2026-08-16T12:00:00.000Z",
				read: false,
			},
		];
		renderPage();
		expect(await screen.findByText("Future notice")).toBeInTheDocument();
	});

	it("marks a single notification read when its link is opened", async () => {
		mocks.markNotifRead.mockClear();
		renderPage();
		const link = await screen.findByRole("link", { name: /Hello/ });
		fireEvent.click(link);
		expect(mocks.markNotifRead).toHaveBeenCalledWith("n3");
	});
});
