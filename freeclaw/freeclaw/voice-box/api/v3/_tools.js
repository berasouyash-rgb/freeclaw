// ─── V3 Tool Calling Endpoint ─────────────────────────────────────
// Enterprise tool calling with schema validation, permission control,
// retry logic, audit logging, and result caching.
//
// POST /api/v3/tools — list available tools for a role
// POST /api/v3/tools — execute a tool with validation
// GET  /api/v3/tools — list tools (alternative)

import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import {
  getToolsForRole,
  getToolSchemasForRole,
  executeTool,
  executeTools,
  validateParams,
  getTool,
} from '../_tool-registry.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = req.body || {};
    const action = req.method === 'GET'
      ? (req.query.action || 'list')
      : (body.action || 'list');

    // ── List available tools ──────────────────────────────────────
    if (action === 'list') {
      const adminMode = isAdmin(req);
      const role = adminMode ? 'admin' : 'student';
      const tools = getToolSchemasForRole(role);
      return res.status(200).json({
        role,
        count: tools.length,
        tools,
      });
    }

    // ── Get tool details ──────────────────────────────────────────
    if (action === 'get' && body.name) {
      const tool = getTool(body.name);
      if (!tool) {
        return res.status(404).json({ error: `Tool '${body.name}' not found` });
      }
      return res.status(200).json({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        permissions: tool.permissions,
        category: tool.category,
        requiresApproval: tool.requiresApproval || false,
      });
    }

    // ── Validate tool parameters ──────────────────────────────────
    if (action === 'validate' && body.name) {
      const tool = getTool(body.name);
      if (!tool) {
        return res.status(404).json({ error: `Tool '${body.name}' not found` });
      }
      const errors = validateParams(tool, body.params || {});
      return res.status(200).json({
        valid: errors.length === 0,
        errors,
      });
    }

    // ── Execute a single tool ─────────────────────────────────────
    if (action === 'execute' && body.name) {
      const adminMode = isAdmin(req);
      const role = adminMode ? 'admin' : 'student';

      const result = await executeTool(body.name, body.params || {}, {
        role,
        requestId: req.headers['x-request-id'],
        ip: req.headers['x-forwarded-for'],
      });

      if (result.error) {
        return res.status(400).json(result);
      }
      return res.status(200).json(result);
    }

    // ── Execute multiple tools in batch ───────────────────────────
    if (action === 'batch' && Array.isArray(body.tools)) {
      const adminMode = isAdmin(req);
      const role = adminMode ? 'admin' : 'student';

      if (body.tools.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 tools per batch' });
      }

      const results = await executeTools(body.tools, { role });
      return res.status(200).json({ results });
    }

    // ── Invalid action ────────────────────────────────────────────
    return res.status(400).json({ error: 'Invalid action. Use: list, get, validate, execute, batch' });

  } catch (err) {
    console.error('[V3-TOOLS] Error:', err.message);
    sanitizeError(res, err, 'v3-tools');
  }
}
