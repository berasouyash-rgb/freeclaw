# Voice Flow Platform Surface Inventory

**Date:** 2026-09-24  
**Related design:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md`  
**Purpose:** Exhaustive page, control, shared-component, and test-surface map for the full-platform improvement program.

**Feature-preservation decision:** Preserve every existing user route, admin route/tab, control, worker, API action, report, audit surface, and manual operator capability. Automatic background work and manual/non-autonomous operator work are both first-class. The full admin navigation has 17 tabs.

## 1. Completion Standard

A surface is complete only when:

- its route and owner are identified;
- its initial data resources and row bounds are known;
- every button, form, modal, menu, link, and destructive action is inventoried;
- loading, empty, error, success, disabled, and retry behavior is honest;
- mutations use the correct endpoint, authorization, validation, and local-state reconciliation;
- no timer, visibility event, or realtime event causes an unapproved automatic data reload;
- keyboard, screen-reader, mobile, and desktop behavior is checked;
- outcome-based regression tests or explicit static evidence exist;
- no known dead control or silent failure remains.

No page receives a completion claim merely because it mounts without crashing.

## 2. Shared Owners

| Owner | Current behavior | Required outcome |
|---|---|---|
| `AppProvider` | Saved sync, immediate heartbeat, 120-second heartbeat, 180-second notification engine, visibility refresh | One initial summary load; no recurring data engine on any route |
| `useRealtime` | Global row delivery, 30-second fallback polling, visibility refresh, 120-second staleness polling | No automatic full refetch; stale client allowlist corrected |
| `Layout` | Announcement load and local queued-action counter | One announcement load; local-only counter retained if useful |
| `useSmartPoll` | Immediate load, recurring poll, visibility refresh | Reserved for explicit future opt-in; no default page use |
| `useInfiniteScroll` | Cursor loading with stale-reset weakness | User-driven pagination only; stale pages cannot append after reset |
| `useCategories` | One request per consumer mount | Deduplicated or shared where multiple consumers mount together |
| Web Vitals | Five-second batch POST and visibility flush | Sampled; primarily hidden/unload flush; no 2,000 POST/s ceiling |
| `PageContext` | Path-based admin route mapping | Same source of truth as `/admin?tab=`; no dashboard misclassification |

### Automatic and manual AI surfaces

AI Coworker, Ops Center, agent chat action endpoints, workforce/automation registries, cron workers, evaluation/quality/red-team/drift jobs, moderation decisions, reports, activity events, provider budgets, and durable operational records all remain in scope. Automatic jobs and manual controls are tested as two execution modes of the same capability contract. No backend registry, worker, API action, report, or audit surface may be removed as a performance shortcut.

## 3. Public Routes

| Route | Component | Initial resources | Main controls/functions | Current policy/quality findings | Status |
|---|---|---|---|---|---|
| `/about` | `About` | None | Navigation | Static content; smoke coverage | Compliant |
| `/contact` | `Contact` | None on mount | Contact form | Honest sending/success/error; stores name/email through post API; privacy copy must align | Partial |
| `/terms` | `Terms` | None | Navigation | Static content | Compliant |
| `/privacy` | `Privacy` | None | Navigation | Claims no stored email/phone, contradicted by notification settings | Blocker |
| `/status` | `StatusPage` | None | Manual timestamp refresh, test error | Hard-coded status and misleading “last checked” timestamp | Incorrect/misleading |
| `/changelog` | `Changelog` | None | Navigation | Static content | Compliant |
| `/accessibility` | `Accessibility` | None | Navigation | Static content | Compliant |
| `/faq` | `Faq` | None | Local search, accordions | Local filtering only | Compliant |
| `/` | `Home` | Posts, own reactions, categories, linked polls, own votes | Filters, reactions, bookmarks, refresh, pending pill | Requests up to 300 for 20-row UI; poll N+1; full feed reloads from events/fallback | Noncompliant |
| `/submit` | `Submit` | Categories; input-driven duplicate and poll checks | Publish, poll, upload, AI suggestion, moderation, autosave, appeal | No page interval; duplicate lookup not cursor-bounded | Mostly compliant |
| `/post/:id` | `PostDetail` | Post, follow state, linked poll, own votes | React, follow, comment, lock, report, delete, edit, export, poll | Broad realtime reloads; comments/full export unbounded; some actions refetch | Partial |
| `/polls` | `Polls` | Poll list, own votes | Vote, delete, filter | Every event reloads full list; no server pagination; per-card timers | Noncompliant |
| `/suggestions` | `Suggestions` | Suggestions, own reactions | Vote, bookmark, filters | Post events reload full list; reaction handling still request-heavy | Noncompliant |
| `/leaderboard` | `Leaderboard` | Aggregate snapshot | Tabs, manual refresh, retry | No interval/realtime | Compliant |
| `/communities` | `Communities` | Community list | Create, hide/unhide, delete, retry | 30-second reload; actions refetch; weak failure recovery | Noncompliant |
| `/communities/:slug` | `CommunityDetail` | Detail and full feed | Join, post, vote, solve, delete, react, comment, admin actions | 25-second reload; whole JSON document; actions refetch; no cursor feed | Noncompliant |
| `/board` | `SolvingBoard` | Problem list | Navigation, manual retry | Every post event reloads board | Noncompliant |
| `/activity` | `MyActivity` | Posts, comments, reactions, reports, votes, saved content | Delete, undo, export | Several undo/action paths refetch all resources; no cursor pagination | Partial |
| `/saved` | `Saved` | Saved IDs and bookmarked posts | Remove, react | Bookmark dependency reloads; reaction callback refetches | Partial |
| `/search` | `Search` | Categories; query-driven results | Search, filters, retry, pagination | User-driven only; stale requests need cancellation | Mostly compliant |
| `/insights` | `Insights` | Aggregate snapshot | Filters, manual retry | No interval/realtime | Compliant |
| `/chat` | `UserChat` | Inbox/chat state | Send, retry, upload, AI toggle, read-aloud | Relevant realtime/fallback/visibility still reload full thread | Noncompliant |
| `/settings` | `Settings` | Notification preferences | Theme/display/local state; channel save | Stores PII while privacy/admin copy denies storage; GET authorization defect | Blocker |
| `/notifications` | `Notifications` | AppContext state | Filter, mark all read, clear | Page-local behavior is sound; inherited global polling violates policy | Partial |
| fallback | `NotFound` | None | Navigation/reload | Correct static behavior; tests must assert 404 content | Compliant |

## 4. Admin Tabs

| Query tab | Component | Initial resources | Main controls/functions | Current policy/quality findings | Status |
|---|---|---|---|---|---|
| `dashboard` | `Overview` | Ops summary, alerts, system health, users, posts, comments, polls | Review/dismiss/status actions, filters, announcement/triage | Five-source 30-second reload; duplicate health calls; vitals timer; large lists | Noncompliant |
| `agent-chat` | `AgentChat` | Agent sessions, context, action previews | Send, approve/execute actions, session/history selection | Local reconciliation; no passive page-wide polling; manual and automatic action outcomes must be explicit | Partial |
| `ops-center` | `OpsCenter` | Automation registry, workforce scorecard, briefings, queue health | Run, pause/resume, acknowledge, approve, retry, inspect | Smart Poll/visibility refresh and duplicate refresh paths; manual controls must share capability contract | Noncompliant |
| `system-health` | `SystemHealth` | Health snapshot | Manual refresh, node select | Realtime fallback plus raw 30-second interval | Noncompliant |
| `performance` | `PerformanceCenter` | Performance, vitals | Manual refresh | Realtime fallback plus raw 30-second interval; duplicate loads | Noncompliant |
| `security` | `SecurityCenter` | Security events | Refresh, filters | Polling-only hook triggers automatic reload; failures become empty list | Noncompliant |
| `activity-stream` | `ActivityStream` | Ops summary/events | Refresh, filters | Polling-only hook; capped list but no cursor; failure becomes empty | Noncompliant |
| `reports` | `Reports` | Fast queues, heavy all-post scan | Resolve, escalate, moderate, approve/reject, publish, delete | Realtime + 15-second timer + 60-second scan; actions refetch queues | Noncompliant |
| `posts` | `PostsTable` | Cursor-paginated posts | Filter, edit, delete, bulk actions, load more | Bounded but automatically drains 10 pages; no virtualization | Partial |
| `users` | `UserManager` | Cursor-paginated users; on-demand detail | Edit, ban/suspend, revoke, detail actions | Some actions reset/reload; detail payload unbounded | Partial |
| `categories` | `Categories` | Categories | Add, remove, reset | Server echo plus local update | Compliant |
| `polls` | `PollManager` | Poll list | Create, archive, delete | Realtime full reload; actions refetch | Noncompliant |
| `inbox` | `UnifiedInbox` | Thread lists and active messages | Send, takeover, release, transfer, status, delete, AI actions | Realtime reloads lists/messages; actions refetch; no cursor | Noncompliant |
| `errors` | `ErrorTracking` | Health, chunks, audit trail, frontend errors | Refresh, filters, test error | 30-second frontend-error poll; audit realtime; weak pagination | Noncompliant |
| `logs` | `Logs` | Cursor audit logs, fixed agent activities | Tabs, filters, export | Agent activities poll every 30 seconds and on visibility | Noncompliant |
| `email-templates` | `EmailTemplates` | Templates | Preview, save, test send | User-triggered actions; no interval | Compliant |
| `settings` | `AdminSettings` | Auth/agent/spam/provider state | Password, settings, provider actions | Page local state is sound; embedded ProviderSettings refetches; privacy/security copy incorrect | Partial/blocker |

## 5. Shared Interactive Components

| Component | Current behavior | Required outcome | Status |
|---|---|---|---|
| `Comments` | Initial load; relevant events refetch full thread; submit/edit/delete often reload | Initial thread once; local reconciliation; no event reload | Noncompliant |
| `PostCard` | Optimistic reaction with rollback | Preserve pattern | Compliant |
| `PollCard` | Vote uses server response; parent may reload list | Parent stops refetching full list | Mostly compliant |
| `QuickActions` | One load; local publish/clear | Preserve | Compliant |
| `WorkItem` | One timeline load; action refreshes timeline only | Bound timeline and prevent overlap | Mostly compliant |
| `PulseStrip` | 60-second unconditional interval | One load plus manual refresh | Noncompliant |
| `ApprovalAlert` | 12-second poll and visibility refresh | One load; explicit manual/pending-action refresh | Noncompliant |
| `ProviderSettings` | One load; successful actions refetch everything | Reconcile affected provider/settings field | Partial |
| `PostCardAdminBar` | Writes toast but leave displayed row stale | Patch authoritative returned row | Partial |
| `PollCard` countdowns | One timer per card | Shared clock or visible-only timer | Smoothness issue |

## 6. High-Severity Correctness and Security Defects

### 6.1 Notification preference PII disclosure

- `GET /api/notify-prefs?user_id=...` returns stored email/phone preferences without verifying caller ownership.
- Settings explicitly persist these values.
- Privacy says they are not stored.
- Admin security copy says no personal data is stored.
- The current API test locks in the unsafe behavior and must be replaced.

Required contract:

1. Authenticate/verify the caller against the requested user ID.
2. Reject cross-user reads with the existing authorization error contract.
3. Decide whether phone/email storage is a product requirement. If retained, privacy and admin copy must describe it accurately, retention, purpose, and deletion behavior. If not required, remove storage and collection.
4. Add positive owner-read, cross-user denial, missing-identity, and malformed-identity tests.

### 6.2 Admin page-context mismatch

- Router: `/admin?tab=reports`.
- `PageContext`: assumes `/admin/reports` and maps `/admin` to dashboard.
- Query-tab pages can report the wrong page identity.

Required contract: one canonical admin-tab parser shared by navigation, page context, tests, analytics, and command palette.

### 6.3 Misleading status page

- Status values are hard-coded.
- “Refresh” waits one second and changes a timestamp without checking real services.
- The timestamp is presented as a live last-checked value.

Required contract: either connect a bounded read-only health endpoint with an honest timestamp or label the page as a static demo/status snapshot. It must never claim a check that did not happen.

### 6.4 Failure-to-empty conversions

- Activity Stream, Security Center, and some UserChat failure paths render an empty dataset rather than an error.
- This makes outages look like “nothing exists.”

Required contract: preserve last-known-good data with a visible stale/error banner, or show a full error state with retry. Do not convert transport failure into authoritative empty data.

## 7. Test Gaps to Close

- No direct component suites for `CommunityDetail`, `StatusPage`, `Contact`, `Settings`, `SystemHealth`, `PerformanceCenter`, or `SecurityCenter`.
- Admin tab sweep must cover all 17 canonical tabs, including AgentChat and OpsCenter; automatic and manual actions must have outcome-based coverage.
- Sweep mocks realtime/polling and therefore cannot enforce refresh policy.
- Account E2E requests `/inbox`, which is not a real route, and can pass against the 404 page.
- Full-platform E2E checks body length/console errors but does not assert each expected page heading.
- Overflow suite references nonexistent admin tab `builder`; it must cover `agent-chat`, `ops-center`, and `email-templates` as real canonical tabs.
- No test asserts one initial load, zero timer refreshes, zero visibility refreshes, or no full refetch after a successful action.
- Notification preference tests currently expect unauthorized PII disclosure.
- No test covers admin query-tab page-context consistency.

## 8. Inventory Maintenance

For each implementation slice:

1. Select one or more inventory rows.
2. Add or update the focused regression test before production code.
3. Record the before/after request count and user-visible outcome.
4. Mark each completed control/function with evidence.
5. Keep unresolved gaps visible; never silently remove inventory rows.
6. Re-run the exhaustive route inventory after router or admin-tab changes.

Completion is whole-platform only when all rows are either verified or carry an explicit, user-approved exception.
