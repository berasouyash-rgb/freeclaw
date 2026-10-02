# Voice Box Workforce Loop — Runbook

Pattern: `sequential` / Mode: `safe`
Branch: `initial-review-branch` inside `voice-box/.git` (verify HEAD with
`git log --oneline -1`). One commit per verified slice.
Never `git add -A`. Never touch unrelated dirty entries.

## Baseline facts (verified, not assumed)

- Stack: Vite + React 19 + TS + Tailwind v4 + Supabase/Postgres; consolidated
  Vercel `api/index.js`; optional FastAPI `services/`. No Next.js / shadcn /
  React Query / Zod — extend, do not replace.
- Workforce engine exists: lifecycle + ledger + budgets
  (`api/_workforce-core.js`), independent verifiers
  (`api/_workforce-verification.js`), proof API (`api/_workforce-proof-api.js`).
- Worker limits of THIS environment (measured): full `tsc -b`, full
  `eslint .`, and full `vitest run` crash or time out. Per-slice scoped gates
  only; full suite belongs to CI. Never claim full-green locally.
- Subagents unavailable (model errors) — single implementer, no delegation.
- Tree carries ~390 pre-existing dirty entries (mass admin-page deletions,
  untracked prior-session files). Not mine; do not commit, revert, or review
  them. Stage only the slice's own files.
- Repo boundary (verified slice 27): `voice-box/.git` is nested inside the
  outer freeclaw repo (branch `review-fix`). All slice commits run with
  workdir `voice-box/`, never the outer repo; the outer repo must never
  receive voice-box files. Slice 27 was first committed to the outer repo by
  mistake (`273b32e`) and reverted there with a mixed reset (working tree
  untouched) — the canonical slice-27 commit lives only in this repo.
- Slices 1–26 were committed here all along; earlier "never committed"
  forensics queried the outer repo and was wrong. No backfill needed.

## Slice backlog (sequential)

1. DONE (a27abd0): comment-watch public-path propagation verify + evidence receipts.
2. DONE (8c1e3e5): safety repost guard — normalized fingerprint blocklist recorded
   on safety block/hide, checked at write time (403 SAFETY_REPOST_BLOCKED);
   hidden posts excluded from duplicate-title check.
3. DONE (fb3b214): post-removal propagation — `_posts.js` PUT unlist.
4. DONE (84df95d): admin evidence panel reading persisted receipts (Logs.tsx).
5. DONE (9541ac6): live bug fixes + capability — feed cache invalidation
   (`feedSWR.invalidate()`), Excel case export ("the invoice"), masking/realtime
   hardening. Docs: `docs/PERF.md`.
6. DONE (7380250, ec8ffc3, c2bd567): notification retry-verify, queue
   stuck-job recovery, resolution reopen — each an inspected slice with
   independent read-back verification.
7. DONE (e5d707d, other session): workforce B2 verified case triage workers.
8. DONE (83747a0): complaint slice — context-aware moderation
   (coercion/victim demotion, slang-in-context), inbox topic + AI summary in
   list, record-then-transcribe voice submit. 134/134 focused tests.
9. DONE (39b7ca5): comment-path gate parity — coercion/victim demotion is
   STRUCTURAL inside `moderateContent(text)` (no context param; coercion
   never blocks), so gate parity in Comments.tsx fulfills the intent; server
   stays authoritative, raw body sent, masking display-only.
10. DONE (b01b9da): pre-publish agent depth — decision forcing on both paths:
    PII/threat/hate/blackmail/self-harm → high_risk, any safety → revision
    floor (emergency + AI path); first-person SELF-HARM with reporting-word
    guard (victim reports stay safe); `doxxing_detected` wired to name+address;
    Submit gate uses server-verbatim `submitBlockMessage` + sends RAW fields
    (server masks at insert); rename `isBlockedForComment` → `isBlockedByServer`.
    Gates: 30 api + 86 src green, eslint clean.
11. DONE (1b70aec): Coworker (AI chat) works like ChatGPT — in-turn
    tool loop (read-only tools execute now, REAL results fed back for a
    grounding pass; destructive stay approval cards), hardened
    `parseAgentResponse` (never returns raw JSON — fenced/bare/reply-only
    recovery, "" → intent/fallback chain on unrecoverable structure),
    `friendlyError()` (honest guard messages pass, SQL/provider internals
    never reach the UI; all 6 intent leak sites + execute results routed).
    Gates: 25 api (14 new + 11 sql) + 5 src green, eslint clean.
12. DONE (304d7f2): Reports admin UI redesign — outcome-first,
    remove/resolve "open reports" concept per user (reports are normal
    reports only); 3-tab model + status chips + conditional Review/Dismiss,
    Overview metric/panel relabelled Reports + REPORTS heading with real
    counts, `report-groups.ts` grouping, `api/_reports.js` evidence +
    SpreadsheetML export; gates: 54 src + 27 api + eslint clean.
13. DONE (c3ed3f3): Remove standalone Training Center surface (training
    runs in background in `api/_training-lab.js`); AI Quality page ships
    without its Training scenarios card; verified no route/tab references
    remain (none existed anywhere in src); gates: 21 src (AdminAIQuality 6
    + AdminTabSweep 15) + eslint clean.
