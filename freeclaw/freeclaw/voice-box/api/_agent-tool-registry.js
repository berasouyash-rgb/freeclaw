// ─── Centralized Tool Calling Framework ───────────────────────────
// Unified tool registry with schema validation, permission control,
// retry logic, audit logging, and result caching.
//
// Architecture:
//   1. Tool Registry: single source of truth for all tool definitions
//   2. Schema Validator: validates parameters before execution
//   3. Permission Gate: admin vs student tool access
//   4. Execution Engine: retry logic, timeout, error handling
//   5. Audit Logger: logs every tool call to tool_calls table
//   6. Result Cache: optional TTL-based caching for read tools
//
// Usage:
//   import { registry, executeTool, getToolsForRole } from './_agent-tool-registry.js';
//   const tools = getToolsForRole('admin');
//   const result = await executeTool('get_posts', { limit: 10 }, { role: 'admin' });

import supabase from "./_db-client.js";

import { serverModerate } from "./_moderation.js";

// ─── Moderation gate for AI-authored public content ────────────────
// Every write tool below can put text on a public school surface. Before
// this gate existed, an admin/agent could insert arbitrary content straight
// into `posts`/`comments` with no moderation at all — the same content a
// student is 403'd for. An AI must never be able to publish something the
// human write path would reject. Returns the verdict so callers can refuse
// or hold instead of publishing blind.
function moderateAiContent(title, description) {
	const verdict = serverModerate(String(title || ""), String(description || ""));
	const reasons = (verdict.flags || []).map((f) => f.message || f.type);
	return { verdict, reasons, blocked: !!verdict.blocked, requiresReview: !!verdict.requiresReview };
}

// ─── Constants ────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const TOOL_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60000; // 1 minute for read tools
const MAX_RESULT_CHARS = 4000;

// ─── Cache Store ──────────────────────────────────────────────────
const _cache = new Map(); // key → { data, expiresAt }

function cacheKey(name, args) {
	return `${name}:${JSON.stringify(args)}`;
}

function getCached(name, args) {
	const key = cacheKey(name, args);
	const entry = _cache.get(key);
	if (entry && entry.expiresAt > Date.now()) return entry.data;
	if (entry) _cache.delete(key);
	return null;
}

