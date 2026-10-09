# Voice Flow — Release Gate (head `8248598`, branch `review-fix`)

Evidence-gated ship record. Every line below names its proof; anything without
proof lives under UNTESTED, never under PASS. Updated 2026-10-09.

## VERIFIED PASS

- Unit + contract suites: frontend 1906/1906, API 2076/2076, `tsc -b` 0,
  eslint 0 (CI "Test, Typecheck & Lint" green; `typescript-lint.bat`
  TSC_EXIT=0 ESLINT_EXIT=0).
- CI head `8248598`: 4/4 SUCCESS (2× Test/Typecheck/Lint + 2× E2E) —
  8th consecutive all-green head.
- E2E: CI "E2E Tests" green; local shards 39 + 40 passed pre-release.
- RLS live probe (prod anon key, read-only): 12/12 sensitive tables deny,
  public reads allow, 6/6 predicate probes return zero rows.
- Load ladder (local dev, read-only, 30s + 10s ramp): 10 / 50 / 100 /
  500 users PASS with 0 errors (8,299 reqs at 500).
- Overload behavior: 1,000-user rung shed 2,542 × 503 OVERLOADED with
  `Retry-After: 2` (by-design guard, `api/_load-guard.js`); client retries
  GET once and recovers, never queues throttled writes
  (`src/__tests__/api.test.ts` backoff suite green).
- Vote integrity: per-(poll, author) UNIQUE (migration 009) + race-safe
  upsert (`api/_polls.js`); list path strict — results-read failure throws
  to honest 500, never fake zeros (regression test RED-proven).
- AI surfaces: LLM drafts land as `pending` through an executable-kind
  allowlist; apply is admin-only with audit log + critical double-confirm;
  raw model text never mutates state.
- Error hygiene: all throws end in generic "Internal server error"
  (`api/_error.js`), details to logs/Sentry only.
- Native shells: EXE installer exit 0 (fresh binary, current bundle
  verified inside); APK Gradle exit 0, Capacitor sync exit 0, assets
  timestamped to the fresh build minute. Both gitignored by design —
  ship via GitHub Release, never via git.
- Secrets: `.env*` gitignored; service key server-side only; no secret
  in client bundle, logs, or committed files.
- Rollback: `docs/ROLLBACK.md`; deploy runbook `docs/DEPLOY-SCHOOL.md`;
  handover `docs/SCHOOL-HANDOVER.md` + `docs/HANDOVER-CHECKLIST.md`.

## KNOWN FAILURES (accepted or user-gated — none blocks the code)

1. Production serves pre-release code (proven: prod 404s on routes HEAD
   serves). Fix: owner runs `npx vercel --prod`. Nothing fixed is visible
   until then — including every realtime liveness fix.
2. Update feed empty (`/api/version` returns `platforms:{}`): the four
   `LATEST_*` env vars are unset, so the in-app updater can never fire.
3. Duplicate polls on prod (4 groups, votes split, e.g. 6+0): merge
   migration `022` drafted + contract-tested but DBA-GATED, not applied.
4. Vote-count flap report (37→2→0) unconfirmed: fake-zero class killed
   and proven, but the exact report needs user screenshots to trace.
5. Single-instance 1,000-user shed (18% 503s on one dev PC): by-design
   load shedding; prod scales per-instance. School-scale rungs all green.

## UNTESTED AREAS (do not claim)

- Post-deploy prod smoke + prod E2E (needs owner deploy).
- 1,000-user load against prod (owner-gated; never run against shared infra
  without explicit approval).
- Play Store AAB path (debug APK is sideload-only by design).
- macOS DMG shell (no Mac hardware in this loop).

## Release checklist for the owner

1. `npx vercel --prod` from `voice-box/`, then re-probe `/api/version`
   (it now reports its commit — one request proves freshness).
2. Set `LATEST_APK/EXE_VERSION/URL` (+ notes), upload the fresh EXE + APK
   to a GitHub Release, redeploy so the feed goes live.
3. Approve + apply `022_merge_duplicate_polls.sql` (snapshot loser ids first —
   rollback note is in the file header), then confirm totals agree everywhere.
4. Send the vote-flap screenshots if the report still reproduces after 1–3.
