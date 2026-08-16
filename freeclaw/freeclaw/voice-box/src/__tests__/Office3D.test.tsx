// ═══════════════════════════════════════════════════════════════
// Office 3D — pure-CSS isometric workforce office
// Asserts the stage renders, every agent gets a desk, real state
// drives the visual classes, and desks are clickable.
// ═══════════════════════════════════════════════════════════════

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import Office3D from "../pages/admin/agent-office/Office3D";
import type {
	Agent,
	AgentActivation,
	AgentState,
} from "../pages/admin/agent-office/types";

function makeAgent(id: string, division: string, name = id): Agent {
	return {
		id,
		name,
		division,
		icon: "🤖",
		role: "Role",
		description: "desc",
		permissions: [],
		capabilities: ["x"],
		status: "active",
		tier: "specialist",
	};
}

const AGENTS: Agent[] = [
	makeAgent("ceo-1", "executive", "CEO"),
	makeAgent("mod-1", "content", "Moderator"),
	makeAgent("mod-2", "content", "Moderator 2"),
	makeAgent("eng-1", "eng-backend", "Engineer"),
	makeAgent("sys-1", "system", "Sysadmin"),
	makeAgent("off-1", "analytics", "Offline Agent"),
];

const IDLE: AgentState = {
	agent_id: "",
	state: "idle",
	task: null,
	started_at: null,
	completed_at: null,
	progress: 0,
	result: null,
	updated_at: "",
};

const STATES: Record<string, AgentState> = {
	"ceo-1": {
		...IDLE,
		agent_id: "ceo-1",
		state: "working",
		task: "Analyzing Q4",
	},
	"mod-1": { ...IDLE, agent_id: "mod-1", state: "completed" },
	"mod-2": { ...IDLE, agent_id: "mod-2", state: "error" },
	"eng-1": { ...IDLE, agent_id: "eng-1", state: "idle" },
	"sys-1": {
		...IDLE,
		agent_id: "sys-1",
		state: "working",
		task: "Checking uptime",
	},
	"off-1": { ...IDLE, agent_id: "off-1", state: "idle" },
};

const ACTIVATIONS: Record<string, AgentActivation> = {
	"off-1": {
		id: "off-1",
		name: "Offline Agent",
		icon: "🤖",
		division: "analytics",
		active: false,
		autonomous: false,
		activated_at: null,
		deactivated_at: null,
	},
	"sys-1": {
		id: "sys-1",
		name: "Sysadmin",
		icon: "🤖",
		division: "system",
		active: true,
		autonomous: true,
		activated_at: "2026-01-01T00:00:00Z",
		deactivated_at: null,
	},
};

describe("Office3D", () => {
	it("renders the isometric stage and a desk for every agent", () => {
		const { container } = render(
			<Office3D
				agents={AGENTS}
				agentStates={STATES}
				selectedAgentId={null}
				onSelectAgent={() => {}}
				searchQuery=""
				isConnected
				activations={ACTIVATIONS}
			/>,
		);
		// Stage + floor exist
		expect(container.querySelector(".vb3d-stage")).not.toBeNull();
		expect(container.querySelector(".vb3d-floor")).not.toBeNull();
		// One desk per agent
		expect(container.querySelectorAll(".vb3d-desk")).toHaveLength(
			AGENTS.length,
		);
		// Room plaques for occupied rooms
		expect(
			container.querySelectorAll(".vb3d-room").length,
		).toBeGreaterThanOrEqual(5);
		// Live stats bar
		expect(screen.getByText("6 agents")).toBeInTheDocument();
	});

	it("applies state-driven classes: working bob, completed, error shake, offline dim", () => {
		const { container } = render(
			<Office3D
				agents={AGENTS}
				agentStates={STATES}
				selectedAgentId={null}
				onSelectAgent={() => {}}
				searchQuery=""
				isConnected
				activations={ACTIVATIONS}
			/>,
		);
		const cards = Array.from(
			container.querySelectorAll<HTMLElement>(".vb3d-card"),
		);
		const byName = (n: string) => cards.find((c) => c.textContent?.includes(n));
		expect(byName("CEO")?.className).toContain("vb3d-card-working");
		expect(byName("Moderator")?.className).toContain("vb3d-card-completed");
		expect(byName("Moderator 2")?.className).toContain("vb3d-card-error");
		expect(byName("Offline Agent")?.className).toContain("vb3d-card-off");
		// Autonomous dot for sys-1
		const sysCard = byName("Sysadmin");
		expect(sysCard?.querySelector(".vb3d-autonomous-dot")).not.toBeNull();
	});

	it("clicking a desk selects the agent", () => {
		const onSelect = vi.fn();
		render(
			<Office3D
				agents={AGENTS}
				agentStates={STATES}
				selectedAgentId={null}
				onSelectAgent={onSelect}
				searchQuery=""
				isConnected
				activations={ACTIVATIONS}
			/>,
		);
		const cards = Array.from(
			document.querySelectorAll<HTMLElement>(".vb3d-card"),
		);
		const ceo = cards.find((c) => c.textContent?.includes("CEO"));
		expect(ceo).toBeTruthy();
		fireEvent.click(ceo as HTMLElement);
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "ceo-1" }),
		);
	});

	it("search highlight dims non-matching desks and marks matches", () => {
		const { container } = render(
			<Office3D
				agents={AGENTS}
				agentStates={STATES}
				selectedAgentId={null}
				onSelectAgent={() => {}}
				searchQuery="mod"
				isConnected
				activations={ACTIVATIONS}
			/>,
		);
		const cards = Array.from(
			container.querySelectorAll<HTMLElement>(".vb3d-card"),
		);
		const match = cards.find((c) => c.textContent?.includes("Moderator"));
		const nonMatch = cards.find((c) => c.textContent?.includes("CEO"));
		expect(match?.className).toContain("vb3d-card-match");
		// Non-matching name label dimmed
		expect(nonMatch?.querySelector(".vb3d-card-name")?.className).toContain(
			"vb3d-name-dim",
		);
	});

	it("working agents render a rising light beam", () => {
		const { container } = render(
			<Office3D
				agents={AGENTS}
				agentStates={STATES}
				selectedAgentId={null}
				onSelectAgent={() => {}}
				searchQuery=""
				isConnected
				activations={ACTIVATIONS}
			/>,
		);
		const beams = container.querySelectorAll(".vb3d-beam");
		// CEO + Sysadmin are working; Sysadmin autonomous working too
		expect(beams.length).toBeGreaterThanOrEqual(2);
	});
});
