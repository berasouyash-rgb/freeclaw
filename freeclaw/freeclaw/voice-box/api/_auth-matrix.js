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
	smart: ROUTE_CLASS.ADMIN_ONLY,
	buddy: ROUTE_CLASS.ADMIN_ONLY,
	"tool-registry": ROUTE_CLASS.ADMIN_ONLY,
	"email-templates": ROUTE_CLASS.ADMIN_ONLY,
	"v3/audit": ROUTE_CLASS.ADMIN_ONLY,
	"v3/security": ROUTE_CLASS.ADMIN_ONLY,
	"v3/monitoring": ROUTE_CLASS.ADMIN_ONLY,
	"v3/stream": ROUTE_CLASS.ADMIN_ONLY,
	security: ROUTE_CLASS.ADMIN_ONLY,
	"evidence-scan": ROUTE_CLASS.ADMIN_ONLY,
	"quarantine-scan": ROUTE_CLASS.ADMIN_ONLY,
	memory: ROUTE_CLASS.ADMIN_ONLY,
	"meta-agent": ROUTE_CLASS.ADMIN_ONLY,
	"agent-team": ROUTE_CLASS.ADMIN_ONLY,
	performance: ROUTE_CLASS.ADMIN_ONLY,
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
	notifications: ROUTE_CLASS.USER_ONLY,
	inbox: ROUTE_CLASS.USER_ONLY,

	// ── Method-Specific Matrix ──
	admin: ROUTE_CLASS.METHOD_MATRIX,
	"admin-events": ROUTE_CLASS.METHOD_MATRIX,
	upload: ROUTE_CLASS.METHOD_MATRIX,
	users: ROUTE_CLASS.METHOD_MATRIX,
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

	// ── Public Routes (Explicitly Registered) ──
	posts: ROUTE_CLASS.PUBLIC,
	comments: ROUTE_CLASS.PUBLIC,
	communities: ROUTE_CLASS.PUBLIC,
	polls: ROUTE_CLASS.PUBLIC,
	reactions: ROUTE_CLASS.PUBLIC,
	chat: ROUTE_CLASS.PUBLIC,
	search: ROUTE_CLASS.PUBLIC,
	health: ROUTE_CLASS.PUBLIC,
	trends: ROUTE_CLASS.PUBLIC,
	timeline: ROUTE_CLASS.PUBLIC,
	version: ROUTE_CLASS.PUBLIC,
	badges: ROUTE_CLASS.PUBLIC,
	vitals: ROUTE_CLASS.PUBLIC,
	errors: ROUTE_CLASS.PUBLIC,
	events: ROUTE_CLASS.PUBLIC,
	"identity-link": ROUTE_CLASS.PUBLIC,
	"pre-publish": ROUTE_CLASS.PUBLIC,
	"pre-review": ROUTE_CLASS.PUBLIC,
	moderate: ROUTE_CLASS.PUBLIC,
	leaderboard: ROUTE_CLASS.PUBLIC,
	transcribe: ROUTE_CLASS.PUBLIC,
	duplicates: ROUTE_CLASS.PUBLIC,
	routing: ROUTE_CLASS.PUBLIC,
	agent: ROUTE_CLASS.PUBLIC,
	ai: ROUTE_CLASS.PUBLIC,
	assist: ROUTE_CLASS.PUBLIC,
	evidence: ROUTE_CLASS.PUBLIC,
	"conversation-assist": ROUTE_CLASS.PUBLIC,
	"ai-chat": ROUTE_CLASS.PUBLIC,
	proactive: ROUTE_CLASS.PUBLIC,
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
			// Pre-auth actions. `auth_mode` returns a single boolean
			// (`env_secret`) that the login screen needs BEFORE it has a
			// credential — without it, env-secret deployments silently fall
			// back to password mode and lock the operator out. It leaks no
			// secret, only which credential the UI should collect.
			if (
				action === "login" ||
				action === "verify" ||
				action === "auth_mode"
			) {
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

		// /api/admin-events handler
		if (endpoint === "admin-events") {
			if (adminVerdict) return { authorized: true };
			const ticket = req.query?.ticket;
			if (method === "GET" && typeof ticket === "string" && ticket.length >= 32) {
				return { authorized: true };
			}
			return {
				authorized: false,
				status: hasAdminToken ? 403 : 401,
				error: hasAdminToken ? "Admin only" : "Admin access required",
				code: hasAdminToken ? "forbidden" : "unauthorized",
			};
		}

		// /api/upload handler (file upload bound to active user or admin)
		if (endpoint === "upload") {
			if (adminVerdict) return { authorized: true };
			const anonId = req.headers?.["x-anon-id"];
			const hasSessionToken = Boolean(req.headers?.["x-session-token"] || req.headers?.authorization);
			if (anonId || hasSessionToken) return { authorized: true };
			return {
				authorized: false,
				status: 401,
				error: "User identity required for uploads",
				code: "unauthorized",
			};
		}

		// /api/users handler (POST heartbeat is public/user, admin views are admin-only)
		if (endpoint === "users") {
			if (method === "POST") return { authorized: true };
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

	if (!ROUTE_MATRIX[endpoint]) {
		console.warn(`[gateway] Unclassified route accessed: ${endpoint} (${req.method})`);
	}
	return { authorized: true };
}
