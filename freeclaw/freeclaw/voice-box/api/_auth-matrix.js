// Route-Level Authorization Matrix
// Centralized security enforcement before route dispatch in api/index.js.
// Prevents service-role client bypass and guarantees every endpoint class
// (Admin, Cron, User / Session-Owner, Public) is strictly authorized.

import {
	hasMaintenanceSecret,
	isAdmin,
	isCronAuthorized,
} from "./_auth.js";

// Re-exported for callers that historically imported cron auth from the
// matrix module. There is exactly ONE implementation (_auth.js, constant-time);
// the duplicate non-timing-safe copy that used to live here was a latent
// timing oracle on the cron secret.
export { isCronAuthorized };

export const ROUTE_CLASS = {
	ADMIN_ONLY: "admin_only",
	CRON_ONLY: "cron_only",
	USER_ONLY: "user_only",
	METHOD_MATRIX: "method_matrix",
	PUBLIC: "public",
};

export const ROUTE_MATRIX = {
	// ── Pure Admin Endpoints ──
	"admin-export": ROUTE_CLASS.ADMIN_ONLY,
	"audit-trail": ROUTE_CLASS.ADMIN_ONLY,
	"bulk-operations": ROUTE_CLASS.ADMIN_ONLY,
	"command-center": ROUTE_CLASS.ADMIN_ONLY,
	"report-deck": ROUTE_CLASS.ADMIN_ONLY,
	"tech-debt": ROUTE_CLASS.ADMIN_ONLY,
	db_stats: ROUTE_CLASS.ADMIN_ONLY,
	cleanup: ROUTE_CLASS.ADMIN_ONLY,
	"workforce-center": ROUTE_CLASS.ADMIN_ONLY,
	"workforce-api": ROUTE_CLASS.ADMIN_ONLY,
	"workforce-proof": ROUTE_CLASS.ADMIN_ONLY,
	"workforce-bridge": ROUTE_CLASS.ADMIN_ONLY,
	workforce: ROUTE_CLASS.ADMIN_ONLY,
	"autonomous-harnesses": ROUTE_CLASS.ADMIN_ONLY,
	"event-agents": ROUTE_CLASS.ADMIN_ONLY,
	"agent-executions": ROUTE_CLASS.ADMIN_ONLY,
	"tool-forge": ROUTE_CLASS.ADMIN_ONLY,
	"tool-registry": ROUTE_CLASS.ADMIN_ONLY,
	"email-templates": ROUTE_CLASS.ADMIN_ONLY,
	"v3/audit": ROUTE_CLASS.ADMIN_ONLY,
	"v3/security": ROUTE_CLASS.ADMIN_ONLY,
	"v3/monitoring": ROUTE_CLASS.ADMIN_ONLY,
	// Spam console. GET returns quarantined posts (including author_id) plus
	// activity_logs entries; on an anonymous platform that pairing is
	// deanonymizing, so it must never be reachable without an admin token.
	spam: ROUTE_CLASS.ADMIN_ONLY,
	// Quarantine event history. Handler already calls isAdmin(); listed here
	// so the gate is auditable from the matrix alone.
	abuse: ROUTE_CLASS.ADMIN_ONLY,
	// Operator control surface for failover/replication. Unknown routes default
	// to PUBLIC here, so this entry is what actually protects the endpoint.
	reliability: ROUTE_CLASS.ADMIN_ONLY,

	// ── Cron Endpoints ──
	"agent-cron": ROUTE_CLASS.CRON_ONLY,
	"agents-cron": ROUTE_CLASS.CRON_ONLY,
	"incident-cron": ROUTE_CLASS.CRON_ONLY,
	"keep-alive": ROUTE_CLASS.CRON_ONLY,
	// Scheduled retention sweep. Called by Vercel Cron with GET, by an admin
	// with POST, or by an external scheduler holding MAINTENANCE_SECRET.
	maintenance: ROUTE_CLASS.CRON_ONLY,
	// Primary → standby convergence tick. Reached by an external scheduler
	// (Hobby plan allows only two Vercel crons) or by an admin manually.
	"replication-cron": ROUTE_CLASS.CRON_ONLY,

	// ── User / Session-Owner Endpoints ──
	saved: ROUTE_CLASS.USER_ONLY,
	follows: ROUTE_CLASS.USER_ONLY,
	"notify-prefs": ROUTE_CLASS.USER_ONLY,
	me: ROUTE_CLASS.USER_ONLY,
	appeals: ROUTE_CLASS.USER_ONLY,
	"data-export": ROUTE_CLASS.USER_ONLY,

	// ── Method-Specific Matrix ──
	admin: ROUTE_CLASS.METHOD_MATRIX,
	reports: ROUTE_CLASS.METHOD_MATRIX,
	announcements: ROUTE_CLASS.METHOD_MATRIX,
	announcement: ROUTE_CLASS.METHOD_MATRIX,
	categories: ROUTE_CLASS.METHOD_MATRIX,
	improvements: ROUTE_CLASS.METHOD_MATRIX,
	incidents: ROUTE_CLASS.METHOD_MATRIX,
	"action-center": ROUTE_CLASS.METHOD_MATRIX,
	"golden-workflows": ROUTE_CLASS.METHOD_MATRIX,
	"search-quality": ROUTE_CLASS.METHOD_MATRIX,
	"feature-health": ROUTE_CLASS.METHOD_MATRIX,
	providers: ROUTE_CLASS.METHOD_MATRIX,
	rag: ROUTE_CLASS.METHOD_MATRIX,
	persona: ROUTE_CLASS.METHOD_MATRIX,
	"ai-resolution": ROUTE_CLASS.METHOD_MATRIX,
	"resolution-evidence": ROUTE_CLASS.METHOD_MATRIX,
	learning: ROUTE_CLASS.METHOD_MATRIX,
	insights: ROUTE_CLASS.METHOD_MATRIX,
	"v3/tools": ROUTE_CLASS.METHOD_MATRIX,
	"v3/verify": ROUTE_CLASS.METHOD_MATRIX,
	"v3/orchestrate": ROUTE_CLASS.METHOD_MATRIX,
	"v3/rag": ROUTE_CLASS.METHOD_MATRIX,
	"v3/memory": ROUTE_CLASS.METHOD_MATRIX,
};

