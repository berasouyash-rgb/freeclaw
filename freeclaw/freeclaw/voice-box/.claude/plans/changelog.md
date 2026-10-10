# Evidence Changelog — Voice Flow Improvement Loop

Every entry: PROBLEM / ROOT CAUSE / CHANGE / WHY / TESTS / RESULT / REGRESSIONS CHECKED / REMAINING RISKS.

---

## 2026-09-17 — Test determinism: AiPanel flaky rAF animation

- **PROBLEM:** `src/__tests__/AiPanel.test.tsx` intermittently failed (CountUp animated value stuck below target when rAF fired late).
- **ROOT CAUSE:** `CountUp.tsx` animates 0→value over 900ms via real `requestAnimationFrame`; under load, frames don't fire before assertions.
- **CHANGE:** rAF stub in test `beforeEach`: `vi.stubGlobal("requestAnimationFrame", (cb) => { cb(performance.now() + 1000); return 1; })`. Product code untouched.
- **WHY THIS APPROACH:** Test determinism for timing flake only; changing the animation would alter product behavior.
- **TESTS/RESULT:** 20/20 pass; verified inside full suite (90 files / 1514 tests PASS).
- **REGRESSIONS CHECKED:** Full frontend suite green.
- **REMAINING RISKS:** None known.

## 2026-09-17 — Test determinism: AdminTabSweep OOM/timing flake

- **PROBLEM:** Sweep test flaked on ErrorTracking tab (Sentry import + 4 parallel loads + 30s interval + realtime polling).
- **ROOT CAUSE:** One shared 30s timeout for all tabs; heavy tabs legitimately need longer. Intent of the test is no-crash, not latency.
- **CHANGE:** `heavyMounts` Set (`ErrorTracking`, `AIOperations`, `AdminAI`, `Overview`); per-tab timeout 90s heavy / 30s default with comment.
- **TESTS/RESULT:** 23/23 pass; combined run with AiPanel 2 files / 43 tests PASS (3.57s).
- **REGRESSIONS CHECKED:** Full frontend suite green.
- **REMAINING RISKS:** None known.

## 2026-09-17 — INCIDENT: widgets.tsx truncated to 0 bytes (disk-full write failure)

- **PROBLEM:** During an edit, `src/lib/dashboard/widgets.tsx` was truncated to 0 bytes; git writes also failed ("Out of diskspace", stale `index.lock`).
- **ROOT CAUSE:** C: drive reached ~0 bytes free. The `edit` tool write failed mid-operation, leaving an empty file. Uncommitted 2-line change on the file (`SOURCES` annotated `Record<string, DataSource>` → `satisfies`) was lost with it.
- **CHANGE/RECOVERY:** Freed ~205MB on C: (Temp crash dumps, INetCache, pip cache, opencode cache); removed stale `.git/index.lock`; `git checkout -- src/lib/dashboard/widgets.tsx` restored the 49,659-byte HEAD version; re-applied the `satisfies` change byte-identical to the pre-incident diff (verified via `git diff` before applying the `kind` fix); then completed the intended fix.
- **WHY THIS APPROACH:** File was recoverable from git; the lost diff was fully captured in context and re-applied verbatim.
- **TESTS/RESULT:** Post-recovery full gate: tsc exit 0, lint exit 0, frontend 90/1514 PASS, API 50/737 PASS, build 46.87s PASS.
- **REGRESSIONS CHECKED:** Full suites above.
- **REMAINING RISKS / PREVENTION:** C: still tight (~6–8GB free after build cleanup). Mitigation: verify file size after large edits; monitor disk before builds; consider moving npm cache to D: (not done — needs user decision).

## 2026-09-17 — Build fix: DashboardBuilder `w.kind` TS2339 (2 errors)

- **PROBLEM:** `npm run build` failed at `tsc -b`: `DashboardBuilder.tsx(386,42)` and `(388,20)` — Property 'kind' does not exist on type `WidgetDef`. Pre-existing in uncommitted gallery work (not ours).
- **ROOT CAUSE:** Uncommitted gallery feature renders a "Widget type" chip from `w.kind`, but `WidgetDef` never defined `kind`. Not a typo — an unfinished field.
- **DEBATE:** (A) Add `kind: WidgetKind` to `WidgetDef` + all 7 factories — honors the feature's intent, type-safe, no consumer change. (B) Remove the chip — deletes an intended feature. Chose **A**.
- **CHANGE:** `src/lib/dashboard/widgets.tsx`: added `export type WidgetKind = "stat" | "count" | "bars" | "list" | "series" | "gauge" | "status";` + `kind: WidgetKind` field on `WidgetDef`; set `kind` in `statWidget`/`countWidget`/`barsWidget`/`listWidget`/`seriesWidget`/`gaugeWidget`/`statusWidget`.
- **WHY THIS APPROACH:** Root-cause fix (field was missing, not misused); gallery chip keeps working.
- **TESTS/RESULT:** `npx tsc -b --pretty false` exit 0; `npm run build` exit 0 (`✓ built in 46.87s`); lint exit 0; frontend 90/1514 PASS; API 50/737 PASS.
- **REGRESSIONS CHECKED:** WidgetCard.tsx consumes `WidgetDef` — covered by dashboard-widgets tests + full suite. Full suites green.
- **REMAINING RISKS:** None known.

## 2026-09-17 — P0 SECURITY: /api/workforce-api admin gate was a no-op (auth bypass)

