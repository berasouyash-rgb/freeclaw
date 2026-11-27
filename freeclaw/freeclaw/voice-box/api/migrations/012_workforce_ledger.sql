-- ═══════════════════════════════════════════════════════════════
-- 012 — WORKFORCE ACTION LEDGER + INCIDENTS + REAL METRICS
-- Adds the tables needed for the Python workforce to record
-- real actions, incidents, and before/after measurements.
-- ═══════════════════════════════════════════════════════════════

-- ─── workforce_actions — the source of truth for every operation ──
CREATE TABLE IF NOT EXISTS workforce_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id     text NOT NULL,
  action_type   text NOT NULL,        -- optimize_cache, quarantine_content, detect_spam, etc.
  target_type   text NOT NULL,        -- post, cache, database, api, etc.
  target_id     text NOT NULL,        -- specific resource identifier
  event_id      text,                 -- originating event for traceability

  -- Before/after measurement (THE critical proof)
  before_metrics jsonb DEFAULT '{}',
  after_metrics  jsonb DEFAULT '{}',
  delta_pct     numeric,              -- auto-calculated improvement/degradation

  -- Execution details
  tool_used     text,
  input_evidence jsonb DEFAULT '{}',
  decision      text,                 -- human-readable decision summary
  execution_result jsonb DEFAULT '{}',
  execution_status text NOT NULL DEFAULT 'pending', -- pending|success|failed|rolled_back

  -- Verification
  verification_status text DEFAULT 'none', -- none|passed|failed|pending
  verification_result jsonb DEFAULT '{}',

  -- Risk & rollback
  risk_level    text DEFAULT 'low',
  rollback_available boolean DEFAULT false,
  rollback_reference text,
  rollback_data jsonb,

  -- Error tracking
  error         text,

  -- Timestamps
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  duration_ms   numeric,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_actions_worker ON workforce_actions(worker_id);
CREATE INDEX IF NOT EXISTS idx_workforce_actions_target ON workforce_actions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_workforce_actions_status ON workforce_actions(execution_status);
CREATE INDEX IF NOT EXISTS idx_workforce_actions_started ON workforce_actions(started_at DESC);

-- ─── workforce_incidents — correlated multi-signal incidents ──────
CREATE TABLE IF NOT EXISTS workforce_incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  severity      text NOT NULL DEFAULT 'info', -- info|warning|high|critical
  status        text NOT NULL DEFAULT 'open', -- open|investigating|resolved|closed
  source_worker text,
  source_event  text,

  -- Evidence
  evidence      jsonb DEFAULT '[]',     -- array of evidence items
  affected_resources jsonb DEFAULT '[]',

  -- Resolution
  resolution    text,
  resolved_at   timestamptz,
  resolved_by   text,                    -- agent_id or 'admin'

  -- Alerting
  alert_sent    boolean DEFAULT false,
  alerted_at    timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_incidents_status ON workforce_incidents(status);
CREATE INDEX IF NOT EXISTS idx_workforce_incidents_severity ON workforce_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_workforce_incidents_created ON workforce_incidents(created_at DESC);

-- ─── workforce_alerts — deduplicated admin notifications ─────────
CREATE TABLE IF NOT EXISTS workforce_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity      text NOT NULL DEFAULT 'info', -- info|warning|high|critical
  title         text NOT NULL,
  body          text,
  source_worker text,
  source_event  text,
  category      text,                   -- security|moderation|performance|system|availability

  -- Deduplication
  dedup_key     text,                   -- unique key to prevent alert storms
  occurrences   int DEFAULT 1,
  first_seen    timestamptz DEFAULT now(),
  last_seen     timestamptz DEFAULT now(),

  -- Lifecycle
  status        text NOT NULL DEFAULT 'active', -- active|acknowledged|resolved|dismissed
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_at   timestamptz,

  -- Related data
  incident_id   uuid REFERENCES workforce_incidents(id),
  action_id     uuid REFERENCES workforce_actions(id),
  evidence      jsonb DEFAULT '{}',

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_alerts_status ON workforce_alerts(status);
CREATE INDEX IF NOT EXISTS idx_workforce_alerts_severity ON workforce_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_workforce_alerts_dedup ON workforce_alerts(dedup_key);
CREATE INDEX IF NOT EXISTS idx_workforce_alerts_created ON workforce_alerts(created_at DESC);

-- ─── workforce_heartbeats — worker liveness tracking ─────────────
CREATE TABLE IF NOT EXISTS workforce_heartbeats (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id     text NOT NULL,
  instance_id   text,                   -- specific process instance
  status        text NOT NULL DEFAULT 'active', -- active|idle|working|degraded|offline
  current_task  text,
  queue_depth   int DEFAULT 0,
  version       text DEFAULT '1.0.0',
  metrics       jsonb DEFAULT '{}',     -- lightweight per-heartbeat metrics
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_heartbeats_worker ON workforce_heartbeats(worker_id);
CREATE INDEX IF NOT EXISTS idx_workforce_heartbeats_recorded ON workforce_heartbeats(recorded_at DESC);

-- ─── RLS policies ────────────────────────────────────────────────
ALTER TABLE workforce_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON workforce_actions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON workforce_incidents FOR ALL USING (true);
CREATE POLICY "Service role full access" ON workforce_alerts FOR ALL USING (true);
CREATE POLICY "Service role full access" ON workforce_heartbeats FOR ALL USING (true);

-- ─── Retention: auto-cleanup old heartbeats (keep 7 days) ────────
-- This runs via pg_cron or application-level cleanup
-- SELECT cleanup_old_heartbeats(); — keep last 7 days only
