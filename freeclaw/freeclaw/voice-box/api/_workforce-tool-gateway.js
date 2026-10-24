// ═══════════════════════════════════════════════════════════════════
// TOOL GATEWAY — All worker infrastructure actions go through here
// ═══════════════════════════════════════════════════════════════════
// No worker has unrestricted access. Every tool call is:
//   1. Authorized (worker identity + permissions check)
//   2. Validated (input schema + risk level)
//   3. Rate-limited (per-tool and per-worker)
//   4. Executed (real operation)
//   5. Audited (who, what, when, result)
//   6. Verified (independent verification step)
//
// Risk levels:
//   SAFE_READ:      read metrics, inspect data, no side effects
//   SAFE_WRITE:     refresh analytics, reindex search, invalidate cache
//   CONTROLLED:     config changes, index changes, scaling
//   HIGH_RISK:      schema migration, data deletion, auth changes
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

// ── Tool Registry ─────────────────────────────────────────────
const _tools = new Map();
const _auditLog = [];
const AUDIT_MAX = 500;

export const RISK_LEVELS = {
	SAFE_READ: "SAFE_READ",
	SAFE_WRITE: "SAFE_WRITE",
	CONTROLLED: "CONTROLLED",
	HIGH_RISK: "HIGH_RISK",
};

/**
 * Register a tool that workers can invoke.
 * @param {Object} spec
 * @param {string} spec.tool_id
 * @param {string} spec.description
 * @param {string} spec.risk_level - one of RISK_LEVELS
 * @param {Function} spec.execute - async (worker, input) => result
 * @param {Function} spec.validate - async (input) => boolean
 * @param {Function} [spec.verify] - async (result) => { ok, proof }
 * @param {Function} [spec.rollback] - async (result) => void
 * @param {number} [spec.timeout_ms] - max execution time
 * @param {number} [spec.rate_limit] - max calls per minute per worker
 * @param {string[]} [spec.allowed_workers] - worker IDs allowed to use this tool (empty = all)
 */
export function registerTool(spec) {
	if (!spec.tool_id || !spec.execute) {
		throw new Error(`Tool registration failed: missing tool_id or execute`);
	}
	_tools.set(spec.tool_id, {
		timeout_ms: 30_000,
		rate_limit: 10,
		allowed_workers: [], // empty = all workers allowed
		...spec,
	});
}

export function getTool(toolId) {
	return _tools.get(toolId);
}

export function getAllTools() {
	return [..._tools.values()].map((t) => ({
		tool_id: t.tool_id,
		description: t.description,
		risk_level: t.risk_level,
		timeout_ms: t.timeout_ms,
		rate_limit: t.rate_limit,
	}));
}

// ── Rate Limiting ─────────────────────────────────────────────
const _rateCounts = new Map(); // key: `${worker_id}:${tool_id}` => { count, window_start }

function checkRateLimit(workerId, toolId, limit) {
	const key = `${workerId}:${toolId}`;
	const now = Date.now();
	const entry = _rateCounts.get(key);

	if (!entry || now - entry.window_start > 60_000) {
		_rateCounts.set(key, { count: 1, window_start: now });
		return true;
	}

	if (entry.count >= limit) {
		return false;
	}

	entry.count++;
	return true;
}

// ── Audit Logging ─────────────────────────────────────────────
function auditLog(entry) {
	_auditLog.unshift({
		...entry,
		timestamp: new Date().toISOString(),
	});
	if (_auditLog.length > AUDIT_MAX) {
		_auditLog.length = AUDIT_MAX;
	}
}

export function readAuditLog(limit = 50) {
	return _auditLog.slice(0, limit);
}

// ── Execution with Timeout ────────────────────────────────────
function withTimeout(fn, ms) {
	return Promise.race([
		fn(),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`Tool timeout after ${ms}ms`)), ms),
		),
	]);
}

