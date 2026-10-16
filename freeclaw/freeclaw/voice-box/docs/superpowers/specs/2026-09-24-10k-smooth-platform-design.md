# Voice Flow 10,000-User Smooth Platform Design

**Date:** 2026-09-24  
**Status:** Approved design  
**Scope:** Entire user and admin platform

## 1. Objective

Make Voice Flow smooth and predictable for 10,000 simultaneously active users on the existing Vercel + Supabase stack, while keeping every routed user and admin page functional.

“Fully improved” means exhaustive evidence-backed coverage of every routed page, every admin page, every button, form, modal, navigation path, keyboard interaction, and API-backed function. It does not mean rewriting every line or inventing a fixed number of changes. Each surface is inspected and tested for correctness, one-load behavior, loading/empty/error/success states, accessibility, responsive behavior, security, performance, and recovery. No known high-severity defect or unverified interactive control remains at completion.

The platform must not create recurring full-page or full-feed refreshes. Each page performs one bounded automatic read when entered. User actions update the affected records locally from authoritative server responses. Further data changes appear after a manual refresh or when the user navigates back to the page.

This is a capacity and reliability program, not a quota of arbitrary “1,000 improvements.” Only real, evidence-backed defects and bottlenecks are changed.

## 2. Confirmed Constraints

- Target: 10,000 simultaneously active users.
- Preserve every existing user route, admin route/tab, control, worker, API action, report, audit surface, and manual operator capability.
- Support both automatic background execution and manual/non-autonomous operator execution through shared capability contracts.
- Rebuild the full 17-tab admin around calm operational hierarchy, explicit refresh, honest failure recovery, and local row reconciliation.
- Initial stack: Vercel + Supabase; no new service unless measurements prove the current stack cannot meet the target.
- User experience: one automatic load per page visit; no timed full refresh.
- Verification order: local integration, dedicated staging, Realtime isolation, then production read-only canary.
- Production load tests must never perform application writes or deletes.
- Existing anonymous identity and product behavior remain unless a separate security decision changes them.
- Work proceeds in small, independently reversible slices with regression tests.
- Test and lint commands run sequentially, not in parallel.

## 3. Non-Goals

- Rewriting the whole platform in one migration.
- Adding Redis, Kafka, or a new queue service before current-stack measurements justify one.
- Claiming 10,000-user support without a recorded load test and resource headroom.
- Filling a 1,000-change quota with speculative optimizations.
- Restoring timed polling merely to make stale dashboards appear live.
- Removing routed product pages to simplify the implementation.
- Declaring a page “fully improved” based only on a successful mount test; every interactive path requires an outcome-based regression test or explicit evidence that existing coverage already proves it.
- Removing any existing route, tab, button, worker, API action, report, audit surface, or manual control as a side effect of performance work.

## 4. Current Baseline

Fresh local evidence from the working tree:

- Production build: passing.
- ESLint: passing.
- Unit tests: 86 files, 1,419 tests passing.
- API tests: 130 files, 1,412 tests passing.
- Main JavaScript chunk: 382.90 kB minified / 121.60 kB gzip.
- Production root response: `Cache-Control: no-cache`, `X-Vercel-Cache: MISS` on the checked request.
- Prior documented load evidence covers 500 concurrent local users, not 10,000 production-shaped active users.

The working tree contains extensive modifications from other work and must be treated as shared user work. Implementation slices must avoid overwriting unrelated or concurrent changes.

## 5. Root Causes of Current Friction

### 5.1 Client refresh and fan-out

- Realtime channels subscribe to global tables and deliver every matching row event to every browser subscriber.
- Several pages react to unrelated events by refetching complete feeds, posts, comments, reactions, or poll state.
- A healthy quiet realtime channel can start a 30-second fallback poll and remain in that polling mode indefinitely.
- App-wide heartbeat and notification checks repeatedly fetch full user histories.
- Hidden tabs can still execute realtime callbacks and several raw polling timers.
- Home declares a 20-row page but requests a non-paginated feed that may return 300 rows.
- Home then requests each linked poll separately.
- Some read-like POST requests can enter the offline replay queue.
- Duplicate or slow loads can overlap because there is no shared single-flight/dirty mechanism.

### 5.2 API and database amplification

