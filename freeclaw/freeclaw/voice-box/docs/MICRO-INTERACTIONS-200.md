# VoiceFlow micro-interaction checklist (200 items)

**Status:** verification matrix for the micro-interaction requirement.  
**Scope:** student and admin surfaces, desktop and mobile, reduced motion, real-time, permissions.  
**Date:** 2026-10-31

## How this list was produced

The request refers to "all 200 micro-interactions listed in the specification", but no enumerated 200-item list was present in the three supplied attachments, the repository, or the conversation transcript. The attachments contain the 15 categories (section 10 of the platform spec) and the quality rules, not the numbered items. So this file reconstructs 200 distinct, checkable interactions from those categories and from the shipped UI. It is a verification matrix, not a claim that 200 new animations were added. Items that cannot be proven are labelled `Inspected` or `Partial`, never `Tested`.

## Status definitions

| Status | Meaning | Counts as complete? |
| --- | --- | --- |
| **Tested** | Implemented, and an automated test asserts this exact behaviour (unit, integration, or Playwright). | Yes, for this checklist |
| **Inspected** | Implemented and verified by code audit against a real API/state path, but no dedicated assertion. Test coverage is still owed. | No |
| **Partial** | Some behaviour exists, with a stated limitation. Not complete. | No |

**Totals:** 137 tested, 62 inspected, 1 partial, 0 blocked.  
**Out of 200, 137 have an automated assertion; 63 do not yet.**

## Per-category summary

| Category | Items | Tested | Inspected | Partial |
| --- | ---: | ---: | ---: | ---: |
| 1. Navigation and sidebar | 14 | 7 | 7 | 0 |
| 2. Buttons and controls | 17 | 11 | 6 | 0 |
| 3. Forms and inputs | 18 | 15 | 3 | 0 |
| 4. Dashboard and analytics | 13 | 8 | 5 | 0 |
| 5. User management | 12 | 6 | 6 | 0 |
| 6. Complaints and case management | 16 | 11 | 5 | 0 |
| 7. Moderation | 14 | 11 | 3 | 0 |
| 8. Real-time updates | 15 | 12 | 3 | 0 |
| 9. Notifications | 13 | 6 | 7 | 0 |
| 10. Student experience | 17 | 13 | 3 | 1 |
| 11. Search and filters | 12 | 9 | 3 | 0 |
| 12. AI assistance | 9 | 5 | 4 | 0 |
| 13. Workflow automation | 9 | 6 | 3 | 0 |
| 14. Settings and security | 11 | 9 | 2 | 0 |
| 15. Accessibility and finishing touches | 10 | 8 | 2 | 0 |
| **Total** | **200** | **137** | **62** | **1** |

## What changed in this implementation pass

The audit found that most interaction primitives already existed, but several systemic behaviours were missing or dishonest. These were fixed and regression-tested:

