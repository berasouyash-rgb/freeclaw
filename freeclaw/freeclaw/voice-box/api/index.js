// Consolidated Vercel serverless entry point.
// All /api/* routes are rewritten to this file by vercel.json.
// Individual handlers live as _prefixed modules (private, no separate function).

// ── Global error handlers ──────────────────────────────────────
process.on("unhandledRejection", (reason) => {
	const err = reason instanceof Error ? reason : new Error(String(reason));
	console.error("[GLOBAL] Unhandled Rejection:", err.stack || err.message);
});
process.on("uncaughtException", (err) => {
	console.error("[GLOBAL] Uncaught Exception:", err?.stack || err?.message || String(err));
	// Give logger time to flush, then exit (Vercel will restart)
	setTimeout(() => process.exit(1), 1000).unref?.();
});

import admin from "./_admin.js";
import agent from "./_agent.js";
import agentChat from "./_agent-chat.js";
import agentExecutions from "./_agent-executions.js";
import agentTeam from "./_agent-team.js";
import agentsCron from "./_agents-cron.js";
import ai from "./_ai.js";
import aiChat from "./_ai-chat.js";
import aiResolution from "./_ai-resolution.js";
import resolutionEvidence from "./_resolution-evidence.js";
import announcement from "./_announcement.js";
import assist from "./_assist.js";
import auditTrail from "./_audit-trail.js";
import { cors as corsFn } from "./_auth.js";
import badges from "./_badges.js";
import { cleanupCache } from "./_cache.js";
import categories from "./_categories.js";
import chat from "./_chat.js";
import communities from "./_communities.js";
import { cleanupHandler, triggerAutoCleanup } from "./_cleanup.js";
import maintenance from "./_maintenance.js";
import commandCenter from "./_command-center.js";
import dbStats from "./_db-stats.js";
import comments from "./_comments.js";
import conversationAssist from "./_conversation-assist.js";
import duplicates from "./_duplicates.js";
import emailTemplates from "./_email-templates.js";
import errors from "./_errors.js";
import eventAgents from "./_event-agents.js";
import eventsStream from "./_events-stream.js";
import adminEvents from "./_admin-events.js";
import identityLink from "./_identity-link.js";
import evidence from "./_evidence.js";
import evidenceScan from "./_evidence-scan.js";
import dataExport from "./_export.js";
import follows from "./_follows.js";
import notifyPrefs from "./_notify-prefs.js";
import improvements from "./_improvements.js";
import workforceBridge from "./_workforce-bridge.js";
import workforceApi from "./_workforce-api.js";
import workforceCenter from "./_workforce-center.js";
import workforceProof from "./_workforce-proof-api.js";
import incidents from "./_incidents.js";
import actionCenter from "./_action-center.js";
import goldenWorkflows from "./_golden-workflows.js";
import techDebt from "./_tech-debt.js";
import incidentCron from "./_incident-cron.js";
import adminExport from "./_admin-export.js";
import bulkOperations from "./_bulk-operations.js";
import searchQuality from "./_search-quality.js";
import featureHealth from "./_feature-health.js";
import health from "./_health.js";
import inbox from "./_inbox.js";
import insights from "./_insights.js";
import reportDeck from "./_report-deck.js";
import keepAlive from "./_keep-alive.js";
import leaderboard from "./_leaderboard.js";
import me from "./_me.js";
import memoryApi from "./_memory-api.js";
import metaAgent from "./_meta-agent.js";
import moderate from "./_moderate.js";
import notifications from "./_notifications.js";
import { cleanupMetrics, generateRequestId, logger } from "./_observability.js";
import { loadGuardAcquire, loadGuardRelease } from "./_load-guard.js";
import { recordFeatureEvent as featureHealthRecorder } from "./_feature-health.js";
import performance from "./_performance.js";
import persona from "./_persona.js";
import appeals from "./_appeals.js";
import polls from "./_polls.js";
import posts from "./_posts.js";
import prePublish from "./_pre-publish.js";
import prePublishReview from "./_pre-publish-review.js";
import proactive from "./_proactive.js";
import { protect } from "./_production-error.js";
import providers from "./_providers.js";
import ragApi from "./_rag-api.js";
import reactions from "./_reactions.js";
import reports from "./_reports.js";
import routing from "./_routing.js";
import saved from "./_saved.js";
import search from "./_search.js";
import securityEvents from "./_security-events.js";
import spam from "./_spam.js";
import vitals from "./_vitals.js";
import {
	ABUSE_LIMITS,
	detectPromptInjection,
	peekBodyIdentity,
	securityCheck,
	setSecurityHeaders,
	validateRequestSize,
} from "./_security.js";
import {
	parseRequestBody,
	RequestBodyTooLargeError,
} from "./_request-body.js";
import timeline from "./_timeline.js";
import transcribe from "./_transcribe.js";
import toolApi from "./_agent-tool-api.js";
import toolForge from "./_tool-forge.js";
import trends from "./_trends.js";
import upload from "./_upload.js";
import users from "./_users.js";
import version from "./version.js";
import workforce from "./_workforce.js";
import agentCron from "./agent-cron.js";
import learning from "./learning.js";
import v3Audit from "./v3/_audit.js";
import v3Memory from "./v3/_memory.js";
import v3Monitoring, { recordRequest } from "./v3/_monitoring.js";
import v3Orchestrate from "./v3/_orchestrate.js";
import v3Rag from "./v3/_rag.js";
import v3Security from "./v3/_security.js";
// V3 Enterprise endpoints
import v3Stream from "./v3/_stream.js";
import v3Tools from "./v3/_tools.js";
import v3Verify from "./v3/_verify.js";

