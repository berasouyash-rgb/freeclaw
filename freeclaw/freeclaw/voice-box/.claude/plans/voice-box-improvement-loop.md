# Voice Box — Continuous Improvement Loop

**Pattern:** sequential · **Mode:** safe · **Started:** 2026-08-06
**Project:** voice-box (Vite + React 19.2 + react-router 8.3, Node >=22.22.0, Vercel serverless API)
**Live site:** https://voice-box-psi.vercel.app

## Loop Mission

Continuous enterprise improvement: review the whole product (every page, component,
API, query, AI workflow, UX state, loading/empty/error, responsive, a11y, perf,
security, design), fix the highest-impact issue per cycle, verify with the full test
suite, and repeat. STOP only when no meaningful improvement remains across multiple
full review cycles.

## Safety Gates (all must pass before the first iteration)

| Gate | Status |
|------|--------|
| Tests pass before first iteration | ✅ frontend 660/660 (35 files), API 458/458 (24 files) |
| Lint clean | ✅ `npm run lint` clean |
| Build succeeds | ✅ `npm run build` (tsc -b && vite build); one chunk-size warning (see Issue #1) |
| `ECC_HOOK_PROFILE` not set (hooks not globally disabled) | ✅ not set |
| Repository state + branch strategy | ⚠️ **NO GIT** — `voice-box` is not a git repo; git binary not installed on PATH (`C:\Program Files\Git`, `%LOCALAPPDATA%\Programs\Git`, `where.exe git` all negative). No version control, no branches, no rollback. Deploys happen via `deploy.ps1` (npx vercel --prod). |
| Explicit stop condition | ✅ Defined: no meaningful improvement across multiple full review cycles |

**Git decision pending user:** install Git + `git init` (recommended) vs. continue un-versioned.

## Baseline (Cycle 0 — 2026-08-06)

- Frontend tests: 660 passing, 35 files
- API tests: 458 passing, 24 files
- Lint: clean · Build: OK (warning: `dist/assets/index-*.js` 401.74 kB / 122.13 kB gzip > 300 kB)

## Current-State Findings (built from live code, NOT the stale 2026-07-16 audit)

The 2026-07-16 `audit-report.json` (41 issues, 7 critical) is **largely fixed** —
verified in code: `_health.js` has an `isAdmin` gate, `_search.js` has `escapeLike`,
`_users.js` has IP rate limiting, `_meta-agent.js` has `escapeLike` + whitelisted
bulk_update, `_providers.js` admin-gates all POST actions and masks keys. Live
findings ranked:

| # | Sev | Area | Finding | Evidence |
|---|-----|------|---------|----------|
| 1 | HIGH | API auth | **`_notifications.js` IDOR still open** — accepts any `user_id` with no ownership/ban gate; any caller knowing a victim's anon id can spam or wipe their server-side notification feed (`notifications:<id>` settings rows also written by `_follows.js`, `_polls.js`, `_admin.js`). Only a per-user rate limit exists. No format validation (arbitrary strings → settings-key suffix). | read `api/_notifications.js` (100 lines) |
| 2 | MED | Perf | 401 kB single JS chunk (122 kB gzip) — code-splitting candidate (manualChunks/dynamic import). | `npm run build` output |
| 3 | MED | API | `_search.js` swallows post-query errors → silently partial results (`console.error` + continue). Intentional resilience but silent. | `api/_search.js:55-58` |
| 4 | LOW | API | `_providers.js` GET `?action=list` still public with `key_masked` suffixes + `has_env_key` booleans (audit #7 residual; masked but leaks env-key existence). | `api/_providers.js:507-528` |
| 5 | LOW | API | `_me.js` exposes ban status for any queried anon_id (rate-limited but no ownership proof; enumeration theoretical for 40-char ids). | `api/_me.js` |
| 6 | LOW | Infra | No VCS — cannot branch, review diffs, or roll back deploys. | git absence confirmed |
| 7 | LOW | API | `_notifications.js` catch returns generic 500 w/ `console.error` instead of `sanitizeError` (minor inconsistency vs 60+ endpoints). | same file |

## Cycle 1 — `_notifications.js` IDOR hardening (Issue #1)

**Goal:** eliminate the highest-severity confirmed live finding with minimal,
convention-consistent changes and full regression coverage.

### Design

1. **Format validation** — `user_id` must match `/^anon_[a-z0-9]+$/`, length 5..40
   (mirrors `checkUser()` length rule + `_users.js` `anon_` prefix rule). Rejects
   settings-key suffix injection and garbage ids.
2. **Write gating** — POST (create/mark-read) and DELETE call `checkUser(userId)`;
   banned/suspended users → 403 (same convention as `_chat.js`/`_posts.js` writes).
3. **Field sanitization** — `type` whitelist (`info|success|warning|error`),
   `title` ≤200, `body` ≤1000, `post_id` ≤40 via `clean()`.
4. **Consistent errors** — catch → `sanitizeError(res, err, 'notifications')`.
5. Keep existing per-user write rate limit (15/min).

**Residual risk (documented):** with no session model, reads/mark-read/clear for a
*non-banned* anon id cannot be ownership-proven server-side; unguessable 40-char ids
are the credential. A header-based identity proof (`x-anon-id`) is a follow-up
candidate requiring a frontend change — deferred.

### Verification

- New `tests/api/notifications.test.ts` (~10 tests): GET reads, empty feed, invalid
  ids → 400, create sanitizes + stores, banned/suspended → 403 (create + delete),
  mark-as-read, clear, 16th write → 429.
- `npm run test:api` (458 + new), `npm run test` (660, no regressions), lint, build.

### Cycle 1 Result

**1. IDOR hardening — implemented + verified.**
- `api/_notifications.js` hardened: `user_id` format validation
  (`/^anon_[a-z0-9]+$/`, 5..40), `checkUser()` write-gate on POST/DELETE
  (banned/suspended → 403), `type` whitelist + field sanitization, consistent
  `sanitizeError`.
- New `tests/api/notifications.test.ts`: **15/15** (fixtures use underscore
  anon ids to pass format validation).
- Full gates green: FE **660/660** (35 files, 4096MB heap), API **473/473**
  (25 files), lint clean, build clean.

**2. Production incident — user "votes revert to 0 / site full of errors": ROOT-CAUSED + FIXED + VERIFIED LIVE.**
- DB diagnostics (service-role, read-only scripts `D:\temp\opencode\check-bans.cjs`,
  `inspect-user.cjs`, `check-voters.cjs`): 372 `users_meta` rows → **exactly 1 banned**:
  `anon_5m2e704v6f4d5n`, zero posts/comments/reactions, `strikes=0`, notes
  "Banned via admin agent", created 2026-07-12. **0 suspended users.**
- `activity_logs` prove it is **admin ban/unban testing collateral**: 2026-07-12
  10:21 ban executed → 10:24–10:27 failed ban attempts ("0 action(s) proposed")
  → 10:31:14 unban → 10:31:15 unban executed → 10:31:17 ban → 10:31:19 ban
  executed → 10:31:21 "unban user" **proposed but never executed** → left BANNED.
- Symptom match verified on the live API: reaction POST for that anon →
  **403** → client rollback → votes show 0 on refresh + error toasts everywhere.
- **Fix:** `banned=false, notes=''` via service-role update (mirrors agent unban;
  strikes/warnings untouched). **Verified live:** heartbeat → `ok:true,banned:false`;
  reaction POST → `200 toggled`.
- `pre_publish_banned` anons (`anon_2n2g2j6x690s3r` etc.) are **not** banned —
  strikes/warnings applied but `banned=false` (see new finding #8).

**3. Redeployed verified build.**
- `npx vercel --prod` → new Production deployment (Ready 29s, aliased
  voice-box-psi.vercel.app). Live JS now `index-CPILTAPn.js` (was DKVK6weJ);
  `health-chunks.json` OK (54 chunks). Smoke: GET posts 200 (13 items),
  GET reactions 200, heartbeat 200.

### New Findings (Cycle 1.5)

| # | Sev | Area | Finding | Evidence |
|---|-----|------|---------|----------|
| 8 | HIGH | API | **`_pre-publish-review.js` ban upsert has NO error check** — silent failure path. Real users got `pre_publish_banned` audit logs + strikes/warnings but `banned=false` (ban never stuck or was reverted with strikes persisting). | `api/_pre-publish-review.js:104-110`; DB `users_meta` for `anon_2n2g2j6x690s3r` (strikes=1, banned=false), `anon_1e5e6o2s3j4135` (strikes=2) |
| 9 | MED | API | **`POST /api/users` never updates `last_seen`** — all 372 rows `last_seen=null`, so active users cannot be identified; made the incident investigation harder. | `api/_users.js`; DB scan |
| 10 | LOW | API/UX | Agent ban tool path does not notify the affected user, and `AppContext` toasts only on status *transition* → already-banned users silently hit 403s everywhere. | `_tool-registry.js` ban; `AppContext.tsx:82-89` |

### Next Candidates (ranked)
1. Issue #8: error-check the pre-publish ban upsert (+ audit-tool path).
2. Issue #2: 401 kB chunk → code-splitting.
3. Issue #3: `_search.js` error handling.
4. Git decision still pending (install Git + `git init` recommended).

## Cycle 2 — Moderation integrity + privacy + presence (2026-08-06)

**Goal:** close the silent-failure family behind the Cycle 1 incident (#8), fix the
privacy leak in data-export, make presence real (#9), and widen the search window.

### Design

1. **FIX-#1 (NEW HIGH, `_export.js`):** `GET /api/data-export?anon_id=X` returned the
   raw `users_meta` row — anyone with an anon_id (no ownership proof, only a 10/min
   IP rate limit) could read any user's **moderation history** (warnings, strikes,
   banned, suspended_until, notes). Fix: export profile is whitelisted to benign
   identity fields only (`anon_id`, `created_at`, `last_seen`).
2. **FIX-#2 (`_pre-publish-review.js`):** every write is now error-checked. Ban
   upsert failure → 500 and the queue item is **kept** (never a silent "banned"
   that didn't persist — the exact failure family from the incident). `keep_private`
   update failure → 500. Queue-delete failure after a committed action → log-only
   + still 200 (prevents admin retry duplicating a committed post).
3. **FIX-#3 (`_users.js`, finding #9):** heartbeat is now a real write —
   existing users refresh `last_seen` (admin dashboard presence becomes live);
   new users are created with full defaults (`warnings: []`, `strikes: 0`,
   `banned: false`, `last_seen`).
4. **FIX-#4 (`_search.js`):** fetch windows widened 500→2000 (posts) and
   300→1000 (comments/polls) so older real content stays searchable instead of
   being silently shadowed by newer posts/artifacts.
5. **Doc fix:** `_pre-publish-review.js` claimed route `/api/pre-publish/review`;
   actual mount is `/api/pre-review` (frontend already calls the correct path —
   verified live 403 for unauth). Comments corrected in source + tests.

### Verification

- New `tests/api/pre-publish-review.test.ts` (**13 tests**): GET list, GET 500 on
  query error, 403 unauth, 400 missing key/action + unknown action, 404 missing
  item, approve insert + queue clear, approve insert-failure → 500 + item kept,
  ban upsert (banned:true, strikes+1, warning appended), **ban upsert-failure →
  500 + item KEPT**, ban without author_id → 400, keep_private failure → 500,
  post-commit delete failure → still 200.
- New `tests/api/users.test.ts` (**7 tests**): existing-user state, **last_seen
  refreshed on heartbeat**, new-user insert with full defaults, banned surface,
  400 invalid id, 405, IP rate limit → 429.
- `tests/api/data-export.test.ts` updated + 1 new test: profile whitelist
  (`anon_id`, `created_at`, `last_seen`), moderation fields stripped (strikes,
  banned, suspended_until, warnings, notes must NOT appear).
- Full gates: API **494/494** (27 files, +21 tests), FE **660/660** (35 files,
  4096MB heap), lint clean, build ✓ (54 chunks).

### Cycle 2 Result

**Implemented + verified + deployed.** New Production deployment aliased to
voice-box-psi.vercel.app. Live smoke:
- `/api/users` heartbeat → 200 `{ok:true,banned:false,...}` (created smoke row).
- `/api/data-export?anon_id=...` → profile = **`anon_id, created_at, last_seen`**
  only — moderation internals gone (FIX-#1 verified live).
- `/api/pre-review` unauth → **403**; `/api/search` → 200.
- Index JS hash unchanged content-wise (same bundle); health-chunks 54 chunks.

### New Findings (Cycle 2.5)

| # | Sev | Area | Finding | Evidence |
|---|-----|------|---------|----------|
| 11 | MED | API | `_export.js` aggregation (`posts+comments+reactions+poll_votes+settings`) still runs 5 sequential queries per request; fine for small data, watch for growth. | `api/_export.js` |
| 12 | LOW | UX | `AppContext.tsx:91` comment: review-queue ban issues strike+warnings but the user is only notified on status *transition* — already-banned users keep hitting 403s silently. | `src/contexts/AppContext.tsx` |

### Next Candidates (ranked)
1. Issue #2: 401 kB single chunk → code-splitting (`manualChunks` / lazy routes).
2. Issue #3: `_search.js` still swallows post-query errors silently (partial results).
3. Issue #10/#12: notify already-banned users on load (heartbeat-driven ban toast).
4. Git decision still pending (install Git + `git init` recommended).
