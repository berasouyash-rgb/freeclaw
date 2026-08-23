// ═══════════════════════════════════════════════════════════════
// FindingsAlert — live monitor popups (real patrol output)
// Asserts: polls the findings endpoint, surfaces NEW findings with
// severity + snapshot, dismisses on X, auto-dismisses, silent when
// nothing new / nothing found.
// ═══════════════════════════════════════════════════════════════

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import FindingsAlert from "../pages/admin/agent-office/FindingsAlert";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../lib/api", () => ({ api: { get: mocks.get } }));

const FINDING = {
	severity: "high",
	domain: "security",
	title: "8 failed login attempts in the last 24h",
	evidence: "Repeated password failures against the admin endpoint.",
	recommendation: "Rotate the admin password if suspicious.",
	agent: "security-monitor",
	at: "2026-08-09T12:00:00.000Z",
	snapshot: [
		{ id: "1", at: "Aug 9, 12:36 PM" },
		{ id: "2", at: "Aug 9, 09:36 AM" },
	],
};

beforeEach(() => {
	mocks.get.mockReset();
	vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
	vi.useRealTimers();
});

describe("FindingsAlert", () => {
	it("pops up when a NEW finding arrives, with details and snapshot", async () => {
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:01:00Z",
			summary: "1 finding",
			findings: [FINDING],
		});
		render(<FindingsAlert pollMs={60000} />);
		await act(async () => {
			await Promise.resolve();
		});
		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
		expect(screen.getByText(/failed login attempts/i)).toBeInTheDocument();
		expect(screen.getAllByText(/security/i).length).toBeGreaterThan(0);
		expect(screen.getByText(/Rotate the admin password/i)).toBeInTheDocument();
		expect(screen.getByText(/security-monitor/)).toBeInTheDocument();
		expect(screen.getByText(/📸 Snapshot/)).toBeInTheDocument();
		// snapshot rows rendered
		expect(screen.getByText("Aug 9, 12:36 PM")).toBeInTheDocument();
	});

	it("does NOT re-popup the same finding on subsequent polls (even with a new timestamp)", async () => {
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:01:00Z",
			summary: "1 finding",
			findings: [FINDING],
		});
		render(<FindingsAlert pollMs={1000} />);
		await act(async () => {
			await Promise.resolve();
		});
		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
		// Next poll returns the same finding with a NEW `at` — must NOT stack a second popup
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:02:00Z",
			summary: "1 finding",
			findings: [{ ...FINDING, at: "2026-08-09T12:02:00.000Z" }],
		});
		await act(async () => {
			vi.advanceTimersByTime(1100);
			await Promise.resolve();
		});
		expect(screen.getAllByRole("alert")).toHaveLength(1);
	});

	it("stays silent when findings list is empty", async () => {
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:01:00Z",
			summary: "healthy",
			findings: [],
		});
		render(<FindingsAlert pollMs={1000} />);
		await act(async () => {
			await Promise.resolve();
		});
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("dismisses a popup when X is clicked", async () => {
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:01:00Z",
			summary: "1 finding",
			findings: [FINDING],
		});
		render(<FindingsAlert pollMs={60000} />);
		await act(async () => {
			await Promise.resolve();
		});
		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
		await userEvent.click(screen.getByLabelText("Dismiss alert"));
		await waitFor(() =>
			expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
		);
	});

	it("auto-dismisses a popup after the display window", async () => {
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:01:00Z",
			summary: "1 finding",
			findings: [FINDING],
		});
		render(<FindingsAlert pollMs={60000} />);
		await act(async () => {
			await Promise.resolve();
		});
		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
		await act(async () => {
			vi.advanceTimersByTime(15000);
			await Promise.resolve();
		});
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("shows a one-click action button and a 'What to do' block on every popup", async () => {
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:01:00Z",
			summary: "1 finding",
			findings: [FINDING],
		});
		render(<FindingsAlert pollMs={60000} />);
		await act(async () => {
			await Promise.resolve();
		});
		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
		expect(screen.getByText("What to do")).toBeInTheDocument();
		expect(screen.getByText(/Rotate the admin password/i)).toBeInTheDocument();
		// security domain → Ops Center action
		const action = screen.getByRole("button", { name: /Open Ops Center/ });
		expect(action).toBeInTheDocument();
	});

	it("one-click action navigates to the matching admin tab and dismisses the popup", async () => {
		mocks.get.mockResolvedValue({
			scanned_at: "2026-08-09T12:01:00Z",
			summary: "1 finding",
			findings: [FINDING],
		});
		const navs: string[] = [];
		const onNav = (e: Event) => navs.push((e as CustomEvent).detail as string);
		window.addEventListener("vb:admin-tab", onNav);
		render(<FindingsAlert pollMs={60000} />);
		await act(async () => {
			await Promise.resolve();
		});
		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
		await userEvent.click(
			screen.getByRole("button", { name: /Open Ops Center/ }),
		);
		expect(navs).toContain("ops-center");
		await waitFor(() =>
			expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
		);
		window.removeEventListener("vb:admin-tab", onNav);
	});

	it("maps each finding domain to its own admin tab destination", async () => {
		const cases: Array<{ domain: string; tab: string; label: RegExp }> = [
			{ domain: "moderation", tab: "reports", label: /Open Reports/ },
			{ domain: "content", tab: "reports", label: /Review Content/ },
			{ domain: "workforce", tab: "agent-dashboard", label: /Open Agent Dashboard/ },
			{ domain: "community", tab: "posts", label: /Open Feed/ },
			{ domain: "users", tab: "users", label: /Open Users/ },
			{ domain: "totally-unknown", tab: "overview", label: /Open Dashboard/ },
		];
		const navs: string[] = [];
		const onNav = (e: Event) => navs.push((e as CustomEvent).detail as string);
		window.addEventListener("vb:admin-tab", onNav);
		for (const c of cases) {
			mocks.get.mockResolvedValue({
				scanned_at: "2026-08-09T12:01:00Z",
				summary: "1 finding",
				findings: [{ ...FINDING, domain: c.domain, title: `case ${c.domain}` }],
			});
			const { unmount } = render(<FindingsAlert pollMs={60000} />);
			await act(async () => {
				await Promise.resolve();
			});
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: c.label }),
				).toBeInTheDocument(),
			);
			await userEvent.click(screen.getByRole("button", { name: c.label }));
			expect(navs).toContain(c.tab);
			unmount();
		}
		window.removeEventListener("vb:admin-tab", onNav);
	});
});
