// Consolidated Vercel serverless entry point.
// All /api/* routes are rewritten to this file by vercel.json.
// Individual handlers live as _prefixed modules (private, no separate function).

// â”€â”€ Global error handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
process.on("unhandledRejection", (reason) => {
	const msg = reason instanceof Error ? reason.message : String(reason);
	console.error("[GLOBAL] Unhandled Rejection:", msg);
});
process.on("uncaughtException", (err) => {
	console.error("[GLOBAL] Uncaught Exception:", err.message);
	// Give logger time to flush, then exit (Vercel will restart)
	setTimeout(() => process.exit(1), 1000);
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
import commandCenter from "./_command-center.js";
import dbStats from "./_db-stats.js";
import comments from "./_comments.js";
import conversationAssist from "./_conversation-assist.js";
import duplicates from "./_duplicates.js";
import eventAgents from "./_event-agents.js";
import evidence from "./_evidence.js";
import evidenceScan from "./_evidence-scan.js";
import dataExport from "./_export.js";
import follows from "./_follows.js";
import notifyPrefs from "./_notify-prefs.js";
import improvements from "./_improvements.js";
import workforceBridge from "./_workforce-bridge.js";
import workforceCenter from "./_workforce-center.js";
import health from "./_health.js";
import inbox from "./_inbox.js";
import insights from "./_insights.js";
import keepAlive from "./_keep-alive.js";
import leaderboard from "./_leaderboard.js";
import me from "./_me.js";
import memoryApi from "./_memory-api.js";
import metaAgent from "./_meta-agent.js";
import notifications from "./_notifications.js";
import { cleanupMetrics } from "./_observability.js";
import performance from "./_performance.js";
import persona from "./_persona.js";
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
import {
	detectPromptInjection,		peekBodyIdentity,

	securityCheck,
	setSecurityHeaders,
} from "./_security.js";
import timeline from "./_timeline.js";
import toolApi from "./_tool-api.js";
import toolForge from "./_tool-forge.js";
import trends from "./_trends.js";
import upload from "./_upload.js";
import users from "./_users.js";
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

// Body parser: consume raw stream if Vercel didn't already parse it.
// In Vercel Node.js runtime, req.body may be a ReadableStream, Buffer, string,
// or already-parsed object. This function normalizes it to a plain object.
async function parseBody(req) {
	if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD")
		return;

	// Already a parsed plain object â€” use as-is
	const b = req.body;
	if (
		b &&
		typeof b === "object" &&
		!Buffer.isBuffer(b) &&
		typeof b.getReader !== "function" &&
		typeof b.pipe !== "function"
	) {
		return;
	}

	let raw = "";

	try {
		// ReadableStream (web streams API)
		if (b && typeof b.getReader === "function") {
			const reader = b.getReader();
			const chunks = [];
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
			raw = new TextDecoder().decode(
				new Uint8Array(chunks.flatMap((c) => Array.from(c))),
			);
		}
		// Node.js Readable stream
		else if (b && typeof b.pipe === "function") {
			raw = await new Promise((resolve, reject) => {
				const chunks = [];
				b.on("data", (chunk) => chunks.push(chunk));
				b.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
				b.on("error", reject);
			});
		}
		// Buffer
		else if (Buffer.isBuffer(b)) {
			raw = b.toString("utf8");
		}
		// String
		else if (typeof b === "string") {
			raw = b;
		}
	} catch (_) {
		// Stream read failed â€” fall through with empty raw
	}

	// Parse the raw text into an object
	if (raw) {
		try {
			req.body = JSON.parse(raw);
		} catch (_) {
			try {
				req.body = Object.fromEntries(new URLSearchParams(raw));
			} catch (_) {
				req.body = {};
			}
		}
	} else {
		req.body = {};
	}
}

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
	"conversation-assist": protect(conversationAssist, "conversation-assist"),
	"pre-publish": protect(prePublish, "pre-publish"),
	"pre-review": protect(prePublishReview, "pre-review"),
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
	saved: protect(saved, "saved"),
	insights: protect(insights, "insights"),
	categories: protect(categories, "categories"),
	"data-export": protect(dataExport, "data-export"),
	badges: protect(badges, "badges"),
	cleanup: protect(cleanupHandler, "cleanup"),
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
	// EARLY TEST: confirm handler runs for JSON POST
	if (req.url.includes("_ping")) {
		res.setHeader("Access-Control-Allow-Origin", "*");
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

	// Peek at the body to extract user identity BEFORE abuse check.
	// This lets the rate limiter key per-user instead of per-IP, which
	// prevents a whole school/office NAT from sharing one rate-limit bucket.
	let _identity = null;
	try {
		_identity = await peekBodyIdentity(req);
	} catch {
		/* non-fatal — falls back to IP-only rate limiting */
	}

	// Security check (abuse prevention, request size) — keyed on identity+IP
	const secCheck = securityCheck(req, _identity);
	if (!secCheck.ok) {
		corsFn(res, req);
		if (secCheck.retryAfter) {
			res.setHeader("Retry-After", String(secCheck.retryAfter));
		}
		return res.status(secCheck.status).json({ error: secCheck.error });
	}

	// Parse body from raw stream (Vercel body parser is disabled)
	// Must run BEFORE debug endpoint so it can inspect the parsed body.
	try {
		await parseBody(req);
	} catch (parseErr) {
		console.error("[handler] parseBody threw:", parseErr.message);
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

	// Wrap response to capture status code for monitoring
	const originalEnd = res.end;
	const startMs = Date.now();
	res.end = function (...args) {
		const duration = Date.now() - startMs;
		recordRequest(duration, res.statusCode, pathname);
		return originalEnd.apply(this, args);
	};

	return await routeHandler(req, res);
}
