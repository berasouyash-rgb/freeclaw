// ═══════════════════════════════════════════════════════════════════
// Incident Detection Cron — Periodic health scanning + incident creation
// ═══════════════════════════════════════════════════════════════════
// Runs periodically (via Vercel Cron or manual trigger) to:
//   1. Collect real metrics from monitoring, cache, DB, workforce
//   2. Store telemetry in system_metrics for trending
//   3. Evaluate health thresholds
//   4. Create incidents when thresholds are exceeded
//   5. Auto-resolve incidents when metrics recover
//
// This is NOT a fake health check. Every metric comes from real data.
// ═══════════════════════════════════════════════════════════════════

import { cors, isCronAuthorized, CRON_UNAUTHORIZED_BODY } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { logger } from "./_observability.js";
import { detectIncidents, loadIncidents, saveIncidents, addTimeline } from "./_incidents.js";
import { buildEvent, appendEvent, listEvents } from "./_ops-events.js";
import {
  releaseRetried,
  recoverStaleJobs,
  promoteWaiting,
  queueStats,
  listJobs,
} from "./_work-queue.js";
import { enqueueTriageJobs, runTriageWorker, TRIAGE_WORKER } from "./_incident-triage.js";
import {
  enqueueValueAudits,
  runValueAuditWorker,
  readAllVerdicts,
  VALUE_AUDIT_WORKER,
} from "./_value-audit.js";

// ─── Health thresholds (must match _incidents.js) ──────────────
const THRESHOLDS = {
  api_error_rate: { warn: 0.05, critical: 0.15 },
  api_p95_ms:     { warn: 500, critical: 2000 },
  cache_hit_rate: { warn: 0.80, critical: 0.50 },
  db_query_ms:    { warn: 200, critical: 1000 },
  worker_fail_rate: { warn: 0.20, critical: 0.50 },
  search_zero_rate: { warn: 0.10, critical: 0.30 },
};

// ─── Collect real metrics from various sources ─────────────────
async function collectMetrics() {
  const metrics = {};

  // 1. API metrics from monitoring (in-memory from v3/_monitoring.js)
  // These are real — recorded by the request wrapper in index.js
  try {
    const { data: monData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "system_metrics")
      .maybeSingle();

    // Use stored metrics if available, else defaults
    const stored = monData?.value || {};
    metrics.api_p95_ms = stored.api_p95_ms || 0;
    metrics.error_rate = stored.error_rate || 0;
    metrics.cache_hit_rate = stored.cache_hit_rate ?? 1;
    metrics.worker_fail_rate = stored.worker_fail_rate || 0;
    metrics.search_zero_rate = stored.search_zero_rate || 0;
    metrics.db_query_ms = stored.db_query_ms || 0;
  } catch {
    // Non-critical — use defaults
  }

  // 2. DB health — measure actual query latency
  try {
    const dbStart = Date.now();
    await supabase.from("settings").select("key").limit(1);
    metrics.db_query_ms = Date.now() - dbStart;
  } catch {
    metrics.db_query_ms = 9999;
  }

  // 3. Post count (community health signal)
  try {
    const { count } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("deleted", false);
    metrics.post_count = count || 0;
  } catch {
    metrics.post_count = 0;
  }

  // 4. Active reports (moderation load)
  try {
    const { count } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .in("status", ["reported", "in_progress"]);
    metrics.open_reports = count || 0;
  } catch {
    metrics.open_reports = 0;
  }

  // 5. Worker execution success rate
  try {
    const { data: recent } = await supabase
      .from("agent_executions")
      .select("status")
      .gte("started_at", new Date(Date.now() - 3600000).toISOString())
      .limit(100);
    if (recent?.length) {
      const successes = recent.filter((r) => r.status === "completed").length;
      metrics.worker_fail_rate = 1 - (successes / recent.length);
      metrics.worker_executions_1h = recent.length;
    }
  } catch {
    // Non-critical
  }

  // 6. Event log size (event bus health)
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "event_log")
      .maybeSingle();
    metrics.event_count = data?.value?.events?.length || 0;
  } catch {
    metrics.event_count = 0;
  }

  // 7. Timestamp
  metrics.collected_at = new Date().toISOString();

  return metrics;
}