// Body parsing is handled by the bounded parser in _request-body.js.

// Auto-cleanup on cold start (7-day retention, runs once per instance)
triggerAutoCleanup();

// Periodic cleanup of observability metrics and cache
cleanupMetrics();
cleanupCache();

const routes = {
	posts: protect(posts, "posts"),
	comments: protect(comments, "comments"),
	communities: protect(communities, "communities"),
	polls: protect(polls, "polls"),
	reactions: protect(reactions, "reactions"),
	chat: protect(chat, "chat"),
	reports: protect(reports, "reports"),
	admin: protect(admin, "admin"),
	announcements: protect(announcement, "announcements"),
	announcement: protect(announcement, "announcement"),
	upload: protect(upload, "upload"),
	users: protect(users, "users"),
	agent: protect(agent, "agent"),
	ai: protect(ai, "ai"),
	assist: protect(assist, "assist"),
	me: protect(me, "me"),
	providers: protect(providers, "providers"),
	"agent-chat": protect(agentChat, "agent-chat"),
	"meta-agent": protect(metaAgent, "meta-agent"),
	"agent-team": protect(agentTeam, "agent-team"),
	"ai-resolution": protect(aiResolution, "ai-resolution"),
	"resolution-evidence": protect(resolutionEvidence, "resolution-evidence"),
	duplicates: protect(duplicates, "duplicates"),
	routing: protect(routing, "routing"),
	search: protect(search, "search"),
	notifications: protect(notifications, "notifications"),
	evidence: protect(evidence, "evidence"),
	"audit-trail": protect(auditTrail, "audit-trail"),
	health: protect(health, "health"),
	trends: protect(trends, "trends"),
	performance: protect(performance, "performance"),
	timeline: protect(timeline, "timeline"),
	transcribe: protect(transcribe, "transcribe"),
	"conversation-assist": protect(conversationAssist, "conversation-assist"),
	"pre-publish": protect(prePublish, "pre-publish"),
	"pre-review": protect(prePublishReview, "pre-review"),
	// Authoritative contextual pre-publish check. Backs the Submit page's
	// live verdict so the UI cannot claim "no issues" from a word list.
	moderate: protect(moderate, "moderate"),
	appeals: protect(appeals, "appeals"),
	leaderboard: protect(leaderboard, "leaderboard"),
	"evidence-scan": protect(evidenceScan, "evidence-scan"),
	inbox: protect(inbox, "inbox"),
	"agents-cron": protect(agentsCron, "agents-cron"),
	"agent-cron": protect(agentCron, "agent-cron"),
	"agent-executions": protect(agentExecutions, "agent-executions"),
	"event-agents": protect(eventAgents, "event-agents"),
	"keep-alive": protect(keepAlive, "keep-alive"),
	"tool-forge": protect(toolForge, "tool-forge"),
	"tool-registry": protect(toolApi, "tool-registry"),
	memory: protect(memoryApi, "memory"),
	rag: protect(ragApi, "rag"),
	persona: protect(persona, "persona"),
	"ai-chat": protect(aiChat, "ai-chat"),
	"command-center": protect(commandCenter, "command-center"),
	workforce: protect(workforce, "workforce"),
	proactive: protect(proactive, "proactive"),
	learning: protect(learning, "learning"),
	follows: protect(follows, "follows"),
	"notify-prefs": protect(notifyPrefs, "notify-prefs"),
	"improvements": protect(improvements, "improvements"),
	"workforce-center": protect(workforceCenter, "workforce-center"),
	"workforce-bridge": protect(workforceBridge, "workforce-bridge"),
	"workforce-api": protect(workforceApi, "workforce-api"),
	"workforce-proof": protect(workforceProof, "workforce-proof"),
	incidents: protect(incidents, "incidents"),
	"action-center": protect(actionCenter, "action-center"),
	"golden-workflows": protect(goldenWorkflows, "golden-workflows"),
	"tech-debt": protect(techDebt, "tech-debt"),
	"incident-cron": protect(incidentCron, "incident-cron"),
	"admin-export": protect(adminExport, "admin-export"),
	"bulk-operations": protect(bulkOperations, "bulk-operations"),
	"search-quality": protect(searchQuality, "search-quality"),
	"feature-health": protect(featureHealth, "feature-health"),
	saved: protect(saved, "saved"),
	insights: protect(insights, "insights"),
	"report-deck": protect(reportDeck, "report-deck"),
	categories: protect(categories, "categories"),
	// Client telemetry + operational surfaces that were previously unrouted
	// (every call 404'd, which showed up as "Not found" noise on page load)
	errors: protect(errors, "errors"),
	vitals: protect(vitals, "vitals"),
	// Live inbox wake-ups (SSE). The client EventSource hits this; the
	// router-contract test requires every /api/* string in src/ to resolve
	// here, so this entry is load-bearing, not decorative.
	events: protect(eventsStream, "events"),
	// Admin console wake-ups (SSE, ticket-authed — EventSource cannot send
	// the admin header). Same load-bearing note as above.
	"admin-events": protect(adminEvents, "admin-events"),
	// Cross-surface pairing (issue/redeem 6-digit claim codes). Client
	// Settings hits this; same load-bearing note as above.
	"identity-link": protect(identityLink, "identity-link"),
	// Public update feed for the native shells. It used to be missing from this
	// map, so every APK/EXE update check got a 404 and the in-app update dialog
	// could never fire. Guarded by tests/api/router-contract.test.ts.
	version: protect(version, "version"),
	spam: protect(spam, "spam"),
	security: protect(securityEvents, "security"),
	"email-templates": protect(emailTemplates, "email-templates"),
	"data-export": protect(dataExport, "data-export"),
	badges: protect(badges, "badges"),
	cleanup: protect(cleanupHandler, "cleanup"),
	maintenance: protect(maintenance, "maintenance"),
	db_stats: protect(dbStats, "db_stats"),
	// V3 Enterprise routes
	"v3/stream": protect(v3Stream, "v3-stream"),
	"v3/audit": protect(v3Audit, "v3-audit"),
	"v3/tools": protect(v3Tools, "v3-tools"),
	"v3/verify": protect(v3Verify, "v3-verify"),
	"v3/orchestrate": protect(v3Orchestrate, "v3-orchestrate"),
	"v3/rag": protect(v3Rag, "v3-rag"),
	"v3/memory": protect(v3Memory, "v3-memory"),
	"v3/security": protect(v3Security, "v3-security"),
	"v3/monitoring": protect(v3Monitoring, "v3-monitoring"),
};

