-- Voice Box — Reports moderation table + users_meta strike columns
-- ----------------------------------------------------------------------------
-- The app's report flow (api/_reports.js) inserts into a `reports` table and
-- auto-enforces community strikes on `users_meta`. No migration in this repo
-- ever created these, so on databases bootstrapped from the base schema the
-- HTTP POST /api/reports fails at runtime with:
--
--   PostgREST error: relation "public.reports" does not exist
--
-- File a report → insert crashes → report UI silently fails (the exact
-- symptom this migration fixes). It also repairs pre-existing reports tables
-- that were hand-built from stale docs (ARCHITECTURE.md once listed column
-- `reported_by` — the code contract is `author_id`) by adding any missing
-- columns with ALTER ... IF NOT EXISTS.
--
-- Idempotent: safe to run more than once. No data is dropped.

-- ─── reports ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL DEFAULT 'post',          -- post | comment | poll
  target_id   text NOT NULL,
  reason      text NOT NULL DEFAULT 'No reason given',
  author_id   text NOT NULL,                        -- reporting user (anon_*)
  status      text NOT NULL DEFAULT 'open',        -- open | resolved
  resolved_by text,                                -- admin token id
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Repair an older reports table that predates the code contract.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'post';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_id   text NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reason      text NOT NULL DEFAULT 'No reason given';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS author_id   text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'open';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();

-- Admin list: latest first, bounded scan.
CREATE INDEX IF NOT EXISTS idx_reports_created_at
  ON reports (created_at DESC);

-- Auto-strike dedupe (api/_reports.js): one strike per target per 24h.
-- Query shape: eq target_type + eq target_id + gte created_at.
CREATE INDEX IF NOT EXISTS idx_reports_target_dedupe
  ON reports (target_type, target_id, created_at DESC);

-- ─── users_meta strike/enforcement columns ─────────────────────────────────
-- api/_reports.js enforceStrike() and api/_admin.js depend on these; older
-- databases may only have (anon_id, warnings, last_seen).
ALTER TABLE users_meta ADD COLUMN IF NOT EXISTS strikes        integer      NOT NULL DEFAULT 0;
ALTER TABLE users_meta ADD COLUMN IF NOT EXISTS suspended_until timestamptz;
ALTER TABLE users_meta ADD COLUMN IF NOT EXISTS banned          boolean      NOT NULL DEFAULT false;
ALTER TABLE users_meta ADD COLUMN IF NOT EXISTS notes           text;
ALTER TABLE users_meta ADD COLUMN IF NOT EXISTS updated_at      timestamptz  NOT NULL DEFAULT now();

-- Progressive-enforcement scan: count warnings inside a 7-day window.
CREATE INDEX IF NOT EXISTS idx_users_meta_anon_id ON users_meta (anon_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO anon, authenticated;