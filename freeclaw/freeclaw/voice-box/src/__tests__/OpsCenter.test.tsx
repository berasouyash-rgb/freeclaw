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
		get: vi.fn(),
		getSlow: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: vi.fn() }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

import { api } from "../lib/api";

const mockedGetSlow = api.getSlow as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;

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
				config: { paused: false },
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

describe("OpsCenter (hidden workforce command view)", () => {
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
				expect.objectContaining({ detail: "ai-operations" }),
			);
		});
		window.removeEventListener("vb:admin-tab", listener);
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
