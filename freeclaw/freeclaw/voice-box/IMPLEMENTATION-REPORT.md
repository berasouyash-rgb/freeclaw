# VoiceFlow release report — 2026-10-30

This report follows the release-deliverable structure (A–I) and separates **evidence actually collected** from **claims that remain unverified**. Commands, counts and timings below were run on this machine in this pass. Nothing here is marked done because a route or button exists.

Local repo version: **2.0.2**. Production web version: **2.0.1** (see A).

---

## A. Web release

| Item | Value |
|---|---|
| Production URL | https://voice-box-psi.vercel.app |
| Status | **Live, HTTP 200** (`/` 200 in 0.47 s; `/api/version` 200) |
| Page identity | `<title>Voice Flow — Anonymous School Feedback Platform</title>` |
| Deployed version | **2.0.1** (from `/api/version`) |
| Repository version | **2.0.2** |
| Deployment date | Not recorded in this pass — **no deployment was performed** |

`GET /api/health` from an unauthenticated client returns `{"error":"Admin only"}` by design (admin-gated), so it could not serve as a public health check. `/api/version` was used instead and confirms the app responds.

**Drift:** production serves 2.0.1 while the repo is 2.0.2. The release therefore is **not** the version verified below unless it is deployed. No deployment was attempted because the task requires a verified deployment/rollback plan and the Vercel credentials and production env are not available in this session. See `docs/DEPLOY-SCHOOL.md`, `docs/ROLLBACK.md`, `docs/RELEASE-GATE.md`.

Note: `https://voice-box.vercel.app` (without `-psi`) is a **different** Next.js deployment and returns 404 for this app. Do not use it as the production URL.

---

## B. Android release

| Item | Value |
|---|---|
| APK | `dist/downloads/Voice-Flow-Android.apk` |
| Size | 7,828,947 bytes (~7.5 MB) |
| Package identifier | `app.voicebox` (`assets/capacitor.config.json`, `android/app/build.gradle`) |
| Version | versionName **2.0.2**, versionCode **4** |
| Signing | v1 JAR signature present (`META-INF/CERT.SF`, `META-INF/CERT.RSA`, `META-INF/MANIFEST.MF`); **self-signed, not Play App Signing** |
| Integrity | `unzip -t` passes; manifest + Capacitor config readable |

Installation: `adb install -r dist/downloads/Voice-Flow-Android.apk`, or copy to the device and allow install from unknown sources.

**Not tested:** the APK was not installed or launched (no connected device/emulator). Full signature verification with `apksigner verify` was **not possible** — Android SDK build-tools (`aapt`, `apksigner`) are absent on this machine. v2/v3 signing and the debug-vs-release build type were not confirmed beyond the v1 entries.

---

## C. Windows release

| Item | Value |
|---|---|
| Installer | `electron/dist/Voice-Flow-Desktop-2.0.2-win-x64.exe` |
| Size | 88,150,740 bytes (~84 MB) |
| Format | NSIS installer (PE32), ProductName "Voice Flow" |
| Version | File/Product version **2.0.2** |
| Code signing | **Not signed** (`Get-AuthenticodeSignature` → `NotSigned`) |

Installation: run the EXE; Windows SmartScreen will warn because the installer is unsigned — "More info" → "Run anyway". Per-user install, no admin rights required.

**Not tested:** installed or launched. Treat as "built and format-verified", not "install-tested".

---

## D. Functional testing report

| Suite | Files | Tests | Result |
|---|---|---|---|
| UI (Vitest + Testing Library) | 170 | 2,351 | **all passed** (518 s) |
| API/handler (Vitest) | 222 | 2,387 | **all passed** (26.5 s) |
| E2E (Playwright, Chromium) | 4 specs | 36 | **32 passed, 4 skipped, 0 failed** |
| TypeScript (`tsc -b --force`, via build) | — | — | **pass** |
| ESLint (`eslint .`) | — | — | **pass, no findings** |
| Production build | — | 75 chunks | **success**, health manifest generated |

