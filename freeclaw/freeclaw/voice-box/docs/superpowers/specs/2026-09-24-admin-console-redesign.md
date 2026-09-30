# Voice Box Admin Console Redesign

**Date:** 2026-09-24  
**Status:** Approved design brief  
**Parent design:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md`  
**Surface inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

## Goal

Rebuild the complete human-facing admin surface as a calm, high-trust operations console for staff handling reports, feed moderation, inbox work, automation, incidents, errors, logs, settings, and system reliability.

Preserve every existing admin route, tab, control, worker, API action, report, audit surface, and manual operator capability. AI Coworker, Ops Center, System Health, Performance, Security, and Activity Stream remain available. Automatic background work and manual/non-autonomous operator work are both first-class.

## Users and context

A school administrator may open the console during an ordinary morning or during a difficult incident. They need to know what needs attention first, understand the current state, and take one clear action without waiting for a background refresh or decoding a wall of decorative metrics.

The interface is calm, trustworthy, direct, and humane. It is an operational tool, not an AI showcase. AI controls are presented as transparent operator tools with explicit state and consequences.

## Information architecture

The full 17-tab admin navigation remains:

### Overview

- Dashboard

### Autonomous System

- AI Coworker
- Ops Center
- System Health
- Performance
- Security
- Activity Stream

### Content

- Reports
- Feed
- Users
- Categories
- Polls

### Operations

- Inbox
- Errors
- Logs
- Email templates

### Config

- Settings

The canonical `?tab=` parser is the only source of tab identity for navigation, PageContext, command palette, tests, and analytics. No feature is hidden behind a capability flag or removed from the human-facing registry.

## Capability model

Each capability is classified as `automatic`, `manual`, or `both`. Automatic work includes scheduled agents, moderation, evaluations, notifications, reports, event delivery, and provider jobs. Manual work includes operator-triggered runs, approvals, rejections, edits, retries, pauses, configuration, moderation, incident investigation, AI Coworker, and Ops Center.

Both execution modes use the same capability contract:

- capability ID and owning module;
- authorization and role requirements;
- validated input and output;
- idempotency and retry policy;
- execution state: `queued`, `running`, `awaiting_human`, `succeeded`, `failed`, or `cancelled`;
- authoritative result and audit event;
- read-only, mutating, or externally billable classification.

No manual action may use a hidden second implementation path that bypasses validation, budgets, safety rules, cancellation, or audit logging.

## Visual direction

- **Register:** Product UI.
- **Color strategy:** Restrained.
- **Theme scene:** A school administrator works under fluorescent office light during a difficult afternoon, needing calm clarity and fast decisions rather than a theatrical control room.
- **References:** Google Admin/M365 information hierarchy, Linear’s disciplined state handling, and Stripe Dashboard’s compact operational tables.
- **Tokens:** Existing `--vb-bg`, `--vb-surface`, `--vb-surface2`, `--vb-border`, `--vb-ink`, `--vb-ink2`, `--vb-ink3`, `--vb-accent`, `--vb-good`, `--vb-warn`, and `--vb-bad` tokens.
- **Typography:** Existing product sans for controls and data; display face reserved for existing page hierarchy where it remains readable. No oversized hero type or decorative display treatment.
- **Controls:** Existing button/input/select/dialog vocabulary with visible hover, focus, active, disabled, loading, and error states.
- **Motion:** 150–250ms state transitions only; reduced-motion support; no page-load choreography, shimmer sweeps, or ambient dashboard animation.

Explicit anti-patterns:

- No AI gradients or gradient text.
- No glass-card wall.
- No nested card grid used as the entire layout.
- No fake “Live” label without a real data source.
- No decorative chart without an operator decision.
- No hidden hover-only actions.
- No failure state disguised as an empty state.
- No feature removal as a performance shortcut.

## Dashboard behavior

The dashboard prioritizes attention:

1. Critical/high alerts and failed system actions.
2. Reports awaiting human review.
3. Recent feed items requiring moderation.
4. Inbox messages requiring response.
5. Automation and provider saturation.
6. System degradation and stale data.
7. Routine trends and announcements.

The dashboard performs one initial bounded load. It has one explicit Refresh control. It does not reload from a timer, tab visibility, unrelated realtime event, or overlapping interval.

Each source has an honest state:

- loading skeleton;
- populated content;
- true empty state;
- stale last-known-good content with an error banner and Retry;
- full error state with Retry;
- partial failure summary when independent sources differ.

## Feeds and reports UX

Reports and feed use dense, scannable rows with consistent columns:

- status/priority;
- content/target;
- author or ownership context;
- age/created time;
- next available action;
- overflow/details affordance.

Actions reconcile the affected row locally. A successful verify, status change, deletion, assignment, approval, retry, or moderation action does not reload the entire table. A failed action leaves the prior row visible and reports the error.

Lists are cursor-paginated and bounded. Large tables use virtualization only when measured row counts justify it; pagination remains the primary scale strategy. Filters live in URL/search-param state where appropriate so a refresh preserves the operator’s context.

## Automatic and manual system surfaces

AI Coworker, Ops Center, System Health, Performance, Security, and Activity Stream remain on-demand operational surfaces:

- no default whole-page polling;
- explicit Refresh;
- last successful update timestamp;
- stale/error banner on failure;
- no synthetic healthy values after a failed request;
- normalized metrics and request/job IDs when available;
- manual run/pause/retry/approval controls where authorized;
- queue depth, attempts, next retry, saturation, and dead-letter detail for administrators.

Students and regular staff see plain states such as `Processing`, `Completed`, `Needs attention`, `Could not complete`, and `Try again`. Raw provider errors, queue SQL, claim tokens, secrets, and message bodies remain hidden from them.

## Page and control contract

Every page/control records:

- route and component owner;
- initial data resources and bounds;
- every button/form/modal/action;
- loading/empty/error/success/disabled/retry state;
- API method, payload, authorization, and local reconciliation;
- keyboard and screen-reader behavior;
- responsive behavior at 320px, 768px, 1024px, and 1440px;
- focused outcome-based tests or explicit static evidence.

A button is not considered functional because it mounts. It must produce an observable authoritative result or an honest error.

## Failure recovery

Server-not-loading symptoms are diagnosed by boundary, not guessed:

1. reproduce the exact route and request;
2. capture status, request ID, duration, and normalized error;
3. identify whether failure is client request, Vercel function, Supabase query, auth, queue, or external provider;
4. add a regression test for the root cause;
5. fix one boundary at a time;
6. verify focused, full, and production-safe checks sequentially.

A failed request must not clear good data, show an empty success state, or claim that a background job ran.

## Accessibility and responsive requirements

- WCAG 2.2 AA.
- Full keyboard operation for navigation, tables, dialogs, filters, and actions.
- Visible focus and semantic labels.
- Status is never conveyed by color alone.
- Dialogs/popovers escape overflow containers and trap focus correctly.
- Mobile navigation is predictable and does not create page-level horizontal overflow.
- Dense tables have a readable stacked-row fallback.
- Reduced-motion users receive state changes without decorative animation.

## Testing and evidence

Executable evidence uses Vitest/component/API tests, static analysis, direct HTTP checks, and local/staging scripts. Browser automation remains disabled for this project.

Required evidence:

- one initial load per page;
- no timer/visibility/full-event reload;
- all 17 admin tabs remain navigable;
- automatic and manual actions share capability contracts;
- backend worker/registry/API tests remain green;
- every primary action has an outcome test;
- failure preserves last-known-good data;
- report/feed action does not trigger a full-list GET;
- admin diagnostics expose bounded queue/provider state without secrets;
- mobile/desktop layout and keyboard state checks;
- p95 read/write budgets and request/query budgets from the parent design.

## Implementation boundary

The admin rebuild proceeds in independently testable slices:

1. canonical 17-tab registry, navigation, and PageContext consistency;
2. shared automatic/manual capability diagnostics;
3. dashboard attention hierarchy and one-load state model;
4. reports/feed row actions and bounded pagination;
5. AI Coworker/Ops Center action-state and manual-control recovery;
6. inbox/errors/logs/system state recovery;
7. responsive/accessibility polish across all 17 tabs;
8. exhaustive route/control regression audit.

No claim of visual perfection is made until each surface has evidence and the final whole-platform review passes.
