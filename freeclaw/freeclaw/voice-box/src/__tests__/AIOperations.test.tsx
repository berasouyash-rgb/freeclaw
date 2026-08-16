// ═══════════════════════════════════════════════════════════════════
// AIOperations — the single command-center shell for the AI workforce
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • header + LIVE chip + sync time
//   • honest provider status banner (degraded when no API key)
//   • live KPI strip fed by the REAL runtime (working / verifying /
//     verified outcomes / approvals / success rate / queue)
//   • section switcher (Command / Office / Reports & Review) with counts
//   • failed-executions badge
//   • manual refresh re-syncs and toasts
//   • each workspace mounts the real component
//   • truthful zero-state KPIs before the runtime answers
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIOperations from "../pages/admin/AIOperations";

vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		getSlow: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: toastMock }),
}));

// Child workspaces have their own dedicated suites — stub them so this
// suite focuses on the shell: KPI strip, section switching, provider status.
vi.mock("../pages/admin/WorkforceConsole", () => ({
	default: () => <div data-testid="workspace-command">Command workspace</div>,
}));
vi.mock("../pages/admin/AgentTeamPanel", () => ({
	default: () => <div data-testid="workspace-office">Office workspace</div>,
}));
vi.mock("../pages/admin/Reports", () => ({
	default: () => <div data-testid="workspace-review">Review workspace</div>,
}));
vi.mock("../pages/admin/agent-office/ApprovalAlert", () => ({
	default: () => <div data-testid="approval-alert-stub" />,
}));

const toastMock = vi.fn();

import { api } from "../lib/api";
const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;

const OVERVIEW = {
	metrics: {
		working: 3,
		verifying: 2,
		done: 40,
		total_employees: 111,
		utilized: 45,
		underutilized: 66,
		total_executions: 500,
		completed_executions: 470,
		failed_executions: 9,
		verified_outcomes: 88,
		success_rate: 92,
		completion_rate: 94,
		avg_duration_ms: 8500,
	},
	task_queue: {
		total: 21,
		queued: 6,
		claimed: 4,
		working: 3,
		verifying: 2,
		completed: 6,
		failed: 9,
		blocked: 1,
	},
	ai_provider: { ok: true, status: "ready", note: "AI provider configured" },
	updated_at: new Date().toISOString(),
};

function seedOverview(overrides: Partial<typeof OVERVIEW> = {}) {
	const overview = { ...OVERVIEW, ...overrides };
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/workforce?action=overview")) return overview;
		return {};
	});
	mockedPost.mockImplementation(async (path: string) => {
		if (path === "/api/workforce") return { approvals: [{ id: "a1" }, { id: "a2" }] };
		return { approvals: [] };
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	toastMock.mockReset();
});

