import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "../components/CommandPalette";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	hasAdminSession: vi.fn(),
	navigate: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get },
	hasAdminSession: mocks.hasAdminSession,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

vi.mock("react-router", () => ({
	useNavigate: () => mocks.navigate,
}));

describe("CommandPalette admin navigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.get.mockResolvedValue([]);
		mocks.hasAdminSession.mockReturnValue(true);
	});

	function openPalette() {
		render(<CommandPalette />);
		act(() => {
			fireEvent.keyDown(window, { key: "k", ctrlKey: true });
		});
	}

	it("offers canonical admin destinations to an authenticated admin", () => {
		openPalette();

		fireEvent.click(screen.getByRole("button", { name: /ReportsAdmin/i }));

		expect(mocks.navigate).toHaveBeenCalledWith("/admin?tab=reports");
	});

	it("does not expose admin destinations to a regular user", () => {
		mocks.hasAdminSession.mockReturnValue(false);
		openPalette();

		expect(screen.queryByRole("button", { name: /ReportsAdmin/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /AI Coworker/i })).not.toBeInTheDocument();
	});
});
