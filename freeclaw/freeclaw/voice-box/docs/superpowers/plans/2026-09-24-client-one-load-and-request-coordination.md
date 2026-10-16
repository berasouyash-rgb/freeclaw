# One-Load Client and Request Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use only `opencode/space-bunny-free`.

**Goal:** Make every routed user and admin surface perform one bounded initial read, remain stable until an explicit boundary, reconcile only affected records from authoritative mutation responses, and preserve every existing route, control, capability, worker, report, audit surface, and manual operator action.

**Architecture:** Put cancellation, single-flight read coordination, bounded queueing, read-intent classification, and post-slot timeouts in `src/lib/api.ts`. Add a small resource-state/reconciliation layer used by route components, make pagination and realtime opt-in rather than automatic, and centralize the shared clock and telemetry flush policy. Migrate public routes, shared interactive components, and the complete admin registry one surface at a time; a successful mutation patches its affected entity and never reloads an unrelated list.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, Testing Library, existing `src/lib/api.ts`, existing Supabase Realtime client, Vercel + Supabase API handlers.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md`  
**Admin spec:** `docs/superpowers/specs/2026-09-24-admin-console-redesign.md`  
**Inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

## Global Constraints

- This is a documentation-only planning change. Do not implement, verify, stage, commit, push, deploy, apply migrations, or run browser automation while producing this plan.
- Use only `opencode/space-bunny-free`; do not delegate to another model.
- Preserve all routes, `/admin?tab=` keys, shared controls, API actions, workers, registries, reports, evaluation/audit surfaces, AI Coworker, Ops Center, and manual operator actions.
- A route visit performs one bounded initial read per resource. Timers, visibility changes, failed/quiet sockets, and passive Realtime events do not change a page snapshot.
- A snapshot changes only through explicit Refresh, Retry, a filter/query change, route re-entry, user-triggered pagination, or an authoritative response to a user/admin action.
- Realtime is explicit opt-in only. No current page subscribes for silent row patches or silent full-list refetches. If a future surface exposes an opt-in Live Updates control, it must be user-enabled, row-scoped, and independently tested.
- A successful create inserts the authoritative record; an edit replaces only the affected record; a delete removes only the server-confirmed ID; vote/reaction/follow/comment/chat actions reconcile only their target.
- A failed read preserves last-known-good data and shows `stale` or `error`; a failed mutation restores optimistic state and shows an honest error. Transport failure never becomes an authoritative empty list.
- Read-like POSTs require an explicit read intent and never enter the offline write queue. State-changing requests use an explicit replay policy; ambiguous timeouts are not replayed.
- `api.ts` owns caller `AbortSignal` propagation, identical in-flight GET sharing, a bounded waiter queue, timeouts that begin only after a concurrency slot is acquired, and at most one dirty follow-up read per resource key.
- No successful-response TTL cache remains in the client. A completed read is not a cache; explicit `api.refresh(path, options)` is the only client-side freshness boundary.
- Infinite scroll is user-triggered. `IntersectionObserver` and automatic pagination retry timers are removed; failed pages remain retryable without a timer.
- One shared clock serves poll and purge countdowns. There is one interval per active view with visible countdowns, not one interval per card.
- Web Vitals and frontend-error telemetry are sampled and flushed primarily on `visibilitychange`/`pagehide`/`beforeunload`, not every five or ten seconds.
- Preserve honest authorization, privacy, and failure states. Do not expose private Realtime tables, cross-user notification preferences, secrets, provider errors, or message bodies to unauthorized clients.
- Do not add Redis, Kafka, or another service. Do not add a new service or recurring background client engine to solve a client coordination problem.
- The working tree contains shared uncommitted work. Record but do not reset, clean, overwrite, or stage unrelated paths; stage exact paths only after the human gate.
- The executor must run verification sequentially in this order: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:api`, `npm run build`.
- Preserve these acceptance budgets: warm user-facing reads p95 `< 500 ms`; user-facing write acknowledgements p95 `< 800 ms` (AI acceptance and completion measured separately); LCP p75 `<= 2.5s`; INP p75 `<= 200ms`; CLS p75 `<= 0.1`; TTFB p75 `<= 800ms`; no recurring full-page or full-feed refresh; one initial data request per bounded page resource.

## Review Focus

1. A quiet visible or hidden page with a healthy socket advances fake timers and visibility events without issuing a second whole-page or whole-feed request.
2. A route/filter generation can never accept a response from a superseded route, query, cursor, or unmounted component.
3. A successful action changes exactly the affected record, preserves sibling rows, filters, drafts, and scroll position, and does not call the list loader.
4. A failure preserves the last-known-good snapshot and distinguishes `stale`, `error`, `empty`, `loading`, and `success`; no failure-to-empty conversion remains.
5. All 17 canonical admin query keys remain addressable and outcome-tested, including AI Coworker and Ops Center; the 15-primary/2-capability navigation distinction never removes a capability.
6. A read-like POST is never queued for offline replay, and a timed-out ambiguous write is never replayed without an explicit safe/idempotent policy.
7. A shared request waits at most one configured slot, rejects or reports queue saturation deterministically, and starts its timeout only after acquiring the slot.
8. One visible poll page with many cards creates one countdown clock, not one interval per card; telemetry flushes on lifecycle boundaries without a recurring timer.
9. Every route, tab, shared control, local mutation, and capability listed below has a focused outcome test or explicit static evidence before the final gate.

## Architecture and Interface Decisions

### Shared resource state

Create `src/lib/resourceRefresh.ts` and use the following contract everywhere a route owns a remote snapshot:

```ts
export type ResourceStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "stale"
  | "error";

export interface ResourceState<T> {
  data: T | null;
  status: ResourceStatus;
  error: string | null;
  updatedAt: number | null;
  isRefreshing: boolean;
}

export interface ResourceOptions<T> {
  load: (signal: AbortSignal) => Promise<T>;
  initialData?: T | null;
  isEmpty?: (value: T) => boolean;
}

export interface ResourceRefresh<T> {
  state: ResourceState<T>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  patch: (updater: (current: T | null) => T | null) => void;
  reset: () => void;
}
```

`refresh` keeps existing data visible, sets `isRefreshing`, and changes `status` to `stale` on failure. `retry` is an explicit call to `refresh`; neither method is called by a timer, visibility listener, or passive event. `patch` is local-only and never starts a request.

### Request coordination and intent

Modify `src/lib/api.ts:89-137,163-189,195-388,425-494` to expose these additive interfaces:

```ts
export type RequestIntent = "read" | "write";
export type ReplayPolicy = "never" | "if-safe";

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  intent?: RequestIntent;
  replay?: ReplayPolicy;
  idempotencyKey?: string;
}

export interface ReadSlot<T> {
  promise: Promise<T>;
  refresh: () => Promise<T>;
}

export interface ReadCoordinator {
  get<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options?: RequestOptions,
  ): Promise<T>;
  refresh<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options?: RequestOptions,
  ): Promise<T>;
}

export const readCoordinator: ReadCoordinator;
```

The internal key is `method + normalized path + viewer/permission context`; caller signals are combined with the internal abort controller. A `read` slot is removed in `finally`, never becomes a successful-response cache, and is shared only while active. If `refresh` arrives while a read is active, set one dirty bit; after the active read settles, run exactly one follow-up for all callers waiting on that key. A second generation supersedes the first, and an aborted caller removes its waiter without releasing a slot it never acquired.

Expose these additive `api` methods while preserving existing callers during the migration:

```ts
api.get<T>(path: string, options?: RequestOptions): Promise<T>;
api.getSlow<T>(path: string, options?: RequestOptions): Promise<T>;
api.refresh<T>(path: string, options?: RequestOptions): Promise<T>;
api.postRead<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
api.post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
api.postPaginated<T>(path: string, body: unknown, options?: RequestOptions): Promise<PaginatedResult<T>>;
api.paginated<T>(path: string, params: PaginatedParams, options?: RequestOptions): Promise<PaginatedResult<T>>;
```

`api.postRead` uses POST transport but forces `intent: "read"`, disables offline queueing, and never shares or caches a write. `api.post` defaults to `intent: "write"`; `replay: "if-safe"` is the only path that can enter `offline.queueAction`, and ambiguous timeout/abort outcomes remain `replay: "never"` unless the caller supplies a stable idempotency key and the endpoint contract explicitly permits replay. Replace path-only classification in `src/lib/api.ts:163-189` and `src/lib/offline.ts:43-55` with this intent/replay metadata; do not infer intent from a URL prefix.

### Authoritative reconciliation

Create `src/lib/reconciliation.ts` with these helpers:

```ts
export interface Entity {
  id: string;
}

export interface MutationEnvelope<T> {
  ok: true;
  record?: T;
  records?: T[];
  deletedId?: string;
  nextCursor?: string | null;
  total?: number;
}

export function reconcileRecord<T extends Entity>(
  rows: readonly T[],
  authoritative: T,
): T[];
export function reconcileRecords<T extends Entity>(
  rows: readonly T[],
  authoritative: readonly T[],
): T[];
export function removeRecord<T extends Entity>(
  rows: readonly T[],
  deletedId: string,
): T[];
export function replaceOrInsert<T extends Entity>(
  rows: readonly T[],
  authoritative: T,
): T[];
```

Mutation endpoints must add authoritative fields without removing existing response fields. The minimum contracts used by this plan are:

- Community vote/react/post/comment/join/leave/admin operations return the affected `CommunityPost`, `Community`, membership state, or comment record. The current vote-only response at `api/_communities.js:380-407` must be extended so the client can reconcile counts, `my_vote`, and the post snapshot without re-reading the whole community.
- Poll vote returns the authoritative `PollData` and viewer choice; archive/delete returns the poll or confirmed `deletedId`.
- Reaction/toggle/follow/comment/saved operations return the affected target and viewer state where the endpoint already returns one.
- Admin user, report, provider, category, email-template, announcement, and workforce actions return the affected record, normalized state, or `deletedId`; existing arrays/envelopes remain compatible.
- Failed mutation responses return a non-2xx status and stable error contract; they never return `{ ok: true }` with zeroed or fabricated state.

### Capability and admin registry contracts

Use the approved capability model from the design spec:

```ts
export type ExecutionMode = "automatic" | "manual" | "both";
export type CapabilityState =
  | "queued"
  | "running"
  | "awaiting_human"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface CapabilityStatus {
  capabilityId: string;
  executionMode: ExecutionMode;
  state: CapabilityState;
  attempts: number;
  nextRetryAt: string | null;
  requestId: string | null;
  safeErrorCode: string | null;
  auditEventId: string | null;
}
```

The canonical admin registry in `src/lib/adminTabs.ts` must contain all 17 query keys in this exact order:

```ts
export type AdminTabKey =
  | "dashboard"
  | "agent-chat"
  | "ops-center"
  | "system-health"
  | "performance"
  | "security"
  | "activity-stream"
  | "reports"
  | "posts"
  | "users"
  | "categories"
  | "polls"
  | "inbox"
  | "errors"
  | "logs"
  | "email-templates"
  | "settings";

export const ADMIN_TAB_KEYS: readonly AdminTabKey[] = [
  "dashboard", "agent-chat", "ops-center", "system-health", "performance",
  "security", "activity-stream", "reports", "posts", "users", "categories",
  "polls", "inbox", "errors", "logs", "email-templates", "settings",
] as const;

export type AdminNavTier = "primary" | "capability";
export interface AdminTabDefinition {
  key: AdminTabKey;
  label: string;
  group: "Overview" | "Autonomous System" | "Content" | "Operations" | "Config";
  navTier: AdminNavTier;
}

export const PRIMARY_ADMIN_TAB_KEYS: readonly AdminTabKey[] = [
  "dashboard", "system-health", "performance", "security", "activity-stream",
  "reports", "posts", "users", "categories", "polls", "inbox", "errors",
  "logs", "email-templates", "settings",
] as const;

export const CAPABILITY_ADMIN_TAB_KEYS: readonly AdminTabKey[] = [
  "agent-chat", "ops-center",
] as const;

export function parseAdminTab(search: string): AdminTabKey;
export function buildAdminTabUrl(key: AdminTabKey): string;
```

`PRIMARY_ADMIN_TAB_KEYS` is the current 15-destination human-facing navigation decision. `CAPABILITY_ADMIN_TAB_KEYS` is a navigation-density distinction, not a deletion: both keys remain canonical, directly addressable with `?tab=`, included in PageContext/analytics/command lookup, reachable from explicit AI/Ops links, and covered by their own render/outcome tests. No capability flag may hide or remove either key.

## Current Surface Matrix

The following matrix is the implementation checklist. Line references are current working-tree references and must be rechecked immediately before implementation because the tree is shared.

### Public routes

| Route | Owner/current location | Initial resources and bounds | Controls/mutations to preserve | Required lifecycle/evidence |
|---|---|---|---|---|
| `/about` | `src/pages/About.tsx:64-166`; route `src/App.tsx:68-76` | None | Navigation, static content | No app request; static heading/links test |
| `/contact` | `src/pages/Contact.tsx:14-234` | None on mount | Name/email/message form; `POST /api/posts` at `src/pages/Contact.tsx:33` | One mutation only; sending/success/error states; no feed reload |
| `/terms` | `src/pages/Terms.tsx:59-99` | None | Navigation/static text | No request; static copy test |
| `/privacy` | `src/pages/Privacy.tsx:12-101` | None | Static privacy copy | No request; copy must agree with retained notification settings |
| `/status` | `src/pages/StatusPage.tsx:74-100` | None or one bounded read-only health resource | Manual check/refresh and test error | No synthetic timestamp; honest snapshot/error; explicit action only |
| `/changelog` | `src/pages/Changelog.tsx:110-177` | None | Static entries/navigation | No request; heading/content test |
| `/accessibility` | `src/pages/Accessibility.tsx:57-207` | None | Static text/navigation | No request; heading/landmark test |
| `/faq` | `src/pages/Faq.tsx:39-109` | None | Local search, accordions, clear | Local state only; keyboard/accordion test |
| `/` | `src/pages/Home.tsx:46-190,192-375,453-470,785-843` | `GET /api/posts?paginate=1&limit=20&type=problem` (20), own reactions, one batch of linked poll IDs (<=50), viewer votes; categories | Filters/sort, bookmark, reaction, poll vote, pull-to-refresh, explicit load more, retry | No passive Realtime/full reload; one initial bundle; local row reconciliation |
| `/submit` | `src/pages/Submit.tsx:115-1064,1159-2301` | Categories; input-driven duplicate checks; linkable posts only when requested | Publish post/poll, upload, AI suggestions, moderation/pre-publish, autosave/draft, appeal, voice controls | Active-input timers may count recorder/meter time, never data polling; mutation response is authoritative |
| `/post/:id` | `src/pages/PostDetail.tsx:36-186,188-389,566-821` | Post detail, follows, one linked poll, viewer votes, comments | React, follow, bookmark, comment, lock, report, delete, edit/admin status, export, poll vote | No event-triggered detail/comment reload; own action patches only target; export is explicit bounded read |
| `/polls` | `src/pages/Polls.tsx:10-166` | Poll list plus viewer votes; initial server page <=50 | Active/ended tabs, vote, delete, explicit refresh | Vote/delete response patches one poll; no per-event list GET |
| `/suggestions` | `src/pages/Suggestions.tsx:20-146,163-342` | Suggestion list plus own reactions; bounded page | Sort/status filter, vote, bookmark, explicit retry | Vote response patches one suggestion; no Realtime callback |
| `/leaderboard` | `src/pages/Leaderboard.tsx:122-344` | One aggregate leaderboard snapshot | Tabs, manual refresh, retry, links | One initial read; tabs are local filters; no timer |
| `/communities` | `src/pages/Communities.tsx:32-113,134-383` | One bounded community list | Create, photo upload, open, admin hide/unhide/delete, refresh | Mutations patch list; no automatic list reload |
| `/communities/:slug` | `src/pages/CommunityDetail.tsx:84-335,388-729` | One bounded detail/feed snapshot (<=50 posts) | Join/leave, post/poll, vote, solve, delete, react, comment, report, admin actions | Every action uses authoritative affected record; no full detail reload after success |
| `/board` | `src/pages/SolvingBoard.tsx:19-50,52-191` | One bounded problem snapshot | Board links, retry, purge countdown | No post-event reload; countdown uses shared clock |
| `/activity` | `src/pages/MyActivity.tsx:53-118,124-214,222-907` | Posts, comments, reactions, poll votes, polls, appeals, bookmarked posts (each bounded) | Delete/undo, export, tutorial/profile links, tab changes | One initial bundle; tab changes are local; delete/undo patch affected list |
| `/saved` | `src/pages/Saved.tsx:10-133` | IDs plus one bounded bookmarked-post read | Remove bookmark, react, explicit refresh | Bookmark/reaction does not reload saved list; missing rows show refresh card |
| `/search` | `src/pages/Search.tsx:64-160,220-458` | Categories; one query request only after debounce/submit | Query, type/category/status filters, clear, retry, pagination/result links | Abort superseded query; filter change is explicit request boundary; no polling |
| `/insights` | `src/pages/Insights.tsx:115-141,177-376` | One aggregate snapshot | Local tabs/links, retry | One initial read; malformed response is error, not empty |
| `/chat` | `src/pages/UserChat.tsx:88-205,207-357,359-605` | One inbox/thread read plus explicit mark-read write | Send, retry, upload, AI toggle, dictation/read-aloud, triage note | No passive thread reload; send response merges own message/reply; ambiguous send is never replayed |
| `/settings` | `src/pages/Settings.tsx:48-200,239-882` | One owner-scoped notification-preference read; local display/profile state | Save channel, welcome email, display controls, profile, tutorial, export, delete photo | No full settings reload after save; server-normalized channel response wins |
| `/notifications` | `src/pages/Notifications.tsx:77-249` | AppContext/local snapshot, no page read | Filter, mark read, clear | Local state plus explicit server writes; no inherited global poll |
| fallback | `src/pages/NotFound.tsx:5-102` | None | Navigation/reload | Assert actual 404 content, not a false pass |

### Admin query keys

| Key | Component/current location | Initial resources | Controls/capabilities | Required evidence |
|---|---|---|---|---|
| `dashboard` | `src/pages/admin/Overview.tsx:198-1960`; shell `src/pages/Admin.tsx:536-540` | Bounded summary, alerts, health, users/posts/comments/polls, vitals/pulse | Status, report triage, announcement, exports, navigation | One initial bundle + explicit refresh; partial source failures stay visible |
| `agent-chat` | `src/pages/admin/AgentChat.tsx:109-357`; shell `src/pages/Admin.tsx:536-590` | Ops status, sessions, optional stored history | Send, action previews, approve/execute/reject, session selection | Explicit capability entry; no passive polling; authoritative action result |
| `ops-center` | `src/pages/admin/OpsCenter.tsx:530-811`; shell `src/pages/Admin.tsx:536-590` | Ops summary, scorecard, briefing, automation registry | Run worker, patrol, pause/resume, acknowledge, retry, approve, ask agent | Automatic/manual paths share capability state; no recurring page poll |
| `system-health` | `src/pages/admin/SystemHealth.tsx:73-141`; shell `src/pages/Admin.tsx:536-590` | One health snapshot | Refresh, node select/details | Failure is unknown/error, not a healthy zero; no interval |
| `performance` | `src/pages/admin/PerformanceCenter.tsx:89-163`; shell `src/pages/Admin.tsx:536-590` | Performance + vitals | Refresh, select vital | Preserve real percentile display; no interval/fallback |
| `security` | `src/pages/admin/SecurityCenter.tsx:64-142`; shell `src/pages/Admin.tsx:536-590` | Bounded security events | Refresh, search, severity filters | Failure does not become `[]`; no settings subscription |
| `activity-stream` | `src/pages/admin/ActivityStream.tsx:76-229`; shell `src/pages/Admin.tsx:536-590` | Bounded ops-summary-derived events (<=100) | Refresh, search, severity filters | Explicit refresh only; failed read preserves last-known events |
| `reports` | `src/pages/admin/Reports.tsx:727-1170,1296-2286`; shell `src/pages/Admin.tsx:541-545` | Reports, pre-review, approvals, appeals; heavy AI review only when desk is entered | Resolve/group resolve, escalate, warn/suspend/ban, approve/reject, pre-review publish/private/reject/ban, appeal uphold/overturn, delete, comments | Every action patches affected queue/row; no action invokes full queue reload |
| `posts` | `src/pages/admin/PostsTable.tsx:47-616`; shell `src/pages/Admin.tsx:546-550` | Cursor page (30 rows) | Search/filter/date, edit/status/hide/official/lock/archive/merge/delete/restore, poll conversion, bulk delete, export, message author | User-triggered pagination; no auto-drain; tombstone/authoritative patch |
| `users` | `src/pages/admin/UserManager.tsx:56-147`; shell `src/pages/Admin.tsx:551-555` | Cursor user page (30 rows), detail on demand | Warn, spam action, suspend/ban, revoke, detail, message author | Detail request is explicit; user action patches summary/detail without list reset |
| `categories` | `src/pages/admin/Categories.tsx:9-73`; shell `src/pages/Admin.tsx:556-560` | One category list | Add, remove, reset | Server echo replaces local list; no reload |
| `polls` | `src/pages/admin/PollManager.tsx:10-75`; shell `src/pages/Admin.tsx:561-565` | One bounded poll list | Create, archive/restore, delete | Mutation patches one row; no realtime list load |
| `inbox` | `src/pages/admin/UnifiedInbox.tsx:368-900`; shell `src/pages/Admin.tsx:566-570` | AI mode, inbox/chat thread lists, active thread | Send, takeover/release/transfer/status, delete, export, summarize, suggest | No passive thread reload; active thread is explicit; actions patch active/list state |
| `errors` | `src/pages/admin/ErrorTracking.tsx:95-236`; shell `src/pages/Admin.tsx:571-575` | Health, chunk manifest, audit errors, frontend errors, Sentry config | Refresh all, test error, filters/links | Test error never claims success without DSN; no frontend-error poll |
| `logs` | `src/pages/admin/Logs.tsx:158-350`; shell `src/pages/Admin.tsx:576-580` | Cursor audit page (30), agent activity (<=200) when tab asks | Tabs, filters, refresh, export, load more | Pagination is user-triggered; no visibility/agent poll |
| `email-templates` | `src/pages/admin/EmailTemplates.tsx:73-380`; shell `src/pages/Admin.tsx:581-585` | One template list | Select, preview, edit, save, test send | Save uses server-normalized template list; no refetch |
| `settings` | `src/pages/admin/AdminSettings.tsx:14-373`; shell `src/pages/Admin.tsx:586-590` | Auth mode, agent action switch, spam config, embedded provider settings | Password, revoke sessions, agent switch, spam thresholds, provider test/update | Normalized server responses patch fields; no embedded provider full reload |

### Shared interactive components and local mutation owners

