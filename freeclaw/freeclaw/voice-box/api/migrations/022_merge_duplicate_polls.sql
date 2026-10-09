-- 022_merge_duplicate_polls.sql
--
-- WHY: production holds duplicate poll rows for the same question with votes
-- split between them (live scan 2026-10-08: 16 polls, 10 unique questions, 4
-- duplicate groups e.g. 6+0, 2+0+0). Every surface then shows a different
-- number for "the same" poll depending on which row it reads — the exact
-- shape of "I voted but the count looks wrong". The client hides this
-- (collapseDuplicatePolls keeps the highest-total row) but the data stays
-- split, so feed badges, the Polls page and My Activity can disagree.
--
-- WHAT: per duplicate group (same post_id, same normalized title, same ptype,
-- same options) keep ONE canonical row — highest vote total, oldest
-- created_at on ties (mirrors collapseDuplicatePolls + the feed pMap rule) —
-- repoint surviving ballots to it, drop superseded ballots, and SOFT-delete
-- the losers (deleted = true: recoverable, matches the app convention).
-- Conflict rule when one voter has ballots on several rows of a group: keep
-- the latest intent (created_at DESC, unknown-NULL oldest, canonical wins
-- ties); exactly one ballot per (poll, author) survives, so the migration
-- 009 UNIQUE index is never violated.
--
-- SAFETY (human gate — do NOT apply without DBA approval):
--   * Requires migration 009 (poll_votes_poll_author_uidx). Aborts otherwise.
--   * Requires 021 (polls.updated_at) for the liveness touch; the touch is
--     skipped (not failed) when the column is absent.
--   * Soft-delete only: NO hard DELETE of polls. Authors are never reassigned.
--   * Idempotent: re-running finds no duplicate groups and changes nothing.
--   * Fails closed: raises if duplicate groups remain afterwards.
--   * Rollback: snapshot loser ids BEFORE applying
--       SELECT id FROM polls WHERE deleted = false;  -- keep the output
--     then un-delete exactly those ids if the merge must be undone:
--       UPDATE polls SET deleted = false WHERE id IN (...snapshot ids...);
--     Repointed ballots are NOT auto-reversed (choices are preserved 1:1, but
--     their original poll_id is gone) — this is the one irreversible step,
--     which is why the gate exists.
--
-- Safe to re-run: every statement only touches rows in duplicate groups.

-- 0. Fail closed without the 009 uniqueness guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'poll_votes_poll_author_uidx'
  ) THEN
    RAISE EXCEPTION '022 requires migration 009 (poll_votes_poll_author_uidx) — apply 009 first';
  END IF;
END $$;

-- Shared group key (approximate normalization: lower + non-alnum collapse.
-- The app collapses with full Unicode classes; SQL keeps the ASCII-safe
-- subset, which only ever UNDER-groups — a missed pair stays split, never
-- wrongly merged).
-- Per-group canonical: highest vote total, oldest created_at on ties.

-- 1. Drop superseded ballots: keep exactly one ballot per (voter, group) —
-- latest intent wins (created_at DESC, NULL oldest, canonical wins ties).
WITH ranked AS (
  SELECT p.id AS pid,
    p.post_id AS k_post,
    lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')) AS k_title,
    p.ptype AS k_ptype,
    p.options::text AS k_opts,
    COUNT(*) OVER (
      PARTITION BY p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text) AS grp
  FROM public.polls p
  WHERE p.deleted = false
),
canon AS (
  SELECT pid AS cid, k_post, k_title, k_ptype, k_opts
  FROM (
    SELECT r.*,
      ROW_NUMBER() OVER (
        PARTITION BY r.k_post, r.k_title, r.k_ptype, r.k_opts
        ORDER BY (SELECT COUNT(*) FROM public.poll_votes v WHERE v.poll_id = r.pid) DESC,
          (SELECT p.created_at FROM public.polls p WHERE p.id = r.pid) ASC NULLS LAST,
          r.pid ASC) AS rn
    FROM ranked r
  ) s WHERE rn = 1 AND grp > 1
),
voted AS (
  SELECT v.id AS vid,
    ROW_NUMBER() OVER (
      PARTITION BY v.author_id, r.k_post, r.k_title, r.k_ptype, r.k_opts
      ORDER BY v.created_at DESC NULLS LAST,
        (v.poll_id = c.cid) DESC,
        v.id ASC) AS arn
  FROM public.poll_votes v
  JOIN ranked r ON r.pid = v.poll_id
  JOIN canon c ON c.k_post IS NOT DISTINCT FROM r.k_post
    AND c.k_title = r.k_title
    AND c.k_ptype IS NOT DISTINCT FROM r.k_ptype
    AND c.k_opts = r.k_opts
  WHERE r.grp > 1
)
DELETE FROM public.poll_votes d USING voted s
WHERE d.id = s.vid AND s.arn > 1;

