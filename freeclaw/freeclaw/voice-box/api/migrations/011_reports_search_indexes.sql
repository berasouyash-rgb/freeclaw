-- ═══════════════════════════════════════════════════════════════
-- 011 — Reports + search hot-path indexes
-- ═══════════════════════════════════════════════════════════════
-- Gap analysis (from 009 audit + load test):
--   1. reports: GET /api/reports orders by created_at DESC but has
--      no index → sequential scan of entire table on every load.
--   2. reports: enforceStrike queries by (target_id, target_type,
--      created_at >= now) with no matching composite index.
--   3. reports: user_detail + admin user list filter by author_id
--      with no index.
--   4. posts: search adds eq("status") on top of the 009
--      (deleted, hidden, created_at) index — a composite covering
--      (deleted, status, created_at DESC) avoids a secondary filter.
--   5. polls: search fetches eq("deleted") ordered by created_at
--      with no matching index.
-- ═══════════════════════════════════════════════════════════════

-- ── Reports ─────────────────────────────────────────────────
-- Admin report list: .order("created_at", {ascending:false}).limit(300)
CREATE INDEX IF NOT EXISTS reports_created_at_desc_idx
  ON reports (created_at DESC);

-- enforceStrike: .eq("target_id",..).eq("target_type",..).gte("created_at",..)
CREATE INDEX IF NOT EXISTS reports_target_type_created_idx
  ON reports (target_id, target_type, created_at DESC);

-- user_detail / admin user list: .eq("author_id",..)
CREATE INDEX IF NOT EXISTS reports_author_idx
  ON reports (author_id);

-- ── Posts — search hot path ──────────────────────────────────
-- search: .eq("deleted",false).eq("status",X).order("created_at",DESC)
-- The existing posts_feed_idx covers (deleted, hidden, created_at)
-- but adding status avoids a secondary filter when status != "all".
CREATE INDEX IF NOT EXISTS posts_deleted_status_created_idx
  ON posts (deleted, status, created_at DESC);

-- ── Polls — search hot path ──────────────────────────────────
-- search: .eq("deleted",false).order("created_at",DESC).limit(1000)
CREATE INDEX IF NOT EXISTS polls_deleted_created_idx
  ON polls (deleted, created_at DESC);

-- ── Notifications via settings table ─────────────────────────
-- Notifications are stored in settings(key="notifications:anon_xxx")
-- and read by key lookup — the unique index on key already covers this.
-- No additional index needed.