- Feed enrichment transfers reaction, comment, poll, and vote rows to Node.js for counting.
- Poll result hydration transfers individual vote rows.
- Exact counts are sometimes calculated and then discarded.
- Public GET handlers can trigger cleanup, purge, archive, or telemetry writes.
- Cleanup initialization runs from the consolidated API module and can overlap across cold instances.
- The consolidated API module has a large static import graph and cold-start cost.
- Event delivery and follower notifications use shared JSON rows and synchronous fan-out.
- Inbox message handling performs multiple synchronous LLM attempts while holding a serverless request.
- Large community documents are read and rewritten as whole JSON values.
- Anonymous rate limits are per warm instance rather than globally enforced.
- Body-size validation trusts `Content-Length`; chunked bodies can be buffered without a streaming byte limit.
- Realtime allowlists and later RLS/publication migrations have drifted out of sync.
- Notification preferences return stored email and phone data for a caller-supplied user ID without verifying that the caller owns that identity.
- Product privacy/admin copy claims no personal data is stored while notification settings explicitly persist email and phone values.
- Several page tests exercise missing routes or 404 content rather than the intended page.
- Some admin streams replace failures with empty data instead of an honest error state.
- The admin page-context mapper disagrees with the real query-tab router.
- Several successful actions refetch entire lists instead of reconciling the affected record.
- Several source-proven index shapes are absent, but indexes must be validated against the live catalog and query plans before deployment.

## 6. Platform-Wide Product Surface Contract

A route-level inventory is generated from the router and maintained for the duration of the program. It includes every user route, authentication gate, legal/static route, community route, admin shell, and admin tab.

For every page, the inventory records:

- route and owning component;
- initial API resources and expected row bounds;
- buttons, links, forms, dialogs, menus, and destructive actions;
- loading, empty, error, success, disabled, and retry states;
- mutation endpoint and authoritative local-state update;
- realtime/timer behavior, which must be absent unless explicitly justified;
- keyboard and screen-reader behavior;
- mobile and desktop layout behavior;
- authorization boundary;
- focused regression tests;
- remaining evidence gaps.

For every button or function, completion requires one of the following:

1. A passing outcome-based test demonstrates the user-visible result.
2. A static contract test proves the correct API method, payload, authorization, and state transition.
3. A documented read-only/static surface has direct code evidence and no mutation boundary.

A click that produces no observable result, a dead control, a silent failure, an incorrect endpoint, an unbounded load, or a control without an honest loading/error state is a defect and must be fixed. A feature may be retired only through a separate, explicit product decision; this performance program does not retire features.

The same inventory covers API handlers: method, authentication, authorization, validation, bounded query/write behavior, idempotency, error contract, rate-limit class, observability, and regression coverage.

### 6.1 Full-platform capability and execution contract

Every existing capability remains reachable and auditable. The optimization may change when, how often, and in what order work runs, but it may not silently remove a route, tab, button, worker, setting, report, audit record, or API action.

Each capability is classified as:

```ts
type ExecutionMode = "automatic" | "manual" | "both";
```

The shared capability contract records the capability ID, owning module, supported execution mode(s), authorization, validated input/output, idempotency and retry policy, execution state, authoritative result, and audit event. Execution states are `queued`, `running`, `awaiting_human`, `succeeded`, `failed`, and `cancelled`.

Automatic work includes background agents, moderation, evaluations, notifications, reports, scheduled workers, event delivery, and provider jobs. Manual/non-autonomous work includes operator-triggered runs, approvals, rejections, edits, retries, pauses, configuration, moderation, incident investigation, AI Coworker, and Ops Center. Both paths call the same capability/state contract and produce the same authoritative audit trail; no second hidden implementation path is introduced.

### 6.2 Full 17-tab admin hierarchy

The complete current admin navigation remains:

- **Overview:** Dashboard.
- **Autonomous System:** AI Coworker, Ops Center, System Health, Performance, Security, Activity Stream.
- **Content:** Reports, Feed, Users, Categories, Polls.
- **Operations:** Inbox, Errors, Logs, Email.
- **Config:** Settings.

The canonical `?tab=` parser is the only source of tab identity for navigation, PageContext, command palette, tests, and analytics. AI controls are presented as operational tools, not removed or hidden. The dashboard prioritizes critical/high alerts, reports, moderation, inbox work, and failed actions before routine trends, while automation health and system state remain visible and actionable.