1. **Dialogs had no focus management.** `Modal` now uses the shared `useFocusTrap` hook: focus enters the dialog, Tab wraps, Escape is handled once, and focus returns to the trigger. `autoFocus` children keep focus. (`src/components/ui.tsx`, `src/hooks/useFocusTrap.ts`)
2. **Confirm dialogs swallowed failures.** `ConfirmDialog` now catches sync and async errors, keeps the dialog open, shows a `role="alert"` message, changes the button to "Try again", sets `aria-busy`, and blocks double submits. (`src/components/ui.tsx`)
3. **Tab strips were mouse-only.** A shared roving-focus helper (`src/lib/tablist.ts`) was wired into eight tablists: Home sort and status, Submit content type, Overview digest, Activity report period and view, Report deck slides, Unified inbox importance, and the shared `SegmentedTabs`. Arrow keys move focus; Enter/Space activates; Home/End jump. (`src/components/primitives.tsx` plus those pages)
4. **Toasts could not be dismissed and had no semantic icons.** `ToastHost` now renders per-kind icons, a labelled dismiss button, and an `aria-live` region that never intercepts pointer events. (`src/components/ToastHost.tsx`, `src/contexts/AppContext.tsx`)
5. **The notification popover could not be closed by keyboard or outside click.** The bell now exposes `aria-expanded`, `aria-haspopup`, and `aria-controls`; Escape and outside pointer events close it; the unread badge clamps at 99+ and replays its pop when the count changes. (`src/components/Layout.tsx`)
6. **Two React animation demos ignored reduced motion.** `MagneticButton` and `AnimatedList` now check `useReducedMotion`; `CountUp` already snapped. (`src/components/ui/magnetic-button.tsx`, `src/components/ui/animated-list.tsx`)
7. **New regression tests.** `src/__tests__/interaction-polish.test.tsx` covers focus wrap/restore, ConfirmDialog failure and retry, and tablist keyboard behaviour. `src/__tests__/ToastHost.test.tsx` covers dismissal. `tests/e2e/interactions.spec.ts` covers real-browser focus, tab strips, notification popover, command palette, search clear, and reduced motion.
8. **Suggestion Board re-ranked instantly instead of gliding.** On Top ranked, a vote re-ordered the cards the moment it landed (optimistic and realtime) with no signal about what moved. `useFlipList` now accepts a per-list glide duration and a `resetKey` that re-baselines silently when the reader changes sort or filter. The board glides re-ranked cards over 520 ms, labels both moves with the `RankDelta` chip for 3 s, and under `prefers-reduced-motion` still reports the move with no motion. (`src/pages/Suggestions.tsx`, `src/hooks/useFlipList.ts`; tests: `rankMotion.test.tsx`, `Suggestions.rankMotion.test.tsx`, `tests/e2e/suggestion-rank.spec.ts`)

## The 200 interactions

### 1. Navigation and sidebar

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 1 | Skip link is the first Tab stop and becomes visible on focus | `Layout.tsx` `.skip-to-content`, `index.css:170` | `tests/e2e/interactions.spec.ts` | Tested |
| 2 | Sidebar marks the active route and sets aria-current | `Layout.tsx` NavLink | `Layout.test.tsx` | Inspected |
| 3 | Mobile drawer opens from the hamburger with a scrim | `Layout.tsx:488` | `useFocusTrap` suite + code audit | Inspected |
| 4 | Mobile drawer traps focus, closes on Escape, restores focus | `Layout.tsx:198`, `useFocusTrap.ts` | code audit + hook suite | Inspected |
| 5 | Command palette opens with Ctrl/Cmd+K | `CommandPalette.tsx` | `tests/e2e/interactions.spec.ts` | Tested |
| 6 | Command palette arrow keys move the option, Enter runs it | `CommandPalette.tsx` | code audit | Inspected |
| 7 | Command palette traps Tab and returns focus on Escape | `CommandPalette.tsx` | `tests/e2e/interactions.spec.ts` | Tested |
| 8 | Route changes scroll to the top of the new page | `Layout.tsx:304` | code audit | Inspected |
| 9 | Unknown routes render a 404 with recovery links | `NotFound.tsx` | code audit | Inspected |
| 10 | Header gains a border and shadow after scroll | `Layout.tsx` scroll listener | code audit | Inspected |
| 11 | Header search button is keyboard reachable and named | `Layout.tsx:592` | `tests/e2e/interactions.spec.ts` | Tested |
| 12 | Admin sections are filtered by the signed-in role | `Admin.tsx`, `adminTabs` | `adminTabs.test.ts` | Tested |
| 13 | Admin deep links open the matching tab | `Admin.tsx` | `tests/e2e/admin-deeplink.spec.ts` | Tested |
| 14 | Legal and account pages offer a working back control | legal layout | `legal-back.test.tsx` | Tested |