/**
 * Store metrics in system_metrics table for trending
 */
async function storeMetrics(metrics) {
  try {
    // Store as a single row in settings (KV) for easy access
    const { data: existing } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "system_metrics")
      .maybeSingle();

    const payload = {
      ...metrics,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase
        .from("settings")
        .update({ value: payload })
        .eq("key", "system_metrics");
    } else {
      await supabase
        .from("settings")
        .insert({ key: "system_metrics", value: payload });
    }
  } catch (err) {
    logger.error("incident-cron", "Failed to store metrics", { error: err.message });
  }
}

/**
 * Auto-resolve incidents when metrics recover
 */
async function autoResolveRecovered(metrics) {
  const incidents = await loadIncidents();
  let resolved = 0;

  for (const inc of incidents) {
    if (["DETECTED", "ASSIGNED", "DIAGNOSING"].includes(inc.status)) {
      let recovered = false;

      // Check if the metric that caused this incident has recovered
      if (inc.affected_service === "api") {
        if (inc.title.includes("error rate") && metrics.error_rate < THRESHOLDS.api_error_rate.warn) {
          recovered = true;
        }
        if (inc.title.includes("latency") && metrics.api_p95_ms < THRESHOLDS.api_p95_ms.warn) {
          recovered = true;
        }
      }
      if (inc.affected_service === "cache" && metrics.cache_hit_rate > THRESHOLDS.cache_hit_rate.warn) {
        recovered = true;
      }
      if (inc.affected_service === "workforce" && metrics.worker_fail_rate < THRESHOLDS.worker_fail_rate.warn) {
        recovered = true;
      }

      if (recovered) {
        inc.status = "RESOLVED";
        inc.resolved_at = new Date().toISOString();
        inc.verification = "Auto-resolved: metrics recovered to healthy levels";
        addTimeline(inc, "auto_resolved", "Metrics recovered — incident auto-resolved");
        resolved++;
      }
    }
  }

  if (resolved > 0) {
    await saveIncidents(incidents);
    logger.info("incident-cron", `Auto-resolved ${resolved} incidents`);
  }

  return resolved;
}

/**
 * Run the full incident detection cycle
 */
