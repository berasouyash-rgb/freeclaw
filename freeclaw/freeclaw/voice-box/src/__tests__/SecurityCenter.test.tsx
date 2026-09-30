import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SecurityCenter from "../pages/admin/SecurityCenter";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get },
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: vi.fn(),
}));

const SECURITY_EVENT = {
	id: "security-1",
	type: "auth.failure",
	severity: "high" as const,
	source: "auth",
	description: "Repeated failed sign-in attempts",
	created_at: "2026-09-20T10:00:00Z",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue({ events: [SECURITY_EVENT] });
});

describe("SecurityCenter failure states", () => {
	it("shows a retryable error instead of claiming there are no security events", async () => {
		mocks.get.mockRejectedValueOnce(new Error("security service offline"));
		render(<SecurityCenter />);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			/couldn't load security events/i,
		);
		expect(screen.queryByText("No security events recorded")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
	});

	it("keeps last-known events and the success timestamp when refresh fails", async () => {
		const isoSpy = vi.spyOn(Date.prototype, "toISOString");
		render(<SecurityCenter />);
		await screen.findByText("Repeated failed sign-in attempts");
		const initialTimestampCalls = isoSpy.mock.calls.length;

		mocks.get.mockRejectedValueOnce(new Error("refresh failed"));
		fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			/showing last known events/i,
		);
		expect(screen.getByText("Repeated failed sign-in attempts")).toBeInTheDocument();
		expect(isoSpy.mock.calls.length).toBe(initialTimestampCalls);
		isoSpy.mockRestore();
	});
});
