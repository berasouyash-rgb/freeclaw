// ═══════════════════════════════════════════════════════════════════
// CriticalAlertBanner — full-screen danger takeover vs inline banner
// ═══════════════════════════════════════════════════════════════════
// Locks:
//   1. No open alerts → nothing renders
//   2. Critical severity → full-screen overlay (fixed, data-testid) + alertdialog
//   3. High severity only → inline banner (no overlay)
//   4. Acknowledge + Open console buttons call their callbacks
//   5. Multiple open alerts → "+N more" badge; critical wins over high
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	agentName,
	CriticalAlertBanner,
	timeAgo,
	type AlertRow,
} from "../components/admin/CriticalAlertBanner";

const baseAlert = (over: Partial<AlertRow>): AlertRow => ({
	id: "a1",
	key: "spam_cluster",
	severity: "critical",
	title: "Coordinated spam detected",
	body: "17 accounts posting the same link",
	agent: "security-monitor",
	evidence: "42 actions, 6 shared IP patterns",
	occurrences: 3,
	acknowledged_at: null,
	acknowledged_by: null,
	resolved_at: null,
	resolved_by: null,
	created_at: new Date().toISOString(),
	last_at: new Date().toISOString(),
	...over,
});

describe("CriticalAlertBanner", () => {
	it("renders nothing when there are no open alerts", () => {
		const { container } = render(
			<CriticalAlertBanner
				alerts={[baseAlert({ resolved_at: new Date().toISOString() })]}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders a full-screen takeover overlay for critical severity", () => {
		render(<CriticalAlertBanner alerts={[baseAlert({})]} />);
		const overlay = screen.getByTestId("critical-overlay");
		expect(overlay.className).toContain("fixed");
		expect(overlay.className).toContain("inset-0");
		expect(overlay.className).toContain("z-[120]");
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(screen.getByText(/CRITICAL DETECTED/i)).toBeTruthy();
		expect(screen.getByText(/Coordinated spam detected/i)).toBeTruthy();
		expect(screen.getByText(/17 accounts posting the same link/i)).toBeTruthy();
	});

	it("renders an inline banner (not an overlay) for high severity", () => {
		render(
			<CriticalAlertBanner
				alerts={[baseAlert({ severity: "high", title: "Queue is slow" })]}
			/>,
		);
		expect(screen.queryByTestId("critical-overlay")).toBeNull();
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByText(/HIGH PRIORITY/i)).toBeTruthy();
	});

	it("acknowledge and open-console call their callbacks", () => {
		const onAck = vi.fn();
		const onOpen = vi.fn();
		render(
			<CriticalAlertBanner
				alerts={[baseAlert({})]}
				onAcknowledge={onAck}
				onOpenWorkforce={onOpen}
			/>,
		);
		screen.getByRole("button", { name: "Acknowledge" }).click();
		expect(onAck).toHaveBeenCalledWith("a1");
		screen.getByRole("button", { name: /Open console/i }).click();
		expect(onOpen).toHaveBeenCalled();
	});

	it("shows the +N more badge for stacked critical alerts", () => {
		render(
			<CriticalAlertBanner
				alerts={[
					baseAlert({ id: "c1", severity: "critical", title: "Critical one" }),
					baseAlert({ id: "c2", severity: "critical", title: "Critical two" }),
				]}
			/>,
		);
		expect(
			screen.getAllByText((_, el) => el?.textContent?.includes("+1 more open alert") ?? false).length,
		).toBeGreaterThan(0);
	});

	it("prefers the critical overlay over a high banner", () => {
		render(
			<CriticalAlertBanner
				alerts={[
					baseAlert({ id: "c1", severity: "critical", title: "Critical one" }),
					baseAlert({ id: "h1", severity: "high", title: "High one" }),
				]}
			/>,
		);
		expect(screen.getByTestId("critical-overlay")).toBeTruthy();
		expect(screen.getByText(/Critical one/i)).toBeTruthy();
		expect(screen.queryByText(/High one/i)).toBeNull();
	});

	it("shows occurrence count, detector, and evidence", () => {
		render(<CriticalAlertBanner alerts={[baseAlert({})]} />);
		expect(screen.getByText(/×3 occurrences/i)).toBeTruthy();
		expect(screen.getByText(/Detected by Security Monitor/i)).toBeTruthy();
		expect(screen.getByText(/evidence: 42 actions, 6 shared IP patterns/i)).toBeTruthy();
	});

	it("dismisses the overlay once the alert is acknowledged", () => {
		const { rerender } = render(
			<CriticalAlertBanner
				alerts={[baseAlert({ acknowledged_at: null })]}
			/>,
		);
		expect(screen.getByTestId("critical-overlay")).toBeTruthy();
		rerender(
			<CriticalAlertBanner
				alerts={[
					baseAlert({ acknowledged_at: new Date().toISOString() }),
				]}
			/>,
		);
		expect(screen.queryByTestId("critical-overlay")).toBeNull();
	});
});

describe("timeAgo", () => {
	it("handles null, now, and recent windows", () => {
		expect(timeAgo(null)).toBe("never");
		expect(timeAgo(new Date().toISOString())).toMatch(/now|just now/);
		expect(timeAgo(new Date(Date.now() - 2 * 60 * 1000).toISOString())).toBe(
			"2m ago",
		);
		expect(timeAgo(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())).toBe(
			"3h ago",
		);
	});
});

describe("agentName", () => {
	it("title-cases hyphenated ids", () => {
		expect(agentName("security-monitor")).toBe("Security Monitor");
		expect(agentName(null)).toBe("Unassigned");
	});
});
