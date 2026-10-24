import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionCenter from "../pages/admin/ActionCenter";

const state = vi.hoisted(() => ({
	get: vi.fn(),
	getFresh: vi.fn(),
	realtimeCallback: null as null | ((table: string, payload: unknown) => void),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: state.get,
		getFresh: state.getFresh,
	},
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: vi.fn(
		(_tables: string[], callback: (table: string, payload: unknown) => void) => {
			state.realtimeCallback = callback;
		},
	),
}));

const SUMMARY = {
	generated_at: "2026-09-24T12:00:00.000Z",
	total: 2,
	open: 1,
	critical: 1,
	by_category: [
		{ category: "CRITICAL_MODERATION", label: "Critical Moderation", count: 1 },
		{ category: "SECURITY_INCIDENT", label: "Security Incident", count: 0 },
	],
	recent: [
		{
			id: "ACT-1",
			status: "OPEN",
			category: "CRITICAL_MODERATION",
			title: "Security review required",
			created_at: "2026-09-24T11:55:00.000Z",
			resolved_at: null,
			resolution: null,
		},
		{
			id: "ACT-0",
			status: "RESOLVED",
			category: "PROTECTED_OPERATION",
			title: "Protected action verified",
			created_at: "2026-09-24T11:30:00.000Z",
			resolved_at: "2026-09-24T11:40:00.000Z",
			resolution: "Outcome confirmed",
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	state.realtimeCallback = null;
	state.get.mockResolvedValue(SUMMARY);
	state.getFresh.mockResolvedValue(SUMMARY);
});

describe("Action Center", () => {
	it("loads one bounded human-action snapshot without operational fan-out", async () => {
		render(<ActionCenter />);

		expect(
			await screen.findByRole("heading", { name: "Action Center" }),
		).toBeInTheDocument();
		expect(screen.getByText("Security review required")).toBeInTheDocument();
		expect(screen.getByText("Protected action verified")).toBeInTheDocument();
		expect(state.get).toHaveBeenCalledWith("/api/action-center?action=summary");
		expect(state.get).toHaveBeenCalledTimes(1);
		expect(
			JSON.stringify(state.get.mock.calls).includes("ops-summary"),
		).toBe(false);
	});

	it("marks realtime changes without refetching, then refreshes only on request", async () => {
		render(<ActionCenter />);
		await screen.findByRole("heading", { name: "Action Center" });

		act(() => {
			state.realtimeCallback?.("reports", { eventType: "INSERT" });
		});

		expect(await screen.findByText(/1 new update available/i)).toBeInTheDocument();
		expect(state.get).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "View 1 new update" }));

		await waitFor(() => expect(state.getFresh).toHaveBeenCalledTimes(1));
		expect(state.getFresh).toHaveBeenCalledWith(
			"/api/action-center?action=summary",
		);
		expect(screen.queryByText(/1 new update available/i)).not.toBeInTheDocument();
	});

	it("keeps the last-known snapshot visible when an explicit refresh fails", async () => {		state.getFresh.mockRejectedValueOnce(new Error("temporary unavailable"));

		render(<ActionCenter />);
		await screen.findByRole("heading", { name: "Action Center" });
		expect(screen.getByText("Security review required")).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", { name: "Refresh Action Center" }),
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Showing the last known snapshot",
		);
		expect(screen.getByText("Security review required")).toBeInTheDocument();
	});

	it("lists every open task, not just the first", async () => {
		state.get.mockResolvedValue({
			...SUMMARY,
			open: 2,
			total: 3,
			recent: [
				{
					id: "ACT-1",
					status: "OPEN",
					category: "CRITICAL_MODERATION",
					title: "Security review required",
					created_at: "2026-09-24T11:55:00.000Z",
					resolved_at: null,
					resolution: null,
				},
				{
					id: "ACT-2",
					status: "IN_PROGRESS",
					category: "CRITICAL_MODERATION",
					title: "Second urgent review",
					created_at: "2026-09-24T11:50:00.000Z",
					resolved_at: null,
					resolution: null,
				},
				{
					id: "ACT-0",
					status: "RESOLVED",
					category: "PROTECTED_OPERATION",
					title: "Protected action verified",
					created_at: "2026-09-24T11:30:00.000Z",
					resolved_at: "2026-09-24T11:40:00.000Z",
					resolution: "Outcome confirmed",
				},
			],
		});
		render(<ActionCenter />);
		expect(await screen.findByText("Security review required")).toBeInTheDocument();
		expect(screen.getByText("Second urgent review")).toBeInTheDocument();
	});
});