### 2. Buttons and controls

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 15 | Buttons share one hover and active transition recipe | `index.css:722` | code audit | Inspected |
| 16 | Press feedback scales to .97 and is removed under reduced motion | `index.css:197,736` | code audit | Inspected |
| 17 | Disabled buttons block activation and show not-allowed | `index.css:737` | code audit | Inspected |
| 18 | Loading buttons expose a busy label and ignore repeat clicks | `ConfirmDialog`, `.btn-loading` | `interaction-polish.test.tsx` | Tested |
| 19 | Destructive confirmations use a distinct danger button | `ConfirmDialog` | `interaction-polish.test.tsx` | Tested |
| 20 | Icon-only header controls all have accessible names | `Layout.tsx` | `tests/e2e/interactions.spec.ts` | Tested |
| 21 | Bookmark toggles aria-pressed and confirms in a toast | `PostCard.tsx:482` | `PostCard.test.tsx` | Tested |
| 22 | Reaction flips optimistically and rolls back on API failure | `PostCard.tsx:211` | `optimistic.test.ts`, `feedReactionMerge.test.ts` | Tested |
| 23 | Comment count links to the discussion with a label | `PostCard.tsx:457` | code audit | Inspected |
| 24 | Report button opens the shared report dialog | `PostCard.tsx:502`, `ReportDialog` | `ui.test.tsx` | Tested |
| 25 | Copy-link confirms with a copied icon and toast | `PostDetail.tsx:625` | code audit | Inspected |
| 26 | Vote controls disable while a vote request is pending | `PollCard.tsx` | code audit | Inspected |
| 27 | Community join and leave reflect the server response | `CommunityDetail.tsx` | `CommunityDetail.extra.test.tsx` | Tested |
| 28 | Admin quick actions publish to the live banner | `QuickActions.tsx` | `QuickActions.test.tsx` | Tested |
| 29 | CSV export shows a busy state then downloads | `ExportCSVButton.tsx` | `ExportCSVButton.test.tsx` | Tested |
| 30 | Theme toggle persists the choice per device | `Layout.tsx`, `Settings.tsx` | `Settings.extra.test.tsx` | Tested |
| 31 | Install prompt appears only after the browser install event | `InstallPrompt.tsx` | `installPrompt.test.tsx` | Tested |

### 3. Forms and inputs

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 32 | All inputs share the focus ring and border transition | `index.css` | code audit | Inspected |
| 33 | Search inputs expose accessible names and a clear control | `Search.tsx`, `Home.tsx` | code audit | Inspected |
| 34 | Clear button empties the search field and results | `Search.tsx`, `SearchInput` | `tests/e2e/interactions.spec.ts` | Tested |
| 35 | Title validation marks the field invalid and links help text | `Submit.tsx:1874` | `Submit.test.tsx` | Tested |
| 36 | Description validation mirrors the same ARIA contract | `Submit.tsx:2125` | `Submit.test.tsx` | Tested |
| 37 | Category picker commits only after a valid selection | `Submit.tsx` | `Submit.test.tsx` | Tested |
| 38 | Anonymous toggle explains what is and is not stored | `Submit.tsx` | `Submit.unifiedReview.test.tsx` | Tested |
| 39 | Draft autosave reports saved or failed, never fake success | `Submit.tsx:163` | `draft-honesty.test.tsx` | Tested |
| 40 | Discard draft uses a two-tap arming step | `Submit.tsx:171` | `Submit.extra.test.tsx` | Tested |
| 41 | Image upload previews, validates, and can be removed | `Submit.tsx` | `image.test.ts` | Tested |
| 42 | Poll options add and remove within min and max bounds | `Submit.tsx` | `Submit.test.tsx` | Tested |
| 43 | Multiple-choice poll toggle changes the payload shape | `Submit.tsx` | `Submit.extra.test.tsx` | Tested |
| 44 | Publish passes through a review step with editable fields | `Submit.tsx` | `Submit.unifiedReview.test.tsx` | Tested |
| 45 | Success animation plays only after the create request resolves | `Submit.tsx`, `Confetti.tsx` | code audit | Inspected |
| 46 | Failed publish keeps the draft and offers a retry | `Submit.tsx` | `draft-honesty.test.tsx` | Tested |
| 47 | Blocked authors get an appeal form instead of a dead end | `AppealPanel.tsx` | `AppealPanel.test.tsx` | Tested |
| 48 | Admin login labels its help text and reports bad credentials | `Admin.tsx:284` | `tests/e2e/admin-login.spec.ts` | Tested |
| 49 | Settings forms confirm saves and surface API errors | `Settings.tsx` | `Settings.test.tsx` | Tested |

