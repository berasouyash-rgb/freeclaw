// ═══════════════════════════════════════════════════════════════════
// WORKFORCE API — Admin endpoints for workforce management
// ═══════════════════════════════════════════════════════════════════
// GET  /api/workforce-api?action=status         → comprehensive workforce status
// GET  /api/workforce-api?action=impact         → impact measurement log
// GET  /api/workforce-api?action=audit          → tool execution audit trail
// GET  /api/workforce-api?action=tools          → registered tools list
// GET  /api/workforce-api?action=supervisor     → supervisor status
// POST /api/workforce-api?action=execute-tool   → execute a tool through gateway
// POST /api/workforce-api?action=dry-run        → dry-run a tool
// POST /api/workforce-api?action=unpause        → unpause a worker
// POST /api/workforce-api?action=rollback       → rollback a worker's last action
// ═══════════════════════════════════════════════════════════════════

import { cors, isAdmin } from "./_auth.js";
import { setSecurityHeaders } from "./_security.js";
import {
	getWorkforceStatus,
	getAuditLog,
	getImpactLog,
	getImpactSummary,
	getSupervisorSummary,
	executeTool,
	preExecutionCheck,
	unpauseWorker,
	executeRollback,
} from "./_workforce-integration.js";
import { getAllTools } from "./_workforce-tool-gateway.js";
import { getTrainingStatus } from "./_training-lab.js";

export default async function handler(req, res) {
	cors(res, req.method === "OPTIONS");

	if (req.method === "OPTIONS") return res.status(200).end();
	if (!(await isAdmin(req)))
		return res.status(401).json({ error: "Admin required" });

	setSecurityHeaders(res);

	const action = req.query?.action || req.body?.action;

	try {
		switch (action) {
			case "status": {
				const status = await getWorkforceStatus();
				return res.json(status);
			}

			case "impact": {
				const limit = parseInt(req.query?.limit || "50", 10);
				const log = await getImpactLog(limit);
				const summary = await getImpactSummary();
				return res.json({ log, summary });
			}

			case "audit": {
				const limit = parseInt(req.query?.limit || "50", 10);
				const log = getAuditLog(limit);
				return res.json({ log, count: log.length });
			}

			case "tools": {
				const tools = getAllTools();
				return res.json({ tools, count: tools.length });
			}

		case "supervisor": {
			const summary = getSupervisorSummary();
			return res.json(summary);
		}

		case "training-status": {
			const status = await getTrainingStatus();
			return res.json(status);
		}

			case "execute-tool": {
				const { worker_id, tool_id, input } = req.body || {};
				if (!worker_id || !tool_id) {
					return res.status(400).json({ error: "worker_id and tool_id required" });
				}

				// Pre-execution check
				const check = preExecutionCheck(worker_id);
				if (!check.allowed) {
					return res.status(403).json({ error: check.reason });
				}

				const result = await executeTool(worker_id, tool_id, input || {});
				return res.json(result);
			}

			case "dry-run": {
				const { worker_id, tool_id, input } = req.body || {};
				if (!worker_id || !tool_id) {
					return res.status(400).json({ error: "worker_id and tool_id required" });
				}
				const { dryRunTool } = await import("./_workforce-tool-gateway.js");
				const result = await dryRunTool(worker_id, tool_id, input || {});
				return res.json(result);
			}

			case "unpause": {
				const { worker_id } = req.body || {};
				if (!worker_id) {
					return res.status(400).json({ error: "worker_id required" });
				}
				const result = unpauseWorker(worker_id);
				return res.json(result);
			}

			case "rollback": {
				const { worker_id } = req.body || {};
				if (!worker_id) {
					return res.status(400).json({ error: "worker_id required" });
				}
				const result = await executeRollback(worker_id);
				return res.json(result);
			}

			default:
				return res.status(400).json({ error: `Unknown action: ${action}` });
		}
	} catch (err) {
		console.error("[workforce-api] error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