export default async function handler(req, res) {
	// EARLY TEST: confirm handler runs for JSON POST.
	// Dev/diagnostic only — same prod gate as _debug below.
	if (req.url.includes("_ping")) {
		corsFn(res, req);
		if (
			process.env.VERCEL_ENV === "production" ||
			process.env.NODE_ENV === "production"
		)
			return res.status(404).json({ error: "Not found" });
		res.setHeader("Content-Type", "application/json");
		return res
			.status(200)
			.json({ pong: true, method: req.method, url: req.url });
	}

	// req.url will be the original e.g. /api/posts (the rewrite preserves it)
	// Strip query strings before splitting
	const pathname = req.url.split("?")[0];
	const parts = pathname.split("/").filter(Boolean);

	// Handle V3 routes: /api/v3/stream â†’ 'v3/stream'
	let endpoint = parts[1]; // ['api', 'posts', â€¦] â†’ 'posts'
	if (endpoint === "v3" && parts[2]) {
		endpoint = `v3/${parts[2]}`;
	}

	// Ensure req.query is always a plain object — the Vercel runtime populates
	// this automatically, and the api-dev shim does too, but defensive coding
	// prevents 500s when neither runs (e.g. edge cases in local dev).
	if (!req.query) {
		const u = new URL(req.url || "/", "http://localhost");
		const q = {};
		for (const key of u.searchParams.keys()) {
			const all = u.searchParams.getAll(key);
			q[key] = all.length > 1 ? all : all[0];
		}
		req.query = q;
	}

	// Set security headers on every response
	setSecurityHeaders(res);

	// Generate request_id for distributed tracing
	const requestId = generateRequestId();
	res.setHeader("X-Request-ID", requestId);
	req.requestId = requestId;

	// Reject an oversized declared body before reading a stream. The bounded
	// parser below also enforces the limit when Content-Length is absent.
	const declaredSizeCheck = validateRequestSize(req);
	if (!declaredSizeCheck.valid) {
		corsFn(res, req);
		return res.status(413).json({ error: declaredSizeCheck.error, requestId });
	}

	// Parse once, within the byte budget, before deriving an identity or
	// applying abuse checks. This keeps raw streams bounded and makes the
	// identity decision authoritative.
	try {
		await parseRequestBody(req, { maxBytes: ABUSE_LIMITS.maxRequestSize });
	} catch (parseErr) {
		corsFn(res, req);
		if (parseErr instanceof RequestBodyTooLargeError) {
			return res.status(413).json({ error: parseErr.message, requestId });
		}
		console.error("[handler] parseRequestBody threw:", parseErr.message);
		return res.status(400).json({ error: "invalid_json", requestId });
	}

	// Read identity only from the bounded, parsed object.
	let _identity = null;
	try {
		_identity = await peekBodyIdentity(req);
	} catch {
		/* non-fatal — falls back to IP-only rate limiting */
	}

	// Security check (abuse prevention, declared-size defense) — keyed on identity+IP
	const secCheck = securityCheck(req, _identity);
	if (!secCheck.ok) {
		corsFn(res, req);
		if (secCheck.retryAfter) {
			res.setHeader("Retry-After", String(secCheck.retryAfter));
		}
		return res.status(secCheck.status).json({ error: secCheck.error });
	}

	// Debug endpoint — echoes request info for diagnosing body parsing issues.
	// Dev/diagnostic only: it reflects headers + body back, which is an
	// information leak and fingerprinting surface if reachable in production.
	const isProd =
		process.env.VERCEL_ENV === "production" ||
		process.env.NODE_ENV === "production";
	if (endpoint === "_debug") {
		corsFn(res, req);
		if (isProd)
			return res.status(404).json({ error: "Not found" });
		res.setHeader("Content-Type", "application/json");
		let bodyPreview = "";
		try {
			const bodyRaw =
				req.body === undefined || req.body === null
					? ""
					: typeof req.body === "string"
						? req.body
						: Buffer.isBuffer(req.body)
							? req.body.toString("utf8")
							: JSON.stringify(req.body) || "";
			bodyPreview = bodyRaw.slice(0, 500);
		} catch (_) {
			bodyPreview = "[unserializable]";
		}
		return res.status(200).json({
			method: req.method,
			bodyType: typeof req.body,
			bodyIsNull: req.body === null,
			bodyIsUndefined: req.body === undefined,
			bodyIsBuffer: Buffer.isBuffer(req.body),
			bodyPreview,
			contentType: req.headers["content-type"],
			contentLength: req.headers["content-length"],
			headers: Object.fromEntries(
				Object.entries(req.headers)
					.filter(
						([k]) => !k.startsWith("x-forwarded") && !k.startsWith("x-vercel"),
					)
					.slice(0, 30)
					.map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
			),
			timestamp: new Date().toISOString(),
		});
	}

	const routeHandler = routes[endpoint];
	if (!routeHandler) {
		corsFn(res, req);
		recordRequest(0, 404, pathname);
		return res.status(404).json({ error: "Not found" });
	}

	// Wrap response to capture status code for monitoring + structured logging
	const originalEnd = res.end;
	const startMs = Date.now();
	res.end = function (...args) {
		const duration = Date.now() - startMs;
		// ── Load hardening: stale-if-error ────────────────────────────
		// When a handler opts a GET into CDN caching (s-maxage), also let the
		// CDN serve that cached copy when the ORIGIN fails (5xx, cold-start
		// timeout, DB pool exhaustion during a 10k-user spike). Overload then
		// degrades to slightly-old data instead of visible errors — the
		// response is already declared safe to share, and stale beats error.
		// Runs before headers are flushed, inside try/catch: a handler that
		// already ended the response must never throw here.
		if (req.method === "GET") {
			try {
				const cc = res.getHeader?.("Cache-Control");
				if (
					typeof cc === "string" &&
					cc.includes("s-maxage=") &&
					!cc.includes("stale-if-error=")
				) {
					res.setHeader("Cache-Control", `${cc}, stale-if-error=60`);
				}
			} catch {
				/* headers already sent — serve as-is */
			}
		}
		recordRequest(duration, res.statusCode, pathname);
		// Structured request log for observability
		const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : duration > 5000 ? "warn" : "info";
		logger[level](endpoint || "unknown", `${req.method} ${pathname} ${res.statusCode}`, {
			request_id: requestId,
			method: req.method,
			path: pathname,
			status: res.statusCode,
			duration_ms: duration,
		});
		// Record feature health (fire-and-forget)
		try {
			const featureMap = {
				posts: "posts", comments: "comments", polls: "polls", search: "search",
				notifications: "notifications", reports: "admin_reports",
				admin: "admin_feed", users: "admin_users", workforce: "admin_workforce",
				settings: "admin_settings", inbox: "inbox", health: "admin_analytics",
			};
			const feature = featureMap[endpoint];
			if (feature) {
				featureHealthRecorder({
					feature,
					success: res.statusCode < 400,
					latency_ms: duration,
					error_type: res.statusCode >= 500 ? `http_${res.statusCode}` : null,
				});
			}
		} catch { /* non-fatal */ }
		return originalEnd.apply(this, args);
	};

	// ── Load shedding (baseline harness) ───────────────────────
	// _ping bypasses above so health checks pass while shedding. Cheap
	// rejections (413/403/404) also bypass: the cap protects expensive
	// handler work, and every acquire pairs with one finally-release.
	if (!loadGuardAcquire()) {
		corsFn(res, req);
		res.setHeader("Retry-After", "2");
		recordRequest(0, 503, pathname);
		return res.status(503).json({ error: "Server busy — retry shortly.", code: "OVERLOADED", requestId });
	}
	try {
		return await routeHandler(req, res);
	} finally {
		loadGuardRelease();
	}
}
