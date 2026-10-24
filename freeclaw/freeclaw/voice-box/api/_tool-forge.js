// Tool Forging System — AI creates, manages, and executes custom tools.
// Ported from Ada-SI's tools_engine.py pattern. Stores tools in Supabase settings.

import { auditLog, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { assertSafeSelect, runSelectQuery } from "./_agent-chat.js";

const TOOLS_KEY = "forged_tools";

/** Substitute template placeholders with single-quote-escaped values.
 *  Supports both :key and ${key} forms. Split/join (never RegExp) so a key
 *  like ".*" cannot become a regex attack, and values can never break out
 *  of their literal (SQL '' convention). Mirrors _agent-chat.js custom tools.
 *  The template author owns quoting: "… = '${s}'" + s="o'clock" →
 *  "… = 'o''clock'". */
export function substituteTemplate(template, params) {
	let sql = String(template || "");
	for (const [key, value] of Object.entries(params || {})) {
		const safe = String(value ?? "").replace(/'/g, "''");
		sql = sql.split(`:${key}`).join(safe);
		sql = sql.split(`\${${key}}`).join(safe);
	}
	return sql;
}

// ─── Tool Storage ─────────────────────────────────────────────────
export async function listForgedTools() {
	try {
		const { data, error } = await supabase
			.from("settings")
			.select("value")
			.eq("key", TOOLS_KEY)
			.single();
		if (error || !data) return [];
		const parsed =
			typeof data.value === "string" ? JSON.parse(data.value) : data.value;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export async function saveForgedTool(tool) {
	const tools = await listForgedTools();
	const idx = tools.findIndex((t) => t.name === tool.name);
	if (idx >= 0) {
		tools[idx] = {
			...tools[idx],
			...tool,
			updated_at: new Date().toISOString(),
		};
	} else {
		tools.push(tool);
	}
	const { error } = await supabase
		.from("settings")
		.upsert(
			{ key: TOOLS_KEY, value: JSON.stringify(tools) },
			{ onConflict: "key" },
		);
	if (error) throw error;
	return tool;
}

export async function getToolByName(name) {
	const tools = await listForgedTools();
	return tools.find((t) => t.name === name) || null;
}

export async function deleteForgedTool(name) {
	const tools = await listForgedTools();
	const filtered = tools.filter((t) => t.name !== name);
	if (filtered.length === tools.length)
		throw new Error(`Tool '${name}' not found`);
	const { error } = await supabase
		.from("settings")
		.upsert(
			{ key: TOOLS_KEY, value: JSON.stringify(filtered) },
			{ onConflict: "key" },
		);
	if (error) throw error;
}

// ─── Tool Schema Generator ───────────────────────────────────────
// Generates OpenAI-style function schemas from forged tool definitions
export function toolToSchema(tool) {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: {
				type: "object",
				properties: tool.parameters || {},
				required: tool.required || [],
			},
		},
	};
}

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		const action =
			req.method === "GET"
				? req.query.action || "list"
				: req.body?.action || "list";

		// List all forged tools
		if (req.method === "GET" && action === "list") {
			const tools = await listForgedTools();
			return res.status(200).json({ tools });
		}

		// Get tool schemas for LLM
		if (req.method === "GET" && action === "schemas") {
			const tools = await listForgedTools();
			const schemas = tools.map(toolToSchema);
			return res.status(200).json({ schemas });
		}

		// All other actions require POST + admin
		if (req.method !== "POST")
			return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		// Create or update a tool
		if (action === "save") {
			const { tool } = req.body || {};
			if (!tool || !tool.name || !tool.description) {
				return res
					.status(400)
					.json({ error: "Missing tool name or description" });
			}
			// Validate tool name
			if (!/^[a-zA-Z][a-zA-Z0-9_]{1,63}$/.test(tool.name)) {
				return res
					.status(400)
					.json({
						error:
							"Tool name must be 2-64 chars, alphanumeric + underscore, starting with letter",
					});
			}
			tool.created_at = tool.created_at || new Date().toISOString();
			tool.created_by = tool.created_by || "admin";
			// Least-privilege (spec §6): custom tools are SELECT-only at
			// REGISTRATION, so a stored template can never become a write path.
			if (tool.sql_template) {
				try {
					assertSafeSelect(tool.sql_template);
				} catch (e) {
					return res.status(400).json({ error: String(e?.message || e) });
				}
			}
			await saveForgedTool(tool);
			await auditLog("tool_forge", "save_tool", `Saved tool: ${tool.name}`);
			return res.status(200).json({ ok: true, tool });
		}

		// Delete a tool
		if (action === "delete") {
			const { name } = req.body || {};
			if (!name) return res.status(400).json({ error: "Missing tool name" });
			await deleteForgedTool(name);
			await auditLog("tool_forge", "delete_tool", `Deleted tool: ${name}`);
			return res.status(200).json({ ok: true });
		}

		// Execute a tool
		if (action === "execute") {
			const { name, params } = req.body || {};
			if (!name) return res.status(400).json({ error: "Missing tool name" });
			const tool = await getToolByName(name);
			if (!tool)
				return res.status(404).json({ error: `Tool '${name}' not found` });

			if (tool.sql_template) {
				// Substitute with escaped literals, then gate the SUBSTITUTED
				// text: arg values cannot smuggle stacked statements or
				// comments past the registration-time check.
				const query = substituteTemplate(tool.sql_template, params);
				try {
					assertSafeSelect(query);
				} catch (e) {
					return res.status(200).json({ ok: false, error: String(e?.message || e) });
				}
				// Native RPC first; built-in SELECT interpreter when the
				// deployment never created exec_sql (same path as execute_sql).
				try {
					const { data, error } = await supabase
						.rpc("exec_sql", { sql: query })
						.maybeSingle();
					if (!error) {
						await auditLog("tool_forge", "execute_tool", `Executed tool: ${name}`);
						return res.status(200).json({ ok: true, result: data });
					}
					if (!/exist|found|PGRST|404|schema/i.test(String(error.message || "")))
						return res.status(200).json({ ok: false, error: `SQL error: ${error.message}` });
				} catch (rpcErr) {
					if (/SQL error/.test(String(rpcErr?.message || "")))
						return res.status(200).json({ ok: false, error: String(rpcErr.message) });
					// rpc missing/crashed → interpreter below
				}
				try {
					const rows = await runSelectQuery(query);
					await auditLog("tool_forge", "execute_tool", `Executed tool: ${name}`);
					return res.status(200).json({ ok: true, result: rows });
				} catch (ie) {
					return res.status(200).json({ ok: false, error: String(ie?.message || ie) });
				}
			}

			return res
				.status(200)
				.json({ ok: true, result: null, message: "Tool has no SQL template" });
		}

		// Bulk save tools (for AI forging)
		if (action === "bulk_save") {
			const { tools } = req.body || {};
			if (!Array.isArray(tools))
				return res.status(400).json({ error: "tools must be an array" });
			for (const tool of tools) {
				if (!tool.name || !tool.description) continue;
				if (tool.sql_template) {
					try {
						assertSafeSelect(tool.sql_template);
					} catch {
						continue; // skip non-SELECT templates, never store a write path
					}
				}
				tool.created_at = tool.created_at || new Date().toISOString();
				tool.created_by = tool.created_by || "ai-forge";
				await saveForgedTool(tool);
			}
			await auditLog("tool_forge", "bulk_save", `Saved ${tools.length} tools`);
			return res.status(200).json({ ok: true, count: tools.length });
		}

		return res.status(400).json({ error: "Unknown action" });
	} catch (err) {
		return sanitizeError(res, err, "tool-forge");
	}
}
