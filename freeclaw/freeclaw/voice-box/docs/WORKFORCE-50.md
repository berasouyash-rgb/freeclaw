# Voice Box 2.0 — Workforce-50 Master Plan

Status: **Building** — B1 (1–6) + B2 (7–12) + B3 (13–18) + B4 (19–24) delivered; latest gate: tsc ✅ eslint ✅ unit ✅ api ✅ pytest 150 ✅
Branch: `initial-review-branch` · Repo root: `voice-box/`

> **Safety system:** the expanded content-moderation / safety contract briefed from
> Ofcom / eSafety expectations (19 detection categories, enforcement ladder, allow-list,
> child-safety specialized pipeline, the 🤖 AI ACTION VERIFIED proof UI) is specified in
> [`docs/SAFETY-MODERATION.md`](./SAFETY-MODERATION.md). It is deliberately **not** B1 work;
> it is consumed by B3 (#18), B4 (#22/#23), B5 (#26), and B6/B7 (#36/#37/#39).

---

## 1. Contract (why this is not fake)

Voice Box 2.0 is driven by **exactly 50 named Core AI Workers** (§22 of the spec). Every
worker must, per run:

1. Fire only on a **real trigger** (cron tick, deterministic event, or AI-class trigger).
2. Use **real tools** (Supabase tables, APIs, provider endpoints via `_providers.js`).
3. Run a **workflow** — observe → decide → act → **verify** (the engine refuses to record
   success without `verify() → { ok: true }` re-reading state).
4. Respect **permissions**: execution class A (deterministic auto-act) / B (bounded act with
   caps) / C (evidence-only — escalates, never mutates) + per-worker hourly budgets.
5. Produce a **real state change** (row inserted/updated, KV ledger entry, alert emitted) or an
   honest `deferred` / `standby` result.
6. Pass a **disable test**: for every worker, "if it is off for 24 h, X measurably degrades"
   must be true and written down. Workforce Auditor (#49) culls any worker that fails this.

Deterministic software is the floor; AI (via the provider abstraction, `openai/gpt-oss-20b`
live) is used **only** for natural-language ambiguity, with deterministic fallbacks when AI is
unavailable. Anonymity/privacy outrank polish. No fake systems, no fake activity — only
verified, measured work.

---

## 2. Ground truth on the existing workforce surface

Two real systems already exist in `api/`; the 50 workers are built **on top of both**, not as
a third system:

| Surface | File | Contract |
|---|---|---|
| Scheduling registry | `api/_automation-registry.js` | `WORKERS[]` = `{id, name, description, module, run}`; `recordLastRun`/`readLastRuns` persist to `settings`; `summarize(id, result)` one-liner per worker for OpsCenter. **Single source of truth** the cron loop iterates. |
| Lifecycle engine | `api/_workforce-core.js` | `registerWorker({worker_id, name, responsibility, execution_class, budget, tools, observe, analyze, execute, verify, measure})`; `runWorker(workerId, trigger)` drives TRIGGER→OBSERVE→EVIDENCE→ANALYZE→DECIDE→SAFETY→EXECUTE→VERIFY→MEASURE→LOG→ALERT; action ledger `workforce_actions_kv`; per-worker `budgetAllows`; verified_success only when verify returns `{ok:true}`. |
| Cron driver | `api/agent-cron.js` | Vercel endpoint, **60 s hard window** (killed on overrun). Tick-budget + `deferred` + next-tick pickup pattern (every 5 min). **Runs a registry-driven loop** over `WORKERS[]` with shared remaining-time/budget guards (refactored; every enrolled worker is dispatched there and last-run is recorded). |
| Workforce API | `api/_workforce.js` + `api/_workforce-api.js` + `_workforce-center.js` + `_workforce-bridge.js` | Orchestrator, patrol, supervisor, task queue; admin-gated `/api/workforce`; OpsCenter UI reads worker last-runs. |

Composition rule (both surfaces stay; one scheduling clock):

- **Simple deterministic workers (class A)** → registry entry only (module + `run`). The cron
  loop calls them exactly like the pre-B1 nine.
- **Workers that need observe → analyze → verify + budgets/ledger (class B/C / AI-class)** →
  still get a registry entry (so cron + OpsCenter see them), but their `run()` adapter calls
  `runWorker(id)` from `_workforce-core.js`.
- **Class C** never mutates state — it produces evidence + escalates via `_events.js`
  `emitEventAndBridge` (`workforce_alerts`).

Today **15 workers are enrolled** (poll-sweep, sla, reopen, followup, poll-integrity, storage,
trends, anonymity, comment-watch, plus the B1 intake workers 1–6). The remaining 35 are added
by this plan. Several already have real backing modules (below) — they are **enrollments +
adapters + tests**, not greenfield.

> **How the B1 intake workers are built:** each is a lifecycle worker registered in
> `_workforce-workers.js` (`registerWorker` → observe → decide → act → `verify()`), with a
> registry entry in `_automation-registry.js` whose `run` is a zero-arg adapter calling
> `runWorker(id)`. That is the composition rule below — the registry stays the single
> scheduling source of truth, and every run lands in the ledger.

---

## 3. Roster — all 50 workers (§22), status, backing, disable test

Status: **EXISTS** = enrolled + verified · **PARTIAL** = backing module exists, needs
enrollment/adapter · **NEW** = no backing, build the module.

Class: A = deterministic auto-act · B = bounded act (caps/budgets) · C = evidence-only.

| # | §22 Worker | St | Cl | Trigger | Backing / module | Disable test — after 24 h off… |
|---|---|---|---|---|---|---|
| 1 | Voice-to-Case | **EXISTS**¹ | C | event | `_workforce-workers.js` `runVoiceIntake` (probe adapter) + `_assist.js` voice endpoint + **`_transcribe.js` (server ASR)** | voice intake degradation stops being detected/escalated |
| 2 | Submission Understanding | **EXISTS** | A | event | `_workforce-workers.js` `runSubmissionUnderstanding` + `_ai-summary.js` (provider fallback) | posts stop getting `ai_summary` written (summaries cease) |
| 3 | Missing Information | **EXISTS**¹ | C | event | `_workforce-workers.js` `runMissingInfo` + `_ai-resolution.js` `ai_resolution:*` store | stale AI resolutions stop being flagged → follow-ups stop |
| 4 | Category | **EXISTS** | A | event | `_workforce-workers.js` `runCategoryAssignment` + `_ai-summary.js` / `_categories.js` | auto-categorization stops; "Other" backlog grows |
| 5 | Category Correction | **EXISTS** | B | event | `_workforce-workers.js` `runCategoryCorrection` (`CATEGORY_KEYWORDS`) → `activity_logs` | mis-categorised "Other" posts stop being logged for correction |
| 6 | Suggestion | **EXISTS** | A | cron | `_workforce-workers.js` `runSuggestionDetection` + real `_proactive.js` `detectSuggestions` | pending `agent_suggestions` stop being (re)derived; queue starves |
| 7 | Duplicate Case | **EXISTS**² | A | event | `_workforce-workers.js` `runDuplicateCase` + `_duplicates.js` `findAllDuplicateClusters` (dual read) | duplicate flags stop; manual merge workload rises |
| 8 | Related Case | **EXISTS**² | A | event | `_workforce-workers.js` `runRelatedCase` + `_related.js` `findRelatedPosts` (dual read) | related-case suggestions stop |
| 9 | Priority | **EXISTS**² | A | cron | `_workforce-workers.js` `runPriority` + `_sla.js` `SLA_WINDOW_MS`/`PRIORITY_ORDER` | priority bumps stop firing |
| 10 | Case Assignment | **EXISTS**² | A | event | `_workforce-workers.js` `runCaseAssignment` + `_workforce.js` `createTask` (`source_ref` dedupe) | new cases stop being dispatched |
| 11 | SLA | **EXISTS**² | A | cron | `_sla.js` `checkSLA` (registry `sla`; batch2 covered) | deadline warnings / escalations stop |
| 12 | Follow-up | **EXISTS**² | A | cron | `_followup.js` `checkFollowups` (registry `followup`; batch2 covered) | stalled cases stop being pinged |
| 13 | Resolution Verification | **EXISTS**³ | B | cron | `_workforce-workers.js` `runResolutionVerification` + `_reports.js` `verifyReportResolution` | false resolutions stay closed and the content they claimed to handle stays publicly visible |
| 14 | Recurring Problem | **EXISTS**³ | B | cron | `_trend-watch.js` `checkTrends` (registry `trends`; batch3 covered) | recurring problems stop being surfaced |
| 15 | Multilingual | **EXISTS**³ | AI | event | `_workforce-workers.js` `runMultilingual` + `_translate.js` (provider abstraction) | non-localized content stops being translated |
| 16 | Search Intelligence | **EXISTS**³ | B | cron | `_workforce-workers.js` `runSearchIntel` + `_search-quality.js` `calculateMetrics` | search quality metrics stop being measured |
| 17 | Knowledge | **EXISTS**³ | B | cron | `_kb-maintain.js` `maintainKB` (harvests resolved cases; `_rag.js` `searchKB`) | knowledge base stops being maintained |
| 18 | Admin Briefing | **EXISTS**³ | B | cron | `_briefing.js` `generateBriefing` (digest from real ledger/activity/alert reads) | daily/digest briefings stop |
| 19 | Poll Creation | **EXISTS**⁵ | B | cron | `_poll-create.js` `runPollCreate` (real `createPoll` path lifted in `_polls.js`) | auto poll lifecycle stops at creation |
| 20 | Poll Intelligence | **EXISTS**⁵ | A | cron | `_poll-integrity.js` `checkPollIntegrity` (registry `poll-integrity`; batch4 covered) | vote fraud stops being quarantined |
| 21 | Community Health | **EXISTS**⁵ | B | cron | `_community-health.js` `runCommunityHealth` (real counts → `community_health:latest` KV) | community health signals stop |
| 22 | Content Moderation | **EXISTS**⁵ | A | cron | `_comment-watch.js` + `_moderation.js` + `_pre-publish.js` (parallel moderation-gate slice) | abusive comments stop being hidden/struck |
| 23 | Abuse Detection | **EXISTS**⁵ | A | event | `_abuse.js` `runAbuseWatch` (cross-request rapid-fire → real `pending_review`) | spam/rapid-fire abuse stops being blocked |
| 24 | Upload Intelligence | **EXISTS**⁵ | B | event | `_storage.js` `runUploadIntel` (bucket occupancy) + `_upload.js` hardened handler | unsafe uploads stop being scanned/reclaimed |
| 25 | AI Quality | **EXISTS**⁶ | B | cron | `_evaluation-engine.js` `runAIQuality` (real eval history → `ai_quality:latest` KV) | AI output quality stops being scored |
| 26 | AI Red-Team | **EXISTS**⁶ | C | cron | `_redteam-cases.js` `runRedTeam` (18 cases through the real `serverModerate`) | prompt-injection probes stop running |
| 27 | AI Regression | **EXISTS**⁶ | B | cron | `_golden-workflows.js` `runGoldenRegression` (golden journeys + previous-run comparison) | golden-case regressions stop being caught |
| 28 | AI Drift | **EXISTS**⁶ | B | cron | `_drift.js` `runDriftWatch` (real pass-rate/score deltas → `ai_drift:latest` KV) | AI drift stops being measured |
| 29 | UX Intelligence | **EXISTS**⁶ | C | cron | `_ux-intel.js` `runUXIntel` (durable vitals `vitals:durable` → regression flags → `ux_intel:latest` KV) | UX signals stop |
| 30 | Product QA | **EXISTS**⁶ | C | cron | covered by the #27 `ai-regression` enrollment (real golden journeys + previous-run regression detection, merged per §17 — one continuous run, no duplicate cron work) | end-to-end workflow checks stop |
| 31 | Performance Intelligence | **EXISTS**⁷ | B | cron | `_performance.js` `runPerformanceIntel` (real table latencies + error rate + stored p95 + durable vitals → `performance_intel:latest` KV) | perf regressions stop being flagged |
| 32 | Database Intelligence | **EXISTS**⁷ | B | cron | `_db-stats.js` `runDbIntel` (READ-ONLY table stats → `db_intel:latest` KV) | DB health stops being watched |
| 33 | Queue Recovery | **EXISTS**⁷ | A | cron | `_work-queue.js` `runQueueRecovery` (stale claims + due backoff + dependency promotion) | stuck work stops being recovered |
| 34 | Notification Intelligence | **EXISTS**⁷ | B | cron | `_notification-delivery.js` `runNotificationIntel` (verified dead-letter drain; `_notifications.js` is the store surface) | silent notification failures stop being repaired |
| 35 | Incident Recovery | **EXISTS**⁷ | A | event | `_incidents.js` `runIncidentRecovery` (metric-recovered auto-resolve, registry-enrolled from the parallel slice's incident engine) | incidents stop being auto-recovered |
| 36 | Security Operations | **EXISTS**⁷ | B | event | `_security-events.js` `runSecurityOps` (real audit-log security reads → `security_ops:latest` KV) | security events stop being analyzed |
| 37 | Authorization Protection | PART | B | cron | `_security.js` + RLS/ACL audit (RBAC NEW) | privilege leaks stop being checked |
| 38 | Anonymous Identity Protection | **EXISTS** | A | cron | `_anonymity.js` (registry `anonymity`) | identity trips stop being raised |
| 39 | Data Exposure Protection | PART | A | event | `_moderation.js` maskPII + `_anonymity.js` | PII leaks stop being masked |
| 40 | Search Repair | PART | A | cron | `_search.js` / `_search-quality.js` | broken search paths stop being repaired |
| 41 | Broken Page | NEW | B | cron | NEW `_broken-page.js` (route/link probes) | dead routes stop being detected |
| 42 | UI Repair | NEW | C | cron | NEW `_ui-repair.js` (evidence → OpsCenter queue) | UI defects stop being queued |
| 43 | Accessibility | NEW | C | cron | NEW a11y auditor (axe-rule probe) | a11y regressions stop being flagged |
| 44 | Mobile QA | NEW | C | cron | NEW `_mobile-qa.js` (viewport/route probes) | mobile regressions stop being caught |
| 45 | Release Guardian | PART | C | event | CI scripts (npm scripts exist) + NEW guard | release gates stop |
| 46 | Change Intelligence | PART | B | cron | `_audit-trail.js` | audit diffs stop being summarized |
| 47 | Cost Optimization | **EXISTS**⁴ | B | cron | `_workforce-workers.js` `runCostIntelligence` (real ledger accounting) + `_workforce-core.js` budgets | a budget-starved worker stays invisible and its job stops happening while reading "healthy" |
| 48 | Reliability | PART | B | cron | `_reliability.js` / `_health.js` / `_vitals.js` | reliability checks stop |
| 49 | Workforce Auditor | PART | C | cron | `_worker-supervisor.js` + `_workforce-verification.js` + NEW cull power | disabled/culled workers stop being removed |
| 50 | Workforce Orchestrator | **EXISTS** | B | cron | `_workforce.js` orchestrator + registry-driven cron loop | scheduling/dispatch stops |

Tallies (**after B3 + report-disposition + cost-intelligence**): **EXISTS 17** · **PARTIAL 22** · **NEW 11**.

B3 delivered #13 and #47 on top of the pre-existing set, and enrolled one worker the
§22 roster does not list but the platform needs:

- **`report-disposition`** (`api/_workforce-workers.js`) — `_reports.js` runs the strike
  ladder when a report lands but never dispositions the report ROW, so it kept the schema
  default `status: "open"` forever. That is why the open queue read as noise. The worker
  closes each stale (>1 h) open report from the target's CURRENT state (gone → already
  handled; public+violating → enforced then re-read; public+compliant → reviewed;
  unreadable or unenforceable → **stays open**), writing a structured `activity_logs` row
  that names the disposition AND the evidence. `/api/reports` joins that evidence back
  onto the row, and the Reports admin UI renders it.

> ³ #13 is a B3-delivered class-B lifecycle worker (`tests/api/workforce-batch3.test.ts`).
> It is the pattern the rest of the roster follows: a report reading "resolved" is NOT
> evidence the problem is gone, so the worker re-reads the target's CURRENT state, reopens
> resolutions that do not hold, re-applies enforcement, and proves BOTH effects by re-read
> (the report reads `open` again, the target no longer reads public). It refuses to claim
> success when enforcement is incomplete or a target cannot be re-read — an unknown is
> reported as an unknown, never as a pass. Rows 14–18 are also B3-delivered: #14 keeps the
> real `checkTrends` (registry `trends`) with batch3 spike/stand-down coverage; #15
> Multilingual adds the deterministic `_translate.js` script detector + provider
> translation via the canonical `translation:{postId}` KV (originals never replaced); #16
> Search Intelligence measures the real telemetry window (`_search-quality.js
> `calculateMetrics`) and logs advisory reports past the module's own thresholds; #17
> Knowledge harvests real resolved cases into `knowledge_base` and proves each entry
> searchable via the platform's own `searchKB`; #18 Admin Briefing builds the operations
> digest from real ledger/activity/alert reads, persists `briefing:latest`, and verifies
> the persistence by re-read.
>
> ⁴ #47 accounts for REAL ledger compute only. There is no dollar figure anywhere in it:
> inventing cost from a run count would be exactly the fabricated metric the contract
> forbids. It reports measured `duration_ms` share and `budget_blocked` ratios, flags
> starvation (a worker refused on ≥50% of ≥6 attempts) and concentration (≥70% of a
> ≥3-worker fleet's compute), and its `verify()` refuses to pass unless the alert it
> queued is actually re-readable from the improvement queue AND the finding still holds on
> a FRESH ledger read.

> ⁵ #19–#24 are B4-delivered: #19 Poll Creation adds the create side of the poll lifecycle
> (`_poll-create.js` `runPollCreate`) through the real `createPoll` path lifted out of the
> `_polls.js` handler (same mask, same row shape, same insert) — engaged suggestions
> (≥2 comments, author known, not already polled) get a real "Do you agree:" poll linked
> to their post so the own-post linking rule holds naturally, with the safety engine run
> on the title BEFORE insert; #20 keeps the real `checkPollIntegrity` with batch4 burst/bot
> coverage; #21 Community Health measures real posts/comments/votes counts and persists
> `community_health:latest` verified by re-read; #22 is the parallel moderation-gate slice
> (context-aware composer + pre-publish severity decisions); #23 Abuse Detection adds the
> cross-request rapid-fire watch (`_abuse.js` `runAbuseWatch`) that quarantines floods via
> the real `pending_review` status (verified by re-read); #24 Upload Intelligence adds the
> measurement side (`_storage.js` `runUploadIntel` — real bucket occupancy + orphan
> pressure persisted and verified; the reclaim itself stays `sweepStorage`'s job).

> ⁶ #25–#28 are B5-delivered: #25 AI Quality scores the evaluated workforce from the real
> evaluation history (per-worker latest summaries, weakest-first ranking, safety-violation
> totals) into the canonical `ai_quality:latest` KV, verified by re-read; #26 AI Red-Team
> enrolls the parallel slice's `_redteam-cases.js` — 18 real cases (blackmail/threat/doxxing/
> PII/hate + victim-report holds + a false-positive legit guard) run through the real
> `serverModerate` with capped persisted history; #27 AI Regression runs the real golden
> journeys (user/admin/workforce) and flags only steps that PASSED in the previous stored
> run but FAIL now — a real behavioral regression, never a mocked comparison; #28 AI Drift
> measures real pass-rate deltas between the two most recent red-team runs and per-worker
> evaluation score deltas into `ai_drift:latest`, verified by re-read, honest nulls when a
> source is unavailable. #29 UX Intelligence reads the DURABLE vitals store
> (`vitals:durable` — cumulative counts that survive cold starts, written by the hardened
> /api/vitals receiver) and flags poor-rate climbs beyond tolerance into `ux_intel:latest`,
> verified by re-read. #30 Product QA is **merged into #27's enrollment** (§17: one
> continuous run of the real golden journeys with regression detection — a second registry
> entry would run the same journeys twice per tick, which is duplicate cron work, not extra
> coverage).
>
> ⁷ #31–#36 are B6-delivered platform-reliability workers
> (`tests/api/workforce-batch6.test.ts`). #31 Performance Intelligence measures the
> platform's real signals (hot-path table latencies, the `activity_logs` error rate, the
> stored `system_metrics` p95, and the durable `vitals:durable` store) and flags climbs
> past tolerance into `performance_intel:latest`, verified by re-read, honest nulls when a
> read fails. #32 Database Intelligence is READ-ONLY — the hard rule: no index change
> without a benchmarked before/after — real per-table stats and latency over the critical
> tables into `db_intel:latest`, an advisory row only when a real issue exists. #33 Queue
> Recovery enrolls the durable queue's general sweep (`_work-queue.js` `runQueueRecovery`):
> due backoff releases, stale-claim recovery, dependency promotion, each via the module's
> own bounded functions, verified by an invariant re-read. #34 Notification Intelligence
> drains the dead-letter ledger through the verified retry (read-back proof) into
> `notification_intel:latest`. #35 Incident Recovery auto-resolves open incidents whose
> underlying metric recovered below the warn line (the cron's own threshold mapping,
> registry-enrolled from the parallel slice's incident engine), verified by a second fresh
> re-read. #36 Security Operations reads the REAL security audit events and flags
> unresolved high-severity ones into `security_ops:latest`, verified by re-read — never
> "protected" without evidence.
>
> Correction from the original plan: the pre-B1 counts were EXISTS 6 (#11,12,20,22,38,50),
> PARTIAL 31, NEW 13 — the earlier "25 / 19" line miscounted. B1 moved #1,2,3,4,5,6 into
> **EXISTS** (−4 PARTIAL, −2 NEW). B2 moved #7–#12 into **EXISTS** (−2 PARTIAL, −2 NEW).
> B3 moved #13–#18 into **EXISTS** (−3 PARTIAL, −2 NEW). B4 moved #19–#24 into **EXISTS**
> (−3 PARTIAL, −1 NEW). B5 moved #25–#28 into **EXISTS** (−2 PARTIAL, −2 NEW); B5b moved
> #29–#30 into **EXISTS** (−1 PARTIAL, −1 NEW, with #30 merged into #27 per §17).
> B6 moved #31–#36 into **EXISTS** (−6 PARTIAL).

> ¹ #1 Voice-to-Case and #3 Missing Information are enrolled as **class-C evidence-only
> probes/escalators** — they observe, analyse, and escalate, and never mutate state. #1 has a
> standing backend gap: the `Submit.tsx` `dictating` path exists but the ASR provider is not
> wired (§7 gap nº3), so it detects and escalates voice-intake degradation rather than
> transcribing. #3 flags stale `ai_resolution:*` settings rows (open/in-progress, untouched
> > 24 h) for human follow-up.

> ² #7–#10 are B2-delivered lifecycle workers (registry entry + zero-arg adapter +
> disable tests in `tests/api/workforce-batch2.test.ts`); #11/#12 were already enrolled
> registry workers and B2 added their batch2 disable/stand-down coverage. Every B2 read is
> **dual-backend**: the direct Supabase table first, the app's own live-posts feed
> (`_live-posts.js` `readLivePosts`) as fallback, with an honest stand-down when both are
> unavailable. B2 writes stay on the canonical Supabase path — no shadow store.

---

## 4. Build order — 8 batches (contiguous by §22), full verification after each

Each batch = registry enrollments + module work (adapters or NEW) + unit/API tests + alert
routes + per-worker disable tests + OpsCenter visibility. Gate after every batch: `tsc` +
eslint + vitest + `npm run test:api` + services pytest (all green), plus a manual cron-tick
smoke that shows each worker's last-run summary in OpsCenter.

| Batch | Workers | Theme | Emphasis |
|---|---|---|---|
| B1 | 1–6 | Voice-to-Case, Submission Understanding, Missing Information, Category, Category Correction, Suggestion | Intake & Understanding |
| B2 | 7–12 | Duplicate Case, Related Case, Priority, Case Assignment, SLA, Follow-up | Case Lifecycle |
| B3 | 13–18 | Resolution Verification, Recurring Problem, Multilingual, Search Intelligence, Knowledge, Admin Briefing | Resolution & Insight |
| B4 | 19–24 | Poll Creation, Poll Intelligence, Community Health, Content Moderation, Abuse Detection, Upload Intelligence | Polls, Community & Moderation |
| B5 | 25–30 | AI Quality, AI Red-Team, AI Regression, AI Drift, UX Intelligence, Product QA | AI & Product Quality |
| B6 | 31–36 | Performance Intelligence, Database Intelligence, Queue Recovery, Notification Intelligence, Incident Recovery, Security Operations | Platform Reliability |
| B7 | 37–43 | Authorization Protection, Anonymous Identity Protection, Data Exposure Protection, Search Repair, Broken Page, UI Repair, Accessibility | Trust & Experience |
| B8 | 44–50 | Mobile QA, Release Guardian, Change Intelligence, Cost Optimization, Reliability, Workforce Auditor, Workforce Orchestrator | Governance & Delivery |

---

## 5. Per-worker build checklist (every worker, every batch)

1. **Registry entry** — `_automation-registry.js`: `{id, name, description, module, run}`.
2. **Real run** — module exports `run(client, ctx)` → `{ok, ...metrics}`; deterministic-first;
   AI only for NL ambiguity with fallback; honors the 60 s tick via `ctx.deadline` and returns
   `{deferred:true}` when out of time.
3. **Lifecycle** — class B/C workers: `registerWorker` in `_workforce-workers.js` with
   observe/analyze/execute/verify; `run` adapter calls `runWorker(id)`.
4. **Summarize** — add the id to `summarize()` so OpsCenter shows a real one-liner.
5. **Tests** — fixture-based unit tests (no network), API tests for touched endpoints.
6. **Disable test** — a test/probe asserting the worker's 24 h absence produces the observable
   degradation named in §3.
7. **Alert route** — state changes fan out via `_events.js` `emitEventAndBridge`
   (`workforce_alerts`) where admins must know.
8. **Last-run + OpsCenter** — `recordLastRun` on every tick; visible in `OpsCenter.tsx`.

---

## 6. Audit contract (anti-fake enforcement)

- **§0 / §80 (internal contract):** "verified improvement only." `runWorker` records
  `verified_success` only when `verify()` re-reads state and returns `{ok:true}`. No outcome
  is claimed without evidence.
- **§57 (feature admission test):** a worker has a real state-change trigger; admission = the
  disable test passes.
- **§71 / Workforce Auditor (#49):** periodic sweep runs disable-test probes across all 50
  workers; any worker whose 24 h absence shows **no measurable degradation** is culled —
  registry entry removed, last-run evicted (`recordLastRun` already prunes unknown ids),
  `execution_class` C evidence-only workers that never act are escalated first.
- Workforce Orchestrator (#50) drives the registry loop; it cannot cull itself — Auditor does.

---

## 7. Standing gaps that block specific workers (tracked)

1. `api/migrations/015_poll_votes_created_at.sql` unapplied → poll-integrity `degraded:true`.
2. RBAC/roles table absent (single shared admin token) → #37 Authorization Protection can only
   audit, not enforce, until built.
3. ~~Voice ASR not wired (#1 Voice-to-Case)~~ — **CLOSED**. `api/_transcribe.js`
   (NVIDIA NIM `openai/whisper-large-v3`, OpenAI failover) transcribes the RECORDED take,
   so the transcript is a property of the audio rather than of a browser recognition
   session. Submit.tsx records first and replaces the live recogniser's words with the
   server transcript. Honest degradation: with no provider key the endpoint returns
   `503 {degraded:true}` and the live transcript stands — it never invents text. When the
   take cannot be transcribed the UI says so via the transcript source label, rather than
   silently presenting an inaccurate transcript as accurate.
4. Per-keystroke AI suggestions in Submit not implemented (feeds #2/#3).

---

## 8. Current status log

- [x] Phase 0 baseline measured: all suites green (see header).
- [x] §22 roster recovered verbatim from session DB; master plan written.
- [x] Cron refactor: `agent-cron.js` registry-driven loop over `WORKERS[]` (single source of
      truth; per-worker budget guard + `deferred`; last-run recorded for OpsCenter). All 15
      enrolled workers dispatched by it.
- [x] **B1 (1–6) — Intake & Understanding, delivered.** 6 registry entries + `summarize`
      cases, 6 zero-arg lifecycle adapters in `_workforce-workers.js` (observe → verify →
      ledger), 7 disable tests in `tests/api/workforce-batch1.test.ts` (all green). Gate:
      tsc ✅ eslint ✅ unit 1321 ✅ api 840 ✅ pytest 150 ✅.
      - #1 Voice-to-Case — class-C probe on the real voice endpoint; escalates
        `infrastructure` when degraded, `skipped` when healthy.
      - #2 Submission Understanding — class A; writes `posts.ai_summary` via the public
        `POST /api/ai-summary` handler and verifies the re-read.
      - #3 Missing Information — class-C; flags stale `ai_resolution:*` rows → escalation.
      - #4 Category — class A; assignment from the deterministic `category_suggestion`
        validated against `DEFAULT_CATEGORIES`, verified by re-read of `posts.category`.
      - #5 Category Correction — class B; scores "Other" posts against real keyword map,
        logs `category_correction_candidate` rows to `activity_logs` (never edits posts).
      - #6 Suggestion — class A; runs the real `_proactive.js` `detectSuggestions` over
        open reports; verifies pending-suggestion count doesn't regress.
- [x] Safety & moderation spec written (19 categories + ladder + allow-list + child-safety
      pipeline + proof UI) → `docs/SAFETY-MODERATION.md`; feeds B3/B4/B5/B6/B7, not B1.
- [x] **B2 (7–12) — Case Triage & Follow-through, delivered.** 4 registry entries
      (duplicate-case, related-case, priority, case-assignment) + 4 `summarize` cases, 4
      zero-arg lifecycle adapters in `_workforce-workers.js` (observe → verify → ledger),
      12 disable/stand-down tests in `tests/api/workforce-batch2.test.ts` (all green).
      Dual-backend reads everywhere: the direct Supabase table first, the app's own
      live-posts feed (`_live-posts.js` `readLivePosts`) as fallback, honest stand-down
      when both are unavailable; writes stay on the canonical Supabase path.
      - #7 Duplicate Case — class A; runs the real `_duplicates.js` detector, logs
        `duplicate_case` groups to `activity_logs` (never merges — merging is a human
        decision), verified by ledger delta + re-read.
      - #8 Related Case — class A; runs the real `_related.js` pairwise detector
        (≥2 shared 3-char words, artifact-filtered both sides), logs `related_case`
        pairs, verified by ledger delta + re-read.
      - #9 Priority — class A; bumps open posts past 50% of their SLA window that have
        discussion (guarded comments check) one level, re-reads fresh priority before
        acting, verified by re-read of `posts.priority`.
      - #10 Case Assignment — class A; dispatches new categorized cases to `agent_tasks`
        via the real `createTask` (`source: post`, `source_ref: case:<id>`, `dedupe: all`,
        `required_capability: case_handling`), verified by re-read of `agent_tasks`.
      - #11 SLA — registry-direct (`checkSLA`); batch2 covers breach escalation with
        priority bump persistence and the keyed no-flood dedupe.
      - #12 Follow-up — registry-direct (`checkFollowups`); batch2 covers stalled-case
        pings with alert persistence (`workforce_alerts`) and healthy-case stand-down.
- [x] **B3 (13–18) — Resolution & Insight, delivered.** 5 new registry entries
      (multilingual, search-intel, knowledge, briefing + #13 via the parallel workforce
      slice) + 4 new `summarize` cases, 2 new zero-arg lifecycle adapters
      (`runMultilingual`, `runSearchIntel`), 2 NEW modules (`_translate.js`, `_briefing.js`)
      + 1 NEW run module (`_kb-maintain.js`) + 1 lifted library API (`_ai-resolution.js`
      `analyzePost`, fixing a real bug where the `{profile:...}` third arg made
      `callLLMChain` throw and the LLM path always fall back to heuristic), 10
      disable/stand-down tests in `tests/api/workforce-batch3.test.ts` (all green).
      - #13 Resolution Verification — class B (parallel workforce slice); re-checks
        resolved reports against live target state, reopens false resolutions,
        re-enforces removal, both effects proven by re-read.
      - #14 Recurring Problem — registry-direct (`checkTrends`, already real); batch3
        covers the 24h-spike alert (keyed `trend:{cat}`, agent `trend-watch`), the
        no-flood dedupe, and the baseline-only stand-down.
      - #15 Multilingual — class B; deterministic Unicode-script language detection
        (`_translate.js` `detectLanguage`), provider translation via `callLLMChain`,
        stored in the canonical `translation:{postId}` KV, verified by re-read; originals
        never replaced; honest failure when no provider is configured.
      - #16 Search Intelligence — class B; measures the real telemetry window
        (`_search-quality.js` `calculateMetrics`, now exported), logs advisory
        `search_quality_report` rows past the module's own thresholds, verified by ledger
        delta; telemetry surfaced through `measure`.
      - #17 Knowledge — class B; `_kb-maintain.js` `maintainKB` health-probes the KB,
        harvests real resolved cases (admin_reply = claimed fix, artifact-filtered) into
        `knowledge_base`, deduped by title, and proves each entry is searchable via the
        platform's own `searchKB` — independent verification, not a row-exists claim.
      - #18 Admin Briefing — registry-direct (`generateBriefing`); builds the operations
        digest from real reads only (workforce ledger via the engine's own `readLedger`,
        recent `activity_logs`, `workforce_alerts`, the live posts feed), persists
        `briefing:latest` in the canonical KV, verified by re-read.
- [x] **B4 (19–24) — Polls, Community & Moderation, delivered.** 4 new registry entries
      (poll-create, community-health, abuse, upload-intel) + 4 new `summarize` cases, 3
      NEW modules (`_poll-create.js`, `_community-health.js`, `_abuse.js`) + 1 new run in
      `_storage.js` (`runUploadIntel`) + 1 lifted library API (`_polls.js` `createPoll`),
      10 disable/stand-down tests in `tests/api/workforce-batch4.test.ts` (all green).
      #22 Content Moderation is the parallel moderation-gate slice (context-aware composer
      gate + pre-publish severity decisions, committed 83747a0/39b7ca5/b01b9da).
      - #19 Poll Creation — class B; engaged suggestions (≥2 comments, author known, not
        already polled) get a real "Do you agree:" poll via the platform's own `createPoll`
        (masked title, linked post, own-post rule holds naturally), safety engine run on
        the title BEFORE insert, verified by re-read of the poll row.
      - #20 Poll Intelligence — registry-direct (`checkPollIntegrity`, already real);
        batch4 covers bot-author quarantine + the keyed `poll-fraud:{pollId}` alert and the
        normal-voting stand-down.
      - #21 Community Health — class B; real posts/comments/votes counts (24h) persisted
        to `community_health:latest`, verified by re-read; honest nulls when a read is
        unavailable, never fabricated zeros.
      - #23 Abuse Detection — class A; cross-request rapid-fire burst watch: one author
        ≥6 posts in 10 minutes → the burst quarantined via the real `pending_review`
        status (the moderation queue owns the review), verified by re-read.
      - #24 Upload Intelligence — class B; `_upload.js` is already hardened (mime +
        magic-byte + throttle + honest 503); the worker adds the measurement side — real
        bucket occupancy + orphan pressure persisted to `upload_intel:latest`, verified by
        re-read; the reclaim stays `sweepStorage`'s job.
- [x] **B5 (25–28) — AI & Product Quality, delivered.** 4 new registry entries
      (ai-quality, red-team, ai-regression, ai-drift) + 4 new `summarize` cases, 1 NEW
      module (`_drift.js`) + 2 new runs in existing modules (`_evaluation-engine.js`
      `runAIQuality`, `_golden-workflows.js` `runGoldenRegression`), 8 disable/stand-down
      tests in `tests/api/workforce-batch5.test.ts` (all green).
      - #25 AI Quality — class B; scores the evaluated workforce from the real evaluation
        history (per-worker latest summaries, weakest-first ranking, safety-violation
        totals) persisted to `ai_quality:latest`, verified by re-read; honest
        nothing-to-score when there is no history.
      - #26 AI Red-Team — class C; enrolls the parallel slice's `_redteam-cases.js`:
        18 real cases (blackmail/threat/doxxing/PII/hate + victim-report holds +
        false-positive legit guard) through the real `serverModerate`, capped persisted
        history (`safety_redteam_runs`); batch5 proves the run + the history-growth proxy.
      - #27 AI Regression — class B; runs the real golden journeys (user/admin/workforce)
        and flags only steps that PASSED in the previous stored run but FAIL now — a real
        behavioral regression, never a mocked comparison; verified healthy-state runs.
      - #28 AI Drift — class B; measures real pass-rate deltas between the two most
        recent red-team runs and per-worker evaluation score deltas persisted to
        `ai_drift:latest`, verified by re-read; honest nulls when a source is unavailable.
      - #29 UX Intelligence / #30 Product QA — delivered (B5b): #29 reads the DURABLE
        vitals store (`vitals:durable`) and flags poor-rate climbs beyond tolerance into
        `ux_intel:latest`, verified by re-read, honest nothing-to-measure on an empty
        store; #30 is merged into #27's continuous golden-journey enrollment (§17). The
        /api/vitals receiver was also hardened: it previously kept ALL aggregation in
        memory (reset on every cold start — real signals lost); it now merges cumulative
        counts into the durable KV on every POST and serves durable+in-memory merged data
        on GET, with percentiles honestly per-window. 3 tests in
        `tests/api/workforce-batch5b.test.ts` (all green).
      - Search telemetry durability (report Issue 2 fixed, B5c): `_search-quality.js`
        accumulates every search event into an in-memory delta that flushes to the
        canonical `search_events:durable` KV at most once per minute (a cold start loses
        at most 60s of evidence instead of the whole window); `readDurableSearch` exposes
        the cumulative store; the search-intel worker's observe reads the durable evidence
        (guarded — the durable reader is optional in mocked modules) and measures real
        usage across cold starts instead of standing down; `runSearchIntel` persists a
        verified `search_intel:latest` snapshot with both the per-window percentiles and
        the durable cumulative rate. The durable reader is accessed defensively because
        vitest's mock proxy throws on missing exports.
- [x] **B5 complete (25–30).** Roster count: 30 of 50 **EXISTS**.
- [x] **B6 (31–36) — Platform Reliability, delivered.** 6 new registry entries
      (performance-intel, db-intel, queue-recovery, notification-intel,
      incident-recovery, security-ops) + 6 new `summarize` cases, 6 new runs in
      existing modules (`_performance.js` `runPerformanceIntel`, `_db-stats.js`
      `runDbIntel`, `_work-queue.js` `runQueueRecovery`, `_notification-delivery.js`
      `runNotificationIntel`, `_incidents.js` `runIncidentRecovery`,
      `_security-events.js` `runSecurityOps`), 6 disable/stand-down tests in
      `tests/api/workforce-batch6.test.ts` (all green).
      - #31 Performance Intelligence — class B; measures real hot-path table
        latencies, the activity_logs error rate, the stored system_metrics p95,
        and the durable vitals store; flags climbs past tolerance into
        `performance_intel:latest`, verified by re-read; honest nulls on failed
        reads, never fabricated zeros.
      - #32 Database Intelligence — class B; READ-ONLY (no index changes without a
        benchmarked before/after — hard rule): real per-table stats and latency
        over the 11 critical tables into `db_intel:latest`, verified by re-read;
        advisory row only when a real issue exists.
      - #33 Queue Recovery — class A; the durable queue's general sweep: due
        backoff releases, stale-claim recovery (worker crash/orphan), dependency
        promotion, each via the queue's own bounded functions; verified by an
        invariant re-read showing no stuck work remains.
      - #34 Notification Intelligence — class B; measures the real notification
        stores and drains the dead-letter ledger through the verified retry
        (independent read-back) into `notification_intel:latest`, verified by
        re-read; honest no-op when the platform has no notification surface.
      - #35 Incident Recovery — class A; auto-resolves open incidents whose
        underlying metric recovered below the warn line (the cron's own threshold
        mapping, registry-enrolled from the parallel slice's incident engine);
        verified by a second fresh incident re-read.
      - #36 Security Operations — class B; reads the REAL security audit events
        (the Security Center's own queryAuditLogs read) and flags unresolved
        high-severity ones into `security_ops:latest`, verified by re-read; an
        empty read is an honest no-op, a failed read is a failure — never
        "protected" without evidence.
- [x] **B6 complete (31–36).** Roster count: 36 of 50 **EXISTS**.
- [ ] B7 . B8 .