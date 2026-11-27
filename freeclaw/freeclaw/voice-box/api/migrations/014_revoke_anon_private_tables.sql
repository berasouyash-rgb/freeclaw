-- 014 — Revoke public (anon) read access to private / identity-bearing tables
--
-- WHY
-- Migration 006 granted anon SELECT on posts, comments, reactions, polls,
-- poll_votes, reports, chat_messages and chat_threads so that Postgres-Changes
-- realtime would authorise for the browser client. But that grant is readable by
-- ANYONE holding the anon key — and the anon key ships inside the client
-- bundle. Verified against the live database with that exact key:
--
--   reports        29 rows  → target_id, reason, author_id   (who reported whom)
--   chat_messages  31 rows  → sender, body, attachment_url   (private messages)
--   chat_threads   33 rows  → private thread list
--   poll_votes     45 rows  → author_id + choices            (de-anonymises votes)
--   reactions      39 rows  → author_id                      (behavioural linkage)
--
-- On an anonymous feedback platform that is a de-anonymisation breach: a reader
-- can enumerate private inbox content, see who reported whom, and learn how
-- every pseudonymous user voted. These five tables return to deny-by-default.
--
-- WHY THIS IS SAFE
-- src/lib/useRealtime.ts already degrades to its 10s polling fallback for any
-- table outside the realtime/RLS allowlist ("admin-only tables — polling-only
-- from the start"), and every subscriber of these five tables is an admin
-- surface (Reports, AdminLeaderboard, PollManager, ActivityStream) whose data is
-- served by /api/* with the service role. posts, comments and polls are
-- genuinely public content and keep their grants.
--
-- anon was never granted INSERT/UPDATE/DELETE; that is unchanged.
-- Idempotent: safe to run repeatedly.

DO $$
DECLARE
  t TEXT;
  pol TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reports', 'chat_messages', 'chat_threads', 'poll_votes', 'reactions'
  ]
  LOOP
    -- 1) Drop every policy that grants the anon role on this table. Matched by
    --    role rather than by name so this does not depend on how 006 named it.
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND roles::text LIKE '%anon%'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    END LOOP;

    -- 2) Revoke the table-level grant itself.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    -- 3) Leave the realtime publication. Without SELECT the anon role can never
    --    authorise a subscription, so membership only wastes CDC work.
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Prove the fix is in place: every one of these must report 0 anon grants.
-- (Run manually after applying; the anonymity-guard worker asserts the same
-- thing continuously against the live API.)
--   SELECT tablename, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'anon' AND table_schema = 'public'
--     AND tablename IN ('reports','chat_messages','chat_threads','poll_votes','reactions');
