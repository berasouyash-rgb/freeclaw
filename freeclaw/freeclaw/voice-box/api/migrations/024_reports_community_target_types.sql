-- Voice Flow — allow community targets in the report queue
-- ----------------------------------------------------------------------------
-- Reporting a community post returned HTTP 500 ("internal server error").
-- `reports` tables created from an older schema carry a CHECK constraint that
-- lists only post/comment/poll, so the insert of
-- target_type = 'community_post' violated it and the API surfaced the raw
-- PostgREST error as a 500.
--
-- api/_reports.js now also falls back to the constraint-safe form
-- (target_type='post' with a `community:`-prefixed target_id) so reporting
-- works even on a database that has not run this migration, but widening the
-- constraint is the durable fix: the admin queue can then store the real
-- target type instead of a rewritten one.
--
-- Idempotent: drops only target_type CHECK constraints, then re-adds the
-- widest known set. No rows are modified or deleted.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.reports'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%target_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.reports DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'poll', 'community_post', 'community'));
