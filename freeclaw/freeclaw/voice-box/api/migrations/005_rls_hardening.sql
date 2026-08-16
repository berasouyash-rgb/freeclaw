-- 005_rls_hardening.sql
-- Enterprise-grade RLS hardening: deny-by-default for anon/authenticated.
--
-- Context: every table had RLS enabled but a permissive allow_all policy
-- (role public, cmd ALL, USING(true)/WITH CHECK(true)) plus full anon grants.
-- The anon key ships in the public JS bundle, so that combination allowed
-- total DB read/write — including settings (admin password hash) and
-- admin_sessions (admin takeover). After this migration:
--   * zero policies remain in the public schema
--   * anon/authenticated hold NO privileges on tables/sequences/functions
--   * RLS remains enabled on every table (deny-by-default)
-- All data access flows exclusively through the API layer with the service
-- role key (bypasses RLS). Client realtime degrades to the built-in 10s
-- polling fallback (src/lib/useRealtime.ts, tested).
--
-- Safe to re-run: every statement is idempotent.

-- 1. Drop every policy in the public schema
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 2. Assert RLS stays enabled on every table (defense in depth)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- 3. Revoke ALL privileges on tables, sequences, functions from anon/authenticated/PUBLIC
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- 4. Lock down default privileges so future objects stay denied by default
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC;
