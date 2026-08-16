// Evidence Audit Trail — verifiable records for tool executions & moderation actions.
// Backs the `tool_evidence` table written by _tool-registry.js (storeToolEvidence).
//
// GET    /api/evidence                → list evidence (admin) with filters + pagination
// GET    /api/evidence?id=X           → single evidence record (admin)
// POST   /api/evidence                → create an evidence record (admin)
// PUT    /api/evidence                → update verification_status (admin)
// DELETE /api/evidence?id=X           → delete an evidence record (admin)

import { auditLog, clean, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

const VALID_ACTION_TYPES = ["query", "create", "modify", "delete", "escalate"];
const VALID_RISK_LEVELS = ["low", "medium", "high", "critical"];
const VALID_VERIFICATION = ["pending", "verified", "rejected", "auto_verified"];

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	// /api/evidence/scan resolves to this route in index.js (endpoint = parts[1]).
	// Forward sub-path requests to the evidence-scan scanner handler so the
	// documented POST /api/evidence/scan contract keeps working.
	if (req.url?.split("?")[0].endsWith("/scan")) {
		try {
			const { default: evidenceScanHandler } = await import(
				"./_evidence-scan.js"
			);
			return evidenceScanHandler(req, res);
		} catch {
			/* fall through to normal evidence routing */
		}
	}

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		if (req.method === "GET") {
			const {
				id,
				tool_name,
				action_type,
				actor_id,
				verification_status,
				limit: limitParam,
			} = req.query;
			const limit = Math.min(parseInt(limitParam) || 50, 200);

			if (id) {
				const { data, error } = await supabase
					.from("tool_evidence")
					.select("*")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				if (!data) return res.status(404).json({ error: "Evidence not found" });
				return res.status(200).json(data);
			}

			let query = supabase
				.from("tool_evidence")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(limit);
			if (tool_name) query = query.eq("tool_name", clean(tool_name, 100));
			if (action_type) query = query.eq("action_type", action_type);
			if (actor_id) query = query.eq("actor_id", clean(actor_id, 100));
			if (verification_status)
				query = query.eq("verification_status", verification_status);

			const { data, error } = await query;
			if (error) throw error;
			return res.status(200).json(data || []);
		}

		if (req.method === "POST") {
			const b = req.body || {};
			const toolName = clean(b.tool_name, 100);
			if (!toolName)
				return res.status(400).json({ error: "tool_name is required" });

			const row = {
				tool_call_id: b.tool_call_id ? clean(b.tool_call_id, 100) : null,
				conversation_id: b.conversation_id
					? clean(b.conversation_id, 100)
					: null,
				tool_name: toolName,
				action_type: VALID_ACTION_TYPES.includes(b.action_type)
					? b.action_type
					: "query",
				input_params:
					b.input_params && typeof b.input_params === "object"
						? b.input_params
						: {},
				output_result:
					b.output_result && typeof b.output_result === "object"
						? b.output_result
						: {},
				actor_id: clean(b.actor_id, 100) || "admin",
				actor_type: b.actor_type === "user" ? "user" : "admin",
				ip_address: b.ip_address ? clean(b.ip_address, 64) : null,
				risk_level: VALID_RISK_LEVELS.includes(b.risk_level)
					? b.risk_level
					: "low",
				requires_approval:
					b.risk_level === "high" || b.risk_level === "critical",
				verification_status: VALID_VERIFICATION.includes(b.verification_status)
					? b.verification_status
					: "pending",
			};

			const { data, error } = await supabase
				.from("tool_evidence")
				.insert(row)
				.select()
				.single();
			if (error) throw error;
			await auditLog(
				"admin",
				"create_evidence",
				`${toolName} (${row.action_type})`,
			);
			return res.status(201).json(data);
		}

		if (req.method === "PUT") {
			const b = req.body || {};
			const { id } = b;
			if (!id) return res.status(400).json({ error: "id is required" });

			const patch = {};
			if (VALID_VERIFICATION.includes(b.verification_status))
				patch.verification_status = b.verification_status;
			if (
				b.requires_approval !== undefined &&
				typeof b.requires_approval === "boolean"
			)
				patch.requires_approval = b.requires_approval;
			if (b.output_result !== undefined && typeof b.output_result === "object")
				patch.output_result = b.output_result;
			if (!Object.keys(patch).length)
				return res.status(400).json({ error: "Nothing to update" });

			// .maybeSingle() (not .single()): a non-matching id returns { data: null,
			// error: null } instead of a PGRST116 error, so the 404 branch is reachable
			// — and no separate existence pre-check round-trip is needed.
			const { data, error } = await supabase
				.from("tool_evidence")
				.update(patch)
				.eq("id", id)
				.select()
				.maybeSingle();
			if (error) throw error;
			if (!data) return res.status(404).json({ error: "Evidence not found" });
			await auditLog(
				"admin",
				"update_evidence",
				`${id}: ${Object.keys(patch).join(", ")}`,
			);
			return res.status(200).json(data);
		}

		if (req.method === "DELETE") {
			// index.js parseBody always yields a truthy object, so req.query must be
			// checked FIRST — `req.body || req.query` would short-circuit to the body.
			const id = req.query?.id || req.body?.id;
			if (!id) return res.status(400).json({ error: "id is required" });
			const { error } = await supabase
				.from("tool_evidence")
				.delete()
				.eq("id", id);
			if (error) throw error;
			await auditLog("admin", "delete_evidence", String(id));
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "evidence");
	}
}