| Owner/current location | Required change | Focused evidence |
|---|---|---|
| `src/components/Comments.tsx:82-166,238-367` | One initial thread; explicit Retry; local append/edit/delete/undo; remove Realtime refetch | `Comments.gate.test.tsx`, new stable-snapshot assertions in `Comments.realtime.test.tsx` |
| `src/components/PostCard.tsx:50-162,365-404` | Keep optimistic reaction rollback and authoritative response; no parent full reload | `PostCard.test.tsx` |
| `src/components/PollCard.tsx:19-191` | Authoritative vote patch; one shared clock; close notification remains one-shot | `PollCard.test.tsx` |
| `src/components/PostCardAdminBar.tsx:15-75` | Patch returned post row/status instead of leaving stale display | `PostCard.test.tsx` and admin row tests |
| `src/components/admin/WorkItem.tsx:168-272` | Bound timeline read; action patches item and reloads only its own timeline if response lacks timeline | `Reports.test.tsx`, new `WorkItem.test.tsx` |
| `src/components/admin/PulseStrip.tsx:56-97` and `src/lib/dashboard/widgets.tsx:62-165` | Deduplicate distinct sources, explicit refresh, no `pollMs` data poll | `dashboard-widgets.test.tsx` |
| `src/pages/admin/agent-office/ApprovalAlert.tsx:31-128` | Remove 12-second interval/visibility check; initial queue + explicit pending-action refresh; preserve approve/reject | Replace polling expectations in `ApprovalAlert.test.tsx` |
| `src/pages/admin/ProviderSettings.tsx:95-273` | Reconcile provider/category state from each action response | `ProviderSettings.test.tsx` |
| `src/pages/admin/QuickActions.tsx:21-81` | Announcement response patches local announcement; triage status remains owner callback | `QuickActions.test.tsx` |
| `src/components/Layout.tsx:107-144` | Remove 30-second queued-count interval; keep online event and local counter updates | `AppContextCore.test.tsx`/new layout test |
| `src/contexts/AppContext.tsx:257-323,352-401,504-648` | One initial identity/saved/notification summary; explicit local actions; no global data engine | `AppContextCore.test.tsx`, `AppContextSaved.test.tsx` |
| `src/hooks/useCategories.ts:8-31` | Shared in-flight category read; no extra request for simultaneous consumers | `useCategories.test.tsx` |

## Request and Query Budget Ledger

These are client-side regression budgets, not claims about production capacity. They are asserted with mocked request counters and recorded before/after in the task that changes the surface.

| Surface | Initial client requests (maximum) | Initial rows/resources | Explicit refresh maximum | Mutation rule |
|---|---:|---|---|---|
| Static/legal pages | 0 | Static content | 0 | Contact is the only mount-time form; submit only on user action |
| Status | 0 or 1 manual read | One health snapshot | 1 | Never synthesize a successful check timestamp |
| Home | 4 | 20 posts; one poll batch <=50; one reaction set; one viewer-vote set | 4 | One mutation; zero list GET |
| Post detail | 5 | One post, one follows set, one linked poll, one viewer-vote set, one comments page <=200 | 5 | Own action patches target; export is a separate explicit read |
| Polls | 2 | <=50 poll rows + viewer votes | 2 | Vote/archive/delete returns affected poll/ID |
| Suggestions | 2 | <=50 suggestions + viewer reactions | 2 | Vote/bookmark local patch |
| Solving board | 1 | <=100 bounded problem rows | 1 | Countdown is local clock only |
| Communities list | 1 | <=50 community cards | 1 | Create/admin response patches card |
| Community detail | 1 | <=50 posts and bounded comments | 1 | Every action response patches affected post/community/comment |
| My Activity | 7 | Each activity resource <=50; bookmarked posts <=100 | 7 | Delete/undo patches only target list |
| Saved | 1 | <=100 bookmarked posts | 1 | Remove/reaction never reloads list |
| Search | 1 categories + 1 query | <=50 results | 1 per explicit query/filter | No request on unrelated visibility/realtime |
| Insights/Leaderboard | 1 each | Aggregate snapshot | 1 each | No mutation surface |
| User chat | 1 inbox/thread read + 1 mark-read write | Current thread only | 1 explicit refresh | Send uses authoritative response; never queue ambiguous send |
| Settings | 1 owner-scoped preference read | Channel preferences | 1 | Save returns normalized channel state |
| Notifications | 0 | AppContext snapshot | 0 | Mark/clear are explicit writes |
| Dashboard | <=8 independent initial sources | Each source bounded; no whole-table client scan | <=8 | Status/report/announcement actions patch source |
| Agent Chat | 2-3 | Status, sessions, optional selected history | 2-3 | Action result patches action card and local history |
| Ops Center | <=4 | Ops summary, scorecard <=500 rows, briefing, automation registry | <=4 | Worker/capability result patches affected row/state |
| System Health/Performance/Security/Activity | 1 each | <=100 activity/security events; aggregate health/performance | 1 each | No passive source |
| Reports | 4 fast queues; 1 heavy review scan when AI Review is entered | Reports/approvals/appeals bounded; review scan server-bounded | Same | Action patches one row/queue; no full queue reload |
| Posts | 1 | 30 rows, cursor | 1 page one; explicit next pages | Row patch/delete/tombstone; export walks cursor only on click |
| Users | 1 | 30 rows; detail only on click | 1 | User action patches summary/detail |
| Categories/Polls | 1 each | Bounded list | 1 | Echo patches list |
| Inbox | 3 thread/config reads; 1 active-thread read on selection | Thread list + active thread | 3 plus explicit active refresh | Action patches active thread/list |
| Errors | 4 | Health, chunks, audit page <=100, frontend error page | 4 | Test error is explicit only |
| Logs | 2 | Audit 30; agent activity <=200 when requested | 2 | Export uses current snapshot or explicit cursor |
| Email/Settings | 1-4 | Templates/auth/agent/spam/provider fields | Same | Server-normalized response patches fields |

A request is not allowed to exceed its slot timeout while waiting; queue saturation must produce a deterministic client error/retry state. No recurring full-page/full-feed request is permitted, including when `document.hidden` is false or a Realtime socket is connected.


## Implementation Tasks

The tasks below are the execution plan, not a record of work completed while writing this document. Each task starts with a failing test, preserves the existing public contract unless an explicit migration step says otherwise, and ends with an exact-path commit example. The executor must re-read every cited line immediately before editing because the working tree is shared.

### Task 1: Make request intent and replay policy explicit

**Files:**
- Modify: `src/lib/api.ts:89-137,163-189,195-388,425-494`
- Modify: `src/lib/offline.ts:4-135`
- Test: `src/__tests__/api.test.ts:1-818`
- Test: `src/__tests__/offline.test.ts:1-239`

**Interfaces:**
- Consumes: existing `api.get`, `api.getFresh`, `api.post`, `api.put`, `api.del`, `queueAction`, and `flushQueue` call sites.
- Produces: `RequestIntent`, `ReplayPolicy`, and `RequestOptions` from the architecture section; every write-like call must pass explicit metadata.

- [ ] **Step 1: Write the failing intent/replay tests.**

```ts
it("does not queue a read-like POST even when its URL looks like a write", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(api.postRead("/api/posts", { action: "list" })).rejects.toThrow();
  expect(queuedCount()).toBe(0);
});

it("queues only a write that explicitly opts into safe replay", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(
    api.post("/api/posts", { title: "draft" }, { intent: "write", replay: "if-safe", idempotencyKey: "draft-1" }),
  ).rejects.toThrow();
  expect(queuedCount()).toBe(1);
});

it("does not infer replayability from an admin-looking path", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(api.post("/api/admin/users", { action: "update" })).rejects.toThrow();
  expect(queuedCount()).toBe(0);
});
```

- [ ] **Step 2: Run the focused tests and record the expected failure.**

Run: `npm test -- src/__tests__/api.test.ts src/__tests__/offline.test.ts`

Expected before implementation: `api.postRead` is missing, the offline queue does not persist intent/replay/idempotency metadata, and at least one path-based classification assertion fails.

- [ ] **Step 3: Implement the smallest contract-preserving change.**

Add the exact types from the architecture section. Thread `intent`, `replay`, and `idempotencyKey` through the internal request options. Make `api.postRead` force `intent: "read"`, never call `queueAction`, and never enter an offline write queue. Make `api.post` default to `intent: "write"` and `replay: "never"`. Permit `queueAction` only for an explicit `replay: "if-safe"` write with a stable idempotency key and a non-ambiguous network failure; a timeout, abort, 4xx, or 429 remains non-replayable.

- [ ] **Step 4: Update the offline record and flush guard.**

Change `QueuedAction` to include `ownerId`, `intent: "write"`, `replay: "if-safe"`, and `idempotencyKey`. `flushQueue` must refuse an item without all replay-safety fields, must never replay a read, and must preserve the existing owner, admin-token, TTL, 20-item cap, sequential flush, and 4xx-drop/5xx-retain behavior. Do not change the storage key or silently discard existing untyped queue items without an explicit migration decision.

- [ ] **Step 5: Run the focused tests.**

Run: `npm test -- src/__tests__/api.test.ts src/__tests__/offline.test.ts`

Expected: the new intent/replay tests and all existing error, upload, pagination, queue-owner, and admin-auth tests pass.

- [ ] **Step 6: Commit only this slice.**

```bash
git add src/lib/api.ts src/lib/offline.ts src/__tests__/api.test.ts src/__tests__/offline.test.ts
git commit -m "fix: make client request replay policy explicit"
```

### Task 2: Replace the FIFO request gate with bounded single-flight reads

**Files:**
- Modify: `src/lib/api.ts:91-143,195-388`
- Test: `src/__tests__/api-concurrency.test.ts:1-61`
- Create: `src/__tests__/api-coordination.test.ts`

**Interfaces:**
- Consumes: `RequestOptions` from Task 1 and the `ReadCoordinator` interface in the architecture section.
- Produces: exported `readCoordinator`; `api.get` and `api.refresh` use it; compatibility `getFresh` calls `api.refresh` without a successful-response TTL cache.

- [ ] **Step 1: Write failing coordination tests.**

```ts
it("shares one active GET and removes it after settlement", async () => {
  const firstLoad = deferred<{ ok: true }>();
  const secondLoad = deferred<{ ok: true }>();
  const load = vi.fn()
    .mockReturnValueOnce(firstLoad.promise)
    .mockReturnValueOnce(secondLoad.promise);
  const first = readCoordinator.get("GET:/api/health:anon-1", load);
  const second = readCoordinator.get("GET:/api/health:anon-1", load);
  expect(load).toHaveBeenCalledTimes(1);
  firstLoad.resolve({ ok: true });
  await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
  const third = readCoordinator.get("GET:/api/health:anon-1", load);
  expect(load).toHaveBeenCalledTimes(2);
  secondLoad.resolve({ ok: true });
  await third;
});

it("coalesces refreshes during an active read into one follow-up", async () => {
  const firstLoad = deferred<number>();
  const load = vi.fn()
    .mockReturnValueOnce(firstLoad.promise)
    .mockReturnValueOnce(Promise.resolve(2));
  const first = readCoordinator.refresh("feed:1", load);
  const dirtyA = readCoordinator.refresh("feed:1", load);
  const dirtyB = readCoordinator.refresh("feed:1", load);
  firstLoad.resolve(1);
  await Promise.all([first, dirtyA, dirtyB]);
  expect(load).toHaveBeenCalledTimes(2);
});

it("rejects a request that exceeds the bounded waiter ceiling", async () => {
  const pending = Array.from({ length: 40 }, () => deferred<Response>());
  fetchMock.mockImplementation(() => pending.shift()!.promise);
  const calls = Array.from({ length: 40 }, (_, i) => api.get(`/api/full-${i}`));
  await expect(calls.at(-1)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/queue/i) });
});
```

- [ ] **Step 2: Run the coordination tests and verify they fail.**

Run: `npm test -- src/__tests__/api-concurrency.test.ts src/__tests__/api-coordination.test.ts`

Expected before implementation: the old unbounded `waitQueue`, successful-response `getCache`, pre-slot timeout, and missing dirty follow-up fail the new assertions.

- [ ] **Step 3: Implement the coordinator with an explicit key and generation.**

Use `method + normalized path + viewer/permission context` as the internal key. Each active read owns one `AbortController`, one bounded waiter set, and a `dirty` boolean. A caller signal must remove only that caller's waiter and abort the shared controller when no caller remains. A caller abort must never release a slot that the request never acquired. `refresh` sets one dirty bit while active; after settlement, run exactly one follow-up for the key and clear the bit. Remove `GET_CACHE_TTL_MS` and `getCache`; keep sharing only while the promise is active. Keep the six-slot cap and define a deterministic queue-full `ApiError` with status `503` and a message containing `queue`.

- [ ] **Step 4: Preserve caller cancellation and endpoint timeouts.**

Combine the caller signal with the internal controller. Start the endpoint timeout only after `tryAcquireSlot()` succeeds. Preserve the existing endpoint-specific timeout constants and upload, agent, LLM, and inbox behavior. A caller abort must reject that caller without causing a successful shared read to be replayed for unrelated callers.

- [ ] **Step 5: Run the focused tests and inspect the request counter.**

Run: `npm test -- src/__tests__/api-concurrency.test.ts src/__tests__/api-coordination.test.ts src/__tests__/api.test.ts`

Expected: active identical GETs produce one fetch, a dirty burst produces one follow-up, queue wait time is not charged against the endpoint timeout, and no completed response is reused after settlement.

- [ ] **Step 6: Commit only this slice.**

```bash
git add src/lib/api.ts src/__tests__/api-concurrency.test.ts src/__tests__/api-coordination.test.ts
git commit -m "fix: coordinate in-flight reads without response caching"
```

### Task 3: Add resource-state and authoritative-reconciliation primitives

**Files:**
- Create: `src/lib/resourceRefresh.ts`
- Create: `src/lib/reconciliation.ts`
- Create: `src/__tests__/resourceRefresh.test.tsx`
- Create: `src/__tests__/reconciliation.test.ts`

**Interfaces:**
- Consumes: the `ResourceState`, `ResourceOptions`, `ResourceRefresh`, `Entity`, and `MutationEnvelope` contracts in the architecture section.
- Produces: `useResourceRefresh<T>(options: ResourceOptions<T>): ResourceRefresh<T>`, `createResourceRefresh<T>(options: ResourceOptions<T>): ResourceRefresh<T>`, and the four reconciliation helpers.

- [ ] **Step 1: Write failing state tests.**

```ts
it("keeps last-known-good data and marks a failed refresh stale", async () => {
  const load = vi.fn()
    .mockResolvedValueOnce(["first"])
    .mockRejectedValueOnce(new Error("offline"));
  const { result } = renderHook(() => useResourceRefresh({ load }));
  await act(() => result.current.refresh());
  expect(result.current.state).toMatchObject({ data: ["first"], status: "success" });
  await act(() => result.current.refresh());
  expect(result.current.state).toMatchObject({ data: ["first"], status: "stale", error: "offline" });
});

it("ignores a superseded response after reset", async () => {
  const first = deferred<string[]>();
  const second = deferred<string[]>();
  const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useResourceRefresh({ load }));
  const old = act(() => result.current.refresh());
  act(() => result.current.reset());
  const fresh = act(() => result.current.refresh());
  second.resolve(["new"]);
  first.resolve(["old"]);
  await Promise.all([old, fresh]);
  expect(result.current.state.data).toEqual(["new"]);
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure.**

Run: `npm test -- src/__tests__/resourceRefresh.test.tsx src/__tests__/reconciliation.test.ts`

Expected before implementation: both modules are absent and the state/reconciliation assertions cannot compile.

- [ ] **Step 3: Implement the state machine.**

`refresh` must preserve `data`, set `isRefreshing`, transition `loading -> success|empty|stale|error`, and update `updatedAt` only after a successful response. `isEmpty` must be explicit; an empty array is not inferred as a transport failure. `patch` must not call `load`. `reset` increments a generation, aborts the active request, clears data/error, and ignores any late settlement. The hook must not register visibility, timer, socket, or Realtime listeners.

- [ ] **Step 4: Implement reconciliation with stable order and identity.**

`reconcileRecord` replaces the matching ID or returns the original immutable array when the ID is absent only if the caller explicitly uses insert semantics; `reconcileRecords` deduplicates by ID and applies each authoritative record once. `removeRecord` removes only the confirmed ID. `replaceOrInsert` preserves existing row order for edits, appends new rows, and never mutates the input array.

- [ ] **Step 5: Run the focused tests.**

Run: `npm test -- src/__tests__/resourceRefresh.test.tsx src/__tests__/reconciliation.test.ts`

Expected: all state, stale-data, generation, empty, and row-reconciliation cases pass.

- [ ] **Step 6: Commit only this slice.**

```bash
git add src/lib/resourceRefresh.ts src/lib/reconciliation.ts src/__tests__/resourceRefresh.test.tsx src/__tests__/reconciliation.test.ts
git commit -m "feat: add resource state and reconciliation primitives"
```

### Task 4: Make the community mutation response authoritative

**Files:**
- Modify: `api/_communities.js:346-445`
- Test: `tests/api/communities.test.ts`
- Test: `src/__tests__/Communities.test.tsx`
- Test: `src/__tests__/CommunityDetail.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `MutationEnvelope<T>` and `reconcileRecord` from Task 3.
- Produces: an additive community response containing `ok: true`, `action`, `community`, `post`, `poll`, `my_vote`, `comment`, and/or `deletedId` as applicable.

- [ ] **Step 1: Add failing API response assertions.**

```ts
it("returns the affected community post and poll after a vote", async () => {
  const response = await invokeCommunityVote({ slug: "math", post_id: "p1", option_id: "yes", anon_id: "anon-1" });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    ok: true,
    action: "vote",
    community: { slug: "math" },
    post: { id: "p1", poll: { my_vote: "yes", total_votes: 1 } },
    poll: { id: "poll-1", my_vote: "yes" },
    my_vote: "yes",
  });
});

it("returns a confirmed post id for solve and delete", async () => {
  const solved = await invokeCommunityAction({ action: "solve_poll", slug: "math", post_id: "p1", anon_id: "anon-1" });
  expect(solved.body).toMatchObject({ ok: true, deletedId: "p1", deleted: true });
});
```

- [ ] **Step 2: Run the API and component tests to capture the current insufficient contract.**

Run: `npm test -- tests/api/communities.test.ts src/__tests__/Communities.test.tsx src/__tests__/CommunityDetail.test.tsx`

Expected before implementation: the vote assertion fails because `api/_communities.js:407` returns only `{ ok, my_vote }`; solve/delete do not expose the confirmed `deletedId` in the common envelope.

- [ ] **Step 3: Implement additive authoritative fields without breaking existing fields.**

Keep `ok`, `my_vote`, `deleted`, and `post_count` for compatibility. After the write is saved, select the affected post from the same in-memory document and return a cloned response containing the community slug, post record, poll record, normalized option counts, and viewer choice. For solve/delete, return `deletedId` and the server-confirmed remaining count. For comment/react/report/admin actions, return the affected comment/post/community state or confirmed ID. Never fabricate a record after a failed write.

- [ ] **Step 4: Update client handlers to reconcile only the target.**

In `src/pages/Communities.tsx:65-110` and `src/pages/CommunityDetail.tsx:130-343`, replace post-success `load()` calls with `reconcileRecord`, `removeRecord`, or targeted state setters. Keep the previous row visible on failure and show the returned error. The test must assert that sibling community cards/posts and the current draft remain unchanged.

- [ ] **Step 5: Run the focused tests.**

Run: `npm test -- tests/api/communities.test.ts src/__tests__/Communities.test.tsx src/__tests__/CommunityDetail.test.tsx`

Expected: vote counts and viewer choice update without a second list/detail request, and failed actions do not convert data to empty.

- [ ] **Step 6: Commit only this slice.**

```bash
git add api/_communities.js tests/api/communities.test.ts src/__tests__/Communities.test.tsx src/__tests__/CommunityDetail.test.tsx
git commit -m "fix: return authoritative community mutation state"
```

### Task 5: Convert Realtime into explicit opt-in infrastructure

**Files:**
- Modify: `src/lib/useRealtime.ts:19-209`
- Modify: `src/lib/useSmartPoll.ts:1-160`
- Modify: `src/__tests__/useRealtime.test.ts:1-455`
- Modify: `src/__tests__/useSmartPoll.test.ts:1-306`
- Modify: page call sites identified in Tasks 22-38 and 39-55
- Create: `src/lib/realtimeTypes.ts` only if the existing type declarations cannot hold the option type

**Interfaces:**
- Consumes: `REALTIME_TABLES`, the current channel registry, and the existing debounce behavior.
- Produces: `RealtimeOptions { enabled?: boolean; debounceMs?: number }` with `enabled` defaulting to `false`, plus `SmartPollOptions { enabled?: boolean; intervalMs?: number }` with the same default; callbacks and polling are delivered only after explicit opt-in.

- [ ] **Step 1: Rewrite the failing lifecycle test.**

```ts
it("does not subscribe or call the callback by default", () => {
  const onChange = vi.fn();
  renderHook(() => useRealtime(["posts"], onChange));
  expect(mock.createChannel).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

it("delivers an event only for an explicitly enabled opt-in subscriber", () => {
  const onChange = vi.fn();
  renderHook(() => useRealtime(["posts"], onChange, { enabled: true, debounceMs: 0 }));
  const entry = mock.channels.get("rt-posts")!;
  entry.changeCb({ eventType: "INSERT", new: { id: "p1" } });
  expect(onChange).toHaveBeenCalledWith("posts", expect.objectContaining({ eventType: "INSERT" }));
});
```

- [ ] **Step 2: Run the test and verify the default-subscription failure.**

Run: `npm test -- src/__tests__/useRealtime.test.ts src/__tests__/useSmartPoll.test.ts`

Expected before implementation: the existing hooks subscribe or poll when called and their page-oriented tests still describe passive delivery as default behavior.

- [ ] **Step 3: Implement the opt-in gate without adding polling.**

Keep one channel per public allowlisted table group and keep teardown on the last subscriber. Accept the old numeric third argument as a deprecated compatibility form that maps to `enabled: true` only during the migration, then update every routed page to pass `{ enabled: false }` or remove the call. Do not create a channel for private/admin tables. Make `useSmartPoll` disabled by default as well: an explicit `enabled: true` option is required, and an enabled smart poll may refresh only its explicitly owned resource. Do not start a fallback interval, visibility listener, staleness timer, or full-refresh callback under any connection state.

- [ ] **Step 4: Add an explicit opt-in control contract for future surfaces.**

Any future Live Updates control must be a user setting stored per view, must pass `enabled: true` only after activation, and must expose a visible Stop/Refresh action. It must patch only the row IDs named by the event and must not call a page-wide list loader. No current route is required to add that control.

- [ ] **Step 5: Run all Realtime and lifecycle contract tests.**

Run: `npm test -- src/__tests__/useRealtime.test.ts src/__tests__/useSmartPoll.test.ts src/__tests__/page-lifecycle-contract.test.ts`