### 4. Dashboard and analytics

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 50 | Overview stat tiles show skeletons until data lands | `Overview.tsx` | `Overview.test.tsx` | Tested |
| 51 | Animated counters snap under reduced motion | `CountUp.tsx` | code audit | Inspected |
| 52 | Overview digest filter is a keyboard tablist | `Overview.tsx` | code audit | Inspected |
| 53 | Trend deltas pair an arrow with text, not colour alone | `Trend.tsx`, `RankDelta.tsx` | `rankMotion.test.tsx` | Tested |
| 54 | Pulse strip announces live changes politely | `PulseStrip.tsx:117` | code audit | Inspected |
| 55 | Report deck advances slides with buttons and keys | `ReportDeck.tsx` | `ReportDeck.test.tsx` | Tested |
| 56 | Report deck exports the verified deck spec | deck export module | `deckExport.test.ts` | Tested |
| 57 | Activity report period filter refetches the selected window | `ActivityReport.tsx` | `AdminActivityReport.test.tsx` | Tested |
| 58 | Activity report exports CSV from the current filters | `ActivityReport.tsx` | `audit-report.test.ts` | Tested |
| 59 | System health gauges update from the live snapshot | `SystemHealth.tsx` | code audit | Inspected |
| 60 | Performance center shows measured percentiles, not invented targets | `PerformanceCenter.tsx` | code audit | Inspected |
| 61 | AI usage counters show actual token and cost numbers | `AiSystems.tsx` | `AiSystems.test.tsx` | Tested |
| 62 | Auto-refresh cadence is labelled and pauses in hidden tabs | `useSmartPoll.ts` | `useSmartPoll.test.ts` | Tested |

### 5. User management

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 63 | User search filters server-side after a debounce | `UserManager.tsx` | `UserManager.test.tsx` | Tested |
| 64 | User list loads more rows as it scrolls | `useInfiniteScroll.ts` | `useInfiniteScroll.test.tsx` | Tested |
| 65 | Restriction control offers the three canonical levels | `UserManager.tsx` | code audit | Inspected |
| 66 | Restriction changes require confirmation and write an audit entry | `UserManager.tsx` | code audit | Inspected |
| 67 | Ban and unban capture a reason and reflect the response | `UserManager.tsx` | `UserManager.test.tsx` | Tested |
| 68 | User detail drawer traps focus and closes on Escape | `UserManager.tsx`, `useFocusTrap.ts` | `interaction-polish.test.tsx` | Inspected |
| 69 | Warning history is listed with counts | `UserManager.tsx` | `UserManager.test.tsx` | Tested |
| 70 | Bulk actions operate only on the selected users | `UserManager.tsx` | code audit | Inspected |
| 71 | Empty filtered list explains how to recover | `UserManager.tsx` | `UserManager.test.tsx` | Tested |
| 72 | Row actions disable while their request is in flight | `UserManager.tsx` | code audit | Inspected |
| 73 | Role changes are permission-gated and audited | `UserManager.tsx`, API | `moderation.coverage.test.ts` | Tested |
| 74 | Anonymous identifiers are never resolved to names in user views | API and `UserManager.tsx` | security audit, `identity` suites | Inspected |

### 6. Complaints and case management

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 75 | Status chips pair colour with a text label | `StatusBadge`, `PostCard` | `primitives2.test.tsx` | Tested |
| 76 | Status timeline reports progress via progressbar and stage list | `StatusTimeline.tsx:65` | `StatusTimeline.test.tsx` | Tested |
| 77 | Report dialog submits the selected reason to the API | `ReportDialog` | `ui.test.tsx` | Tested |
| 78 | Report dialog offers canonical reasons plus a free-text option | `ui.tsx` | `ui.test.tsx` | Tested |
| 79 | Report status changes persist and re-render the queue | `Reports.tsx` | `Reports.test.tsx` | Tested |
| 80 | Posts table assigns a case owner inline | `PostsTable.tsx` | `PostsTable.test.tsx` | Tested |
| 81 | Internal notes save without notifying the reporter | `ThreadDrawer` | code audit | Inspected |
| 82 | Dismiss and reopen transitions are reversible and audited | `Reports.tsx` | code audit | Inspected |
| 83 | Report detail drawer exposes the target quote and actions | `ThreadDrawer`, `ReportTargetQuote` | code audit | Inspected |
| 84 | Resolve calls the real endpoint and updates the queue | `Reports.tsx` | `Reports.test.tsx` | Tested |
| 85 | Appeals are reviewed with the original decision visible | `AppealPanel` | `AppealPanel.test.tsx` | Tested |
| 86 | Report queue filters by status, type, and category | `Reports.tsx` | code audit | Inspected |
| 87 | Report search matches title and reason | `Reports.tsx` | code audit | Inspected |
| 88 | Solving board moves cards between real status columns | `SolvingBoard.tsx` | `SolvingBoard.realtime.test.tsx` | Tested |
| 89 | Authors can withdraw their own post after confirmation | `MyActivity` and API | `postWithdrawal.test.ts` | Tested |
| 90 | Empty complaint queue states what will appear there | `Reports.tsx` | `Reports.test.tsx` | Tested |