14. DONE (this commit): Agent action cards wired to real evidence —
    `agent-chat/evidence.ts` (extractEvidence/flattenArgs/summarizeArgs:
    sentence + label/value rows + entity lines, depth/size caps, html/raw/
    stack never echoed), ActionCard renders rows/items + verify-in-tab
    hint instead of `safeStringify` <pre>, cards start expanded and the
    header always toggles evidence (completed cards were unreachable
    before), GenericPreview + bulk_update router show flattened arg rows,
    never JSON. Foreign-owned OpsCenter/api analyze-time surfaces left to
    their concurrent session; ActivityStream already evidence-driven.
    Gates: new ActionCardEvidence 6 + foreign canary AdminAgentChat 5
    green, eslint clean.
15. DONE (this commit): Operations Engine foundation (spec §4) —
    `api/_ops-events.js` typed event ingest + durable `ops_event_log`
    (53-type catalog, 11-field envelope, dedup key, 500 cap, throws on
    failed write, non-mutating append); real producer step 5 in
    `api/_incident-cron.js` (PERIODIC_HEALTH_CHECK per 5-min bucket,
    measured metrics payload, failure lands in errors — never silent)
    + read-back surface `?action=events`. Trust & Safety enrollment:
    `api/_worker-contracts.js` 10 contracts (FRAMEWORK §3 shape, §8.2
    classes/degrade), validateContract, assertDispatchable (R14 —
    exported, NOT wired: all dispatch files foreign-modified, wiring
    still open). Gates: new tests 21 green (held-out catalog count 53,
    §8.2 triples, bucket idempotency, cap, failure-never-success,
    read-back), eslint clean on 5 files. Still open: R14 gate wiring,
    FRAMEWORK §8 → spec §7 mapping (deferred to next docs touch).
16. DONE (slice 16) — Durable work queue (spec §5): 11 states, 17
    fields, idempotent enqueue, priority claim, mandatory-evidence
    verification, backoff retries, dead-letter, stale-claim recovery,
    dependency promote/block, `?action=queue` read-back.
17. DONE (slice 17) — Queue producer + verified worker: incident
    detection enqueues `incident.triage` jobs (severity → priority,
    idempotency `incident.triage:<id>`), and a consumer runs the full
    observe→decide→act→verify loop with an independent re-read before
    COMPLETED; then domains enrollment, with FRAMEWORK §8 → spec §7
    mapping.
18. DONE (slice 18) — Domains enrollment + FRAMEWORK §8 → spec §7
    mapping: the 6 §8.1 orchestration contracts enrolled in
    `_worker-contracts.js` behind `ALL_CONTRACTS` (R14 gate serves
    both domains), canonical 17-system crosswalk in
    `api/_domain-map.js` (`validateDomainMap` tamper-evident), §8.9
    table in FRAMEWORK.md (docs stay uncommitted per hold), 9-test
    held-out gate.
19. DONE (slice 19) — Spec §45 end-to-end operation tests:
    `tests/api/e2e-operations.test.ts` (6 tests) chains the real
    committed modules end to end — TEST 5 (notification failure →
    dead-letter fallback + evidence → retry → delivered only after
    independent read-back; lying writes burn attempts to a dead
    letter), TEST 6 (worker dies → `recoverStaleJobs` sweeps the
    stale claim → backoff release → second worker completes),
    TEST 9 (false success held in VERIFYING → verification rejects →
    RETRYING → recovery; ownership/evidence/failureReason gates).
20. DONE (slice 20) — Spec §45 TEST 10 worker value audit:
    `api/_value-audit.js` producer enumerates declared + queue-discovered
    workers into one `worker.value-audit` job per worker per UTC day
    (rolling 24h window in input; discovery failure surfaced, declared
    workers never dropped); consumer observes fresh queue state, decides
    `verified` (≥1 COMPLETED + evidenced job in window) or `flagged`
    (reason names held-open vs idle/never-dispatched), acts on the
    durable `worker_value_flags` current-state registry (later passing
    audits supersede stale removal demands) + `activity_logs` attempt
    rows, then independently re-reads both before evidence/resolve —
    dropped flag writes fail verification to RETRYING, never COMPLETED.
    Trigger `GET /api/incident-cron?action=value-audit` (produce +
    consume + flag read-back in one call), scheduled daily in
    `vercel.json` crons. 6 tests cover producer idempotency/discovery,
    the full TEST 10 chain, supersede, the false-success gate, and the
    input contract.

21. DONE (slice 21) — Community + Search & Knowledge domain contract
    enrollment: added 11 contracts to `api/_worker-contracts.js` (6
    §8.3 Community: duplicate-detection, issue-clustering, priority,
    case-lifecycle, poll-operations, community-health; 5 §8.4 Search &
    Knowledge: search, ranking, rag, knowledge-updates,
    zero-result-recovery) with helpers READ_POLLS/SET_PRIORITY/
    CREATE_POLL/SEARCH_KB — first-token-primary dual-token rule
    (DS+EO/DS+CH→deterministic_sweep with secondary phase in comment,
    A/B→class A + classDegradeTo B, E/C→event with cron noted in
    expr), declared (not deployed) cron exprs, read-only evidence
    envelope for Knowledge Updates since `update_knowledge_base` is
    absent from the foreign-modified registry, caps by primary class,
    label-style ui. Held-out gate `tests/api/domain-enrollment.test.ts`
    copies §8.3/§8.4 rows with the mapping rules (14 tests green,
    ESLint exit 0); ALL_CONTRACTS now 27 across 4 domains.

