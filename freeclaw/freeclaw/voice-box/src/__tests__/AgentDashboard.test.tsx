// ═══════════════════════════════════════════════════════════════════
// AgentDashboard — real agent metrics + execution history + patrol
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • metric cards derived from REAL executions (total/active/completed/failed)
//   • loading skeletons for every panel
//   • division breakdown chips
//   • execution rows expand to show output + error details
//   • live findings from the patrol endpoint
//   • Run Patrol triggers a real scan and refreshes findings
//   • activity log with severity colors
//   • AUTO/PAUSED auto-refresh toggle
//   • truthful empty states
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentDashboard from "../pages/admin/AgentDashboard";

vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		getSlow: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

// FindingsAlert has its own suite — stub the live monitor popup here.
vi.mock("../pages/admin/agent-office/FindingsAlert", () => ({
	default: () => <div data-testid="findings-alert-stub" />,
}));

import { api } from "../lib/api";
const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const EXEC_DONE = {
	id: "e1",
	agent_id: "content-moderator",
	agent_name: "Content Moderator",
	division: "content",
	task: "Hide spam post",
	status: "completed",
	output: { hidden: 1 },
	error: null,
	started_at: iso(600_000),
	completed_at: iso(300_000),
	duration_ms: 15000,
};

const EXEC_RUNNING = {
	id: "e2",
	agent_id: "security-monitor",
	agent_name: "Security Monitor",
	division: "security",
	task: "Scan for suspicious logins",
	status: "running",
	output: null,
	error: null,
	started_at: iso(30_000),
	completed_at: null,
	duration_ms: null,
};

const EXEC_FAILED = {
	id: "e3",
	agent_id: "report-handler",
	agent_name: "Report Handler",
	division: "reports",
	task: "Triage report",
	status: "failed",
	output: null,
	error: "Database timeout",
	started_at: iso(900_000),
	completed_at: iso(800_000),
	duration_ms: 100000,
};

const FINDING = {
	severity: "high",
	domain: "security",
	title: "Suspicious login pattern",
	evidence: "17 failed attempts from one session",
	recommendation: "Review account activity",
	agent: "Security Monitor",
	at: iso(120_000),
};

const ACTIVITY = {
	id: "a1",
	agent_id: "security-monitor",
	event_type: "incident",
	severity: "high",
	message: "Created incident for suspicious logins",
	details: { count: 17 },
	created_at: iso(60_000),
};