### 7. Moderation

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 91 | Inline admin bar solves or hides a post after confirmation | `PostCardAdminBar.tsx` | `PostCardAdminBar.test.tsx` | Tested |
| 92 | Comment approval and rejection record a reason | `Comments.tsx` | `Comments.moderation.test.tsx` | Tested |
| 93 | Blocked comments stay hidden until a human unlocks them | `Comments.tsx`, API | `Comments.gate.test.tsx` | Tested |
| 94 | AI moderation output is labelled as a suggestion | `AiSystems.tsx` | code audit | Inspected |
| 95 | No moderation action fires without server confirmation | shared API client | `moderation.test.ts` | Tested |
| 96 | Moderation actions are written to the audit log | API | `audit-report.test.ts` | Tested |
| 97 | Slang and profanity leaders are counted from real content | `SlangLeaders.tsx` | `SlangLeaders.test.tsx` | Tested |
| 98 | Warnings reach the author through notifications | API, `Notifications` | `Notifications.test.tsx` | Tested |
| 99 | Irreversible decisions require an explicit confirm dialog | `ConfirmDialog` | `interaction-polish.test.tsx` | Tested |
| 100 | Moderation buttons disable while their request is pending | `PostCardAdminBar` | code audit | Inspected |
| 101 | Purge actions show a live countdown before they run | `PurgeCountdown.tsx` | code audit | Inspected |
| 102 | Moderator-only controls are hidden from non-moderators | `PostCardAdminBar`, admin shell | `AdminShell.test.tsx` | Tested |
| 103 | Removed content is replaced with an explanatory placeholder | `PostCard`, `PostDetail` | `Comments.states.test.tsx` | Tested |
| 104 | Moderation lists render skeletons rather than blank panels | `SkeletonGroup` | `primitives1.test.tsx` | Tested |

### 8. Real-time updates

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 105 | Student SSE stream reconnects with backoff | `useRealtime` | `useRealtime.test.ts` | Tested |
| 106 | Admin SSE stream authenticates with a short-lived ticket | `useAdminStream.ts` | `useAdminStream.test.tsx` | Tested |
| 107 | Reconnect refetches missed state instead of replaying blindly | `useAdminStream.ts` | `useAdminStream.test.tsx` | Tested |
| 108 | Duplicate events are coalesced before render | `useAdminStream`, `pollDedupe` | `pollDedupe.test.ts` | Tested |
| 109 | Admin events are filtered by role before display | `useAdminStream.ts` | `useAdminStream.test.tsx` | Tested |
| 110 | Anonymous author IDs never appear in live payloads | API and streams | security audit | Inspected |
| 111 | Offline banner appears when connectivity is lost | `Layout.tsx` | `offline.test.ts` | Tested |
| 112 | Queued actions flush when the connection returns | `Layout.tsx` flushQueue | `offline.test.ts` | Tested |
| 113 | Stale data is labelled instead of looking live | `UpdateNotice`, `PulseStrip` | `UpdateNotice.test.tsx` | Tested |
| 114 | Unread badge updates from real notification events | `Layout.tsx` | code audit | Inspected |
| 115 | New feed posts appear as a pill, not a scroll jump | `Home.tsx` | `Home.realtime.test.tsx` | Tested |
| 116 | New comments append without duplicating existing ones | `Comments.tsx` | `Comments.realtime.test.tsx` | Tested |
| 117 | Solving board columns update live | `SolvingBoard` | `SolvingBoard.realtime.test.tsx` | Tested |
| 118 | Unified inbox thread list updates live | `UnifiedInbox` | `InboxStream.test.tsx` | Tested |
| 119 | Poll results refresh after a confirmed vote | `PollCard` | code audit | Inspected |

