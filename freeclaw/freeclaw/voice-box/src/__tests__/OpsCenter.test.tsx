// ═══════════════════════════════════════════════════════════════════
// Ops Center — hidden AI workforce command view
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • renders KPIs + provider/patrol chips from REAL ops-summary data
//   • lists active incidents (high/critical open work) with evidence
//   • lists attention-required rows (blocked / waiting approval / failed)
//   • lists automatically-resolved VERIFIED outcomes with impact
//   • "Open workforce" / "Run patrol" wiring to real navigation + API
//   • truthful empty states — no fabricated busyness
// ═══════════════════════════════════════════════════════════════════

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpsCenter from "../pages/admin/OpsCenter";

// ── Mocks ──────────────────────────────────────────────────────────
vi.mock("../lib/api", () => ({
	api: {
		post: vi.fn(),
		postAgent: vi.fn(),
		get: vi.fn(),
		getSlow: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: vi.fn() }),
}));

const smartPollMock = vi.hoisted(() =>
	vi.fn((fetcher: () => Promise<unknown>) => {
		void Promise.resolve().then(fetcher);
		return {
			forceRefresh: fetcher,
			isPolling: false,
			lastError: null,
		};
	}),
);

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/useSmartPoll", () => ({
	useSmartPoll: smartPollMock,
}));

import { api } from "../lib/api";

const mockedGetSlow = api.getSlow as ReturnType<typeof vi.fn>;
const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedPostAgent = api.postAgent as ReturnType<typeof vi.fn>;

// ── Agent scorecard fixture ────────────────────────────────────────
// The point of this endpoint is that HEALTH and IMPACT are separate
// numbers. `silent-agent` has run 9,000 times and changed nothing — under
// the old dashboard that volume read as productive work.
const SCORECARD = {
	summary: {
		agents: 90,
		healthy: 58,
		no_real_impact: 88,
		state_changing_agents: 2,
		total_executions: 9124,
		executions_without_state_change: 9021,
		verdicts: { impactful: 2, "advisory-only": 56, "no-impact": 32 },
	},
	agents: [
		{
			agent_id: "silent-agent",
			name: "Silent Agent",
			division: "OPS",
			status: "active",
			verdict: "no-impact",
			impact: {
				class: "READ_AND_CLASSIFY",
				behaviour_label: null,
				state_changing: false,
				disable_test: "Nothing changes if this agent is disabled.",
			},
			health: { runs: 9000, failures: 0, failure_rate: 0, alive: true },
		},
		{
			agent_id: "spam-sentinel",
			name: "Spam Sentinel",
			division: "SAFETY",
			status: "active",
			verdict: "impactful",
			impact: {
				class: "UPDATE_CASE",
				behaviour_label: "moderation",
				state_changing: true,
				disable_test: "Double-confirmed spam would stay visible.",
			},
			health: { runs: 103, failures: 0, failure_rate: 0, alive: true },
		},
	],
	roster_audit: {
		agents_total: 90,
		agents_reaching_a_behaviour: 59,
		agents_retired: 31,
		behaviours_available: 57,
		behaviours_reachable: 26,
		behaviours_state_changing: 3,
		retired_agents: [
			{
				agent_id: "orphan-agent",
				name: "Orphan Agent",
				division: "ANALYTICS",
				reason: "routes to no behaviour",
			},
		],
	},
};

const now = new Date().toISOString();
const minuteAgo = new Date(Date.now() - 60_000).toISOString();
const twoMinAgo = new Date(Date.now() - 120_000).toISOString();

const INCIDENT = {
	id: "task-inc",
	title: "Security review: suspicious user anon_xyz",
	agent: "security-monitor",
	priority: "critical",
	risk_level: "high",
	status: "working",
	verification_status: "none",
	created_at: minuteAgo,
	completed_at: null,
	error: null,
	impact: null,
	evidence_count: 3,
	timeline_count: 6,
	outcomes: [],
};