The redesign uses the existing restrained `--vb-*` tokens, compact hierarchy, standard controls, visible focus, purposeful state motion, and no decorative gradients, glass-card walls, fake “live” labels, or ambient animation. Every tab has one initial bounded load, an explicit Refresh where data is present, local reconciliation after successful actions, and honest stale/error states.

### 6.3 Client lifecycle

Each routed page performs one bounded initial read. It does not perform timed full refreshes, visibility-triggered full refreshes, or unrelated-realtime full reloads. Realtime is scoped to the records the current view needs and patches only affected records. A successful user action updates the affected local record from the authoritative response; a failed request preserves last-known-good data and offers a retry.

### 6.4 Backend and migration contract

Keep Vercel + Supabase. Automatic jobs use durable Supabase-backed queues/outbox workers; manual controls call the same capability contracts. No Redis, Kafka, or new service is added without measured evidence.

The single migration ledger is:

1. `016_realtime_rls_reconciliation.sql`
2. `017_event_outbox.sql`
3. `018_follower_delivery.sql`
4. `019_ai_job_queue.sql`
5. `020_ai_provider_budget.sql`
6. `021_settings_key_unique.sql`
7. `022_community_normalized_schema.sql`
8. `023_community_summary_projection.sql`
9. `024_community_normalized_reads.sql`
10. `025_community_normalized_writes.sql`
11. `026_community_migration_tools.sql`

Later feed/index migrations receive numbers only after this ledger is updated. Existing public action names, methods, response fields, and status meanings remain compatible; new fields are additive and optional. GET handlers are side-effect free, list reads are bounded, mutations are validated and idempotent, queue claims use leases/fencing tokens, and provider work has global budgets, deadlines, cancellation, retries, and dead-letter states.

### 6.5 Failure visibility

Students and regular staff see plain states such as `Processing`, `Completed`, `Needs attention`, `Could not complete`, and `Try again`. Administrators additionally see capability ID, execution mode, state, attempts, safe error code, next retry, queue/provider saturation, lease/claim health, dead-letter status, request/job ID, bounded audit history, and authorized `Retry`, `Pause`, `Resume`, `Approve`, or `Cancel` actions.

A failed user action never becomes a false empty success. A failed background job is visible in admin diagnostics without exposing secrets or message bodies. User retries are deduplicated by idempotency key. Manual retries cannot bypass authorization, budgets, safety rules, or cancellation.

## 7. Client Architecture

### 7.1 Page lifecycle

Each routed page follows the same lifecycle:

1. Perform one bounded initial read.
2. Render loading, success, empty, and error states honestly.
3. Keep the resulting data stable for the page visit.
4. Update only records affected by a user action.
5. Do not reload on a timer.
6. Do not reload when a hidden tab becomes visible.
7. Reload only through explicit user action or a new route entry.

Static, legal, and accessibility pages perform no application data polling.

### 7.2 User actions

- Create actions insert the authoritative server response into local state.
- Edit actions replace only the edited record.
- Delete actions remove only the deleted record after server confirmation.
- Vote and reaction actions update the affected target locally.
- Comment and chat sends append or reconcile only their own thread.
- Failed optimistic actions restore the previous state and show an honest error.
- A successful action must not clear and reload unrelated feeds.
- Full-list “Load more” remains explicit and cursor-based.

### 7.3 Realtime

Under the approved one-load policy:

- Pages do not automatically incorporate passive cross-user changes while the visit remains open.
- Realtime must not trigger complete page or feed refetches.
- Silent row patches are disabled under this design because they still change data without a manual refresh or route re-entry. Any future exception requires a separate explicit user decision.
- Private tables that cannot legally use anonymous Realtime are excluded from anonymous client subscriptions and client capability lists; their authorized server-side features and controls remain available.

### 7.4 Polling and presence

- No page-level recurring data poll remains.
- Heartbeat is one-shot or sampled, not every 120 seconds for every session.
- Notification/chat catch-up loads once after first paint, not every 180 seconds.
- Community and admin timers are removed or converted to explicit manual refresh actions.
- Web Vitals reporting is sampled and primarily flushed on hidden/unload rather than every five seconds for every session.
- Countdown components share one clock where practical rather than creating one timer per card.

### 7.5 Request coordination

