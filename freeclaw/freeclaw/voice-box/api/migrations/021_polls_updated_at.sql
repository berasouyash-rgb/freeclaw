-- 021_polls_updated_at.sql
--
-- WHY: poll_votes rows are deliberately invisible to realtime (no anon
-- SELECT policy — voter identity stays private, and Supabase ships full row
-- data on every event). That meant a vote surfaced nowhere until a manual
-- refresh: the polls-channel event the clients subscribe to never fired.
--
-- WHAT: a plain updated_at liveness column on polls. The vote handler
-- touches it after every successful ballot, so each vote emits one polls
-- UPDATE event carrying zero voter data. Readers re-pull totals through
-- the privacy-preserving /api/polls endpoint (masked author_ids), never
-- from the event payload.
--
-- PRIVILEGES: no grants, no RLS changes. Anon SELECT on polls already
-- exists; this adds no new readable data, only a timestamp that changes.
--
-- Safe to apply live: ADD COLUMN IF NOT EXISTS with a default backfills
-- existing rows inline; no backfill script, no table rewrite.
ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