- **PROBLEM:** `api/_workforce-api.js:35` — `if (!isAdmin(req)) return res.status(401)...`. `isAdmin` is `async`, so it returns a Promise; a Promise is always truthy, so `!isAdmin(req)` was **always false**. The 401 branch was dead code.
- **IMPACT (unauthenticated attacker could):** `execute-tool` (run any registered worker tool through the real gateway, incl. write tools), `rollback` (revert worker actions), `unpause` (resume paused workers), `audit`/`impact`/`status` (read internal audit trail + impact log), `training-status`. One of the highest-severity findings possible: remote unauthenticated privileged action.
- **ROOT CAUSE:** Missing `await` on an async guard. Classic async-truthiness bug (same class as `if (!checkUser(x))`).
- **DEBATE:** (A) Add `await` — one-token root-cause fix, matches all 98 other correct call sites. (B) Add a sync `isAdminSync` — unnecessary new API surface. Chose **A**.
- **CHANGE:** `api/_workforce-api.js:35` → `if (!(await isAdmin(req)))`. No other changes.
- **WHY THIS APPROACH:** Minimal, matches the proven convention used across every other admin route; introduces no new abstraction.
- **TESTS (red→green):** New `tests/api/workforce-api-auth.test.ts` (4 tests). RED first: 3/4 failed (`expected 200 to be 401`), proving unauthenticated `status`, `execute-tool`, and `rollback` all reached the handlers. After the fix: 4/4 GREEN (401 on unauth; `executeTool`/`executeRollback` asserted **not called**; authenticated admin reaches the action).
- **RESULT (full gates):** API suite **51 files / 741 tests PASS** (was 50/737). Frontend **90 files / 1514 tests PASS**. `tsc -b` exit 0. `eslint .` exit 0. `npm run build` exit 0 (`✓ built in 13.76s`).
- **REGRESSIONS CHECKED:** Scanned all API files for the same bug class (`!checkUser(`, `!verifyCallerIdentity(`, `!hasUsableLLM(`, `!isAdmin(` without `await`) → **zero** other instances. Full API + frontend suites green.
- **REMAINING RISKS:** `isAdmin` reads admin tokens from a `settings` row; if that row is ever world-readable via a broad RLS policy, tokens could leak. Out of scope for this fix — flagged for a future iteration. Search-function internals of `isAdmin` (the 30s token cache) were not altered.

## 2026-09-17 — SECURITY (defense-in-depth): /api/data-export had no identity gate

- **PROBLEM:** `api/_export.js` performed NO caller check. Anyone who knew a user's `anon_id` (it is public — posts/comments carry `author_id`) could `GET /api/data-export?anon_id=X` and pull that user's full bundle, including PRIVATE data: notifications, saved, follows, poll votes. The endpoint docstring promises "Personal data leaves only at the caller's request" — cross-user export violates that contract.
- **ROOT CAUSE:** The handler trusted the client-supplied `anon_id` query param alone. `protect()` in `api/_production-error.js` is an error-hardening wrapper only (CORS + no-internal-leak) — it is NOT auth. Verified: route `"data-export": protect(dataExport, ...)` in `api/index.js:275`.
- **CHANGE:** Added `verifyCallerIdentity(req, id)` gate after the `anon_id` parse, returning `caller.status`/`caller.error` on denial (same pattern as `api/_saved.js:52` and `api/_follows.js:127`). 3 new regression tests in `tests/api/data-export.test.ts` (identity-gate describe): 403 + zero DB reads when gate denies; gate called with the claimed anon_id; gate-ok path returns the bundle.
- **HONEST LIMITATION (NOT a full fix):** `verifyCallerIdentity` compares the client-supplied `x-anon-id` header to the claimed `anon_id` — it enforces identity CONSISTENCY, not AUTHENTICATED ownership. An attacker who sets both header and query to victim's `anon_id` still gets the bundle. This change raises the bar to parity with sibling endpoints (no more zero-requirement export) but true authentication (e.g. signed session/HMAC) is a product design decision — requires human approval, not autonomously imposed.
- **TESTS (red→green):** RED confirmed first: 3 new tests failed (`expected 200 to be 403`; `verifyCallerIdentity` 0 calls) proving the handler ignored identity. After fix: file 9/9 PASS. Full gates: API **51 files / 744 tests PASS**, frontend **90 files / 1514 PASS**, `tsc -b` exit 0, `eslint .` 0 errors (20 pre-existing warnings in `src/api-js.d.ts` — not ours), `npm run build` exit 0 (10.99s).
- **REGRESSIONS CHECKED:** Frontend caller verified non-breaking: `MyActivity.tsx:161` uses `api.get`, which attaches `x-anon-id` for the session (`src/lib/api.ts:126`); admins pass via `verifyCallerIdentity`'s admin bypass. Rate-limit test (11 reqs) still passes — gate runs after rate limit and missing-`anon_id` 400.
- **PROCESS NOTE:** Reviewer-subagent critic pass could NOT run — all `task` dispatches failed with model-routing errors (`anthropic/claude-sonnet-4-5`, `openai/gpt-5.2-codex`, `anthropic/claude-haiku-4-5-20250929` not found). Critic pass performed inline (saved.js/follows.js pattern comparison, test-mock regression fix, comment cleanup). Independent review still pending.
- **REMAINING RISKS:** (1) Header-consistency is spoofable — authentication upgrade needs a human decision. (2) `users_meta` profile fields beyond SAFE_PROFILE_FIELDS are already stripped (FIX-#1) — unchanged. (3) Rate limit is per-IP in-memory — resets on cold start (pre-existing).


- **CHANGE:** Loop runbook + this evidence changelog written under `.claude/plans/` (sequential loop, safe mode). Stop conditions documented in `loop-runbook.md`.
- **REMAINING RISKS:** C: drive free space fluctuates (7.5GB free at last check, ~0 during an earlier incident). Builds/edits on C: remain the main environmental hazard.
