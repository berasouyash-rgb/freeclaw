-- ============================================================
-- 013_search_indexes.sql
-- Performance indexes for the search API
--
-- Problem: posts search fetched ALL 2000 rows and filtered in JS.
-- Now uses DB-level ilike, but needs indexes to be fast.
--
-- Strategy:
--   1. Enable pg_trgm for trigram-based LIKE/ILIKE acceleration
--   2. GIN trigram indexes on text columns (title, description, body, etc.)
--   3. Composite B-tree indexes for filtered queries (deleted+hidden+created_at)
-- ============================================================

-- Enable pg_trgm extension (required for GIN trigram indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- POSTS — search query: deleted=false, hidden=false, ilike on title/description/id
-- ============================================================

-- Composite index for the base filter + sort (used by every search query)
-- Covers: WHERE deleted = false AND hidden = false ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_posts_search_base
  ON posts (deleted, hidden, created_at DESC)
  WHERE deleted = false AND hidden = false;

-- GIN trigram indexes for text search (ilike '%query%')
-- These make ilike queries 10-100x faster on large tables
CREATE INDEX IF NOT EXISTS idx_posts_title_trgm
  ON posts USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_posts_description_trgm
  ON posts USING GIN (description gin_trgm_ops);

-- For exact/partial ID matching (post_abc123)
CREATE INDEX IF NOT EXISTS idx_posts_id_trgm
  ON posts USING GIN (id gin_trgm_ops);

-- Composite filtered indexes for status/category/priority filters
CREATE INDEX IF NOT EXISTS idx_posts_search_status
  ON posts (deleted, hidden, status, created_at DESC)
  WHERE deleted = false AND hidden = false;

CREATE INDEX IF NOT EXISTS idx_posts_search_category
  ON posts (deleted, hidden, category, created_at DESC)
  WHERE deleted = false AND hidden = false;

-- ============================================================
-- COMMENTS — search query: deleted=false, hidden=false, ilike on body
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_comments_search_base
  ON comments (deleted, hidden, created_at DESC)
  WHERE deleted = false AND hidden = false;

CREATE INDEX IF NOT EXISTS idx_comments_body_trgm
  ON comments USING GIN (body gin_trgm_ops);

-- ============================================================
-- POLLS — search query: deleted=false, ilike on title
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_polls_search_base
  ON polls (deleted, created_at DESC)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_polls_title_trgm
  ON polls USING GIN (title gin_trgm_ops);

-- ============================================================
-- USERS — search query: ilike on anon_id
-- ============================================================

-- Existing: idx_users_meta_anon_id (B-tree, exact match)
-- Add trigram for partial matching
CREATE INDEX IF NOT EXISTS idx_users_meta_anon_id_trgm
  ON users_meta USING GIN (anon_id gin_trgm_ops);

-- Composite for search + sort
CREATE INDEX IF NOT EXISTS idx_users_meta_search
  ON users_meta (created_at DESC);