- Identical in-flight reads share one promise.
- A completed resource read clears its dirty flag once.
- A read requested during an active load schedules at most one follow-up read.
- Search aborts superseded requests.
- Infinite-scroll reset invalidates stale page responses.
- The browser wait queue is bounded and request timeouts begin after a concurrency slot is acquired.
- Read-like POST requests are explicitly non-mutating and cannot enter the offline write queue.

## 8. API Architecture

### 8.1 Bounded reads

- Home requests `paginate=1&limit=20` by default.
- Every list endpoint has an explicit maximum row count.
- Cursor pagination includes a stable unique tie-breaker where equal timestamps are possible.
- Public list responses do not fetch thousands of rows for client-side filtering when a database predicate can express the same rule.
- Admin tables are paginated; the dashboard does not download entire tables to calculate tiles.

### 8.2 Aggregates and batching

- Feed reactions, comments, poll totals, and vote totals are aggregated in PostgreSQL.
- Responses return aggregate values, not all child rows.
- Linked poll data is included in the feed response or fetched with one bounded batch endpoint.
- Duplicate poll IDs are removed before constructing requests.
- Exact total counts are skipped on page one and calculated only when required for pagination.
- Repeated public reads use a complete-response cache rather than caching only raw parent rows.

### 8.3 Concurrency and caching

- Identical cold-cache requests share one in-flight server computation per cache key and process.
- Cache keys include every response-shaping input: route, normalized query, locale, viewer when applicable, and permission context.
- Private viewer-specific responses are never publicly cached.
- Public read endpoints emit explicit cache directives compatible with their invalidation behavior.
- Cache stampedes are prevented by a single-flight promise.

### 8.4 Side-effect-free reads

- GET, HEAD, and other read methods do not purge, archive, repair, enqueue, or write telemetry.
- Cleanup and maintenance run from authenticated cron/worker paths.
- A PostgreSQL advisory lock or singleton lease guarantees one maintenance execution per interval across warm instances.
- Post expiry, poll archive/orphan repair, suggestion expiry, and durable telemetry flush are moved out of request handlers.

### 8.5 Request safety

- Body readers count bytes incrementally and abort above the configured limit.
- `Content-Length` is an optimization hint, not the enforcement boundary.
- Streaming request handling avoids unnecessary byte-array flattening and copying.
- Local rate-limit maps have hard caps and deterministic TTL cleanup.
- Vercel edge controls provide coarse global protection.
- A Supabase-backed counter or RPC is used only if exact globally shared quotas remain necessary.
- Expensive endpoint classes receive independent budgets: search, uploads, reactions, poll voting, comments, posts, and AI operations.

### 8.6 Route isolation

- The consolidated API entry point lazy-loads handlers by normalized route.
- Proven hot routes become independently deployable serverless functions or route chunks with smaller import graphs.
- Cold-start p95 is measured before and after route extraction.
- Route extraction does not duplicate auth, error, or observability logic.

## 9. Data Architecture

### 9.1 Index discipline

No index is added because it “sounds useful.” Each candidate requires:

1. Live catalog inspection.
2. Representative table cardinality and selectivity.
3. `EXPLAIN (ANALYZE, BUFFERS)` for the exact query shape.
4. Verification that the plan changes after creation.
5. Write-cost and storage assessment.
6. A rollback/drop plan.

Initial source-proven candidates are:

- `polls(post_id)`.
- `poll_votes(author_id)`.
- A unique `chat_threads(thread_id)` only after duplicate-row reconciliation.
- Unrestricted admin feed timestamp indexes only if their exact plans currently sort or scan excessively.

### 9.2 Event and notification processing

- Shared JSON event documents are replaced by append-only event/outbox rows.
- Agent triggers are claimed with `FOR UPDATE SKIP LOCKED` or an equivalent database lease.
- Follower delivery creates queued recipient work rather than performing per-follower reads, writes, SMS, and email inside the originating request.
- Event handlers are idempotent and safe under worker retry.
- Delivery status and retry count are persisted.

### 9.3 AI work

- User messages are committed first and the API returns a fast accepted response.
- Classification and reply generation run from a durable database-backed job queue.
- One structured provider call replaces independent classification and reply calls where possible.
- Provider attempts are bounded, cancellable, and governed by a global concurrency budget.
- A request never remains open for the full provider generation window.

### 9.4 Community normalization

Large community JSON documents are normalized in an isolated migration after the primary user path is stable:

