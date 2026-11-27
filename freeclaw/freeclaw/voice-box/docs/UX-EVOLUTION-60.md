# UX evolution — sessions 51–110

Continues the 50-item UI/motion list (sections I–VII) already on the table.
Nothing here repeats those 60 items, `docs/BACKLOG-50.md`, or
`docs/IMPROVEMENTS-BACKLOG.md`. Rule stays the same: each entry is sized so one
turn can spec → build → test it, and nothing is half-built.

Grounding notes — already on disk, so do **not** re-spec them:

| Your item | Reality |
|---|---|
| 10 / 37 — tactile sound + haptics | Shipped: `src/lib/haptics.ts` (`triggerHaptic` — Web Audio click + `navigator.vibrate`), used in `PostCard`, `PollCard`, `CommunityDetail`, `AppealPanel`. |
| 36 — pull-to-refresh | Shipped: `src/hooks/usePullToRefresh.ts`, wired on Home. |
| 50 — confetti on resolve | Shipped: `src/components/Confetti.tsx`. |
| 24 / 38 — skeletons, layout shift | Partly there; the *gap* is item 86 below (identical-height cross-fade on every card type). |
| 48 — prefetch on hover | `src/lib/routeChunks.ts` exists but only wires boot/fallback; item 109 is the hover/touch extension. |
| Mobile notifications | Root cause fixed on this branch (`src/lib/browserNotify.ts` + `public/sw.js`). |
| Animation list 1–4 — FLIP reorder, delta chip, poll bar settle, spring count | Shipped on this branch: `src/hooks/useFlipList.ts` (pure-reorder FLIP, reduced-motion and no-WAAPI safe), `src/components/RankDelta.tsx` ("↑2 / ↓1", 3s), `.vb-poll-fill` (600ms width settle + one leading-edge sweep). Locked by `src/__tests__/rankMotion.test.tsx`. |

---

## I. Live communities & presence (51–58)

**51. Presence constellation** — in the community header, show up to 5 member
avatars that drift in/out with a soft ring plus "3 here now".
*Done when:* presence comes from the existing realtime contract (no extra
polling), and reduced-motion renders a static row.

**52. Join-gate preview mode** — a non-member sees the thread read-only: reactions
and the composer are replaced by one locked strip, "Join to react · 12 members".
*Done when:* the server still enforces join-before-react (the 403 path), and the
UI never shows a control that would fail.

**53. Roster sheet** — tap "12 members" → bottom sheet with join dates, creator
crown, and a live dot per member who is here now.
*Done when:* sheet traps focus, Esc closes it, and restores focus to the trigger.

**54. Per-community notification mute** — a bell in the community header with
three states (everything / mentions / off), persisted per slug.
*Done when:* muting suppresses the in-app toast and browser notification for that
slug only, and the choice survives reload.

**55. Pinned thread** — the creator pins one discussion thread; it renders as a
gold-hairline card above the feed instead of in sort order.
*Done when:* pin/unpin is creator-or-admin only, and the pinned card is excluded
from the normal list (no duplicate).

**56. Classroom invite card** — "Invite" generates a join link plus a QR
(`qrcode` is already a dependency) sized for a projector.
*Done when:* the QR encodes the real join URL, and a download-PNG action works
offline.

**57. Community pulse strip** — a 7-bar micro chart of the last 24h (posts,
reactions, joins) in the header, no axes.
*Done when:* the numbers are computed server-side in the community payload, not
by N client requests.