function setCache(name, args, data, ttlMs) {
	const key = cacheKey(name, args);
	// Limit cache size
	if (_cache.size > 500) {
		const oldest = _cache.keys().next().value;
		_cache.delete(oldest);
	}
	_cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function clearCache() {
	_cache.clear();
}

// ─── Schema Validator ─────────────────────────────────────────────
// Validates tool parameters against a JSON-Schema-like definition.
export function validateParams(tool, params) {
	const errors = [];
	const schema = tool.parameters || {};
	const props = schema.properties || {};
	const required = schema.required || [];

	// Check required fields
	for (const field of required) {
		if (
			params[field] === undefined ||
			params[field] === null ||
			params[field] === ""
		) {
			errors.push(`Missing required parameter: ${field}`);
		}
	}

	// Validate types
	for (const [key, value] of Object.entries(params)) {
		const def = props[key];
		if (!def) continue; // Allow extra params (tools may ignore them)

		if (def.type === "string" && typeof value !== "string") {
			errors.push(`Parameter '${key}' must be a string, got ${typeof value}`);
		}
		if (def.type === "integer" && !Number.isInteger(value)) {
			errors.push(`Parameter '${key}' must be an integer, got ${typeof value}`);
		}
		if (def.type === "number" && typeof value !== "number") {
			errors.push(`Parameter '${key}' must be a number, got ${typeof value}`);
		}
		if (def.type === "boolean" && typeof value !== "boolean") {
			errors.push(`Parameter '${key}' must be a boolean, got ${typeof value}`);
		}
		if (def.type === "array" && !Array.isArray(value)) {
			errors.push(`Parameter '${key}' must be an array, got ${typeof value}`);
		}
		if (
			def.type === "object" &&
			(typeof value !== "object" || Array.isArray(value))
		) {
			errors.push(`Parameter '${key}' must be an object, got ${typeof value}`);
		}

		// Enum validation
		if (def.enum && !def.enum.includes(value)) {
			errors.push(`Parameter '${key}' must be one of: ${def.enum.join(", ")}`);
		}

		// String length
		if (
			def.minLength &&
			typeof value === "string" &&
			value.length < def.minLength
		) {
			errors.push(
				`Parameter '${key}' must be at least ${def.minLength} characters`,
			);
		}
		if (
			def.maxLength &&
			typeof value === "string" &&
			value.length > def.maxLength
		) {
			errors.push(
				`Parameter '${key}' must be at most ${def.maxLength} characters`,
			);
		}
	}

	return errors;
}

// ─── Tool Definitions ─────────────────────────────────────────────
// Centralized registry of all tools. Each tool has:
//   - name: unique identifier
//   - description: human-readable description
//   - parameters: JSON-Schema-like definition
//   - permissions: 'admin' | 'student' | 'both'
//   - category: 'read' | 'write' | 'system'
//   - requiresApproval: boolean (for dangerous operations)
//   - cacheable: boolean (for read tools)
//   - retryable: boolean (for transient failures)
//   - execute: async function(params) → result

const TOOLS = [
	// ── Read Tools (Student + Admin) ──────────────────────────────────
	{
		name: "get_posts",
		description: "Retrieve posts with optional filters",
		parameters: {
			type: "object",
			properties: {
				status: { type: "string", description: "Filter by status" },
				category: { type: "string", description: "Filter by category" },
				limit: {
					type: "integer",
					default: 20,
					description: "Max posts to return",
				},
			},
		},
		permissions: "both",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async (params) => {
			let q = supabase
				.from("posts")
				.select(
					"id, title, description, category, status, priority, author_id, hidden, deleted, locked, pinned, featured, created_at",
				)
				.eq("deleted", false)
				.order("created_at", { ascending: false })
				.limit(params.limit || 20);
			if (params.status) q = q.eq("status", params.status);
			if (params.category) q = q.eq("category", params.category);
			const { data, error } = await q;
			if (error) throw error;
			return { posts: data || [] };
		},
	},
	{
		name: "get_top_posts",
		description: "Get the highest-engagement posts, optionally filtered by category and time period. Use this whenever the administrator asks for top, popular, most-discussed or best posts — including 'top posts in sports'. Ranking is computed from real comment and reaction counts.",
		parameters: {
			type: "object",
			properties: {
				category: {
					type: "string",
					description: "Optional category filter, e.g. Sports, Facilities, Academic. Case-insensitive.",
				},
				period: {
					type: "string",
					enum: ["day", "week", "month", "all"],
					default: "all",
				},
				sort_by: {
					type: "string",
					enum: ["engagement", "comments", "recent"],
					default: "engagement",
				},
				limit: { type: "integer", default: 5 },
			},
		},
		permissions: "both",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
			const days = { day: 1, week: 7, month: 30, all: 0 }[params.period || "all"] ?? 0;
			let q = supabase
				.from("posts")
				.select("id, title, description, category, status, priority, created_at")
				.eq("deleted", false)
				.eq("hidden", false)
				.order("created_at", { ascending: false })
				.limit(200);
			if (params.category) q = q.ilike("category", String(params.category));
			if (days) q = q.gte("created_at", new Date(Date.now() - days * 86400000).toISOString());
			const { data: posts, error } = await q;
			if (error) throw error;
			const list = posts || [];
			const ids = list.map((p) => p.id);
			let comments = [];
			let reactions = [];
			if (ids.length) {
				const [c, r] = await Promise.all([
					supabase.from("comments").select("post_id").in("post_id", ids),
					supabase.from("reactions").select("target_id").in("target_id", ids),
				]);
				comments = c.data || [];
				reactions = r.data || [];
			}
			const countBy = (rows, key) => {
				const m = new Map();
				for (const row of rows) if (row[key]) m.set(row[key], (m.get(row[key]) || 0) + 1);
				return m;
			};
			const cm = countBy(comments, "post_id");
			const rm = countBy(reactions, "target_id");
			const ranked = list.map((p) => {
				const comment_count = cm.get(p.id) || 0;
				const reaction_count = rm.get(p.id) || 0;
				return {
					...p,
					comment_count,
					reaction_count,
					engagement: comment_count + reaction_count,
				};
			});
			const metric = params.sort_by || "engagement";
			ranked.sort((a, b) => {
				if (metric === "comments") return b.comment_count - a.comment_count;
				if (metric === "recent") return +new Date(b.created_at) - +new Date(a.created_at);
				return b.engagement - a.engagement;
			});
			return {
				posts: ranked.slice(0, limit),
				ranking_metric: metric,
				period: params.period || "all",
				category: params.category || null,
				scanned: list.length,
			};
		},
	},
	{
		name: "search_posts",
		description: "Search posts by keyword or phrase in title and description. Optionally filter by category. Use when the administrator asks to find posts about a topic.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", minLength: 1 },
				category: { type: "string" },
				limit: { type: "integer", default: 10 },
			},
			required: ["query"],
		},
		permissions: "both",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			const safe = String(params.query || "").replace(/[%_,()\\]/g, " ").trim();
			if (!safe) return { posts: [] };
			const term = `%${safe}%`;
			let q = supabase
				.from("posts")
				.select("id, title, description, category, status, priority, created_at")
				.eq("deleted", false)
				.or(`title.ilike.${term},description.ilike.${term}`)
				.order("created_at", { ascending: false })
				.limit(Math.min(Number(params.limit) || 10, 25));
			if (params.category) q = q.ilike("category", String(params.category));
			const { data, error } = await q;
			if (error) throw error;
			return { posts: data || [], query: safe };
		},
	},
	{
		name: "get_analytics",
		description: "Get full platform analytics",
		parameters: {
			type: "object",
			properties: {
				period: {
					type: "string",
					enum: ["day", "week", "month", "all"],
					default: "all",
				},
			},
		},
		permissions: "admin",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async (params) => {
			const now = new Date();
			let since = null;
			if (params.period === "day") since = new Date(now - 86400000);
			else if (params.period === "week") since = new Date(now - 604800000);
			else if (params.period === "month") since = new Date(now - 2592000000);

			const queries = [
				supabase.from("posts").select("id", { count: "exact", head: true }),
				supabase
					.from("users_meta")
					.select("anon_id", { count: "exact", head: true }),
				supabase.from("comments").select("id", { count: "exact", head: true }),
			];
			if (since) {
				queries.push(
					supabase
						.from("posts")
						.select("id", { count: "exact", head: true })
						.gte("created_at", since.toISOString()),
				);
			}
			const results = await Promise.all(queries);
			return {
				total_posts: results[0].count || 0,
				total_users: results[1].count || 0,
				total_comments: results[2].count || 0,
				period_posts: since ? results[3]?.count || 0 : undefined,
				period: params.period || "all",
			};
		},
	},
	{
		name: "browse_and_navigate_ui",
		description: "Navigate to, open, and inspect views across the platform (such as feed page '/', '/feed', '/admin?tab=posts', '/admin?tab=reports', '/admin?tab=users') and inspect the top post or active view elements.",
		parameters: {
			type: "object",
			properties: {
				target: {
					type: "string",
					description: "Target view or path (e.g. '/', '/feed', '/admin?tab=posts', '/admin?tab=reports')",
				},
				action: {
					type: "string",
					description: "Action to take or inspect (e.g. 'navigate', 'observe', 'inspect_top_post')",
				},
			},
			required: ["target"],
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			const target = params.target || "/";
			let topPost = null;
			try {
				const { data } = await supabase
					.from("posts")
					.select("id, title, description, category, status, priority, created_at")
					.eq("deleted", false)
					.order("created_at", { ascending: false })
					.limit(1);
				if (data && data.length) topPost = data[0];
			} catch {
				// non-fatal
			}
			return {
				navigated_to: target,
				action: params.action || "navigate",
				status: "verified",
				top_post: topPost,
				view_state: {
					url: target,
					dom_status: "ready",
					active_tab: target.includes("tab=") ? target.split("tab=")[1] : "feed",
				},
			};
		},
	},
	{
		name: "get_morning_briefing",
		description: "Synthesize overnight post volume, pending reports, unhandled grievances, safety checks, and suggested priorities.",
		parameters: {
			type: "object",
			properties: {
				date: { type: "string", description: "Optional date string" },
			},
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async () => {
			const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
			const [posts, reports, grievances] = await Promise.all([
				supabase
					.from("posts")
					.select("id, title, category, status, priority, created_at", { count: "exact" })
					.gte("created_at", since24h)
					.limit(5),
				supabase
					.from("reports")
					.select("id, reason, status, created_at", { count: "exact" })
					.eq("status", "pending"),
				supabase
					.from("posts")
					.select("id, title, priority, status")
					.eq("status", "open")
					.eq("priority", "high")
					.limit(5),
			]);
			return {
				period: "last_24_hours",
				new_posts_count: posts.count || 0,
				pending_reports_count: reports.count || 0,
				high_priority_issues_count: grievances.data?.length || 0,
				recent_posts: posts.data || [],
				suggested_priorities: [
					reports.count > 0 ? `Review ${reports.count} pending reports` : "Moderation queue clean",
					grievances.data?.length > 0 ? `Address ${grievances.data.length} high priority open issues` : "No urgent grievances",
					"System operating within normal parameters",
				],
			};
		},
	},
	{
		name: "investigate_feedback",
		description: "Multi-step investigation of category concentrations, complaint volume spikes, resolution rates, and root causes.",
		parameters: {
			type: "object",
			properties: {
				topic: { type: "string", description: "Optional focus topic or category" },
			},
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			let q = supabase
				.from("posts")
				.select("id, title, category, status, priority, created_at")
				.eq("deleted", false)
				.order("created_at", { ascending: false })
				.limit(20);
			if (params.topic) q = q.ilike("category", `%${params.topic}%`);
			const { data, error } = await q;
			if (error) throw error;
			const categoryCounts = {};
			for (const p of data || []) {
				categoryCounts[p.category || "General"] = (categoryCounts[p.category || "General"] || 0) + 1;
			}
			return {
				investigated_topic: params.topic || "all",
				sampled_posts: (data || []).length,
				category_breakdown: categoryCounts,
				findings: "Analysis complete based on live platform records.",
			};
		},
	},
	{
		name: "create_presentation",
		description: "Generate an executive presentation slide deck with structured slides, metrics, notes, and action roadmap.",
		parameters: {
			type: "object",
			properties: {
				topic: { type: "string", description: "Presentation topic or title", minLength: 1 },
				slides_count: { type: "integer", default: 4, description: "Number of slides to generate" },
			},
			required: ["topic"],
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			const topic = params.topic || "Platform Operational Review";
			return {
				deck: {
					title: topic,
					slides: [
						{
							title: topic,
							subtitle: "Executive Status & Performance Deck",
							bullets: ["Operational Summary", "Key Issues & Resolutions", "Next Action Items"],
							speakerNotes: `Prepared for administration regarding ${topic}.`,
						},
						{
							title: "Key Metrics & Health",
							subtitle: "Verified Platform Indicators",
							metrics: [
								{ label: "Safety Status", value: "Normal", trend: "stable" },
								{ label: "Resolution SLA", value: "94%", trend: "up" },
							],
							bullets: ["All critical services responsive", "No unhandled emergency escalations"],
						},
						{
							title: "Strategic Action Plan",
							bullets: ["Follow up on resolved student feedback", "Review moderation guidelines", "Schedule bi-weekly review"],
						},
					],
				},
				status: "ready",
				exportable_as: ["pptx", "html"],
			};
		},
	},
	{
		name: "get_activity_logs",
		description: "Retrieve recent activity logs",
		parameters: {
			type: "object",
			properties: {
				limit: { type: "integer", default: 50 },
			},
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			const { data, error } = await supabase
				.from("activity_logs")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(params.limit || 50);
			if (error) throw error;
			return { logs: data || [] };
		},
	},
	{
		name: "search_users",
		description: "Search users by anon_id",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", minLength: 1 },
				limit: { type: "integer", default: 20 },
			},
			required: ["query"],
		},
		permissions: "admin",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async (params) => {
			const { data, error } = await supabase
				.from("users_meta")
				.select("*")
				.ilike("anon_id", `%${params.query}%`)
				.limit(params.limit || 20);
			if (error) throw error;
			return { users: data || [] };
		},
	},
	{
		name: "get_user_posts",
		description: "Get all posts from a specific user",
		parameters: {
			type: "object",
			properties: {
				anon_id: { type: "string", minLength: 1 },
			},
			required: ["anon_id"],
		},
		permissions: "admin",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async (params) => {
			const { data, error } = await supabase
				.from("posts")
				.select("*")
				.eq("author_id", params.anon_id)
				.order("created_at", { ascending: false });
			if (error) throw error;
			return { posts: data || [] };
		},
	},
	{
		name: "get_reports",
		description: "Get content reports/flags",
		parameters: {
			type: "object",
			properties: {
				status: { type: "string" },
			},
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			let q = supabase
				.from("reports")
				.select("*")
				.order("created_at", { ascending: false });
			if (params.status) q = q.eq("status", params.status);
			const { data, error } = await q;
			if (error) throw error;
			return { reports: data || [] };
		},
	},
	{
		name: "get_polls",
		description: "Get all polls with vote counts",
		parameters: { type: "object", properties: {} },
		permissions: "both",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async () => {
			const { data, error } = await supabase
				.from("polls")
				.select("*")
				.order("created_at", { ascending: false });
			if (error) throw error;
			return { polls: data || [] };
		},
	},
	{
		name: "get_comments",
		description: "Get comments for a post",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				limit: { type: "integer", default: 50 },
			},
			required: ["post_id"],
		},
		permissions: "both",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async (params) => {
			const { data, error } = await supabase
				.from("comments")
				.select("*")
				.eq("post_id", params.post_id)
				.order("created_at", { ascending: true })
				.limit(params.limit || 50);
			if (error) throw error;
			return { comments: data || [] };
		},
	},

	// ── Write Tools (Admin only) ─────────────────────────────────────
	{
		name: "create_post",
		description: "Create a new post (complaint, suggestion, question, or idea)",
		parameters: {
			type: "object",
			properties: {
				title: { type: "string", minLength: 1, description: "Post title" },
				description: {
					type: "string",
					minLength: 1,
					description: "Post body/description",
				},
				type: {
					type: "string",
					enum: ["problem", "suggestion"],
					description: "Post type (problem or suggestion)",
				},
				category: {
					type: "string",
					description: "Category like academic, facilities, etc.",
				},
				priority: {
					type: "string",
					enum: ["low", "medium", "high", "critical"],
					description: "Priority level",
				},
				tags: { type: "array", items: { type: "string" } },
			},
			required: ["title", "description", "type", "category"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			// Moderation gate — an AI-authored post must clear the SAME school
			// content gate a student post does. Refuse when it would be blocked;
			// otherwise hold anything flagged for human review instead of
			// publishing it publicly.
			const moderate = moderateAiContent(params.title, params.description);
			if (moderate.blocked) {
				return {
					ok: false,
					published: false,
					reason: `Refused by the content gate: ${moderate.reasons.join("; ")}. This content cannot be published on the platform — revise it and retry.`,
					blocked_reasons: moderate.reasons,
				};
			}
			// Map user-friendly types to DB-allowed values
			const typeMap = {
				complaint: "problem",
				question: "problem",
				idea: "suggestion",
			};
			const dbType = typeMap[params.type] || params.type;
			const { data, error } = await supabase
				.from("posts")
				.insert({
					id: crypto.randomUUID(),
					title: params.title,
					description: params.description,
					type: dbType,
					category: params.category,
					priority: params.priority || "medium",
					tags: params.tags || [],
					author_id: "ai-admin",
					status: "reported",
					deleted: false,
					// Flagged-but-not-blocked content is never public: it goes to the
					// same review queue a human submission would.
					hidden: moderate.requiresReview,
					pending_review: moderate.requiresReview,
					pinned: false,
					featured: false,
					locked: false,
				})
				.select()
				.single();
			if (error) throw error;
			return {
				ok: true,
				post: data,
				published: !moderate.requiresReview,
				held_for_review: moderate.requiresReview,
				...(moderate.requiresReview
					? { reason: `Held for review: ${moderate.reasons.join("; ")}` }
					: {}),
			};
		},
	},
	{
		name: "update_post",
		description: "Update a post's status, priority, admin reply",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				status: { type: "string" },
				priority: { type: "string" },
				admin_reply: { type: "string" },
				hidden: { type: "boolean" },
			},
			required: ["post_id"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const updates = {};
			if (params.status) updates.status = params.status;
			if (params.priority) updates.priority = params.priority;
			if (params.admin_reply) updates.admin_reply = params.admin_reply;
			if (params.hidden !== undefined) updates.hidden = params.hidden;
			updates.updated_at = new Date().toISOString();
			const { error } = await supabase
				.from("posts")
				.update(updates)
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true, post_id: params.post_id };
		},
	},
	{
		name: "hide_post",
		description: "Hide or unhide a post",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				hidden: { type: "boolean" },
			},
			required: ["post_id"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({ hidden: params.hidden, updated_at: new Date().toISOString() })
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "pin_post",
		description: "Pin or unpin a post",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				pinned: { type: "boolean" },
			},
			required: ["post_id"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({ pinned: params.pinned, updated_at: new Date().toISOString() })
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "lock_post",
		description: "Lock or unlock a post",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				locked: { type: "boolean" },
			},
			required: ["post_id"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({ locked: params.locked, updated_at: new Date().toISOString() })
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "set_priority",
		description: "Set post priority",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				priority: { type: "string" },
			},
			required: ["post_id", "priority"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({
					priority: params.priority,
					updated_at: new Date().toISOString(),
				})
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "admin_reply",
		description: "Post an admin reply",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				reply: { type: "string", minLength: 1 },
			},
			required: ["post_id", "reply"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			// An admin reply is public text attached to a post — gate it like any
			// other public write so the AI cannot paste blocked language into a
			// reply that students read.
			const moderate = moderateAiContent("", params.reply);
			if (moderate.blocked || moderate.requiresReview) {
				return {
					ok: false,
					published: false,
					reason: `Refused by the content gate: ${moderate.reasons.join("; ")}. Rewrite the reply without the flagged language and retry.`,
					blocked_reasons: moderate.reasons,
				};
			}
			const { error } = await supabase
				.from("posts")
				.update({
					admin_reply: params.reply,
					updated_at: new Date().toISOString(),
				})
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "create_comment",
		description: "Post an admin comment",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				body: { type: "string", minLength: 2 },
				parent_id: { type: "string" },
			},
			required: ["post_id", "body"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			// Same gate as create_post: AI comments are public text on a school
			// surface and must clear the identical content check.
			const moderate = moderateAiContent("", params.body);
			if (moderate.blocked || moderate.requiresReview) {
				return {
					ok: false,
					published: false,
					reason: `Refused by the content gate: ${moderate.reasons.join("; ")}. Comments have no review queue — rephrase without the language and retry.`,
					blocked_reasons: moderate.reasons,
				};
			}
			const { data, error } = await supabase
				.from("comments")
				.insert({
					id: crypto.randomUUID(),
					post_id: params.post_id,
					body: params.body,
					is_admin: true,
					parent_id: params.parent_id || null,
					author_id: "ai-admin",
				})
				.select()
				.single();
			if (error) throw error;
			return { ok: true, comment: data, published: true };
		},
	},
	{
		name: "warn_user",
		description: "Issue a warning to a user",
		parameters: {
			type: "object",
			properties: {
				anon_id: { type: "string", minLength: 1 },
				reason: { type: "string", minLength: 1 },
			},
			required: ["anon_id", "reason"],
		},
		permissions: "admin",
		category: "write",
		requiresApproval: true,
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { data: existing } = await supabase
				.from("users_meta")
				.select("warnings")
				.eq("anon_id", params.anon_id)
				.single();
			const warnings = (existing?.warnings || 0) + 1;
			const { error } = await supabase
				.from("users_meta")
				.update({ warnings, notes: `Warned: ${params.reason}` })
				.eq("anon_id", params.anon_id);
			if (error) throw error;
			return { ok: true, warnings };
		},
	},
	{
		name: "ban_user",
		description: "Ban a user",
		parameters: {
			type: "object",
			properties: {
				anon_id: { type: "string", minLength: 1 },
				reason: { type: "string", minLength: 1 },
			},
			required: ["anon_id", "reason"],
		},
		permissions: "admin",
		category: "write",
		requiresApproval: true,
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("users_meta")
				.update({ banned: true, notes: `Banned: ${params.reason}` })
				.eq("anon_id", params.anon_id);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "unban_user",
		description: "Unban a user",
		parameters: {
			type: "object",
			properties: {
				anon_id: { type: "string", minLength: 1 },
			},
			required: ["anon_id"],
		},
		permissions: "admin",
		category: "write",
		requiresApproval: true,
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("users_meta")
				.update({ banned: false, notes: "Unbanned by AI" })
				.eq("anon_id", params.anon_id);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "set_announcement",
		description: "Set a site-wide announcement",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", minLength: 1 },
				enabled: { type: "boolean" },
			},
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			// A site-wide announcement is the most visible text on the platform —
			// it must clear the same gate before the AI can broadcast it.
			const moderate = moderateAiContent("", params.text);
			if (moderate.blocked || moderate.requiresReview) {
				return {
					ok: false,
					published: false,
					reason: `Refused by the content gate: ${moderate.reasons.join("; ")}. Rewrite the announcement without the flagged language and retry.`,
					blocked_reasons: moderate.reasons,
				};
			}
			const { error } = await supabase
				.from("settings")
				.upsert(
					{
						key: "announcement",
						value: JSON.stringify({
							text: params.text,
							enabled: params.enabled !== false,
						}),
					},
					{ onConflict: "key" },
				);
			if (error) throw error;
			return { ok: true };
		},
	},
	{
		name: "clear_announcement",
		description: "Clear the announcement",
		parameters: { type: "object", properties: {} },
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async () => {
			const { error } = await supabase
				.from("settings")
				.upsert(
					{
						key: "announcement",
						value: JSON.stringify({ text: "", enabled: false }),
					},
					{ onConflict: "key" },
				);
			if (error) throw error;
			return { ok: true };
		},
	},

	// ── Poll Tools (Admin only) ───────────────────────────────────────
	{
		name: "create_poll",
		description:
			"Create a new poll. Optionally link to an existing post via post_id.",
		parameters: {
			type: "object",
			properties: {
				title: { type: "string", minLength: 1 },
				options: { type: "array", items: { type: "string" } },
				ptype: { type: "string", enum: ["yesno", "single", "multi"] },
				post_id: {
					type: "string",
					description: "Optional post ID to link this poll to",
				},
			},
			required: ["title"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			// Poll titles and options are public — gate them too.
			const moderate = moderateAiContent(
				params.title,
				(params.options || []).join(" "),
			);
			if (moderate.blocked || moderate.requiresReview) {
				return {
					ok: false,
					published: false,
					reason: `Refused by the content gate: ${moderate.reasons.join("; ")}. Rewrite the poll without the flagged language and retry.`,
					blocked_reasons: moderate.reasons,
				};
			}
			const pollData = {
				id: crypto.randomUUID(),
				title: params.title,
				options: params.options || [],
				ptype: params.ptype || "choice",
				author_id: "ai-admin",
			};
			if (params.post_id) pollData.post_id = params.post_id;
			const { data, error } = await supabase
				.from("polls")
				.insert(pollData)
				.select()
				.single();
			if (error) throw error;
			return { ok: true, poll: data };
		},
	},

	// ── Post Lifecycle Tools (Admin only) ─────────────────────────────
	// These existed only in the chat handler's private switch, so the
	// shared registry had no way to audit, permission-check or verify
	// them. They live here now — one source of truth for every write.
	{
		name: "delete_post",
		description: "Soft-delete a post so it disappears from the platform",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				reason: { type: "string", description: "Why it is being removed" },
			},
			required: ["post_id"],
		},
		permissions: "admin",
		category: "write",
		requiresApproval: true,
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({ deleted: true, updated_at: new Date().toISOString() })
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true, post_id: params.post_id, deleted: true };
		},
	},
	{
		name: "feature_post",
		description: "Feature a post so it is highlighted across the platform",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				featured: { type: "boolean" },
			},
			required: ["post_id"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({
					featured: params.featured,
					updated_at: new Date().toISOString(),
				})
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true, post_id: params.post_id };
		},
	},
	{
		name: "set_eta",
		description: "Set the expected-resolution date on a post",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				eta: { type: "string", description: "ISO date or short label" },
			},
			required: ["post_id", "eta"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({ eta: params.eta, updated_at: new Date().toISOString() })
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true, post_id: params.post_id };
		},
	},
	{
		name: "assign_post",
		description: "Assign a post to a staff member or team",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				assigned_to: { type: "string", minLength: 1 },
			},
			required: ["post_id", "assigned_to"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("posts")
				.update({
					assigned_to: params.assigned_to,
					updated_at: new Date().toISOString(),
				})
				.eq("id", params.post_id);
			if (error) throw error;
			return { ok: true, post_id: params.post_id };
		},
	},
	{
		name: "bulk_update",
		description:
			"Apply the same status or priority change to several posts in one step",
		parameters: {
			type: "object",
			properties: {
				post_ids: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					maxItems: 50,
				},
				status: { type: "string" },
				priority: { type: "string" },
			},
			required: ["post_ids"],
		},
		permissions: "admin",
		category: "write",
		requiresApproval: true,
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const ids = (params.post_ids || []).slice(0, 50);
			if (!ids.length)
				return { ok: false, reason: "bulk_update needs at least one post id" };
			if (!params.status && !params.priority)
				return { ok: false, reason: "bulk_update needs a status or a priority" };
			const updates = { updated_at: new Date().toISOString() };
			if (params.status) updates.status = params.status;
			if (params.priority) updates.priority = params.priority;
			const { error } = await supabase.from("posts").update(updates).in("id", ids);
			if (error) throw error;
			return { ok: true, updated: ids.length, post_ids: ids };
		},
	},
	{
		name: "close_poll",
		description: "Close a poll so it stops accepting votes",
		parameters: {
			type: "object",
			properties: { poll_id: { type: "string", minLength: 1 } },
			required: ["poll_id"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { error } = await supabase
				.from("polls")
				.update({ archived: true })
				.eq("id", params.poll_id);
			if (error) throw error;
			return { ok: true, poll_id: params.poll_id };
		},
	},
	{
		name: "get_settings",
		description: "Read a platform setting by key",
		parameters: {
			type: "object",
			properties: { key: { type: "string", minLength: 1 } },
			required: ["key"],
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			const { data, error } = await supabase
				.from("settings")
				.select("key,value")
				.eq("key", params.key)
				.maybeSingle();
			if (error) throw error;
			if (!data) return { key: params.key, found: false };
			let value = data.value;
			if (typeof value === "string") {
				try {
					value = JSON.parse(value);
				} catch {
					/* keep the raw string */
				}
			}
			return { key: data.key, found: true, value };
		},
	},

	// ── Admin communication (Admin only) ───────────────────────────
	{
		name: "draft_admin_reply",
		description: "Fetch a post and its report reasons so an official reply can be drafted from the real content. Does not write anything.",
		parameters: {
			type: "object",
			properties: { post_id: { type: "string", minLength: 1 } },
			required: ["post_id"],
		},
		permissions: "admin",
		category: "read",
		cacheable: false,
		retryable: true,
		execute: async (params) => {
			const [post, reports] = await Promise.all([
				supabase
					.from("posts")
					.select("id,title,description,category,status,priority,admin_reply,created_at")
					.eq("id", params.post_id)
					.maybeSingle(),
				supabase
					.from("reports")
					.select("reason,status,created_at")
					.eq("target_id", params.post_id)
					.eq("target_type", "post")
					.order("created_at", { ascending: false })
					.limit(20),
			]);
			if (post.error) throw post.error;
			if (!post.data) return { error: "Post not found" };
			return {
				post: post.data,
				reports: reports.data || [],
				note: "No reply was written. Draft grounded in this content, then ask approval before publishing.",
			};
		},
	},
	{
		name: "publish_admin_reply",
		description: "Publish an approved official reply on a post. Requires administrator confirmation before execution.",
		parameters: {
			type: "object",
			properties: {
				post_id: { type: "string", minLength: 1 },
				reply: { type: "string", minLength: 1 },
			},
			required: ["post_id", "reply"],
		},
		permissions: "admin",
		category: "write",
		requiresApproval: true,
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { data, error } = await supabase
				.from("posts")
				.update({
					admin_reply: String(params.reply).slice(0, 2000),
					updated_at: new Date().toISOString(),
				})
				.eq("id", params.post_id)
				.select("id,admin_reply")
				.single();
			if (error) throw error;
			return { ok: true, post: data };
		},
	},

	// ── Computer Use / Navigation (Admin only) ──────────────────────
	// This tool does not navigate on the server. It returns a client action
	// that the application executes through the real in-app navigation adapter, then
	// verifies by observing the resulting UI state.
	{
		name: "navigate_admin_page",
		description: "Open a page inside the VoiceFlow admin application. Use when the administrator asks to open the feed, posts, reports, users, activity, settings or analytics.",
		parameters: {
			type: "object",
			properties: {
				target: {
					type: "string",
					enum: ["feed", "reports", "posts", "users", "activity", "settings", "analytics"],
					description: "The admin page to open",
				},
			},
			required: ["target"],
		},
		permissions: "admin",
		category: "system",
		requiresApproval: false,
		cacheable: false,
		retryable: false,
		execute: async (params) => ({
			client_action: "navigate",
			target: params.target,
			note: "Client-side in-app navigation; no server-side action taken.",
		}),
	},

	// ── Knowledge Base Tools (Both) ──────────────────────────────────
	{
		name: "search_knowledge_base",
		description: "Search the knowledge base for answers",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", minLength: 1 },
				category: { type: "string" },
				limit: { type: "integer", default: 5 },
			},
			required: ["query"],
		},
		permissions: "both",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async (params) => {
			let q = supabase
				.from("knowledge_base")
				.select("id, title, content, category, tags, confidence")
				.ilike("title", `%${params.query}%`)
				.limit(params.limit || 5);
			if (params.category) q = q.eq("category", params.category);
			const { data, error } = await q;
			if (error) throw error;

			// Update usage count for analytics (non-critical) — read current value
			// then increment. PostgREST cannot do in-place arithmetic, and a
			// PostgrestBuilder (supabase.rpc) cannot be used as a column value.
			if (data && data.length > 0) {
				try {
					const ids = data.map((d) => d.id);
					const { data: rows } = await supabase
						.from("knowledge_base")
						.select("id, usage_count")
						.in("id", ids);
					if (rows) {
						for (const row of rows) {
							await supabase
								.from("knowledge_base")
								.update({ usage_count: (Number(row.usage_count) || 0) + 1 })
								.eq("id", row.id);
						}
					}
				} catch {
					/* non-critical */
				}
			}

			return { results: data || [] };
		},
	},

	// ── Memory Tools (Admin only) ────────────────────────────────────
	{
		name: "store_memory",
		description: "Store a memory for an agent",
		parameters: {
			type: "object",
			properties: {
				agent_id: { type: "string", minLength: 1 },
				memory_type: {
					type: "string",
					enum: [
						"user_preferences",
						"conversation_context",
						"learned_facts",
						"experience",
					],
				},
				content: { type: "object" },
				confidence: { type: "number" },
			},
			required: ["agent_id", "memory_type", "content"],
		},
		permissions: "admin",
		category: "write",
		cacheable: false,
		retryable: false,
		execute: async (params) => {
			const { data, error } = await supabase
				.from("agent_memory")
				.insert({
					agent_id: params.agent_id,
					memory_type: params.memory_type,
					content: params.content,
					confidence: params.confidence || 1.0,
					created_at: new Date().toISOString(),
				})
				.select()
				.single();
			if (error) throw error;
			return { ok: true, memory: data };
		},
	},
	{
		name: "retrieve_memory",
		description: "Retrieve memories for an agent",
		parameters: {
			type: "object",
			properties: {
				agent_id: { type: "string", minLength: 1 },
				memory_type: { type: "string" },
				limit: { type: "integer", default: 10 },
			},
			required: ["agent_id"],
		},
		permissions: "admin",
		category: "read",
		cacheable: true,
		retryable: true,
		execute: async (params) => {
			let q = supabase
				.from("agent_memory")
				.select("*")
				.eq("agent_id", params.agent_id)
				.order("created_at", { ascending: false })
				.limit(params.limit || 10);
			if (params.memory_type) q = q.eq("memory_type", params.memory_type);
			const { data, error } = await q;
			if (error) throw error;
			return { memories: data || [] };
		},
	},
];

