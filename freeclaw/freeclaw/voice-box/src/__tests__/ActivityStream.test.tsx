// ═══════════════════════════════════════════════════════════════════
// ActivityStream — ops-summary contract
// ═══════════════════════════════════════════════════════════════════
// Locks the fix for the permanently-empty stream: the tab used to read
// `events` and `tasks?action=ledger` — keys the server never sends — so
// it always rendered "No events recorded yet". It now maps the real
// ops-summary keys: recent_tasks (task rows) and recent (executions).
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivityStream from "../pages/admin/ActivityStream";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	realtimeCb: null as null | (() => void | Promise<void>),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get },
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (_topics: unknown, cb: () => void | Promise<void>) => {
		mocks.realtimeCb = cb;
	},
}));

const OPS_SUMMARY = {
	ok: true,
	recent_tasks: [
		{
			id: "task-1",
			title: "Nightly patrol sweep",
			status: "completed",
			priority: "medium",
			assigned_agent: "patrol-agent",
			error: null,
			created_at: "2026-09-20T10:00:00Z",
			completed_at: "2026-09-20T10:05:00Z",
		},
		{
			id: "task-2",
			title: "Spam wave triage",
			status: "failed",
			priority: "high",
			assigned_agent: "triage-agent",
			error: "provider timeout",
			created_at: "2026-09-20T11:00:00Z",
			completed_at: null,
		},
	],
	recent: [
		{
			worker: "patrol-agent",
			action: "nightly sweep — completed",
			at: "2026-09-20T10:05:00Z",
			impact: "120ms",
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.realtimeCb = null;
	mocks.get.mockResolvedValue(OPS_SUMMARY);
});

describe("ActivityStream — ops-summary contract", () => {
	it("requests the one action the server implements", async () => {
		render(<ActivityStream />);
		await screen.findByText(/3 events loaded/);
		expect(mocks.get).toHaveBeenCalledWith("/api/workforce?action=ops-summary");
		expect(mocks.get).not.toHaveBeenCalledWith(
			expect.stringContaining("action=ledger"),
		);
	});

	it("renders task rows and execution rows instead of the empty state", async () => {
		render(<ActivityStream />);
		await screen.findByText(/Nightly patrol sweep/);
		expect(screen.getByText(/Spam wave triage/)).toBeInTheDocument();
		expect(screen.getByText(/provider timeout/)).toBeInTheDocument();
		expect(screen.queryByText("No events recorded yet")).not.toBeInTheDocument();
	});

	it("keeps id-less execution rows instead of collapsing them into one", async () => {
		mocks.get.mockResolvedValue({
			ok: true,
			recent_tasks: [],
			recent: [
				{ worker: "a1", action: "run — completed", at: "2026-09-20T10:00:00Z" },
				{ worker: "a2", action: "run — completed", at: "2026-09-20T10:01:00Z" },
			],
		});
		render(<ActivityStream />);
		await screen.findByText(/2 events loaded/);
	});

	it("shows a retryable error instead of claiming there are no events", async () => {
		mocks.get.mockRejectedValueOnce(new Error("activity service offline"));
		render(<ActivityStream />);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			/couldn't load activity events/i,
		);
		expect(screen.queryByText("No events recorded yet")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
	});

	it("keeps the last known events visible when a refresh fails", async () => {
		mocks.get
			.mockResolvedValueOnce(OPS_SUMMARY)
			.mockRejectedValueOnce(new Error("refresh failed"));
		render(<ActivityStream />);
		await screen.findByText(/Nightly patrol sweep/);

		fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			/showing last known events/i,
		);
		expect(screen.getByText(/Nightly patrol sweep/)).toBeInTheDocument();
	});
});