- communities;
- memberships;
- community posts/comments;
- reactions;
- votes;
- compact summary projections for list pages.

The migration includes duplicate detection, backfill verification, uniqueness constraints, compatibility reads, and rollback instructions.

## 10. Security Release Blockers

The following are fixed before public 10,000-user rollout:

- RLS/publication drift that can expose private, deleted, or hidden rows through anonymous Realtime or PostgREST.
- Unauthenticated or incorrectly authorized reads of notification email/phone preferences.
- Privacy, settings, and admin documentation that make mutually contradictory storage claims.
- Chunked request bodies that bypass the advertised body limit.
- Unauthenticated or weakly authorized diagnostic and maintenance reads.
- Any production load path capable of application writes or deletes.
- Per-instance-only controls presented as global rate limits.

The existing client-controlled anonymous identity limitation remains a documented architectural risk until the user approves a signed server identity design.

## 11. Observability

### 11.1 Required metrics

- Edge requests, cache status, and origin requests by normalized route.
- Function duration, cold starts, timeouts, 4xx, 5xx, and 429 responses.
- p50, p95, and p99 latency by route and cache status.
- Supabase Data API requests, query count, response bytes, database time, CPU, memory, connections, IO, locks, and slow statements.
- Realtime connection success, joins, join latency, messages, fan-out, reconnects, and disconnect reasons.
- Application request amplification: Vercel requests multiplied into Supabase requests.
- Business-write amplification: heartbeat, telemetry, cleanup, events, follower delivery, and AI jobs.
- Queue depth, oldest job age, retries, dead letters, and provider saturation.

### 11.2 Correlation

- Every response carries a request ID.
- Logs and errors include request ID, normalized route, status, duration, cache status, and safe tenant/session metadata.
- URLs, query strings, message bodies, and personal data are redacted from telemetry.
- Metrics use normalized route labels rather than raw concrete IDs.

## 12. Load-Test Safety

The current remote load harness is not eligible for use until it is repaired.

Required properties:

- HTTPS support.
- Exact hostname allowlist.
- Expected Supabase project-ref verification.
- GET/HEAD-only production mode.
- No provider credentials in staging load tests.
- No production POST/PUT/PATCH/DELETE.
- Correct journey IDs and response parsing.
- HTTP 4xx/5xx classification.
- Generator CPU, memory, socket, event-loop, and packet-loss monitoring.
- Automatic abort conditions.
- Separate reports for Vercel requests, Supabase requests, database work, and Realtime work.

## 13. Validation Ladder

### 13.1 Local integration

1. Ten sessions for two minutes.
2. Fifty sessions for five minutes.
3. Two hundred sessions for ten minutes.
4. Repeat with disposable writes enabled.
5. Verify read-after-write, cache deduplication, authorization, retries, and expected 4xx behavior.

Local Vite results are correctness evidence, not production capacity evidence.

### 13.2 Dedicated staging HTTP

1. One RPS for five minutes.
2. Ten RPS for five minutes.
3. One hundred RPS for two minutes on a fresh deployment.
4. Open-model stages: 100, 500, 1,000, 2,500, 5,000, 7,500, and 10,000 sessions.
5. Repeat the final stage three times under different conditions.

The final stage must include 80% foreground and 20% hidden-tab behavior, realistic navigation mix, and measured request amplification.

### 13.3 Realtime isolation

Connection stages are separate from HTTP:

`100 → 500 → 1,000 → 2,500 → 5,000 → 7,500 → 9,000 → 10,000`

If the configured project limit is exactly 10,000, the 10,000-connection stage is reported as unvalidated rather than passed without headroom.

### 13.4 Production read-only canary

Initial production scope:

- `HEAD /`
- `HEAD /health-chunks.json`
- `HEAD` immutable hashed assets

Ramp:

1. One RPS for five minutes.
2. Five RPS for ten minutes.
3. Twenty-five RPS for fifteen minutes.
4. One hundred RPS for thirty minutes.

Cap at the lower of 100 RPS or 0.5% of current peak edge traffic. Production API canary remains blocked until a verified side-effect-free API route exists.

## 14. Acceptance Targets

### 14.1 User experience

