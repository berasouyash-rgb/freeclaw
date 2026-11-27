import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import StatusPage from "../pages/StatusPage";

vi.mock("../components/FadeIn", () => ({
	default: ({ children }: { children: React.ReactNode }) => children,
}));

function renderStatusPage() {
	return render(
		<MemoryRouter>
			<StatusPage />
		</MemoryRouter>,
	);
}

describe("StatusPage", () => {
	it("labels the page as a static snapshot rather than a live health check", () => {
		renderStatusPage();

		expect(screen.getByRole("heading", { name: "System Status" })).toBeInTheDocument();
		expect(
			screen.getByText(/static snapshot.*not a live health check/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/last checked/i)).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /refresh/i }),
		).not.toBeInTheDocument();
	});

	it("does not expose a public Sentry test control or schedule timers", () => {
		vi.useFakeTimers();
		renderStatusPage();

		expect(screen.queryByText(/sentry error tracking/i)).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /break the world/i })).not.toBeInTheDocument();
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});
});