const ATTENTION = {
	id: "task-app",
	title: "Approval required: hide reported post",
	agent: "report-handler",
	priority: "high",
	risk_level: "high",
	status: "blocked",
	verification_status: "awaiting_approval",
	created_at: twoMinAgo,
	completed_at: null,
	error: "Requires an administrator decision",
	impact: null,
	evidence_count: 2,
	timeline_count: 4,
	outcomes: [],
};

const RESOLVED = {
	id: "task-done",
	title: "Hide spam post",
	agent: "content-moderator",
	priority: "medium",
	risk_level: "low",
	status: "completed",
	verification_status: "passed",
	created_at: twoMinAgo,
	completed_at: minuteAgo,
	error: null,
	impact: "1 harmful post removed from the public feed",
	evidence_count: 2,
	timeline_count: 5,
	outcomes: [
		{ what: "Post hidden", impact: "1 harmful post removed" },
		{ what: "2 reports resolved", impact: "queue drained" },
	],
};

const ALERT = {
	id: "alert-1",
	key: "login-failures",
	severity: "critical",
	title: "Suspicious authentication pattern detected",
	body: "7 failed logins from the same session in 5 minutes.",
	agent: "security-monitor",
	evidence: "3 correlated signals captured",
	occurrences: 3,
	acknowledged_at: null,
	acknowledged_by: null,
	resolved_at: null,
	resolved_by: null,
	created_at: twoMinAgo,
	last_at: minuteAgo,
};

const REPORT = {
	tasks_created_24h: 12,
	tasks_completed_24h: 9,
	tasks_failed_24h: 1,
	verified_outcomes_24h: 5,
	auto_resolved_24h: 6,
	incidents_open: 1,
	attention_open: 1,
	alerts_open: 1,
	top_risks: [
		{ label: "report", count: 4 },
		{ label: "security", count: 2 },
	],
};

function seedData(
	overrides: Partial<{
		incidents: unknown[];
		attention: unknown[];
		autoResolved: unknown[];
		alerts: unknown[];
		activity: unknown[];
		paused: boolean;
	}> = {},
) {
	mockedGetSlow.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/workforce?action=ops-summary")) {
			return {
				ok: true,
				employees: [],
				task_queue: {
					total: 5,
					queued: 2,
					claimed: 0,
					working: 1,
					verifying: 0,
					completed: 2,
					failed: 1,
					blocked: 1,
				},
				metrics: {
					working: 1,
					verifying: 0,
					total_employees: 111,
					utilized: 40,
					underutilized: 71,
					verified_outcomes: 12,
					success_rate: 92,
					avg_duration_ms: 9000,
				},
				ai_provider: {
					ok: true,
					status: "ready",
					note: "AI provider configured",
				},
				config: { paused: overrides.paused ?? false },
				incidents: overrides.incidents ?? [INCIDENT],
				attention: overrides.attention ?? [ATTENTION],
				auto_resolved: overrides.autoResolved ?? [RESOLVED],
				verified_today: 5,
				alerts: (() => {
					// Mirror the real ops-summary contract: unresolved rows first (≤7),
					// then recent resolved rows (≤3); counts are the true totals.
					const list = overrides.alerts ?? [ALERT];
					const unresolved = list
						.filter((a) => !(a as { resolved_at: string | null }).resolved_at)
						.slice(0, 7);
					const resolved = list
						.filter((a) => !!(a as { resolved_at: string | null }).resolved_at)
						.slice(0, 3);
					const unresolvedAll = list.filter(
						(a) => !(a as { resolved_at: string | null }).resolved_at,
					);
					return {
						ok: true,
						alerts: [...unresolved, ...resolved],
						open: unresolvedAll.filter(
							(a) => !(a as { acknowledged_at: string | null }).acknowledged_at,
						).length,
						critical_open: unresolvedAll.filter(
							(a) => (a as { severity: string }).severity === "critical",
						).length,
						acknowledged_open: unresolvedAll.filter(
							(a) =>
								!!(a as { acknowledged_at: string | null }).acknowledged_at,
						).length,
						resolved: resolved.length,
					};
				})(),
				report: REPORT,
				platform: {
					posts: 120,
					pending_reports: 3,
					users: 45,
					comments: 300,
					reactions: 900,
				},
				last_patrol_at: twoMinAgo,
				activity: overrides.activity ?? [
					{
						agent_id: "security-monitor",
						action: "incident.created",
						severity: "high",
						details: "3 correlated events",
						created_at: minuteAgo,
					},
				],
				updated_at: now,
			};
		}
		return {};
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

