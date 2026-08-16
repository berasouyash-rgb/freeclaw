// ═══════════════════════════════════════════════════════════════════
// AIOperations — honest provider status banner
// When the real runtime reports ai_provider.status === 'degraded' (no
// API key configured anywhere), the command center must surface
// "AI PROVIDER DEGRADED" (Phase 43) — never pretend agents can reason.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIOperations from "../pages/admin/AIOperations";

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("../lib/api", () => ({
	api: {
		get: (...args: unknown[]) => getMock(...args),
		post: (...args: unknown[]) => postMock(...args),
	},
}));
vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: vi.fn() }),
}));

const baseOverview = {
	employees: [],
	recent_tasks: [],
	activity: [],
	metrics: {
		working: 0,
		verifying: 0,
		done: 0,
		total_employees: 0,
		utilized: 0,
		underutilized: 0,
		total_executions: 0,
		completed_executions: 0,
		failed_executions: 0,
		verified_outcomes: 0,
		success_rate: null,
		completion_rate: null,
		avg_duration_ms: null,
	},
	task_queue: {
		total: 0,
		queued: 0,
		claimed: 0,
		working: 0,
		verifying: 0,
		completed: 0,
		failed: 0,
		blocked: 0,
	},
	updated_at: "2026-08-09T10:00:00Z",
};

// The Command workspace (WorkforceConsole) is mounted by default and calls
// the real workforce commands — respond with truthful empty shapes so it
// renders the zero-state without crashing.
function commandGet(url: string) {
	if (String(url).includes("action=impact")) {
		return {
			ok: true,
			impact: {
				posts_hidden: 0,
				posts_restored: 0,
				posts_escalated: 0,
				posts_pinned: 0,
				posts_featured: 0,
				reports_resolved: 0,
				flags_created: 0,
				content_changed: 0,
				verified_actions: 0,
				failed_verifications: 0,
			},
			verification_rate: null,
			executions: { completed: 0, failed: 0, total: 0 },
			evidence: [],
		};
	}
	return baseOverview;
}
function commandPost(body: { action?: string }) {
	switch (body?.action) {
		case "impact":
			return {
				ok: true,
				impact: {
					posts_hidden: 0,
					posts_restored: 0,
					posts_escalated: 0,
					posts_pinned: 0,
					posts_featured: 0,
					reports_resolved: 0,
					flags_created: 0,
					content_changed: 0,
					verified_actions: 0,
					failed_verifications: 0,
				},
				verification_rate: null,
				executions: { completed: 0, failed: 0, total: 0 },
				evidence: [],
			};
		case "pending-approvals":
			return { ok: true, approvals: [] };
		case "approval-history":
			return { ok: true, history: [] };
		case "activity":
			return { ok: true, activity: [] };
		case "overview":
			return baseOverview;
		default:
			return { ok: true };
	}
}

describe("AIOperations provider-degraded banner", () => {
	const degraded = {
		...baseOverview,
		ai_provider: {
			ok: false,
			status: "degraded",
			note: "AI PROVIDER DEGRADED — no API key configured",
		},
	};
	const ready = {
		...baseOverview,
		ai_provider: { ok: true, status: "ready", note: "AI provider configured" },
	};

	beforeEach(() => {
		vi.clearAllMocks();
		getMock.mockImplementation((url: string) =>
			Promise.resolve(
				String(url).includes("action=impact") ? commandGet(url) : degraded,
			),
		);
		postMock.mockImplementation(commandPost);
	});

	it("shows the AI PROVIDER DEGRADED banner when the runtime reports it", async () => {
		render(<AIOperations />);
		await waitFor(() => {
			expect(screen.getByText(/AI provider degraded/i)).toBeTruthy();
		});
		expect(screen.getByText(/no API key configured/i)).toBeTruthy();
		expect(screen.getByText(/data-only patrols/i)).toBeTruthy();
	});

	it("does NOT show the banner when a provider is ready", async () => {
		getMock.mockImplementation((url: string) =>
			Promise.resolve(
				String(url).includes("action=impact") ? commandGet(url) : ready,
			),
		);
		render(<AIOperations />);
		await waitFor(() => {
			expect(getMock).toHaveBeenCalled();
		});
		expect(screen.queryByText(/AI provider degraded/i)).toBeNull();
		expect(screen.queryByText(/no API key configured/i)).toBeNull();
	});
});
