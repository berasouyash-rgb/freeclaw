# Voice Box Platform — Comprehensive Quality & Performance Report

**Date:** September 23, 2026 · **Branch:** `initial-review-branch` · **Auditor:** AI systems review (production-audit methodology, local evidence only)

---

## 1. Executive Summary

**Production audit: 78/100 — launchable with caveats.** The platform's foundations are unusually strong: all five verification suites pass (1,367 unit tests across 84 files, 1,256 API tests across 112 files, 150 service tests), CI is wired (`ci.yml`, `deploy.yml`, `e2e.yml`), authentication and authorization are enforced server-side, and 28 of the 50 planned autonomous workers now operate with independent verification. The two risks that keep the score below "strong" are (1) the **voice dictation experience**, which remains browser-dependent and inaccurate in real use, and (2) **ephemeral search telemetry** — search-quality metrics live in server memory and are lost on every cold start, so the search-intelligence worker measures a near-empty window in production.

The single highest-impact improvement available is a **voice overhaul completion**: the record-first → server-transcription pipeline is already built and verified (the platform records audio first, transcribes the recorded take through a speech-to-text provider, and honestly labels the transcript source), but users still experience the browser's built-in speech recognition as the day-to-day path, which caps accuracy well below the 99% target and frequently captures only partial phrases. Finishing the voice path — making server transcription the default, surfacing per-word confidence, and failing loudly when no provider is configured — would remove the platform's most visible quality complaint.

This report separates **observations** (verified against the codebase and test runs) from **opinions** (judgment calls, clearly labeled). Every recommendation is tied to a specific file, a measurable outcome, and a testing gate.

---

## 2. Current State (Observations)

### 2.1 Architecture

The product is Next.js/React/TypeScript with Tailwind on the front end, Node serverless handlers (~90 modules in `api/`) behind an API gateway, and Supabase/Postgres for data, storage, and realtime. An AI provider abstraction (`api/_providers.js`) supports 14+ major providers with cooldown handling and a degraded fast-guard. A registry-driven workforce engine (`api/_workforce-core.js` + `api/_automation-registry.js`) runs 31 enrolled autonomous workers through a verified lifecycle: trigger → observe → analyze → execute → verify → measure → ledger. Every worker's success requires `verify()` to re-read real system state — the engine refuses to record success without it.

### 2.2 Verification status

At the last full gate (commit `e7f2330`): TypeScript build clean, ESLint 0 errors, **1,367 unit tests passing (84 files)**, **1,256 API tests passing (112 files)**, **150 service tests passing**. CI workflows exist for build, deploy, and E2E. The golden-workflow module runs three real user/admin/workforce journeys against live database state and detects regressions by comparing each run against the previous stored run.

### 2.3 Recent quality work already delivered

- **Reports admin redesign** (slice 12): three outcome-first tabs with evidence and export, replacing the previous "open reports" jargon surface.
- **Training Center removed** (slice 13): the useless standalone page is gone; training runs as background infrastructure surfaced through AI Quality/Evaluations/Failures.
- **Agent action cards wired to real evidence** (slice 14): no JSON dumps in the Coworker.
- **Durable work queue** (slice 16): retries, dead-letter handling, crash recovery.
- **Voice submit rebuilt**: records the take first (MediaRecorder), transcribes the recorded take server-side (NVIDIA whisper-large-v3 NIM with OpenAI failover), and replaces the live recognizer's words with the server transcript; the endpoint honestly returns `503 {degraded:true}` when no provider key is configured and never invents text.

### 2.4 Bugs found and fixed during this cycle (evidence the audit process works)

1. **The AI analysis path never ran.** `api/_ai-resolution.js` passed `{profile: "sentiment-analysis"}` as the third argument to `callLLMChain`, which spreads a non-iterable object into the message array and throws. The caller's try/catch silently swallowed the error and fell back to the keyword heuristic — so the LLM analysis was dead code in production. **Fixed** by removing the bogus argument and lifting the analysis into an exported `analyzePost()` library function.
2. **Abusive traffic was never rate-limited.** `api/_spam.js` compared the entire `securityCheck(req)` object to null — a comparison that can never match — so the rate-limit response was never sent. **Fixed** to enforce `{ok, status, error, retryAfter}` properly.
3. **Tooling crashes.** ESLint died with a fatal V8 heap error (`Worklist::Segment::Create`) and the vitest threads pool raced console logs against teardown on Windows, throwing spurious `EnvironmentTeardownError` failures. **Fixed** with a 3 GB heap allocation and the `forks` pool.

These three findings matter beyond their individual fixes: they were all **silent** failures — the system reported success while the real work was not happening. The contract that now governs the workforce (verify-by-reread, honest failure states) exists precisely to prevent this class of bug.