**58. First-post coach** — empty community shows three sample frames ("ask a
question", "report a problem", "share a win") that prefill the composer.
*Done when:* prefilled text is editable and the coach disappears after the first
real post.

## II. Notification centre craft (59–66)

**59. Grouped stack** — five updates on the same post collapse into one row,
"5 updates · latest 2m ago", expanding in place.
*Done when:* grouping is stable across refreshes and unread count still equals
the number of underlying events.

**60. Swipe-to-dismiss with undo** — swipe a row away, one 5s undo pill.
*Done when:* dismissing is optimistic, undo restores exact order and unread
state, and a failed server call reverts silently.

**61. Mark-all-read ripple** — rows dim in a 40ms cascade instead of vanishing.
*Done when:* the cascade respects reduced-motion and the badge hits 0 in the same
frame the last row dims.

**62. Preference matrix** — Settings gets a per-type grid (replies, reactions,
votes, admin announcements, polls) with a "send me a test" button per row.
*Done when:* the test notification arrives through the same path a real one
would, on the device in hand.

**63. Quiet hours** — suppress 22:00–07:00 local, digest at 07:00 as one row.
*Done when:* timezone comes from the device, the digest is a real summary, and
staff announcements can opt out of suppression.

**64. Cross-device badge parity** — one unread endpoint the tab, PWA and any
second window read; changing one updates the others.
*Done when:* two open windows agree within 2s without either subscribing to the
full feed.

**65. Toast budget** — at most two toasts visible; the third folds into "+1".
*Done when:* folding never drops a toast with an action button (action toasts
queue instead).

**66. Deep-link precision** — a notification tap opens the exact comment and
flashes it, not just the post.
*Done when:* the anchor scrolls into view with a 1.2s highlight and the back
button returns to the notification list.

## III. Search, discovery, palette (67–73)

**67. Search as you type** — 150ms debounce with abortable requests on Search and
the feed filter.
*Done when:* a superseded request can never overwrite newer results, and the
input never blocks.

**68. Empty-search suggestions** — focusing an empty search shows 4 recent
queries and 3 trending categories as chips.
*Done when:* recent queries are stored locally, capped at 8, and clearable.

**69. Filter memory** — feed tab, category and sort survive navigation and
back/forward.
*Done when:* leaving to a post and returning restores the same scroll position
and filters.

**70. Palette actions, not just links** — `⌘K` gains "mark all read", "toggle
theme", "report a bug", "copy my anonymous ID", ranked with fuzzy scoring.
*Done when:* arrow keys walk results and Enter runs the highlighted action.

**71. No-results rescue** — zero hits shows the 3 nearest titles and "did you
mean…" for a likely typo.
*Done when:* the suggestion is computed client-side from the already-fetched
page (no extra endpoint).

**72. In-post comment search** — a small field in the comments header filters a
long thread.
*Done when:* filtering keeps the reply hierarchy readable and shows "showing 3 of
48".

**73. Keyboard search loop** — `/` focuses search, `↑↓` walks results, `Enter`
opens, `Esc` returns focus to where it was.
*Done when:* the whole loop works with the mouse untouched, from Feed and Search.

## IV. Submit & draft craft (74–81)

**74. Draft history** — keep the last 3 local drafts, restorable from the
discard menu.
*Done when:* restoring is one tap, and a draft is only evicted by a fourth one,
never by a reload.

**75. Plain-words verdict** — every flag in the unified review card gets one
sentence a student can act on ("remove the phone number in line 2") instead of a
category name.
*Done when:* no flag string is shown without a fix sentence, and the fix sentence
names the offending snippet.

**76. Attachment strip** — thumbnails with per-file remove and a size budget bar.
*Done when:* removing a file frees the budget immediately and the publish button
re-enables without a re-render flash.

**77. Pre-publish checklist** — a chip row (title, category, media, duplicates)
that turns individually green as each condition is met.
*Done when:* the chips reflect the same checks the server runs, so no chip is
green when publish would be refused.

**78. Private-mode explainer** — tapping the padlock opens a sheet with a snapped
padlock and a one-glance "who can see this" diagram.
*Done when:* the sheet states plainly that private posts skip the public feed and
never appear in search.

**79. Unsaved-changes guard** — back/close with text in the composer asks once.
*Done when:* the guard fires on router navigation and `beforeunload`, and never on
a successful publish.

**80. Failure keeps the text** — a failed publish preserves fields and attachments
and offers one retry with the error class ("network" vs "server").
*Done when:* retry reuses the same idempotency key so a duplicate post can't be
created.

**81. Publish receipt** — after success, a small card with the post id, "editable
for 15 minutes", and a copy-link.
*Done when:* the edit window is enforced server-side, not by hiding the button.

## V. Reading & feed experience (82–88)

**82. Compressing post header** — the title shrinks into a sticky bar as you
scroll, so context never leaves the screen.
*Done when:* the sticky bar appears only after the real header scrolls out, with
no jump at the threshold.

**83. Reading progress** — a 2px hairline at the very top of a long post.
*Done when:* it's driven by scroll position with `transform: scaleX` (no layout
work per frame).

**84. Focus mode** — measure widens to ~68ch and chrome dims while reading.
*Done when:* toggling restores the exact scroll offset and the choice persists.

**85. Jump-to-new pill** — "2 new comments" appears when realtime delivers more
while you're reading, and never auto-scrolls under your thumb.
*Done when:* tapping scrolls smoothly to the first new comment and marks it.

**86. Identical-height cross-fade** — every skeleton reserves the loaded card's
exact height, then cross-fades.
*Done when:* a measured CLS of 0 on Feed, Polls, Saved and Communities at 3G
throttle.

**87. Read-more with anchor** — long descriptions collapse at 6 lines; expanding
keeps the button under the thumb.
*Done when:* collapsing again returns you to the same scroll position.

**88. Image lightbox** — swipe, pinch, arrow keys, and the alt text as a caption.
*Done when:* Esc closes, focus returns, and the image is a proper dialog with a
label.

## VI. Voice & AI surfaces (89–95)

