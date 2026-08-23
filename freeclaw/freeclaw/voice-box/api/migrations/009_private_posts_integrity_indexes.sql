-- ═══════════════════════════════════════════════════════════════
-- 009 — Private posts + vote/reaction integrity + hot-path indexes
-- ═══════════════════════════════════════════════════════════════
-- 1. posts.visibility: 'public' | 'private'. Private posts are visible
--    ONLY to their author and verified admins (enforced in api/_posts.js
--    and api/_comments.js).
-- 2. Integrity: unique constraints that make double-voting impossible at
--    the DATABASE level, not just application level.
-- 3. Performance: indexes matching the API's hottest query shapes.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_visibility_check'
  ) THEN
    ALTER TABLE posts ADD CONSTRAINT posts_visibility_check
      CHECK (visibility IN ('public', 'private'));
  END IF;
END $$;

-- Dedupe historical duplicates BEFORE adding unique constraints (keep lowest id).
DELETE FROM poll_votes a USING poll_votes b
  WHERE a.poll_id = b.poll_id AND a.author_id = b.author_id AND a.id > b.id;
DELETE FROM reactions a USING reactions b
  WHERE a.target_id = b.target_id AND a.author_id = b.author_id
    AND a.kind = b.kind AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_poll_author_uidx
  ON poll_votes (poll_id, author_id);
CREATE UNIQUE INDEX IF NOT EXISTS reactions_target_author_kind_uidx
  ON reactions (target_id, author_id, kind);

CREATE INDEX IF NOT EXISTS posts_feed_idx
  ON posts (created_at DESC)
  WHERE deleted = false AND hidden = false;
CREATE INDEX IF NOT EXISTS posts_author_created_idx
  ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_post_created_idx
  ON comments (post_id, created_at DESC)
  WHERE deleted = false AND hidden = false;
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments (author_id);
CREATE INDEX IF NOT EXISTS reactions_target_idx ON reactions (target_id);
CREATE INDEX IF NOT EXISTS reactions_author_idx ON reactions (author_id);
CREATE INDEX IF NOT EXISTS poll_votes_poll_idx ON poll_votes (poll_id);
CREATE INDEX IF NOT EXISTS activity_logs_created_idx
  ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS users_meta_last_seen_idx ON users_meta (last_seen DESC);
CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx
  ON chat_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS posts_visibility_idx ON posts (visibility)
  WHERE visibility = 'private';