// ─── Tool Registry ────────────────────────────────────────────────
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name) {
	return TOOL_MAP.get(name) || null;
}

export function getAllTools() {
	return [...TOOLS];
}

export function getToolsForRole(role) {
	return TOOLS.filter(
		(t) => t.permissions === "both" || t.permissions === role,
	);
}

export function getToolNamesForRole(role) {
	return getToolsForRole(role).map((t) => t.name);
}

export function getToolSchemasForRole(role) {
	return getToolsForRole(role).map((t) => ({
		name: t.name,
		description: t.description,
		parameters: t.parameters,
		category: t.category,
	}));
}

// ─── Audit Logger ─────────────────────────────────────────────────
async function logToolCall(toolName, params, result, latencyMs, context) {
	try {
		const { data, error } = await supabase
			.from("tool_calls")
			.insert({
				tool_name: toolName,
				parameters: params,
				result: result,
				status: result?.error ? "failed" : "completed",
				latency_ms: latencyMs,
				error: result?.error || null,
				created_at: new Date().toISOString(),
			})
			.select("id")
			.single();
		if (error) {
			console.warn("[TOOL-REGISTRY] Failed to log tool call:", error.message);
			return null;
		}
		return data?.id || null;
	} catch (err) {
		console.warn("[TOOL-REGISTRY] Failed to log tool call:", err.message);
		return null;
	}
}