- Warm user-facing reads: p95 < 500 ms.
- User-facing write acknowledgements: p95 < 800 ms; asynchronous AI work is measured by job acceptance and completion separately.
- LCP p75 ≤ 2.5 seconds.
- INP p75 ≤ 200 ms.
- CLS p75 ≤ 0.1.
- TTFB p75 ≤ 800 ms.
- No recurring full-page or full-feed refresh.
- One initial data request per bounded page resource.
- User actions remain responsive under the validated active-user workload.

### 14.2 Service levels

- Unexpected 5xx/timeouts ≤ 0.01% overall per staging stage.
- No 30-second window above 0.1% unexpected errors.
- Mixed-workload 429s ≤ 0.02%; sustained 0.1% fails the stage.
- Zero duplicate writes, lost writes, unauthorized results, or mismatched authorization.
- Core read/write availability target: 99.9% over 30 days.
- 99% of core reads below 1.8 seconds.
- 99% of core writes below 3 seconds.

### 14.3 Automatic abort

Abort immediately for:

- wrong environment or host;
- any unexpected production mutation;
- 5xx/timeouts above 1% for 15 seconds;
- 5xx/timeouts above 0.1% for 60 seconds;
- 429s above 0.1% for 60 seconds;
- p99 above twice its gate for two 30-second windows;
- p95 above its gate for five minutes;
- Supabase CPU above 85% for five minutes;
- database connections above 85% for two minutes;
- lock waits, deadlocks, retry storms, or failed write acknowledgments;
- Realtime quota above 80% for 30 seconds;
- generator saturation;
- forecast spend above the approved budget.

## 15. Delivery Strategy

Implementation proceeds as independently reversible slices:

1. Exhaustive route/control/API inventory with existing-test and evidence-gap mapping.
2. Notification-preference authorization/privacy contract and truthful product copy.
3. Preserve all automatic/manual capabilities while rebuilding the full 17-tab admin shell, feeds, reports, and operational states around the approved calm product design.
4. Refresh-policy regression tests and client lifecycle removal.
5. Duplicate-request/single-flight protection and stale-request cancellation.
6. Home bounded pagination and poll batching.
7. Feed/poll database aggregation and page-one count removal.
8. Side-effect-free GET handlers and singleton maintenance lock.
9. Request streaming limit and rate-limit hardening.
10. RLS/publication reconciliation.
11. Realtime allowlist and subscription cleanup.
12. Page-by-page and button-by-button fixes driven by the inventory.
13. Admin route-context, missing-test, and misleading-status corrections.
14. Hot-route import isolation based on measured cold-start evidence.
15. Event/outbox and follower-delivery queue.
16. AI job queue and provider-call reduction.
17. Community normalization migration.
18. Safe load harness and complete validation ladder.
19. Index migrations justified by live plans and measured bottlenecks.

Each implementation slice must:

- start with a failing regression test or explicit measured baseline;
- make the smallest complete change;
- run its focused tests;
- run typecheck and lint;
- remain compatible with existing behavior;
- record before/after evidence;
- be independently revertible.

## 16. Rollback and Operational Safety

- Feature-flag behavior changes where a safe partial rollout is possible.
- Keep additive database migrations separate from application activation.
- Do not combine destructive normalization with unrelated feature changes.
- Preserve the previous Vercel deployment for application rollback.
- Every index/data migration includes a documented rollback or recovery path.
- Production canary has a named operator and independent kill-switch owner.
- Any unexplained mutation, correctness mismatch, or sustained saturation ends the test and triggers incident review.

## 17. Final Proof Standard

Voice Flow may be described as fully optimized and supporting 10,000 simultaneously active users only when:

- every route, page, admin tab, interactive control, and API-backed function in the inventory has passing outcome-based evidence or an explicit documented exception;
- all 17 admin tabs, including AI Coworker and Ops Center, remain reachable; automatic workers, manual controls, backend registries, reports, evaluations, and audit records remain covered;
- no known dead control, silent failure, incorrect endpoint, unbounded request, missing critical state, misleading status value, or unauthorized personal-data read remains;
- the final mixed HTTP stage completes at 10,000 open sessions;
- the Realtime connection target is proven with documented headroom;
- all correctness counters remain at zero failures;
- latency, error, database, cache, and cost targets pass;
- no manual timed refresh is required to keep pages correct;
- the result is repeated under different conditions;
- evidence and limitations are recorded.

If any condition is unavailable, the final report states the highest verified level and the exact blocker. It does not extrapolate or claim unsupported capacity.
