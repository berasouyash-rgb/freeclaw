-- Voice Box — Add pending_review to posts status constraint
-- ----------------------------------------------------------------------------
-- The app routes AI-moderated / flagged submissions through a review hold:
-- api/_posts.js POST sets status = 'pending_review' when needsReview is true or
-- the client passes pending_review: true (src/pages/Submit.tsx). The base posts
-- table's status CHECK constraint predates that value, so inserts of held posts
-- fail at runtime with:
--
--   new row for relation "posts" violates check constraint "posts_status_check"
--
-- This recreates the constraint with the full set of statuses the app actually
-- uses (source of truth: api/_posts.js STATUSES constant).
--
-- Idempotent: DROP IF EXISTS + ADD makes it safe to run more than once.

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;

ALTER TABLE posts ADD CONSTRAINT posts_status_check CHECK (
  status IN ('reported', 'verified', 'in_progress', 'waiting', 'solved', 'archived', 'pending_review')
);
