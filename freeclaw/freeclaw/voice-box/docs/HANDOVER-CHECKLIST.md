# Handover acceptance checklist

The school signs each line only against **evidence**, not claims.
Check the box, name the evidence, date it.

## Release verification (engineering)

- [ ] `npm run build` passes on a clean checkout (Vercel runs this)
  — evidence: build log, 2026-09-23 ✅
- [ ] `npm run typecheck` — 0 errors — evidence: this session ✅
- [ ] `npm run lint` — 0 errors — evidence: this session ✅
- [ ] `npm run test:api` — 106 files / 1208 tests, 0 failures
- [ ] `npm test` (frontend) — 84 files / 1364 tests, 0 failures
- [ ] `npm run test:e2e` — Playwright suite in `tests/e2e/`, 0 failures
  (needs `VB_ADMIN_PASSWORD` for admin-login cases; cases skip by design
  without it — run: `npm run dev` in one terminal, `npm run test:e2e`
  in another)
- [ ] `npm run audit:workers` — FAIL 0 (980 pass / 303 documented partials)
- [ ] `npm run audit:capabilities` — WIRED 102 / GAP 0
- [ ] `npm run audit:security` — 0 prod vulnerabilities, 0 HIGH static findings
- [ ] Load envelope (`load/report.md`): 10- and 100-concurrency WITHIN;
  500-concurrency latency breach documented as dev-topology-only, 0 errors
  at every level

## Deployment (school IT)

- [ ] Supabase project created; migrations `001`→`015` applied in order
  (both `013` files, guard passes)
- [ ] Storage buckets `chat-media`, `voicebox-media` created (private)
- [ ] Realtime replication enabled for posts/comments/polls/poll_votes/reports/notifications
- [ ] Vercel env vars set per `docs/DEPLOY-SCHOOL.md` §4 (service key is
  NOT `VITE_`-prefixed — verify by viewing the env list)
- [ ] Production deploy green; all 3 cron jobs ticking every 5 min
- [ ] Smoke tests §6 of the deploy doc pass on the live URL (post,
  block+appeal+overturn round-trip, ops center, realtime)
- [ ] Daily backups confirmed; PITR enabled on paid plans
- [ ] Admin passphrase in the password manager; hash in Vercel; test login works
- [ ] Escalation contacts filled in `docs/SCHOOL-HANDOVER.md` §5

## Product behavior (witnessed live, not in screenshots)

- [ ] Slang/profanity posts are BLOCKED with no stars (zero tolerance)
- [ ] Blocked author sees an appeal panel; appeal reaches AI Review
- [ ] Overturn publishes + notifies; uphold notifies with guidance
- [ ] Victim help-seeking reports are held for humans, never auto-blocked
- [ ] PII (address/phone/email/ID) cannot publish on any surface
- [ ] Evasion (leet, full-width, zero-width splitters) is blocked;
  spaced/dotted joining is a documented known gap
- [ ] Admin mistakes are reversible (unpublish, revoke sessions, rollback build)

## Documents handed over

- [ ] `docs/DEPLOY-SCHOOL.md` (crate-to-live runbook)
- [ ] `docs/SCHOOL-HANDOVER.md` (operator guide, contacts filled)
- [ ] `docs/SAFETY-MODERATION.md` (safety contract)
- [ ] `docs/AUDIT-100.md` + `docs/CAPABILITIES-100.md` (machine-verified)
- [ ] `load/report.md` (measured envelope, honest limits)
- [ ] `docs/ROLLBACK.md` (emergency rollback)
- [ ] This checklist, signed: _______________ date: ________