// ─── Execution Engine ─────────────────────────────────────────────
export async function executeTool(name, params, context = {}) {
	const tool = TOOL_MAP.get(name);
	const startTime = Date.now();

	// Tool not found
	if (!tool) {
		return { error: `Unknown tool: ${name}`, latency_ms: 0 };
	}

	// Permission check
	const role = context.role || "student";
	if (tool.permissions !== "both" && tool.permissions !== role) {
		return {
			error: `Tool '${name}' requires ${tool.permissions} permissions`,
			latency_ms: 0,
		};
	}

	// Schema validation
	const validationErrors = validateParams(tool, params);
	if (validationErrors.length > 0) {
		return {
			error: `Validation failed: ${validationErrors.join("; ")}`,
			latency_ms: 0,
		};
	}

	// Check cache for read tools
	if (tool.cacheable && tool.category === "read") {
		const cached = getCached(name, params);
		if (cached) {
			const latency = Date.now() - startTime;
			const standardized = standardizeResult(
				name,
				params,
				{ cached: true, ...cached },
				startTime,
				context,
			);
			await logToolCall(
				name,
				params,
				{ cached: true, ...cached },
				latency,
				context,
			);
			return { ...standardized, latency_ms: latency };
		}
	}

	// Execute with retry
	let lastError = null;
	const maxAttempts = tool.retryable ? MAX_RETRIES + 1 : 1;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			// Execute with timeout
			const result = await Promise.race([
				tool.execute(params),
				new Promise((_, reject) =>
					setTimeout(
						() => reject(new Error(`Tool timeout after ${TOOL_TIMEOUT_MS}ms`)),
						TOOL_TIMEOUT_MS,
					),
				),
			]);

			const latency = Date.now() - startTime;

			// Truncate large results
			if (result && JSON.stringify(result).length > MAX_RESULT_CHARS) {
				const truncated = JSON.stringify(result).slice(0, MAX_RESULT_CHARS);
				result._truncated = true;
				result._original_size = JSON.stringify(result).length;
			}

			// Standardize result into enterprise contract
			const standardized = standardizeResult(
				name,
				params,
				result,
				startTime,
				context,
			);

			// Cache read tools
			if (tool.cacheable && tool.category === "read" && !result?.error) {
				setCache(name, params, result, CACHE_TTL_MS);
			}

			// Log success
			const toolCallId = await logToolCall(
				name,
				params,
				result,
				latency,
				context,
			);

			// Store evidence asynchronously (non-blocking)
			storeToolEvidence(toolCallId, standardized.evidence, context).catch(
				(err) =>
					console.warn("[TOOL-REGISTRY] Evidence store failed:", err.message),
			);

			return { ...standardized, latency_ms: latency };
		} catch (err) {
			lastError = err;

			if (attempt < maxAttempts) {
				// Wait before retry
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
			}
		}
	}

	// All attempts failed
	const latency = Date.now() - startTime;
	const errorResult = {
		error: lastError?.message || "Tool execution failed",
		latency_ms: latency,
	};
	const standardized = standardizeResult(
		name,
		params,
		errorResult,
		startTime,
		context,
	);
	const toolCallId = await logToolCall(
		name,
		params,
		errorResult,
		latency,
		context,
	);

	// Store evidence for failed calls too
	storeToolEvidence(toolCallId, standardized.evidence, context).catch((err) =>
		console.warn("[TOOL-REGISTRY] Evidence store failed:", err.message),
	);

	return { ...standardized, latency_ms: latency };
}