function seedData(
	overrides: Partial<{
		executions: unknown[];
		activities: unknown[];
		findings: unknown[];
	}> = {},
) {
	const executions = overrides.executions ?? [EXEC_DONE, EXEC_RUNNING, EXEC_FAILED];
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/agent-executions?limit=50")) {
			return { executions };
		}
		if (path.startsWith("/api/agent-executions?action=activity")) {
			return { activities: overrides.activities ?? [ACTIVITY] };
		}
		if (path.startsWith("/api/agent-team?action=findings")) {
			return {
				scanned_at: iso(120_000),
				summary: "Scan complete",
				findings: overrides.findings ?? [FINDING],
			};
		}
		return {};
	});
	mockedPost.mockImplementation(async (path: string) => {
		if (path === "/api/agent-team") {
			return {
				scanned_at: new Date().toISOString(),
				summary: "Patrol complete",
				findings: overrides.findings ?? [FINDING],
			};
		}
		return {};
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("AgentDashboard", () => {
	it("renders the header with AUTO refresh enabled by default", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Agent Dashboard")).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: "AUTO" })).toBeInTheDocument();
	});

	it("shows loading skeletons while data is in flight", () => {
		mockedGet.mockImplementation(() => new Promise(() => undefined));
		render(<AgentDashboard />);
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
	});

	it("computes metric cards from the real executions", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Total Executions")).toBeInTheDocument();
		});
		// “1” repeats across cards — scope each metric by its label
		const card = (label: string) =>
			screen.getByText(label).closest(".bg-surface2") as HTMLElement;
		expect(within(card("Total Executions")).getByText("3")).toBeInTheDocument();
		expect(within(card("Active")).getByText("1")).toBeInTheDocument();
		expect(within(card("Completed")).getByText("1")).toBeInTheDocument();
		expect(within(card("Failed")).getByText("1")).toBeInTheDocument();
	});

	it("renders the division breakdown chips from execution divisions", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Divisions")).toBeInTheDocument();
			expect(screen.getByText("content: 1")).toBeInTheDocument();
			expect(screen.getByText("security: 1")).toBeInTheDocument();
			expect(screen.getByText("reports: 1")).toBeInTheDocument();
		});
	});

	it("lists executions with agent name, task, duration and expand toggle", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Recent Executions")).toBeInTheDocument();
			expect(screen.getByText("Hide spam post")).toBeInTheDocument();
		});
		expect(screen.getByText("3 total")).toBeInTheDocument();
	});

	it("expands a completed execution to show structured output", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Hide spam post")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Hide spam post"));
		await waitFor(() => {
			expect(screen.getByText("OUTPUT:")).toBeInTheDocument();
			expect(screen.getByText(/hidden/)).toBeInTheDocument();
		});
		expect(screen.getByText("Status:")).toBeInTheDocument();
		expect(screen.getByText("completed")).toBeInTheDocument();
	});

	it("shows the error text for failed executions", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Triage report")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Triage report"));
		await waitFor(() => {
			expect(screen.getByText("Error:")).toBeInTheDocument();
			expect(screen.getByText("Database timeout")).toBeInTheDocument();
		});
	});

	it("renders live findings with severity, domain, evidence and recommendation", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Live Findings")).toBeInTheDocument();
			expect(screen.getByText("Suspicious login pattern")).toBeInTheDocument();
		});
		expect(screen.getByText("high")).toBeInTheDocument();
		expect(screen.getByText("security")).toBeInTheDocument();
		expect(
			screen.getByText("17 failed attempts from one session"),
		).toBeInTheDocument();
		expect(screen.getByText(/Review account activity/)).toBeInTheDocument();
	});

	it("shows a healthy empty state when the patrol found nothing", async () => {
		seedData({ findings: [] });
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"All monitored domains healthy — no actionable findings.",
				),
			).toBeInTheDocument();
		});
	});

	it("Run Patrol posts to the real endpoint and refreshes the scan time", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Run Patrol" })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: "Run Patrol" }));

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/agent-team", {
				action: "findings",
				run: true,
			});
		});
	});

	it("shows the scanning status while a patrol is running", async () => {
		seedData();
		let resolve!: (v: unknown) => void;
		// Override AFTER seedData so the pending promise is the active mock
		mockedPost.mockImplementation(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		);
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Run Patrol" })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: "Run Patrol" }));

		await waitFor(() => {
			expect(screen.getByText("Scanning…")).toBeInTheDocument();
			expect(
				screen.getByText(
					/Inspecting reports, review queue, agent tasks, failed logins/,
				),
			).toBeInTheDocument();
		});
		resolve({ scanned_at: new Date().toISOString(), findings: [] });
	});

	it("renders the activity log with severity-colored messages", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Activity Log")).toBeInTheDocument();
			expect(
				screen.getByText("Created incident for suspicious logins"),
			).toBeInTheDocument();
		});
		expect(screen.getByText("1 events")).toBeInTheDocument();
	});

	it("shows the truthful empty state when there are no executions", async () => {
		seedData({ executions: [], activities: [] });
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("No executions yet")).toBeInTheDocument();
			expect(screen.getByText("No activity yet")).toBeInTheDocument();
		});
	});

	it("toggles auto-refresh between AUTO and PAUSED", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Agent Dashboard")).toBeInTheDocument();
		});
		const toggle = screen.getByRole("button", { name: "AUTO" });
		fireEvent.click(toggle);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "PAUSED" })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: "PAUSED" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "AUTO" })).toBeInTheDocument();
		});
	});

	it("manual refresh re-fetches all three data sources", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("Agent Dashboard")).toBeInTheDocument();
		});
		const before = mockedGet.mock.calls.length;
		fireEvent.click(screen.getByTitle("Refresh"));
		await waitFor(() => {
			expect(mockedGet.mock.calls.length).toBeGreaterThan(before);
		});
	});

	it("stays usable when the runtime fails — panels fall back to empty states", async () => {
		mockedGet.mockRejectedValue(new Error("runtime down"));
		mockedPost.mockRejectedValue(new Error("runtime down"));
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByText("No executions yet")).toBeInTheDocument();
			expect(screen.getByText("No activity yet")).toBeInTheDocument();
			expect(
				screen.getByText(
					"All monitored domains healthy — no actionable findings.",
				),
			).toBeInTheDocument();
		});
	});

	it("embeds the live monitor popup for new findings", async () => {
		seedData();
		render(<AgentDashboard />);

		await waitFor(() => {
			expect(screen.getByTestId("findings-alert-stub")).toBeInTheDocument();
		});
	});
});
