// Agent Executions API — serves real execution data to the dashboard
// Self-healing: uses runner functions that fall back to settings table
import { ALL_AGENTS } from "./_agent-definitions.js";
import { auditRoster, buildScorecard } from "./_agent-behaviours.js";
import { cors, isAdmin } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import {
	getDashboardStats,
	getRecentActivity,
	getRecentExecutions,
} from "./agents/_runner.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		const action = req.method === "GET" ? req.query.action : req.body?.action;

		// List recent executions
		if (action === "list" || (!action && req.method === "GET")) {
			const limit = Math.min(parseInt(req.query.limit) || 50, 200);
			const agentId = req.query.agent_id || null;
			const executions = await getRecentExecutions(agentId, limit);
			return res.status(200).json({ executions, total: executions.length });
		}

		// Get activity log
		if (action === "activity") {
			const limit = Math.min(parseInt(req.query.limit) || 50, 200);
			const activities = await getRecentActivity(limit);
			return res.status(200).json({ activities, total: activities.length });
		}

		// Get dashboard stats
		if (action === "stats") {
			const stats = await getDashboardStats();
			return res.status(200).json(stats);
		}

		// ── Agent scorecard — HEALTH vs real IMPACT ───────────────────
		// "Healthy" only means the process ran; it says nothing about value.
		// This action reports the two separately, and lists the agents whose
		// capabilities route them to no behaviour at all (they cannot change
		// anything, so their executions must not be read as productive work).
		if (action === "scorecard") {
			const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
			const executions = await getRecentExecutions(null, limit);
			const scorecard = buildScorecard(ALL_AGENTS, executions, {
				failureRateThreshold: 0.25,
			});
			return res.status(200).json({
				...scorecard,
				roster_audit: auditRoster(ALL_AGENTS),
				executions_sampled: executions.length,
			});
		}

		// Roster audit only — how many agents can actually do work.
		if (action === "roster") {
			return res.status(200).json(auditRoster(ALL_AGENTS));
		}

		// Get single execution detail
		if (action === "get") {
			const id = req.query.id;
			if (!id) return res.status(400).json({ error: "id required" });
			const executions = await getRecentExecutions(null, 200);
			const execution = executions.find((e) => e.id === id);
			if (!execution) return res.status(404).json({ error: "Not found" });
			return res.status(200).json({ execution });
		}

		return res
			.status(400)
			.json({
				error:
					"Unknown action. Actions: list, activity, stats, scorecard, roster, get",
			});
	} catch (err) {
		return sanitizeError(res, err, "agent-executions");
	}
}