/** Seed the independently-fetched scorecard (plain api.get, not getSlow). */
function seedScorecard(card: unknown = SCORECARD) {
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/agent-executions?action=scorecard")) return card;
		return {};
	});
}

describe("OpsCenter — agent scorecard (health is not impact)", () => {
	it("separates process health from real state-changing impact", async () => {
		seedData();
		seedScorecard();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("ROSTER REALITY")).toBeInTheDocument();
		});

		const section = screen
			.getByText("ROSTER REALITY")
			.closest("section") as HTMLElement;

		// Health and impact are reported as different numbers, never merged.
		expect(within(section).getByText("Healthy")).toBeInTheDocument();
		expect(within(section).getByText("58")).toBeInTheDocument();
		expect(within(section).getByText("State-changing")).toBeInTheDocument();
		expect(within(section).getByText("No real impact")).toBeInTheDocument();
		expect(within(section).getByText("88")).toBeInTheDocument();

		// The volume that used to read as productive work is called out.
		expect(
			within(section).getByText(/of 9,124 recorded/),
		).toBeInTheDocument();

		// An agent that ran 9,000 times without changing state is labelled
		// NO IMPACT rather than counted as productive.
		expect(within(section).getByText("NO IMPACT")).toBeInTheDocument();
		expect(within(section).getByText("Silent Agent")).toBeInTheDocument();
		expect(within(section).getByText("9000 runs")).toBeInTheDocument();
		expect(within(section).getByText("no behaviour")).toBeInTheDocument();

		// Retired agents are named with a reason, not silently dropped.
		expect(within(section).getByText(/31 agents reach no behaviour/)).toBeInTheDocument();
	});

	it("keeps the Ops Center usable when the scorecard endpoint fails", async () => {
		seedData();
		mockedGet.mockRejectedValue(new Error("scorecard unavailable"));
		render(<OpsCenter />);

		// Ops data still rendered; only the optional panel is absent.
		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
		});
		expect(screen.queryByText("ROSTER REALITY")).not.toBeInTheDocument();
		expect(screen.queryByText("OPS DATA UNAVAILABLE")).not.toBeInTheDocument();
	});
});

