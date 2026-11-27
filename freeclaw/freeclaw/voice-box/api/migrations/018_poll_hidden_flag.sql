-- 018_poll_hidden_flag.sql
-- Adds admin poll blocking (hide without deleting).
--
-- Why: admins could only archive (still public, voting closed) or hard-delete
-- (votes wiped, irreversible). Blocked polls must vanish from every public
-- read while staying intact for review/audit/unblock.
--
-- Safe to apply on a live DB: nullable column, defaults false, no backfill,
-- no index changes (poll reads are bounded list scans, not filtered queries
-- at scale). The API tolerates both states: pre-migration it retries public
-- listings without the filter and answers block attempts with a 400 naming
-- this migration; post-migration the filter and patch just work.
-- STATUS: PROPOSED — needs explicit approval before apply_migration.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS hidden boolean DEFAULT false;