Expected: default pages create no channel, opted-in test subscribers receive events, and hidden/quiet/failed sockets never cause a read.

- [ ] **Step 6: Commit only this slice.**

```bash
git add src/lib/useRealtime.ts src/lib/useSmartPoll.ts src/__tests__/useRealtime.test.ts src/__tests__/useSmartPoll.test.ts src/__tests__/page-lifecycle-contract.test.ts
git commit -m "fix: make realtime subscriptions explicitly opt-in"
```

### Task 6: Replace automatic infinite-scroll retries with explicit pagination

**Files:**
- Modify: `src/hooks/useInfiniteScroll.ts:1-299`
- Modify: `src/__tests__/useInfiniteScroll.test.tsx:1-660`
- Modify: `src/pages/admin/PostsTable.tsx:239-377,707-805`
- Modify: `src/pages/admin/Logs.tsx:168-225`
- Modify: `src/pages/admin/UserManager.tsx:67-104`
- Create: `src/components/LoadMoreButton.tsx` if no shared explicit control exists

**Interfaces:**
- Consumes: cursor fetcher `(params: { cursor: string | null; limit: number }) => Promise<{ data: T[]; nextCursor: string | null; total: number }>`.
- Produces: `items`, `loading`, `initialLoading`, `hasMore`, `total`, `loadMore(): Promise<void>`, `retryLastPage(): Promise<void>`, `reset(): void`, and `softReset(): void`; remove `sentinelRef` and automatic `IntersectionObserver` behavior.

- [ ] **Step 1: Replace the old observer/retry tests with failing explicit tests.**

```ts
it("does not create an IntersectionObserver or retry timer", async () => {
  const fetcher = vi.fn().mockResolvedValue({ data: [{ id: "a" }], nextCursor: null, total: 1 });
  renderHook(() => useInfiniteScroll(fetcher, { limit: 10 }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(globalThis.IntersectionObserver).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("retries only when retryLastPage is called", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ data: [{ id: "a" }], nextCursor: "c1", total: 2 })
    .mockRejectedValueOnce(new Error("page failed"))
    .mockResolvedValueOnce({ data: [{ id: "b" }], nextCursor: null, total: 2 });
  const { result } = renderHook(() => useInfiniteScroll(fetcher));
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  await act(() => result.current.loadMore());
  expect(result.current.items).toEqual([{ id: "a" }]);
  await act(() => result.current.retryLastPage());
  expect(result.current.items).toEqual([{ id: "a" }, { id: "b" }]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run the focused hook tests and verify the old behavior fails.**

Run: `npm test -- src/__tests__/useInfiniteScroll.test.tsx`

Expected before implementation: the observer is created, failed pages schedule a timer, and the old test suite expects a third automatic retry.

- [ ] **Step 3: Implement generation-safe explicit pagination.**

Keep the existing generation invalidation so a response from a superseded `reset` cannot append. Remove `retryTimerRef`, retry backoff, and observer setup. `loadMore` must be idempotent while a page is in flight, stop when `hasMore` is false, preserve current rows while a next page is loading, and append only the cursor's rows. `retryLastPage` must reuse the last cursor and never run from a timer.

- [ ] **Step 4: Replace every automatic drain with a visible control.**

In `src/pages/admin/PostsTable.tsx:357-377,1716`, remove `AUTO_LOAD_PAGES` and `loadAllWanted`; render a `LoadMoreButton` only while `hasMore` is true. Keep explicit compliance export cursor walking in `exportRows`, but require a click and cap the export at the server's documented export limit. In `src/pages/admin/Logs.tsx:199-225` and `src/pages/admin/UserManager.tsx:92-104`, render the same explicit control and preserve filter/query state across pages.

- [ ] **Step 5: Run focused pagination and admin consumer tests.**

Run: `npm test -- src/__tests__/useInfiniteScroll.test.tsx src/__tests__/PostsTable.test.tsx src/__tests__/Logs.test.tsx src/__tests__/UserManager.test.tsx`

Expected: each page performs one initial request and every additional request requires a user click; failed pages expose a retry action and do not schedule work.

- [ ] **Step 6: Commit only this slice.**

```bash
git add src/hooks/useInfiniteScroll.ts src/components/LoadMoreButton.tsx src/__tests__/useInfiniteScroll.test.tsx src/pages/admin/PostsTable.tsx src/pages/admin/Logs.tsx src/pages/admin/UserManager.tsx src/__tests__/PostsTable.test.tsx src/__tests__/Logs.test.tsx src/__tests__/UserManager.test.tsx
git commit -m "fix: make list pagination user-triggered"
```

### Task 7: Remove the global data engine from AppProvider and Layout

**Files:**
- Modify: `src/contexts/AppContext.tsx:183-323,352-401,504-648`
- Modify: `src/components/Layout.tsx:74-144`
- Test: `src/__tests__/AppContextCore.test.tsx:1-947`
- Test: `src/__tests__/AppContextSaved.test.tsx:1-111`
- Test: `src/__tests__/Layout.test.tsx` (create if absent)

**Interfaces:**
- Consumes: the one-shot `ResourceRefresh` contract and the local bookmark/notification actions.
- Produces: one initial identity/saved/notification summary per identity/session, local state updates for mark-read/clear/bookmark, and no route-wide heartbeat, notification engine, or queued-count interval.

- [ ] **Step 1: Add failing lifecycle and local-reconciliation tests.**

```ts
it("loads the global summary once and does not reload on visibility or route rerender", async () => {
  const { rerender } = render(<AppProvider><Probe /></AppProvider>);
  await waitFor(() => expect(h.get).toHaveBeenCalled());
  const before = h.get.mock.calls.length;
  document.dispatchEvent(new Event("visibilitychange"));
  rerender(<AppProvider><Probe /></AppProvider>);
  expect(h.get.mock.calls.length).toBe(before);
});

it("keeps the previous notification when the server write fails", async () => {
  h.post.mockRejectedValueOnce(new Error("offline"));
  render(<AppProvider><Probe /></AppProvider>);
  await user.click(screen.getByRole("button", { name: "mark all read" }));
  expect(screen.getByTestId("notifications")).toHaveTextContent("Pending");
  expect(screen.getByRole("alert")).toHaveTextContent(/could not complete/i);
});
```

- [ ] **Step 2: Run the provider tests and verify the current duplicate/interval paths fail.**

Run: `npm test -- src/__tests__/AppContextCore.test.tsx src/__tests__/AppContextSaved.test.tsx src/__tests__/Layout.test.tsx`

Expected before implementation: the current provider still has a notification catch-up effect and Layout has the queued-count interval at `src/components/Layout.tsx:117-125`.

- [ ] **Step 3: Define one bounded summary loader.**

Replace the multi-engine effects with one `loadGlobalSummary(signal)` that reads the owner-scoped identity/status, saved IDs, and initial notification summary once for the current identity. Keep the existing local storage hydration and `refreshIdentity` behavior. Remove the `posts`, `chat`, and `polls` background notification fan-out; a new notification is learned on route entry or an explicit refresh, not every 180 seconds. Preserve ban/warning detection when the explicit identity refresh returns a changed status.

- [ ] **Step 4: Make local writes authoritative and non-reloading.**

`toggleBookmark`, `markNotifsRead`, and `clearNotifs` update local state first, send the explicit write, and reconcile the server response if present. A failed write restores the previous local snapshot and shows an honest error. Do not call a list loader after success. Keep the existing anonymous owner and admin notification behavior, but never expose another user's notification data.

- [ ] **Step 5: Remove the Layout interval while retaining the online event.**

Keep one `online` listener that flushes the explicit safe queue and updates the counter once. Remove the 30-second `setInterval` at `src/components/Layout.tsx:117-125`; update the counter only after queueAction, successful flush, explicit clear, or the online event. Keep announcement loading to one request and local dismissal behavior.

- [ ] **Step 6: Run the focused tests.**

Run: `npm test -- src/__tests__/AppContextCore.test.tsx src/__tests__/AppContextSaved.test.tsx src/__tests__/Layout.test.tsx`

Expected: one initial summary, no hidden/visibility refresh, no recurring data timer, and failed local writes preserve last-known-good state.

- [ ] **Step 7: Commit only this slice.**

```bash
git add src/contexts/AppContext.tsx src/components/Layout.tsx src/__tests__/AppContextCore.test.tsx src/__tests__/AppContextSaved.test.tsx src/__tests__/Layout.test.tsx
git commit -m "fix: remove global client data polling"
```

### Task 8: Share one clock for poll and purge countdowns

**Files:**
- Create: `src/hooks/useSharedClock.ts`
- Modify: `src/components/PollCard.tsx:19-191`
- Modify: `src/components/PurgeCountdown.tsx:1-33`
- Modify: `src/pages/SolvingBoard.tsx:19-191`
- Test: `src/__tests__/PollCard.test.tsx:1-240`
- Test: `src/__tests__/shared-clock.test.tsx` (create)

**Interfaces:**
- Produces: `SharedClockProvider`, `useCountdown(endsAt: string | number | null): { remainingMs: number; expired: boolean }`, and one interval per mounted view/provider.

- [ ] **Step 1: Write the failing interval-count test.**

```ts
it("uses one clock for many visible countdowns", () => {
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  render(
    <SharedClockProvider>
      {Array.from({ length: 100 }, (_, i) => <PollCard key={i} poll={{ id: `p${i}`, expires_at: futureIso() } as any} />)}
    </SharedClockProvider>,
  );
  expect(setIntervalSpy).toHaveBeenCalledTimes(1);
});