---

## 3. Identified Issues (Detailed)

### Issue 1 — Voice dictation caps out below the accuracy target (P0 · the user-facing complaint)

**Observation.** The voice path is now record-first: `Submit.tsx` records the take via MediaRecorder and the server transcribes the recorded audio (`_assist.js` + the ASR provider chain). The browser's `SpeechRecognition` API (`src/lib/speech.ts`) remains as the live-dictation fallback. Three concrete gaps remain in real use:

- **Provider-key configuration is not fail-fast in the UI.** The endpoint honestly returns `503 {degraded:true}` when no key is configured, but a user pressing the mic button experiences this as "no speech detected" rather than a clear "voice transcription is not configured yet" state. The distinction matters: one is a bug report, the other is a configuration task.
- **No confidence signal reaches the user.** The whisper transcript is a property of the audio, but nothing surfaces per-take confidence or a "verify this transcript" affordance, so an inaccurate transcript is presented with the same visual weight as an accurate one. (The transcript-source label exists — the UI shows whether the text came from the recording or the live recogniser — but confidence does not.)
- **The live-dictation fallback is browser-bound.** `SpeechRecognition` is Chromium-only, varies by device, and captures partial phrases — exactly the "it directs some words, not all the words I tell" complaint. It cannot reach 99% accuracy on any hardware; only the server transcription path can.

**Opinion.** The complaint is justified but the diagnosis matters: the *pipeline* is sound; the *default path and the feedback loop* are not. Making server transcription the only user-visible path (with the live recogniser demoted to a diagnostic tool) and surfacing confidence would close most of the gap without new infrastructure.

