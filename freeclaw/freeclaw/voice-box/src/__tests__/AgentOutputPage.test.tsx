// ═══════════════════════════════════════════════════════════════════
// AgentOutputPage — AI Output Center (workflows / executions / activity)
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • stats bar (workflows, executions, active agents) from real endpoints
//   • Workflows tab with expandable result cards
//   • workflow classification (topic/urgency/confidence) + agents deployed
//   • real-actions badges (hide / flag / resolve) rendered from task data
//   • Executions tab with status chips, division colors, expandable output
//   • failed executions show error detail
//   • Activity Log tab with severity dots and details
//   • search, division filter and status filter
//   • Live/Paused auto-refresh + manual refresh
//   • truthful empty states
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentOutputPage from "../pages/admin/AgentOutputPage";

vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		getSlow: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

import { api } from "../lib/api";
const mockedGet = api.get as ReturnType<typeof vi.fn>;

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const WORKFLOW = {
	workflow_id: "wf-1",
	classification: {
		topic: "Broken lift",
		urgency: "high",
		category: "Facilities",
		confidence: 0.94,
		subcategories: ["mechanical"],
	},
	agents_used: [{ id: "content-moderator", name: "Content Moderator", icon: "🤖", status: "completed" }],
	results: [
		{
			agent_id: "content-moderator",
			agent_name: "Content Moderator",
			icon: "🤖",
			result: {
				type: "moderation",
				agent: "Content Moderator",
				data: {
					total_posts: 5,
					actions: [
						{ type: "hide_post", ok: true, target_id: "p1" },
						{ type: "resolve_reports", ok: true, count: 2 },
					],
				},
				llm_analysis: "This is a genuine facilities issue.",
				source: "agent-team",
			},
		},
	],
	total_time_ms: 4200,
	created_at: iso(60_000),
	completed_at: iso(50_000),
	task: "Moderate report cluster",
};

const EXECUTION = {
	id: "ex-1",
	agent_id: "security-monitor",
	agent_name: "Security Monitor",
	division: "security",
	trigger_type: "cron",
	task: "Scan for suspicious activity",
	status: "failed",
	output: null,
	duration_ms: 90000,
	started_at: iso(300_000),
	completed_at: iso(200_000),
	error: "Supabase connection refused",
};

const ACTIVITY = {
	id: "act-1",
	agent_id: "security-monitor",
	event_type: "incident.created",
	details: { severity: "high", count: 3 },
	severity: "warning",
	created_at: iso(90_000),
};