E2E detail (dev server on port 5199, identity-verified by global setup as "Voice Flow — Anonymous School Feedback Platform"):

- `user-flows.spec.ts` + `no-horizontal-overflow.spec.ts`: 15 passed, 1 skipped (320/375/430 px and admin-tab overflow checks included).
- `admin-deeplink.spec.ts` + `error-states.spec.ts` + `poll-voting.spec.ts`: 17 passed, 3 skipped (responsive, keyboard, 404, empty states, poll vote/change/results/ARIA).
- Skips are conditional tests in the specs (viewport/tab-gated), not failures.

Bugs found and fixed in this pass:

1. **Admin activity report test contract drifted** after action-filter options were added (duplicate text matches, truncation copy, date-stamped CSV name). Tests updated; 11/11 pass.
2. **Production dependency vulnerability** (`zod`, high) — cleared with `npm audit fix`; production dependency tree is now clean.
3. **Notification ping behaviour** — new tests lock critical-vs-content OS notification rules, prefs suppression and link mapping (35/35 AppContext tests pass).

Previously found and fixed (earlier passes, covered by the suites above): report dismiss/reopen lifecycle, expired-restriction handling, missing notification deep links.

Remaining functional issues: see I.

---

## E. Load testing report

Harness: `scripts/loadtest.mjs` (read-only mixed journeys: `/posts`, `/posts?id=`, `/comments`, `/polls`, `/search`, `/posts?type=suggestion`), against the **local dev server** on `:5199`, not production. Ramp-up 10 s, hold 35 s.

### 250 virtual users — PASS

| Metric | Value |
|---|---|
| Virtual users | 250 (10 s ramp) |
| Requests | 5,662 over 55 s wall (35 s hold) |
| Throughput | 102.9 req/s average |
| Error rate | **0.00%** (5,662 × HTTP 200) |
| Overall p95 | **554 ms** (SLO ≤ 1,000 ms → PASS) |

Per-endpoint (n, p50 / p95 / p99, ms): `/comments` 812, 347/573/654 · `/polls` 307, 585/998/1,121 · `/posts` 3,033, 2/5/8 · `/posts?id=` 812, 303/535/626 · `/posts?type=suggestion` 227, 1/5/465 · `/search` 471, 2/6/936.

### 500 virtual users — FAIL

| Metric | Value |
|---|---|
| Requests | 8,159 over 55 s |
| Throughput | 148.3 req/s |
| Error rate | **9.51%** (776 × HTTP 503) |
| Overall p95 | **3,095 ms** |
| Status codes | 200: 7,383 · 503: 776 |

503s by endpoint: `/posts` 559, `/search` 76, `/polls` 54, `/posts?type=suggestion` 42, `/comments` 28, `/posts?id=` 17.

### Capacity conclusion

- **Actual demonstrated capacity (local dev server): between 250 and 500 concurrent virtual users**, with 250 VU meeting a 1 s p95 at zero errors and 500 VU saturating concurrency (503s under connection/worker limits).
- **Bottlenecks:** the `/posts` list path (dominant request volume and first to 503), then `/polls` and `/search`; `/posts` p99 jumps from 8 ms at 250 VU to ~4 s at 500 VU — queueing, not per-query cost.
- **5,000-VU readiness is not demonstrated.** No 5,000-VU test was run: it requires staging/production infrastructure and explicit authorization, and the local dev server already fails at 500.
- **Not measured:** server CPU/RAM, database p95, connection-pool saturation, and production edge behaviour. No APM is wired into the load harness; resource numbers would be guesses and are therefore omitted.

---

## F. Security report

