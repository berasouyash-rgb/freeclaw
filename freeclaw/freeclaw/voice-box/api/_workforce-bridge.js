// ═══════════════════════════════════════════════════════════════
// WORKFORCE BRIDGE — Python workforce ↔ Node.js platform operations
// ═══════════════════════════════════════════════════════════════
// This endpoint lets the Python workforce call real Node.js tools.
// Every call is authenticated, rate-limited, and audit-logged.
//
// POST /api/workforce/bridge
// Body: { action, params, agent_id, task_id }
// ═══════════════════════════════════════════════════════════════

import crypto from "crypto";
import { auditLog } from "./_auth.js";
import supabase from "./_db-client.js";
import { cors, isAdmin } from "./_auth.js";
import { emitEvent } from "./_events.js";

// ─── Tool Registry ──────────────────────────────────────────────
// Each tool is a function that performs a real operation on the platform.

const TOOLS = {
  // ── Read tools (safe, no side effects) ──
  read_post: {
    description: "Read a post by ID",
    risk: "read",
    handler: async (params) => {
      const { data, error } = await supabase
        .from("posts").select("id, title, description, category, status, priority, author_id, created_at, hidden, deleted, reactions, comment_count")
        .eq("id", params.post_id).single();
      if (error) throw new Error(error.message);
      return data;
    },
  },

  read_pending_reports: {
    description: "Read pending reports",
    risk: "read",
    handler: async (params) => {
      const { data, error } = await supabase
        .from("reports").select("*")
        .in("status", [null, "pending"])
        .order("created_at", { ascending: false })
        .limit(params.limit || 50);
      if (error) throw new Error(error.message);
      return { reports: data, count: data.length };
    },
  },

  count_posts: {
    description: "Count posts with optional filters",
    risk: "read",
    handler: async (params) => {
      let query = supabase.from("posts").select("id", { count: "exact", head: true });
      if (params.status) query = query.eq("status", params.status);
      if (params.category) query = query.eq("category", params.category);
      if (params.deleted === false) query = query.eq("deleted", false);
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      return { count: count || 0 };
    },
  },

  count_comments: {
    description: "Count comments",
    risk: "read",
    handler: async (params) => {
      const { count, error } = await supabase
        .from("comments").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return { count: count || 0 };
    },
  },

  read_recent_posts: {
    description: "Read recent posts for analysis",
    risk: "read",
    handler: async (params) => {
      const limit = Math.min(params.limit || 20, 100);
      const { data, error } = await supabase
        .from("posts").select("id, title, description, category, status, author_id, created_at, deleted, comment_count")
        .eq("deleted", false)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return data;
    },
  },

  read_executions: {
    description: "Read recent agent executions",
    risk: "read",
    handler: async (params) => {
      const limit = Math.min(params.limit || 50, 200);
      const { data, error } = await supabase
        .from("agent_executions").select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return data;
    },
  },

  read_system_health: {
    description: "Read system health from multiple tables",
    risk: "read",
    handler: async () => {
      const checks = {};
      // DB connectivity
      try {
        await supabase.from("posts").select("id").limit(1);
        checks.database = true;
      } catch { checks.database = false; }
      // Pending reports
      try {
        const { count } = await supabase
          .from("reports").select("id", { count: "exact", head: true })
          .in("status", [null, "pending"]);
        checks.pending_reports = count || 0;
      } catch { checks.pending_reports = -1; }
      // Recent failures
      try {
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const { count } = await supabase
          .from("agent_executions").select("id", { count: "exact", head: true })
          .eq("status", "failed")
          .gte("started_at", oneHourAgo);
        checks.failures_last_hour = count || 0;
      } catch { checks.failures_last_hour = -1; }

      const score = (checks.database ? 40 : 0) +
        (checks.pending_reports >= 0 && checks.pending_reports < 20 ? 30 : checks.pending_reports >= 0 ? 15 : 0) +
        (checks.failures_last_hour >= 0 && checks.failures_last_hour < 5 ? 30 : checks.failures_last_hour >= 0 ? 10 : 0);

      return { score, checks, measured_at: new Date().toISOString() };
    },
  },

  // ── Write tools (low risk, safe autonomous actions) ──
  quarantine_post: {
    description: "Hide a suspicious post (reversible)",
    risk: "write",
    handler: async (params) => {
      const { post_id, reason } = params;
      if (!post_id) throw new Error("post_id required");
      // Get before state
      const { data: before } = await supabase
        .from("posts").select("hidden, admin_notes").eq("id", post_id).single();
      // Apply quarantine
      const { error } = await supabase
        .from("posts").update({
          hidden: true,
          admin_notes: `Quarantined by workforce: ${reason || "spam detected"}`,
        }).eq("id", post_id);
      if (error) throw new Error(error.message);
      return { before, after: { hidden: true }, quarantined: true };
    },
  },

  restore_post: {
    description: "Restore a quarantined post (rollback)",
    risk: "write",
    handler: async (params) => {
      const { post_id } = params;
      if (!post_id) throw new Error("post_id required");
      const { error } = await supabase
        .from("posts").update({ hidden: false, admin_notes: "Restored by workforce" })
        .eq("id", post_id);
      if (error) throw new Error(error.message);
      return { restored: true };
    },
  },

  record_metric: {
    description: "Record a metric in system_metrics",
    risk: "write",
    handler: async (params) => {
      const { metric_name, metric_value, tags } = params;
      const { error } = await supabase
        .from("system_metrics").insert({
          metric_name, metric_value,
          tags: { ...tags, recorded_by: "workforce", recorded_at: new Date().toISOString() },
        });
      if (error) throw new Error(error.message);
      return { recorded: true };
    },
  },

  record_action: {
    description: "Record a workforce action in the ledger",
    risk: "write",
    handler: async (params) => {
      const { error } = await supabase
        .from("workforce_actions").insert(params);
      if (error) throw new Error(error.message);
      return { recorded: true };
    },
  },

  create_alert: {
    description: "Create an admin alert",
    risk: "write",
    handler: async (params) => {
      const { severity, title, body, source_worker, category, dedup_key } = params;
      // Dedup check
      if (dedup_key) {
        const { data: existing } = await supabase
          .from("workforce_alerts").select("id, occurrences")
          .eq("dedup_key", dedup_key)
          .eq("status", "active")
          .single();
        if (existing) {
          // Increment occurrence count instead of creating duplicate
          await supabase
            .from("workforce_alerts")
            .update({
              occurrences: (existing.occurrences || 1) + 1,
              last_seen: new Date().toISOString(),
            }).eq("id", existing.id);
          return { alert_id: existing.id, deduplicated: true };
        }
      }
      const { data, error } = await supabase
        .from("workforce_alerts").insert({
          severity, title, body, source_worker, category, dedup_key,
        }).select().single();
      if (error) throw new Error(error.message);
      // Send email notification for critical/high-severity alerts
      if (severity === "critical" || severity === "high") {
        import("./_email.js").then(({ sendAlertEmail }) => {
          sendAlertEmail({
            title: title || "Workforce Alert",
            message: body || "No details provided.",
            severity: severity === "critical" ? "critical" : "warning",
          }).catch(() => {});
        }).catch(() => {});
      }
      return { alert_id: data.id, created: true };
    },
  },

  create_incident: {
    description: "Create a security/incident record",
    risk: "write",
    handler: async (params) => {
      const { data, error } = await supabase
        .from("workforce_incidents").insert(params).select().single();
      if (error) throw new Error(error.message);
      return { incident_id: data.id };
    },
  },

  emit_event: {
    description: "Emit a platform event",
    risk: "write",
    handler: async (params) => {
      const { event_type, data: eventData } = params;
      await emitEvent(event_type, eventData);
      return { emitted: true };
    },
  },
};