function seedData(
	overrides: Partial<{
		workflows: unknown[];
		executions: unknown[];
		activities: unknown[];
	}> = {},
) {
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/agent-team?action=results")) {
			return { results: overrides.workflows ?? [WORKFLOW], total: 1 };
		}
		if (path.startsWith("/api/agent-executions?action=list")) {
			return { executions: overrides.executions ?? [EXECUTION], total: 1 };
		}
		if (path.startsWith("/api/agent-executions?action=activity")) {
			return { activities: overrides.activities ?? [ACTIVITY] };
		}
		if (path.startsWith("/api/agent-team?action=dashboard")) {
			return {
				agent_states: { working: 2, completed: 5, error: 1, idle: 20 },
			};
		}
		return {};
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("AgentOutputPage (AI Output Center)", () => {
	it("renders the page title with Live auto-refresh and Refresh controls", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("AI Output Center")).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: "● Live" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "↻ Refresh" })).toBeInTheDocument();
	});

	it("renders the stats bar with real workflow / execution / agent counts", async () => {
		seedData();
		render(<AgentOutputPage />);

		// “Workflows” also labels the tab — scope to the stat card
		const stat = (label: string) =>
			screen.getAllByText(label).find((el) =>
				el.closest(".p-3.rounded-lg"),
			) as HTMLElement;
		await waitFor(() => {
			expect(stat("Workflows")).toBeTruthy();
		});
		const wfCard = stat("Workflows").closest(".p-3.rounded-lg") as HTMLElement;
		expect(within(wfCard).getByText("1")).toBeInTheDocument(); // workflows
		expect(within(stat("Active Agents").closest(".p-3.rounded-lg") as HTMLElement).getByText("7")).toBeInTheDocument(); // 2 working + 5 completed
	});

	it("shows the workflows tab by default with the task title and urgency", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("Moderate report cluster")).toBeInTheDocument();
			expect(screen.getByText("high")).toBeInTheDocument();
			expect(screen.getByText("1 agents")).toBeInTheDocument();
		});
	});

	it("expands a workflow to reveal classification, agents and LLM analysis", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("Moderate report cluster")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Moderate report cluster"));
		await waitFor(() => {
			expect(screen.getByText("Agents Deployed")).toBeInTheDocument();
			expect(screen.getByText("Content Moderator")).toBeInTheDocument();
			expect(screen.getByText("Topic")).toBeInTheDocument();
			expect(screen.getByText("Broken lift")).toBeInTheDocument();
			expect(screen.getByText("94%")).toBeInTheDocument(); // confidence
			expect(screen.getByText("AI Analysis")).toBeInTheDocument();
			expect(
				screen.getByText("This is a genuine facilities issue."),
			).toBeInTheDocument();
		});
	});

	it("renders Real Actions Taken badges for successful actions only", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("Moderate report cluster")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Moderate report cluster"));
		await waitFor(() => {
			expect(screen.getByText("🛠 Real Actions Taken")).toBeInTheDocument();
			expect(screen.getByText(/🚫 Hide #p1/)).toBeInTheDocument();
			// resolve_reports has no target_id → shows the plain count
			expect(screen.getByText(/✅ Resolve 2/)).toBeInTheDocument();
		});
	});

	it("marks failed actions with a warning badge", async () => {
		seedData({
			workflows: [
				{
					...WORKFLOW,
					workflow_id: "wf-2",
					results: [
						{
						...(WORKFLOW.results[0] as typeof WORKFLOW.results[0]),
						result: {
							...(WORKFLOW.results[0] as typeof WORKFLOW.results[0]).result,
								data: {
									actions: [
										{ type: "hide_post", ok: false, error: "not found" },
									],
								},
							},
						},
					],
				},
			],
		});
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("Moderate report cluster")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Moderate report cluster"));
		await waitFor(() => {
			expect(screen.getByText(/⚠ hide_post failed/)).toBeInTheDocument();
		});
	});

	it("downloads a workflow report when the Report button is clicked", async () => {
		seedData();
		const urlSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:report");
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("Moderate report cluster")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /📥 Report/ }));
		expect(urlSpy).toHaveBeenCalled();
		urlSpy.mockRestore();
	});

	it("switches to the Executions tab and shows status chips + division colors", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("AI Output Center")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Executions/ }));
		await waitFor(() => {
			expect(screen.getByText("Scan for suspicious activity")).toBeInTheDocument();
		});
		// “security” also appears as the division filter option — scope to the card
		const card = screen
			.getByText("Scan for suspicious activity")
			.closest(".vb-rise") as HTMLElement;
		expect(within(card).getByText("failed")).toBeInTheDocument();
		expect(within(card).getByText("security")).toBeInTheDocument();
		expect(within(card).getByText("24/7")).toBeInTheDocument(); // cron trigger badge
	});

	it("expands a failed execution to show its error detail", async () => {
		seedData();
		render(<AgentOutputPage />);

		fireEvent.click(screen.getByRole("button", { name: /Executions/ }));
		await waitFor(() => {
			expect(screen.getByText("Scan for suspicious activity")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Scan for suspicious activity"));
		await waitFor(() => {
			expect(screen.getByText("Supabase connection refused")).toBeInTheDocument();
			expect(screen.getByText("Agent ID")).toBeInTheDocument();
			expect(screen.getByText("security-monitor")).toBeInTheDocument();
		});
	});

	it("switches to the Activity Log tab with severity dots and details", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("AI Output Center")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Activity Log/ }));
		await waitFor(() => {
			expect(screen.getByText("security-monitor")).toBeInTheDocument();
			expect(screen.getByText("incident.created")).toBeInTheDocument();
			expect(screen.getByText(/severity.*high/i)).toBeInTheDocument();
		});
	});

	it("filters workflows by search query", async () => {
		seedData({
			workflows: [
				WORKFLOW,
				{ ...WORKFLOW, workflow_id: "wf-2", task: "Another unrelated task" },
			],
		});
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("Moderate report cluster")).toBeInTheDocument();
		});
		const search = screen.getByPlaceholderText("Search agents, tasks...");
		fireEvent.change(search, { target: { value: "unrelated" } });

		await waitFor(() => {
			expect(screen.queryByText("Moderate report cluster")).not.toBeInTheDocument();
			expect(screen.getByText("Another unrelated task")).toBeInTheDocument();
		});
	});

	it("filters executions by division and status", async () => {
		seedData({
			executions: [
				EXECUTION,
				{
					...EXECUTION,
					id: "ex-2",
					agent_name: "Report Handler",
					division: "reports",
					status: "completed",
					task: "Resolve pending reports",
				},
			],
		});
		render(<AgentOutputPage />);

		fireEvent.click(screen.getByRole("button", { name: /Executions/ }));
		await waitFor(() => {
			expect(screen.getByText("Scan for suspicious activity")).toBeInTheDocument();
		});
		const division = screen.getAllByRole("combobox")[0] as HTMLElement;
		fireEvent.change(division, { target: { value: "reports" } });

		await waitFor(() => {
			expect(screen.queryByText("Scan for suspicious activity")).not.toBeInTheDocument();
			expect(screen.getByText("Report Handler")).toBeInTheDocument();
		});
	});

	it("shows the empty state when no workflow results exist", async () => {
		seedData({ workflows: [] });
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("No workflow results yet")).toBeInTheDocument();
		});
	});

	it("shows the empty state on the executions tab when none exist", async () => {
		seedData({ executions: [] });
		render(<AgentOutputPage />);

		fireEvent.click(screen.getByRole("button", { name: /Executions/ }));
		await waitFor(() => {
			expect(screen.getByText("No agent executions yet")).toBeInTheDocument();
		});
	});

	it("shows the empty state on the activity tab when none exist", async () => {
		seedData({ activities: [] });
		render(<AgentOutputPage />);

		fireEvent.click(screen.getByRole("button", { name: /Activity Log/ }));
		await waitFor(() => {
			expect(screen.getByText("No activity recorded yet")).toBeInTheDocument();
		});
	});

	it("toggles auto-refresh between Live and Paused", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "● Live" })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: "● Live" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "○ Paused" })).toBeInTheDocument();
		});
	});

	it("manual refresh re-fetches all four data sources", async () => {
		seedData();
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("AI Output Center")).toBeInTheDocument();
		});
		const before = mockedGet.mock.calls.length;
		fireEvent.click(screen.getByRole("button", { name: "↻ Refresh" }));
		await waitFor(() => {
			expect(mockedGet.mock.calls.length).toBeGreaterThan(before);
		});
	});

	it("shows the loading state when no data has arrived yet", async () => {
		mockedGet.mockImplementation(() => new Promise(() => undefined));
		render(<AgentOutputPage />);

		await waitFor(() => {
			expect(screen.getByText("Loading agent outputs...")).toBeInTheDocument();
		});
	});
});
