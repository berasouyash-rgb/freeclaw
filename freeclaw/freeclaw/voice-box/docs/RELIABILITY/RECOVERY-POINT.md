# VoiceFlow Recovery Point

**Created:** 2026-11-07
**Purpose:** establish a verified, restorable recovery point *before* any reliability work touches production.
**Production:** `https://voice-box-psi.vercel.app` @ `31f2aaa315dcab18d43270419136470c9a4e045b`

> This document records what exists and how to restore it. It does **not** claim a restore has been tested yet. Restore-test status is tracked in §7 and must stay `NOT YET TESTED` until an isolated restore actually succeeds.

---

## 1. What is being protected

**Scope: the 34 VoiceFlow tables.** Explicitly excluded: the 42 foreign tables belonging to other applications sharing this Supabase project (`cricket_matches`, `diet_log`, `fitness_log`, `mon_*`, `trips`, `app_data`, `sync_log`, …). See `docs/RELIABILITY/AUDIT.md` §3.2.

VoiceFlow tables:

```
activity_logs        admin_feedback        admin_tabs           agent_activity_log
agent_config         agent_conversations   agent_executions     agent_goals
agent_insights       agent_knowledge       agent_learning       agent_memory
agent_reports        agent_suggestions     agent_tasks          approvals
audit_logs           chat_messages         chat_threads         comments
conversations        knowledge_base        messages             notifications
poll_votes           polls                 posts                reactions
reports              settings              system_metrics       tool_calls
tool_evidence        users_meta
```

(`workforce_*` are declared but absent live — 404. They are not part of the recovery point.)

**Row count:** 84,028.

---

## 2. Schema source of truth

There is **no single** source of truth. A correct restore requires both:

1. `api/migrations/*.sql` — 38 declared tables, 69 policy statements, RLS enabled on all public tables (loop in `005_rls_hardening.sql`), plus `append_setting_list_item`, `claim_agent_triggers`, `comments_refuse_locked_post` functions and the `comments_refuse_locked_post` trigger.
2. The **live** database itself — which additionally holds 42 tables and any column-level changes never captured in a migration.

**Consequence:** restoring from migrations alone reproduces only the declared subset. Restoring from a logical dump of the 34 VoiceFlow tables is the reliable path. A full `pg_dump --schema-only` of the shared project is required to capture drift, but must be filtered to the 34 tables before any restore into a fresh project.

---

## 3. Backup artefacts required

| Artefact | Covers | Status |
|---|---|---|
| Schema export (filtered to 34 tables + functions + triggers) | Structure | **TO PRODUCE** |
| Data export (34 tables, JSON or `COPY`) | 84,028 rows | **TO PRODUCE** |
| RLS policy export (`pg_policies`) | 69 policy statements | **TO PRODUCE** |
| Storage metadata (`storage.objects` for `chat-media`, `voicebox-media`) | File inventory | **TO PRODUCE** |
| Storage object bytes | Uploaded media | **TO PRODUCE** |
| Auth configuration | Supabase Auth settings, provider config | **TO PRODUCE** |
| Env/deploy config | Vercel env vars, `vercel.json` | **PARTIAL** — `vercel.json` in repo; env vars must be exported from Vercel dashboard |
| Rollback plan | §6 | **DONE** |

**Do not mark this recovery point valid until every row above is `DONE` and §7 has a passing restore test.**

---

## 4. Known-good state to restore to

| Property | Value |
|---|---|
| Commit | `31f2aaa315dcab18d43270419136470c9a4e045b` |
| APK | `voice-box/Voice-Box-Android.apk` — 7,821,137 bytes, 2026-10-29 15:42, debug-signed |
| EXE | `electron/dist/Voice-Flow-Desktop-2.0.1-win-x64.exe` — 88,146,257 bytes, 2026-10-29 15:35, unsigned |
| Web `dist/` | built at `base:"/"` |
| Anon exposure | `posts` (200), `comments` (7), `polls` (12) only; 0 foreign tables |

---

## 5. Restore procedure (isolated environment)

**Never restore into the production project.** Create a separate Supabase project for the test.

1. Provision an isolated Supabase project.
2. Apply the filtered schema export.
3. Apply RLS policies from the `pg_policies` export.
4. Recreate functions and triggers.
5. Load data with `COPY`, then verify row counts per table against §1.
6. Recreate the `chat-media` and `voicebox-media` buckets and upload objects; verify object counts.
7. Recreate Auth configuration.
8. Point a *preview* deployment at the restored project via env vars only.
9. Run the smoke suite against the preview: `/api/version`, feed read, post create, comment create, poll vote, upload, admin login.
10. Record actual row counts and smoke results in §7.

**Verification is a row-count comparison plus a functional smoke, not a log line.**

---

## 6. Rollback plan

Because all reliability work is feature-flagged **OFF** by default, rollback is:

1. Ensure `RELIABILITY_FAILOVER_ENABLED` is unset or `false`.
2. Redeploy the known-good commit `31f2aaa` (`npx vercel --prod`).
3. No database changes are made by the new code while the flag is off, so no data rollback is required.
4. If a migration was applied (none will be without approval), reverse it with the paired down-migration before redeploying.

Rollback time target: **< 10 minutes** (single redeploy). This has not yet been exercised.

---

## 7. Restore test record

| Field | Value |
|---|---|
| Restore tested | **NOT YET TESTED** |
| Isolated project | — |
| Row counts matched | — |
| Smoke suite | — |
| Restore duration | — |
| Tested by | — |
| Date | — |

> Per the project rules: no backup success may be claimed until this table is filled with a passing restore.

---

## 8. RPO / RTO targets (design, not yet measured)

| Metric | Target | Measured |
|---|---|---|
| RPO — max acceptable data loss | ≤ 60s of writes | not measured |
| RTO — max acceptable outage | ≤ 5 min to read-only, ≤ 15 min to write | not measured |
| Replication lag | < 30s p95 | not measured |

These are targets. The reliability dashboard must report **measured** values, and this document must be updated with real numbers after a staging failover drill.