22. DONE (slice 22) — Platform domain contract enrollment: added 7
    §8.5 contracts to `api/_worker-contracts.js` (database, cache,
    queue, realtime, storage, notifications, performance) with new
    helper EXEC_SQL — Database on execute_sql's single-SELECT
    least-privilege envelope (admin, no approval) for the V4
    EXPLAIN/latency check; class "A/B" → A + classDegradeTo B;
    "DS+EO" → deterministic_sweep with EO phase in comment; declared
    (not deployed) crons (hourly staggered, every-10 backlog,
    every-30 load manager) + real event names (CACHE_FAILURE,
    NOTIFICATION_FAILURE|EMAIL_FAILURE|SMS_FAILURE|PUSH_FAILURE);
    all envelopes read-only, caps by class, OpsCenter ui maps to the
    ops-center nav key. Held-out gate `domain-enrollment.test.ts`
    copies §8.5 rows + mapping (17 tests green, ESLint exit 0);
    ALL_CONTRACTS now 34 across 5 domains.

23. DONE (slice 23) — Security domain contract enrollment: 5 §8.6 contracts (39 total, 6 domains), observation-only posture via escalate_issue; 20 tests green, ESLint 0.

24. DONE (slice 24) - Quality domain contract enrollment: 7 §8.7 contracts (46 total, 7 domains), quality crons declared not deployed; 23 tests green, ESLint 0.

25. DONE (slice 25) - Coworker domain contract enrollment: 8 §8.8 contracts, ALL_CONTRACTS = 54 across 8 domains (complete), R5 observation-only tools; 26 tests green, ESLint 0.

26. DONE (slice 26) — §46 acceptance sweep: ran 339 focused tests across 34 files (6 batches, all green). Verdict table for all 32 §46 items (SPEC L1925–1956):

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | events are real | PASS | ops-events 12 green; ops_event_log append-only, THROWS on write failure, dedupe by key |
| 2 | queue is durable | PASS | work-queue 44 green; settings KV `work_queue`, 11 states, read-backs |
| 3 | workers execute real work | PASS | e2e-operations 6 green (TEST 10 end-to-end chain), value-audit 6 |
| 4 | tools execute real operations | PASS | v3-tools 15, tool-sql-parity 10, agent-chat-sql 11, dispatch 12 — all green |
| 5 | permissions are enforced | PASS | authorization 1, idor-protection 8 green |
| 6 | safety on posts/comments/replies/messages/uploads | PASS | safety-pipeline 12, server-moderation 11, safety-parity 7 green |
| 7 | slang interpreted in context | PASS | slang-gate 5, comment-slang-tiers 10 green |
| 8 | harmful content → real enforcement | PASS | server-moderation 11 green (enforcement actions asserted) |
| 9 | harmless content not punished for slang | PASS | comment-slang-tiers 10, safety-parity 7 green |
| 10 | database operations are real | PASS | agent-chat-sql 11 green (real-row fallback, non-SELECT rejected honestly) |
| 11 | performance operations are real | PASS | search-perf 4 green (cache bounds, real timings); §45 TEST 4 DB benchmark still deferred (separate) |
| 12 | queues recover automatically | PASS | workforce-recovery 14, recoverStaleJobs, work-queue 44 green |
| 13 | notifications recover automatically | PASS | notification-delivery 18, notifications 15 green |
| 14 | search operations are real | PASS | search-gap-recovery 3, search-perf 4 green |
| 15 | security tests are real | PASS | authorization 1, idor-protection 8, security-domain contracts green |
| 16 | QA interacts with actual product | PARTIAL | component tests pass (AdminAgentChat baseline 5/5); live-browser run blocked (browser tools disconnected) |
| 17 | AI quality continuously evaluated | PASS | workforce-quality 7, workforce-batch5 8 (real _evaluation-engine/_drift/_golden-workflows), continuous-learning 6 green |
| 18 | failures are visible | PASS | listDeadLetters + dead-letter read-back, value-audit flags, ops events green |
| 19 | verification is independent | PASS | worker-independent-verify 3 green (verify ≠ executor) |
| 20 | evidence is recorded | PASS | evidence-scan 16 green; COMPLETED carries evidence payload |
| 21 | audit trail exists | PASS | admin-audit-reads 3 green (activity_logs) |
| 22 | admin UI reflects real state | BLOCKED | OpsCenter.tsx/Admin.tsx foreign-modified — queue read-back UI unwired; module read-backs pass via incident-cron action= |
| 23 | AI Coworker can delegate real work | PARTIAL | dispatch 12 + cw-delegation contract enrolled; R14 cron-gate wiring blocked (agent-cron/_automation-registry foreign) |
| 24 | background work continues without admin presence | PASS | vercel.json crons + _incident-cron action surface, work-queue/ops-events tests green |
| 25 | watchdog exists | PASS | workforce-supervisor-gate 4 green (_worker-supervisor.js) |
| 26 | rollback exists | PASS | continuous-learning 6 green (canary expand/rollback decision) |
| 27 | disable tests exist | PASS | worker-disable-tests 3 + all 54 contracts carry disableTest (domain-enrollment 26) green |
| 28 | cost controls exist | PASS | workforce-cost-intel 3, value-audit 6 green; per-class caps in contracts |
| 29 | model routing exists | PASS | providers 23 green (fallback chain across tiers) |
| 30 | regression datasets exist | PASS | workforce-batch5 8 green — golden-workflows runs real journeys (17 pass/3 fail asserted) |
| 31 | no fake metrics exist | PASS | value-audit 6 green (ghost/idle detection flags, not invented numbers) |
| 32 | no fake completion exists | PASS | work-queue applyFailure never FAIL→success; evidence-scan 16 green |