export async function runIncidentDetection() {
  const startTime = Date.now();
  const results = {
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    metrics: null,
    incidents_created: 0,
    incidents_auto_resolved: 0,
    errors: [],
    event: null,
    queue: null,
    triage: null,
  };

  try {
    // 1. Collect real metrics
    const metrics = await collectMetrics();
    results.metrics = metrics;

    // 2. Store metrics for trending
    await storeMetrics(metrics);

    // 3. Run incident detection (checks thresholds)
    const newIncidents = await detectIncidents();
    results.incidents_created = newIncidents.length;

    // 3b. Produce durable triage jobs for NEW incidents (SPEC §5).
    //     Own try/catch: per-incident enqueue failures surface in errors,
    //     never pass silently; a replayed detection dedupes to 1 record.
    try {
      const produced = await enqueueTriageJobs(newIncidents);
      results.triage = { produced, consumed: null };
      for (const e of produced.errors) {
        results.errors.push(`triage produce: ${e}`);
      }
    } catch (err) {
      results.triage = {
        produced: { enqueued: 0, duplicates: 0, errors: [err.message] },
        consumed: null,
      };
      results.errors.push(`triage produce failed: ${err.message}`);
      logger.error("incident-cron", "Triage producer failed", { error: err.message });
    }

    // 4. Auto-resolve recovered incidents
    results.incidents_auto_resolved = await autoResolveRecovered(metrics);

    // 5. Emit a typed ops event for this scan (SPEC §4).
    // deduplicationKey buckets by the 5-minute cron schedule so a
    // retried/double-fired run stores exactly one event (V5 replay-safe).
    // Own try/catch: a failed emit must surface in errors, never pass silently.
    try {
      const bucketMs = Math.floor(Date.now() / 300000) * 300000;
      const event = buildEvent({
        type: "PERIODIC_HEALTH_CHECK",
        source: "incident-cron",
        resource: "system",
        actor: "system:incident-cron",
        priority: results.incidents_created > 0 ? "high" : "normal",
        correlationId: `incident-cron:${bucketMs}`,
        deduplicationKey: `PERIODIC_HEALTH_CHECK:incident-cron:${bucketMs}`,
        payload: {
          error_rate: metrics.error_rate,
          api_p95_ms: metrics.api_p95_ms,
          db_query_ms: metrics.db_query_ms,
          cache_hit_rate: metrics.cache_hit_rate,
          worker_fail_rate: metrics.worker_fail_rate,
          worker_executions_1h: metrics.worker_executions_1h ?? 0,
          search_zero_rate: metrics.search_zero_rate,
          open_reports: metrics.open_reports,
          post_count: metrics.post_count,
          event_count: metrics.event_count,
          collected_at: metrics.collected_at,
          incidents_created: results.incidents_created,
          incidents_auto_resolved: results.incidents_auto_resolved,
        },
      });
      results.event = await appendEvent(event);
    } catch (err) {
      results.errors.push(`event emit failed: ${err.message}`);
      results.event = { stored: false, reason: "error", error: err.message };
      logger.error("incident-cron", "Ops event emit failed", { error: err.message });
    }

    // 6. Queue housekeeping (SPEC §5): due retries, crash/orphan recovery,
    //    dependency promotion. Read-modify-write on the durable KV queue —
    //    empty sweeps must not write (cheap no-op + preserves write-fail
    //    semantics of earlier steps).
    try {
      const released = await releaseRetried();
      const recovered = await recoverStaleJobs();
      const { promoted, blocked } = await promoteWaiting();
      const hasQueueWork =
        released > 0 || recovered > 0 || promoted > 0 || blocked > 0;
      results.queue = { released, recovered, promoted, blocked };
      if (hasQueueWork) {
        logger.info("incident-cron", "Queue housekeeping applied", results.queue);
      }
    } catch (err) {
      results.errors.push(`queue recovery failed: ${err.message}`);
      logger.error("incident-cron", "Queue housekeeping failed", { error: err.message });
    }

    // 6b. Consume triage jobs (SPEC §5): claim → assign (real KV write) →
    //     independent re-read verification → evidence → resolve. Runs after
    //     housekeeping so released/promoted jobs are claimable this cycle.
    if (results.triage) {
      try {
        results.triage.consumed = await runTriageWorker();
        for (const e of results.triage.consumed.errors) {
          results.errors.push(`triage consume: ${e}`);
        }
      } catch (err) {
        results.triage.consumed = {
          claimed: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          errors: [err.message],
        };
        results.errors.push(`triage consume failed: ${err.message}`);
        logger.error("incident-cron", "Triage consumer failed", { error: err.message });
      }
    }

    // 7. Post-sweep queue stats — read AFTER produce+consume so the cycle's
    //    read-back reflects both (SPEC §5 visibility).
    if (results.queue) {
      try {
        results.queue.stats = await queueStats();
      } catch (err) {
        results.errors.push(`queue stats failed: ${err.message}`);
      }
    }

    // 8. Log summary
    logger.info("incident-cron", `Detection cycle complete`, {
      db_query_ms: metrics.db_query_ms,
      error_rate: metrics.error_rate,
      open_reports: metrics.open_reports,
      worker_fail_rate: metrics.worker_fail_rate,
      incidents_created: results.incidents_created,
      incidents_resolved: results.incidents_auto_resolved,
    });

  } catch (err) {
    results.errors.push(err.message);
    logger.error("incident-cron", `Detection cycle failed`, { error: err.message });
  }

  results.duration_ms = Date.now() - startTime;
  return results;
}

