-- 013_realtime_rls_guard.sql
-- Deploy-time proof that RLS + Realtime are FULLY working.
--
-- The client (src/lib/useRealtime.ts) only opens WebSocket channels for the
-- tables listed below. If any of these are missing from the
-- `supabase_realtime` publication or lack their anon SELECT policy (e.g. a
-- half-applied 006), the UI silently degrades to 30s polling and everything
-- feels high-latency with zero errors. This guard fails the migration run
-- LOUDLY instead, so the misconfiguration is fixed (re-run 006) rather than
-- shipped as "realtime is slow".
--
-- Pure assertions + one safe hardening revoke: changes nothing else.
-- Safe to re-run.

-- Harden first: 007 granted anon INSERT/UPDATE/DELETE on reports. Harmless
-- today (RLS has no anon write policy, so writes still deny), but a grant is
-- half of an open door — remove it so a future mis-added policy can't take
-- effect silently. The API writes with the service-role key; anon app writes
-- were never a supported path (all mutations flow through /api/*).
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM anon;

DO $$
DECLARE
  t TEXT;
  missing_pub TEXT[] := '{}';
  missing_pol TEXT[] := '{}';
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
      missing_pub := missing_pub || t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'anon_select_all'
    ) THEN
      missing_pol := missing_pol || t;
    END IF;
  END LOOP;

  IF array_length(missing_pub, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'realtime publication missing tables: %. Re-run 006_restore_anon_realtime.sql',
      array_to_string(missing_pub, ', ');
  END IF;
  IF array_length(missing_pol, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'anon SELECT policy missing on tables: %. Re-run 006_restore_anon_realtime.sql',
      array_to_string(missing_pol, ', ');
  END IF;

  -- The other half of "RLS fully working": after the revoke above, anon
  -- must hold NO write grants anywhere in public.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_schema = 'public'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'anon still holds write grants on public tables — revoke them; RLS policies alone are not the whole story';
  END IF;
END $$;
