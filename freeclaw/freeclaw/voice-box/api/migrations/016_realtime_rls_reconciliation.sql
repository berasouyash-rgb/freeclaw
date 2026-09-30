-- 016_realtime_rls_reconciliation.sql
-- Reconcile anonymous Realtime and RLS with the public three-table contract.
-- This forward migration is staging-only until the human migration gate passes.
-- It removes old publication members, denies client writes, and creates exact
-- public-row predicates for posts, comments, and polls.

BEGIN;

-- Remove every non-contract table from the publication. Service-role/API
-- consumers do not need anonymous CDC for private or administrative tables.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename NOT IN ('posts', 'comments', 'polls')
  LOOP
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS %I.%I',
      r.schemaname,
      r.tablename
    );
  END LOOP;
END $$;

-- Add the three contract tables only when they are not already members.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['posts', 'comments', 'polls']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Start from deny-by-default for client table access, then grant only the
-- public SELECT needed by the Realtime contract.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON TABLE public.posts, public.comments, public.polls
  FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON TABLE public.posts, public.comments, public.polls
  TO anon, authenticated;

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

-- Replace any older broad policy on the three public tables. The API uses the
-- service role, so no client INSERT/UPDATE/DELETE policy is introduced.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('posts', 'comments', 'polls')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

CREATE POLICY anon_select_public_posts
  ON public.posts
  FOR SELECT
  TO anon
  USING (
    deleted = false
    AND hidden = false
    AND COALESCE(visibility, 'public') = 'public'
    AND status <> 'pending_review'
  );

CREATE POLICY anon_select_public_comments
  ON public.comments
  FOR SELECT
  TO anon
  USING (
    deleted = false
    AND hidden = false
    AND EXISTS (
      SELECT 1
      FROM public.posts p
      WHERE p.id = comments.post_id
        AND p.deleted = false
        AND p.hidden = false
        AND COALESCE(p.visibility, 'public') = 'public'
        AND p.status <> 'pending_review'
    )
  );

CREATE POLICY anon_select_public_polls
  ON public.polls
  FOR SELECT
  TO anon
  USING (deleted = false);

-- Fail closed if a future edit accidentally grants a client write privilege.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE grantee IN ('anon', 'authenticated')
      AND table_schema = 'public'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) THEN
    RAISE EXCEPTION 'anon/authenticated must not hold public table write privileges';
  END IF;
END $$;

-- Fail closed if the publication ever drifts away from the exact contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename NOT IN ('posts', 'comments', 'polls')
  ) OR (
    SELECT COUNT(*)
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN ('posts', 'comments', 'polls')
  ) <> 3 THEN
    RAISE EXCEPTION 'supabase_realtime publication must contain exactly posts, comments, and polls';
  END IF;
END $$;

COMMIT;

-- Rollback guidance (staging/manual only):
-- REVOKE SELECT ON TABLE public.posts, public.comments, public.polls FROM anon, authenticated;
-- DROP POLICY IF EXISTS anon_select_public_posts ON public.posts;
-- DROP POLICY IF EXISTS anon_select_public_comments ON public.comments;
-- DROP POLICY IF EXISTS anon_select_public_polls ON public.polls;
-- ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.posts, public.comments, public.polls;
-- Never restore migration 006's broad eight-table publication or USING(true) policies.