it("does not create a clock for an unmounted view", () => {
  const { unmount } = render(<SharedClockProvider><PollCard poll={futurePoll()} /></SharedClockProvider>);
  unmount();
  expect(clearInterval).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the clock tests and verify the current per-card timers fail.**

Run: `npm test -- src/__tests__/shared-clock.test.tsx src/__tests__/PollCard.test.tsx`

Expected before implementation: each `PollCard` creates its own countdown interval and there is no shared provider.

- [ ] **Step 3: Implement the shared clock.**

Use one ref-counted interval owned by `SharedClockProvider`, update a single `now` value, and derive each card's remaining time from that value. A missing or invalid end time renders a stable non-counting state. Expiry may call a local `onExpire` callback but must not start a data request; the owning route decides whether an explicit refresh is appropriate.

- [ ] **Step 4: Migrate PollCard, PurgeCountdown, and SolvingBoard.**

Replace card-local `setInterval` and `setTimeout` countdown bookkeeping with `useCountdown`. Preserve the existing close notification and purge labels. Do not remove the visual countdown or convert an expired poll into an empty list.

- [ ] **Step 5: Run the focused tests.**

Run: `npm test -- src/__tests__/shared-clock.test.tsx src/__tests__/PollCard.test.tsx src/__tests__/SolvingBoard.test.tsx`

Expected: one interval for many cards, no data request on expiry, and cleanup on unmount.

- [ ] **Step 6: Commit only this slice.**

```bash
git add src/hooks/useSharedClock.ts src/components/PollCard.tsx src/components/PurgeCountdown.tsx src/pages/SolvingBoard.tsx src/__tests__/shared-clock.test.tsx src/__tests__/PollCard.test.tsx src/__tests__/SolvingBoard.test.tsx
git commit -m "perf: share countdown clock across cards"
```

### Task 9: Flush telemetry on lifecycle boundaries, not recurring timers

**Files:**
- Modify: `src/lib/vitals.ts:46-105,203-217`
- Modify: `src/lib/errors.ts:33-106,107-199`
- Test: `src/__tests__/vitals.test.ts:1-142`
- Test: `src/__tests__/errors.test.ts:1-152`
- Test: `src/__tests__/telemetry-lifecycle.test.ts` (create)

**Interfaces:**
- Consumes: existing `initVitals`, `initErrorCapture`, and `reportBoundaryError`.
- Produces: `flushTelemetry(reason: "hidden" | "pagehide" | "beforeunload" | "manual"): void`, bounded buffers, and no recurring flush timer.

- [ ] **Step 1: Write failing lifecycle tests.**

```ts
it("does not schedule a five-second vitals flush", () => {
  vi.useFakeTimers();
  initVitalsForTest();
  reportVitalForTest("LCP", 1000);
  expect(vi.getTimerCount()).toBe(0);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(fetchMock).toHaveBeenCalledWith("/api/vitals", expect.objectContaining({ method: "POST" }));
});

it("flushes errors on pagehide and does not reschedule after the buffer empties", () => {
  initErrorCaptureForTest();
  reportBoundaryError(new Error("boom"));
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new Event("pagehide"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the telemetry tests and verify current timer behavior fails.**

Run: `npm test -- src/__tests__/vitals.test.ts src/__tests__/errors.test.ts src/__tests__/telemetry-lifecycle.test.ts`

Expected before implementation: `src/lib/vitals.ts:72-78` schedules five seconds and `src/lib/errors.ts:96-104` schedules ten seconds.

- [ ] **Step 3: Implement lifecycle flushes and explicit test hooks.**

Remove `flushTimer` and `scheduleFlush`. Keep the existing metric/error dedupe and per-minute rate limits, cap the buffer to the existing documented ceiling, and register one idempotent `visibilitychange`, `pagehide`, and `beforeunload` handler per collector. Export only the test-safe reset/flush functions needed by the focused suites; do not expose message bodies, secrets, or raw URLs in telemetry.

- [ ] **Step 4: Keep the admin read surfaces on-demand.**

`src/pages/admin/PerformanceCenter.tsx:96-130` and `src/pages/admin/Overview.tsx:74-81` may read aggregate vitals once on entry and on explicit Refresh, but must not use a client interval to trigger a read. The POST lifecycle flush is not a page data poll and must not be counted against the route request budget.

- [ ] **Step 5: Run the focused tests.**

Run: `npm test -- src/__tests__/vitals.test.ts src/__tests__/errors.test.ts src/__tests__/telemetry-lifecycle.test.ts src/__tests__/PerformanceCenter.test.tsx src/__tests__/Overview.test.tsx`

Expected: no recurring telemetry timer, one lifecycle flush per buffered batch, and no false success when a lifecycle POST fails.

- [ ] **Step 6: Commit only this slice.**

```bash
git add src/lib/vitals.ts src/lib/errors.ts src/__tests__/vitals.test.ts src/__tests__/errors.test.ts src/__tests__/telemetry-lifecycle.test.ts
git commit -m "perf: flush frontend telemetry on lifecycle boundaries"
```

### Task 10: Deduplicate category reads across simultaneous consumers

**Files:**
- Modify: `src/hooks/useCategories.ts:5-31`
- Test: `src/__tests__/useCategories.test.tsx:1-62`

**Interfaces:**
- Consumes: `readCoordinator.get` and the existing `CATEGORIES` fallback.
- Produces: one active `/api/categories` request for all mounted consumers, with a valid shared result and a deterministic fallback only when the response is malformed or the read fails.

- [ ] **Step 1: Add the failing simultaneous-consumer test.**

```ts
it("shares one categories request between two consumers", async () => {
  const deferred = deferred<{ categories: string[] }>();
  fetchMock.mockReturnValue(deferred.promise);
  render(<><CategoryProbe /><CategoryProbe /></>);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  deferred.resolve({ categories: ["Math", "Science", "Arts"] });
  expect(await screen.findAllByTestId("categories")).toHaveLength(2);
});

it("keeps defaults on a malformed response without replacing them with an empty list", async () => {
  fetchMock.mockResolvedValue(okResponse({ categories: "not-an-array" }));
  render(<CategoryProbe />);
  expect(await screen.findByTestId("categories")).toHaveTextContent("Academics");
});
```

- [ ] **Step 2: Run the focused test and verify the current per-mount request fails.**

Run: `npm test -- src/__tests__/useCategories.test.tsx`

Expected before implementation: each `useEffect` calls `api.get("/api/categories")` independently.

- [ ] **Step 3: Implement the shared read and explicit validation.**

Key the read by the normalized category path and current viewer context. Share only while active, use `Array.isArray` plus string filtering, require the same minimum valid category count as the current fallback policy, and keep the static `CATEGORIES` value on failure. Do not turn a failed read into an empty category list.

- [ ] **Step 4: Run the focused test and its consumers.**

Run: `npm test -- src/__tests__/useCategories.test.tsx src/__tests__/Home.test.tsx src/__tests__/Search.test.tsx src/__tests__/Submit.test.tsx`

Expected: simultaneous consumers make one request and all existing dropdown behavior remains available.

- [ ] **Step 5: Commit only this slice.**

```bash
git add src/hooks/useCategories.ts src/__tests__/useCategories.test.tsx
git commit -m "perf: share category reads across consumers"
```

### Task 11: Establish the canonical 17-key admin registry and query-tab identity

**Files:**
- Create: `src/lib/adminTabs.ts`
- Modify: `src/pages/Admin.tsx:69-229,352-488,533-596`
- Modify: `src/components/admin/PageContext.jsx:20-100`
- Modify: `src/components/admin/PageContext.d.ts:1-32`
- Modify: `src/components/CommandPalette.tsx:1-240` if it maintains a separate admin-key list
- Test: `src/__tests__/AdminShell.test.tsx:1-136`
- Test: `src/__tests__/AdminTabSweep.test.tsx:1-103`
- Create: `src/__tests__/admin-tabs.test.ts`

**Interfaces:**
- Consumes: the exact `AdminTabKey`, `ADMIN_TAB_KEYS`, `PRIMARY_ADMIN_TAB_KEYS`, `CAPABILITY_ADMIN_TAB_KEYS`, `parseAdminTab`, and `buildAdminTabUrl` contracts in the architecture section.
- Produces: one registry used by navigation, lazy component selection, PageContext, command lookup, analytics, and tests.

- [ ] **Step 1: Write the failing registry and direct-link tests.**

```ts
it("retains all 17 canonical keys and 15 primary destinations", () => {
  expect(ADMIN_TAB_KEYS).toHaveLength(17);
  expect(PRIMARY_ADMIN_TAB_KEYS).toHaveLength(15);
  expect(CAPABILITY_ADMIN_TAB_KEYS).toEqual(["agent-chat", "ops-center"]);
  expect(new Set([...PRIMARY_ADMIN_TAB_KEYS, ...CAPABILITY_ADMIN_TAB_KEYS])).toEqual(new Set(ADMIN_TAB_KEYS));
});

it("maps /admin?tab=ops-center to the Ops Center capability", () => {
  expect(parseAdminTab("tab=ops-center")).toBe("ops-center");
  expect(buildAdminTabUrl("ops-center")).toBe("/admin?tab=ops-center");
  expect(buildPageContextForAPI({ page: parseAdminTab("tab=ops-center"), filters: {}, selectedItems: [] })).toMatchObject({ page: "ops-center" });
});
```

- [ ] **Step 2: Run the registry tests and verify the current path-based mapper fails.**

Run: `npm test -- src/__tests__/admin-tabs.test.ts src/__tests__/AdminShell.test.tsx src/__tests__/AdminTabSweep.test.tsx`

Expected before implementation: `Admin.tsx` and `PageContext.jsx` maintain separate lists, and query-tab identity can be reported as dashboard or an obsolete path.

- [ ] **Step 3: Implement the registry and migrate all consumers.**

Define the exact 17-key order and labels/groups from the architecture section. Keep both capability keys in the canonical registry and in `ALL_TABS`; `PRIMARY_ADMIN_TAB_KEYS` controls navigation density only. Replace `src/pages/Admin.tsx:163-180` raw-string validation with `parseAdminTab`, replace `src/components/admin/PageContext.jsx:29-87` path mapping with the same parser, and ensure `AgentChat` and `OpsCenter` remain explicit links, command results, analytics labels, and lazy component branches. An unknown `tab` must use the existing safe dashboard fallback without deleting any known key.

- [ ] **Step 4: Run the 17-tab render sweep without mocking away lifecycle behavior.**

Run: `npm test -- src/__tests__/admin-tabs.test.ts src/__tests__/AdminShell.test.tsx src/__tests__/AdminTabSweep.test.tsx`

Expected: all 17 keys render through the real registry, direct query URLs select the correct component, and the sweep records initial request counts.

- [ ] **Step 5: Commit only this slice.**

```bash
git add src/lib/adminTabs.ts src/pages/Admin.tsx src/components/admin/PageContext.jsx src/components/admin/PageContext.d.ts src/components/CommandPalette.tsx src/__tests__/admin-tabs.test.ts src/__tests__/AdminShell.test.tsx src/__tests__/AdminTabSweep.test.tsx
git commit -m "fix: unify canonical admin query-tab identity"
```

### Task 12: Define explicit snapshot boundaries and route-budget helpers

**Files:**
- Create: `src/lib/snapshotBoundary.ts`
- Create: `src/__tests__/helpers/requestBudget.ts`
- Create: `src/__tests__/helpers/deferred.ts`
- Create: `src/__tests__/snapshotBoundary.test.ts`
- Create: `src/__tests__/request-budget-helpers.test.ts`
- Modify: `tests/setup.ts:1-80`

**Interfaces:**
- Produces: `SnapshotBoundary`, `canRequestSnapshot(boundary)`, `isAuthoritativeMutationResponse(value)`, `createRequestCounter(fetchMock)`, `expectInitialBudget(counter, maximum)`, `expectNoReadAfterAction(counter, action)`, and `deferred<T>()`.

- [ ] **Step 1: Write the failing boundary and budget tests.**

```ts
it("permits only explicit boundaries", () => {
  expect(canRequestSnapshot("initial")).toBe(true);
  expect(canRequestSnapshot("refresh")).toBe(true);
  expect(canRequestSnapshot("retry")).toBe(true);
  expect(canRequestSnapshot("filter")).toBe(true);
  expect(canRequestSnapshot("route-entry")).toBe(true);
  expect(canRequestSnapshot("pagination")).toBe(true);
  expect(canRequestSnapshot("realtime")).toBe(false);
  expect(canRequestSnapshot("visibility")).toBe(false);
  expect(canRequestSnapshot("timer")).toBe(false);
});

it("counts reads separately from writes", async () => {
  const fetchMock = vi.fn();
  const budget = createRequestCounter(fetchMock);
  await budget.read("/api/posts?paginate=1&limit=20");
  await budget.write("/api/reactions", { target_id: "p1" });
  expectInitialBudget(budget, 1);
  expectNoReadAfterAction(budget, 1);
});
```

- [ ] **Step 2: Run the tests and verify the missing modules fail.**

Run: `npm test -- src/__tests__/snapshotBoundary.test.ts src/__tests__/request-budget-helpers.test.ts`

Expected before implementation: both helper modules are absent.

- [ ] **Step 3: Implement the pure helpers.**

`canRequestSnapshot` denies `realtime`, `visibility`, `timer`, and `socket` boundaries. `isAuthoritativeMutationResponse` requires `ok === true` and at least one of `record`, `records`, `deletedId`, or a documented normalized state. `createRequestCounter` counts only GET/HEAD/read-intent POSTs for the read budget, retains the raw call list, and normalizes URLs with `new URL(path, "https://voice-box.test")`. `deferred` exposes `promise`, `resolve`, and `reject`. Do not add a global mock that hides caller `AbortSignal` behavior.

- [ ] **Step 4: Run the helper tests and commit.**

Run: `npm test -- src/__tests__/snapshotBoundary.test.ts src/__tests__/request-budget-helpers.test.ts src/__tests__/setup.ts`

```bash
git add src/lib/snapshotBoundary.ts src/__tests__/helpers/requestBudget.ts src/__tests__/helpers/deferred.ts src/__tests__/snapshotBoundary.test.ts src/__tests__/request-budget-helpers.test.ts src/__tests__/setup.ts
git commit -m "test: define explicit snapshot and request budgets"
```

### Task 13: Make API response contracts additive across mutation families

**Files:**
- Modify: `api/_polls.js:1-260`
- Modify: `api/_reactions.js:1-161`
- Modify: `api/_comments.js:1-260`
- Modify: `api/_posts.js:1-320`
- Modify: `api/_categories.js:1-107`
- Modify: `api/_admin.js:235-580` where admin action returns are assembled
- Modify: `api/_reports.js:1-260`
- Modify: `api/_inbox.js:1-300`
- Test: `tests/api/polls-full.test.ts`, `tests/api/reactions.test.ts`, `tests/api/comments-full.test.ts`, `tests/api/posts-full.test.ts`, `tests/api/categories.test.ts`, `tests/api/reports.test.ts`, `tests/api/inbox-admin-reply.test.ts`

**Interfaces:**
- Consumes: `MutationEnvelope<T>` and `reconcileRecord(s)` from Task 3.
- Produces: every successful mutation response contains the affected record, confirmed ID, or normalized viewer state while retaining existing fields and status meanings.

- [ ] **Step 1: Add one failing response-contract test per mutation family.**

```ts
it("returns the authoritative poll and viewer choice after voting", async () => {
  const response = await invokePollVote({ poll_id: "poll-1", option_id: "yes", anon_id: "anon-1" });
  expect(response.body).toMatchObject({ ok: true, poll: { id: "poll-1", my_vote: "yes" }, record: { id: "poll-1" } });
});

it("returns the authoritative comment after creation", async () => {
  const response = await invokeCommentCreate({ post_id: "p1", body: "hello" });
  expect(response.body).toMatchObject({ ok: true, comment: { id: expect.any(String), body: "hello" } });
});

it("returns the normalized category list after a category mutation", async () => {
  const response = await invokeCategoryMutation({ action: "remove", name: "Science" });
  expect(response.body).toMatchObject({ ok: true, categories: expect.arrayContaining(["Academics"]) });
});
```

- [ ] **Step 2: Run the API tests and record the current insufficient envelopes.**

Run: `npm test -- tests/api/polls-full.test.ts tests/api/reactions.test.ts tests/api/comments-full.test.ts tests/api/posts-full.test.ts tests/api/categories.test.ts tests/api/reports.test.ts tests/api/inbox-admin-reply.test.ts`

Expected before implementation: at least one endpoint returns only `{ ok: true }`, a vote-only response, or a detached action ID and therefore cannot reconcile the visible target.

- [ ] **Step 3: Add authoritative fields without removing compatibility fields.**

For poll vote/archive/delete, return `record: PollData`, `poll`, and viewer choice where applicable. For reaction/follow/bookmark, return `record` plus the target and viewer state. For comment/save operations, return the affected comment or bookmarked-post target. For categories, return the complete normalized category list. For admin user/report/provider/email/announcement actions, return `record`, `state`, or `deletedId`. Preserve existing `ok`, `id`, `verification`, and array fields. Never return a fabricated record after a failed database update.

- [ ] **Step 4: Add stable failure envelopes.**

Every failed mutation must use the existing non-2xx error shape with a safe message and no `ok: true`. A missing target is `404`, an authorization failure is `403`, validation is `400`, and an ambiguous transport failure is rejected to the client rather than converted into a false success. Do not expose provider secrets, SQL, or message bodies in the error.

- [ ] **Step 5: Run the API subset and commit.**

Run: `npm test -- tests/api/polls-full.test.ts tests/api/reactions.test.ts tests/api/comments-full.test.ts tests/api/posts-full.test.ts tests/api/categories.test.ts tests/api/reports.test.ts tests/api/inbox-admin-reply.test.ts`

```bash
git add api/_polls.js api/_reactions.js api/_comments.js api/_posts.js api/_categories.js api/_admin.js api/_reports.js api/_inbox.js tests/api/polls-full.test.ts tests/api/reactions.test.ts tests/api/comments-full.test.ts tests/api/posts-full.test.ts tests/api/categories.test.ts tests/api/reports.test.ts tests/api/inbox-admin-reply.test.ts
git commit -m "fix: return authoritative records from mutations"
```

## Public Route Tasks

Every public-route task uses the same lifecycle: one initial bounded read, explicit refresh/retry controls, honest `loading/success/empty/stale/error` states, and no request from a timer, visibility event, or passive Realtime event. Static pages use zero application reads. The focused test command for each task is intentionally narrow; the full ordered gate is listed at the end of this plan.

### Task 14: `/about` static route

**Files:**
- Modify: `src/pages/About.tsx:1-166`
- Test: `src/__tests__/About.test.tsx` (create if absent)
- Route: `src/App.tsx:68-76`

- [ ] **Step 1: Write a failing static-surface test.**

```ts
it("renders About without an application request", async () => {
  renderAt("/about");
  expect(await screen.findByRole("heading", { name: /about/i })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it and verify the route test is missing or fails.**

Run: `npm test -- src/__tests__/About.test.tsx`

- [ ] **Step 3: Add only the static heading/landmark/link evidence required by the inventory.**

Do not add an API read, timer, Realtime call, or synthetic status timestamp. Preserve all existing values, milestones, and links.

- [ ] **Step 4: Run the focused test.**

Run: `npm test -- src/__tests__/About.test.tsx`

Expected: heading, content, navigation links, and zero request calls.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/About.tsx src/__tests__/About.test.tsx
git commit -m "test: cover static about route"
```

### Task 15: `/contact` form mutation route

**Files:**
- Modify: `src/pages/Contact.tsx:14-234`
- Test: `src/__tests__/Contact.test.tsx` (create if absent)
- API: `api/_posts.js` contact action path

- [ ] **Step 1: Write the failing form outcome test.**

```ts
it("sends one contact mutation only after submit and shows the server result", async () => {
  fetchMock.mockResolvedValue(okResponse({ ok: true, post: { id: "contact-1" } }));
  renderAt("/contact");
  await user.type(screen.getByLabelText(/name/i), "Ada");
  await user.type(screen.getByLabelText(/email/i), "ada@example.test");
  await user.type(screen.getByLabelText(/message/i), "Hello");
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /send/i }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/received/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and verify the missing route test fails.**

Run: `npm test -- src/__tests__/Contact.test.tsx`

- [ ] **Step 3: Preserve the explicit send action and honest states.**

Keep the existing POST body, validation, sending state, success state, and error state. Do not clear the form or reload a feed on success. A failed send leaves the entered values visible and offers a retry through the same submit action.

- [ ] **Step 4: Run the focused test.**

Run: `npm test -- src/__tests__/Contact.test.tsx`

Expected: zero mount reads, one user-triggered mutation, and no false success on rejection.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/Contact.tsx src/__tests__/Contact.test.tsx
git commit -m "test: cover contact form mutation outcome"
```

### Task 16: `/terms` static route

**Files:**
- Modify: `src/pages/Terms.tsx:1-99`
- Test: `src/__tests__/Terms.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing static-copy test.**

```ts
it("renders Terms sections and no request", async () => {
  renderAt("/terms");
  expect(await screen.findByRole("heading", { name: /terms/i })).toBeInTheDocument();
  expect(screen.getByText(/acceptable use/i)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it.**

Run: `npm test -- src/__tests__/Terms.test.tsx`

- [ ] **Step 3: Add only static evidence and preserve the copy.**

Do not add a data engine or change legal copy except where the privacy/storage reconciliation task explicitly requires a truthful cross-reference.

- [ ] **Step 4: Run and commit.**

Run: `npm test -- src/__tests__/Terms.test.tsx`

```bash
git add src/pages/Terms.tsx src/__tests__/Terms.test.tsx
git commit -m "test: cover static terms route"
```

### Task 17: `/privacy` truthful storage copy

**Files:**
- Modify: `src/pages/Privacy.tsx:12-93`
- Modify: `src/pages/Settings.tsx:48-200` only if the copy contract requires a shared constant
- Test: `src/__tests__/Privacy.test.tsx` (create if absent)
- Test: `src/__tests__/Settings.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing privacy consistency test.**

```ts
it("does not claim notification email/phone values are never stored", async () => {
  renderAt("/privacy");
  const copy = screen.getByRole("main").textContent!.toLowerCase();
  expect(copy).toMatch(/notification|email|phone|retention|deletion/);
  expect(copy).not.toMatch(/never store|no personal data is stored/);
});
```

- [ ] **Step 2: Run it.**

Run: `npm test -- src/__tests__/Privacy.test.tsx src/__tests__/Settings.test.tsx`

- [ ] **Step 3: Reconcile copy with the product decision implemented by the settings task.**

If notification email/phone values remain supported, state purpose, retention, access boundary, and deletion behavior. If they are removed, remove collection and storage in the separate settings/API slice rather than claiming removal in copy alone. Preserve all other privacy sections and links.

- [ ] **Step 4: Run and commit.**

Run: `npm test -- src/__tests__/Privacy.test.tsx src/__tests__/Settings.test.tsx`

```bash
git add src/pages/Privacy.tsx src/pages/Settings.tsx src/__tests__/Privacy.test.tsx src/__tests__/Settings.test.tsx
git commit -m "docs: align privacy copy with stored preferences"
```

### Task 18: `/status` honest manual health snapshot

**Files:**
- Modify: `src/pages/StatusPage.tsx:50-100,236-265`
- Test: `src/__tests__/StatusPage.test.tsx` (create if absent)
- API: `api/_health.js:1-180`

- [ ] **Step 1: Write the failing honesty test.**

it("updates lastChecked only after a successful manual health response", async () => {
  fetchMock.mockResolvedValueOnce(okResponse({ status: "operational", checked_at: "2026-09-25T00:00:00.000Z" }));
  renderAt("/status");
  const before = screen.getByTestId("last-checked").textContent;
  await user.click(screen.getByRole("button", { name: /refresh|check/i }));
  await screen.findByText(/operational/i);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("last-checked")).not.toHaveTextContent(before ?? "");
});

it("does not advance lastChecked when the manual health request fails", async () => {
  fetchMock.mockRejectedValueOnce(new Error("health unavailable"));
  renderAt("/status");
  const before = screen.getByTestId("last-checked").textContent;
  await user.click(screen.getByRole("button", { name: /refresh|check/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not|unavailable/i);
  expect(screen.getByTestId("last-checked")).toHaveTextContent(before ?? "");
});
```

- [ ] **Step 2: Run it.**

Run: `npm test -- src/__tests__/StatusPage.test.tsx`

- [ ] **Step 3: Connect the explicit control to a bounded read-only health request.**

Remove the one-second fake `setTimeout` at `src/pages/StatusPage.tsx:78-83`. If the endpoint is available, update `lastChecked` only after a successful response and show service error/stale state on failure. If the endpoint is intentionally static, label it as a static snapshot and remove the live-check wording. Do not synthesize healthy values.

- [ ] **Step 4: Run and commit.**

Run: `npm test -- src/__tests__/StatusPage.test.tsx`

```bash
git add src/pages/StatusPage.tsx src/__tests__/StatusPage.test.tsx api/_health.js
git commit -m "fix: make status page report honest health state"
```

### Task 19: `/changelog` static route

**Files:**
- Modify: `src/pages/Changelog.tsx:1-177`
- Test: `src/__tests__/Changelog.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing static test.**

```ts
it("renders a changelog entry and zero requests", async () => {
  renderAt("/changelog");
  expect(await screen.findByRole("heading", { name: /changelog/i })).toBeInTheDocument();
  expect(screen.getAllByText(/voice box/i).length).toBeGreaterThan(0);
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, add static evidence, and rerun.**

Run: `npm test -- src/__tests__/Changelog.test.tsx`

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Changelog.tsx src/__tests__/Changelog.test.tsx
git commit -m "test: cover static changelog route"
```

### Task 20: `/accessibility` static route

**Files:**
- Modify: `src/pages/Accessibility.tsx:1-207`
- Test: `src/__tests__/Accessibility.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing landmark/keyboard test.**

```ts
it("renders accessibility commitments and keyboard-reachable content", async () => {
  renderAt("/accessibility");
  expect(await screen.findByRole("heading", { name: /accessibility/i })).toBeInTheDocument();
  expect(screen.getByRole("main")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and preserve the static content.**

Run: `npm test -- src/__tests__/Accessibility.test.tsx`

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Accessibility.tsx src/__tests__/Accessibility.test.tsx
git commit -m "test: cover accessibility route"
```

### Task 21: `/faq` local search route

**Files:**
- Modify: `src/pages/Faq.tsx:39-131`
- Test: `src/__tests__/Faq.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing local-only test.**

```ts
it("filters and opens FAQ items without a request", async () => {
  renderAt("/faq");
  await user.type(screen.getByRole("searchbox"), "privacy");
  expect(await screen.findByText(/privacy/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /privacy/i }));
  expect(screen.getByRole("region")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, preserve local filtering, and rerun.**

Run: `npm test -- src/__tests__/Faq.test.tsx`

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Faq.tsx src/__tests__/Faq.test.tsx
git commit -m "test: cover local FAQ search and accordion"
```

### Task 22: `/` Home bounded feed and local actions

**Files:**
- Modify: `src/pages/Home.tsx:46-190,192-375,453-470,785-843`
- Modify: `src/components/PostCard.tsx:50-162,365-404`
- Modify: `src/components/PollCard.tsx:19-191`
- Test: `src/__tests__/Home.test.tsx:1-461`
- Rewrite: `src/__tests__/Home.realtime.test.tsx:1-258`
- Test: `src/__tests__/PostCard.test.tsx:1-238`

**Interfaces:**
- Consumes: `readCoordinator`, `useResourceRefresh`, `reconcileRecord`, explicit `LoadMoreButton`, and authoritative mutation envelopes.
- Produces: one initial bundle of 20 posts, one bounded poll batch of at most 50 unique IDs, one reaction set, and one viewer-vote set; no silent row patches or list reloads.

- [ ] **Step 1: Add failing request and action tests.**

```ts
it("loads the bounded initial bundle once and keeps it stable while quiet", async () => {
  renderAt("/");
  await waitFor(() => expect(screen.getByText("Post one")).toBeInTheDocument());
  const before = readCalls();
  document.dispatchEvent(new Event("visibilitychange"));
  emitRealtimeEvent("posts", { eventType: "INSERT", new: { id: "other" } });
  expect(readCalls()).toEqual(before);
  expect(screen.queryByText("other")).not.toBeInTheDocument();
});

it("patches one reaction and does not request the feed again", async () => {
  renderAt("/");
  await user.click(await screen.findByRole("button", { name: /react|heart/i }));
  expect(screen.getByText("Post one")).toBeInTheDocument();
  expect(readCalls().filter((p) => p.includes("/api/posts"))).toHaveLength(1);
});
```

- [ ] **Step 2: Run the Home and Realtime tests and verify the current passive paths fail.**

Run: `npm test -- src/__tests__/Home.test.tsx src/__tests__/Home.realtime.test.tsx src/__tests__/PostCard.test.tsx`

Expected before implementation: `src/pages/Home.tsx:288-375` still subscribes and can patch/reload rows, and `src/pages/Home.tsx:457-470` still creates an automatic observer.

- [ ] **Step 3: Make the initial bundle bounded and shared.**

Request `GET /api/posts?paginate=1&limit=20&type=problem` once. Deduplicate linked poll IDs, request one bounded poll batch, one reaction set, and one viewer-vote set. Use the resource state machine so a failed subresource keeps successful rows visible and reports a partial/stale state. Remove `pendingNew`, `lastFullReloadRef`, passive event patching, and the 12-second event throttle from the default page lifecycle.

- [ ] **Step 4: Make filter/refresh/pagination and mutations explicit.**

Filter/sort changes reset the generation and request the new bounded query. Pull-to-refresh and the visible Refresh button call `api.refresh`. Replace the sentinel at `src/pages/Home.tsx:457-470` with `LoadMoreButton`; if the server returns `nextCursor`, append only that page. A successful reaction, bookmark, poll vote, or comment action patches the target record from the response and preserves siblings, drafts, filters, and scroll position. Failed optimistic actions restore the previous target.

- [ ] **Step 5: Run the focused tests and commit.**

Run: `npm test -- src/__tests__/Home.test.tsx src/__tests__/Home.realtime.test.tsx src/__tests__/PostCard.test.tsx src/__tests__/PollCard.test.tsx`

```bash
git add src/pages/Home.tsx src/components/PostCard.tsx src/components/PollCard.tsx src/__tests__/Home.test.tsx src/__tests__/Home.realtime.test.tsx src/__tests__/PostCard.test.tsx src/__tests__/PollCard.test.tsx
git commit -m "fix: bound Home feed and reconcile local actions"
```

### Task 23: `/submit` bounded input-driven assistance and authoritative publish

**Files:**
- Modify: `src/pages/Submit.tsx:115-1064,1122-2301`
- Test: `src/__tests__/Submit.test.tsx:1-913`
- Test: `src/__tests__/speech.test.ts:1-260`
- API tests: `tests/api/pre-publish.test.ts`, `tests/api/pre-publish-review.test.ts`

**Interfaces:**
- Consumes: explicit read-intent POSTs for duplicate/AI/poll/moderation assistance, explicit write intent for publish, and the resource/generation contract.
- Produces: no page data poll; input-driven timers may run only for recorder/meter/debounce work and each assistant call is bounded and superseded safely.

- [ ] **Step 1: Add failing request/ambiguous-write tests.**

```ts
it("does not publish on mount and cancels a superseded duplicate check", async () => {
  renderAt("/submit");
  await user.type(screen.getByLabelText(/title/i), "A");
  const first = duplicateDeferred();
  const second = duplicateDeferred();
  duplicateMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await user.type(screen.getByLabelText(/title/i), "B");
  second.resolve({ matches: [] });
  first.resolve({ matches: [{ id: "old" }] });
  expect(screen.queryByText("old")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([p]) => String(p).includes("/api/posts"))).toHaveLength(0);
});

it("never queues an ambiguous publish timeout", async () => {
  fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
  renderAt("/submit");
  await fillValidPost();
  await user.click(screen.getByRole("button", { name: /publish/i }));
  expect(queuedCount()).toBe(0);
  expect(screen.getByRole("alert")).toHaveTextContent(/could not complete|try again/i);
});
```

- [ ] **Step 2: Run the focused tests and verify current unbounded assistance/failure paths fail.**

Run: `npm test -- src/__tests__/Submit.test.tsx src/__tests__/speech.test.ts tests/api/pre-publish.test.ts tests/api/pre-publish-review.test.ts`

Expected before implementation: duplicate lookup can use an unbounded post read, assistant calls are not all read-intent, and a timeout path can enter the old write queue.

- [ ] **Step 3: Classify every Submit request.**

Use `api.postRead` for duplicate checks, poll suggestions, AI suggestions, moderation/pre-publish advisory reads, and other non-mutating POSTs. Use `api.post`/`postLong` with `intent: "write", replay: "never"` for publish, upload, and moderation decisions unless the endpoint contract explicitly documents safe idempotent replay. Keep the debounce and recorder/meter timers; remove any timer that performs a full page read.

- [ ] **Step 4: Make publish reconciliation authoritative and preserve the form.**

On a successful post/poll response, insert the returned record into the matching local preview/result state and navigate or show success without reloading the feed. On a failed publish, restore the draft, preserve pre-publish/moderation evidence, and show the error. Voice recording, transcription, dictation, and meter timers remain because they measure an active user operation rather than refresh page data.

- [ ] **Step 5: Run the focused tests and commit.**

Run: `npm test -- src/__tests__/Submit.test.tsx src/__tests__/speech.test.ts tests/api/pre-publish.test.ts tests/api/pre-publish-review.test.ts`

```bash
git add src/pages/Submit.tsx src/__tests__/Submit.test.tsx src/__tests__/speech.test.ts tests/api/pre-publish.test.ts tests/api/pre-publish-review.test.ts
git commit -m "fix: bound Submit assistance and publish outcomes"
```

### Task 24: `/post/:id` detail snapshot and local actions

**Files:**
- Modify: `src/pages/PostDetail.tsx:36-186,188-389,566-821`
- Modify: `src/components/Comments.tsx:82-166,238-367`
- Test: `src/__tests__/PostDetail.test.tsx:1-824`
- Test: `src/__tests__/Comments.gate.test.tsx:1-197`
- Rewrite: `src/__tests__/Comments.realtime.test.tsx:1-267`

- [ ] **Step 1: Add failing lifecycle and action tests.**

```ts
it("loads the post bundle once and does not reload on a quiet event", async () => {
  renderAt("/post/p1");
  await screen.findByText("Post one");
  const before = readCalls();
  emitRealtimeEvent("posts", { eventType: "UPDATE", new: { id: "p2" } });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(readCalls()).toEqual(before);
});

it("updates a reaction from the response without reloading comments", async () => {
  fetchMock.mockResolvedValueOnce(okResponse({ ok: true, record: { id: "p1", reaction_counts: { heart: 1 }, mine: ["heart"] } }));
  renderAt("/post/p1");
  await user.click(await screen.findByRole("button", { name: /heart|react/i }));
  expect(await screen.findByText("1")).toBeInTheDocument();
  expect(readCalls().some((p) => p.includes("/api/comments"))).toBe(false);
});
```

- [ ] **Step 2: Run the detail/comment tests and verify the current Realtime reloads fail.**

Run: `npm test -- src/__tests__/PostDetail.test.tsx src/__tests__/Comments.gate.test.tsx src/__tests__/Comments.realtime.test.tsx`

- [ ] **Step 3: Bound the detail bundle and remove passive subscriptions.**

Load the post, follows, one linked poll, viewer votes, and one comments page with a caller signal. Remove the `useRealtime` calls at `src/pages/PostDetail.tsx:160-187` and the comment event refetch in `Comments.tsx`. Keep explicit Retry and route-entry refresh. Comments submit/edit/delete/undo locally and reconcile the returned comment; no comment event causes a thread read.

- [ ] **Step 4: Preserve all detail controls.**

Keep follow, bookmark, reaction, comment, lock, report, delete, edit/admin status, read-aloud, copy link, export, and linked-poll vote. The export at `src/pages/PostDetail.tsx:330-352` is an explicit bounded read and must not be part of the initial request budget. Each mutation response patches only its target; failed optimistic state rolls back.

- [ ] **Step 5: Run the focused tests and commit.**

Run: `npm test -- src/__tests__/PostDetail.test.tsx src/__tests__/Comments.gate.test.tsx src/__tests__/Comments.realtime.test.tsx`

```bash
git add src/pages/PostDetail.tsx src/components/Comments.tsx src/__tests__/PostDetail.test.tsx src/__tests__/Comments.gate.test.tsx src/__tests__/Comments.realtime.test.tsx
git commit -m "fix: stabilize post detail and comment snapshots"
```

### Task 25: `/polls` bounded list and authoritative vote

**Files:**
- Modify: `src/pages/Polls.tsx:10-168`
- Modify: `src/components/PollCard.tsx:19-191`
- Test: `src/__tests__/Polls.test.tsx` (create if absent)
- Test: `src/__tests__/PollCard.test.tsx:1-240`
- API test: `tests/api/polls-full.test.ts`

- [ ] **Step 1: Write the failing stable-list test.**

```ts
it("does not reload the full poll list after a vote or passive event", async () => {
  renderAt("/polls");
  await screen.findByText("Poll one");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /yes/i }));
  emitRealtimeEvent("polls", { eventType: "UPDATE", new: { id: "poll-2" } });
  expect(readCalls()).toEqual(before);
  expect(await screen.findByText("1 vote")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it.**

Run: `npm test -- src/__tests__/Polls.test.tsx src/__tests__/PollCard.test.tsx tests/api/polls-full.test.ts`

- [ ] **Step 3: Implement one bounded list and targeted vote reconciliation.**

Request the server page of at most 50 polls plus viewer votes once. Active/ended tabs are local filters. A vote, archive, or delete uses the returned poll or `deletedId`; it does not call `load()`. Preserve true empty and stale/error states.

- [ ] **Step 4: Run and commit.**

Run: `npm test -- src/__tests__/Polls.test.tsx src/__tests__/PollCard.test.tsx tests/api/polls-full.test.ts`

```bash
git add src/pages/Polls.tsx src/components/PollCard.tsx src/__tests__/Polls.test.tsx src/__tests__/PollCard.test.tsx tests/api/polls-full.test.ts
git commit -m "fix: reconcile poll list actions locally"
```

### Task 26: `/suggestions` bounded list and local reaction state

**Files:**
- Modify: `src/pages/Suggestions.tsx:20-146,163-342`
- Test: `src/__tests__/Suggestions.test.tsx:1-89`
- API test: `tests/api/reactions.test.ts`

- [ ] **Step 1: Write the failing no-passive-refresh test.**

```ts
it("keeps the suggestion snapshot stable after an unrelated event and patches a vote", async () => {
  renderAt("/suggestions");
  await screen.findByText("Suggestion one");
  const before = readCalls();
  emitRealtimeEvent("posts", { eventType: "INSERT", new: { id: "new" } });
  await user.click(screen.getByRole("button", { name: /upvote/i }));
  expect(readCalls()).toEqual(before);
  expect(screen.queryByText("new")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/Suggestions.test.tsx tests/api/reactions.test.ts`

Remove `useRealtime` at `src/pages/Suggestions.tsx:66-96`, keep one bounded initial list/reaction set, and patch the voted suggestion from the response. Sort/status changes are local filters unless the server contract explicitly requires a new query.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Suggestions.tsx src/__tests__/Suggestions.test.tsx tests/api/reactions.test.ts
git commit -m "fix: stabilize suggestion list actions"
```

### Task 27: `/leaderboard` aggregate snapshot

**Files:**
- Modify: `src/pages/Leaderboard.tsx:122-344`
- Test: `src/__tests__/Leaderboard.test.tsx:1-107`
- API test: `tests/api/leaderboard.test.ts`

- [ ] **Step 1: Write the failing stability test.**

```ts
it("loads one leaderboard aggregate and treats tabs as local filters", async () => {
  renderAt("/leaderboard");
  await screen.findByText("Ada");
  const before = readCalls();
  await user.click(screen.getByRole("tab", { name: /support/i }));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run and implement the explicit Refresh/Retry path.**

Run: `npm test -- src/__tests__/Leaderboard.test.tsx tests/api/leaderboard.test.ts`

Keep one bounded aggregate read, local tab filtering, and explicit refresh/retry. A failed refresh retains the last ranking and shows stale/error state.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Leaderboard.tsx src/__tests__/Leaderboard.test.tsx tests/api/leaderboard.test.ts
git commit -m "fix: keep leaderboard aggregate stable"
```

### Task 28: `/communities` list and create/admin actions

**Files:**
- Modify: `src/pages/Communities.tsx:32-113,134-383`
- Test: `src/__tests__/Communities.test.tsx:1-102`
- API test: `tests/api/communities.test.ts`

- [ ] **Step 1: Write the failing list-action test.**

```ts
it("does not reload the community list after create or admin hide", async () => {
  renderAt("/communities");
  await screen.findByText("Math");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /hide/i }));
  expect(readCalls()).toEqual(before);
  expect(screen.getByText("Math")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/Communities.test.tsx tests/api/communities.test.ts`

Load at most 50 community cards once. Create/photo upload/hide/unhide/delete uses the returned record or `deletedId`; no success path calls `load()`. Keep explicit Refresh/Retry, the create dialog, file validation, admin authorization, and honest stale/error states.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Communities.tsx src/__tests__/Communities.test.tsx tests/api/communities.test.ts
git commit -m "fix: reconcile community list actions locally"
```

### Task 29: `/communities/:slug` bounded detail and all local controls

**Files:**
- Modify: `src/pages/CommunityDetail.tsx:84-335,388-729`
- Test: `src/__tests__/CommunityDetail.test.tsx:1-742`
- API test: `tests/api/communities.test.ts`

- [ ] **Step 1: Write failing tests for detail actions and stale data.**

```ts
it("keeps the detail and feed stable after a passive event", async () => {
  renderAt("/communities/math");
  await screen.findByText("Community post");
  const before = readCalls();
  emitRealtimeEvent("community_posts", { eventType: "INSERT", new: { id: "other" } });
  expect(readCalls()).toEqual(before);
});

it("rolls back a failed vote and preserves sibling posts", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse(500, { error: "vote failed" }));
  renderAt("/communities/math");
  await user.click(screen.getByRole("button", { name: /yes/i }));
  expect(screen.getByText(/vote failed|could not complete/i)).toBeInTheDocument();
  expect(screen.getByText("Sibling post")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and implement.**

Run: `npm test -- src/__tests__/CommunityDetail.test.tsx tests/api/communities.test.ts`

Load one bounded detail/feed snapshot. Reconcile join/leave, post/poll creation, vote, solve, delete, reaction, comment, report, and admin actions from the authoritative response. Keep drafts, open comment state, poll UI, authorization, and explicit Retry. No full detail load after success and no 25-second/visibility reload.

- [ ] **Step 3: Run and commit.**

Run: `npm test -- src/__tests__/CommunityDetail.test.tsx tests/api/communities.test.ts`

```bash
git add src/pages/CommunityDetail.tsx src/__tests__/CommunityDetail.test.tsx tests/api/communities.test.ts
git commit -m "fix: reconcile community detail actions"
```

### Task 30: `/board` bounded solving snapshot

**Files:**
- Modify: `src/pages/SolvingBoard.tsx:19-191`
- Test: `src/__tests__/SolvingBoard.test.tsx:1-87`

- [ ] **Step 1: Write the failing event-stability test.**

```ts
it("does not reload the board on a post event or visibility change", async () => {
  renderAt("/board");
  await screen.findByText("Problem one");
  const before = readCalls();
  emitRealtimeEvent("posts", { eventType: "UPDATE", new: { id: "p2" } });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/SolvingBoard.test.tsx`

Request at most 100 problem rows once, remove `useRealtime`, and use the shared clock for purge countdowns. Keep board links, retry, status columns, and manual refresh. Do not reload when a countdown expires.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/SolvingBoard.tsx src/__tests__/SolvingBoard.test.tsx
git commit -m "fix: stabilize solving board snapshot"
```

### Task 31: `/activity` bounded activity bundle and local tab actions

**Files:**
- Modify: `src/pages/MyActivity.tsx:53-118,124-214,222-642`
- Test: `src/__tests__/MyActivity.test.tsx:1-642`
- Test: `src/__tests__/MyActivityExport.test.tsx:1-146`

- [ ] **Step 1: Write the failing bundle/action test.**

```ts
it("loads each activity resource once and patches delete without a bundle reload", async () => {
  renderAt("/activity");
  await screen.findByText("My post");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /delete/i }));
  expect(readCalls()).toEqual(before);
  expect(screen.queryByText("My post")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/MyActivity.test.tsx src/__tests__/MyActivityExport.test.tsx`

Keep the seven bounded initial resources and local tab switching. Delete/undo uses `deletedId` or returned record. Export is an explicit read and must not run on tab change, visibility, or an unrelated action.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/MyActivity.tsx src/__tests__/MyActivity.test.tsx src/__tests__/MyActivityExport.test.tsx
git commit -m "fix: bound activity bundle and local actions"
```

### Task 32: `/saved` bookmark snapshot and local removal

**Files:**
- Modify: `src/pages/Saved.tsx:10-133`
- Test: `src/__tests__/Saved.test.tsx:1-133`
- API test: `tests/api/saved.test.ts`

- [ ] **Step 1: Write the failing no-reload test.**

```ts
it("removes a saved post locally and does not reload the list", async () => {
  renderAt("/saved");
  await screen.findByText("Saved post");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /remove|unsave/i }));
  expect(readCalls()).toEqual(before);
  expect(screen.queryByText("Saved post")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/Saved.test.tsx tests/api/saved.test.ts`

Load IDs plus at most 100 bookmarked posts once. Use the authoritative saved response to remove/reinsert the target, preserve reaction controls, and show a refresh card for a missing target rather than converting the whole page to empty.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Saved.tsx src/__tests__/Saved.test.tsx tests/api/saved.test.ts
git commit -m "fix: reconcile saved posts locally"
```

### Task 33: `/search` abortable query and explicit filters

**Files:**
- Modify: `src/pages/Search.tsx:64-160,220-458`
- Test: `src/__tests__/Search.test.tsx:1-375`
- API test: `tests/api/search-gap-recovery.test.ts`

- [ ] **Step 1: Write the failing superseded-query test.**

```ts
it("aborts the previous query and never renders its late result", async () => {
  renderAt("/search?q=old");
  const old = queryDeferred();
  queryMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ results: [{ id: "new" }], total: 1 });
  await user.type(screen.getByRole("searchbox"), " new");
  await screen.findByText("new");
  old.resolve({ results: [{ id: "old" }], total: 1 });
  expect(screen.queryByText("old")).not.toBeInTheDocument();
  expect(queryMock.mock.calls[0][1].signal).toBeDefined();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/Search.test.tsx tests/api/search-gap-recovery.test.ts`

Keep one categories read and one query read per submitted/debounced query. A filter change is an explicit request boundary with a new generation. No visibility, timer, or unrelated Realtime request. Preserve result links, type/category/status filters, clear, retry, and bounded result count.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Search.tsx src/__tests__/Search.test.tsx tests/api/search-gap-recovery.test.ts
git commit -m "fix: abort superseded search requests"
```

### Task 34: `/insights` aggregate snapshot

**Files:**
- Modify: `src/pages/Insights.tsx:115-141,177-376`
- Test: `src/__tests__/Insights.test.tsx:1-150`
- API test: `tests/api/insights.test.ts`

- [ ] **Step 1: Write the failing malformed-response test.**

```ts
it("shows an error for a malformed aggregate instead of an empty success", async () => {
  fetchMock.mockResolvedValue(okResponse({ totals: "bad" }));
  renderAt("/insights");
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not|error/i);
  expect(screen.queryByText(/no insights/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/Insights.test.tsx tests/api/insights.test.ts`

Keep one aggregate read, local tabs/links, and explicit retry. Preserve last-known-good data on a failed refresh and never convert malformed data to zero-valued success.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Insights.tsx src/__tests__/Insights.test.tsx tests/api/insights.test.ts
git commit -m "fix: preserve honest insights snapshot states"
```

### Task 35: `/chat` current-thread snapshot and send reconciliation

**Files:**
- Modify: `src/pages/UserChat.tsx:88-205,207-357,359-617`
- Test: `src/__tests__/UserChat.test.tsx:1-617`
- API test: `tests/api/inbox-admin-reply.test.ts`

- [ ] **Step 1: Write the failing no-passive-reload test.**

```ts
it("does not reload the active thread on a quiet event or visibility change", async () => {
  renderAt("/chat");
  await screen.findByText("Existing message");
  const before = readCalls();
  emitRealtimeEvent("chat_messages", { eventType: "INSERT", new: { id: "other" } });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(readCalls()).toEqual(before);
});

it("never replays an ambiguous send", async () => {
  fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
  renderAt("/chat");
  await user.type(screen.getByRole("textbox", { name: /message/i }), "hello");
  await user.click(screen.getByRole("button", { name: /send/i }));
  expect(queuedCount()).toBe(0);
  expect(screen.getByRole("alert")).toHaveTextContent(/could not send|try again/i);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/UserChat.test.tsx tests/api/inbox-admin-reply.test.ts`

Load the inbox/current thread once. Remove the default Realtime subscription and any fallback/visibility reload. Mark-read is an explicit write. Send/upload/AI toggle/read-aloud/dictation/triage note remain available; successful send merges only the returned message/reply, and a timeout is never replayed.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/UserChat.tsx src/__tests__/UserChat.test.tsx tests/api/inbox-admin-reply.test.ts
git commit -m "fix: stabilize user chat snapshot and sends"
```

### Task 36: `/settings` owner-scoped preferences and truthful storage state

**Files:**
- Modify: `src/pages/Settings.tsx:48-200,239-894`
- Test: `src/__tests__/Settings.test.tsx` (create if absent)
- API test: `tests/api/notify-prefs.test.ts`
- Security test: `tests/api/authorization.test.ts`

- [ ] **Step 1: Write failing owner/cross-user tests.**

```ts
it("reads the current owner preference scope", async () => {
  fetchMock.mockResolvedValueOnce(okResponse({ email_enabled: true, phone_enabled: false }));
  renderAt("/settings");
  expect(await screen.findByText(/email notifications/i)).toBeInTheDocument();
  expect(fetchMock.mock.calls[0][0]).not.toContain("user_id=other");
});

it("does not save a preference after a rejected server response", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse(403, { error: "Forbidden" }));
  renderAt("/settings");
  await user.click(screen.getByRole("button", { name: /save/i }));
  expect(screen.getByRole("alert")).toHaveTextContent(/could not|permission/i);
});
```

- [ ] **Step 2: Run the client/API tests.**

Run: `npm test -- src/__tests__/Settings.test.tsx tests/api/notify-prefs.test.ts tests/api/authorization.test.ts`

- [ ] **Step 3: Enforce owner scope and server-normalized writes.**

`GET /api/notify-prefs` must derive the owner from the authenticated request or verify the requested `user_id`; reject cross-user, missing-identity, and malformed-identity reads. Replace the current test expectation that authorizes disclosure. Save channel/welcome/display/profile state from the server-normalized response, keep local display/theme/tutorial controls, and do not reload the entire settings page after save. Preserve export and photo deletion actions.

- [ ] **Step 4: Run and commit.**

Run: `npm test -- src/__tests__/Settings.test.tsx tests/api/notify-prefs.test.ts tests/api/authorization.test.ts`

```bash
git add src/pages/Settings.tsx api/_notify-prefs.js src/__tests__/Settings.test.tsx tests/api/notify-prefs.test.ts tests/api/authorization.test.ts
git commit -m "fix: scope notification preferences to their owner"
```

### Task 37: `/notifications` local AppContext snapshot

**Files:**
- Modify: `src/pages/Notifications.tsx:77-249`
- Test: `src/__tests__/Notifications.test.tsx:1-96`
- Test: `src/__tests__/AppContextCore.test.tsx:1-947`

- [ ] **Step 1: Write the failing no-page-read test.**

```ts
it("filters the AppContext snapshot without issuing a page request", async () => {
  renderAt("/notifications");
  await screen.findByText("Pending");
  const before = readCalls();
  await user.click(screen.getByRole("checkbox", { name: /unread/i }));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/Notifications.test.tsx src/__tests__/AppContextCore.test.tsx`

Keep page-local filter/read controls, mark-all-read, clear, grouping, and links. The page must not call a read on mount, visibility, or a passive event. Writes use the AppContext reconciliation path and preserve the prior snapshot on failure.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/Notifications.tsx src/__tests__/Notifications.test.tsx src/__tests__/AppContextCore.test.tsx
git commit -m "test: cover local notifications snapshot"
```

### Task 38: fallback route

**Files:**
- Modify: `src/pages/NotFound.tsx:5-102`
- Test: `src/__tests__/NotFound.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing real-404 assertion.**

```ts
it("renders the actual not-found content", async () => {
  renderAt("/does-not-exist");
  expect(await screen.findByRole("heading", { name: /not found|404/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
});
```

- [ ] **Step 2: Run, preserve static content, and rerun.**

Run: `npm test -- src/__tests__/NotFound.test.tsx`

- [ ] **Step 3: Commit.**

```bash
git add src/pages/NotFound.tsx src/__tests__/NotFound.test.tsx
git commit -m "test: cover fallback route"
```

## Admin Tab Tasks

Each task below preserves the existing component and all controls. A successful action must patch only its target; a failed action leaves the last-known-good row visible; every tab has one bounded initial load and an explicit Refresh/Retry where data is present. `agent-chat` and `ops-center` are explicit capability tasks and must not be hidden by the 15-primary navigation decision.

### Task 39: `dashboard` / Overview

**Files:**
- Modify: `src/pages/admin/Overview.tsx:74-81,198-328,335-365,629-636,820-1920`
- Test: `src/__tests__/Overview.test.tsx:1-626`
- Test: `src/__tests__/dashboard-widgets.test.tsx:1-260`
- API tests: `tests/api/ops-events.test.ts`, `tests/api/performance.test.ts`

- [ ] **Step 1: Add failing dashboard budget and partial-failure tests.**

```ts
it("loads each dashboard source once and keeps successful sources when one fails", async () => {
  renderAt("/admin?tab=dashboard");
  await screen.findByText("Posts");
  fetchMock.mockRejectedValueOnce(new Error("reports unavailable"));
  await user.click(screen.getByRole("button", { name: /refresh/i }));
  expect(screen.getByText("Posts")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/reports.*unavailable|could not load/i);
});

it("does not patch a dashboard row through a list reload after status action", async () => {
  renderAt("/admin?tab=dashboard");
  await screen.findByText("Open report");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /verified/i }));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run the focused tests and verify current source fan-out fails.**

Run: `npm test -- src/__tests__/Overview.test.tsx src/__tests__/dashboard-widgets.test.tsx tests/api/ops-events.test.ts tests/api/performance.test.ts`

Expected before implementation: `src/pages/admin/Overview.tsx:230-303` and the source effects can issue overlapping loads, and a status action still reaches a list loader.

- [ ] **Step 3: Implement the bounded attention dashboard.**

Load at most eight independent sources once: bounded summary, alerts, system health, users, posts, comments, polls, and vitals. Use `Promise.allSettled` with a named partial-failure state; a failed source must not turn successful sources into empty. Remove all source timers, visibility refreshes, Realtime list reloads, and duplicate health calls. Keep the attention order from the admin redesign: critical/high alerts, failed actions, reports, moderation, inbox, automation/provider saturation, system degradation, then routine trends.

- [ ] **Step 4: Reconcile dashboard actions locally.**

Status changes, report triage, announcement actions, and alert acknowledgement patch the returned post/report/announcement/alert record. Preserve export, print, navigation, filters, selected report detail, and explicit Refresh. The source that owns the row is updated in place; unrelated sources are not fetched again.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/Overview.test.tsx src/__tests__/dashboard-widgets.test.tsx tests/api/ops-events.test.ts tests/api/performance.test.ts`

```bash
git add src/pages/admin/Overview.tsx src/__tests__/Overview.test.tsx src/__tests__/dashboard-widgets.test.tsx tests/api/ops-events.test.ts tests/api/performance.test.ts
git commit -m "fix: bound dashboard sources and reconcile attention actions"
```

### Task 40: `agent-chat` / AI Coworker

**Files:**
- Modify: `src/pages/admin/AgentChat.tsx:109-357`
- Modify: `src/pages/admin/agent-chat/ActionCard.tsx:1-239`
- Modify: `src/pages/admin/agent-chat/ActionPreviews.tsx:1-260`
- Test: `src/__tests__/AdminAgentChat.test.tsx:1-198`
- Test: `src/__tests__/ActionCardEvidence.test.tsx:1-137`
- API tests: `tests/api/agent-chat-response.test.ts`, `tests/api/agent-actions.test.ts`, `tests/api/agent-approve-guard.test.ts`

- [ ] **Step 1: Add failing capability-outcome tests.**

```ts
it("loads sessions once and patches the action card from approve result", async () => {
  renderAt("/admin?tab=agent-chat");
  await screen.findByText("Approve moderation");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /approve/i }));
  expect(await screen.findByText("Approved")).toBeInTheDocument();
  expect(readCalls()).toEqual(before);
});

it("keeps an awaiting-human action visible when execution fails", async () => {
  renderAt("/admin?tab=agent-chat");
  await user.click(screen.getByRole("button", { name: /execute/i }));
  expect(await screen.findByText(/failed|needs attention/i)).toBeInTheDocument();
  expect(screen.getByText("Approve moderation")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests.**

Run: `npm test -- src/__tests__/AdminAgentChat.test.tsx src/__tests__/ActionCardEvidence.test.tsx tests/api/agent-chat-response.test.ts tests/api/agent-actions.test.ts tests/api/agent-approve-guard.test.ts`

- [ ] **Step 3: Keep the capability contract and make it on-demand.**

Load ops status, sessions, and selected history once. Keep send, action preview, approve, execute, reject, and session selection. Automatic and manual execution paths must use the same `CapabilityStatus` fields (`capabilityId`, `executionMode`, `state`, `attempts`, `nextRetryAt`, `requestId`, `safeErrorCode`, `auditEventId`) and must not create a second hidden implementation. Remove passive page polling; action results patch the action card, session status, and local history only.

- [ ] **Step 4: Preserve authorization and honest failures.**

Do not render a successful execution before the API response. Failed provider/tool calls show a safe error and retain the prior card state. Keep the explicit Refresh and session-selection read boundary. Do not expose raw provider errors, SQL, claim tokens, or message bodies.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/AdminAgentChat.test.tsx src/__tests__/ActionCardEvidence.test.tsx tests/api/agent-chat-response.test.ts tests/api/agent-actions.test.ts tests/api/agent-approve-guard.test.ts`

```bash
git add src/pages/admin/AgentChat.tsx src/pages/admin/agent-chat/ActionCard.tsx src/pages/admin/agent-chat/ActionPreviews.tsx src/__tests__/AdminAgentChat.test.tsx src/__tests__/ActionCardEvidence.test.tsx tests/api/agent-chat-response.test.ts tests/api/agent-actions.test.ts tests/api/agent-approve-guard.test.ts
git commit -m "fix: keep AI Coworker capability outcomes authoritative"
```

### Task 41: `ops-center` / workforce operations

**Files:**
- Modify: `src/pages/admin/OpsCenter.tsx:530-811,833-2024`
- Test: `src/__tests__/OpsCenter.test.tsx:1-969`
- API tests: `tests/api/workforce.test.ts`, `tests/api/workforce-automation.test.ts`, `tests/api/workforce-pause-resume.test.ts`, `tests/api/workforce-ops-health.test.ts`, `tests/api/agent-cron-registry.test.ts`

- [ ] **Step 1: Add failing manual/automatic capability tests.**

```ts
it("loads the bounded ops snapshot once and patches a worker after manual run", async () => {
  renderAt("/admin?tab=ops-center");
  await screen.findByText("Automation registry");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /run.*worker|run/i }));
  expect(await screen.findByText(/queued|running|succeeded/i)).toBeInTheDocument();
  expect(readCalls()).toEqual(before);
});

it("keeps pause/resume and approval controls on the same capability state", async () => {
  renderAt("/admin?tab=ops-center");
  await user.click(screen.getByRole("button", { name: /pause/i }));
  expect(await screen.findByText(/paused/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests.**

Run: `npm test -- src/__tests__/OpsCenter.test.tsx tests/api/workforce.test.ts tests/api/workforce-automation.test.ts tests/api/workforce-pause-resume.test.ts tests/api/workforce-ops-health.test.ts tests/api/agent-cron-registry.test.ts`

- [ ] **Step 3: Keep the operations snapshot on explicit boundaries.**

Load ops summary, scorecard bounded to 500 rows, briefing, and automation registry once. Preserve run worker, patrol, pause/resume, acknowledge, retry, approve, ask agent, links to reports/suggestions/polls, and manual operator actions. Remove `useSmartPoll`/visibility refresh and any timer that reloads the full page. The automatic cron path and manual button path must call the same worker/capability implementation and return the same state shape.

- [ ] **Step 4: Reconcile capability actions and safe diagnostics.**

Patch only the affected worker, task, alert, scorecard row, or briefing state from the response. Keep queue depth, attempts, next retry, saturation, dead-letter detail, request/job IDs, and audit fields authorized and bounded. Do not replace a failed summary with `[]` or fabricate a completed run.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/OpsCenter.test.tsx tests/api/workforce.test.ts tests/api/workforce-automation.test.ts tests/api/workforce-pause-resume.test.ts tests/api/workforce-ops-health.test.ts tests/api/agent-cron-registry.test.ts`

```bash
git add src/pages/admin/OpsCenter.tsx src/__tests__/OpsCenter.test.tsx tests/api/workforce.test.ts tests/api/workforce-automation.test.ts tests/api/workforce-pause-resume.test.ts tests/api/workforce-ops-health.test.ts tests/api/agent-cron-registry.test.ts
git commit -m "fix: preserve Ops Center manual and automatic controls"
```

### Task 42: `system-health` / System Health

**Files:**
- Modify: `src/pages/admin/SystemHealth.tsx:73-141,210-277`
- Test: `src/__tests__/SystemHealth.test.tsx` (create if absent)
- API test: `tests/api/ops-events.test.ts`

- [ ] **Step 1: Write the failing health-state test.**

```ts
it("keeps unknown/error when health read fails and refreshes only on click", async () => {
  fetchMock.mockRejectedValueOnce(new Error("health unavailable"));
  renderAt("/admin?tab=system-health");
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not|unavailable/i);
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /refresh/i }));
  expect(readCalls().length).toBeGreaterThan(before);
  expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/SystemHealth.test.tsx tests/api/ops-events.test.ts`

Load one health snapshot on entry. Preserve node selection/details and explicit Refresh. Remove the 30-second interval and visibility/Reatime fallback. A failed read uses `unknown` or `error` and never renders a healthy zero.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/SystemHealth.tsx src/__tests__/SystemHealth.test.tsx tests/api/ops-events.test.ts
git commit -m "fix: make system health explicit and honest"
```

### Task 43: `performance` / Performance Center

**Files:**
- Modify: `src/pages/admin/PerformanceCenter.tsx:89-163,251-373`
- Test: `src/__tests__/PerformanceCenter.test.tsx` (create if absent)
- API tests: `tests/api/performance.test.ts`, `tests/api/vitals.test.ts`

- [ ] **Step 1: Write the failing percentile and stability test.**

```ts
it("loads performance and vitals once and preserves percentile display", async () => {
  renderAt("/admin?tab=performance");
  expect(await screen.findByText("p95")).toBeInTheDocument();
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /vital|lcp/i }));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/PerformanceCenter.test.tsx tests/api/performance.test.ts tests/api/vitals.test.ts`

Load performance and vitals once, preserve real percentile values and vital selection, and keep explicit Refresh/Retry. Remove the raw interval, Realtime fallback, duplicate loads, and false zero values after failure.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/PerformanceCenter.tsx src/__tests__/PerformanceCenter.test.tsx tests/api/performance.test.ts tests/api/vitals.test.ts
git commit -m "fix: keep performance metrics on explicit refresh"
```

### Task 44: `security` / Security Center

**Files:**
- Modify: `src/pages/admin/SecurityCenter.tsx:64-142,175-256`
- Test: `src/__tests__/SecurityCenter.test.tsx` (create if absent)
- API test: `tests/api/security.test.ts`

- [ ] **Step 1: Write the failing failure-to-empty test.**

```ts
it("keeps the last security events visible when a refresh fails", async () => {
  renderAt("/admin?tab=security");
  await screen.findByText("Critical event");
  fetchMock.mockRejectedValueOnce(new Error("security read failed"));
  await user.click(screen.getByRole("button", { name: /refresh/i }));
  expect(screen.getByText("Critical event")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/could not|stale/i);
});
```

- [ ] **Step 2: Run and implement the explicit snapshot.**

Run: `npm test -- src/__tests__/SecurityCenter.test.tsx tests/api/security.test.ts`

Load at most 100 security events once. Preserve refresh, search, severity filters, last-update timestamp, and honest stale/error state. Remove the `settings` Realtime subscription at `src/pages/admin/SecurityCenter.tsx:90`; do not turn a failed read into `[]`.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/SecurityCenter.tsx src/__tests__/SecurityCenter.test.tsx tests/api/security.test.ts
git commit -m "fix: preserve security events on failed refresh"
```

### Task 45: `activity-stream` / Activity Stream

**Files:**
- Modify: `src/pages/admin/ActivityStream.tsx:76-229`
- Test: `src/__tests__/ActivityStream.test.tsx:1-125`
- API test: `tests/api/ops-events.test.ts`

- [ ] **Step 1: Write the failing bounded-stale test.**

```ts
it("keeps the last activity events visible when the bounded read fails", async () => {
  renderAt("/admin?tab=activity-stream");
  await screen.findByText("Worker completed");
  fetchMock.mockRejectedValueOnce(new Error("activity unavailable"));
  await user.click(screen.getByRole("button", { name: /refresh/i }));
  expect(screen.getByText("Worker completed")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/could not load|stale/i);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/ActivityStream.test.tsx tests/api/ops-events.test.ts`

Load no more than 100 ops-summary-derived events once. Preserve refresh, search, severity filters, links, and last-update state. Remove the polling-only hook, visibility refresh, and failure-to-empty conversion.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/ActivityStream.tsx src/__tests__/ActivityStream.test.tsx tests/api/ops-events.test.ts
git commit -m "fix: stabilize bounded activity stream"
```

### Task 46: `reports` / Reports, pre-review, approvals, and appeals

**Files:**
- Modify: `src/pages/admin/Reports.tsx:195-240,727-1170,1296-2286`
- Modify: `src/components/admin/WorkItem.tsx:168-272`
- Test: `src/__tests__/Reports.test.tsx:1-453`
- Test: `src/__tests__/WorkItem.test.tsx` (create if absent)
- Test: `src/__tests__/AppealPanel.test.tsx:1-81`
- API tests: `tests/api/reports.test.ts`, `tests/api/appeals.test.ts`, `tests/api/pre-publish-review.test.ts`, `tests/api/bulk-operations-reports.test.ts`

- [ ] **Step 1: Write failing action and heavy-scan tests.**

```ts
it("does not reload any report queue after resolving one report", async () => {
  renderAt("/admin?tab=reports");
  await screen.findByText("Reported post");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /resolve/i }));
  expect(readCalls()).toEqual(before);
  expect(await screen.findByText("Resolved")).toBeInTheDocument();
});

it("does not start the heavy AI review scan until the review desk is opened", async () => {
  renderAt("/admin?tab=reports");
  expect(fetchMock.mock.calls.some(([p]) => String(p).includes("all_posts"))).toBe(false);
  await user.click(screen.getByRole("tab", { name: /ai review/i }));
  expect(fetchMock.mock.calls.some(([p]) => String(p).includes("all_posts"))).toBe(true);
});
```

- [ ] **Step 2: Run the focused reports tests.**

Run: `npm test -- src/__tests__/Reports.test.tsx src/__tests__/WorkItem.test.tsx src/__tests__/AppealPanel.test.tsx tests/api/reports.test.ts tests/api/appeals.test.ts tests/api/pre-publish-review.test.ts tests/api/bulk-operations-reports.test.ts`

Expected before implementation: `src/pages/admin/Reports.tsx:820-877` has a 60-second scan/reload path and action handlers call `load`/`refreshAll`.

- [ ] **Step 3: Split fast queues from the explicit heavy review desk.**

Load bounded reports, pre-review items, approvals, and appeals once. Do not scan all posts until the user enters the AI Review desk, and cap that scan server-side. Remove the 15-second timer, 60-second scan, Realtime full-queue reload, and action-triggered `load`. Explicit Refresh re-reads only the current desk/filter.

- [ ] **Step 4: Reconcile every report action.**

Resolve, group resolve, escalate, warn, suspend, ban, approve, reject, publish, keep-private, reject-pre-review, appeal uphold/overturn, delete, comment, and post/comment moderation patch the affected row, group, queue, or work item from the response. `WorkItem` may reload only its own bounded timeline if the action response explicitly lacks the timeline; it must not reload the whole Reports page. Failed actions preserve the prior row and verification evidence.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/Reports.test.tsx src/__tests__/WorkItem.test.tsx src/__tests__/AppealPanel.test.tsx tests/api/reports.test.ts tests/api/appeals.test.ts tests/api/pre-publish-review.test.ts tests/api/bulk-operations-reports.test.ts`

```bash
git add src/pages/admin/Reports.tsx src/components/admin/WorkItem.tsx src/__tests__/Reports.test.tsx src/__tests__/WorkItem.test.tsx src/__tests__/AppealPanel.test.tsx tests/api/reports.test.ts tests/api/appeals.test.ts tests/api/pre-publish-review.test.ts tests/api/bulk-operations-reports.test.ts
git commit -m "fix: bound report queues and reconcile review actions"
```

### Task 47: `posts` / Admin Feed table

**Files:**
- Modify: `src/pages/admin/PostsTable.tsx:93-165,201-377,415-657,707-805,847-1181,1249-2526`
- Test: `src/__tests__/PostsTable.test.tsx:1-983`
- API tests: `tests/api/posts-full.test.ts`, `tests/api/admin-export.test.ts`, `tests/api/bulk-operations-reports.test.ts`

- [ ] **Step 1: Write failing explicit-pagination and row-action tests.**

```ts
it("does not auto-drain ten pages and patches one row after update", async () => {
  renderAt("/admin?tab=posts");
  await screen.findByText("Post one");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock.mock.calls.filter(([p]) => String(p).includes("cursor="))).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: /hide/i }));
  expect(fetchMock.mock.calls.filter(([p]) => String(p).includes("/api/posts"))).toHaveLength(1);
});
```

- [ ] **Step 2: Run the focused table tests.**

Run: `npm test -- src/__tests__/PostsTable.test.tsx tests/api/posts-full.test.ts tests/api/admin-export.test.ts tests/api/bulk-operations-reports.test.ts`

- [ ] **Step 3: Enforce bounded cursor pagination and targeted reconciliation.**

Keep the server cursor and stable filters. Remove `AUTO_LOAD_PAGES`, passive `useRealtime`, and the 10-page drain. Search, status/category/priority/date changes are explicit query boundaries. Update, hard-delete, merge, poll conversion, bulk delete, restore, hide, official, lock, archive, report, message-author, and export actions patch only the affected row or selected IDs. Keep tombstone protection and explicit export cursor walking on click.

- [ ] **Step 4: Preserve operator safety and states.**

Keep selection, bulk confirmation, merge target, poll conversion, author messaging, filter persistence, keyboard row focus, mobile stacked rows, stale/error banners, and last-known-good rows. A partial bulk result reports succeeded and failed IDs without silently converting the table to empty.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/PostsTable.test.tsx tests/api/posts-full.test.ts tests/api/admin-export.test.ts tests/api/bulk-operations-reports.test.ts`

```bash
git add src/pages/admin/PostsTable.tsx src/__tests__/PostsTable.test.tsx tests/api/posts-full.test.ts tests/api/admin-export.test.ts tests/api/bulk-operations-reports.test.ts
git commit -m "fix: bound admin post pagination and row actions"
```

### Task 48: `users` / User Manager

**Files:**
- Modify: `src/pages/admin/UserManager.tsx:56-147,202-565`
- Test: `src/__tests__/UserManager.test.tsx:1-537`
- API tests: `tests/api/users.test.ts`, `tests/api/admin-revoke-sessions-authz.test.ts`

- [ ] **Step 1: Write failing detail and action tests.**

```ts
it("loads a user page once, fetches detail only on selection, and patches a warning locally", async () => {
  renderAt("/admin?tab=users");
  await screen.findByText("anon-1");
  await user.click(screen.getByRole("button", { name: /anon-1/i }));
  expect(await screen.findByText(/warning/i)).toBeInTheDocument();
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /warn/i }));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/UserManager.test.tsx tests/api/users.test.ts tests/api/admin-revoke-sessions-authz.test.ts`

Keep the 30-row cursor page, explicit next-page control, on-demand bounded detail, search, warn, spam action, suspend, ban, revoke, message author, and authorization. User actions patch both summary and selected detail from the returned record; they do not reset the list. A superseded detail response is ignored.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/UserManager.tsx src/__tests__/UserManager.test.tsx tests/api/users.test.ts tests/api/admin-revoke-sessions-authz.test.ts
git commit -m "fix: bound user manager and reconcile account actions"
```

### Task 49: `categories` / Category management

**Files:**
- Modify: `src/pages/admin/Categories.tsx:9-73`
- Test: `src/__tests__/AdminCategories.test.tsx:1-120`
- API test: `tests/api/categories.test.ts`

- [ ] **Step 1: Write the failing server-echo test.**

```ts
it("uses the server category list after add/remove/reset without a second list read", async () => {
  renderAt("/admin?tab=categories");
  await screen.findByText("Academics");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /add/i }));
  await user.type(screen.getByLabelText(/category/i), "Physics");
  await user.click(screen.getByRole("button", { name: /save|add/i }));
  expect(readCalls()).toEqual(before);
  expect(await screen.findByText("Physics")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/AdminCategories.test.tsx tests/api/categories.test.ts`

Load one normalized list. Add, remove, and reset replace the list with the server response; no success action calls the list loader. Preserve the default-category safety check, admin authorization, keyboard form labels, and honest error state.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/Categories.tsx src/__tests__/AdminCategories.test.tsx tests/api/categories.test.ts
git commit -m "fix: reconcile admin categories from server echo"
```

### Task 50: `polls` / Poll Manager

**Files:**
- Modify: `src/pages/admin/PollManager.tsx:10-75,85-223`
- Test: `src/__tests__/PollManager.test.tsx:1-260`
- API tests: `tests/api/polls-full.test.ts`, `tests/api/poll-close.test.ts`

- [ ] **Step 1: Write the failing no-realtime-refresh test.**

```ts
it("does not reload the poll list after create/archive and keeps the row", async () => {
  renderAt("/admin?tab=polls");
  await screen.findByText("Poll one");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /archive/i }));
  expect(readCalls()).toEqual(before);
  expect(screen.getByText("Poll one")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/PollManager.test.tsx tests/api/polls-full.test.ts tests/api/poll-close.test.ts`

Load one bounded poll list. Remove the `useRealtime(["polls", "poll_votes"], () => load(), 2500)` call. Create, archive, restore, and delete patch the returned poll or confirmed ID. Preserve poll type/options controls and true empty/error states.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/PollManager.tsx src/__tests__/PollManager.test.tsx tests/api/polls-full.test.ts tests/api/poll-close.test.ts
git commit -m "fix: reconcile admin poll actions locally"
```

### Task 51: `inbox` / Unified Inbox

**Files:**
- Modify: `src/pages/admin/UnifiedInbox.tsx:368-616,637-900,916-1352`
- Test: `src/__tests__/UnifiedInbox.test.tsx:1-543`
- Test: `src/__tests__/UnifiedInboxAutoSummary.test.tsx:1-160`
- API tests: `tests/api/inbox-admin-reply.test.ts`, `tests/api/inbox-triage.test.ts`, `tests/api/inbox-summaries.test.ts`, `tests/api/inbox-classify.test.ts`

- [ ] **Step 1: Write failing active-thread and action tests.**

```ts
it("loads thread lists once and the active thread only on selection", async () => {
  renderAt("/admin?tab=inbox");
  await screen.findByText("Thread one");
  expect(readCalls().some((p) => p.includes("thread_id=thread-1"))).toBe(false);
  await user.click(screen.getByRole("button", { name: /thread one/i }));
  expect(await screen.findByText("Existing reply")).toBeInTheDocument();
});

it("does not reload lists or messages after takeover", async () => {
  renderAt("/admin?tab=inbox");
  await screen.findByText("Thread one");
  await user.click(screen.getByRole("button", { name: /thread one/i }));
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /takeover/i }));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run the focused inbox tests.**

Run: `npm test -- src/__tests__/UnifiedInbox.test.tsx src/__tests__/UnifiedInboxAutoSummary.test.tsx tests/api/inbox-admin-reply.test.ts tests/api/inbox-triage.test.ts tests/api/inbox-summaries.test.ts tests/api/inbox-classify.test.ts`

Expected before implementation: Realtime thread/message callbacks and action handlers can reload lists/messages.

- [ ] **Step 3: Keep the active-thread lifecycle explicit.**

Load AI mode, inbox/chat thread lists, and config once. Selecting a thread is an explicit read boundary; no passive event, visibility event, or failed socket reloads it. Preserve send, takeover, release, transfer, status, delete, export, summarize, suggest, new-thread, search, and keyboard shortcuts.

- [ ] **Step 4: Reconcile thread actions and AI outputs locally.**

Send/action responses patch the active thread and its summary in the list. Summarize/suggest responses attach to the active thread and do not reload every thread. Failed actions preserve the prior message list and show an honest error. Keep the active source (`chat` versus `inbox`) and authorization checks.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/UnifiedInbox.test.tsx src/__tests__/UnifiedInboxAutoSummary.test.tsx tests/api/inbox-admin-reply.test.ts tests/api/inbox-triage.test.ts tests/api/inbox-summaries.test.ts tests/api/inbox-classify.test.ts`

```bash
git add src/pages/admin/UnifiedInbox.tsx src/__tests__/UnifiedInbox.test.tsx src/__tests__/UnifiedInboxAutoSummary.test.tsx tests/api/inbox-admin-reply.test.ts tests/api/inbox-triage.test.ts tests/api/inbox-summaries.test.ts tests/api/inbox-classify.test.ts
git commit -m "fix: stabilize admin inbox active-thread lifecycle"
```

### Task 52: `errors` / Error Tracking

**Files:**
- Modify: `src/pages/admin/ErrorTracking.tsx:95-236,303-600`
- Test: `src/__tests__/ErrorTracking.test.tsx:1-363`
- API tests: `tests/api/errors-authz.test.ts`, `tests/api/schema-contract.test.ts`

- [ ] **Step 1: Write failing bounded-source and test-error tests.**

```ts
it("does not poll frontend errors and never claims a test error succeeded without a DSN", async () => {
  renderAt("/admin?tab=errors");
  await screen.findByText("Health");
  const before = readCalls();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(readCalls()).toEqual(before);
  await user.click(screen.getByRole("button", { name: /test error/i }));
  expect(await screen.findByText(/DSN is not configured|nothing was sent/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/ErrorTracking.test.tsx tests/api/errors-authz.test.ts tests/api/schema-contract.test.ts`

Load health, chunk manifest, audit page bounded to 100, and frontend error page once. Preserve Refresh all, filters, links, and the explicit test-error action. Remove the frontend-error poll and audit Realtime reload. A failed source remains visible as stale/error; the test-error button reports missing DSN honestly.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/ErrorTracking.tsx src/__tests__/ErrorTracking.test.tsx tests/api/errors-authz.test.ts tests/api/schema-contract.test.ts
git commit -m "fix: keep error diagnostics explicit and bounded"
```

### Task 53: `logs` / Audit and agent logs

**Files:**
- Modify: `src/pages/admin/Logs.tsx:158-225,253-547`
- Test: `src/__tests__/Logs.test.tsx:1-326`
- API tests: `tests/api/admin-audit-reads.test.ts`, `tests/api/workforce.test.ts`

- [ ] **Step 1: Write failing explicit-tab/pagination tests.**

```ts
it("loads audit and agent sources only when their explicit tab asks for them", async () => {
  renderAt("/admin?tab=logs");
  await screen.findByText("Audit log");
  expect(fetchMock.mock.calls.some(([p]) => String(p).includes("agent"))).toBe(false);
  await user.click(screen.getByRole("tab", { name: /agents/i }));
  expect(fetchMock.mock.calls.some(([p]) => String(p).includes("agent"))).toBe(true);
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /load more/i }));
  expect(readCalls().length).toBeGreaterThan(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/Logs.test.tsx tests/api/admin-audit-reads.test.ts tests/api/workforce.test.ts`

Keep audit cursor pagination at 30 and agent activity bounded to 200. Tabs, filters, explicit refresh, export, verification receipts, and load-more are user boundaries. Remove 30-second agent polling and visibility refresh; switching tabs may load the selected source once, but no event reloads the current snapshot.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/Logs.tsx src/__tests__/Logs.test.tsx tests/api/admin-audit-reads.test.ts tests/api/workforce.test.ts
git commit -m "fix: make admin logs pagination explicit"
```

### Task 54: `email-templates` / Email templates

**Files:**
- Modify: `src/pages/admin/EmailTemplates.tsx:73-380`
- Test: `src/__tests__/EmailTemplates.test.tsx` (create if absent)
- API tests: `tests/api/email-templates-auth.test.ts`, `tests/api/email-integration.test.ts`

- [ ] **Step 1: Write the failing normalized-save test.**

```ts
it("patches the selected template from the save response without a list read", async () => {
  renderAt("/admin?tab=email-templates");
  await screen.findByText("Welcome");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /edit/i }));
  await user.click(screen.getByRole("button", { name: /save/i }));
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/EmailTemplates.test.tsx tests/api/email-templates-auth.test.ts tests/api/email-integration.test.ts`

Load one template list. Preserve select, preview, edit, save, test send, authorization, validation, and error states. Save replaces the selected template or normalized list from the response; it does not refetch. Test send is an explicit action and cannot claim delivery without a server result.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/EmailTemplates.tsx src/__tests__/EmailTemplates.test.tsx tests/api/email-templates-auth.test.ts tests/api/email-integration.test.ts
git commit -m "fix: reconcile email template saves locally"
```

### Task 55: `settings` / Admin settings and provider controls

**Files:**
- Modify: `src/pages/admin/AdminSettings.tsx:14-200`
- Modify: `src/pages/admin/ProviderSettings.tsx:95-273,345-665`
- Test: `src/__tests__/AdminSettings.test.tsx:1-308`
- Test: `src/__tests__/ProviderSettings.test.tsx:1-340`
- API tests: `tests/api/admin-settings.test.ts`, `tests/api/providers.test.ts`, `tests/api/providers-authz.test.ts`, `tests/api/provider-degraded.test.ts`

- [ ] **Step 1: Write failing provider-field reconciliation tests.**

```ts
it("patches one provider field after save without reloading all provider state", async () => {
  renderAt("/admin?tab=settings");
  await screen.findByText("OpenAI");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /save.*key|save/i }));
  expect(readCalls()).toEqual(before);
  expect(screen.getByText("OpenAI")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/AdminSettings.test.tsx src/__tests__/ProviderSettings.test.tsx tests/api/admin-settings.test.ts tests/api/providers.test.ts tests/api/providers-authz.test.ts tests/api/provider-degraded.test.ts`

Load auth mode, agent switch, spam config, provider list, and provider categories once. Preserve password changes, session revocation, provider test, default selection, key/model save, provider toggle, category toggle, degraded-provider state, and authorization. Every response patches the affected field/provider/category; no success action reloads all providers. Never expose provider secrets in state, errors, or tests.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/AdminSettings.tsx src/pages/admin/ProviderSettings.tsx src/__tests__/AdminSettings.test.tsx src/__tests__/ProviderSettings.test.tsx tests/api/admin-settings.test.ts tests/api/providers.test.ts tests/api/providers-authz.test.ts tests/api/provider-degraded.test.ts
git commit -m "fix: reconcile admin provider settings fields"
```

## Shared Interactive Component Tasks

These tasks are separate from route tasks because the same component is used by more than one surface. They must preserve optimistic rollback, accessible controls, and existing test IDs while removing parent list reloads.

### Task 56: `Comments` thread reconciliation and explicit retry

**Files:**
- Modify: `src/components/Comments.tsx:82-166,238-367`
- Test: `src/__tests__/Comments.gate.test.tsx:1-197`
- Rewrite: `src/__tests__/Comments.realtime.test.tsx:1-267`

- [ ] **Step 1: Write the failing local-thread test.**

```ts
it("appends, edits, deletes, and undoes a comment without reloading the thread", async () => {
  renderAt("/post/p1");
  await screen.findByText("First comment");
  const before = readCalls();
  await user.type(screen.getByRole("textbox", { name: /comment/i }), "Second");
  await user.click(screen.getByRole("button", { name: /send|comment/i }));
  expect(await screen.findByText("Second")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /delete/i }));
  expect(screen.queryByText("Second")).not.toBeInTheDocument();
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run and implement.**

Run: `npm test -- src/__tests__/Comments.gate.test.tsx src/__tests__/Comments.realtime.test.tsx`

Keep one initial thread read, explicit Retry, local append/edit/delete/undo, parent reply state, and keyboard/focus behavior. Remove event-triggered refetch and parent list reload. A failed mutation restores the prior comment and shows an error.

- [ ] **Step 3: Commit.**

```bash
git add src/components/Comments.tsx src/__tests__/Comments.gate.test.tsx src/__tests__/Comments.realtime.test.tsx
git commit -m "fix: reconcile comment thread mutations locally"
```

### Task 57: `PostCard` and `PostCardAdminBar` authoritative row state

**Files:**
- Modify: `src/components/PostCard.tsx:50-162,365-404`
- Modify: `src/components/PostCardAdminBar.tsx:15-75`
- Test: `src/__tests__/PostCard.test.tsx:1-238`
- Test: `src/__tests__/PostsTable.test.tsx:1-983`

- [ ] **Step 1: Write failing optimistic and admin-row tests.**

```ts
it("rolls back a failed reaction without changing siblings", async () => {
  fetchMock.mockRejectedValueOnce(new Error("reaction failed"));
  render(<PostCard post={postOne} onChanged={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /heart|react/i }));
  expect(screen.getByText("0")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/could not|try again/i);
});

it("patches the returned admin post rather than leaving a stale row", async () => {
  render(<PostCardAdminBar post={postOne} onPostChange={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /hide/i }));
  expect(onPostChange).toHaveBeenCalledWith(expect.objectContaining({ id: postOne.id, hidden: true }));
});
```

- [ ] **Step 2: Run and implement.**

Run: `npm test -- src/__tests__/PostCard.test.tsx src/__tests__/PostsTable.test.tsx`

Preserve the optimistic reaction pattern and rollback. Pass the authoritative post record from every admin action to the parent row setter. Do not call the parent loader after success. Keep reaction menus, admin controls, keyboard activation, and disabled/busy states.

- [ ] **Step 3: Commit.**

```bash
git add src/components/PostCard.tsx src/components/PostCardAdminBar.tsx src/__tests__/PostCard.test.tsx src/__tests__/PostsTable.test.tsx
git commit -m "fix: reconcile card and admin row mutations"
```

### Task 58: `PollCard` authoritative vote and shared countdown

**Files:**
- Modify: `src/components/PollCard.tsx:19-191`
- Modify: `src/components/PurgeCountdown.tsx:1-33`
- Test: `src/__tests__/PollCard.test.tsx:1-240`
- Test: `src/__tests__/shared-clock.test.tsx`

- [ ] **Step 1: Write failing vote/countdown tests.**

```ts
it("uses the server poll counts and one shared clock", async () => {
  render(<SharedClockProvider><PollCard poll={pollOne} /></SharedClockProvider>);
  await user.click(screen.getByRole("button", { name: /yes/i }));
  expect(await screen.findByText("1 vote")).toBeInTheDocument();
  expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run and implement.**

Run: `npm test -- src/__tests__/PollCard.test.tsx src/__tests__/shared-clock.test.tsx`

Use `useCountdown`, authoritative poll response, and the existing close notification. A failed vote restores the prior options/counts and never reloads a parent list.

- [ ] **Step 3: Commit.**

```bash
git add src/components/PollCard.tsx src/components/PurgeCountdown.tsx src/__tests__/PollCard.test.tsx src/__tests__/shared-clock.test.tsx
git commit -m "fix: use authoritative poll state and shared clock"
```

### Task 59: `WorkItem` bounded timeline and local action state

**Files:**
- Modify: `src/components/admin/WorkItem.tsx:168-272`
- Test: `src/__tests__/WorkItem.test.tsx` (create if absent)
- Test: `src/__tests__/Reports.test.tsx:1-453`

- [ ] **Step 1: Write the failing bounded-timeline test.**

```ts
it("does not overlap timeline reads and patches the work item after approve", async () => {
  render(<WorkItem item={workItem} />);
  await screen.findByText("Evidence");
  const before = readCalls();
  await user.click(screen.getByRole("button", { name: /approve/i }));
  expect(readCalls()).toEqual(before);
  expect(await screen.findByText("Approved")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/WorkItem.test.tsx src/__tests__/Reports.test.tsx`

Bound timeline history, prevent overlapping timeline loads, preserve evidence/retry/approval controls, and reload only the item's own timeline when an action response explicitly lacks it. Never reload the Reports queue.

- [ ] **Step 3: Commit.**

```bash
git add src/components/admin/WorkItem.tsx src/__tests__/WorkItem.test.tsx src/__tests__/Reports.test.tsx
git commit -m "fix: bound work item timeline and action state"
```

### Task 60: `PulseStrip` and dashboard widgets

**Files:**
- Modify: `src/components/admin/PulseStrip.tsx:56-97`
- Modify: `src/lib/dashboard/widgets.tsx:62-165`
- Test: `src/__tests__/dashboard-widgets.test.tsx:1-260`

- [ ] **Step 1: Write the failing deduplication/refresh test.**

```ts
it("loads each distinct source once and refreshes only on the explicit control", async () => {
  render(<PulseStrip sources={duplicateSources} />);
  await screen.findByText("Platform pulse");
  const before = readCalls();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(readCalls()).toEqual(before);
  await user.click(screen.getByRole("button", { name: /refresh/i }));
  expect(readCalls().length).toBeGreaterThan(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/dashboard-widgets.test.tsx`

Deduplicate identical source keys, remove the 60-second interval and `pollMs` data polling, preserve widget links/empty/error states, and make Refresh the only read boundary.

- [ ] **Step 3: Commit.**

```bash
git add src/components/admin/PulseStrip.tsx src/lib/dashboard/widgets.tsx src/__tests__/dashboard-widgets.test.tsx
git commit -m "fix: make dashboard pulse widgets explicit"
```

### Task 61: `ApprovalAlert` explicit pending-action refresh

**Files:**
- Modify: `src/pages/admin/agent-office/ApprovalAlert.tsx:31-128`
- Test: `src/__tests__/ApprovalAlert.test.tsx:1-140`

- [ ] **Step 1: Write the failing no-interval test.**

```ts
it("loads the approval queue once and does not refresh every twelve seconds", async () => {
  render(<ApprovalAlert />);
  await screen.findByText("Approval required");
  const before = readCalls();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(readCalls()).toEqual(before);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/ApprovalAlert.test.tsx`

Remove the 12-second interval and visibility check. Keep the initial queue, explicit pending-action Refresh, approve/reject controls, and authoritative local state. A failed action preserves the pending card.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/agent-office/ApprovalAlert.tsx src/__tests__/ApprovalAlert.test.tsx
git commit -m "fix: remove approval alert polling"
```

### Task 62: `ProviderSettings` and `QuickActions` local response reconciliation

**Files:**
- Modify: `src/pages/admin/ProviderSettings.tsx:95-273`
- Modify: `src/pages/admin/QuickActions.tsx:21-81`
- Test: `src/__tests__/ProviderSettings.test.tsx:1-340`
- Test: `src/__tests__/QuickActions.test.tsx:1-197`
- API tests: `tests/api/providers.test.ts`, `tests/api/announcement-write.test.ts`

- [ ] **Step 1: Write failing local-response tests.**

```ts
it("patches announcement state from the response and keeps triage callbacks intact", async () => {
  render(<QuickActions posts={posts} onStatusChange={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /publish/i }));
  expect(screen.getByText("Published announcement")).toBeInTheDocument();
  expect(readCalls().some((p) => p.includes("/api/posts"))).toBe(false);
});
```

- [ ] **Step 2: Run, implement, and rerun.**

Run: `npm test -- src/__tests__/ProviderSettings.test.tsx src/__tests__/QuickActions.test.tsx tests/api/providers.test.ts tests/api/announcement-write.test.ts`

Provider test/default/key/model/toggle/category actions patch only the affected provider or category. Announcement publish/clear patches the announcement object. Keep explicit Refresh, search, expanded groups, triage status callback, authorization, and honest errors.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/admin/ProviderSettings.tsx src/pages/admin/QuickActions.tsx src/__tests__/ProviderSettings.test.tsx src/__tests__/QuickActions.test.tsx tests/api/providers.test.ts tests/api/announcement-write.test.ts
git commit -m "fix: reconcile provider and announcement actions"
```

### Task 63: Exhaustive shared lifecycle contract scan

**Files:**
- Modify: `src/__tests__/page-lifecycle-contract.test.ts:1-71`
- Create: `src/__tests__/route-inventory-contract.test.ts`
- Create: `src/__tests__/admin-capability-contract.test.ts`

- [ ] **Step 1: Write static source assertions for forbidden passive loaders.**

```ts
it("has no default page-level recurring data loader in the routed surface set", () => {
  for (const file of routedSurfaceFiles) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source, file).not.toMatch(/setInterval\s*\([^)]*(load|refresh|fetch|poll)/i);
    expect(source, file).not.toMatch(/visibilitychange[\s\S]{0,300}(load|refresh|fetch)\s*\(/i);
  }
});

it("keeps both capability keys in every admin registry consumer", () => {
  for (const file of ["src/lib/adminTabs.ts", "src/pages/Admin.tsx", "src/components/admin/PageContext.jsx"]) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source, file).toContain("agent-chat");
    expect(source, file).toContain("ops-center");
  }
});
```

- [ ] **Step 2: Run and verify any remaining violations are listed explicitly.**

Run: `npm test -- src/__tests__/page-lifecycle-contract.test.ts src/__tests__/route-inventory-contract.test.ts src/__tests__/admin-capability-contract.test.ts`

- [ ] **Step 3: Fix only the listed owner task and rerun its focused suite.**

Do not hide a violation with a broad source allowlist, a test mock, or a comment. A timer that measures recorder duration, toast dismissal, focus, or a user-triggered retry is allowed only when it does not issue a page data read.

- [ ] **Step 4: Commit.**

```bash
git add src/__tests__/page-lifecycle-contract.test.ts src/__tests__/route-inventory-contract.test.ts src/__tests__/admin-capability-contract.test.ts
git commit -m "test: enforce exhaustive route and capability lifecycle contract"
```

### Task 64: Normalize automatic/manual capability and audit outcomes

**Files:**
- Create: `src/lib/capabilityStatus.ts`
- Modify: `src/pages/admin/AgentChat.tsx:109-357`
- Modify: `src/pages/admin/OpsCenter.tsx:530-811`
- Modify: `src/pages/admin/Overview.tsx:198-328`
- Test: `src/__tests__/capabilityStatus.test.ts` (create)
- Test: `src/__tests__/AdminAgentChat.test.tsx:1-198`
- Test: `src/__tests__/OpsCenter.test.tsx:1-969`
- Additional evidence: `tests/api/workforce.test.ts`, `tests/api/agent-actions.test.ts`, `tests/api/agent-cron-registry.test.ts`, `tests/api/workforce-automation.test.ts`, `src/__tests__/audit-report.test.ts`

**Interfaces:**
- Produces: `CapabilityStatus`, `ExecutionMode`, `CapabilityState`, `normalizeCapabilityStatus(value: unknown): CapabilityStatus`, and `isTerminalCapabilityState(state): boolean` matching the architecture contract.

- [ ] **Step 1: Write failing capability normalization tests.**

```ts
it("normalizes automatic and manual execution without inventing success", () => {
  expect(normalizeCapabilityStatus({ capabilityId: "worker-1", executionMode: "automatic", state: "running", attempts: 2 })).toMatchObject({
    capabilityId: "worker-1", executionMode: "automatic", state: "running", attempts: 2,
  });
  expect(normalizeCapabilityStatus({ capabilityId: "task-1", executionMode: "both", state: "awaiting_human" }).state).toBe("awaiting_human");
  expect(normalizeCapabilityStatus({ capabilityId: "task-2", executionMode: "manual", state: "unknown" }).state).toBe("failed");
});
```

- [ ] **Step 2: Run the focused tests and verify the normalizer is absent.**

Run: `npm test -- src/__tests__/capabilityStatus.test.ts src/__tests__/AdminAgentChat.test.tsx src/__tests__/OpsCenter.test.tsx tests/api/workforce.test.ts tests/api/agent-actions.test.ts tests/api/agent-cron-registry.test.ts tests/api/workforce-automation.test.ts src/__tests__/audit-report.test.ts`

- [ ] **Step 3: Implement one safe status normalizer.**

  Accept only the six approved states, preserve `requestId`, `auditEventId`, attempts, next retry, safe error code, execution mode, and capability ID. Unknown states become `failed` with a safe error code; they never become `succeeded`. Do not retain raw provider errors, SQL, claim tokens, or message bodies in the client status.

- [ ] **Step 4: Route all admin capability cards through it.**

  Agent Chat, Ops Center, Overview alerts, WorkItem, and approval actions must use the same state vocabulary and retain manual/automatic mode. A manual run, pause/resume, retry, approve, reject, cancel, or background worker transition patches the affected capability/audit row. No capability or worker is deleted because a page stopped polling.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/capabilityStatus.test.ts src/__tests__/AdminAgentChat.test.tsx src/__tests__/OpsCenter.test.tsx tests/api/workforce.test.ts tests/api/agent-actions.test.ts tests/api/agent-cron-registry.test.ts tests/api/workforce-automation.test.ts src/__tests__/audit-report.test.ts`

```bash
git add src/lib/capabilityStatus.ts src/pages/admin/AgentChat.tsx src/pages/admin/OpsCenter.tsx src/pages/admin/Overview.tsx src/__tests__/capabilityStatus.test.ts src/__tests__/AdminAgentChat.test.tsx src/__tests__/OpsCenter.test.tsx tests/api/workforce.test.ts tests/api/agent-actions.test.ts tests/api/agent-cron-registry.test.ts tests/api/workforce-automation.test.ts src/__tests__/audit-report.test.ts
git commit -m "fix: preserve capability and audit state semantics"
```

### Task 65: Correct notification-preference authorization and privacy boundaries

**Files:**
- Modify: `api/_notify-prefs.js:1-164`
- Modify: `src/pages/Settings.tsx:105-190`
- Modify: `src/pages/Privacy.tsx:12-93`
- Test: `tests/api/notify-prefs.test.ts:1-260`
- Test: `tests/api/authorization.test.ts:1-44`
- Test: `src/__tests__/Settings.test.tsx` (created in Task 17/36)
- Test: `src/__tests__/Privacy.test.tsx` (created in Task 17)

**Interfaces:**
- Produces: owner-scoped `GET/PUT/DELETE /api/notify-prefs`, a stable `403` for cross-user access, and truthful privacy copy for retained email/phone values.

- [ ] **Step 1: Replace the unsafe test with owner, cross-user, missing-identity, and malformed-identity cases.**

```ts
it("allows the owner to read notification preferences", async () => {
  const response = await invokeNotifyPrefs("GET", { user_id: "anon-owner" }, { authUserId: "anon-owner" });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ user_id: "anon-owner" });
});

it("rejects a cross-user preference read without returning email or phone", async () => {
  const response = await invokeNotifyPrefs("GET", { user_id: "anon-victim" }, { authUserId: "anon-attacker" });
  expect(response.status).toBe(403);
  expect(JSON.stringify(response.body)).not.toMatch(/email|phone/i);
});
```

- [ ] **Step 2: Run the security tests and capture the current disclosure.**

Run: `npm test -- tests/api/notify-prefs.test.ts tests/api/authorization.test.ts src/__tests__/Settings.test.tsx src/__tests__/Privacy.test.tsx`

- [ ] **Step 3: Enforce ownership on every method.**

  Derive the effective user ID from the authenticated context or compare it to the requested ID before reading or writing. Reject missing identity and malformed identity with the existing authorization error contract. Return only the owner's normalized fields; do not accept an arbitrary `user_id` as authorization. Keep any supported email/phone storage explicitly scoped, encrypted/permissioned according to the existing product decision, and reflected in privacy copy.

- [ ] **Step 4: Run the security/client tests and commit.**

Run: `npm test -- tests/api/notify-prefs.test.ts tests/api/authorization.test.ts src/__tests__/Settings.test.tsx src/__tests__/Privacy.test.tsx`

```bash
git add api/_notify-prefs.js src/pages/Settings.tsx src/pages/Privacy.tsx tests/api/notify-prefs.test.ts tests/api/authorization.test.ts src/__tests__/Settings.test.tsx src/__tests__/Privacy.test.tsx
git commit -m "fix: enforce owner-scoped notification preferences"
```

### Task 66: Reconcile the public allowlist and eliminate page-triggered API work

**Files:**
- Modify: `api/migrations/006_restore_anon_realtime.sql`, `api/migrations/013_realtime_rls_guard.sql`, and `api/migrations/014_revoke_anon_private_tables.sql` only when the live publication/RLS catalog proves a migration is required
- Modify: `src/lib/useRealtime.ts:25-43`
- Test: `src/__tests__/useRealtime.test.ts:1-455`
- Test: `tests/api/authorization.test.ts:1-44`
- Test: `tests/api/schema-contract.test.ts:1-181`
- Create: `src/__tests__/helpers/realtimeCatalog.ts` with `readPublicationCatalogForTest(): Promise<{ public: string[]; anonReadable: string[] }>`

- [ ] **Step 1: Write failing allowlist and no-private-subscription tests.**

```ts
it("does not open private admin or worker tables for an anonymous client", () => {
  renderHook(() => useRealtime(["agent_tasks", "settings", "vitals"], vi.fn(), { enabled: true }));
  expect(mock.createChannel).not.toHaveBeenCalled();
});

it("keeps the public allowlist aligned with the authorized publication", async () => {
  const catalog = await readPublicationCatalogForTest();
  expect([...REALTIME_TABLES].every((table) => catalog.public.includes(table))).toBe(true);
  expect([...REALTIME_TABLES].every((table) => catalog.anonReadable.includes(table))).toBe(true);
});
```

- [ ] **Step 2: Run the focused tests.**

Run: `npm test -- src/__tests__/useRealtime.test.ts tests/api/authorization.test.ts tests/api/schema-contract.test.ts`

- [ ] **Step 3: Align the allowlist with the live catalog and keep page events opt-in.**

  Remove any table that is not in the public publication or is not readable by the anonymous client. Do not add a polling replacement for a private table. If the live catalog proves a migration is needed, make the migration additive, reversible, and separately reviewable; do not apply it while implementing the client lifecycle.

- [ ] **Step 4: Run and commit.**

Run: `npm test -- src/__tests__/useRealtime.test.ts tests/api/authorization.test.ts tests/api/schema-contract.test.ts`

```bash
git add src/lib/useRealtime.ts api/migrations/006_restore_anon_realtime.sql api/migrations/013_realtime_rls_guard.sql api/migrations/014_revoke_anon_private_tables.sql src/__tests__/helpers/realtimeCatalog.ts src/__tests__/useRealtime.test.ts tests/api/authorization.test.ts tests/api/schema-contract.test.ts
git commit -m "fix: align public realtime allowlist with authorization"
```

### Task 67: Add a whole-platform one-load and action-budget contract

**Files:**
- Create: `src/__tests__/one-load-budget.test.tsx`
- Create: `src/__tests__/admin-action-budget.test.tsx`
- Modify: `src/__tests__/page-lifecycle-contract.test.ts:1-71`
- Modify: `src/__tests__/AdminTabSweep.test.tsx:1-103`

**Interfaces:**
- Consumes: `createRequestCounter`, `expectInitialBudget`, `expectNoReadAfterAction`, and the route matrix in this plan.
- Produces: a table-driven contract covering every public route and all 17 admin keys, with maximum initial reads and zero list reads after successful mutations.

- [ ] **Step 1: Write the table-driven failing contract.**

```ts
const publicBudgets = [
  ["/about", 0], ["/contact", 0], ["/terms", 0], ["/privacy", 0], ["/status", 1],
  ["/changelog", 0], ["/accessibility", 0], ["/faq", 0], ["/", 4], ["/submit", 1],
  ["/post/:id", 5], ["/polls", 2], ["/suggestions", 2], ["/leaderboard", 1],
  ["/communities", 1], ["/communities/:slug", 1], ["/board", 1], ["/activity", 7],
  ["/saved", 1], ["/search", 2], ["/insights", 1], ["/chat", 2], ["/settings", 1],
  ["/notifications", 0], ["/404", 0],
] as const;

it.each(publicBudgets)("keeps %s within its initial read budget", async (route, maximum) => {
  const budget = installBudgetedApi(route);
  renderAt(route);
  await settleInitialLoads();
  expectInitialBudget(budget, maximum);
});
```

- [ ] **Step 2: Run the contract and list every over-budget owner.**

Run: `npm test -- src/__tests__/one-load-budget.test.tsx src/__tests__/admin-action-budget.test.tsx src/__tests__/page-lifecycle-contract.test.ts src/__tests__/AdminTabSweep.test.tsx`

- [ ] **Step 3: Fix only the reported owner tasks.**

  Do not increase a budget to make a test pass. If a route has a legitimate independent initial source, record the source and its bound in the matrix; otherwise remove the duplicate read. Do not count a user-triggered write as a read or count a lifecycle telemetry POST as a route read.

- [ ] **Step 4: Add the admin mutation half of the contract.**

  For each 17-key tab, mock one successful primary action and assert the number of list reads after the action is zero for the action's owning queue. For dashboard, reports, posts, users, categories, polls, inbox, errors, logs, email templates, and settings, patch the exact row/field. For `agent-chat` and `ops-center`, assert capability/audit state changes and zero whole-page reloads.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/one-load-budget.test.tsx src/__tests__/admin-action-budget.test.tsx src/__tests__/page-lifecycle-contract.test.ts src/__tests__/AdminTabSweep.test.tsx`

```bash
git add src/__tests__/one-load-budget.test.tsx src/__tests__/admin-action-budget.test.tsx src/__tests__/page-lifecycle-contract.test.ts src/__tests__/AdminTabSweep.test.tsx
git commit -m "test: enforce platform one-load and action budgets"
```

### Task 68: Measure and guard the performance budgets

**Files:**
- Create: `scripts/one-load-budget.mjs`
- Create: `src/__tests__/one-load-budget.test.tsx`
- Modify: `docs/superpowers/plans/2026-09-24-client-one-load-and-request-coordination.md` only during implementation evidence recording, not during plan authoring
- Test: `src/__tests__/vitals.test.ts:1-142`

**Interfaces:**
- Produces: a local, deterministic request-budget report with surface, initial read count, refresh count, mutation read count, and pass/fail status. It must never issue a production mutation.

- [ ] **Step 1: Write the failing budget-report test.**

```ts
it("fails a surface that performs a second whole-page read after a successful mutation", async () => {
  const report = await runOneLoadBudget({ surface: "/", mutation: "reaction" });
  expect(report.pass).toBe(false);
  expect(report.failures).toEqual(["post-mutation-list-read"]);
});
```

- [ ] **Step 2: Run the budget test and verify the report is absent.**

Run: `npm test -- src/__tests__/one-load-budget.test.tsx`

- [ ] **Step 3: Implement a local mocked-request budget runner.**

  Read the surface matrix from a typed fixture, run the existing Vitest harness or a deterministic local mock, and emit JSON with `initialReads`, `explicitRefreshes`, `postMutationReads`, `rowBounds`, and `pass`. The runner must reject any non-GET/HEAD production operation and must not call a deployed URL. It must distinguish a user-triggered page write from a data read.

- [ ] **Step 4: Record before/after evidence against the fixed budgets.**

  For each changed surface, record the same test conditions before and after: warm read p95 `< 500 ms`; write acknowledgement p95 `< 800 ms`; LCP p75 `<= 2.5s`; INP p75 `<= 200ms`; CLS p75 `<= 0.1`; TTFB p75 `<= 800ms`; one initial request per bounded resource; zero recurring full-page/full-feed reads. Keep AI acceptance and completion measurements separate. If a result is within noise, keep the simpler implementation only if correctness and budget gates pass; otherwise record the blocker instead of claiming a win.

- [ ] **Step 5: Run the budget guard and commit.**

Run: `npm test -- src/__tests__/one-load-budget.test.tsx src/__tests__/vitals.test.ts`

```bash
git add scripts/one-load-budget.mjs src/__tests__/one-load-budget.test.tsx src/__tests__/vitals.test.ts docs/superpowers/plans/2026-09-24-client-one-load-and-request-coordination.md
git commit -m "test: guard one-load performance budgets"
```

### Task 69: Repair exhaustive route and admin evidence tests

**Files:**
- Modify: `tests/e2e/account-pages.spec.ts:1-47`
- Modify: `tests/e2e/full-platform.spec.ts:1-106`
- Modify: `tests/e2e/no-horizontal-overflow.spec.ts:1-198`
- Modify: `src/__tests__/AdminTabSweep.test.tsx:1-103`
- Modify: `src/__tests__/page-lifecycle-contract.test.ts:1-71`
- Create: `src/__tests__/public-route-inventory.test.ts`

- [ ] **Step 1: Add failing inventory assertions for nonexistent or omitted routes.**

```ts
it("does not treat the 404 page as /inbox and covers every public heading", () => {
  expect(accountPageRoutes).toContain("/chat");
  expect(accountPageRoutes).not.toContain("/inbox");
  expect(publicHeadings).toEqual(expect.arrayContaining(["About", "Contact", "Terms", "Privacy", "Status", "Changelog", "Accessibility", "FAQ", "Feed", "Submit", "Polls", "Suggestions", "Leaderboard", "Communities", "Solving Board", "My Activity", "Saved", "Search", "Insights", "Chat", "Settings", "Notifications"]));
});

it("does not use a nonexistent admin tab key in overflow coverage", () => {
  expect(adminOverflowTabs).toEqual(expect.arrayContaining(["agent-chat", "ops-center", "email-templates"]));
  expect(adminOverflowTabs).not.toContain("builder");
});
```

- [ ] **Step 2: Run the evidence tests.**

Run: `npm test -- src/__tests__/public-route-inventory.test.ts src/__tests__/AdminTabSweep.test.tsx src/__tests__/page-lifecycle-contract.test.ts`

- [ ] **Step 3: Correct route fixtures and strengthen outcome assertions.**

  Replace the E2E `/inbox` request with the real `/chat` route. Replace the overflow suite's obsolete `builder` tab with all three real capability/config tabs named above. Make `full-platform.spec.ts` assert each route's expected heading and a meaningful control, not only body length/console cleanliness. Keep browser automation disabled for this plan; these are test-source changes for a future executor.

- [ ] **Step 4: Make the admin sweep include all 17 canonical keys.**

  Import `ADMIN_TAB_KEYS` rather than maintaining a shortened candidate list. Keep the sweep's outcome checks for AI Coworker and Ops Center, and make the sweep fail if a capability key is only present in navigation but not renderable by direct URL.

- [ ] **Step 5: Run and commit.**

Run: `npm test -- src/__tests__/public-route-inventory.test.ts src/__tests__/AdminTabSweep.test.tsx src/__tests__/page-lifecycle-contract.test.ts`

```bash
git add tests/e2e/account-pages.spec.ts tests/e2e/full-platform.spec.ts tests/e2e/no-horizontal-overflow.spec.ts src/__tests__/AdminTabSweep.test.tsx src/__tests__/page-lifecycle-contract.test.ts src/__tests__/public-route-inventory.test.ts
git commit -m "test: cover every public route and admin key"
```

### Task 70: Preserve backend capability, worker, registry, report, and audit surfaces

**Files:**
- Modify: `src/__tests__/capabilityStatus.test.ts` (created in Task 64)
- Modify: `src/__tests__/admin-capability-contract.test.ts` (created in Task 63)
- Modify: `src/__tests__/realwork-workers.test.ts:1-260`
- Modify: `src/__tests__/audit-report.test.ts:1-105`
- API test files: `tests/api/agent-cron-registry.test.ts`, `tests/api/workforce.test.ts`, `tests/api/workforce-automation.test.ts`, `tests/api/workforce-ops-health.test.ts`, `tests/api/workforce-pause-resume.test.ts`, `tests/api/workforce-quality.test.ts`

- [ ] **Step 1: Write a failing capability inventory assertion.**

```ts
it("retains automatic workers, manual controls, registries, reports, and audit records", () => {
  expect(capabilityIds).toEqual(expect.arrayContaining(["workforce", "ops-center", "agent-chat", "reports", "audit"]));
  expect(executionModes).toEqual(expect.arrayContaining(["automatic", "manual", "both"]));
  expect(removedCapabilityIds).toEqual([]);
});
```

- [ ] **Step 2: Run the capability inventory tests.**

Run: `npm test -- src/__tests__/capabilityStatus.test.ts src/__tests__/admin-capability-contract.test.ts src/__tests__/realwork-workers.test.ts src/__tests__/audit-report.test.ts tests/api/agent-cron-registry.test.ts tests/api/workforce.test.ts tests/api/workforce-automation.test.ts tests/api/workforce-ops-health.test.ts`

- [ ] **Step 3: Treat a lifecycle change as capability-preserving only when evidence exists.**

  Do not remove a worker, cron registry, automation definition, report, appeal, evaluation, red-team, drift, moderation, provider-budget, audit, AI action, or manual operator control to reduce client requests. A client refresh change may change when an operator sees state, but it must leave the server registry/action/audit path reachable and tested.

- [ ] **Step 4: Run and commit.**

Run: `npm test -- src/__tests__/capabilityStatus.test.ts src/__tests__/admin-capability-contract.test.ts src/__tests__/realwork-workers.test.ts src/__tests__/audit-report.test.ts tests/api/agent-cron-registry.test.ts tests/api/workforce.test.ts tests/api/workforce-automation.test.ts tests/api/workforce-ops-health.test.ts`

```bash
git add src/__tests__/capabilityStatus.test.ts src/__tests__/admin-capability-contract.test.ts src/__tests__/realwork-workers.test.ts src/__tests__/audit-report.test.ts tests/api/agent-cron-registry.test.ts tests/api/workforce.test.ts tests/api/workforce-automation.test.ts tests/api/workforce-ops-health.test.ts tests/api/audit-report.test.ts
git commit -m "test: preserve automatic and manual capability surfaces"
```

## Final Verification Ladder

The executor must run these commands sequentially, stopping at the first failure and recording the exact failing test, route/tab, request count, and last-known-good state. These commands are future execution instructions; they were not run while producing this plan.

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run test:api`
5. `npm run build`

Before the ladder, run the focused task command for the slice under review. Do not run browser automation, production writes, staging mutations, migrations, deployment, staging load tests, or any command that changes the shared dirty tree. A local mocked request-budget run is allowed; a production load run must remain read-only and is not part of this plan's completion gate.

## Performance Evidence Ledger

Record one row per changed surface with the same fixture, route, query, viewer context, and network mode before and after:

| Surface | Initial reads | Row/resource bound | Post-mutation list reads | Recurring full reads | p95/target result | Evidence file/test |
|---|---:|---:|---:|---:|---|---|
| Home | <=4 | 20 posts; poll batch <=50 | 0 | 0 | warm read p95 `< 500 ms` | `one-load-budget.test.tsx` |
| Post detail | <=5 | one post/poll/comments page <=200 | 0 | 0 | warm read p95 `< 500 ms` | `one-load-budget.test.tsx` |
| Admin dashboard | <=8 | each source independently bounded | 0 for source owner | 0 | read p95 `< 500 ms` | `admin-action-budget.test.tsx` |
| Admin posts/users/logs | 1 per explicit page | 30 rows; cursor next page only | 0 for row owner | 0 | read p95 `< 500 ms` | `admin-action-budget.test.tsx` |
| Write acknowledgements | n/a | affected record only | 0 | 0 | p95 `< 800 ms` | mutation response tests |
| Web vitals | n/a | sampled metrics | n/a | 0 client flush intervals | LCP `<= 2.5s`, INP `<= 200ms`, CLS `<= 0.1`, TTFB `<= 800ms` | `vitals.test.ts` and lifecycle test |

A result that is not measured is not a pass. Keep failed/reverted experiments in the ledger with the reason; do not weaken a budget to make a regression disappear.

## Exact-Path Commit Examples

These examples show the intended path ownership. The executor must stage only the paths named by the completed task and must inspect the human-approved shared dirty tree before staging.

### Core coordination slice

```bash
git add src/lib/api.ts src/lib/offline.ts src/lib/resourceRefresh.ts src/lib/reconciliation.ts src/lib/snapshotBoundary.ts src/hooks/useInfiniteScroll.ts src/hooks/useSharedClock.ts src/lib/useRealtime.ts src/contexts/AppContext.tsx src/components/Layout.tsx src/lib/vitals.ts src/lib/errors.ts src/hooks/useCategories.ts src/__tests__/api.test.ts src/__tests__/api-concurrency.test.ts src/__tests__/api-coordination.test.ts src/__tests__/offline.test.ts src/__tests__/resourceRefresh.test.tsx src/__tests__/reconciliation.test.ts src/__tests__/useInfiniteScroll.test.tsx src/__tests__/useRealtime.test.ts src/__tests__/shared-clock.test.tsx src/__tests__/AppContextCore.test.tsx src/__tests__/AppContextSaved.test.tsx src/__tests__/vitals.test.ts src/__tests__/errors.test.ts src/__tests__/telemetry-lifecycle.test.ts src/__tests__/useCategories.test.tsx
git commit -m "perf: enforce one-load client request coordination"
```

### Public-route slice

```bash
git add src/pages/Home.tsx src/pages/Submit.tsx src/pages/PostDetail.tsx src/pages/Polls.tsx src/pages/Suggestions.tsx src/pages/Leaderboard.tsx src/pages/Communities.tsx src/pages/CommunityDetail.tsx src/pages/SolvingBoard.tsx src/pages/MyActivity.tsx src/pages/Saved.tsx src/pages/Search.tsx src/pages/Insights.tsx src/pages/UserChat.tsx src/pages/Settings.tsx src/pages/Notifications.tsx src/pages/StatusPage.tsx src/pages/Contact.tsx src/pages/About.tsx src/pages/Terms.tsx src/pages/Privacy.tsx src/pages/Changelog.tsx src/pages/Accessibility.tsx src/pages/Faq.tsx src/pages/NotFound.tsx src/__tests__/Home.test.tsx src/__tests__/Home.realtime.test.tsx src/__tests__/Submit.test.tsx src/__tests__/PostDetail.test.tsx src/__tests__/Comments.gate.test.tsx src/__tests__/Comments.realtime.test.tsx src/__tests__/Polls.test.tsx src/__tests__/Suggestions.test.tsx src/__tests__/Leaderboard.test.tsx src/__tests__/Communities.test.tsx src/__tests__/CommunityDetail.test.tsx src/__tests__/SolvingBoard.test.tsx src/__tests__/MyActivity.test.tsx src/__tests__/Saved.test.tsx src/__tests__/Search.test.tsx src/__tests__/Insights.test.tsx src/__tests__/UserChat.test.tsx src/__tests__/Settings.test.tsx src/__tests__/Notifications.test.tsx src/__tests__/StatusPage.test.tsx src/__tests__/Contact.test.tsx src/__tests__/About.test.tsx src/__tests__/Terms.test.tsx src/__tests__/Privacy.test.tsx src/__tests__/Changelog.test.tsx src/__tests__/Accessibility.test.tsx src/__tests__/Faq.test.tsx src/__tests__/NotFound.test.tsx
git commit -m "perf: stabilize every public route snapshot"
```

### Admin and capability slice

```bash
git add src/lib/adminTabs.ts src/lib/capabilityStatus.ts src/pages/Admin.tsx src/components/admin/PageContext.jsx src/components/admin/PageContext.d.ts src/pages/admin/Overview.tsx src/pages/admin/AgentChat.tsx src/pages/admin/OpsCenter.tsx src/pages/admin/SystemHealth.tsx src/pages/admin/PerformanceCenter.tsx src/pages/admin/SecurityCenter.tsx src/pages/admin/ActivityStream.tsx src/pages/admin/Reports.tsx src/pages/admin/PostsTable.tsx src/pages/admin/UserManager.tsx src/pages/admin/Categories.tsx src/pages/admin/PollManager.tsx src/pages/admin/UnifiedInbox.tsx src/pages/admin/ErrorTracking.tsx src/pages/admin/Logs.tsx src/pages/admin/EmailTemplates.tsx src/pages/admin/AdminSettings.tsx src/pages/admin/ProviderSettings.tsx src/pages/admin/QuickActions.tsx src/pages/admin/agent-office/ApprovalAlert.tsx src/components/admin/WorkItem.tsx src/components/admin/PulseStrip.tsx src/lib/dashboard/widgets.tsx src/__tests__/admin-tabs.test.ts src/__tests__/AdminShell.test.tsx src/__tests__/AdminTabSweep.test.tsx src/__tests__/Overview.test.tsx src/__tests__/AdminAgentChat.test.tsx src/__tests__/OpsCenter.test.tsx src/__tests__/SystemHealth.test.tsx src/__tests__/PerformanceCenter.test.tsx src/__tests__/SecurityCenter.test.tsx src/__tests__/ActivityStream.test.tsx src/__tests__/Reports.test.tsx src/__tests__/PostsTable.test.tsx src/__tests__/UserManager.test.tsx src/__tests__/AdminCategories.test.tsx src/__tests__/PollManager.test.tsx src/__tests__/UnifiedInbox.test.tsx src/__tests__/ErrorTracking.test.tsx src/__tests__/Logs.test.tsx src/__tests__/EmailTemplates.test.tsx src/__tests__/AdminSettings.test.tsx src/__tests__/ProviderSettings.test.tsx src/__tests__/QuickActions.test.tsx src/__tests__/ApprovalAlert.test.tsx src/__tests__/WorkItem.test.tsx src/__tests__/capabilityStatus.test.ts
git commit -m "perf: preserve all admin and capability surfaces"
```

### API/security slice

```bash
git add api/_communities.js api/_polls.js api/_reactions.js api/_comments.js api/_posts.js api/_categories.js api/_admin.js api/_reports.js api/_inbox.js api/_notify-prefs.js api/migrations/006_restore_anon_realtime.sql api/migrations/013_realtime_rls_guard.sql api/migrations/014_revoke_anon_private_tables.sql tests/api/communities.test.ts tests/api/polls-full.test.ts tests/api/reactions.test.ts tests/api/comments-full.test.ts tests/api/posts-full.test.ts tests/api/categories.test.ts tests/api/reports.test.ts tests/api/inbox-admin-reply.test.ts tests/api/notify-prefs.test.ts tests/api/authorization.test.ts tests/api/schema-contract.test.ts
git commit -m "fix: preserve authoritative mutation and authorization contracts"
```

## Plan Self-Review

Before handing this document to an executor, review the plan itself, not production behavior, against the approved design and inventory.

- [ ] **Spec coverage:** Every requirement in `2026-09-24-10k-smooth-platform-design.md` that affects this client slice maps to a task: one bounded initial read, explicit boundaries, no recurring refresh, Realtime opt-in, authoritative reconciliation, stale/error states, read-like POST intent, bounded queue, dirty follow-up, shared clock, telemetry lifecycle, 17-key registry, capability preservation, security boundaries, and the seven acceptance budgets.
- [ ] **Surface coverage:** The public matrix has `/about`, `/contact`, `/terms`, `/privacy`, `/status`, `/changelog`, `/accessibility`, `/faq`, `/`, `/submit`, `/post/:id`, `/polls`, `/suggestions`, `/leaderboard`, `/communities`, `/communities/:slug`, `/board`, `/activity`, `/saved`, `/search`, `/insights`, `/chat`, `/settings`, `/notifications`, and fallback; Tasks 14-38 give each an owner, lifecycle, focused test, and commit example.
- [ ] **Admin coverage:** The admin matrix and Tasks 39-55 cover exactly 17 keys, with `agent-chat` and `ops-center` retained as explicit capability surfaces and the 15/2 navigation distinction documented without deletion.
- [ ] **Shared coverage:** Tasks 7-13 and 56-63 cover AppProvider, Layout, Categories, Realtime/SmartPoll, pagination, clock, telemetry, Comments, PostCard/PostCardAdminBar, PollCard/PurgeCountdown, WorkItem, PulseStrip/widgets, ApprovalAlert, ProviderSettings, and QuickActions.
- [ ] **API coverage:** Tasks 1-4 and 13, 65-67 cover request intent/replay, queue/cancellation, community vote/solve/delete responses, mutation families, notification preferences, Realtime allowlist authorization, and stable failure envelopes.
- [ ] **Placeholder scan:** Search for unresolved placeholder markers, vague implementation language, and abbreviated line references. The only remaining three-dot sequences are TypeScript spread syntax in executable examples; no line reference may use an ellipsis.
- [ ] **Type consistency:** `RequestOptions`, `ReadCoordinator`, `ResourceRefresh`, `MutationEnvelope`, `AdminTabKey`, `CapabilityStatus`, `RealtimeOptions`, and `LoadMoreButton` names are defined before their consuming tasks. Check that `loadMore`, `retryLastPage`, `refresh`, `reconcileRecord`, `reconcileRecords`, and `removeRecord` are spelled consistently.
- [ ] **Passive-refresh scan:** No task may reintroduce `setInterval`/`setTimeout`/`visibilitychange`/`useRealtime` as a page data loader. Allowed timers are recorder/meter/debounce, toast/focus, shared countdown, or a user-triggered retry that does not fire automatically.
- [ ] **Capability preservation:** No task may delete a route, tab, worker, cron, registry, report, appeal, audit record, provider budget, evaluation, red-team, drift, moderation, AI action, or manual operator control. Every performance change must retain the server action and its audit evidence.
- [ ] **Failure semantics:** Every route task requires a visible `stale` or `error` path, last-known-good preservation, and a true empty state only from a successful bounded response.
- [ ] **Request accounting:** Initial reads, explicit refreshes, user-triggered pagination, mutation reads, and lifecycle telemetry writes are counted separately. No budget is increased to hide a duplicate request.
- [ ] **Dirty-tree safety:** No task authorizes `git add .`, `git commit -a`, reset, clean, worktree creation, browser automation, deployment, migration application, staging writes, or unrelated-path staging.

### Final handoff state

This document is a plan only. No source, test, API, migration, staging, browser, staging-load, staging-write, commit, push, or deployment change is authorized by this plan. The next human action is to review the plan and choose an execution mode; implementation must use the exact sequential verification ladder only after that approval.
