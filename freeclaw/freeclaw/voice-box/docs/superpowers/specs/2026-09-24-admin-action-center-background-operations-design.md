# Voice Flow Action Center and Background Operations Design

**Date:** 2026-09-24  
**Status:** Approved conversation design; implementation gated on plan review  
**Scope:** User activity recovery, admin information architecture, bounded background work, and the shared update lifecycle.

## Decision delta

This document records the product decision approved in the current session:

- The admin home is one attention-first Action Center with progressive disclosure. It includes useful information from every human-action area without becoming a wall of raw operational panels.
- A live event is a freshness signal, not an instruction to refetch the entire page. The current snapshot remains stable and the admin explicitly chooses **View updates**.
- Routine automation, diagnostics, and maintenance remain server-side/background. They are not part of the primary admin workflow.
- Human decision queues remain visible: reports, content review, appeals, approvals, inbox work, feed/user/poll management, and relevant settings.

This is a narrow, explicit product exception to the earlier full-platform preservation clauses in `2026-09-24-10k-smooth-platform-design.md`, `2026-09-24-admin-console-redesign.md`, and `2026-09-24-platform-surface-inventory.md`. Those documents continue to govern public routes, backend workers, API actions, audit records, security, and reliability. Only the listed human-facing system/AI operations surfaces are retired from the primary admin navigation.

## Current evidence

The reported symptoms have identifiable causes in the current tree:

1. `src/pages/admin/ActivityStream.tsx` registers `useRealtime([...], loadEvents, 2000)`. The `2000` is an event debounce, not a fixed interval. Frequent `posts` or `reports` events can therefore repeatedly invoke a full `ops-summary` request. The page has no single-flight guard, so event bursts can overlap.
2. `src/pages/MyActivity.tsx` loads posts, comments, reactions, votes, polls, appeals, and bookmarks in one `Promise.all`. One failed endpoint replaces the whole page with a page-level activity error even when other sections are available.
3. `src/lib/api.ts` correctly surfaces a server `429` retry message and intentionally does not auto-retry a delay longer than three seconds. That behavior must remain; the UI must explain the wait and preserve known-good data.
4. `api/_action-center.js` already provides a human-required task store and summary, but its GET path is not admin-gated, `loadTasks()` converts read failures into an empty list, and `saveTasks()` swallows write failures before the handler returns a task-shaped success response. The Action Center cannot be trusted as a dashboard source until these boundaries are corrected.

## CAPABILITY

For an authenticated administrator, Voice Flow provides a calm Action Center that shows what needs human attention, preserves the current view while background work continues, and lets the administrator explicitly obtain a newer snapshot without a loading loop. The same administrator can recover individual activity sections and content decisions without losing successful data. Background services retain their authoritative state and auditability without becoming a front-end control room.

## Actors and surfaces

### Administrator

- Signs in to `/admin`.
- Lands on the Action Center (`dashboard`).
- Reviews attention counts and recent verified outcomes.
- Opens Reports for report, pre-review, appeal, and approval decisions.
- Opens focused Feed, Users, Polls, Categories, Inbox, Email, and Settings workspaces when needed.
- Receives a stable snapshot and an explicit update affordance when a supported realtime event occurs.

### Student or regular staff member

- Continues to use existing public routes.
- Does not receive operational or worker internals.
- Receives plain, honest states for their own requests and activity.

### Background services

- Continue to execute scheduled moderation, maintenance, notifications, and other server-side work.
- Persist authoritative state and audit records.
- Do not depend on an admin page remaining open.
- Are not rendered as raw operational controls in the primary admin navigation.

## Information architecture

The canonical primary navigation becomes:

- **Home:** Dashboard / Action Center
- **Content:** Reports, Feed, Users, Categories, Polls
- **Communication:** Inbox, Email templates
- **Configuration:** Settings

The following human-facing system/diagnostic surfaces are retired from the primary admin navigation as an explicit product decision:

- `agent-chat`
- `ops-center`
- `activity-stream`
- `system-health`
- `performance`
- `security`
- `errors`
- `logs`

Their backend routes, workers, audit data, and API actions are not deleted by this design. Old query-tab values redirect to the Action Center with an honest explanatory notice; they never render a hidden operational screen.

## Action Center contract

The first viewport is ordered by decision urgency:

1. **Needs attention:** open reports, flagged/pre-review content, appeals, approvals, unread inbox work, and failed human actions.
2. **At a glance:** bounded counts and trends for posts, comments, reports, users, and polls.
3. **Recent outcomes:** verified moderation/resolution outcomes, not generated worker narration.
4. **Freshness:** last successful snapshot time and a manual Refresh control.
5. **Available updates:** a compact `N new updates · View updates` control when a supported event has occurred.

A panel is never allowed to show a fabricated zero after a failed read. Independent sources may show partial states, but the page must identify which source is stale or unavailable.

