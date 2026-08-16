// ═══════════════════════════════════════════════════════════════
// InspectorPanel — employee work arena
// Asserts: clicking an employee opens their REAL work record —
// currently-working tasks, verified outcomes with evidence, impact
// (or honest NOT MEASURABLE), and execution timeline.
// ═══════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import InspectorPanel from "../pages/admin/agent-office/InspectorPanel";

vi.mock("../../../lib/utils", () => ({
	safeStringify: (v: unknown) => JSON.stringify(v),
}));

const AGENT = {
	id: "security-monitor",
	name: "Security Monitor",
	division: "specialist",
	icon: "🛡️",
	role: "Security Operations",
	description: "Detects suspicious activity.",
	permissions: ["logs.read", "users.read"],
	capabilities: ["vulnerability_scanning"],
	status: "active",
	tier: "specialist",
};

const ACTIVE_TASK = {
	id: "task-active-1",
	title: "Investigate abnormal report cluster",
	source: "report",
	priority: "high",
	status: "verifying",
	assigned_agent: "security-monitor",
	parent_task_id: null,
	risk_level: "low",
	attempts: 1,
	verification_status: "passed",
	error: null,
	outcomes: [
		{
			type: "resolve_reports",
			target_id: null,
			count: 3,
			status: "auto_resolved",
			verified: true,
			evidence: "3/3 reports → auto_resolved",
			at: "2026-08-09T12:00:01Z",
		},
	],
	timeline: [
		{
			at: "2026-08-09T11:59:58Z",
			step: "claimed",
			detail: "Task claimed by Security Monitor",
		},
		{
			at: "2026-08-09T11:59:59Z",
			step: "started",
			detail: "Execution started",
		},
		{
			at: "2026-08-09T12:00:00Z",
			step: "verifying",
			detail: "Independent DB verification: 1/1 claimed changes confirmed",
		},
		{
			at: "2026-08-09T12:00:01Z",
			step: "completed",
			detail:
				"Completed with 1 verified outcome(s) — impact: 3 report(s) resolved",
		},
	],
	impact: {
		measurable: true,
		summary: "3 report(s) resolved",
		stats: { reports_resolved: 3 },
		verified_actions: 1,
	},
	created_at: "2026-08-09T11:59:58Z",
	completed_at: "2026-08-09T12:00:01Z",
};

const DONE_TASK = {
	id: "task-done-1",
	title: "Security review: user anon_5l0p2",
	source: "security",
	priority: "high",
	status: "completed",
	assigned_agent: "security-monitor",
	parent_task_id: null,
	risk_level: "medium",
	attempts: 1,
	verification_status: "none",
	error: null,
	outcomes: [],
	timeline: [
		{
			at: "2026-08-08T10:00:00Z",
			step: "claimed",
			detail: "Task claimed by Security Monitor",
		},
		{
			at: "2026-08-08T10:00:01Z",
			step: "started",
			detail: "Execution started",
		},
		{
			at: "2026-08-08T10:00:30Z",
			step: "verifying",
			detail: "Independent DB verification: 0/0 claimed changes confirmed",
		},
		{
			at: "2026-08-08T10:00:31Z",
			step: "completed",
			detail: "Completed with 0 verified outcome(s)",
		},
	],
	impact: {
		measurable: false,
		summary: "",
		note: "NOT MEASURABLE — no verified change",
	},
	created_at: "2026-08-08T10:00:00Z",
	completed_at: "2026-08-08T10:00:31Z",
};

const noop = () => {};

describe("InspectorPanel Work Record", () => {
	it("shows currently-working tasks first with verifying status and verification badge", () => {
		render(
			<InspectorPanel
				agent={AGENT}
				agentState={{
					agent_id: "security-monitor",
					state: "verifying",
					task: "Investigate abnormal report cluster",
					started_at: "2026-08-09T11:59:58Z",
					completed_at: null,
					progress: 0,
					result: null,
					updated_at: "",
				}}
				workTasks={[ACTIVE_TASK]}
				onClose={noop}
				onSpawn={noop}
			/>,
		);
		expect(screen.getByText("🔍 Verifying")).toBeInTheDocument();
		expect(screen.getByText(/currently working/i)).toBeInTheDocument();
		expect(
			screen.getAllByText("Investigate abnormal report cluster").length,
		).toBeGreaterThan(0);
		expect(screen.getByText(/verify:passed/i)).toBeInTheDocument();
	});

	it("expands a task to show the real execution timeline", async () => {
		render(
			<InspectorPanel
				agent={AGENT}
				agentState={null}
				workTasks={[ACTIVE_TASK]}
				onClose={noop}
				onSpawn={noop}
			/>,
		);
		await userEvent.click(
			screen.getAllByText("Investigate abnormal report cluster")[0]!,
		);
		expect(screen.getByText(/Execution Timeline/i)).toBeInTheDocument();
		expect(
			screen.getByText(/Independent DB verification/i),
		).toBeInTheDocument();
	});

	it("shows verified outcomes with evidence when opened", async () => {
		render(
			<InspectorPanel
				agent={AGENT}
				agentState={null}
				workTasks={[ACTIVE_TASK]}
				onClose={noop}
				onSpawn={noop}
			/>,
		);
		await userEvent.click(
			screen.getAllByText("Investigate abnormal report cluster")[0]!,
		);
		await userEvent.click(screen.getByText(/Verified Outcomes \(1\/1\)/i));
		expect(
			screen.getByText(/3\/3 reports → auto_resolved/i),
		).toBeInTheDocument();
		expect(
			screen.getAllByText(/Impact: 3 report\(s\) resolved/i).length,
		).toBeGreaterThan(0);
	});

	it("truthfully reports NOT MEASURABLE impact when nothing changed", async () => {
		render(
			<InspectorPanel
				agent={AGENT}
				agentState={null}
				workTasks={[DONE_TASK]}
				onClose={noop}
				onSpawn={noop}
			/>,
		);
		await userEvent.click(
			screen.getByText(/Security review: user anon_5l0p2/i),
		);
		expect(screen.getByText(/NOT MEASURABLE/i)).toBeInTheDocument();
		expect(screen.getByText(/No verified outcome/i)).toBeInTheDocument();
	});

	it("shows an honest empty state when the employee has no real work yet", () => {
		render(
			<InspectorPanel
				agent={AGENT}
				agentState={null}
				workTasks={[]}
				onClose={noop}
				onSpawn={noop}
			/>,
		);
		expect(screen.getByText(/No work recorded yet/i)).toBeInTheDocument();
		expect(screen.getByText(/has not claimed a task/i)).toBeInTheDocument();
	});
});