| Check | Result |
|---|---|
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm audit` (incl. dev) | 23 vulnerabilities, dev-only: 6 moderate, 16 high, 1 critical — all in the `sharp`/`libvips` toolchain used for build-time image work |
| `node scripts/security-scan.mjs` | **0 HIGH**, 1 note |
| Authorization enforcement | Covered by API suites (direct-API role/restriction tests, rate limits, anonymous-privacy tests) — all passing |
| Secrets in repo/client bundle | Scan found no embedded secret |

The single note is `src/pages/admin/AdminSettings.tsx:554`, where the literal string `SUPABASE_SERVICE_ROLE_KEY` appears as documentation text, not a value. No secret is exposed.

Fixes this pass: `zod` high-severity advisory cleared via `npm audit fix` (build/tests re-run afterwards — all green).

Remaining risk: dev-only `sharp` chain (23 advisories, 1 critical) is not shipped to the client or runtime; fixing it requires a breaking major upgrade of the image toolchain. **No OWASP ZAP dynamic scan was run** — there is no ZAP installation/authorization in this environment. No container scan applies (no containers). No penetration test was performed.

---

## G. AI tools report

Evidence files regenerated this pass:

- `docs/AUDIT-100.md` — 39 core + 42 registry workers; checks **1,149 PASS / 343 PARTIAL / 0 FAIL**.
- `docs/CAPABILITIES-100.md` — **102 WIRED / 0 PARTIAL / 0 GAP**.

Scope and permissions: AI is limited to monitoring, diagnostics, classification, summarisation and predefined operations. Tests and audits enforce that AI cannot generate UI, create pages, modify production code, change roles, reveal anonymous identities or delete audit records. Actions route through the existing approval gates (`awaiting_approval`, approvals queue, admin-only endpoints) and are recorded in `activity_logs` / `audit_logs`.

Operational workflows: notification delivery, incident/alert records, case assignment suggestions, complaint classification/priority/duplicate detection, moderation assistance, health/error/performance summaries, workflow executions with history.

Limitations:

- **No code-level "free-model-only" enforcement.** Provider lanes are configurable and include free NVIDIA/Groq endpoints, but a paid-provider fallback is not hard-blocked in `_providers.js`; enforce by configuration until an allowlist is added.
- The **six-stage AI feature lifecycle** (Requested → Planned → Built → Tested → Awaiting Approval → Enabled) is **not implemented under those names**. Task/approval gating exists, but not that exact lifecycle.
- Tool-invocation audit fields (tool, request id, environment, permission decision) are present in the ops layer but were not end-to-end exercised this pass.

---

## H. Deployment documentation

Existing, in-repo:

- **Build:** `npm run build` (tsc + Vite, 75 chunks, health manifest). Native: `npm run desktop:build`; Android build via Capacitor per `docs/NATIVE.md`.
- **Environment:** see `README.md` / `docs/DEPLOY-SCHOOL.md`; required production env includes Supabase URL/key, session secret and AI provider keys. No secret values are recorded in the repo.
- **Database migrations:** SQL migrations under the repo's migration paths; **no migration was applied in this pass** (no production DB access).
- **Backup/recovery:** documented in `docs/ROLLBACK.md` and `docs/OPERATIONS-ENGINE.md`; **no restore drill was executed** (no backup access).
- **Monitoring:** `docs/OPERATIONS-ENGINE.md`, admin System Health, `/api/health` (admin-gated), AI Ops Center, audit logs.
- **Rollback:** `docs/ROLLBACK.md` covers Vercel rollback to a previous deployment; native artifacts are versioned by filename.

---

## I. Known issues

1. **Production is one patch behind** (2.0.1 deployed vs 2.0.2 in repo); not deployed in this pass.
2. **5,000-VU readiness unproven** — 500 VU already fails locally (9.51% 503, p95 3,095 ms); production capacity unmeasured.
3. **EXE is unsigned** → SmartScreen warning; no code-signing certificate available.
4. **APK signing only partially verified** — v1 entries present; `apksigner` unavailable, so signature validity and v2/v3 schemes are unconfirmed.
5. **Native apps were not installed/launched** this pass (no device/emulator/clean Windows VM).
6. **No OWASP ZAP / dynamic security scan**; 23 dev-only dependency advisories remain.
7. **No backup/restore drill** performed.
8. **PDF export = browser print dialog**, not a server-rendered PDF.
9. **Audit keyword search** is substring `ilike`, not ranked full-text.
10. **Dashboard "AI-handled chats"** is a labelled snapshot heuristic.
11. **Search read-gating deliberately unchanged** — five search suites mock `_auth.js` without `checkUser`; adding the gate requires updating them first.
12. **AI free-tier-only enforcement is configuration, not code**; six-stage AI lifecycle absent.
13. **Real-time** is covered by unit/API tests and SSE wake logic, but no multi-client live E2E (two browsers observing one event) was run this pass.
14. **200 micro-interactions** are covered by the motion/interaction test suite and Playwright checks, but no manual review of all 200 was performed.
15. One earlier full API run lost 3 worker forks under load; an immediate clean rerun passed 222/222. Treated as environmental.

---

## Work delivered this pass

### Report lifecycle (admin)
- **Dismiss** (no violation, audited), **Reopen** for resolved/dismissed reports, **Dismissed** filter, bulk **Dismiss unavailable** for deleted targets.
- Backend statuses `pending` / `under_review` / `resolved` / `dismissed`, structured audit with `target_state` and re-read verification.
- Files: [Reports.tsx](src/pages/admin/Reports.tsx), [_reports.js](api/_reports.js)

### Activity report — real audit data
- Server-side period / operator / action / keyword / from-to filters, exact total (`count: "exact"`), honest "N most recent of M" note.
- **Print / PDF** and CSV export, both audited via `log_report_export`; print styles hide chrome.
- Files: [ActivityReport.tsx](src/pages/admin/ActivityReport.tsx), [_admin.js](api/_admin.js), [index.css](src/index.css)

### Dashboard executive metrics
- Poll votes, pending items, AI-handled chats, security events (last 7 days with high/critical count), all from loaded real records; dismissed reports excluded.
- File: [Overview.tsx](src/pages/admin/Overview.tsx)

### Restrictions
- Expired stored restrictions treated as lifted; `setRestriction` refuses past expiry; legacy `browse_only` copy restored alongside canonical `read_only`.
- Files: [_auth.js](api/_auth.js), [_restrictions.js](api/_restrictions.js)

### Notifications
- `notifyUser` accepts `{ postId, link }`; only same-origin paths stored (no open redirect).
- Admin warnings/suspensions/bans/restrictions carry `/chat`; server notices fall back to post or `/activity` by kind.
- `pushNotif` raises real OS notifications: account-critical always, content notices while hidden; respects prefs and mirror switch; 60 s dedupe.
- Files: [_auth.js](api/_auth.js), [_admin.js](api/_admin.js), [AppContext.tsx](src/contexts/AppContext.tsx)

### Suggestion Board — live ranking
- **Top ranked** re-orders with a 520 ms FLIP glide instead of teleporting; both moved cards wear ↑/↓ for 3 s.
- Realtime votes from another device run the same glide; changing sort or filter re-baselines silently (no fake rank chips).
- `prefers-reduced-motion` keeps the re-order and the labels, drops the motion.
- Files: [Suggestions.tsx](src/pages/Suggestions.tsx), [useFlipList.ts](src/hooks/useFlipList.ts), [RankDelta.tsx](src/components/RankDelta.tsx)

### Tests updated
`src/__tests__/AdminActivityReport.test.tsx`, `src/__tests__/AppContextCore.test.tsx`, `tests/api/escalation.test.ts`, `tests/api/reports.test.ts`, `src/__tests__/rankMotion.test.tsx`, `src/__tests__/Suggestions.rankMotion.test.tsx` (new), `tests/e2e/suggestion-rank.spec.ts` (new).
