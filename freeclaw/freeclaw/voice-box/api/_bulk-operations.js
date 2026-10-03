// ─── Bulk Operations API ───────────────────────────────────────
// POST /api/bulk-operations — Perform bulk actions on admin tables
//
// Accepts:
//   resource: "reports" | "posts" | "users" | "comments"
//   ids:      string[] — specific record IDs
//   action:   "resolve" | "archive" | "assign" | "status" | "delete" | "ban" | "unban"
//   params:   { status?, assigned_to?, reason? }
//
// Returns: { processed, failed, errors[] }
// Authorization: admin only.
// All mutations are logged to audit trail.

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { emitEvent } from "./_events.js";
import { logger } from "./_observability.js";

const MAX_BULK_SIZE = 200;

// A report's status vocabulary is NOT the post vocabulary. Posts use
// reported/in_progress/solved/archived; reports use open/pending/resolved/
// archived (api/_reports.js writes "resolved", Reports.tsx splits on
// "resolved"). Writing "solved" into a report left it permanently in the
// OPEN list — it never reached the Resolved section — while rendering with a
// "Solved" label, which is the "why does this say Solved?" confusion admins
// reported. `reports.status` is free text, so the wrong value was accepted
// silently.
const REPORT_STATUSES = ["open", "pending", "resolved", "archived"];

// ─── Action definitions ───────────────────────────────────────
const ACTIONS = {
	reports: {
		resolve: {
			validate: (params) => !!params.reason,
			execute: async (ids) =>
				supabase
					.from("reports")
					.update({
						status: "resolved",
						updated_at: new Date().toISOString(),
					})
					.in("id", ids)
					.select("id"),
		},
		archive: {
			validate: () => true,
			execute: async (ids) =>
				supabase
					.from("reports")
					.update({ status: "archived", updated_at: new Date().toISOString() })
					.in("id", ids)
					.select("id"),
		},
		status: {
			validate: (params) => REPORT_STATUSES.includes(params.status),
			execute: async (ids, params) =>
				supabase
					.from("reports")
					.update({ status: params.status, updated_at: new Date().toISOString() })
					.in("id", ids)
					.select("id"),
		},
	},
	posts: {
		resolve: {
			validate: () => true,
			execute: async (ids) =>
				supabase
					.from("posts")
					.update({ deleted: true })
					.in("id", ids)
					.select("id"),
		},
		archive: {
			validate: () => true,
			execute: async (ids) =>
				supabase
					.from("posts")
					.update({ deleted: true })
					.in("id", ids)
					.select("id"),
		},
		restore: {
			validate: () => true,
			execute: async (ids) =>
				supabase
					.from("posts")
					.update({ deleted: false })
					.in("id", ids)
					.select("id"),
		},
		delete: {
			validate: (params) => !!params.reason,
			protect: true, // requires explicit confirmation
			execute: async (ids) =>
				supabase
					.from("posts")
					.update({ deleted: true })
					.in("id", ids)
					.select("id"),
		},
	},
	users: {
		ban: {
			validate: (params) => !!params.reason,
			protect: true,
			execute: async (ids, params) =>
				supabase
					.from("users_meta")
					.update({
						banned: true,
						ban_reason: params.reason,
						banned_at: new Date().toISOString(),
					})
					.in("anon_id", ids)
					.select("anon_id"),
		},
		unban: {
			validate: () => true,
			execute: async (ids) =>
				supabase
					.from("users_meta")
					.update({
						banned: false,
						ban_reason: null,
						banned_at: null,
					})
					.in("anon_id", ids)
					.select("anon_id"),
		},
		status: {
			// A user has no free-text "status" column: the only states this
			// action can express are a dated suspension and a lift. An unknown
			// value used to fall through both branches and issue an EMPTY
			// patch update that the handler then reported as "processed".
			//
			// `suspended` with no end date was worse: it wrote
			// suspended_until = null, and checkUser only blocks when
			// suspended_until is in the future — so a bulk "suspend" silently
			// LIFTED existing suspensions. Both now fail loudly.
			validate: (params) => {
				if (params.status === "active") return true;
				if (params.status !== "suspended") return false;
				const until = Date.parse(String(params.until || ""));
				return Number.isFinite(until) && until > Date.now();
			},
			execute: async (ids, params) => {
				const update =
					params.status === "suspended"
						? { suspended_until: params.until }
						: { suspended_until: null };
				return supabase
					.from("users_meta")
					.update(update)
					.in("anon_id", ids)
					.select("anon_id");
			},
		},
	},
	comments: {
		resolve: {
			validate: () => true,
			execute: async (ids) =>
				supabase
					.from("comments")
					.update({ deleted: true })
					.in("id", ids)
					.select("id"),
		},
	},
};

// ─── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	const authed = await isAdmin(req);
	if (!authed) {
		return res.status(401).json({ error: "Admin access required" });
	}

	if (req.method !== "POST") {
		return res.status(405).json({ error: "POST required" });
	}

	const { resource, ids, action, params = {} } = req.body || {};

	// Validate inputs
	if (!resource || !ACTIONS[resource]) {
		return res.status(400).json({
			error: "Invalid resource",
			available: Object.keys(ACTIONS),
		});
	}

	if (!action || !ACTIONS[resource][action]) {
		return res.status(400).json({
			error: "Invalid action",
			available: Object.keys(ACTIONS[resource]),
		});
	}

	if (!ids || !Array.isArray(ids) || ids.length === 0) {
		return res.status(400).json({ error: "ids array required" });
	}

	if (ids.length > MAX_BULK_SIZE) {
		return res.status(400).json({
			error: `Maximum ${MAX_BULK_SIZE} records per bulk operation`,
		});
	}

	const actionDef = ACTIONS[resource][action];

	// Validate params
	if (actionDef.validate && !actionDef.validate(params)) {
		return res.status(400).json({ error: "Missing required params for this action" });
	}

	// Execute
	try {
		const startTime = Date.now();
		const { data, error } = await actionDef.execute(ids, params);

		if (error) {
			logger.error("bulk-operations", "execute_failed", {
				resource,
				action,
				error: error.message,
			});
			return res.status(500).json({ error: "Operation failed", detail: error.message });
		}

		const processed = data?.length || 0;
		const failed = ids.length - processed;
		const duration = Date.now() - startTime;

		// Audit log
		const auditEntry = {
			action: `bulk.${resource}.${action}`,
			ids_count: ids.length,
			processed,
			failed,
			duration_ms: duration,
			params: Object.keys(params).length > 0 ? params : undefined,
		};

		// Emit event for activity stream
		try {
			await emitEvent({
				event_type: `bulk.${action}.completed`,
				source: "admin",
				resource_type: resource,
				payload: auditEntry,
			});
		} catch {
			// Non-fatal
		}

		logger.info("bulk-operations", "bulk_completed", auditEntry);

		return res.status(200).json({
			success: true,
			processed,
			failed,
			duration_ms: duration,
			action: `${resource}.${action}`,
		});
	} catch (err) {
		logger.error("bulk-operations", "bulk_error", {
			resource,
			action,
			error: err.message,
		});
		return res.status(500).json({ error: "Bulk operation failed" });
	}
}