-- 2. Repoint surviving loser ballots onto the canonical row. Conflict-proof:
-- after step 1 each voter holds at most one ballot per group, and the
-- NOT EXISTS guard keeps it that way even if a concurrent vote lands
-- between the two statements (the ballot then stays on its row and the
-- group is picked up on re-run instead of violating UNIQUE).
WITH ranked AS (
  SELECT p.id AS pid,
    p.post_id AS k_post,
    lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')) AS k_title,
    p.ptype AS k_ptype,
    p.options::text AS k_opts,
    ROW_NUMBER() OVER (
      PARTITION BY p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text
      ORDER BY COUNT(v.id) DESC, p.created_at ASC NULLS LAST, p.id ASC) AS rn,
    COUNT(*) OVER (
      PARTITION BY p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text) AS grp
  FROM public.polls p
  LEFT JOIN public.poll_votes v ON v.poll_id = p.id
  WHERE p.deleted = false
  GROUP BY p.id, p.post_id, p.title, p.ptype, p.options, p.created_at
),
canon AS (
  SELECT pid AS cid, k_post, k_title, k_ptype, k_opts
  FROM ranked WHERE rn = 1 AND grp > 1
)
UPDATE public.poll_votes d SET poll_id = c.cid
FROM public.poll_votes v
JOIN ranked r ON r.pid = v.poll_id
JOIN canon c ON c.k_post IS NOT DISTINCT FROM r.k_post
  AND c.k_title = r.k_title
  AND c.k_ptype IS NOT DISTINCT FROM r.k_ptype
  AND c.k_opts = r.k_opts
WHERE d.id = v.id
  AND v.poll_id <> c.cid
  AND NOT EXISTS (
    SELECT 1 FROM public.poll_votes e
    WHERE e.poll_id = c.cid AND e.author_id = v.author_id
  );

-- 3. Soft-delete the losers (recoverable; never a hard DELETE).
WITH ranked AS (
  SELECT p.id AS pid,
    ROW_NUMBER() OVER (
      PARTITION BY p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text
      ORDER BY COUNT(v.id) DESC, p.created_at ASC NULLS LAST, p.id ASC) AS rn,
    COUNT(*) OVER (
      PARTITION BY p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text) AS grp
  FROM public.polls p
  LEFT JOIN public.poll_votes v ON v.poll_id = p.id
  WHERE p.deleted = false
  GROUP BY p.id, p.post_id, p.title, p.ptype, p.options, p.created_at
)
UPDATE public.polls SET deleted = true
WHERE id IN (SELECT pid FROM ranked WHERE rn > 1 AND grp > 1);

-- 4. Liveness touch on survivors so connected clients refetch merged totals
-- (skipped, not failed, when 021 was never applied).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'polls' AND column_name = 'updated_at'
  ) THEN
    UPDATE public.polls SET updated_at = now()
    WHERE deleted = false AND id IN (
      SELECT p.id FROM public.polls p
      GROUP BY p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text
      HAVING COUNT(*) >= 1
    );
  ELSE
    RAISE NOTICE '022: polls.updated_at absent (021 not applied) — skipping liveness touch';
  END IF;
END $$;

-- 5. Fail closed: no duplicate group may remain among live polls.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text
      FROM public.polls p
      WHERE p.deleted = false
      GROUP BY p.post_id,
        lower(regexp_replace(COALESCE(p.title, ''), '[^a-z0-9]+', ' ', 'g')),
        p.ptype, p.options::text
      HAVING COUNT(*) > 1
    ) s
  ) THEN
    RAISE EXCEPTION '022: duplicate poll groups remain after merge — inspect before proceeding';
  END IF;
END $$;
