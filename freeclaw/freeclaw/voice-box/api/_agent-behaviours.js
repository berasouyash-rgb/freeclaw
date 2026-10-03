// ═══════════════════════════════════════════════════════════════════
// AGENT BEHAVIOURS — resolve what an agent can actually DO
// ═══════════════════════════════════════════════════════════════════
// The roster declares 90 agents, but agents do not each have their own
// logic. `processAgentTask()` routes an agent to a BRANCH based on its
// declared capabilities, and a branch is a behaviour shared by many agents.
//
// Measured on the real router: 57 branches, of which only 3 mutate any
// state. 31 of the 90 agents match no branch at all and fall through to a
// generic "ask an LLM for a status report" fallback — real token spend,
// real execution rows, zero system change.
//
// This module makes that distinction explicit and machine-readable so the
// platform can stop reporting "completed" for work that never happened.
//
//   resolveBehaviour(agent) → the branch the router will actually take
//   classifyAgent(agent)    → { impact, status } for a single agent
//   auditRoster(agents)     → roster-level counts + the retired list
//   buildScorecard(...)     → per-agent HEALTH vs real IMPACT
// ═══════════════════════════════════════════════════════════════════

import { BEHAVIOURS, ROUTED_CAPABILITIES } from "./_agent-behaviours.data.js";

export { BEHAVIOURS, ROUTED_CAPABILITIES };

/** What an agent's behaviour is capable of changing. */
export const IMPACT = {
	/** Writes to the database — disabling it changes observable state. */
	ACT: "act",
	/** Reads and reports only — consumed as insight, changes nothing. */
	ADVISORY: "advisory",
	/** Matches no branch: only reaches the generic LLM fallback. */
	NONE: "none",
};

export const STATUS = {
	/** Reaches a real behaviour branch. */
	ACTIVE: "active",
	/** Reaches no branch — no behaviour, no impact. */
	RETIRED: "retired",
};

/**
 * Resolve the branch the router will take for this agent.
 *
 * The router returns on the FIRST matching `hasCap(...)` group, so first
 * match in registry order reproduces its behaviour exactly.
 */
export function resolveBehaviour(agent) {
	const caps = Array.isArray(agent?.capabilities) ? agent.capabilities : [];
	if (caps.length === 0) return null;
	for (const behaviour of BEHAVIOURS) {
		if (behaviour.capabilities.some((c) => caps.includes(c))) {
			return behaviour;
		}
	}
	return null;
}

/** Classify one agent: what it can do, and whether it can do anything. */
export function classifyAgent(agent) {
	const behaviour = resolveBehaviour(agent);
	if (!behaviour) {
		return {
			agent_id: agent?.id ?? "unknown",
			name: agent?.name ?? "Unknown",
			division: agent?.division ?? "unknown",
			behaviour_id: null,
			behaviour_label: null,
			impact: IMPACT.NONE,
			status: STATUS.RETIRED,
			reason:
				"no routed capability — every run reaches the generic LLM fallback and changes no state",
		};
	}
	return {
		agent_id: agent.id,
		name: agent.name,
		division: agent.division,
		behaviour_id: behaviour.id,
		behaviour_label: behaviour.label,
		impact: behaviour.impact,
		status: STATUS.ACTIVE,
		reason: null,
	};
}

/**
 * Retire reason for an agent, or null when it has a real behaviour.
 * Used by the cron to skip agents that cannot do anything.
 */
export function retirementReason(agent) {
	const behaviour = resolveBehaviour(agent);
	return behaviour
		? null
		: "no routed capability (generic LLM fallback only) — skipped to avoid recording work that changes nothing";
}

/** Roster-level audit: how much of the roster can actually change state. */
export function auditRoster(agents = []) {
	const rows = agents.map(classifyAgent);
	const byImpact = { [IMPACT.ACT]: 0, [IMPACT.ADVISORY]: 0, [IMPACT.NONE]: 0 };
	for (const r of rows) byImpact[r.impact]++;

	// Which behaviours are actually reachable, and by how many agents.
	const behaviourUse = new Map();
	for (const r of rows) {
		if (!r.behaviour_id) continue;
		behaviourUse.set(r.behaviour_id, (behaviourUse.get(r.behaviour_id) || 0) + 1);
	}

	const retired = rows.filter((r) => r.status === STATUS.RETIRED);

	return {
		agents_total: rows.length,
		behaviours_available: BEHAVIOURS.length,
		behaviours_reachable: behaviourUse.size,
		behaviours_state_changing: BEHAVIOURS.filter((b) => b.impact === IMPACT.ACT)
			.length,
		agents_reaching_a_behaviour: rows.filter((r) => r.status === STATUS.ACTIVE)
			.length,
		agents_retired: retired.length,
		impact_breakdown: byImpact,
		// The consolidation signal: how many agents share one behaviour.
		agents_per_behaviour: [...behaviourUse.entries()]
			.map(([behaviour_id, agents]) => ({ behaviour_id, agents }))
			.sort((a, b) => b.agents - a.agents),
		retired_agents: retired.map((r) => ({
			agent_id: r.agent_id,
			name: r.name,
			division: r.division,
			reason: r.reason,
		})),
	};
}