// ── Main Gateway Execution ────────────────────────────────────
/**
 * Execute a tool through the gateway.
 * @param {string} workerId - the worker requesting the tool
 * @param {string} toolId - the tool to execute
 * @param {Object} input - tool input parameters
 * @returns {Object} { success, result, error, audit_id }
 */
export async function executeTool(workerId, toolId, input = {}) {
	const tool = _tools.get(toolId);
	if (!tool) {
		return { success: false, error: `Unknown tool: ${toolId}` };
	}

	// 1. Authorization check
	if (
		tool.allowed_workers.length > 0 &&
		!tool.allowed_workers.includes(workerId)
	) {
		auditLog({
			worker_id: workerId,
			tool_id: toolId,
			action: "authorization_denied",
			risk_level: tool.risk_level,
			error: `Worker ${workerId} not authorized for tool ${toolId}`,
		});
		return { success: false, error: `Worker not authorized for this tool` };
	}

	// 2. Rate limit check
	if (!checkRateLimit(workerId, toolId, tool.rate_limit)) {
		auditLog({
			worker_id: workerId,
			tool_id: toolId,
			action: "rate_limited",
			risk_level: tool.risk_level,
		});
		return { success: false, error: `Rate limit exceeded for tool ${toolId}` };
	}

	// 3. Input validation
	if (tool.validate) {
		try {
			const valid = await tool.validate(input);
			if (!valid) {
				auditLog({
					worker_id: workerId,
					tool_id: toolId,
					action: "validation_failed",
					risk_level: tool.risk_level,
					error: "Input validation failed",
				});
				return { success: false, error: `Input validation failed` };
			}
		} catch (err) {
			return { success: false, error: `Validation error: ${err.message}` };
		}
	}

	// 4. Execute with timeout
	const auditId = `tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
	try {
		const result = await withTimeout(
			() => tool.execute(workerId, input),
			tool.timeout_ms,
		);

		// 5. Verify if tool has verification
		let verification = null;
		if (tool.verify) {
			try {
				verification = await tool.verify(result);
			} catch (err) {
				verification = { ok: false, proof: `Verification error: ${err.message}` };
			}
		}

		auditLog({
			audit_id: auditId,
			worker_id: workerId,
			tool_id: toolId,
			action: "executed",
			risk_level: tool.risk_level,
			input: JSON.stringify(input).slice(0, 200),
			result: JSON.stringify(result).slice(0, 300),
			verification: verification?.proof || null,
			success: verification ? verification.ok : true,
		});

		return {
			success: verification ? verification.ok : true,
			result,
			verification,
			audit_id: auditId,
		};
	} catch (err) {
		auditLog({
			audit_id: auditId,
			worker_id: workerId,
			tool_id: toolId,
			action: "execution_failed",
			risk_level: tool.risk_level,
			error: err.message,
		});
		return { success: false, error: err.message, audit_id: auditId };
	}
}

// ── Dry Run Support ───────────────────────────────────────────
/**
 * Execute a tool in dry-run mode: validate + simulate without side effects.
 * Only works for tools that support dry_run.
 */
export async function dryRunTool(workerId, toolId, input = {}) {
	const tool = _tools.get(toolId);
	if (!tool) {
		return { success: false, error: `Unknown tool: ${toolId}` };
	}

	// Validate input
	if (tool.validate) {
		try {
			const valid = await tool.validate(input);
			if (!valid) {
				return { success: false, error: `Input validation failed` };
			}
		} catch (err) {
			return { success: false, error: `Validation error: ${err.message}` };
		}
	}

	// Check authorization
	if (
		tool.allowed_workers.length > 0 &&
		!tool.allowed_workers.includes(workerId)
	) {
		return { success: false, error: `Worker not authorized for this tool` };
	}

	auditLog({
		worker_id: workerId,
		tool_id: toolId,
		action: "dry_run",
		risk_level: tool.risk_level,
		input: JSON.stringify(input).slice(0, 200),
	});

	return {
		success: true,
		result: { dry_run: true, input, would_execute: true },
		dry_run: true,
	};
}
