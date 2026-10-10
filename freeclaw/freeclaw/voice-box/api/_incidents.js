// ═══════════════════════════════════════════════════════════════════
// Incident Engine — Real incident detection, correlation, and management
// ═══════════════════════════════════════════════════════════════════
// Stores incidents in settings (KV) with full lifecycle:
//   DETECT → CORRELATE → CREATE → ASSIGN → DIAGNOSE → MITIGATE
//   → VERIFY → RESOLVE → POSTMORTEM
//
// Every incident has:
//   id, status, severity, title, description, affected_service,
//   detected_at, assigned_at, mitigated_at, resolved_at,
//   root_cause, mitigation, verification, postmortem,
//   correlated_events[], worker_assignments[], timeline[]
//
// States: DETECTED → ASSIGNED → DIAGNOSING → MITIGATING
//         → VERIFYING → RESOLVED / CLOSED / REOPENED
// ═══════════════════════════════════════════════════════════════════

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { logger } from "./_observability.js";
import { emitEventAndBridge, EVENT_TYPES } from "./_events.js";

const INCIDENTS_KEY = "platform_incidents";
const MAX_INCIDENTS = 100;

// ─── Severity definitions ──────────────────────────────────────
const SEVERITY = {
  critical: { label: "Critical", response_minutes: 15, auto_escalate: true },
  high:     { label: "High",     response_minutes: 60, auto_escalate: false },
  medium:   { label: "Medium",   response_minutes: 240, auto_escalate: false },
  low:      { label: "Low",      response_minutes: 1440, auto_escalate: false },
  info:     { label: "Info",     response_minutes: 0, auto_escalate: false },
};

// ─── Service health thresholds ─────────────────────────────────
const HEALTH_THRESHOLDS = {
  api_error_rate: { warn: 0.05, critical: 0.15 },
  api_p95_ms:     { warn: 500, critical: 2000 },
  cache_hit_rate: { warn: 0.80, critical: 0.50 },
  db_query_ms:    { warn: 200, critical: 1000 },
  worker_fail_rate: { warn: 0.20, critical: 0.50 },
  search_zero_rate: { warn: 0.10, critical: 0.30 },
};

/**
 * Generate a unique incident ID
 */
