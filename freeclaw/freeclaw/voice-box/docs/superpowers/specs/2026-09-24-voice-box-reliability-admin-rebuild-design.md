# Voice Flow Reliability-First Full-Platform Rebuild

**Date:** 2026-09-24  
**Status:** Approved design; implementation not started  
**Scope:** Entire local Voice Flow platform. No browser automation, deployment, commits, or secret changes.

## 1. Intent

Voice Flow should feel like one dependable platform rather than a collection of disconnected screens and agent experiments. Every existing user/admin route, control, worker, API action, report, audit surface, and manual operator capability remains in scope.

The rebuild has four outcomes:

1. User-facing actions never report success unless the server-side change is proven.
2. Automatic background work and manual/non-autonomous operator work use shared capability contracts and produce authoritative state.
3. The full 17-tab admin remains available and becomes calm, fast, scannable, responsive, and explicit about freshness and degraded states.
4. Redundant refresh traffic and server fan-out are removed without hiding or deleting product capability.

This document is a reliability companion to `2026-09-24-10k-smooth-platform-design.md` and `2026-09-24-admin-console-redesign.md`. The parent design and migration ledger control when documents overlap.

## 2. Current-state audit

### 2.1 AI/admin surfaces

The admin shell currently exposes 17 tabs:

- Overview: Dashboard
- Autonomous System: AI Coworker, Ops Center, System Health, Performance, Security, Activity Stream
- Content: Reports, Feed, Users, Categories, Polls
- Operations: Inbox, Errors, Logs, Email
- Config: Settings

All remain in scope. AI Coworker, Ops Center, agent/workforce widgets, agent execution sections, agent actions, and provider controls are operator surfaces, not disposable implementation details.

The backend agent/workforce graph is shared by inbox, reports, overview widgets, command center, activity, logs, cron runners, and tool infrastructure. UI, API, worker, and registry changes must be planned together so a performance fix does not silently remove a feature or an audit trail.

### 2.2 Product AI capabilities

These remain in scope for preservation and reliability work:

- `api/_assist.js` — submission/category/help assistance
- `api/_ai.js` — moderation, analysis, and poll insight behavior with deterministic fallback
- `api/_ai-summary.js`
- `api/_ai-resolution.js`
- `api/_pre-publish.js` and pre-publish review
- moderation and safety services
- agent/workforce registries, cron runners, reports, activity events, and evaluation jobs

### 2.3 Five-second refresh audit

No active global five-second page-reload loop was found. The current likely sources are:

- `src/lib/api.ts:89-95` — a global five-second GET response cache
- repeated `load()` calls from realtime/visibility paths after that cache expires
- `src/pages/admin/SecurityCenter.tsx:90` — a five-second `useRealtime` debounce subscribed to `settings`, which is not in the supported realtime table set
- `src/lib/vitals.ts:45-77` — five-second Web Vitals upload batching, not page reload
- `api/_agent-team.js:1317-1319` — a five-second agent-state reset, not page reload

The symptom spans reloads, data flicker, and loading skeletons, so the first implementation slice instruments and tests request timing rather than guessing which layer is responsible.

## 3. Reliability contract

### 3.1 Database reads

A missing row and a failed read must be different states.

- An error from Supabase never becomes an empty array, null object, default state, or successful `200` response.
- Empty data is returned only after a successful query confirms no matching row.
- A read failure surfaces as unavailable/stale data with a retry path.
- A read failure never overwrites known-good state with a default object.

### 3.2 Database writes

A mutating endpoint proves the write before reporting success.

- Check returned Supabase errors.
- For destructive or state-changing operations, re-read or select the affected row where practical.
- Audit records are written only after the business mutation is confirmed.
- If the mutation succeeds but a secondary side effect fails, return a partial/degraded result rather than generic success.
- If the primary mutation fails, downstream state transitions do not run.
- Automatic and manual actions use the same idempotency and state-transition rules.

### 3.3 Control-plane safety

Pause, stop, agent-action, provider, session, retry, approval, and cancellation controls fail closed.

- A read error never restores safe-looking defaults that enable work.
- A write error never returns `ok: true`.
- Cached control state updates only after persisted state is confirmed.
- Invalid control IDs are rejected against the known registry.
- Manual controls cannot bypass budgets, safety rules, authorization, or cancellation.

### 3.4 Error presentation

Every user-facing resource has explicit states:

- initial loading
- stale last-known data
- unavailable with retry
- empty after a successful request
- success
- pending automatic job
- awaiting human approval
- failed/dead-lettered job
- cancelled

