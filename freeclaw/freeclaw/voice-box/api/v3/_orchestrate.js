// ─── V3 Orchestrator Endpoint ─────────────────────────────────────
// Enterprise multi-agent orchestration with task routing,
// workflow execution, and result synthesis.
//
// POST /api/v3/orchestrate — route a query to the best agent
// POST /api/v3/orchestrate — execute a multi-agent workflow
// GET  /api/v3/orchestrate — list available agents

import { cors, isAdmin } from "../_auth.js";
import { sanitizeError } from "../_error.js";
import {
	executeAgentTask,
	getAgent,
	getAllAgents,
	orchestrateQuery,
	routeTask,
} from "../_orchestrator.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	// Public: GET agent list and pure task routing have no side effects.
	// Everything that EXECUTES agents or tools requires admin — inside the
	// orchestrator agents run with role 'admin', which unlocks admin-only tools
	// (create_post, set_announcement, warn_user, get_reports, ...). An
	// unauthenticated caller must never reach those.
	const body = req.body || {};
	const isExecution =
		req.method === "POST" &&
		(body.action === "execute" || body.action === "orchestrate");
	if (isExecution && !(await isAdmin(req))) {
		return res.status(403).json({ error: "Admin only" });
	}

	try {
		// ── List available agents ──────────────────────────────────────
		if (req.method === "GET") {
			const agents = getAllAgents().map((a) => ({
				id: a.id,
				name: a.name,
				description: a.description,
				capabilities: a.capabilities,
				priority: a.priority,
				tools: a.tools,
			}));
			return res.status(200).json({ agents });
		}

		// ── Route a query to the best agent ────────────────────────────
		if (body.action === "route" && body.query) {
			const agent = routeTask(body.query);
			return res.status(200).json({
				query: body.query,
				agent: {
					id: agent.id,
					name: agent.name,
					description: agent.description,
					capabilities: agent.capabilities,
				},
			});
		}

		// ── Execute a single agent task ────────────────────────────────
		if (body.action === "execute" && body.agent_id && body.query) {
			const agent = getAgent(body.agent_id);
			if (!agent) {
				return res
					.status(404)
					.json({ error: `Agent '${body.agent_id}' not found` });
			}

			const result = await executeAgentTask(agent, body.query, {
				sessionId: body.session_id,
				userId: body.user_id,
			});

			return res.status(200).json(result);
		}

		// ── Orchestrate a multi-agent query ────────────────────────────
		if (body.action === "orchestrate" && body.query) {
			const result = await orchestrateQuery(body.query, {
				sessionId: body.session_id,
				userId: body.user_id,
				maxAgents: body.max_agents || 3,
			});

			return res.status(200).json(result);
		}

		// ── Default: route the query ───────────────────────────────────
		if (body.query) {
			const agent = routeTask(body.query);
			return res.status(200).json({
				query: body.query,
				agent: {
					id: agent.id,
					name: agent.name,
					description: agent.description,
				},
			});
		}

		return res
			.status(400)
			.json({
				error: "Invalid request. Provide query, or action with agent_id.",
			});
	} catch (err) {
		console.error("[V3-ORCHESTRATE] Error:", err.message);
		sanitizeError(res, err, "v3-orchestrate");
	}
}
