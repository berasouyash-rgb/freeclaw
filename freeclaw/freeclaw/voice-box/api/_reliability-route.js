// ─── Reliability control surface ────────────────────────────────
// Operator-facing view of the failover/replication stack.
//
//   GET  /api/reliability            → status snapshot (read-only)
//   POST /api/reliability            → operator action (audited)
//
// Authorization is enforced twice on purpose:
//   1. api/_auth-matrix.js classifies `reliability` as ADMIN_ONLY, before
//      dispatch. An unknown route defaults to PUBLIC there, so forgetting to
//      register it would silently expose this surface.
//   2. This handler re-checks isAdmin(). It is imported directly by tests and
//      could be mounted elsewhere, so it must stand on its own.
//
// Safety rules baked in here:
//   • GET never mutates state and answers 200 even when nothing is configured,
//     so the dashboard can honestly say "standby not configured" instead of
//     rendering an error.
//   • failover/recover are refused in production unless the operator sets
//     RELIABILITY_ALLOW_PROD_DRILL=1. The decision comes from the server
//     environment only — never from the request body, never from a client.
//   • Adapter/driver error strings are scrubbed before they leave the process.

import { auditLog, cors, isAdmin } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import {
	AdapterUnavailableError,
	BackendError,
	ReadOnlyError,
	StaleWriteError,
} from "./_backend/errors.js";
import { getBackend } from "./_backend/index.js";

const PROD_DRILL_FLAG = "RELIABILITY_ALLOW_PROD_DRILL";
const ACTION_TIMEOUT_MS = 25_000;

/** Actions that move traffic. Blocked in production unless explicitly enabled. */
const TRAFFIC_ACTIONS = new Set(["failover", "recover"]);

/** POST actions this route will run. Anything else is a 400, not a guess. */
const ALLOWED_ACTIONS = new Set([
	"status",
	"evaluate",
	"failover",
	"recover",
	"replicate",
	"verify",
	"flush-standby-copy",
	"dlq-list",
	"dlq-drop",
	"dlq-clear",
]);

function isProduction(env = process.env) {
	return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

function prodDrillEnabled(env = process.env) {
	const raw = String(env[PROD_DRILL_FLAG] ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Remove credential-bearing fragments and long opaque blobs from a string
 * before it is returned to a client. Deliberately conservative: the goal is
 * "no secrets, no full URLs with query keys", not pretty prose.
 */
export function scrub(value) {
	if (value === null || value === undefined) return value;
	if (typeof value !== "string") return value;
	let out = value
		// JWTs / bearer tokens
		.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-token]")
		// key=value credentials in URLs or connection strings
		.replace(/([?&](?:apikey|api_key|key|token|secret|password|sig)=)[^&\s]+/gi, "$1[redacted]")
		// Supabase / service-role style keys
		.replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted-key]")
		.replace(/service_role[^,\s]*/gi, "service_role[redacted]")
		// "Bearer <token>"
		.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]");
	if (out.length > 400) out = `${out.slice(0, 400)}…`;
	return out;
}

/** Deep-scrub every string in a response object. Cycles are cut. */
export function scrubDeep(input, seen = new WeakSet()) {
	if (input === null || typeof input !== "object") return scrub(input);
	if (seen.has(input)) return "[circular]";
	seen.add(input);
	if (Array.isArray(input)) return input.map((item) => scrubDeep(item, seen));
	const out = {};
	for (const [key, val] of Object.entries(input)) {
		out[key] = scrubDeep(val, seen);
	}
	return out;
}

function errorStatus(err) {
	if (err instanceof AdapterUnavailableError) return 503;
	if (err instanceof ReadOnlyError) return 409;
	if (err instanceof StaleWriteError) return 409;
	if (err instanceof BackendError) {
		switch (err.code) {
			case "NO_STANDBY":
				return 409;
			case "BAD_ACTION":
			case "BAD_OPERATION":
			case "OUT_OF_SCOPE":
			case "MISSING_ID":
			case "MISSING_VERSION":
			case "APPEND_ONLY":
				return 400;
			case "NOT_FOUND":
				return 404;
			case "ADAPTER_UNAVAILABLE":
				return 503;
			case "READ_ONLY_MODE":
				return 409;
			case "WRITE_IN_FLIGHT":
				return 429;
			default:
				return err.retryable ? 503 : 500;
		}
	}
	return 500;
}

function errorBody(err) {
	const status = errorStatus(err);
	// BackendError messages are authored in this codebase and are safe to
	// surface; anything else is replaced with a generic message.
	const message =
		err instanceof BackendError
			? scrub(String(err.message || "backend error"))
			: "Reliability action failed";
	return {
		status,
		body: {
			error: message,
			code: err?.code || "RELIABILITY_ERROR",
			retryable: err?.retryable === true,
		},
	};
}

function withTimeout(promise, ms, label) {
	let timer = null;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new BackendError(`${label} timed out after ${ms}ms`, {
					code: "ADAPTER_TIMEOUT",
					retryable: true,
				}),
			);
		}, ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/** Parse a comma-separated or array `tables` value into a clean string list. */
