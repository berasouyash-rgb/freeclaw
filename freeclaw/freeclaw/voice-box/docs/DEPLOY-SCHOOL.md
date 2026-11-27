# Deploy to production (school handover)

Takes an empty Supabase project + a Vercel account to a live Voice Flow.
Estimated time: 45–90 minutes. No code changes required at any step.

## 0. What you need

- A Supabase project (free tier works for a single school; enable
  Point-in-Time Recovery on paid plans — see §7).
- A Vercel account with access to deploy from the school's repo copy.
- Three secrets you generate yourself (never reuse the development ones):
  - Supabase `service_role` key (Supabase dashboard → Project Settings → API)
  - Supabase `anon` key (same page)
  - An admin secret (see §4)

## 1. Database — apply migrations in order

In the Supabase dashboard → SQL Editor, run each file in
`api/migrations/` **in filename order**:

```
001_baseline.sql
002_agent_system.sql
003_v3_enterprise.sql
004_pending_review_status.sql
005_rls_hardening.sql
006_restore_anon_realtime.sql
007_reports_moderation.sql
008_agent_workforce.sql
009_private_posts_integrity_indexes.sql
010_rls_hardening.sql
011_reports_search_indexes.sql
012_workforce_ledger.sql
013_realtime_rls_guard.sql
013_search_indexes.sql   ← same number, different file: run second
014_revoke_anon_private_tables.sql
015_poll_votes_created_at.sql
```

Notes:

- `001_baseline.sql` is generated from the production schema and is safe
  to re-run (`IF NOT EXISTS` throughout). It creates the 25 core tables
  only — legacy experiment tables from earlier prototypes are
  intentionally excluded.
- `013_realtime_rls_guard.sql` contains assertions: if it fails, an
  earlier migration was skipped or half-applied. Fix that first, do not
  skip the guard.
- Every migration is re-runnable; running the chain twice changes nothing.

## 2. Storage buckets

Storage → Create bucket (both **private**):

- `chat-media`
- `voicebox-media`

No bucket policies are needed: all access goes through the server with
the service-role key, and the app serves files via signed paths.

## 3. Realtime

Database → Replication: enable replication for `posts`, `comments`,
`polls`, `poll_votes`, `reports`, `notifications`. (Migration 006
restores anonymous realtime access; 013 guards it. Without this the UI
silently falls back to 30s polling.)

## 4. Environment variables (Vercel → Project → Settings → Environment)

| Variable | Required | What it is |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | service_role key (server only, never `VITE_`-prefixed) |
| `VITE_SUPABASE_ANON_KEY` | yes | anon key (client reads where RLS allows) |
| `ADMIN_SESSION_SECRET_SHA256` | yes | sha256 hex of the school's admin passphrase (see below) |
| `NVIDIA_API_KEY` | no | AI providers; without any key the AI runs data-only + builtin intents and the UI says so |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | no | provider fallbacks, checked in order |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | email notifications; unset = in-app only |
| `CRON_SECRET` | recommended | Vercel cron authorization header (see §5) |

Generate the admin secret hash (run anywhere, keep the passphrase in the
school's password manager, store only the hash in Vercel):

```
node -e "console.log(require('crypto').createHash('sha256').update('YOUR-PASSPHRASE','utf8').digest('hex'))"
```

## 5. Deploy + crons

1. `vercel --prod` (build command `npm run build` is already configured
   in `vercel.json`).
2. Verify the three cron jobs ran (Vercel → Cron Jobs, each `*/5 * * * *`):
   `/api/agent-cron`, `/api/agent-cron?action=patrol`, `/api/incident-cron`.
   The workforce tick, patrol slot, and incident scanner respectively.
3. If `CRON_SECRET` is set, configure it as the cron Authorization header
   so outside callers cannot trigger ticks.

## 6. Smoke tests (do these before announcing the launch)

1. Open the site → submit a test post as an anonymous user → it appears.
2. Submit a post containing a test swear word → it is **blocked with no
   stars**, and an appeal panel offers recourse.
3. Log in at `/admin` with the admin passphrase → file the appeal from
   step 2 → Reports → AI Review → appeals queue → Overturn → the post
   goes live. Then delete the test content.
4. Check Ops Center loads (workforce summary) and AI Quality shows
   scorecards after the first cron ticks (~10 min).
5. Realtime check: open the same post in two browsers; a comment in one
   appears in the other within seconds (not 30s).

## 7. Backups and recovery

- Supabase Dashboard → Database → Backups: confirm daily backups are on;
  enable Point-in-Time Recovery for production.
- Quarterly: restore drill to a *separate* staging project and run the
  smoke tests above.
- App rollback: Vercel → Deployments → promote the previous good build
  (see `docs/ROLLBACK.md`). Database migrations in this repo are
  additive; none require a down-migration to roll the app back.

## 8. What NOT to do

- Never put `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_`-prefixed variable
  (it would ship to browsers; the server fails closed without it).
- Never run `*.test.ts` files or `D:\Temp` scratch scripts against
  production.
- Never edit the `POLICY` table in `api/_safety-pipeline.js` without
  running `npm run test:api` — `tests/api/safety-parity.test.ts` locks
  every enforcement verdict.