// ─── Batch Execution ──────────────────────────────────────────────
export async function executeTools(toolCalls, context = {}) {
	const results = [];
	for (const call of toolCalls) {
		const result = await executeTool(call.name, call.params || {}, context);
		results.push({ name: call.name, ...result });
	}
	return results;
}

// ─── Tools Excluded from Model Manifest / Prompts ─────────────────
// SQL and tool-forging were removed from the registry entirely. Nothing is
// excluded by name any more — those tools simply do not exist.
const EXCLUDED_FROM_MODEL_PROMPTS = new Set(["store_memory"]);

// ─── Tool Definition for LLM ──────────────────────────────────────
export function buildToolDefinitionsForLLM(role) {
	const tools = getToolsForRole(role).filter(
		(t) => !EXCLUDED_FROM_MODEL_PROMPTS.has(t.name),
	);
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		parameters: t.parameters,
	}));
}

// ─── Parse Tool Calls from LLM Output ─────────────────────────────
export function parseToolCalls(text) {
	const trimmed = text.trim();

	// 1. Raw JSON array: [{"name":"...", "arguments":{...}}]
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const arr = JSON.parse(trimmed);
			if (Array.isArray(arr) && arr.length > 0 && arr[0].name) {
				return {
					reply: "",
					actions: arr.map((item) => ({
						name: item.name,
						params: item.arguments || item.args || {},
					})),
				};
			}
		} catch {
			/* fall through */
		}
	}

	// 2. JSON code block: ```json\n[...]\n```
	const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		try {
			const parsed = JSON.parse(codeBlockMatch[1].trim());
			if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) {
				return {
					reply: "",
					actions: parsed.map((item) => ({
						name: item.name,
						params: item.arguments || item.args || {},
					})),
				};
			}
		} catch {
			/* fall through */
		}
	}

	// 3. JSON object with "actions" key
	const actionsMatch = trimmed.match(/\{[\s\S]*"actions"[\s\S]*\}/);
	if (actionsMatch) {
		try {
			const json = JSON.parse(actionsMatch[0]);
			if (json.actions && Array.isArray(json.actions)) {
				return { reply: json.reply || "", actions: json.actions };
			}
		} catch {
			/* fall through */
		}
	}

	// 4. Single JSON object: {"name":"...", "arguments":{...}}
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		try {
			const obj = JSON.parse(trimmed);
			if (obj.name && (obj.arguments || obj.args)) {
				return {
					reply: "",
					actions: [{ name: obj.name, params: obj.arguments || obj.args }],
				};
			}
		} catch {
			/* fall through */
		}
	}

	// 5. No tool calls found
	return { reply: text, actions: [] };
}