Students and regular staff see plain actionable states. Administrators additionally see capability ID, execution mode, attempts, safe error code, next retry, queue/provider saturation, lease/claim health, dead-letter status, request/job ID, and authorized manual controls.

A background refresh preserves existing rows and never replaces the whole page with a skeleton. Raw provider errors, queue SQL, claim tokens, secrets, and message bodies are not shown to regular users.

## 4. Refresh architecture

### 4.1 Request layer

Retain:

- in-flight GET deduplication;
- bounded request concurrency;
- bounded timeouts;
- honest HTTP error parsing;
- offline write queue rules.

Change:

- remove the global five-second successful GET response cache for live/admin data;
- keep static/config caching only where it cannot make live state look falsely fresh;
- expose a freshness timestamp to the caller where needed;
- cancel or ignore stale responses after unmount/filter changes.

### 4.2 Realtime

Retain event-driven realtime for supported and readable resources, scoped to the current view and tenant/user boundary.

Remove or correct:

- dead subscriptions to unsupported tables such as `settings`;
- page-level polling loops that duplicate realtime;
- silent refresh catches that provide no retry or stale indicator;
- callbacks that refetch an entire feed because one unrelated row changed.

Realtime callbacks update affected rows in place or use an explicit bounded refresh. They never trigger a whole-page reload for an unrelated event.

### 4.3 Polling

Use polling only for a documented operational need, with a visible interval and backoff. The default is one initial bounded load plus explicit manual refresh. A quiet page does not continuously refetch the database.

## 5. Admin information architecture

The full 17-tab hierarchy remains as documented in the admin redesign spec. The dashboard answers:

1. What needs attention now?
2. What is broken?
3. What changed recently?
4. Is the data current?
5. What automatic work is running, waiting, failed, or paused?
6. Which manual action is available to the operator?

The interface uses real values only, existing product tokens, compact hierarchy, consistent page headers/toolbars/table rows/status chips, visible focus, responsive navigation, restrained motion, and explicit last-updated/stale indicators.

## 6. Phased implementation

### Phase 0 — Evidence and regression gates

- Add request timing diagnostics and deterministic refresh tests.
- Reproduce the reported whole-app reload/flicker/skeleton behavior without browser automation.
- Add tests for database writes returning `{ error }` without rejecting.
- Add tests for the global cache, realtime callbacks, visibility refresh, and unmount cancellation.
- Preserve all existing tests; do not delete, skip, or weaken them.

### Phase 1 — Refresh reliability

- Remove the live-data five-second success cache.
- Remove dead realtime subscriptions.
- Replace silent refresh catches with stale/unavailable/retry behavior.
- Add freshness state to shared loading patterns.
- Verify the original whole-app symptom is gone in API/integration tests.

### Phase 2 — Full admin contract and UX

- Lock the canonical 17-tab registry and PageContext mapping.
- Keep AI Coworker, Ops Center, and all operator controls.
- Add shared automatic/manual capability diagnostics.
- Standardize loading, refreshing, stale, unavailable, empty, pending, success, failed, and cancelled states.
- Make dashboard, reports, feed, inbox, system, and settings surfaces scan-first without removing controls.

### Phase 3 — Backend fan-out and durable work

- Reconcile RLS and Realtime publications.
- Move event/follower delivery to durable outbox/queue contracts.
- Move AI work to bounded, cancellable, globally budgeted jobs.
- Normalize high-amplification data paths using reversible migrations.
- Preserve legacy rollback data and compatibility action contracts.

### Phase 4 — Full-platform verification

- Run focused, typecheck, lint, unit, API, and build gates sequentially.
- Validate local HTTP, staging, Realtime isolation, and read-only production canary.
- Report the highest verified capacity; do not claim unsupported 10,000-user support.

## 7. Verification

Every phase requires:

- a failing reproduction test before the production change;
- the original failure re-run after the change;
- `npm run typecheck`;
- `npm run lint`;
- `npm run test:api`;
- `npm test`;
- `npm run build`.

No success claim is based only on a passing normal-path test.

## 8. Non-goals

- No browser automation.
- No deployment, commit, push, or secret rotation.
- No deletion of useful moderation, summary, pre-publish, poll-insight, writing-assistance, agent/workforce, or manual-control features.
- No fabricated metrics, health scores, or agent activity.
- No broad framework rewrite.
- No unrelated visual redesign outside the admin and shared refresh infrastructure.

## 9. Approval state

The full-feature scope, shared capability contract, one-load client behavior, detailed-admin/simple-user failure model, and migration ledger were approved before this document was written. Implementation remains gated on review of the written design and implementation plan.
