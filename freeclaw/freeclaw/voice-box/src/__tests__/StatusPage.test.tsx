import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StatusPage from "../pages/StatusPage";

vi.mock("../components/FadeIn", () => ({
	default: ({ children }: { children: React.ReactNode }) => children,
}));

describe("StatusPage", () => {
	it("labels the page as a static snapshot rather than a live health check", () => {
		render(<StatusPage />);

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
		render(<StatusPage />);

		expect(screen.queryByText(/sentry error tracking/i)).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /break the world/i })).not.toBeInTheDocument();
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});
});