## Refresh and event lifecycle

### Initial visit

1. Load one bounded Action Center snapshot.
2. Render honest loading, populated, empty, stale, and partial-error states.
3. Keep the snapshot stable for the route visit.

### Realtime event

1. The event increments or updates a local `updatesAvailable` signal.
2. The current rows, focus, filters, expanded evidence, and selected actions do not move.
3. No full endpoint is called automatically.
4. A polite live region announces that newer updates are available.

### View updates / Refresh

1. Start at most one coalesced fresh read.
2. Ignore stale responses using a monotonically increasing request id or equivalent generation token.
3. Keep the previous snapshot visible while the read is in flight.
4. Replace the snapshot only after the complete/partial result is accepted.
5. Clear the update count only after the accepted read completes.
6. On failure, retain the previous snapshot and show a recoverable stale banner.

### User action

- Mutating actions reconcile the affected row from the authoritative response.
- They do not reload unrelated queues or the whole dashboard.
- Partial bulk success reports exact success/failure counts and preserves failed selections.

## Activity page contract

`MyActivity` loads sections independently. A section is one of:

- posts
- polls
- comments
- reactions and poll votes
- bookmarks
- appeals

Each section has its own `loading`, `data`, `error`, and `lastSuccessfulLoad` state. A failed section does not clear or hide successful sections. Retry retries only the selected failed section. The page-level error is shown only when no usable activity snapshot exists.

The initial load may issue the independent section requests concurrently, but each result is committed independently. The UI never waits for an unrelated section before showing a usable section. No request is retried automatically beyond the existing bounded GET policy, and a server-provided retry delay is displayed verbatim.

## Background operations boundary

The browser must not call `ops-summary` as a reaction to routine post/report events. The Action Center may use the existing `/api/action-center` contract after it is hardened, plus bounded content/queue endpoints. Backend jobs may continue in the background and must expose authoritative state to authorized server-side diagnostics.

The Action Center API contract is:

```ts
type ActionCenterSummary = {
  generated_at: string;
  attention: {
    reports_open: number;
    pre_review_open: number;
    appeals_open: number;
    approvals_pending: number;
    inbox_unread: number;
    failed_actions: number;
  };
  outcomes: Array<{
    id: string;
    kind: string;
    summary: string;
    verified: boolean;
    at: string;
  }>;
  source_status: Record<string, "ok" | "stale" | "unavailable">;
};
```

The response is bounded and read-only. A source failure is represented in `source_status` and does not become a successful empty count. Mutating action-center task operations remain authenticated, validated, verified, and audited.

## Accessibility and visual contract

- WCAG 2.2 AA remains the baseline.
- The update control is keyboard reachable and has an accessible name including the number of updates.
- A polite `aria-live` region announces update availability without stealing focus.
- Focus and expanded evidence remain stable when an event arrives.
- Status is not conveyed by color alone.
- Reduced motion is respected; no spinner or skeleton loop is used for a stable snapshot.
- The layout remains usable at narrow mobile widths and browser zoom.
- Buttons have visible hover, focus, active, disabled, loading, and error states.

## Non-goals

- No capacity claim for 10,000 users.
- No production load test or production write/delete.
- No browser automation.
- No deletion of backend workers, API actions, audit records, or moderation capabilities.
- No new Redis/Kafka/service dependency.
- No automatic full-page refetch after a realtime event.
- No decorative loading delay, fake success, or optimistic claim without an authoritative response.
- No speculative quota of “1,000 improvements.”
- No broad rewrite unrelated to the Action Center, activity recovery, or retired front-end operations surfaces.

## Acceptance criteria

1. A burst of supported realtime events does not invoke a full snapshot request per event.
2. The current admin snapshot remains visible and focused while updates are pending.
3. **View updates** performs one coalesced request and rejects stale responses.
4. A failed Action Center source is shown as stale/unavailable, not as zero.
5. `MyActivity` renders successful sections when another section fails.
6. Retrying one activity section does not reload unrelated sections.
7. The primary admin navigation contains no retired operations surfaces.
8. Old retired tab URLs resolve to the Action Center and do not mount hidden operations components.
9. The Action Center GET and task mutations are admin-authorized.
10. Action Center task persistence failures never return fake success.
11. User/admin actions preserve authoritative row state and report partial bulk outcomes honestly.
12. Focused tests, typecheck, lint, frontend tests, API tests, and build pass sequentially in the shared tree.
13. No commit, push, deploy, remote migration, or production data change occurs without the human gate.

## HANDOFF

Implementation is ready only after the human reviews the companion plan and chooses an execution method. The first implementation slice should be test-first and limited to the refresh/update signal plus `MyActivity` partial-state recovery. The Action Center API hardening must precede any dashboard claim that depends on its counts or outcomes.