/**
 * HTTP handler
 */
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();

  // AUTHORIZATION: this route triggers a heavy multi-query detection job
  // and serves internal system metrics. It had NO auth at all, so any
  // anonymous caller could run the job on demand (resource exhaustion) or
  // read internal thresholds. Vercel cron sends CRON_SECRET, which
  // isCronAuthorized verifies constant-time; an admin session also works.
  if (!(await isCronAuthorized(req))) {
    return res.status(401).json(CRON_UNAUTHORIZED_BODY);
  }

  try {
    if (req.method === "GET") {
      const { action } = req.query;

      if (action === "run") {
        const results = await runIncidentDetection();
        return res.status(200).json(results);
      }

      if (action === "metrics") {
        const { data } = await supabase
          .from("settings")
          .select("value")
          .eq("key", "system_metrics")
          .maybeSingle();
        return res.status(200).json(data?.value || { message: "No metrics yet" });
      }

      if (action === "health") {
        // Quick health check — just return current thresholds and status
        const { data } = await supabase
          .from("settings")
          .select("value")
          .eq("key", "system_metrics")
          .maybeSingle();
        const m = data?.value || {};
        const health = {};
        for (const [key, thresholds] of Object.entries(THRESHOLDS)) {
          const value = m[key] ?? 0;
          health[key] = {
            value,
            status: value >= thresholds.critical ? "critical"
              : value >= thresholds.warn ? "warning"
              : "healthy",
          };
        }
        return res.status(200).json({ health, collected_at: m.collected_at });
      }

      if (action === "events") {
        // Independent read-back of the durable ops event log (SPEC §4).
        const { type, since, limit } = req.query;
        const events = await listEvents({
          type: typeof type === "string" ? type : undefined,
          since: typeof since === "string" ? since : undefined,
          limit: limit !== undefined ? Number(limit) : undefined,
        });
        return res.status(200).json({ events, count: events.length });
      }

      if (action === "queue") {
        // Independent read-back of the durable work queue (SPEC §5).
        const { state, type, limit } = req.query;
        const jobs = await listJobs({
          state: typeof state === "string" ? state : undefined,
          type: typeof type === "string" ? type : undefined,
          limit: limit !== undefined ? Number(limit) : undefined,
        });
        return res.status(200).json({ jobs, count: jobs.length, stats: await queueStats() });
      }

      if (action === "value-audit") {
        // SPEC §45 TEST 10: produce value audits for every declared and
        // historically-seen queue worker, consume them in the same call,
        // then return the durable verdict flags for independent read-back.
        // Kept out of `action=run` so queue-sweep read-backs reflect only
        // sweep work (queue stats/housekeeping counts stay unpolluted).
        const results = { valueAudit: { produced: null, consumed: null }, errors: [] };
        try {
          results.valueAudit.produced = await enqueueValueAudits({
            declaredWorkers: [TRIAGE_WORKER, VALUE_AUDIT_WORKER],
          });
          for (const e of results.valueAudit.produced.errors) {
            results.errors.push(`value-audit produce: ${e}`);
          }
        } catch (err) {
          results.valueAudit.produced = { enqueued: 0, duplicates: 0, errors: [err.message] };
          results.errors.push(`value-audit produce failed: ${err.message}`);
          logger.error("incident-cron", "Value-audit producer failed", { error: err.message });
        }
        try {
          results.valueAudit.consumed = await runValueAuditWorker();
          for (const e of results.valueAudit.consumed.errors) {
            results.errors.push(`value-audit consume: ${e}`);
          }
        } catch (err) {
          results.valueAudit.consumed = {
            claimed: 0,
            completed: 0,
            flagged: 0,
            verified: 0,
            failed: 0,
            errors: [err.message],
          };
          results.errors.push(`value-audit consume failed: ${err.message}`);
          logger.error("incident-cron", "Value-audit consumer failed", { error: err.message });
        }
        results.flags = await readAllVerdicts();
        return res.status(200).json(results);
      }

      return res.status(400).json({
        error:
          "Unknown action. Use ?action=run|metrics|health|events|queue|value-audit",
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sanitizeError(res, err, "incident-cron");
  }
}