export function generateIncidentId() {
  return `INC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load all incidents from settings KV
 */
export async function loadIncidents() {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", INCIDENTS_KEY)
      .maybeSingle();
    return data?.value?.incidents || [];
  } catch {
    return [];
  }
}

/**
 * Save incidents to settings KV
 */
export async function saveIncidents(incidents) {
  const trimmed = incidents.slice(0, MAX_INCIDENTS);
  try {
    const { data: existing } = await supabase
      .from("settings")
      .select("value")
      .eq("key", INCIDENTS_KEY)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("settings")
        .update({ value: { incidents: trimmed, updated_at: new Date().toISOString() } })
        .eq("key", INCIDENTS_KEY);
    } else {
      await supabase
        .from("settings")
        .insert({ key: INCIDENTS_KEY, value: { incidents: trimmed } });
    }
  } catch (err) {
    logger.error("incidents", "Failed to save incidents", { error: err.message });
  }
}

/**
 * Add a timeline entry to an incident
 */
export function addTimeline(incident, event, detail) {
  incident.timeline = incident.timeline || [];
  incident.timeline.push({
    event,
    detail,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Detect incidents from platform health metrics.
 * Called periodically or on demand. Returns newly created incidents.
 */
export async function detectIncidents() {
  const now = new Date().toISOString();
  const newIncidents = [];

  try {
    // 1. Check API health from recent logs
    const { data: metrics } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "system_metrics")
      .maybeSingle();

    const m = metrics?.value || {};

    // 2. Check error rates
    const errorRate = m.error_rate || 0;
    if (errorRate >= HEALTH_THRESHOLDS.api_error_rate.critical) {
      const inc = await createIncident({
        severity: "critical",
        title: `API error rate at ${(errorRate * 100).toFixed(1)}%`,
        description: `API error rate exceeded critical threshold (${(HEALTH_THRESHOLDS.api_error_rate.critical * 100).toFixed(0)}%). Current: ${(errorRate * 100).toFixed(1)}%.`,
        affected_service: "api",
        source: "health_monitor",
      });
      if (inc) newIncidents.push(inc);
    } else if (errorRate >= HEALTH_THRESHOLDS.api_error_rate.warn) {
      const inc = await createIncident({
        severity: "medium",
        title: `API error rate elevated at ${(errorRate * 100).toFixed(1)}%`,
        description: `API error rate above warning threshold. Current: ${(errorRate * 100).toFixed(1)}%.`,
        affected_service: "api",
        source: "health_monitor",
      });
      if (inc) newIncidents.push(inc);
    }

    // 3. Check API latency
    const p95 = m.api_p95_ms || 0;
    if (p95 >= HEALTH_THRESHOLDS.api_p95_ms.critical) {
      const inc = await createIncident({
        severity: "critical",
        title: `API p95 latency at ${p95}ms`,
        description: `API p95 latency exceeded critical threshold (${HEALTH_THRESHOLDS.api_p95_ms.critical}ms).`,
        affected_service: "api",
        source: "health_monitor",
      });
      if (inc) newIncidents.push(inc);
    }

    // 4. Check worker failure rate
    const workerFailRate = m.worker_fail_rate || 0;
    if (workerFailRate >= HEALTH_THRESHOLDS.worker_fail_rate.critical) {
      const inc = await createIncident({
        severity: "high",
        title: `Worker failure rate at ${(workerFailRate * 100).toFixed(0)}%`,
        description: `Workforce failure rate exceeded critical threshold.`,
        affected_service: "workforce",
        source: "health_monitor",
      });
      if (inc) newIncidents.push(inc);
    }

    // 5. Check cache health
    const cacheHitRate = m.cache_hit_rate ?? 1;
    if (cacheHitRate <= HEALTH_THRESHOLDS.cache_hit_rate.critical && cacheHitRate > 0) {
      const inc = await createIncident({
        severity: "high",
        title: `Cache hit rate dropped to ${(cacheHitRate * 100).toFixed(0)}%`,
        description: `Cache hit rate below critical threshold (${(HEALTH_THRESHOLDS.cache_hit_rate.critical * 100).toFixed(0)}%).`,
        affected_service: "cache",
        source: "health_monitor",
      });
      if (inc) newIncidents.push(inc);
    }

    // 6. Check for stale incidents that need escalation
    const incidents = await loadIncidents();
    for (const inc of incidents) {
      if (inc.status === "DETECTED" || inc.status === "ASSIGNED") {
        const detectedAt = new Date(inc.detected_at).getTime();
        const elapsed = (Date.now() - detectedAt) / 60000;
        const severity = SEVERITY[inc.severity];
        if (severity && severity.auto_escalate && elapsed > severity.response_minutes) {
          inc.severity = "critical";
          inc.severity_escalated = true;
          addTimeline(inc, "escalated", `Auto-escalated to critical after ${Math.round(elapsed)}min without response`);
          logger.warn("incidents", `Incident ${inc.id} auto-escalated`, { elapsed_minutes: Math.round(elapsed) });
        }
      }
    }
    await saveIncidents(incidents);

  } catch (err) {
    logger.error("incidents", "Detection scan failed", { error: err.message });
  }

  return newIncidents;
}

/**
 * Create a new incident with deduplication
 */
async function createIncident({ severity, title, description, affected_service, source }) {
  const incidents = await loadIncidents();
  const now = new Date().toISOString();

  // Dedup: don't create duplicate open incidents for the same service+title
  const existing = incidents.find(
    (i) => i.status !== "RESOLVED" && i.status !== "CLOSED"
      && i.affected_service === affected_service
      && i.title === title,
  );
  if (existing) {
    // Update occurrence count instead
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.last_seen = now;
    addTimeline(existing, "reoccurred", `Occurred again (${existing.occurrences} total)`);
    await saveIncidents(incidents);
    return null;
  }

  const incident = {
    id: generateIncidentId(),
    status: "DETECTED",
    severity: severity || "medium",
    title,
    description,
    affected_service: affected_service || "unknown",
    source: source || "manual",
    detected_at: now,
    assigned_at: null,
    mitigated_at: null,
    resolved_at: null,
    root_cause: null,
    mitigation: null,
    verification: null,
    postmortem: null,
    occurrences: 1,
    correlated_events: [],
    worker_assignments: [],
    timeline: [],
  };

  addTimeline(incident, "created", `Incident detected: ${title}`);

  incidents.unshift(incident);
  await saveIncidents(incidents);

  // Emit incident event
  emitEventAndBridge("incident.created", {
    incident_id: incident.id,
    severity: incident.severity,
    service: affected_service,
    title,
  }).catch(() => {});

  logger.warn("incidents", `Incident created: ${incident.id}`, { severity, service: affected_service });

  return incident;
}

/**
 * Correlate a new event with existing open incidents
 */
export async function correlateEvent(eventType, eventData) {
  const incidents = await loadIncidents();
  const openIncidents = incidents.filter(
    (i) => !["RESOLVED", "CLOSED"].includes(i.status),
  );

  for (const inc of openIncidents) {
    // Correlate if the event is related to the incident's service
    if (eventData.service === inc.affected_service
        || eventData.target === inc.affected_service
        || eventType.includes(inc.affected_service)) {
      inc.correlated_events = inc.correlated_events || [];
      inc.correlated_events.push({
        event_type: eventType,
        timestamp: new Date().toISOString(),
        data: eventData,
      });
      addTimeline(inc, "event_correlated", `Related event: ${eventType}`);
    }
  }

  await saveIncidents(incidents);
}

/**
 * Assign an incident to a worker
 */
export async function assignIncident(incidentId, workerId, taskDescription) {
  const incidents = await loadIncidents();
  const inc = incidents.find((i) => i.id === incidentId);
  if (!inc) return { error: "Incident not found" };

  inc.status = "ASSIGNED";
  inc.assigned_at = new Date().toISOString();
  inc.worker_assignments = inc.worker_assignments || [];
  inc.worker_assignments.push({
    worker_id: workerId,
    task: taskDescription,
    assigned_at: new Date().toISOString(),
  });
  addTimeline(inc, "assigned", `Assigned to ${workerId}: ${taskDescription}`);

  await saveIncidents(incidents);
  return inc;
}

/**
 * Update incident status with evidence
 */
export async function updateIncident(incidentId, { status, root_cause, mitigation, verification, postmortem }) {
  const incidents = await loadIncidents();
  const inc = incidents.find((i) => i.id === incidentId);
  if (!inc) return { error: "Incident not found" };

  if (status) {
    inc.status = status;
    if (status === "MITIGATING") inc.mitigated_at = new Date().toISOString();
    if (status === "RESOLVED" || status === "CLOSED") inc.resolved_at = new Date().toISOString();
    addTimeline(inc, "status_changed", `Status → ${status}`);
  }
  if (root_cause) { inc.root_cause = root_cause; addTimeline(inc, "root_cause", root_cause); }
  if (mitigation) { inc.mitigation = mitigation; addTimeline(inc, "mitigation", mitigation); }
  if (verification) { inc.verification = verification; addTimeline(inc, "verification", verification); }
  if (postmortem) { inc.postmortem = postmortem; addTimeline(inc, "postmortem", postmortem); }

  await saveIncidents(incidents);
  return inc;
}

/**
 * Get incident summary for dashboard
 */
export async function getIncidentSummary() {
  const incidents = await loadIncidents();
  const now = Date.now();

  const open = incidents.filter((i) => !["RESOLVED", "CLOSED"].includes(i.status));
  const critical = open.filter((i) => i.severity === "critical");
  const high = open.filter((i) => i.severity === "high");

  // MTTR (Mean Time To Resolve) for resolved incidents in last 7 days
  const weekAgo = now - 7 * 86400000;
  const recentlyResolved = incidents.filter(
    (i) => i.resolved_at && new Date(i.resolved_at).getTime() > weekAgo,
  );
  const mttr = recentlyResolved.length > 0
    ? recentlyResolved.reduce((sum, i) => {
        const detected = new Date(i.detected_at).getTime();
        const resolved = new Date(i.resolved_at).getTime();
        return sum + (resolved - detected);
      }, 0) / recentlyResolved.length / 60000
    : 0;

  return {
    total: incidents.length,
    open: open.length,
    critical: critical.length,
    high: high.length,
    detected: open.filter((i) => i.status === "DETECTED").length,
    assigned: open.filter((i) => i.status === "ASSIGNED").length,
    diagnosing: open.filter((i) => i.status === "DIAGNOSING").length,
    mitigating: open.filter((i) => i.status === "MITIGATING").length,
    verifying: open.filter((i) => i.status === "VERIFYING").length,
    resolved_7d: recentlyResolved.length,
    mttr_minutes: Math.round(mttr),
    recent: incidents.slice(0, 20),
  };
}

// ─── Incident Recovery Worker (roster #35) ─────────────────────
// REAL JOB: auto-resolve open incidents whose underlying metric has
// recovered to healthy levels — the same real threshold mapping the
// incident cron's auto-resolve pass uses, now registry-enrolled — then
// verify by an INDEPENDENT re-read (a second fresh loadIncidents, never
// the writer's in-memory copy). Zero-arg (the cron loop calls the
// registry run with no arguments). A read failure is reported as a
// failure; an unknown metric is never treated as recovered.
const RECOVERY_ACTOR = "worker:incident-recovery";

export async function runIncidentRecovery({ nowMs = Date.now() } = {}) {
  // 1. Real reads: the stored system metrics + the incident ledger.
  let m = {};
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "system_metrics")
      .maybeSingle();
    m = data?.value || {};
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
  const incidents = await loadIncidents();
  const open = incidents.filter(
    (i) => i.status && ["DETECTED", "ASSIGNED", "DIAGNOSING"].includes(i.status),
  );

  // 2. Decide: which open incidents' metrics sit below the warn line?
  //    A missing metric (unknown) never counts as recovered.
  const recovered = [];
  for (const inc of open) {
    let isRecovered = false;
    if (inc.affected_service === "api") {
      if (
        String(inc.title).includes("error rate") &&
        typeof m.error_rate === "number" &&
        m.error_rate < HEALTH_THRESHOLDS.api_error_rate.warn
      )
        isRecovered = true;
      if (
        String(inc.title).includes("latency") &&
        typeof m.api_p95_ms === "number" &&
        m.api_p95_ms < HEALTH_THRESHOLDS.api_p95_ms.warn
      )
        isRecovered = true;
    }
    if (
      inc.affected_service === "cache" &&
      typeof m.cache_hit_rate === "number" &&
      m.cache_hit_rate > HEALTH_THRESHOLDS.cache_hit_rate.warn
    )
      isRecovered = true;
    if (
      inc.affected_service === "workforce" &&
      typeof m.worker_fail_rate === "number" &&
      m.worker_fail_rate < HEALTH_THRESHOLDS.worker_fail_rate.warn
    )
      isRecovered = true;
    if (isRecovered) recovered.push(inc);
  }

  // 3. Honest no-op: no open incident has recovered metrics yet — no
  //    write, no fabricated resolution.
  if (recovered.length === 0)
    return {
      ok: true,
      verified: true,
      checked: open.length,
      recovered: [],
      note: "no open incident has recovered metrics yet - nothing to resolve",
    };

  // 4. Real action: resolve each recovered incident (same mutation +
  //    single-save pattern as the cron's auto-resolve pass).
  const now = new Date(nowMs).toISOString();
  for (const inc of recovered) {
    inc.status = "RESOLVED";
    inc.resolved_at = now;
    inc.verification = "Auto-resolved: metrics recovered to healthy levels";
    addTimeline(inc, "auto_resolved", `Metrics recovered — incident auto-resolved (${RECOVERY_ACTOR})`);
  }
  await saveIncidents(incidents);

  // 5. Independent verification: a FRESH re-read, not the writer's copy,
  //    must show each recovered incident RESOLVED with its timeline entry.
  const reread = await loadIncidents();
  const checks = recovered.map((inc) => {
    const seen = reread.find((x) => x.id === inc.id);
    return {
      incident_id: inc.id,
      pass: Boolean(
        seen &&
          seen.status === "RESOLVED" &&
          seen.resolved_at &&
          (seen.timeline || []).some((t) => t && t.event === "auto_resolved"),
      ),
    };
  });
  const verified = checks.every((c) => c.pass);

  // 6. Advisory row (best-effort, evidenced).
  try {
    await supabase.from("activity_logs").insert({
      actor: RECOVERY_ACTOR,
      action: "incident_auto_resolved",
      detail: JSON.stringify({
        resolved: recovered.length,
        ids: recovered.map((i) => i.id).slice(0, 10),
      }).slice(0, 500),
    });
  } catch {
    /* advisory; a failed log must not fabricate evidence */
  }

  return {
    ok: true,
    verified,
    checked: open.length,
    recovered: recovered.map((i) => i.id),
    checks,
  };
}

/**
 * HTTP handler for incident API
 */
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // GET — summary or individual incident
    if (req.method === "GET") {
      // FIX #3 (AUDIT): every GET branch below (detect/summary/list/detail)
      // exposes operational incident data — admin-only as a single gate.
      if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });

      const { action, id } = req.query;

      if (action === "detect") {
        // Trigger detection scan
        const newIncidents = await detectIncidents();
        return res.status(200).json({ detected: newIncidents.length, incidents: newIncidents });
      }

      if (action === "summary") {
        const summary = await getIncidentSummary();
        return res.status(200).json(summary);
      }

      if (id) {
        const incidents = await loadIncidents();
        const inc = incidents.find((i) => i.id === id);
        return inc
          ? res.status(200).json(inc)
          : res.status(404).json({ error: "Incident not found" });
      }

      // Default: return all incidents
      const incidents = await loadIncidents();
      return res.status(200).json({ incidents, total: incidents.length });
    }

    // POST — create, assign, update, correlate
    if (req.method === "POST") {
      const b = req.body || {};

      if (b.action === "create") {
        if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });
        const inc = await createIncident({
          severity: b.severity,
          title: b.title,
          description: b.description,
          affected_service: b.affected_service,
          source: "admin",
        });
        return res.status(201).json(inc || { message: "Duplicate suppressed" });
      }

      if (b.action === "assign") {
        if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });
        const result = await assignIncident(b.incident_id, b.worker_id, b.task);
        return res.status(200).json(result);
      }

      if (b.action === "update") {
        if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });
        const result = await updateIncident(b.incident_id, {
          status: b.status,
          root_cause: b.root_cause,
          mitigation: b.mitigation,
          verification: b.verification,
          postmortem: b.postmortem,
        });
        return res.status(200).json(result);
      }

      if (b.action === "correlate") {
        // FIX #3 (AUDIT): correlation scans event streams — admin-only like assign/update.
        if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });
        const result = await correlateEvent(b.event_type, b.event_data || {});
        return res.status(200).json({ correlated: true });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sanitizeError(res, err, "incidents");
  }
}