Score: 29 PASS, 2 PARTIAL (16, 23), 1 BLOCKED (22). Open work tracked as slices: §45 TEST 4/7/8, TEST 1–3 (foreign safety surfaces), admin-UI read-back, R14 wiring, live-browser QA.

27. DONE (slice 27) — Full-corpus regression sweep + §45 TEST 8 audit leg closed:
   - **Corpus evidence**: all 112 test files under `tests/api/` executed green across
     slice-26's 6 batches (339 tests/34 files) + 8 further batches (~775 tests/~80
     files), 0 failures. This is the complete api test corpus, not a sample.
   - **Model-routing honesty re-verified in code** (`_providers.js` L1028–1154):
     explicit Tier 1–5 NIM fallback chain with racing/staggered fallback and
     `NIM_MAX_CONCURRENCY=1` (measured 2.5–10s solo) — corroborates §46 #29 PASS.
   - **§45 TEST 8 now closed end-to-end**: `api/v3/_tools.js` (clean, owned) writes
     `log.security("permission_denied", …)` on registry permission rejections in
     both execute and batch paths (target/role/reason/requestId/ip,
     `action_taken: "blocked"`); only permission rejections are audited — routine
     tool/validation failures create no security event. New held-out gate
     `tests/api/v3-tools-unauthorized-audit.test.ts` (5 tests) locks the chain:
     reject→400→audit event, batch per-denied-item audit, honest negatives, and
     read-back via `_security-events.js` serving `permission.denied` at severity
     medium with the recorded reason. 21/21 green (incl. regression of
     `v3-tools` 15 + `authorization` 1); `npx eslint` clean.
   - **§45 TEST 6/9 chains evidenced** (leg tests green): worker-backoff 9 +
     workforce-supervisor-gate 4 (watchdog pause after 3 failures / runaway loop,
     unpause explicit) + work-queue stale-claim recovery = TEST 6;
     worker-independent-verify 3 + value-audit 6 (false-success never COMPLETED,
     no-persist write → RETRYING) + notification-delivery 18 ("never claims
     delivery when the read errors") = TEST 9.
   - Still open (blocked as before): §45 TEST 1–3 (foreign safety surfaces),
     TEST 4 (no DB benchmarking surface), TEST 7 (`_search-quality.js` foreign);
     §46 #16/#22/#23; R14 wiring; live-browser QA.
28. DONE (slice 28) — §45 TEST 1–3 chain closed + `_polls.js` import gap fixed
   (`42252d3` pipeline + tests, `932a846` chain test):
   - **Import-closure defect found and fixed.** `api/_polls.js:18` (committed,
     clean) imports `./_safety-pipeline.js`, which existed only as an untracked
     worktree file — `git ls-tree` was empty at HEAD, so a fresh clone threw on
     that import. Blast radius is wider than one file: `_appeals.js:34`,
     `_comments.js:19`, `_posts.js:18` and `_polls.js:18` all import it; the
     first three live in foreign-modified files, so only `_polls.js` was
     committed breakage. Deleting the import would have removed working poll
     safety, so the fix was to commit the module. `42252d3` adds
     `api/_safety-pipeline.js` + its 2 test files (434 insertions); its own tests
     passed 19/19 before staging, eslint exit 0. Import closure verified — its
     deps `_translate.js` and `_moderation.js` are both tracked.
   - **§11 producer discovered — the record is read, never composed.** An earlier
     pass recorded "no standalone §11 enforcement-record producer; do not
     fabricate." Right caution, wrong conclusion: the producer is
     `evaluateContent` in the (then untracked) pipeline, returning
     `action, classification, confidence, policy, reasons[], trace[], …`. The new
     test asserts those real fields and cross-checks the cited `policy` id
     against `getPolicyTable()`, so the record cannot drift into a label the
     table does not contain.
   - **New `tests/api/content-safety-chain.test.ts` (3 tests)** composes the §12
     chain against production code; only the database is doubled. TEST 1:
     NEW_COMMENT via `buildEvent`/`appendEvent` → real `serverModerate` → real
     `evaluateContent` → `watchComments` hide+strike+verify (1/1/1, 0 errors) →
     `collectBefore`/`collectAfter`/`computeDiff` proves `hidden` false→true →
     `listEvents` independently re-reads the event and its traceId. TEST 2:
     harmless complaint → 0 flags, no action, still public, no audit. TEST 3:
     coded harassment ("no one likes you") → understood, `BLOCK_ACTION`, removed
     and verified.
   - **A defect in my own double, caught by the gates:** the first run failed 2/3
     because the DB double returned the *live* row from `collectBefore`, so the
     worker's write mutated the already-captured "before" snapshot and
     `computeDiff` reported no change. Real reads return values, not references;
     read paths now copy. Recorded because the failure mode — a "before" that
     moves under you — is exactly the kind of false green this project forbids.
   - **Assertion parity preserved.** `_moderation.js` and `_comment-watch.js` are
     tracked but also carry uncommitted worktree-only changes (profanity/slang
     gate, leet folding, `notifyUser` receipt). The test asserts only behavior
     shared by the committed and worktree versions — blocking verdicts,
     critical severity, hide/struck/verified counts, the `hidden` diff, event
     read-back — and deliberately avoids `policy`-id equality, which legitimately
     differs once the worktree adds a profanity flag ahead of `critical-harm`.
   - **Blast radius verified after adding the module:** 7 files / 106 tests green
     (comments-full 27, polls-full 39, appeals 12, comment-watch 6,
     safety-pipeline 12, safety-parity 7, chain 3), exit 0. The full-corpus
     re-run aborted with `fatal error: runtime: cannot allocate memory` inside
     esbuild — an environment limit, not a test failure; C: free space is now
     ~124 MB, so a corpus-wide re-run needs disk reclaimed first.
   - Still open: TEST 4 (no DB benchmarking surface exists), TEST 7
     (`_search-quality.js` foreign); §46 #16 (live-browser QA — no connected
     browser); §46 #22 (admin-UI read-back) and #23 (R14 wiring) sit on held
     surfaces `OpsCenter.tsx`/`Admin.tsx`/`agent-cron.js`/`_automation-registry.js`.