describe("OpsCenter (hidden workforce command view)", () => {
	it("does not install a recurring page poll", () => {
		seedData();
		render(<OpsCenter />);
		expect(smartPollMock).not.toHaveBeenCalled();
	});

	it("renders live KPIs, provider chip and patrol freshness from real data", async () => {
		seedData();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
			expect(screen.getByText("AI PROVIDER READY")).toBeInTheDocument();
		});

		// KPI cards show real values from the runtime (scoped to the KPI row —
		// 'ACTIVE NOW' also appears in the workforce-health panel)
		const kpis = screen.getByTestId("ops-kpis");
		const verifiedCard = within(kpis)
			.getByText("VERIFIED 24H")
			.closest(".card") as HTMLElement;
		expect(within(verifiedCard).getByText("5")).toBeInTheDocument();

		const activeCard = within(kpis)
			.getByText("ACTIVE NOW")
			.closest(".card") as HTMLElement;
		expect(within(activeCard).getByText("1")).toBeInTheDocument();

		const incidentsCard = within(kpis)
			.getByText("INCIDENTS")
			.closest(".card") as HTMLElement;
		expect(within(incidentsCard).getByText("1")).toBeInTheDocument();
	});

	it("lists active incidents with agent, priority and evidence count", async () => {
		seedData();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("ACTIVE INCIDENTS")).toBeInTheDocument();
		});
		// Scope to the incidents section — 'Security Monitor' also appears in
		// the real-time activity feed below.
		const section = screen
			.getByText("ACTIVE INCIDENTS")
			.closest("section") as HTMLElement;
		expect(within(section).getByText(INCIDENT.title)).toBeInTheDocument();
		expect(within(section).getByText("CRITICAL")).toBeInTheDocument();
		expect(within(section).getByText("Security Monitor")).toBeInTheDocument();
		expect(within(section).getByText("3 evidence")).toBeInTheDocument();
	});

	it("lists attention-required rows with the failure reason and approval state", async () => {
		seedData();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText(ATTENTION.title)).toBeInTheDocument();
			expect(screen.getByText("WAITING APPROVAL")).toBeInTheDocument();
			expect(
				screen.getByText(/Requires an administrator decision/),
			).toBeInTheDocument();
		});
	});

	it("shows automatically-resolved VERIFIED outcomes with impact evidence", async () => {
		seedData();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(
				screen.getByText("AUTOMATICALLY RESOLVED · VERIFIED OUTCOMES"),
			).toBeInTheDocument();
			expect(screen.getByText(RESOLVED.title)).toBeInTheDocument();
		});
		// Impact renders inside a span prefixed with an em dash — match substring
		expect(screen.getByText(/1 harmful post removed/)).toBeInTheDocument();
		expect(screen.getByText(/2 reports resolved/)).toBeInTheDocument();
	});

	it("renders measureImpact() OBJECT-form impact without crashing", async () => {
		// Regression: the backend now sends impact as { measurable, summary, note }
		// (from measureImpact). Rendering that object directly crashed React with
		// "Objects are not valid as a React child". impactText() must stringify it.
		seedData({
			autoResolved: [
				{
					...RESOLVED,
					impact: {
						measurable: true,
						summary: "3 report(s) resolved",
						note: "NOT MEASURABLE",
					},
					outcomes: [
						{
							what: "Reports resolved",
							impact: {
								measurable: true,
								summary: "3 report(s) resolved",
								note: "NOT MEASURABLE",
							},
						},
					],
				},
			],
		});
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText(RESOLVED.title)).toBeInTheDocument();
		});
		// The object form must render its summary as a string, not crash.
		expect(screen.getByText(/3 report\(s\) resolved/)).toBeInTheDocument();
	});

	it("shows truthful empty states when nothing is happening", async () => {
		seedData({ incidents: [], attention: [], autoResolved: [], alerts: [] });
		render(<OpsCenter />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"NO ACTIVE INCIDENTS — no high-priority work requires attention right now.",
				),
			).toBeInTheDocument();
			expect(
				screen.getByText(
					"NO ATTENTION REQUIRED — the workforce is handling everything automatically.",
				),
			).toBeInTheDocument();
			expect(
				screen.getByText(
					"NO VERIFIED ACTIONS YET — no platform change has been independently verified.",
				),
			).toBeInTheDocument();
			expect(
				screen.getByText(
					"NO ACTIVE ALERTS — nothing requires attention or acknowledgment.",
				),
			).toBeInTheDocument();
		});
	});

	it("shows unacknowledged admin alerts with severity, occurrences and acknowledge wiring", async () => {
		seedData();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("ADMIN ALERTS · CRITICAL")).toBeInTheDocument();
		});
		// Scope to the alerts section — 'CRITICAL' also appears on the incident row
		const section = screen
			.getByText("ADMIN ALERTS · CRITICAL")
			.closest("section") as HTMLElement;
		expect(within(section).getByText(ALERT.title)).toBeInTheDocument();
		expect(within(section).getByText("CRITICAL")).toBeInTheDocument();
		expect(within(section).getByText("×3 occurrences")).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", { name: `Acknowledge ${ALERT.title}` }),
		);
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "acknowledge-alert",
				id: ALERT.id,
			});
		});
	});

	it("distinguishes ACKNOWLEDGED (seen, still open) alerts with no acknowledge button", async () => {
		const acked = {
			...ALERT,
			id: "alert-ack",
			acknowledged_at: minuteAgo,
			acknowledged_by: "admin",
			resolved_at: null,
			resolved_by: null,
		};
		seedData({ alerts: [acked] });
		render(<OpsCenter />);

		await waitFor(() => {
			expect(
				screen.getByText("ACKNOWLEDGED · SEEN, ISSUE STILL OPEN · 1"),
			).toBeInTheDocument();
		});
		const section = screen
			.getByText("ACKNOWLEDGED · SEEN, ISSUE STILL OPEN · 1")
			.closest("section") as HTMLElement;
		expect(
			within(section).getByText("ACKNOWLEDGED · STILL OPEN"),
		).toBeInTheDocument();
		expect(
			within(section).getByText(/acknowledged 1m ago · issue still open/),
		).toBeInTheDocument();
		// Seen alerts are not actionable — no acknowledge button
		expect(
			within(section).queryByRole("button", {
				name: `Acknowledge ${acked.title}`,
			}),
		).not.toBeInTheDocument();
	});

	it("distinguishes RESOLVED (issue fixed) alerts with resolved_at + resolved_by", async () => {
		const resolved = {
			...ALERT,
			id: "alert-res",
			acknowledged_at: null,
			acknowledged_by: null,
			resolved_at: minuteAgo,
			resolved_by: "system",
		};
		seedData({ alerts: [resolved] });
		render(<OpsCenter />);

		await waitFor(() => {
			expect(
				screen.getByText("RESOLVED · ISSUE FIXED · 1"),
			).toBeInTheDocument();
		});
		const section = screen
			.getByText("RESOLVED · ISSUE FIXED · 1")
			.closest("section") as HTMLElement;
		expect(within(section).getByText("RESOLVED ✓")).toBeInTheDocument();
		expect(
			within(section).getByText(/resolved 1m ago by system/),
		).toBeInTheDocument();
		expect(
			within(section).queryByRole("button", {
				name: `Acknowledge ${resolved.title}`,
			}),
		).not.toBeInTheDocument();
	});

	it("renders the daily operations report with real 24h numbers and top risk sources", async () => {
		seedData();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(
				screen.getByText("OPERATIONS REPORT · LAST 24H"),
			).toBeInTheDocument();
		});

		// Report cards show real aggregates
		const reportSection = screen
			.getByText("OPERATIONS REPORT · LAST 24H")
			.closest("section") as HTMLElement;
		expect(within(reportSection).getByText("12")).toBeInTheDocument(); // tasks created
		expect(
			within(reportSection).getByText("Tasks created"),
		).toBeInTheDocument();
		expect(within(reportSection).getByText("5")).toBeInTheDocument(); // verified outcomes
		expect(
			within(reportSection).getByText("TOP RISK SOURCES:"),
		).toBeInTheDocument();
		expect(within(reportSection).getByText(/report/)).toBeInTheDocument();
	});

	it("shows an honest error state when the runtime is unreachable", async () => {
		mockedGetSlow.mockRejectedValue(new Error("network down"));
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("OPS DATA UNAVAILABLE")).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
	});

	it("renders the overnight briefing with sourced numbers", async () => {
		seedData();
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/agent-executions?action=scorecard")) return SCORECARD;
			if (path.startsWith("/api/workforce?action=overnight-briefing"))
				return {
					window: "24h",
					generated_at: new Date().toISOString(),
					items: [
						{ label: "Workforce executions (24h)", value: 23, detail: "21 verified ok · 2 verified failed · 0 budget-blocked", source: "workforce ledger" },
						{ label: "Workers paused by supervisor", value: 1, detail: "followup", source: "supervisor" },
						{ label: "Open reports", value: null, detail: "ledger unreadable", source: "reports table" },
					],
					needs_attention: 1,
				};
			return {};
		});
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("Overnight briefing")).toBeInTheDocument();
		});
		expect(screen.getByText("23")).toBeInTheDocument();
		expect(screen.getByText(/needs attention/)).toBeInTheDocument();
		// unknown renders as —, never 0
		expect(screen.getByText("Open reports").closest("li")).toHaveTextContent("—");
		expect(screen.getByText(/source: workforce ledger/)).toBeInTheDocument();
	});

	it("hides the briefing section when the endpoint answers nothing", async () => {
		seedData();
		seedScorecard();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
		});
		expect(screen.queryByText("Overnight briefing")).not.toBeInTheDocument();
	});

	it("open-workforce button navigates to the AI Operations tab", async () => {
		seedData();
		render(<OpsCenter />);

		const listener = vi.fn();
		window.addEventListener("vb:admin-tab", listener);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Open workforce" }),
			).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: "Open workforce" }));

		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({ detail: "ops-center" }),
			);
		});
		window.removeEventListener("vb:admin-tab", listener);
	});

	it("ask-the-agent answers through ask-agent and labels the engine", async () => {
		seedData();
		seedScorecard();
		mockedPostAgent.mockResolvedValue({
			ok: true,
			status: "succeeded",
			response: "2 open reports need triage.",
			backend: "builtin",
			model: "test-model",
		});
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByPlaceholderText(/Summarize open high-priority reports/)).toBeInTheDocument();
		});
		fireEvent.change(
			screen.getByPlaceholderText(/Summarize open high-priority reports/),
			{ target: { value: "what needs attention?" } },
		);
		fireEvent.click(screen.getByRole("button", { name: /^Ask$/ }));

		await waitFor(() => {
			expect(mockedPostAgent).toHaveBeenCalledWith("/api/workforce", {
				action: "ask-agent",
				input: "what needs attention?",
			});
		});
		expect(await screen.findByText("2 open reports need triage.")).toBeInTheDocument();
		expect(screen.getByText(/built-in engine/)).toBeInTheDocument();
		expect(screen.getByText(/test-model/)).toBeInTheDocument();
	});

	it("ask-the-agent preserves the question when the backend cannot answer", async () => {
		seedData();
		seedScorecard();
		mockedPostAgent.mockResolvedValue({
			ok: false,
			error: "No AI provider key is configured",
		});
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByPlaceholderText(/Summarize open high-priority reports/)).toBeInTheDocument();
		});
		fireEvent.change(
			screen.getByPlaceholderText(/Summarize open high-priority reports/),
			{ target: { value: "hello?" } },
		);
		fireEvent.click(screen.getByRole("button", { name: /^Ask$/ }));

		await waitFor(() => {
			expect(screen.getByText(/No AI provider key is configured/)).toBeInTheDocument();
		});
		// draft preserved for retry
		expect(screen.getByDisplayValue("hello?")).toBeInTheDocument();
	});

	it("run-patrol triggers a real workforce patrol through the API", async () => {
		mockedPost.mockResolvedValue({ ok: true, executed: 2, failed: 0 });
		seedData();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /Run patrol/ }),
			).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Run patrol/ }));

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "patrol",
				limit: 2,
			});
		});
	});

	// REGRESSION: logActivity stores details as an OBJECT ({ message } or raw
	// structured fields). Rendering that object as a React child used to throw
	// "Objects are not valid as a React child" and blank the entire Ops Center.
	it("renders live activity whose details are structured objects (no crash)", async () => {
		seedData({
			activity: [
				{
					agent_id: "report-handler",
					action: "task_completed",
					severity: "info",
					details: {
						title: "Triage report: Bullying or harassment",
						task_id: "abc123",
						duration_ms: 45369,
					},
					created_at: minuteAgo,
				},
				{
					agent_id: "security-monitor",
					action: "incident.created",
					severity: "high",
					details: { message: "3 correlated events" },
					created_at: twoMinAgo,
				},
			],
		});
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("AI Operations")).toBeInTheDocument();
		});
		// Flattened to plain text — object children would have thrown here
		expect(
			screen.getByText(/Triage report: Bullying or harassment/),
		).toBeInTheDocument();
		expect(screen.getByText("3 correlated events")).toBeInTheDocument();
	});
});

