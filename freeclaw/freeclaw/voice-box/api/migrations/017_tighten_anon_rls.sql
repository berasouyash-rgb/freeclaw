-- 017_tighten_anon_rls.sql
-- Closes the over-broad anon SELECTs that migration 006 opened.
--
-- What 006 did: anon_select_all USING (true) on 8 tables (posts, comments,
-- reactions, polls, poll_votes, reports, chat_messages, chat_threads).
-- What the client actually needs (src/lib/realtimeContract.json, enforced by
-- useRealtime.ts): anon SELECT on posts, comments, polls ONLY — and only
-- public rows. The browser client performs zero direct reads (realtime
-- channels only); every data read goes through the API with service_role.
--
-- Live audit (2026-09-28, production) found anon could directly read:
--   * private / pending_review / deleted posts (visibility + status ignored)
--   * ALL reports (reporter anon IDs + reasons)
--   * ALL chat_threads + chat_messages (private student conversations)
--   * ALL poll_votes (voter ID per vote)
--   * comments on non-public posts
-- None of these tables is in the realtime allowlist, so the grants served
-- no realtime purpose — pure exposure surface.
--
-- This migration:
--   1. Drops anon SELECT on reactions, poll_votes, reports, chat_messages,
--      chat_threads and revokes the grants (admin/user reads stay API-only).
--   2. Replaces the USING (true) policies on posts/comments/polls with the
--      exact public-row predicates from realtimeContract.json, so the DB and
--      the client contract finally agree.
--   3. Guards: anon keeps zero writes anywhere; the five sensitive tables
--      keep zero anon policies; the three public tables keep predicate
--      policies (never a bare USING (true)).
--
-- Safe to re-run: every statement is idempotent.

-- 1. Sensitive tables: drop anon read policies + revoke grants
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reactions', 'poll_votes', 'reports', 'chat_messages', 'chat_threads'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS anon_select_all ON public.%I', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
  END LOOP;
END $$;

-- 2. Public tables: predicate policies (drop the USING (true) variant first)
DROP POLICY IF EXISTS anon_select_all ON public.posts;
CREATE POLICY anon_select_all ON public.posts FOR SELECT TO anon
  USING (deleted = false AND hidden = false AND COALESCE(visibility, 'public') = 'public' AND status <> 'pending_review');

DROP POLICY IF EXISTS anon_select_all ON public.comments;
CREATE POLICY anon_select_all ON public.comments FOR SELECT TO anon
  USING (deleted = false AND hidden = false AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = comments.post_id
      AND p.deleted = false AND p.hidden = false
      AND COALESCE(p.visibility, 'public') = 'public'
      AND p.status <> 'pending_review'
  ));

DROP POLICY IF EXISTS anon_select_all ON public.polls;
CREATE POLICY anon_select_all ON public.polls FOR SELECT TO anon
  USING (deleted = false);

-- Grants stay (realtime needs them); ensure USAGE too.
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON TABLE public.posts TO anon;
GRANT SELECT ON TABLE public.comments TO anon;
GRANT SELECT ON TABLE public.polls TO anon;

-- 3. Guards
DO $$
BEGIN
  -- anon must never hold writes anywhere
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_schema = 'public'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'anon must never hold write privileges on public tables';
  END IF;

  -- sensitive tables must have zero anon policies left
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('reactions', 'poll_votes', 'reports', 'chat_messages', 'chat_threads')
      AND 'anon' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'sensitive tables still expose anon policies';
  END IF;

  -- public tables must carry predicates, never bare USING (true)
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('posts', 'comments', 'polls')
      AND policyname = 'anon_select_all'
      AND (qual = 'true' OR qual IS NULL)
  ) THEN
    RAISE EXCEPTION 'public tables must keep predicate policies, not USING (true)';
  END IF;
END $$;