## Per-slice gates (safe mode — all mandatory)

- [ ] Inspected the real files before editing (no assumption edits).
- [ ] Additive contracts only (no breaking existing tests/consumers).
- [ ] Focused vitest file(s) for touched code: all pass.
- [ ] `npx eslint` on touched files: clean.
- [ ] No fake work: every claimed action has a state change + independent
      verify + evidence. UNKNOWN is not SUCCESS.
- [ ] Selective commit with imperative message; reply states what is still open.

## Stop condition (explicit — first one hit stops the loop)

- All slices 1–4 merged with gates green, OR
- user says stop / supersedes, OR
- one slice fails its gates twice consecutively (stop, report, do not pile on), OR
- a slice requires full-suite green or production secrets (stop, hand to CI/owner).

## Start / monitor

- Start next iteration: re-read this runbook, `git status --short` (confirm no
  unrelated files staged), implement the NEXT slice only.
- Monitor: `git log --oneline -5`; focused test
  `npx vitest run --config vitest.config.api.ts <file>`; cron surfaces at
  `GET /api/agent-cron` (field `comment_watch` carries `evidence`).
- Proof API (admin): `GET /api/workforce-proof?action=results`.

## Progress log

- slice 20 (this commit) — Spec §45 TEST 10 value audit wired as a
  dedicated `action=value-audit` on `_incident-cron.js` (kept out of
  `action=run` so committed queue-sweep assertions stay meaningful —
  store-length/stats read-backs there must keep reflecting sweep work
  only). New `api/_value-audit.js` + `tests/api/value-audit.test.ts`
  (6 tests): producer idempotency + discovery-failure surfacing, the
  end-to-end TEST 10 chain through the real handler (flag ghost/idle
  workers with reasons, verify evidenced producers, verdict registry +
  activity evidence re-read independently), day-2 supersede of a stale
  flag, false-success gate (flag write that does not persist →
  RETRYING with the failing check named, read-back `{}`), and input
  contract fail. Regression green: value-audit 6, work-queue 44,
  ops-events 12, e2e-operations 6. eslint clean. §45 TEST 10 covered;
  TEST 1–4, 7, 8 remain (blocked surfaces as before).

- slice 19 (this commit) — Spec §45 end-to-end tests for owned modules.
  New `tests/api/e2e-operations.test.ts` (6 tests) runs complete
  multi-step flows, not units: TEST 5 failure → ledger fallback with
  `activity_logs` evidence → retry → delivered only after read-back
  verify (false-success writes → attempts burn to `dead`, never
  "delivered"), TEST 6 healthy-claim control + stale sweep +
  `releaseRetried` + real completion, TEST 9 claim held in VERIFYING,
  rejected to RETRYING with reason, recovery to COMPLETED, plus the
  ownership / mandatory-evidence / failureReason gates. Full api suite
  111 files / 1250 tests green; eslint clean on the new file. §45
  TEST 5/6/9 covered; TEST 1–4, 7, 8, 10 remain open (safety, search,
  dispatch-gate, disable-test surfaces — partly foreign-modified).
- slice 18 — Domains enrollment + spec §7 ↔ FRAMEWORK §8
  crosswalk. `api/_worker-contracts.js` (owned): exported `DOMAINS`,
  helper `READ_ACTIVITY_LOGS` (real registry tool `get_activity_logs`
  → table `activity_logs`, admin read — the only envelope these
  deterministic sweeps get; queue mutations stay module-internal per
  R5), enrolled `ORCHESTRATION_CONTRACTS` — the 6 §8.1 capabilities
  (Event Engine, Work Dispatcher, Scheduler, Retry Engine, Dependency
  Manager, Watchdog): all class A, `deterministic_sweep`, class-A
  caps {0.002, 3, 15000}, cron exprs pinned to deployed `vercel.json`
  (`*/5 * * * *` ×3), event exprs on real conditions
  (`OPS_EVENT_TYPES (spec §4 catalog)`, RETRYING-nextRetryAt, WAITING
  deps-finish), verify V1/V2/V4/V5 per §8.1 row,
  `ui {surface:"OpsCenter", tab:"ops-center"}` (real admin-tab id),
  each disable test ≥40 chars with a `24h` observable flatline;
  `ALL_CONTRACTS` = 10 T&S + 6 orchestration (16, unique ids) now
  feeds `BY_ID`, so `assertDispatchable` serves both domains. New
  `api/_domain-map.js`: `SPEC_SYSTEMS` A–Q (canonical order),
  `SPEC_SYSTEM_MAP` — one primary §8 domain + `source` citing §8 rows
  per system, all 8 domains covered — and `validateDomainMap()`
  rejecting missing / extra / renamed / uncited / non-domain primary /
  orphaned-domain entries. New held-out gate
  `tests/api/domain-enrollment.test.ts` (9 tests: exact §8.1 rows,
  deployed-cron pin, read-only envelope, class-A caps, disable-test
  form, ALL_CONTRACTS + R14 over `orc-*`, full 17-row crosswalk
  held-out from the modules, validator clean + 6 tamper negatives).
  `docs/FRAMEWORK.md` gains §8.9 crosswalk table — stays uncommitted
  per docs-hold ruling (canonical machine-checked copy is the
  committed `_domain-map.js`). Gates: vitest 74/74
  (44+12+9+9), `npx eslint` on all three touched files clean. Note:
  a `*/5` sequence inside a block comment terminates it — cron
  schedules are described in words there, asserted in exprs/tests.