/**
 * Enforce the route authorization matrix centrally.
 * Returns { authorized: boolean, status?: number, error?: string, code?: string }
 */
export async function verifyRouteAccess(endpoint, req) {
	const classification = ROUTE_MATRIX[endpoint] || ROUTE_CLASS.PUBLIC;
	if (classification === ROUTE_CLASS.PUBLIC) {
		return { authorized: true };
	}

	const hasAdminToken = Boolean(req.headers?.["x-admin-token"]);
	const adminVerdict = await isAdmin(req);

	// 1. Pure Admin Routes
	if (classification === ROUTE_CLASS.ADMIN_ONLY) {
		if (adminVerdict) return { authorized: true };
		return {
			authorized: false,
			status: hasAdminToken ? 403 : 401,
			error: hasAdminToken ? "Admin only" : "Admin access required",
			code: hasAdminToken ? "forbidden" : "unauthorized",
		};
	}

	// 2. Cron Routes (Cron secret, Admin, or — scheduled upkeep only — the
	//    dedicated MAINTENANCE_SECRET for an external scheduler)
	if (classification === ROUTE_CLASS.CRON_ONLY) {
		const allowsMaintenanceSecret =
			endpoint === "maintenance" || endpoint === "replication-cron";
		if (
			(await isCronAuthorized(req)) ||
			adminVerdict ||
			(allowsMaintenanceSecret && hasMaintenanceSecret(req))
		) {
			return { authorized: true };
		}
		return {
			authorized: false,
			status: 401,
			error: "Unauthorized cron invocation",
			code: "unauthorized",
		};
	}

	// 3. User / Session-Owner Routes
	if (classification === ROUTE_CLASS.USER_ONLY) {
		if (adminVerdict) return { authorized: true };
		const anonId =
			req.headers?.["x-anon-id"] ||
			req.query?.user_id ||
			req.query?.anon_id ||
			req.body?.user_id ||
			req.body?.anon_id;
		const hasSessionToken = Boolean(
			req.headers?.["x-session-token"] ||
				(typeof req.headers?.authorization === "string" &&
					req.headers.authorization.startsWith("Bearer ")),
		);
		if (anonId || hasSessionToken) {
			return { authorized: true };
		}
		return {
			authorized: false,
			status: 401,
			error: "User identity required",
			code: "unauthorized",
		};
	}

	// 4. Method Matrix Routes
	if (classification === ROUTE_CLASS.METHOD_MATRIX) {
		const method = (req.method || "GET").toUpperCase();

		// /api/admin handler special cases
		if (endpoint === "admin") {
			const action = req.body?.action || req.query?.action;
			if (action === "login" || action === "verify") {
				return { authorized: true };
			}
			if (adminVerdict) return { authorized: true };
			return {
				authorized: false,
				status: hasAdminToken ? 403 : 401,
				error: hasAdminToken ? "Admin only" : "Admin access required",
				code: hasAdminToken ? "forbidden" : "unauthorized",
			};
		}

		// /api/reports handler
		if (endpoint === "reports") {
			// POST is public user reporting
			if (method === "POST") return { authorized: true };
			// GET, PUT, DELETE are admin only
			if (adminVerdict) return { authorized: true };
			return {
				authorized: false,
				status: hasAdminToken ? 403 : 401,
				error: hasAdminToken ? "Admin only" : "Admin access required",
				code: hasAdminToken ? "forbidden" : "unauthorized",
			};
		}

		// Read-public, write-admin endpoints
		const readPublicWriteAdmin = [
			"announcements",
			"announcement",
			"categories",
			"improvements",
			"incidents",
			"action-center",
			"golden-workflows",
			"search-quality",
			"feature-health",
			"providers",
			"rag",
			"persona",
			"ai-resolution",
			"resolution-evidence",
			"learning",
			"insights",
			"v3/tools",
			"v3/verify",
			"v3/orchestrate",
			"v3/rag",
			"v3/memory",
		];
		if (readPublicWriteAdmin.includes(endpoint)) {
			if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
				return { authorized: true };
			}
			if (adminVerdict) return { authorized: true };
			return {
				authorized: false,
				status: hasAdminToken ? 403 : 401,
				error: hasAdminToken ? "Admin only" : "Admin access required",
				code: hasAdminToken ? "forbidden" : "unauthorized",
			};
		}
	}

	return { authorized: true };
}
