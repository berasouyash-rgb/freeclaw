/**
 * AGENT BEHAVIOURS — regression tests.
 *
 * Locks in the audit findings that justified consolidating the roster:
 *
 *   1. Agents do not have their own logic. `processAgentTask()` routes them to
 *      a shared BRANCH by capability. The registry must reflect the router
 *      exactly — the drift guard fails the build if they ever diverge.
 *   2. Only a handful of branches write to the database. Everything else only
 *      reads and reports, and 31 agents match no branch at all and would fall
 *      through to a generic LLM fallback.
 *   3. "Healthy" and "impactful" are different things, and the scorecard must
 *      never let a high-volume advisory agent look like it changed something.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALL_AGENTS } from "../../api/_agent-definitions.js";
import {
	BEHAVIOURS,
	IMPACT,
	ROUTED_CAPABILITIES,
	STATUS,
	VERDICT,
	auditRoster,
	buildScorecard,
	classifyAgent,
	resolveBehaviour,
} from "../../api/_agent-behaviours.js";

// ── Drift guard ──────────────────────────────────────────────────
// Parse the real router and assert the registry matches it exactly.

function routerCapabilities(): {
	groups: string[][];
	count: number;
} {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../api/_agent-team.js"),
		"utf8",
	);
	const start = source.indexOf("async function processAgentTask");
	expect(start, "processAgentTask must exist").toBeGreaterThan(-1);

	// Slice the function body by brace balance.
	let depth = 0;
	let began = false;
	let end = -1;
	for (let i = source.indexOf("{", start); i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") {
			depth++;
			began = true;
		} else if (ch === "}") {
			depth--;
			if (began && depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	const body = source.slice(start, end);

	const groups: string[][] = [];
	const re = /hasCap\(\s*agent\s*,\s*([\s\S]*?)\)\s*\)\s*\{/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) {
		const cap = m[1] ?? "";
		groups.push([
			...new Set((cap.match(/"([a-z_]+)"/g) || []).map((s) => s.replace(/"/g, ""))),
		]);
	}
	return { groups, count: groups.length };
}

describe("behaviour registry — must not drift from the router", () => {
	it("declares exactly one behaviour per router branch", () => {
		const { count } = routerCapabilities();
		expect(BEHAVIOURS.length).toBe(count);
	});

	it("covers exactly the capabilities the router branches on", () => {
		const { groups } = routerCapabilities();
		const routerSet = new Set(groups.flat());
		const registrySet = new Set<string>(ROUTED_CAPABILITIES as string[]);

		const missing = [...routerSet].filter((c) => !registrySet.has(c as string));
		const extra = [...registrySet].filter((c) => !routerSet.has(c as string));

		expect(missing, "capabilities in the router but missing from the registry").toEqual([]);
		expect(extra, "capabilities in the registry but not in the router").toEqual([]);
	});

	it("marks a behaviour as state-changing only if it really writes", () => {
		// Guards against the registry silently regressing to "advisory" for a
		// branch that genuinely mutates (content moderation hides posts, report
		// triage changes report status).
		for (const b of BEHAVIOURS as Array<{ id: string; impact: string }>) {
			expect(["act", "advisory"], `${b.id} impact`).toContain(b.impact);
		}
		expect(
			(BEHAVIOURS as Array<{ impact: string }>).filter((b) => b.impact === IMPACT.ACT).length,
		).toBeGreaterThan(0);
	});
});

describe("agent classification", () => {
	it("retires an agent whose capabilities match no branch", () => {
		const orphan = {
			id: "orphan-agent",
			name: "Orphan",
			division: "test",
			capabilities: ["definitely_not_a_routed_capability"],
		};
		expect(resolveBehaviour(orphan)).toBeNull();
		const cls = classifyAgent(orphan);
		expect(cls.status).toBe(STATUS.RETIRED);
		expect(cls.impact).toBe(IMPACT.NONE);
		expect(cls.reason).toMatch(/no routed capability/i);
	});

	it("routes a report-triage agent to the only state-changing report behaviour", () => {
		const triage = {
			id: "triage-agent",
			name: "Triage",
			division: "content",
			capabilities: ["report_triage"],
		};
		const cls = classifyAgent(triage);
		expect(cls.status).toBe(STATUS.ACTIVE);
		expect(cls.behaviour_id).toBe("report-triage");
		expect(cls.impact).toBe(IMPACT.ACT);
	});

	it("keeps first-match ordering, mirroring the router's if/else", () => {
		const behaviour = resolveBehaviour({
			id: "x",
			name: "X",
			capabilities: [BEHAVIOURS[0].capabilities[0]],
		});
		expect(behaviour?.id).toBe(BEHAVIOURS[0].id);
	});
});

describe("live roster audit", () => {
	const audit = auditRoster(ALL_AGENTS);

	it("accounts for every agent exactly once", () => {
		const classified =
			audit.agents_reaching_a_behaviour + audit.agents_retired;
		expect(classified).toBe(audit.agents_total);
		expect(audit.agents_total).toBe(ALL_AGENTS.length);
	});

	it("reports the real consolidation signal", () => {
		// These are measurements of the shipping roster, not aspirations.
		expect(audit.behaviours_state_changing).toBeGreaterThan(0);
		expect(audit.behaviours_state_changing).toBeLessThan(
			audit.behaviours_available,
		);
		// If the roster is ever consolidated, retired count drops. It must
		// never silently disappear from the audit.
		expect(audit.agents_retired).toBe(31);
	});

	it("lists a reason for every retired agent", () => {
		for (const r of audit.retired_agents) {
			expect(r.reason, `${r.agent_id} reason`).toBeTruthy();
		}
	});
});

describe("scorecard — health is not impact", () => {
	const advisoryAgent = {
		id: "adv",
		name: "Advisory Agent",
		division: "analytics",
		capabilities: ["kpi_tracking"],
	};
	const actAgent = {
		id: "act",
		name: "Acting Agent",
		division: "content",
		capabilities: ["report_triage"],
	};
	const orphanAgent = {
		id: "orphan",
		name: "Orphan Agent",
		division: "meta",
		capabilities: ["nothing_routes_here"],
	};

	it("does not let a high-volume advisory agent read as impactful", () => {
		const executions = Array.from({ length: 500 }, (_, i) => ({
			agent_id: "adv",
			status: "completed",
			started_at: new Date(Date.now() - i * 60_000).toISOString(),
		}));
		const card = buildScorecard([advisoryAgent], executions);

		expect(card.agents[0].health.runs).toBe(500);
		expect(card.agents[0].health.alive).toBe(true);
		expect(card.agents[0].verdict).toBe(VERDICT.ADVISORY_ONLY);
		expect(card.agents[0].impact.state_changing).toBe(false);
		expect(card.summary.executions_without_state_change).toBe(500);
	});

	it("marks a state-changing agent impactful", () => {
		const executions = [{ agent_id: "act", status: "completed" }];
		const card = buildScorecard([actAgent], executions);
		expect(card.agents[0].impact.state_changing).toBe(true);
		expect(card.agents[0].verdict).toBe(VERDICT.IMPACTFUL);
	});

	it("marks an agent with no behaviour as no-impact even if it ran a lot", () => {
		const executions = Array.from({ length: 900 }, () => ({
			agent_id: "orphan",
			status: "completed",
		}));
		const card = buildScorecard([orphanAgent], executions);
		expect(card.agents[0].health.runs).toBe(900);
		expect(card.agents[0].verdict).toBe(VERDICT.NO_IMPACT);
		expect(card.agents[0].impact.disable_test).toMatch(/changes nothing/i);
	});

	it("separates failing health from impact", () => {
		const executions = Array.from({ length: 10 }, () => ({
			agent_id: "act",
			status: "failed",
		}));
		const card = buildScorecard([actAgent], executions);
		expect(card.agents[0].health.alive).toBe(false);
		expect(card.agents[0].verdict).toBe(VERDICT.FAILING);
	});

	it("still reports healthy count separately from no-impact count", () => {
		const executions = Array.from({ length: 10 }, () => ({
			agent_id: "adv",
			status: "completed",
		}));
		const card = buildScorecard([advisoryAgent, orphanAgent], executions);
		expect(card.summary.healthy).toBe(1);
		expect(card.summary.no_real_impact).toBe(2);
		expect(card.summary.state_changing_agents).toBe(0);
	});
});