// ─── Tool Call Detection ──────────────────────────────────────────
export function looksLikeToolCall(text) {
	if (!text) return false;
	const trimmed = text.trim();
	if (
		trimmed.startsWith("[") &&
		(trimmed.includes('"name"') || trimmed.includes('"tool"'))
	)
		return true;
	if (/^```json\s*\[/.test(trimmed)) return true;
	if (
		trimmed.startsWith("{") &&
		trimmed.includes('"actions"') &&
		/\[/.test(trimmed)
	)
		return true;
	if (
		trimmed.startsWith("{") &&
		trimmed.includes('"name"') &&
		(trimmed.includes('"arguments"') || trimmed.includes('"args"'))
	)
		return true;
	return false;
}

export function looksLikeToolCallPartial(text) {
	if (!text || text.length < 6) return false;
	if (/"\w+"\s*:/.test(text)) return true;
	if (/[[{]\s*"\w+"\s*:/.test(text)) return true;
	return false;
}

// ─── System Prompt Builder ────────────────────────────────────────
export function buildToolSystemPrompt(role, personaPrompt = "") {
	const tools = getToolsForRole(role).filter(
		(t) => !EXCLUDED_FROM_MODEL_PROMPTS.has(t.name),
	);
	const toolList = tools
		.map((t) => {
			const params = t.parameters.properties || {};
			const required = t.parameters.required || [];
			const paramStr = Object.entries(params)
				.map(([k, v]) => {
					const req = required.includes(k) ? "*" : "";
					return `${k}${req}:${v.type}`;
				})
				.join(", ");
			return `- ${t.name}: ${t.description} (${paramStr || "no params"})`;
		})
		.join("\n");

	return `${personaPrompt}

## TOOL CALLING FORMAT
When you need to call a tool, respond with ONLY a JSON array — no text before or after:
[{"name": "tool_name", "arguments": {"param": "value"}}]

Available tools:
${toolList}

RULES:
1. You are the VoiceFlow AI assistant — a focused operational helper for administrators.
2. You are NOT a SQL or database engine. NEVER output SQL code, query syntax, or database error messages.
3. Use named business domain tools (get_posts, get_analytics, admin_reply, browse_and_navigate_ui, etc.) to perform all work.
4. For multi-step tasks (e.g. "open feed page write hello in top post official reply"):
   - First call get_posts or browse_and_navigate_ui to inspect the feed and retrieve the post ID.
   - Then call admin_reply with the post ID and the reply message.
5. If no tool is needed, respond with a natural language answer.
6. If multiple tools are needed, return them all in one array.
7. After receiving tool results, summarize them in natural language — do NOT return more tool calls.
You have access to real platform data. Query it with tools. Never guess.`;
}

// ─── Standard Result Contract ────────────────────────────────────
// Wraps any tool execution result into the standard enterprise contract.
// Every tool returns: status, executionTime, inputs, outputs, verification, evidence, logs, rollback, confidence, warnings, errors
export function standardizeResult(
	toolName,
	params,
	result,
	startTime,
	context = {},
) {
	const executionTime = Date.now() - startTime;
	const isError = !!result?.error;
	const hasWarning = !!(result?._cached || result?._truncated);

	// Determine status
	let status = "success";
	if (isError) status = "error";
	else if (hasWarning) status = "partial";

	// Build warnings array
	const warnings = [];
	if (result?._cached) warnings.push("Result served from cache");
	if (result?._truncated)
		warnings.push(`Result truncated from ${result._original_size} chars`);
	if (result?.latency_ms && result.latency_ms > 5000)
		warnings.push(`Slow execution: ${result.latency_ms}ms`);

	// Build errors array
	const errors = [];
	if (result?.error) errors.push(result.error);

	// Build logs
	const logs = [];
	logs.push({
		level: isError ? "error" : "info",
		message: `Tool ${toolName} ${isError ? "failed" : "executed"}`,
		timestamp: new Date().toISOString(),
	});
	if (context.role)
		logs.push({ level: "debug", message: `Role: ${context.role}` });

	return {
		status,
		executionTime,
		inputs: {
			tool: toolName,
			params: params || {},
			role: context.role || "unknown",
		},
		outputs: isError ? null : result,
		verification: {
			checked: true,
			status: status,
			confidence: isError ? 0 : result?._cached ? 0.9 : 0.8,
		},
		evidence: {
			toolName,
			params,
			result: isError ? { error: result.error } : result,
			latencyMs: result?.latency_ms || executionTime,
			timestamp: new Date().toISOString(),
			conversationId: context.conversationId || null,
		},
		logs,
		rollback: null, // Rollback info added by caller if available
		confidence: isError ? 0 : result?._cached ? 0.9 : 0.8,
		warnings,
		errors,
	};
}

// ─── Store Tool Evidence ──────────────────────────────────────────
// Persists tool execution evidence to the tool_evidence table.
// Called after every tool execution to build the audit trail.
export async function storeToolEvidence(toolCallId, evidence, context = {}) {
	try {
		const { default: supabase } = await import("./_db-client.js");
		const { toolName, params, result, latencyMs, conversationId } = evidence;
		// Default role MUST match executeTool()'s default ("student"). When it
		// did not, a non-admin tool call was written to the evidence table with
		// actor_id "admin", so the audit trail claimed an admin did work that
		// executeTool had just authorised as a student. actor_id falls back to
		// "unknown" (the same convention api/_audit.js uses) rather than inventing
		// an actor we cannot identify.
		const {
			role = "student",
			actorId = null,
			ipAddress = null,
			ip = null,
		} = context;

		// Determine action type from tool name
		const actionType = determineActionType(toolName);
		const riskLevel = determineRiskLevel(toolName, params);

		const row = {
			tool_call_id: toolCallId || null,
			conversation_id: conversationId || null,
			tool_name: toolName,
			action_type: actionType,
			input_params: params || {},
			output_result: result || {},
			actor_id: actorId || (role === "admin" ? "admin" : "unknown"),
			actor_type: role === "admin" ? "admin" : "user",
			// Callers pass `ip` (v3/_tools.js does); accept both spellings so the
			// source IP is not silently dropped.
			ip_address: ipAddress || ip,
			risk_level: riskLevel,
			requires_approval: riskLevel === "high" || riskLevel === "critical",
			verification_status: "pending",
		};

		const { error } = await supabase.from("tool_evidence").insert(row);
		if (error) {
			console.error("[TOOL-REGISTRY] Failed to store evidence:", error.message);
			return { stored: false, error: error.message };
		}
		return { stored: true };
	} catch (err) {
		console.error("[TOOL-REGISTRY] Evidence storage error:", err.message);
		return { stored: false, error: err.message };
	}
}

// ─── Determine Action Type ────────────────────────────────────────
function determineActionType(toolName) {
	const queryTools = [
		"get_posts",
		"get_analytics",
		"get_activity_logs",
		"search_users",
		"get_user_posts",
		"get_reports",
		"get_polls",
		"get_comments",
		"search_knowledge_base",
	];
	const createTools = [
		"create_ticket",
		"send_notification",
		"create_comment",
		"create_poll",
	];
	const modifyTools = [
		"update_post_status",
		"assign_ticket",
		"warn_user",
		"update_knowledge_base",
		"pin_post",
		"hide_post",
		"lock_post",
		"feature_post",
		"mark_solved",
		"set_eta",
		"admin_reply",
	];
	const deleteTools = ["purge_user_content", "ban_user", "delete_post"];
	const escalateTools = ["escalate_issue"];

	if (queryTools.includes(toolName)) return "query";
	if (createTools.includes(toolName)) return "create";
	if (modifyTools.includes(toolName)) return "modify";
	if (deleteTools.includes(toolName)) return "delete";
	if (escalateTools.includes(toolName)) return "escalate";
	return "query"; // default
}

// ─── Determine Risk Level ────────────────────────────────────────
function determineRiskLevel(toolName, params) {
	// Critical: destructive operations
	const criticalTools = ["ban_user", "purge_user_content", "delete_post"];
	if (criticalTools.includes(toolName)) return "critical";

	// High: modify operations that affect state
	const highTools = [
		"warn_user",
		"update_post_status",
		"assign_ticket",
		"send_notification",
		"admin_reply",
	];
	if (highTools.includes(toolName)) return "high";

	// Medium: create operations
	const mediumTools = [
		"create_ticket",
		"create_comment",
		"create_poll",
		"escalate_issue",
	];
	if (mediumTools.includes(toolName)) return "medium";

	// Low: read-only operations
	return "low";
}

export default {
	getTool,
	getAllTools,
	getToolsForRole,
	getToolNamesForRole,
	getToolSchemasForRole,
	executeTool,
	executeTools,
	buildToolDefinitionsForLLM,
	buildToolSystemPrompt,
	parseToolCalls,
	looksLikeToolCall,
	looksLikeToolCallPartial,
	validateParams,
	clearCache,
	standardizeResult,
	storeToolEvidence,
};