- slice 17 (this commit) — Incident triage producer + verified queue
  worker. New `api/_incident-triage.js` (tabs): producer
  `enqueueTriageJobs` (non-array → error, missing id → "incident
  without id — not enqueued", per-incident try/catch →
  `<id>: <message>`, severity→priority incl info→low / unknown→medium,
  idempotency `incident.triage:<id>`, input {incidentId, severity,
  title}) and consumer `runTriageWorker` (claim `incident.triage` only,
  fresh loadIncidents observe: RESOLVED/CLOSED → cancel with status,
  missing → cancel "not found"; act via real assignIncident (KV write,
  {error} → failJob "assignIncident: …"); SECOND independent re-read →
  3 checks (exists / status ASSIGNED / assignment persisted for this
  job) → submitVerification; resolve: pass → COMPLETED, fail →
  RETRYING "independent verification mismatch: <failed checks>",
  exception → summary.errors + failJob "worker exception: …",
  never fakes success). Edited `api/_incident-cron.js` (spaces): step
  3b produce after detect (own try/catch, errors "triage produce: …"),
  step 6b consume after sweeps ("triage consume: …"), step 7 stats.
  Extended `tests/api/work-queue.test.ts` (35 → 44): vi.hoisted `from`
  (static triage imports evaluate _db-client before module body),
  queueWriteFail flag + _incidents mock factory, 9 triage tests —
  happy path (COMPLETED, attempts 0, worker kept, 3-pass evidence,
  stats.COMPLETED=1, action=queue read-back, replay dedupe),
  verification mismatch → RETRYING attempts 1 worker nulled, resolved
  → CANCELLED (assign never called), missing → CANCELLED, assign
  throw → RETRYING "worker exception" + surfaced errors, no-id
  produce error, queue write-fail visible + empty stats, severity→
  priority map, {error} return → "assignIncident: …". Both
  `assignIncident` mocks (work-queue + ops-events) mutate the shared
  store. Gates: 65/65 api green (44+12+9), eslint clean. Left
  unstaged: concurrent bundle (index.js, _events.js, ~22 M api/*,
  foreign untracked, docs/).
- slice 16 — Durable work queue (SPEC §5). Created
  `api/_work-queue.js` (work_queue KV, tabs): QUEUE_STATES 11 frozen,
  JOB_FIELDS 17 frozen, TRANSITIONS with terminal COMPLETED/FAILED/
  CANCELLED (illegal move throws), buildJob validates type/
  idempotencyKey/priority/attempts/timeout/deps/retryPolicy/input/
  evidence, enqueue idempotent (duplicate → 1 record) with deps →
  WAITING, priority+age claim (only PENDING claimable), owner-only
  start/heartbeat/submitVerification (non-empty evidence mandatory) /
  resolveVerification (only independent pass → COMPLETED), failJob →
  exact min(base·factor^(n-1), max) backoff → RETRYING or dead-letter
  FAILED at maxAttempts (reason+attempts retained, never trimmed),
  releaseRetried/recoverStaleJobs/promoteWaiting no-write when idle,
  stale CLAIMED/RUNNING (anchor heartbeat→claimedAt→startedAt→createdAt
  older than timeout) failed as "stale claim recovered", dead dep →
  BLOCKED naming dep, block/quarantine/cancel require reasons +
  releaseHold, listJobs (unknown state throws) / listDeadLetters /
  queueStats (11+total), loadQueue deep-copies so a failed save never
  mutates the stored queue, claim-race boundary (KV read-modify-write,
  cron single claimant) documented in header — no migration needed.
  Edited `api/_incident-cron.js` (spaces): queue import, results.queue
  init, step-6 housekeeping try/catch (released/recovered/promoted/
  blocked + stats; failure → errors "queue recovery failed" + logged,
  never fakes success; log summary renumbered 7), `?action=queue`
  read-back (state/type/limit + stats), 400 message lists all five
  actions. New `tests/api/work-queue.test.ts` (35: held-out 11 states
  + 17 fields, illegal/terminal transitions, buildJob rejections,
  dedupe, deps promote + dead-dep block, claim priority + ownership,
  evidence gate, exact backoff timing (1000 ms) + due-only release,
  dead-letter at maxAttempts, stale recovery (fresh untouched / stale
  burned / stale at max → FAILED), block/quarantine/cancel reasons +
  release, trims terminal-only (active/FAILED survive), cron sweep
  releases+recovers+promotes+blocks, write-fail during sweep → error
  + state unchanged, action=queue read-back, 400 message). Gates:
  56/56 api green (35 new + slice-15's 21 still pass), eslint clean.
  Fixes during slice: loadQueue deep-copy (failed write must not
  mutate stored queue — same invariant as slice 15), cron awaits
  (async queue fns), recoverStaleJobs returns count not array. Left
  unstaged: concurrent bundle (index.js, _events.js, _auth.js, ~22 M
  api/*, foreign untracked, docs/).
- slice 15 (this commit) — Ops event log + T&S contracts. Created
  `api/_ops-events.js` (ops_event_log KV: SPEC §4 53-type catalog,
  11-envelope-field buildEvent validation, deduplicationKey dedupe,
  500-event cap trims oldest, explicit write-error throw, append builds
  a new array so a failed write never mutates the stored log);
  `api/_worker-contracts.js` (10 frozen T&S contracts per FRAMEWORK
  §3/§8.2 with held-out-verifiable triples, validateContract,
  assertDispatchable R14 gate exported but unwired — dispatch files
  foreign-owned). Edited `api/_incident-cron.js` (spaces): step-5
  producer PERIODIC_HEALTH_CHECK deduped per 5-min bucket with
  measured payload incl. worker_executions_1h, emit failure →
  errors+event{error}, `?action=events` read-back, 400 message lists
  all actions. New `tests/api/ops-events.test.ts` (12: envelope,
  held-out catalog 53, rejections, dedupe, cap, write-fail, filters,
  producer×2 → 1 event, failed-emit, read-back, 400) +
  `tests/api/trust-safety-contracts.test.ts` (9: held-out §8.2 triples,
  registry tools, class caps, disable tests, validateContract rejects,
  R14 throw). Gates: 21/21 api green, eslint clean (config lints
  ts/tsx; js passes too). Left unstaged: concurrent bundle (index.js,
  _events.js, _auth.js, ~22 M api/*, foreign untracked, docs/).
- slice 14 (this commit) — Agent-card evidence wiring. Created
  `src/pages/admin/agent-chat/evidence.ts` (pure extractors: message
  keys → sentence, primitives → humanized label/value rows, arrays →
  `#id · status` lines, dead-end data → verify-in-tab hint; SKIP_KEYS
  never echo html/raw/stack/csv). ActionCard: import swap to
  extractEvidence, `useState(true)` (evidence reachable on completed
  cards), ev/verifyHint in renderResult, `<pre>` dump → dl rows/items/
  fallback, header onClick always toggles, chevron/label unwrap (no
  longer pending-only). ActionPreviews: GenericPreview `<pre>` dump →
  flattenArgs rows (+ "No parameters"), bulk_update → summarizeArgs,
  unused safeStringify import removed. New
  `src/__tests__/ActionCardEvidence.test.tsx` (6: rows/no-pre/no-`{`,
  array items, failure line, empty-data hint, expand/toggle,
  GenericPreview). Canary `AdminAgentChat.test.tsx` (foreign, never
  staged) 5/5. eslint clean on 4 touched files. Left unstaged:
  concurrent bundle (Admin.tsx, AdminTabSweep, AIFailures,
  SafetyIntel, AgentChat.tsx, AdminAgentChat.test.tsx, api/*, docs).
- slice 13 (c3ed3f3) — Training Center surface removal + ship
  AIQuality. `AIQuality.tsx` (concurrent session's page, idle since
  Sep 21, previously untracked): removed the Training scenarios card +
  `GraduationCap` import via guarded line-surgery (tabs/UTF-8 intact);
  `training` payload type kept — background training in
  `api/_training-lab.js` still returns it. Verified no Training
  route/tab existed anywhere in src. Ships `AdminAIQuality.test.tsx`
  alongside (imports only committed modules). Left unstaged:
  concurrent bundle `Admin.tsx` wiring, `AdminTabSweep` map,
  `AIFailures.tsx`, `SafetyIntel.tsx`. Gates: 21 src green,
  eslint clean.
- slice 12 (304d7f2) — Reports admin outcome-first redesign.
  `Reports.tsx`: 3-tab model (no "open reports" concept), status chips,
  conditional Review/Dismiss, "No reports yet." empty states;
  `Overview.tsx`: Reports metric (real count) + aria-label + REPORTS
  heading — partial-staged via filtered patch (PulseStrip hunks from a
  concurrent session left unstaged); `Overview.test.tsx` switched to
  `getAllByText("Reports")`/`REPORTS`; new `src/lib/report-groups.ts` +
  test; adopted `api/_reports.js` verification/evidence + zero-dep
  SpreadsheetML Excel export (api harness mocks _db-client + fetch +
  env + resetModules). Gates: 54 src (Reports 11 + Overview 22 +
  ReportGroups 6 + AdminTabSweep 15) + 27 api green, eslint clean.
- slice 11 (1b70aec) — AI Coworker real-work loop. `api/_agent-chat.js`:
  `AUTO_EXEC_TOOLS` in-turn execution (cap 4) + second-pass grounding call so
  replies use real query results; `parseAgentResponse` exported + hardened
  (reply-only/bare-JSON accepted, prose preserved, unrecoverable JSON → ""
  instead of a dump); `friendlyError()` allowlist (guard/validation messages
  pass whole, incl. `Custom tool … SQL error:` wrapper) mapping raw
  SQL/PGRST/network text to human messages — wired into all 6 intent reply
  sites, execute results, and the auto-exec loop (raw stays in auditLog);
  fallback no longer discards model-proposed approval cards; prompt rule 5
  now matches reality (read-only runs in-turn). New
  `tests/api/agent-chat-response.test.ts` (14 tests: parser, friendlyError,
  tool-loop grounding, DROP rejection).
- 39b7ca5 — slice 9 comment-gate parity (5 files, +348/−37): server stays
  authoritative, raw body sent, masking display-only.
- b01b9da — slice 10 pre-publish decision forcing + Submit raw-send +
  `isBlockedByServer` rename. `_pre-publish.js` emergency path: PII or
  THREAT/HATE/BLACKMAIL/SELF-HARM forced `high_risk`, any safety issue floors
  `revision`; new first-person SELF-HARM check with reporting-word guard
  ("a kid told me to kill myself" stays safe — prompt L118);
  `doxxing_detected` wired to name+address privacy issue. AI path: added
  blackmail/explicit/self-harm → high_risk, bullying → revision floor,
  `self_harm_detected` plumbing + prompt category/scoring lines.
  `moderation.ts`: `POST_BLOCK_*`/`POLL_BLOCK_*` server-verbatim messages +
  `submitBlockMessage()`; `isBlockedForComment` → `isBlockedByServer`.
  `Submit.tsx`: gate shows exact server 403 wording, sends RAW sanitized
  fields (masking is server-at-insert), 8 gate sites renamed.
  New `tests/api/pre-publish-decision.test.ts` (6 tests, LLM-down path).
  Gates: api 30 + src 86 green, eslint clean on 8 touched files.
- 83747a0 — adopted + verified concurrent session's complaint work (13 files,
  +1243/−41): `moderation.ts`/`_moderation.js` coercion victim-vs-perpetrator
  demotion, `_inbox.js`/`UnifiedInbox.tsx` topic + AI summary, `Submit.tsx`
  record-first voice, `AppContext.tsx` typed `__chatUnread`, `utils.ts`
  revokeObjectURL try/finally; added 3 untracked gate tests. Gates: 37 API +
  89 src = 134/134 green, eslint clean on all 13.
- c2bd567 — slice 6C verified case reopen (independent read-back), 8/8.
- ec8ffc3 — slice 6B queue stuck-job recovery, 14/14.
- 7380250 — slice 6A notification retry-verify (dead-letter evidence), 18/18.
- 9541ac6 — "Fix feed cache invalidation, add Excel case export, harden masking +
  realtime". Staged exactly 10 files (`api/_cache.js`, `api/_posts.js`,
  `api/_comments.js`, `api/_polls.js`, `src/pages/Home.tsx`,
  `src/pages/PostDetail.tsx`, `src/lib/excelXML.ts`,
  `src/__tests__/excelXML.test.ts`, `tests/api/posts-feed-perf.test.ts`,
  `docs/PERF.md`). Gates: `excelXML.test.ts` 11/11, `posts-feed-perf.test.ts`
  7/7, `eslint src/lib/excelXML.ts` clean.
- Invoice artifact produced from live API with the exact `buildCaseXls()` the UI
  calls (`D:\Temp\opencode\gen-invoice.mjs` → esbuild bundle of
  `src/lib/excelXML.ts`): `C:\Users\lenovo\Downloads\voicebox-case-invoice.xls`
  (4394 B, 3 sheets, all string cells `ss:Type="String"`). Case
  `post_mub0ok0sm46ash` is a fresh report (0 comments, 0 reactions) — timeline
  sheet is legitimately empty.

## "Server error loading / too many" — measured findings

- `http://localhost:5174/` is **not Voice Box** — it is "Flour & Ledger — Bakery
  Management" from `Downloads\agon-agent_1-46731b9d (1)` (IPv6-only bind;
  `127.0.0.1:5174` refuses). It has no `/api/*`, so a Voice Box tab pointed at
  5174 shows load/server errors.
- RESOLVED: one clean `npm run dev` now serves Voice Box on **http://localhost:5173/**
  (`host:true` → dual-stack; `/` 200 title "Voice Box — Anonymous School Feedback
  Platform", `/api/posts` 200 with 30 posts). Stale dev servers on 5175 (pid
  21604) and 5273 (pid 20520) were stopped; the bakery app on 5174 (pid 31604)
  was left untouched. `src/lib/excelXML.ts` and `src/pages/PostDetail.tsx` both
  serve 200 with `buildCaseXls`/`exportCase` on 5173.
- Rate limits that can produce the literal `"Too many requests"` (429,
  `Retry-After`): `_posts.js` writes 3/60 s, `_comments.js` writes 5/30 s,
  `_reactions.js` **none**, `_me.js` 30/min/IP (frontend never calls `/api/me`),
  `_export.js` 10/min/IP, `_ai-summary.js` 20. GETs on posts/polls/reactions are
  unbounded — the complaint came from volume (client storm + write limits), not
  from read 429s.
- Fixed the true client-side storm (9541ac6): `fetchPolls` now key-skips when the
  linked-poll id set is unchanged; reaction refresh is coalesced
  (`inflight`/`dirty`). `_cache.js` `staleWhileRevalidate` now exposes
  `.invalidate()` (the old `cacheClear("^postsfeed")` never touched its private
  `_swrCache` — a silent no-op that hid fresh posts for up to `staleTtl`=60 s).
