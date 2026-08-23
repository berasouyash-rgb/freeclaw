# Rollback Guide

## Migrations

### 009_private_posts_integrity_indexes.sql
Forward: Adds posts.visibility, UNIQUE on poll_votes/reactions, hot-path indexes. Dedupes duplicates (keeps lowest id).

Rollback:
- Code: git revert <sha> + vercel --prod (app degrades gracefully if column missing).
- DB: Restore from supabase db dump taken before deploy. In-place reverse:
```sql
DROP INDEX IF EXISTS poll_votes_poll_author_uidx;
DROP INDEX IF EXISTS reactions_target_author_kind_uidx;
DROP INDEX IF EXISTS posts_visibility_idx;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_visibility_check;
ALTER TABLE posts DROP COLUMN IF EXISTS visibility;
```

### 010_rls_hardening.sql
Forward: Locks search_path on exec_sql/execute_sql, adds service_role_all policies.

Rollback:
```sql
DO $$ DECLARE r record; BEGIN FOR r IN SELECT schemaname,tablename FROM pg_policies WHERE policyname='service_role_all' LOOP EXECUTE format('DROP POLICY service_role_all ON %I.%I', r.schemaname, r.tablename); END LOOP; END $$;
ALTER FUNCTION public.exec_sql(text) RESET search_path;
ALTER FUNCTION public.execute_sql(text) RESET search_path;
```

## Code
Vercel Dashboard → Deployments → Promote previous deployment. No DB change for pure code reverts.