describe("OpsCenter — automations (visible workers)", () => {
	const WORKERS = [
		{
			id: "trends",
			name: "Trend Watch",
			description: "Alerts on spikes.",
			last: { at: new Date().toISOString(), ok: true, summary: "0 spikes" },
		},
		{
			id: "sla",
			name: "SLA Watch",
			description: "Warns and escalates.",
			last: null,
		},
	];

	function seedAutomations() {
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/agent-executions?action=scorecard"))
				return SCORECARD;
			if (path.startsWith("/api/workforce?action=automation-status"))
				return { ok: true, workers: WORKERS };
			return {};
		});
	}

	it("lists every worker with its last-run output", async () => {
		seedData();
		seedAutomations();
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("Trend Watch")).toBeInTheDocument();
		});
		expect(screen.getByText("Alerts on spikes.")).toBeInTheDocument();
		expect(screen.getByText(/Last run: 0 spikes/)).toBeInTheDocument();
		expect(screen.getByText("SLA Watch")).toBeInTheDocument();
		expect(
			screen.getByText("No recorded run yet — runs on cron schedule."),
		).toBeInTheDocument();
	});

	it("runs a worker on demand and shows its output", async () => {
		seedData();
		seedAutomations();
		mockedPost.mockResolvedValue({
			ok: true,
			worker: "trends",
			result: { checked: 42 },
			last: { summary: "1 spike" },
			duration_ms: 120,
		});
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("Trend Watch")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Run Trend Watch now/ }));

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "automation-run",
				worker: "trends",
			});
		});
		await waitFor(() => {
			expect(screen.getByText("Just ran: 1 spike")).toBeInTheDocument();
		});
	});

	it("keeps the question on run failure (no silent loss)", async () => {
		seedData();
		seedAutomations();
		mockedPost.mockResolvedValue({ ok: false, error: "backend down" });
		render(<OpsCenter />);

		await waitFor(() => {
			expect(screen.getByText("Trend Watch")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Run Trend Watch now/ }));

		await waitFor(() => {
			expect(screen.getByText(/backend down/)).toBeInTheDocument();
		});
	});
});

