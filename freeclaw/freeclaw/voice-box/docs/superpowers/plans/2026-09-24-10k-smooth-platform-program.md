# Voice Box 10,000-User Full-Platform Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing Voice Box user/admin capability smooth, truthful, recoverable, and honestly prepared for 10,000 simultaneously active users without deleting automatic, manual, AI, or non-AI features.

**Architecture:** Keep the Vercel + Supabase monolith and its public API contracts. Classify every capability as `automatic`, `manual`, or `both`; use one bounded initial client load, authoritative local reconciliation, durable Supabase-backed jobs for expensive background work, and a single dependency-ordered migration ledger.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, Testing Library, Supabase/PostgreSQL, Vercel serverless functions, Node.js 22+.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md`  
**Admin spec:** `docs/superpowers/specs/2026-09-24-admin-console-redesign.md`  
**Surface inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

## Global Constraints

- Use only the configured free model: `opencode/space-bunny-free`.
- Do not use Playwright, Selenium, Puppeteer, or other browser automation.
- Preserve every routed page, admin tab, control, worker, API action, report, audit surface, and manual operator capability.
- Automatic background work and manual/non-autonomous operator work share validated capability/state contracts.
- Every page performs one bounded initial read per visit and no unapproved timed/full-feed refresh.
- User actions reconcile affected local records from authoritative responses; they do not reload unrelated lists.
- GET/read handlers are side-effect free.
- Production load verification is read-only and cannot send POST/PUT/PATCH/DELETE.
- Do not add Redis, Kafka, or a new service without measured evidence.
- Apply migrations in this exact ledger: `016_realtime_rls_reconciliation`, `017_event_outbox`, `018_follower_delivery`, `019_ai_job_queue`, `020_ai_provider_budget`, `021_settings_key_unique`, `022_community_normalized_schema`, `023_community_summary_projection`, `024_community_normalized_reads`, `025_community_normalized_writes`, `026_community_migration_tools`; later migrations start at `027`.
- Never rewrite deployed migrations 001–015.
- Run typecheck, lint, unit tests, API tests, and build sequentially.
- The working tree contains shared uncommitted work. Do not reset, clean, overwrite, or commit unrelated paths.
- Do not deploy, apply remote migrations, change production data, or push without the human gate.

## Review Focus

1. Cross-user identity data: no caller can read or mutate another identity’s private preferences, chat, votes, or content.
2. Hidden/quiet clients: timers, visibility changes, failed sockets, and unrelated realtime rows do not start whole-page work.
3. Concurrent work: duplicate clicks, retries, queue replays, and worker crashes do not duplicate writes or lose state.
4. Large datasets: response bytes and query count scale with the requested page, not total data.
5. Failure honesty: transport, authorization, provider, and database failures never appear as empty data or successful writes.
6. Feature preservation: all 17 admin tabs, including AI Coworker and Ops Center, remain navigable and outcome-tested.

---

## Task 1: Establish a safe shared-tree baseline

**Files:**
- Read: all four approved design specs and the complete platform surface inventory.
- Read: `package.json`, lockfile, `tsconfig*.json`, Vite/Vitest/API configs.
- Modify: the execution-state record selected by the user after review; do not stage unrelated files.

**Interfaces:**
- Consumes: current dirty working tree and existing verification commands.
- Produces: attributable baseline evidence and an exact-path execution boundary.

- [ ] **Step 1: Record working-tree identity**

```powershell
git status --short --branch
git diff --stat
git log --oneline --decorate -20
```

Expected: all shared changes are recorded; no reset, clean, checkout, or commit is performed.

- [ ] **Step 2: Record toolchain and sequential baseline**

```powershell
node --version
npm --version
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run build
```

Expected: record exact exit codes, test counts, build duration, and largest chunks. If counts differ from the historical baseline, record the new evidence rather than forcing old numbers.

- [ ] **Step 3: Create a migration ledger check**

Confirm the current migration directory ends at `015`; assert that no plan or source file claims an unassigned migration number. Keep the ledger in the design spec until implementation begins.

- [ ] **Step 4: Review gate**

A fresh reviewer confirms no unrelated user change was reset, overwritten, or silently included.

## Task 2: Close privacy, security, and page-correctness blockers

**Plan:** `docs/superpowers/plans/2026-09-24-privacy-security-and-page-correctness.md`

**Interfaces:**
- Consumes: identity helpers, API authorization, current migrations, surface inventory.
- Produces: owner-scoped notification preferences, truthful privacy copy, streaming body limits, RLS/Realtime reconciliation, canonical 17-tab context, honest status/error states, and security/page tests.

- [ ] **Step 1: Execute the privacy/security plan with migration `016_realtime_rls_reconciliation` only.**
- [ ] **Step 2: Execute the backend truthfulness/capability audit plan before changing queue or worker behavior.**
- [ ] **Step 3: Verify owner-read success, cross-user denial, malformed identity denial, chunked/multibyte body limits, RLS/publication visibility, query-tab context, status honesty, failure-not-empty behavior, and preservation of every automatic/manual capability.**
- [ ] **Step 4: Run the full sequential gates.**
- [ ] **Step 5: Security review gate.**

Required result: all 17 tabs remain routable; security changes do not remove AI/manual capabilities or expose private rows.

## Task 3: Enforce one-load client behavior and request coordination

**Plan:** `docs/superpowers/plans/2026-09-24-client-one-load-and-request-coordination.md`

**Interfaces:**
- Consumes: Task 2 identity/security behavior, current page APIs, current 17-tab registry.
- Produces: one initial bounded load, explicit refresh, scoped realtime patches, single-flight reads, stale-request cancellation, local action reconciliation, and no passive whole-page polling.

- [ ] **Step 1: Implement shared request lifecycle primitives.**
- [ ] **Step 2: Remove AppProvider heartbeat/notification intervals while retaining one initial summary and local actions.**
- [ ] **Step 3: Replace global realtime fan-out/fallback polling with scoped subscriptions and relevant-row patches.**
- [ ] **Step 4: Migrate every public page and shared component named in the inventory.**
- [ ] **Step 5: Migrate all 17 admin tabs, including AI Coworker and Ops Center, with detailed admin diagnostics and simple user states.**
- [ ] **Step 6: Run focused tests after each page/surface task, then all sequential gates.**

## Task 4: Bound feed, poll, API, and database work

**Plan:** `docs/superpowers/plans/2026-09-24-feed-api-database-scaling.md`

**Interfaces:**
- Consumes: Task 3 stable one-load clients and Task 2 security boundaries.
- Produces: 20-row feed behavior, batched polls, database aggregates, side-effect-free GETs, singleton maintenance, bounded request parsing, and plan-proven indexes.

- [ ] **Step 1: Apply no feed/index migration until the live catalog and `EXPLAIN (ANALYZE, BUFFERS)` gate passes.**
- [ ] **Step 2: Use migration numbers `027`–`031` after the approved `016`–`026` ledger.**
- [ ] **Step 3: Keep all existing feed/report/filter/action response contracts compatible.**
- [ ] **Step 4: Prove request/query counts before and after with representative fixtures.**

## Task 5: Add durable event and follower delivery

**Plan:** `docs/superpowers/plans/2026-09-24-event-outbox-and-follower-delivery.md`

**Interfaces:**
- Consumes: existing event agents, follows, notification preferences, provider dispatch, legacy event/follow snapshots.
- Produces: immutable idempotent events, durable outbox jobs, follower delivery rows, leases/fencing, retries/dead letters, and admin diagnostics.

- [ ] **Step 1: Use `017_event_outbox.sql`.**
- [ ] **Step 2: Use `018_follower_delivery.sql` after the event migration.**
- [ ] **Step 3: Preserve all event-agent and manual Ops Center controls.**
- [ ] **Step 4: Prove concurrent duplicate emission, lease recovery, stale-claim fencing, preference changes, and provider ambiguity.**

## Task 6: Add bounded AI jobs and provider budgets

**Plan:** `docs/superpowers/plans/2026-09-24-ai-job-queue-and-provider-bounds.md`

**Interfaces:**
- Consumes: inbox acceptance, provider implementations, kill switches, admin AI controls, chat status.
- Produces: fast authoritative message acceptance, durable AI job status, combined bounded provider work, global slots/token budgets, cancellation, retry/dead-letter behavior, and manual retry controls.

- [ ] **Step 1: Use `019_ai_job_queue.sql`.**
- [ ] **Step 2: Use `020_ai_provider_budget.sql` after the queue migration.**
- [ ] **Step 3: Preserve AI Coworker, Ops Center, agent actions, moderation, summaries, pre-publish, poll insights, and writing assistance.**
- [ ] **Step 4: Prove timeout-after-commit idempotency, key reuse rejection, kill-switch cancellation, crash recovery, and budget deferral.**

## Task 7: Normalize community storage reversibly

**Plan:** `docs/superpowers/plans/2026-09-24-community-normalization.md`

**Interfaces:**
- Consumes: legacy `settings` keys, current community actions/pages, normalized response types.
- Produces: `legacy → shadow → canary → normalized` modes, atomic normalized mutations, bounded reads, projection counts, and rollback snapshots.

- [ ] **Step 1: Use `021_settings_key_unique.sql` through `026_community_migration_tools.sql` in order.**
- [ ] **Step 2: Keep legacy community rows untouched.**
- [ ] **Step 3: Preserve every existing community action, response field, control, and admin widget.**
- [ ] **Step 4: Prove concurrent writes, ambiguous duplicate data, split-brain prevention, projection drift, and recovery.**

## Task 8: Add observability and safe load validation

**Plan:** `docs/superpowers/plans/2026-09-24-observability-and-safe-load-validation.md`

**Interfaces:**
- Consumes: request IDs, queue metrics, database metrics, existing load harness, approved read-only endpoints.
- Produces: durable percentiles, saturation/dead-letter alerts, protected manual validation workflow, and evidence reports.

- [ ] **Step 1: Use migration `032_observability_metrics.sql` after the core ledger and feed migrations.**
- [ ] **Step 2: Keep all automatic and manual capability diagnostics visible to authorized admins.**
- [ ] **Step 3: Never run production writes/deletes or infer capacity from local tests.**
- [ ] **Step 4: Run local → staging → Realtime isolation → read-only production canary.**
- [ ] **Step 5: Publish the highest verified capacity and blockers.**

## Task 9: Final full-platform proof

- [ ] **Step 1: Run focused tests for every changed route/control/API contract.**
- [ ] **Step 2: Run sequentially:**

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run build
```

- [ ] **Step 3: Re-run the complete surface inventory and confirm all 17 admin tabs plus every public route remain present.**
- [ ] **Step 4: Run the safe load ladder and archive evidence.**
- [ ] **Step 5: Review rollback, migration, queue, RLS, privacy, and operational runbooks.**
- [ ] **Step 6: Do not claim 10,000-user support unless every parent-spec proof condition passes.**