describe("AIOperations (workforce command center)", () => {
	it("renders the header with title, LIVE chip and sync note", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
			expect(screen.getByText("LIVE")).toBeInTheDocument();
			expect(screen.getByText(/synced just now/)).toBeInTheDocument();
		});
	});

	it("shows the KPI strip with real runtime numbers", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("Working now")).toBeInTheDocument();
			expect(screen.getByText("Verifying")).toBeInTheDocument();
			expect(screen.getByText("Verified outcomes")).toBeInTheDocument();
			expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
			expect(screen.getByText("Verified success")).toBeInTheDocument();
			expect(screen.getByText("Tasks in queue")).toBeInTheDocument();
		});
		expect(screen.getByText("3")).toBeInTheDocument(); // working
		expect(screen.getByText("88")).toBeInTheDocument(); // verified
		expect(screen.getByText("92%")).toBeInTheDocument(); // success
		// “21” also appears as the Command section badge — scope to the queue card
		const queueCard = screen
			.getByText("Tasks in queue")
			.closest(".rounded-xl") as HTMLElement;
		expect(within(queueCard).getByText("21")).toBeInTheDocument();
	});

	it("shows the approval count from the pending-approvals endpoint", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "pending-approvals",
			});
		});
		// Awaiting approval KPI shows 2 pending
		const kpi = screen
			.getByText("Awaiting approval")
			.closest(".rounded-xl") as HTMLElement;
		expect(within(kpi).getByText("2")).toBeInTheDocument();
	});

	it("shows a degraded-provider banner when the AI provider is degraded", async () => {
		seedOverview({
			ai_provider: { ok: false, status: "degraded", note: "no key" },
		});
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("AI provider degraded")).toBeInTheDocument();
			expect(
				screen.getByText(/no API key configured\. Agents run data-only patrols/),
			).toBeInTheDocument();
		});
	});

	it("omits the degraded banner when the provider is ready", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
		});
		expect(
			screen.queryByText("AI provider degraded"),
		).not.toBeInTheDocument();
	});

	it("renders the section switcher with live counts on each workspace", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Command/ })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: /Office/ })).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: /Reports & Review/ }),
			).toBeInTheDocument();
		});
		// Command shows queue total, Office shows employee total, Review shows approvals
		const command = screen.getByRole("button", { name: /Command/ });
		expect(within(command).getByText("21")).toBeInTheDocument();
		const office = screen.getByRole("button", { name: /Office/ });
		expect(within(office).getByText("111")).toBeInTheDocument();
		const review = screen.getByRole("button", { name: /Reports & Review/ });
		expect(within(review).getByText("2")).toBeInTheDocument();
	});

	it("mounts the Command workspace by default", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByTestId("workspace-command")).toBeInTheDocument();
		});
	});

	it("switches to the Office workspace when selected", async () => {
		seedOverview();
		render(<AIOperations />);

		fireEvent.click(screen.getByRole("button", { name: /Office/ }));
		await waitFor(() => {
			expect(screen.getByTestId("workspace-office")).toBeInTheDocument();
			expect(screen.queryByTestId("workspace-command")).not.toBeInTheDocument();
		});
	});

	it("switches to the Reports & Review workspace when selected", async () => {
		seedOverview();
		render(<AIOperations />);

		fireEvent.click(screen.getByRole("button", { name: /Reports & Review/ }));
		await waitFor(() => {
			expect(screen.getByTestId("workspace-review")).toBeInTheDocument();
		});
	});

	it("shows a failed-executions badge when the runtime reports failures", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("9 failed")).toBeInTheDocument();
		});
	});

	it("hides the failed badge when there are zero failures", async () => {
		seedOverview({
			metrics: { ...OVERVIEW.metrics, failed_executions: 0 },
			task_queue: { ...OVERVIEW.task_queue, failed: 0 },
		});
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
		});
		expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
	});

	it("manual refresh re-syncs the KPIs and confirms via toast", async () => {
		seedOverview();
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("Working now")).toBeInTheDocument();
		});
		const syncBtn = screen.getByTitle("Sync operations data");
		fireEvent.click(syncBtn);

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Operations synced", "ok");
		});
		// the overview was re-fetched
		const overviewCalls = mockedGet.mock.calls.filter((c) =>
			String(c[0]).includes("action=overview"),
		);
		expect(overviewCalls.length).toBeGreaterThan(1);
	});

	it("survives a failed overview fetch — KPIs fall back to zero, page still renders", async () => {
		mockedGet.mockRejectedValue(new Error("runtime down"));
		mockedPost.mockResolvedValue({ approvals: [] });
		render(<AIOperations />);

		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
		});
		// zeros and honest dashes, not crashes
		expect(screen.getByText("Working now")).toBeInTheDocument();
		expect(screen.getByText("Verified success")).toBeInTheDocument();
		const successCard = screen
			.getByText("Verified success")
			.closest(".rounded-xl") as HTMLElement;
		// success rate is unknown (not 0) when the runtime is unreachable — an honest dash
		expect(within(successCard).getByText("—")).toBeInTheDocument();
	});

	it("refreshes KPIs when the tab becomes visible again", async () => {
		seedOverview();
		render(<AIOperations />);
		await waitFor(() => {
			expect(screen.getByText("Working now")).toBeInTheDocument();
		});
		// The Command workspace owns its own overview loop, so move to Office —
		// the shell must re-sync its KPI strip when the tab regains focus.
		fireEvent.click(screen.getByRole("button", { name: /Office/ }));
		await waitFor(() => {
			expect(screen.getByTestId("workspace-office")).toBeInTheDocument();
		});

		const before = mockedGet.mock.calls.filter((c) =>
			String(c[0]).includes("action=overview"),
		).length;
		Object.defineProperty(document, "hidden", {
			value: false,
			writable: true,
		});
		fireEvent(document, new Event("visibilitychange"));
		await waitFor(() => {
			expect(
				mockedGet.mock.calls.filter((c) =>
					String(c[0]).includes("action=overview"),
				).length,
			).toBeGreaterThan(before);
		});
	});
});
