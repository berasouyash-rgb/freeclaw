-- 023_comment_lock_enforcement.sql
--
-- WHY: locking a post (comments off) only blocked FUTURE comments at the API
-- layer; pre-existing comments stayed visible (live scan 2026-10-09: locked
-- post post_muz8kji3jog84i "testing patgform 123" still showing 1 visible
-- comment). And the API 403 is bypassable by anything holding the service
-- key — the database itself must refuse inserts on locked posts.
--
-- WHAT:
--   1. BEFORE INSERT trigger on comments: refuse rows whose parent post is
--      locked. Official admin messages (is_admin) are exempt — same rule as
--      the API (api/_comments.js lets is_admin_msg through the lock check).
--   2. One-shot purge: soft-delete every visible comment sitting on a
--      locked post (deleted = true: recoverable, audit-preserving, matches
--      the app convention that soft-deleted rows never self-show).
--
-- SAFETY (human gate — do NOT apply without DBA approval):
--   * Touches ONLY the comments table (+ reads posts.locked). No other
--     app's tables are referenced; the shared cricket-app tables are
--     untouched.
--   * Fail closed: aborts unless posts.locked, comments.deleted and
--     comments.is_admin all exist.
--   * Idempotent: CREATE OR REPLACE trigger/function; the purge matches
--     only visible rows, so re-running changes nothing.
--   * Rollback: snapshot visible comment ids BEFORE applying
--       SELECT id FROM comments WHERE deleted IS NOT TRUE;  -- keep output
--     then un-delete exactly those ids if the purge must be undone:
--       UPDATE comments SET deleted = false WHERE id IN (...snapshot...);
--     and DROP TRIGGER comments_refuse_locked_post ON public.comments;

-- 0. Fail closed without the columns this enforcement depends on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'locked'
  ) THEN
    RAISE EXCEPTION '023 requires posts.locked — apply the posts migration first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'deleted'
  ) THEN
    RAISE EXCEPTION '023 requires comments.deleted — apply the comments migration first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'is_admin'
  ) THEN
    RAISE EXCEPTION '023 requires comments.is_admin — apply the comments migration first';
  END IF;
END $$;

-- 1. Insert gate: a locked post takes no new discussion. Plain users are
-- refused; official admin messages keep the exemption the API grants.
CREATE OR REPLACE FUNCTION public.comments_refuse_locked_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  parent_locked boolean;
BEGIN
  IF NEW.is_admin IS TRUE THEN
    RETURN NEW;
  END IF;
  SELECT p.locked INTO parent_locked
  FROM public.posts p
  WHERE p.id = NEW.post_id;
  -- Missing parent: leave that verdict to the API/FK layer; the trigger
  -- only enforces the lock, never invents a new rejection.
  IF parent_locked IS TRUE THEN
    RAISE EXCEPTION 'comments_locked_on_post:%', NEW.post_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS comments_refuse_locked_post ON public.comments;
CREATE TRIGGER comments_refuse_locked_post
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.comments_refuse_locked_post();

-- 2. One-shot purge: every visible comment on a locked post is a stray.
-- NULL-safe (deleted IS NOT TRUE catches legacy NULL rows too).
UPDATE public.comments c
SET deleted = true
FROM public.posts p
WHERE c.post_id = p.id
  AND p.locked IS TRUE
  AND c.deleted IS NOT TRUE;

-- 3. Prove it: no visible comment may remain on a locked post.
DO $$
DECLARE
  strays integer;
BEGIN
  SELECT COUNT(*) INTO strays
  FROM public.comments c
  JOIN public.posts p ON p.id = c.post_id
  WHERE p.locked IS TRUE
    AND c.deleted IS NOT TRUE
    AND c.hidden IS NOT TRUE;
  IF strays > 0 THEN
    RAISE EXCEPTION '023 post-check failed: % visible comment(s) still sit on locked posts', strays;
  END IF;
END $$;