describe("OpsCenter — workforce kill switch", () => {
	it("pauses through the confirm dialog and posts the pause action", async () => {
		seedData();
		seedScorecard();
		mockedPost.mockResolvedValue({ ok: true, paused: true });
		render(<OpsCenter />);
		await screen.findByRole("button", { name: /Run patrol/ });

		fireEvent.click(screen.getByRole("button", { name: /Pause workforce/ }));
		const dialog = await screen.findByRole("dialog", {
			name: "Pause workforce?",
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Pause" }));
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "pause",
			});
		});
	});

	it("does not pause when the confirm dialog is cancelled", async () => {
		seedData();
		seedScorecard();
		render(<OpsCenter />);
		await screen.findByRole("button", { name: /Run patrol/ });

		fireEvent.click(screen.getByRole("button", { name: /Pause workforce/ }));
		const dialog = await screen.findByRole("dialog", {
			name: "Pause workforce?",
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(mockedPost).not.toHaveBeenCalledWith("/api/workforce", {
			action: "pause",
		});
	});

	it("resumes directly when the workforce is paused", async () => {
		seedData({ paused: true });
		seedScorecard();
		mockedPost.mockResolvedValue({ ok: true, paused: false });
		render(<OpsCenter />);
		const btn = await screen.findByRole("button", {
			name: /Resume workforce/,
		});
		expect(
			screen.queryByRole("button", { name: /Pause workforce/ }),
		).not.toBeInTheDocument();

		fireEvent.click(btn);
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "resume",
			});
		});
	});
});
