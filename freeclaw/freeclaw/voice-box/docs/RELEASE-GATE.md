# Voice Flow — Release Gate (release `v2.0.1`, branch `review-fix`, supersedes head `3e40020`)

Evidence-gated ship record. Every line below names its proof; anything without
proof lives under UNTESTED, never under PASS. Updated 2026-10-10.

## VERIFIED PASS

- Production deploy (2026-10-10, solved this loop): Vercel CLI deploy from
  the release tree → `dpl_3grRN2uGBre88bUBXWpcFji47McP` READY, aliased
  `https://voice-box-psi.vercel.app`; remote build ran `tsc -b && vite
  build` green (2337 modules, 14.25s). Live probes after alias:
  `/api/version` reports commit `04dbf12c562c698401583b96d5fd71272571559a`
  (= the release commit) with `platforms.windows` + `platforms.android`
  both `2.0.1` and the v2.0.1 GitHub URLs (each URL independently HEAD
  200, Content-Length = local verified bytes); app shell HTTP 200 with
  `#root`; `/api/health` returns 403 "Admin only" — the `isAdmin` gate
  firing correctly, not a fault. The four `LATEST_*` vars are set in
  Production (added this loop; Secret-typed, proven to reach the
  function at runtime by the populated feed).
- Unit + contract suites re-run on the release commit `04dbf12`: frontend
  1939/1939 (149 files, `full-fe-201.log`) + API 2121/2121 (187 files,
  `full-api-201.log`) = 4060 green, `tsc -b` 0 (ran inside both release
  builds), `eslint .` PASS (runtime exit 0).
- CI through `3e40020`: "CI — Test, Typecheck & Lint" + "E2E Tests" both
  SUCCESS on the push run (2026-10-10 09:50Z); the PR runs on the same
  head also SUCCESS.
- Cross-device pairing: server issue/redeem contract 11/11
  (`tests/api/identity-link.test.ts` — 6-digit ticket, 5-min TTL, 10
  attempts, issuer must still be live, uniform 403s, ticket burns);
  Settings pairing UI 10/10 (`Settings-identity.test.tsx` — VF- paste
  rejected with hint, confirm-before-adopt, differentiated toasts,
  session-dead targeted hint). Multi-token sessions let web + APK + EXE
  hold live sessions on ONE id (max 8, oldest drops); an adopted id
  without a session can no longer be created client-side.
- Reactions race: unique index `reactions_target_author_kind_uidx`
  (target_id, author_id, kind) verified LIVE in the database; concurrent
  same-identity toggle hitting 23505 now reports the already-active
  truth instead of a 500 (regression test green), any other insert error
  still throws (no fake success).
- Duplicate polls: migration `merge_duplicate_polls_022` APPLIED
  (present in live `supabase_migrations`) + live probe found 0 duplicate
  poll groups and 0 locked-post stray comments.
- Comment-block enforcement: migration `023_comment_lock_enforcement`
  APPLIED (trigger proven live: plain insert refused, admin allowed);
  lock transition purges comments + reports; PUT blocks un-hide on
  locked posts (403 post_locked).
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
- Native shells built from this tree:
  - EXE `Voice-Flow-Desktop-2.0.1-win-x64.exe`, 83.9 MB, electron-builder
    exit 0; asar (3.4 MB) contains the current bundle — `/api/events`,
    `identity-link`, `2.0.1` all present (asar excludes node_modules).
  - APK 7,592,099 bytes, `versionCode 3 / versionName 2.0.1`, label
    "Voice Flow", apksigner verify OK (Android Debug cert), current
    bundle inside (index.html + `/api/events`), WebView cookie patch
    compiled into classes.dex.
  - Both gitignored by design — ship via GitHub Release, never via git.
- Secrets: `.env*` gitignored; service key server-side only; no secret
  in client bundle, logs, or committed files.
- Rollback: `docs/ROLLBACK.md`; deploy runbook `docs/DEPLOY-SCHOOL.md`;
  handover `docs/SCHOOL-HANDOVER.md` + `docs/HANDOVER-CHECKLIST.md`.

## KNOWN FAILURES (accepted or user-gated — none blocks the code)

1. Vote-count flap report (37→2→0) unconfirmed: fake-zero class killed
   and proven, but the exact report needs user screenshots to trace.
2. Single-instance 1,000-user shed (18% 503s on one dev PC): by-design
   load shedding; prod scales per-instance. School-scale rungs all green.

(The two former owner-gated failures — stale production and the empty
update feed — were SOLVED this loop; see the production-deploy entry
under VERIFIED PASS for the probes that prove it.)

## UNTESTED AREAS (do not claim)

- Full prod E2E (browser flows against the live alias). Post-deploy API
  smoke is DONE this loop (`/api/version` freshness + feed, app shell
  200, health gate 403); what remains untested is interactive E2E on
  prod, not the deploy itself.
- 1,000-user load against prod (owner-gated; never run against shared infra
  without explicit approval).
- Hardware install-smoke of the v2.0.1 EXE/APK (owner-side: install over
  2.0.0, pair two devices once).
- Play Store AAB path (debug APK is sideload-only by design).
- macOS DMG shell (no Mac hardware in this loop).

## Release checklist for the owner

DONE this loop (no action needed): production deploy to
`voice-box-psi.vercel.app` from the release tree; the four `LATEST_*`
env vars set to 2.0.1 + the release-asset URLs; `/api/version` re-probed
(commit `04dbf12…`, platforms populated).

1. Install-smoke both v2.0.1 assets over 2.0.0, then pair a second
   device once via Settings → Account (6-digit code).
2. Send the vote-flap screenshots if the report still reproduces after
   the deployed fixes.
3. Approve the gated migrations 016 + 018 (dropping legacy shared tables
   from the publication) — still DBA-gated.