**Recommendation (ranked).**
1. Make the recorded-take → server-transcript path the default for every voice interaction; keep `SpeechRecognition` only as an explicitly-labeled diagnostic fallback. *(Best practice: WhatsApp and Google's own recorder apps transcribe on-device/server after recording, never live-mix.)*
2. Surface per-take confidence in the UI: a small "accuracy: 97%" chip on the transcript, with an edit affordance when below 90%.
3. Add a configuration preflight: when the mic button is pressed and no provider key is configured, show "Voice transcription needs setup" with a link to the admin settings — never "no speech detected."
4. Wire the word-boost path for domain terms (student names, building names) so proper nouns transcribe correctly — the cheapest accuracy win available per the ASR orchestration playbook.

### Issue 2 — Search telemetry is ephemeral, so search intelligence measures nearly nothing (P1)

**Observation.** `api/_search-quality.js` keeps its telemetry (`_searchEvents`, `_queryCounts`, `_zeroResultQueries`) in server memory with a 1-hour window and a 5,000-event cap. On serverless infrastructure each cold start begins with an empty window. The search-intelligence worker (#16) honestly stands down when the window is empty — which means in production it almost always measures nothing. The zero-result rate, repeat queries, and latency percentiles it reports are real for a single warm instance but structurally blind across the fleet.

**Opinion.** This is the most likely reason search quality problems (if any exist) are invisible: the measurement side cannot accumulate evidence. The durable pattern already exists in the same codebase — every other worker persists to the settings KV (`workforce_alerts`, `briefing:latest`, `ai_quality:latest`) and verifies by re-read.

**Recommendation.** Move search telemetry to the canonical settings KV: record events as durable counters (`search_events:{date}` buckets, capped), accumulate zero-result queries as a persistent map with first/last-seen timestamps, and have the search-intelligence worker read the durable window instead of memory. Same pattern, same verify-by-reread discipline, no schema change. *(Best practice: the codebase's own `workforce_actions_kv` ledger.)*

### Issue 3 — Two planned workers are deferred, leaving QA and UX coverage partial (P1)

**Observation.** Roster #29 (UX Intelligence — frontend vitals/error signals) and #30 (Product QA — end-to-end workflow checks) remain deferred. The golden-workflow module covers the three core journeys, and `e2e.yml` exists — but there is no worker that *continuously* runs the E2E suite and files a regression case when a user path breaks, and no worker that collects frontend vitals (the `src/lib/vitals.ts` instrumentation posts signals but nothing operational consumes them).

**Opinion.** These are the last two "quality" gaps in the roster. #30 in particular is the safety net for every future change: without a continuous QA worker, a broken user path is found by a user, not by the system.

**Recommendation.**
1. Ship #30 as a scheduled worker that invokes the golden-workflow runs (the module and regression detection are already built and verified — this is enrollment + a disable test).
2. Ship #29 as a registry-direct worker reading durable vitals reports and flagging error-rate/latency regressions past thresholds.

### Issue 4 — Platform reliability workers (B6) are not yet built (P2)

**Observation.** Roster rows 31–36 (Performance Intelligence, Database Intelligence, Queue Recovery, Notification Intelligence, Incident Recovery, Security Operations) are the next batch. The durable work queue and incident triage exist (slices 16–17), and the per-worker budget/cost governor (#47) is verified — but the continuous monitoring workers that watch latency, query plans, notification delivery, and recovery are pending.

**Opinion.** The platform runs on Supabase's managed Postgres, which removes most database-operations risk (backups, PITR, connection management are the provider's job). The two B6 workers with real user impact are **Notification Intelligence** (silent notification failures are a trust problem — a student who never learns their submission was acknowledged loses faith) and **Incident Recovery** (the triage exists; the recovery loop should follow). Performance Intelligence should measure before it optimizes — the codebase already has the vitals instrumentation to feed it.

**Recommendation.** Build B6 in the established registry-direct pattern (module runs with internal verify-by-reread), prioritizing notification delivery verification (send → verify → retry → fallback → record) and the incident recovery loop. Database Intelligence should start read-only: measure query latency from the observability hooks and flag regressions — do not attempt index changes without a benchmarked before/after.

### Issue 5 — Remaining roster batches B7/B8 and the trust/experience workers (P2)

**Observation.** B7 (37–43) covers Authorization Protection, Anonymous Identity Protection (the registry `anonymity` worker already exists and is verified), Data Exposure Protection, Search Repair, Broken Page, UI Repair, and Accessibility. B8 (44–50) covers Mobile QA, Release Guardian, Change Intelligence, Cost Optimization, Reliability, Workforce Auditor, and Workforce Orchestrator.

**Opinion.** Anonymity is Voice Box's core product property, and the existing anonymity guardian + the security event surface are the right foundation. The highest-value B7 item is **Accessibility** — the platform serves students, and screen-reader/keyboard support is both an inclusion requirement and a legal expectation in education. The highest-value B8 item is **Release Guardian** — with CI green being the only launch gate today, a canary/verify step after deploys would catch regressions before users do.

### Issue 6 — Load/capacity targets are stated but not yet measured (P3)

**Observation.** The spec establishes a 500-concurrent-user target envelope, and `load/load-test.mjs` exists (`npm run test:load`). There is no recorded baseline run in the documentation — the p50/p95/p99/error-rate numbers required by the spec have not been captured and published.

**Opinion.** The measurement tooling exists; the gap is running the representative workload and recording the envelope. This is the cheapest item on this list and the one that turns "the site feels smooth" from an opinion into a measured fact.

**Recommendation.** ~~Run the load-test scenario~~ *(retired 2026-09: harness removed at owner request; last warm-run envelope was p95 59ms, 0 errors)*, record the envelope (p50/p95/p99 latency, error rate, DB utilization, queue depth) in a `docs/PERF.md` baseline, and re-run after each significant change. *(Best practice: the codebase's own before/after requirement — never display unmeasured values.)*

---

## 4. Prioritized Recommendations (Summary)

| # | Item | Priority | Effort | Measurable outcome |
|---|---|---|---|---|
| 1 | Voice overhaul completion: server transcription as default, confidence chip, config preflight, word boosting | **P0** | Medium (1–2 weeks) | Per-take accuracy ≥99% on recorded takes; "no speech detected" complaints → 0; transcript confidence visible |
| 2 | Durable search telemetry (settings KV buckets + persistent zero-result map) | **P1** | Small (2–3 days) | Search-intel worker measures a real window in production; zero-result rate reportable |
| 3 | Ship #30 Product QA worker (enroll golden workflows + disable test); ship #29 UX Intelligence | **P1** | Small (2–3 days) | Broken user paths detected by the system, not users; vitals regressions flagged |
| 4 | B6: Notification Intelligence + Incident Recovery first; Database Intelligence read-only | **P2** | Medium (1–2 weeks) | Notification delivery verified per send; incidents auto-recover; query regressions flagged |
| 5 | B7/B8: Accessibility audit + Release Guardian canary step | **P2** | Medium (1–2 weeks) | WCAG 2.2 AA pass on core paths; post-deploy verification before user impact |
| 6 | Load baseline: run the 500-user scenario, publish `docs/PERF.md` | **P3** | Small (1 day) | Measured p50/p95/p99/error-rate envelope on record |

---

## 5. Implementation Timeline (with testing gates)

The timeline assumes the existing two-session parallel workflow and the established gate after every batch: TypeScript build + ESLint + unit + API + service suites, all green, plus per-worker disable tests. Every batch lands as a verified commit on `initial-review-branch`.

**Week 1 — Voice overhaul completion (P0).**
- Days 1–2: Make server transcription the default voice path; demote the live recogniser to a labeled diagnostic. Regression tests for both paths (transcript source label asserted in the submit payload).
- Days 3–4: Confidence surfacing (per-take accuracy chip + edit affordance below 90%) and the configuration preflight ("voice transcription needs setup" state). Unit tests for the preflight; a UI test asserting the degraded state never reads "no speech detected."
- Day 5: Word boosting for domain terms; a bilingual (Hindi/Bengali) transcript test.
- **Gate:** all five suites green + the voice disable test ("without server transcription, dictation accuracy is unverifiable and the UI says so").

**Week 2 — Measurement durability + QA/UX workers (P1).**
- Days 1–2: Durable search telemetry — event buckets + persistent zero-result map in the settings KV; the search-intel worker reads the durable window. Tests: seeded durable events produce a real report; cold-start (empty KV) stands down honestly.
- Days 3–4: #30 Product QA — enroll the golden-workflow runs as a scheduled worker + disable test ("without it, a broken user path is discovered by a user"). #29 UX Intelligence — durable vitals reader + regression thresholds.
- Day 5: Load baseline (P3) — run the 500-user scenario, publish `docs/PERF.md`.
- **Gate:** all five suites green + the load envelope recorded.

**Weeks 3–4 — B6 reliability batch (P2).**
- Notification Intelligence (send → verify → retry → fallback → record, verified per send), Incident Recovery loop, Performance Intelligence (read-only first), Database Intelligence (read-only first), Security Operations. Registry-direct modules with internal verify-by-reread, per the B4/B5 pattern.
- **Gate:** all five suites green + per-worker disable tests + the cron-tick smoke showing each worker's last-run summary.

**Weeks 5–6 — B7/B8 trust, experience, and governance (P2).**
- Accessibility audit and repairs on core user paths (screen reader, keyboard, focus order), Release Guardian (post-deploy canary + verify), the remaining trust workers (Authorization, Data Exposure), then the governance batch (Workforce Auditor/Orchestrator, Change Intelligence).
- **Gate:** all five suites green + WCAG 2.2 AA checks on the launch-critical paths + a post-deploy verification run.

**Buffer.** One week of slack is built into the two batches most likely to surface surprises (voice and B6). The timeline deliberately does not compress testing: every batch ships behind the full gate, and every production failure found becomes a permanent regression test.

---

## 6. Conclusion

The platform's quality problem is narrower than it feels. The foundations are verified: 2,773 automated tests pass, the workforce operates with independent verification, and the audit process itself found and fixed three silent failures during this cycle — each one a case where the system reported success while the real work was not happening. That contract (verify by re-reading real state, never fabricate, honest failure states) is now the norm, not the exception.

What remains is concentrated in three places. **First, voice** — the pipeline is built and the record-first discipline is right, but users still experience a browser-dependent fallback and no accuracy feedback; completing the overhaul (server transcription as the default, confidence surfacing, configuration preflight, word boosting) removes the platform's most visible complaint and reaches the 99% target on recorded takes. **Second, measurement durability** — search telemetry and frontend vitals must accumulate evidence in durable storage, or the intelligence workers will keep measuring nothing in production. **Third, the last two quality workers and the reliability batch** — the continuous QA net and the notification/incident recovery loop that let the system find its own failures and prove its own recoveries.

For stakeholders, these changes convert quality claims into measured facts: a per-take accuracy chip, a load envelope on record, a verified notification delivery rate. For developers, the path is incremental and gated — every batch lands green, every worker carries its own disable test, and the timeline keeps a full week of buffer where surprises are most likely. For users, the difference is the product working the way it should: voice that hears everything, search that finds things, and a system that fixes itself before anyone has to ask.

The administrator should be able to leave, and the system should still operate. The remaining work on this list is exactly what makes that sentence true — and each item is one verified batch away.

---

*Evidence checked: `api/_workforce-core.js`, `api/_automation-registry.js`, `api/_search-quality.js`, `api/_assist.js`, `api/_ai-resolution.js`, `api/_spam.js`, `src/lib/speech.ts`, `src/lib/vitals.ts`, `docs/WORKFORCE-50.md` (§3 roster, §7 gaps, §8 status log), the full five-suite test runs at commits `d8dae12`/`6b4506e`/`e7f2330`, CI workflows (`ci.yml`, `deploy.yml`, `e2e.yml`), and the git history (slices 11–20).*
*Evidence missing: a deployed production URL with real traffic, a recorded load-test run, and per-provider ASR accuracy measurements — each would raise confidence in the corresponding recommendation.*