### 9. Notifications

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 120 | Bell reports aria-expanded and controls its panel | `Layout.tsx:606` | `tests/e2e/interactions.spec.ts` | Tested |
| 121 | Notification panel closes on Escape and outside click | `Layout.tsx` | `tests/e2e/interactions.spec.ts` | Tested |
| 122 | Unread count comes from the server and clamps at 99+ | `Layout.tsx` | code audit | Inspected |
| 123 | Badge replays its pop when the count changes | `Layout.tsx` | code audit | Inspected |
| 124 | Mark all read persists and clears the badge | `Notifications.tsx` | code audit | Inspected |
| 125 | Clear all requires confirmation | `Notifications.tsx` | code audit | Inspected |
| 126 | Notification filters separate unread and types | `Notifications.tsx` | code audit | Inspected |
| 127 | Opening a notification marks it read and follows the link | `Notifications.tsx` | `Notifications.test.tsx` | Tested |
| 128 | Browser notifications fire for admin activity with permission | `useAdminStream`, service worker | `browserNotify.test.ts` | Tested |
| 129 | Notification permission is requested only after opt-in | `Settings`, stream hook | code audit | Inspected |
| 130 | Toasts are announced politely and can be dismissed | `ToastHost.tsx:36` | `ToastHost.test.tsx` | Tested |
| 131 | Toast kinds differ by icon and text, not colour alone | `ToastHost.tsx` | `ToastHost.test.tsx` | Tested |
| 132 | Notification empty state explains what triggers one | `Notifications.tsx` | code audit | Inspected |

### 10. Student experience

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 133 | Pull-to-refresh reloads the feed on touch | `usePullToRefresh`, `Home.tsx` | `usePullToRefresh.test.tsx` | Tested |
| 134 | Feed loads one bounded request instead of fake paging | `Home.tsx` | `Home.test.tsx` | Tested |
| 135 | Feed sort tabs respond to arrow keys | `Home.tsx` | `tests/e2e/interactions.spec.ts` | Tested |
| 136 | Status filter tabs respond to arrow keys | `Home.tsx` | code audit | Inspected |
| 137 | Category and type filters narrow the feed | `Home.tsx` | `Home.test.tsx` | Tested |
| 138 | Search-as-you-type never overwrites newer results | `Search.tsx` | `Search.test.tsx` | Tested |
| 139 | Post detail renders comments and reply threads | `PostDetail`, `Comments` | `PostDetail.test.tsx` | Tested |
| 140 | Comment submit disables while sending and restores on failure | `Comments.tsx` | code audit | Inspected |
| 141 | Typing indicator appears only for real peer activity | `TypingIndicator.tsx` | code audit | Inspected |
| 142 | Thanks and reactions update counts from the server | `PostCard` | `PostCard.test.tsx` | Tested |
| 143 | Saved posts tab reflects bookmarks | `Saved.tsx` | `Saved.test.tsx` | Tested |
| 144 | My Activity groups posts, comments, and votes | `MyActivity.tsx` | `MyActivity.test.tsx` | Tested |
| 145 | My Activity exports a personal archive | `MyActivity` | `MyActivityExport.test.ts` | Tested |
| 146 | Preferences persist per device | `Settings.tsx` | `Settings.test.tsx` | Tested |
| 147 | PWA install prompt offers platform-correct instructions | `InstallPrompt` | `installPrompt.test.tsx` | Tested |
| 148 | Offline behaviour is honest: banner and queue, no fake cached pages | `Layout.tsx`, `public/sw.js` | `offline.test.ts` | Partial |
| 149 | Inline poll votes without leaving the feed | `PostCard.tsx:520`, `PollCard` | `PollCard.test.tsx` | Tested |

