-- 006_restore_anon_realtime.sql
-- Restores CLIENT realtime (Postgres Changes over WebSocket) for the
-- user-facing tables only, while keeping migration 005's deny-by-default
-- posture for everything else.
--
-- Context: migration 005 dropped every RLS policy and revoked ALL anon
-- privileges, so the browser client (anon key) can never satisfy Realtime's
-- RLS authorization check. The client silently fell back to a 10s polling
-- loop (src/lib/useRealtime.ts), which looked like "live votes don't count"
-- on prod. Postgres Changes streaming requires BOTH:
--   1. the table in a realtime publication (CDC emits change events), AND
--   2. a permissive anon SELECT policy (the Realtime server filters rows as
--      the subscribing anon role).
--
-- This migration adds exactly the tables the UI subscribes to
-- (src/lib/useRealtime.ts call sites): posts, comments, reactions, polls,
-- poll_votes, reports, chat_messages, chat_threads.
--
-- Deliberately NOT included (keep deny-by-default, admin stays API-only):
--   * settings          — admin password hash, takeover surface
--   * admin_sessions    — admin session tokens
--   * agent_* / activity_logs / users_meta — admin AI surfaces; they keep the
--     built-in 10s polling fallback on their own channels instead of exposing
--     agent internals to the public anon key.
--
-- Writes are untouched: anon still has NO INSERT/UPDATE/DELETE anywhere.
-- All mutations continue to flow through the API with the service-role key.
--
-- Safe to re-run: every statement is idempotent.

-- 1. Real-time publication membership (CDC) — user-facing tables only
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'posts', 'comments', 'reactions', 'polls', 'poll_votes',
    'reports', 'chat_messages', 'chat_threads'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- 2. anon SELECT grants + permissive SELECT policies (idempotent)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'posts', 'comments', 'reactions', 'polls', 'poll_votes',
    'reports', 'chat_messages', 'chat_threads'
  ]
  LOOP
    EXECUTE 'GRANT USAGE ON SCHEMA public TO anon';
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'anon_select_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY anon_select_all ON public.%I FOR SELECT TO anon USING (true)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- 3. Verify + self-document: nothing below runs, this is just a guard so a
--    mis-typed future migration can't accidentally grant writes to anon.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_schema = 'public'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'anon must never hold write privileges on public tables';
  END IF;
END $$;