**89. Record countdown** — 3-2-1 ring before capture starts; tap to cancel.
*Done when:* the countdown cannot start the mic after cancellation, and it's
skipped for re-records.

**90. Silence auto-stop** — stop after ~30s of silence with "we stopped — keep
going?" and the take preserved.
*Done when:* resuming appends to the same take instead of starting a new one.

**91. Editable transcript** — the transcript is a textarea before structuring,
with low-confidence words underlined.
*Done when:* hand-corrections flow into the structured complaint and the
confidence marks clear on edit.

**92. Mic permission recovery** — on denial, show the exact steps per browser with
a "try again" that re-probes without a reload, plus "type instead".
*Done when:* a denied user can complete a report entirely by typing from that
card.

**93. Suggestion fade-in** — each AI suggestion fades in over 200ms instead of
popping in and shoving the card taller.
*Done when:* the card's height reserves space for the expected suggestion count
so nothing below moves.

**94. Thinking budget** — after 6s of a pending AI call, the spinner becomes
"still working…" with a cancel that keeps the typed text.
*Done when:* no surface can show a spinner past 20s without either a cancel or an
error.

**95. Suggestion telemetry** — count applies vs dismissals per suggestion type,
surfaced in admin AIQuality.
*Done when:* the numbers come from real user actions and no text is logged.

## VII. Admin console craft (96–102)

**96. Admin palette** — `⌘K` inside `/admin` jumps to any tab, queue, or user id.
*Done when:* role is re-checked server-side on every jump target, not in the
palette.

**97. Age-hued queue rows** — row chrome shifts hue with wait time (fresh → warm →
overdue) so the oldest complaint is visible without sorting.
*Done when:* the hue uses the same SLA thresholds the SLA worker enforces.

**98. Bulk with a receipt** — bulk approve/resolve shows an outcome summary
("5 resolved · 1 blocked for review") instead of a silent list change.
*Done when:* partial failures are itemised and re-runnable for just the failures.

**99. Undo for destructive admin actions** — resolve, hide, and delete give a 5s
undo that restores the row via the existing optimistic snapshot.
*Done when:* undo is server-confirmed, not just a UI revert, and the audit log
records both the action and the reversal.

**100. Incident banner** — a one-tap school-wide announcement with a preview and
an optional end time.
*Done when:* the preview renders the real banner component, and expiry is enforced
server-side.

**101. Evidence-first report layout** — original text up top, redactions inline
with a reason chip, then AI flags, then history.
*Done when:* an admin can decide without scrolling past metadata.

**102. Density toggle** — comfortable/compact row density plus verified
dark-mode parity across admin tables.
*Done when:* compact mode fits 30% more rows with no clipped cell, and both themes
pass contrast on every badge.

## VIII. Resilience, accessibility, platform (103–110)

**103. Outbox UI** — an offline pill ("2 actions queued") that opens a list of
each queued action with cancel and a per-item retry.
*Done when:* the queue's owner filter is respected (no replaying another
identity's writes) and the count matches `vb:offlineQueue`.

**104. Honest error surfaces** — every section has "couldn't load — retry" with a
copyable error id, never a blank region.
*Done when:* a forced 500 on each top route renders that state and the retry
recovers without a reload.

**105. Focus and skip link** — a visible 2px focus ring token and a
skip-to-content link.
*Done when:* tabbing from the top reaches the feed in one press and the ring is
visible on light and dark surfaces.

**106. Live-region announcer** — realtime arrivals announce politely ("3 new
posts", "1 new comment") without stealing focus.
*Done when:* repeats are debounced so a burst is one announcement, and silent mode
turns it off.

**107. Sheet and modal audit** — every overlay traps focus, closes on Esc, and
restores the trigger.
*Done when:* `useFocusTrap` covers each overlay (today it's only the layout
drawer) and a test asserts the restore.

**108. 200% zoom and 320px reflow** — audit and fix the six busiest routes.
*Done when:* no control is clipped, no horizontal scroll, and tap targets stay
≥44px at 200% zoom.

**109. Nav prefetch on intent** — hover (desktop) and `touchstart` (mobile) start
the route chunk before the click lands.
*Done when:* the chunk is already resolved on click >90% of the time in a local
run, and prefetch is skipped on `saveData`.

**110. Performance budgets in CI** — ceilings for the entry bundle, each route
chunk, and feed LCP, failing the build on regression.
*Done when:* a deliberately oversized import fails CI with the offending chunk
named.

---

### Picking order that maximises perceived quality per session

1. **66 → 59 → 60** (notifications feel reliable, not just delivered)
2. **52 → 53 → 51** (communities stop looking broken to non-members)
3. **86 → 109** (nothing jumps, navigation feels instant)
4. **75 → 77** (the review card explains itself in student words)
5. **103 → 104** (flaky school Wi-Fi stops producing blank screens)