// ─── Rate limiting ──────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT = 100; // per minute per agent
const RATE_WINDOW = 60000;

function checkRateLimit(agentId) {
  const now = Date.now();
  const entry = rateLimitMap.get(agentId);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(agentId, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}// ─── Shared-secret auth ────────────────────────────────────────
// The Python workforce must send this header to call write tools.
// Read from env at module load (not per-request) to avoid repeated parse.
const BRIDGE_SECRET = process.env.WORKFORCE_BRIDGE_SECRET || "";

function isAuthenticated(req) {
	// In development (no secret configured), allow localhost only
	if (!BRIDGE_SECRET) {
		const host = req.headers?.host || "";
		return host.startsWith("localhost") || host.startsWith("127.");
	}
	const provided = req.headers?.["x-bridge-secret"] || "";
	// Timing-safe comparison to prevent timing attacks
	try {
		return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(BRIDGE_SECRET));
	} catch {
		return false;
	}
}

// ─── Request handler ────────────────────────────────────────────
export default async function handler(req, res) {
	if (cors(req, res)) return;
	if (req.method !== "POST") {
		res.writeHead(405, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ error: "POST required" }));
	}

	// Auth: require shared secret or localhost
	if (!isAuthenticated(req)) {
		res.writeHead(401, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ error: "Unauthorized: missing or invalid bridge secret" }));
	}

	const { action, params = {}, agent_id = "unknown", task_id = "" } = req.body || {};

  if (!action || !TOOLS[action]) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unknown tool" }));
  }

  // Rate limit
  if (!checkRateLimit(agent_id)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Rate limit exceeded" }));
  }

  const tool = TOOLS[action];
  const startTime = Date.now();

  try {
    const result = await tool.handler(params);
    const durationMs = Date.now() - startTime;

    // Audit log
    await auditLog("workforce_bridge", {
      action, agent_id, task_id, duration_ms: duration_ms, success: true,
    }).catch(() => {});

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true, action, result, duration_ms: durationMs,
      risk: tool.risk,
    }));
  } catch (err) {
    const durationMs = Date.now() - startTime;
    await auditLog("workforce_bridge", {
      action, agent_id, task_id, duration_ms, success: false, error: err.message,
    }).catch(() => {});

    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: false, action, error: "Tool execution failed", duration_ms: durationMs,
    }));
  }
}