### 11. Search and filters

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 150 | Advanced search submits on Enter and on the button | `Search.tsx` | `Search.test.tsx` | Tested |
| 151 | Type filter passes the selected scope to the API | `Search.tsx` | `Search.test.tsx` | Tested |
| 152 | Category filter passes the selected category | `Search.tsx` | `Search.test.tsx` | Tested |
| 153 | Status filter narrows results | `Search.tsx` | `Search.test.tsx` | Tested |
| 154 | Result counts are announced when they change | `Search.tsx` | code audit | Inspected |
| 155 | Clear resets query, results, and searched state | `Search.tsx` | `tests/e2e/interactions.spec.ts` | Tested |
| 156 | No-results state suggests broadening the search | `Search.tsx` | `Search.test.tsx` | Tested |
| 157 | Search errors show a retry that reuses the query | `Search.tsx` | `Search.test.tsx` | Tested |
| 158 | Command palette hides admin destinations from regular users | `CommandPalette` | `CommandPalette.test.tsx` | Tested |
| 159 | Admin tables filter server-side with a debounce | `UserManager`, `Logs` | `Logs.test.tsx` | Tested |
| 160 | Audit filters support a date range and reset | `Logs.tsx` | code audit | Inspected |
| 161 | Active filter chips can be removed one at a time | `Home.tsx` | code audit | Inspected |

### 12. AI assistance

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 162 | AI rewrite returns a reviewable draft, applied only on click | `Submit.tsx` | `speech.test.ts` | Inspected |
| 163 | AI inbox summary is generated server-side and labelled | `UnifiedInboxAutoSummary` | `UnifiedInboxAutoSummary.test.tsx` | Tested |
| 164 | AI recommendations cite the evidence they were based on | `ActionCardEvidence` | `ActionCardEvidence.test.tsx` | Tested |
| 165 | AI failure shows a real error and no invented content | `Submit.tsx`, API | `speech.test.ts` | Tested |
| 166 | AI thinking state is bounded and cancellable | `ThinkingBubble.tsx` | code audit | Inspected |
| 167 | Typewriter reveal respects reduced motion | `Typewriter.tsx` | code audit | Inspected |
| 168 | AI cannot execute irreversible actions without human approval | `ApprovalAlert` | `ApprovalAlert.test.tsx` | Tested |
| 169 | Provider test status is shown, including failures | `ProviderSettings.tsx` | `ProviderSettings.test.tsx` | Tested |
| 170 | AI decisions are logged for review | `AiSystems` and audit | code audit | Inspected |

### 13. Workflow automation

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 171 | Action Center lists every open human task | `ActionCenter.tsx` | `ActionCenter.test.tsx` | Tested |
| 172 | Action previews render the exact payload before approval | `ActionPreviewRouter` | `ActionPreviewRouter.test.tsx` | Tested |
| 173 | Approve and reject require a recorded reason | `ApprovalAlert` | `ApprovalAlert.test.tsx` | Tested |
| 174 | Bulk approval skips tasks another admin already claimed | `ActionCenter` | code audit | Inspected |
| 175 | Scheduled jobs show last run and next run | `OpsCenter` | `OpsCenter.test.tsx` | Tested |
| 176 | Automations can be paused and resumed | `OpsCenter` | `OpsCenter.extra.test.tsx` | Tested |
| 177 | Work sections group tasks into real columns | `WorkSections.tsx` | code audit | Inspected |
| 178 | Work items transition state only after the API confirms | `WorkItem.tsx` | code audit | Inspected |
| 179 | Automation run logs are filterable and exportable | `OpsCenter`, `Logs` | `Logs.test.tsx` | Tested |