function readTables(input) {
	if (Array.isArray(input)) {
		return input.map((t) => String(t).trim()).filter(Boolean).slice(0, 64);
	}
	if (typeof input === "string" && input.trim()) {
		return input
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean)
			.slice(0, 64);
	}
	return undefined;
}

async function runAction(backend, action, req) {
	const body = req.body && typeof req.body === "object" ? req.body : {};
	const tables = readTables(body.tables ?? req.query?.tables);

	switch (action) {
		case "status":
			return backend.status();

		case "evaluate":
			return backend.evaluate({ force: body.force !== false });

		case "failover":
			return backend.drill({
				action: "failover",
				reason: typeof body.reason === "string" ? body.reason.slice(0, 200) : undefined,
				allowProduction: prodDrillEnabled(),
			});

		case "recover":
			return backend.drill({
				action: "recover",
				reason: typeof body.reason === "string" ? body.reason.slice(0, 200) : undefined,
			});

		case "replicate":
			return backend.replicate({ tables, reset: body.reset === true });

		case "verify":
			return backend.verify({ tables });

		case "flush-standby-copy":
			// Drains queued Firestore copies. Idempotent, and honest when the
			// credentials are absent (it reports zeros, not a fake success).
			return backend.flushStandbyCopy();

		case "dlq-list": {
			const limit = Number.parseInt(String(body.limit ?? req.query?.limit ?? "50"), 10);
			return {
				entries: await backend.dlq.list({
					limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50,
				}),
				size: await backend.dlq.size().catch(() => null),
			};
		}

		case "dlq-drop": {
			const id = String(body.id ?? req.query?.id ?? "").trim();
			if (!id) {
				throw new BackendError("dlq-drop requires an entry id", { code: "MISSING_ID" });
			}
			return backend.dlq.drop(id);
		}

		case "dlq-clear": {
			await backend.dlq.clear();
			return { cleared: true };
		}

		default:
			throw new BackendError(`Unknown action "${action}"`, { code: "BAD_ACTION" });
	}
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	if (req.method !== "GET" && req.method !== "POST") {
		return res.status(405).json({ error: "GET or POST only", allow: "GET, POST" });
	}

	// Defense in depth — the route matrix already gated this endpoint.
	if (!(await isAdmin(req))) {
		return res.status(403).json({ error: "Admin only" });
	}

	let backend;
	try {
		backend = await getBackend();
	} catch (err) {
		// Never let a construction failure take down the dashboard: report it
		// as an honest "not available" with a scrubbed reason.
		if (req.method === "GET") {
			return res.status(200).json({
				available: false,
				enabled: { failover: false, replication: false },
				mode: "unknown",
				standby_configured: false,
				error: scrub(err?.message || String(err)),
			});
		}
		return sanitizeError(res, err, "reliability");
	}

	// ── GET: pure status, never mutates ────────────────────────────
	if (req.method === "GET") {
		try {
			const status = await withTimeout(backend.status(), ACTION_TIMEOUT_MS, "status");
			return res.status(200).json(scrubDeep(status));
		} catch (err) {
			const { status, body } = errorBody(err);
			return res.status(status).json(body);
		}
	}

	// ── POST: operator action ──────────────────────────────────────
	const body = req.body && typeof req.body === "object" ? req.body : {};
	const action = String(body.action ?? req.query?.action ?? "").trim();

	if (!action) {
		return res.status(400).json({
			error: "An action is required",
			allowed: [...ALLOWED_ACTIONS],
		});
	}
	if (!ALLOWED_ACTIONS.has(action)) {
		return res.status(400).json({
			error: `Unknown action "${action}"`,
			allowed: [...ALLOWED_ACTIONS],
		});
	}

	if (TRAFFIC_ACTIONS.has(action) && isProduction() && !prodDrillEnabled()) {
		return res.status(403).json({
			error:
				"Failover drills are disabled in production. Set RELIABILITY_ALLOW_PROD_DRILL=1 on the server to enable them.",
			code: "PROD_DRILL_BLOCKED",
		});
	}

	try {
		const result = await withTimeout(runAction(backend, action, req), ACTION_TIMEOUT_MS, action);

		// Audit every traffic-affecting action. Read-only actions are cheap and
		// frequent (a dashboard poll); they are not logged individually.
		if (TRAFFIC_ACTIONS.has(action) || action.startsWith("dlq-")) {
			const actor = "admin";
			const detail =
				action === "dlq-drop"
					? `dlq-drop ${String(body.id ?? req.query?.id ?? "").slice(0, 80)}`
					: action;
			await auditLog(actor, `reliability:${action}`, detail).catch(() => false);
		}

		return res.status(200).json(scrubDeep({ success: true, action, result }));
	} catch (err) {
		const { status, body: errorPayload } = errorBody(err);
		return res.status(status).json(errorPayload);
	}
}