// ───────────────────────────────────────────────────────────────────
// SCORECARD — HEALTH is not IMPACT
// ───────────────────────────────────────────────────────────────────
// "Agent healthy" only means the process ran. It says nothing about value.
// The scorecard reports the two separately so an agent with 10,000 runs and
// zero state changes is visibly obvious instead of looking productive.

/** Per-agent verdict. */
const VERDICT = {
	IMPACTFUL: "impactful",
	ADVISORY_ONLY: "advisory-only",
	NO_IMPACT: "no-impact",
	FAILING: "failing",
};

function isFailure(execution) {
	return execution?.status === "failed" || execution?.status === "error";
}

/**
 * Build the scorecard from the roster plus REAL execution rows.
 *
 * @param {Array} agents     agent definitions (id/name/division/capabilities)
 * @param {Array} executions rows from agent_executions / settings fallback
 * @param {object} opts      { now?: number, failureRateThreshold?: number }
 */
export function buildScorecard(agents = [], executions = [], opts = {}) {
	const now = opts.now ?? Date.now();
	const failureThreshold = opts.failureRateThreshold ?? 0.25;
	const DAY = 86_400_000;

	// Index execution rows by agent id.
	const byAgent = new Map();
	for (const e of executions) {
		const id = e?.agent_id;
		if (!id) continue;
		if (!byAgent.has(id)) byAgent.set(id, []);
		byAgent.get(id).push(e);
	}

	const rows = agents.map((agent) => {
		const cls = classifyAgent(agent);
		const runs = byAgent.get(agent.id) || [];

		const failures = runs.filter(isFailure).length;
		const successes = runs.length - failures;
		const started = runs
			.map((r) => +new Date(r.completed_at || r.started_at || 0))
			.filter((t) => Number.isFinite(t) && t > 0);
		const lastRunAt = started.length ? new Date(Math.max(...started)).toISOString() : null;
		const runs24h = started.filter((t) => now - t < DAY).length;
		const stuck = runs.filter((r) => r.status === "running").length;
		const failureRate = runs.length ? failures / runs.length : 0;

		// ── HEALTH: is the process alive and succeeding?
		const health = {
			runs: runs.length,
			runs_24h: runs24h,
			successes,
			failures,
			failure_rate: Number(failureRate.toFixed(3)),
			last_run_at: lastRunAt,
			never_ran: runs.length === 0,
			stuck_executions: stuck,
			alive: runs.length > 0 && failureRate < failureThreshold,
		};

		// ── IMPACT: did anything in the system actually change?
		// Only a state-changing behaviour can produce impact. Advisory
		// behaviours compute real numbers but mutate nothing, so their
		// honest impact count is zero — not "unknown", zero.
		const stateChanging = cls.impact === IMPACT.ACT;
		const impact = {
			class: cls.impact,
			behaviour_id: cls.behaviour_id,
			behaviour_label: cls.behaviour_label,
			state_changing: stateChanging,
			// Where a real state change could have come from.
			executions_that_could_change_state: stateChanging ? successes : 0,
			verified_state_changes: null, // filled from the worker ledger when available
			disable_test: stateChanging
				? `Disabling stops the "${cls.behaviour_label}" state change performed by this agent.`
				: cls.status === STATUS.RETIRED
					? "Disabling changes nothing observable — this agent reaches no behaviour."
					: `Disabling changes nothing observable — "${cls.behaviour_label}" only reads and reports.`,
		};

		let verdict;
		if (cls.status === STATUS.RETIRED) verdict = VERDICT.NO_IMPACT;
		else if (!health.alive && runs.length > 0) verdict = VERDICT.FAILING;
		else if (stateChanging) verdict = VERDICT.IMPACTFUL;
		else verdict = VERDICT.ADVISORY_ONLY;

		return {
			agent_id: agent.id,
			name: agent.name,
			division: agent.division,
			status: cls.status,
			health,
			impact,
			verdict,
		};
	});

	const tally = {
		[VERDICT.IMPACTFUL]: 0,
		[VERDICT.ADVISORY_ONLY]: 0,
		[VERDICT.NO_IMPACT]: 0,
		[VERDICT.FAILING]: 0,
	};
	for (const r of rows) tally[r.verdict]++;

	const totalRuns = executions.length;
	// Every execution belonging to an agent that cannot change state. This is
	// the number the Office dashboard should NOT be presenting as productive.
	const executionsWithoutStateChange = rows
		.filter((r) => !r.impact.state_changing)
		.reduce((n, r) => n + r.health.runs, 0);

	return {
		generated_at: new Date(now).toISOString(),
		summary: {
			agents: rows.length,
			// The headline separation: liveness vs value.
			healthy: rows.filter((r) => r.health.alive).length,
			no_real_impact: rows.filter(
				(r) =>
					r.verdict === VERDICT.NO_IMPACT ||
					r.verdict === VERDICT.ADVISORY_ONLY,
			).length,
			state_changing_agents: rows.filter((r) => r.impact.state_changing).length,
			total_executions: totalRuns,
			executions_without_state_change: executionsWithoutStateChange,
			verdicts: tally,
		},
		agents: rows.sort((a, b) => a.name.localeCompare(b.name)),
	};
}

export { VERDICT };
