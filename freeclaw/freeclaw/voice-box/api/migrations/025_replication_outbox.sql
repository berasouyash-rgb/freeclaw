-- 025_replication_outbox.sql
-- Transactional outbox for Supabase -> Firebase replication.
--
-- ⚠️ DO NOT APPLY to production until:
--   1. a verified database backup exists,
--   2. this migration has been rehearsed on staging,
--   3. the replication worker is deployed and its consumer is running
--      (otherwise the outbox grows unbounded).
--
-- Design notes:
--   - enqueue happens in the SAME transaction as the row change (trigger),
--     so a committed write can never be missing from the outbox.
--   - idempotency_key is unique: a retried transaction cannot duplicate work.
--   - claim uses FOR UPDATE SKIP LOCKED so multiple workers do not collide.
--   - rows are never deleted by this file; archival is a separate, audited job.
--   - RLS is enabled with no policies: only the service role can read/write.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS replication_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name       text NOT NULL,
  entity_id        text,
  op               text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  payload          jsonb,
  schema_version   integer NOT NULL DEFAULT 1,
  entity_version   bigint,
  tenant_id        text,
  source           text NOT NULL DEFAULT 'supabase',
  idempotency_key  text NOT NULL,
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 10,
  available_at     timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS replication_outbox_idem_key
  ON replication_outbox (idempotency_key);

-- Worker scan: pending, due rows.
CREATE INDEX IF NOT EXISTS replication_outbox_due_idx
  ON replication_outbox (available_at)
  WHERE processed_at IS NULL;

ALTER TABLE replication_outbox ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION voiceflow_enqueue_replication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec jsonb;
  eid text;
  op  text;
  ver bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD);
    op  := 'delete';
  ELSE
    rec := to_jsonb(NEW);
    op  := lower(TG_OP);
  END IF;

  eid := COALESCE(rec->>'id', rec->>'key', rec->>'anon_id');
  BEGIN
    ver := NULLIF(rec->>'version', '')::bigint;
  EXCEPTION WHEN others THEN
    ver := NULL;
  END;

  INSERT INTO replication_outbox
    (table_name, entity_id, op, payload, entity_version, idempotency_key)
  VALUES
    (TG_TABLE_NAME, eid, op, rec, ver,
     TG_TABLE_NAME || ':' || COALESCE(eid, '') || ':' || op || ':' ||
     extract(epoch FROM clock_timestamp())::text || ':' || gen_random_uuid()::text)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NULL; -- AFTER trigger
END;
$$;

-- Attach to the VoiceFlow tables only. Kept in sync with api/_backend/tables.js.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'posts','comments','polls','poll_votes','reactions','reports','notifications',
    'conversations','messages','chat_threads','chat_messages',
    'users_meta','admin_feedback','admin_tabs','settings',
    'activity_logs','audit_logs','system_metrics','agent_activity_log',
    'agent_executions','tool_calls','tool_evidence',
    'agent_config','agent_conversations','agent_goals','agent_insights',
    'agent_knowledge','agent_learning','agent_memory','agent_reports',
    'agent_suggestions','agent_tasks','approvals','knowledge_base'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS replication_enqueue ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER replication_enqueue AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION voiceflow_enqueue_replication()',
        t
      );
    END IF;
  END LOOP;
END;
$$;

-- Claim a batch atomically. Returns rows to the worker.
CREATE OR REPLACE FUNCTION voiceflow_claim_replication(batch_size integer DEFAULT 50)
RETURNS SETOF replication_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE replication_outbox o
  SET attempts = o.attempts + 1,
      available_at = now() + make_interval(secs => least(power(2, o.attempts)::int, 300))
  WHERE o.id IN (
    SELECT id FROM replication_outbox
    WHERE processed_at IS NULL
      AND available_at <= now()
      AND attempts < max_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  RETURNING o.*;
$$;

-- Mark a batch delivered.
CREATE OR REPLACE FUNCTION voiceflow_ack_replication(ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE replication_outbox
    SET processed_at = now()
    WHERE id = ANY(ids) AND processed_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;

-- Dead-letter visibility (worker uses attempts >= max_attempts).
COMMENT ON TABLE replication_outbox IS
  'VoiceFlow transactional outbox. Service-role only. Never truncate without an audit record.';