### 14. Settings and security

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 180 | Theme selection applies instantly and persists | `Settings.tsx` | `Settings.extra.test.tsx` | Tested |
| 181 | Anonymous ID can be copied and exported | `Settings.tsx:139` | `Settings-identity.test.tsx` | Tested |
| 182 | Reset identity is guarded and warns that it is irreversible | `Settings.tsx` | `Settings-identity.test.tsx` | Tested |
| 183 | Identity can be adopted on a second device by code | `PairingQRCode`, `Settings` | `identityLink.test.ts` | Tested |
| 184 | Admin sessions expire and redirect to login | `Admin.tsx` | `tests/e2e/admin-login.spec.ts` | Tested |
| 185 | Admin token is kept in session storage, not local storage | admin auth module | `platform.test.ts` | Inspected |
| 186 | Permissions are enforced server-side | API middleware | `moderation.coverage.test.ts`, `api.test.ts` | Tested |
| 187 | Security center lists real alerts and dismissals | `SecurityCenter.tsx` | `SecurityCenter.test.tsx` | Tested |
| 188 | Audit log filters, paginates, and exports | `Logs.tsx` | `Logs.test.tsx` | Tested |
| 189 | Provider secrets are write-only and masked | `AdminSettings.tsx` | `admin-settings-ai-posture.test.tsx` | Tested |
| 190 | Danger-zone purge shows a countdown and requires confirmation | admin settings | code audit | Inspected |

### 15. Accessibility and finishing touches

| # | Interaction | Implementation | Evidence | Status |
| ---: | --- | --- | --- | --- |
| 191 | Focus is restored after every modal and drawer closes | `useFocusTrap.ts` | `interaction-polish.test.tsx` | Tested |
| 192 | Dialogs are labelled and modal to assistive tech | `Modal`, `Tutorial`, `CommandPalette` | `tests/e2e/interactions.spec.ts`, `ui.test.tsx` | Tested |
| 193 | Status is never communicated by colour alone | `StatusBadge`, `Trend` | `primitives2.test.tsx` | Tested |
| 194 | Toast and live regions do not steal focus | `ToastHost` | `ToastHost.test.tsx` | Tested |
| 195 | Tap targets meet 44px on touch layouts | `index.css:853` | code audit | Inspected |
| 196 | Layout has no horizontal overflow at phone widths | global layout | `tests/e2e/no-horizontal-overflow.spec.ts` | Tested |
| 197 | Primary keyboard paths are regression-tested | global | `tests/e2e/interactions.spec.ts`, `a11y-claims.spec.ts` | Tested |
| 198 | CSS and React motion both honour reduced motion | `magnetic-button`, `animated-list`, `CountUp` | `tests/e2e/interactions.spec.ts`, `rankMotion.test.tsx` | Tested |
| 199 | Icon-only admin buttons all carry accessible names | admin shell | code audit | Inspected |
| 200 | Skip link, focus ring, and dialog contract are regression-tested | suite | `tests/e2e/interactions.spec.ts` | Tested |

## Limitations and unproven claims

- **Only the items marked Tested have an automated assertion.** The inspected items were verified by reading the implementation and its API path, not by an executable test. Do not describe the full 200 as tested.
- **The E2E interaction suite proves nine cross-cutting contracts**, not 200 individual behaviours. It runs against a local dev server, not production.
- **Offline is intentionally partial.** `public/sw.js` installs no fetch handler, so the app does not serve cached pages offline; it shows an offline banner and flushes queued actions on reconnect. That avoids stale-asset bugs but means "offline access" is not claimed.
- **No manual screen-reader or real-device touch pass was performed in this session.** Automated checks cover names, roles, focus order, overflow, and reduced motion only.
- **No 5,000-user claim.** Earlier load evidence passed at 250 virtual users and degraded at 500 (503s); see `IMPLEMENTATION-REPORT.md`. Nothing in this pass changes that.
- **Production has not been redeployed.** The live web build remains 2.0.1 while the local tree is 2.0.2. The Android APK and Windows EXE were not rebuilt in this pass.

## Verification commands

```bash
node scripts/vitest-run.mjs run src/__tests__/ui.test.tsx src/__tests__/ToastHost.test.tsx src/__tests__/interaction-polish.test.tsx
npx tsc -b --force
npx eslint src/components/ui.tsx src/components/ToastHost.tsx src/components/Layout.tsx src/lib/tablist.ts
VB_PORT=5199 npx playwright test tests/e2e/interactions.spec.ts
npm run test:raw        # full UI suite
npm run test:api        # API suite
npm run build
npm run lint
```
