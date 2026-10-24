# 4. Usability Glitches
Unexpected behaviors that negatively impact user experience. Every entry names the mechanism, the failure mode, and the detection surface.

### BUG-UX-001 — Bulk delete jumps the list to the top
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user deletes an item from the middle of a long list; the list re-renders and the viewport jumps to the top instead of staying near the deleted row. Mechanism: the mutation's `invalidateQueries` refetch replaces the list's data and the list container remounts (new `key` or a conditional-render branch), discarding `scrollTop`. Detection: a Playwright test scrolls to item N, deletes it, and asserts the viewport still shows items near N; a DOM check asserts the scroll container's `scrollTop` is unchanged after the refetch resolves.
- **Real-world example:** The bulk-delete scroll-jump class reported repeatedly against React Query-based admin UIs, where cache invalidation remounts the list. It recurs whenever a refetch replaces (rather than patches) list state without preserving scroll.

### BUG-UX-002 — Scroll resets when filters or sort change
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user applies a filter or sort to a long list; the viewport jumps to the top even when the results fit on one screen. Mechanism: changing the filter/sort key changes the list component's `key` prop or remounts it via a conditional branch, discarding `scrollTop`. Detection: a browser test scrolls down, applies a filter, and asserts the scroll container's `scrollTop` is unchanged; a state check compares container identity (`key`) before and after the filter change.
- **Real-world example:** The scroll-reset-on-filter-change class in data-table UIs built on TanStack Table, where controlled filter state remounts the table body. It also recurs in dashboards that re-key the list on every search-param change.

### BUG-UX-003 — Scroll position lost on back-navigation
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user scrolls deep into a list, opens a detail page, and presses Back; the list renders from the top instead of the previous position. Mechanism: the SPA router renders a fresh list instance on return and no scroll restoration is configured (React Router's `scrollRestoration` or a session-stored offset). Detection: a Playwright test scrolls to a known item, navigates to the detail route, goes Back, and asserts the viewport still shows that item; a state check asserts the list's `scrollTop` equals the stored offset on remount.
- **Real-world example:** The lost-scroll-position-on-back class documented for SPA routers; React Router and Next.js both ship explicit scroll-restoration APIs because the default loses position.

### BUG-UX-004 — Infinite scroll loses position while loading more
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user scrolls a paginated feed and the "load more" fetch causes the viewport to jump or the list to flash. Mechanism: the fetch replaces the items array instead of appending, or item keys are regenerated, so React reconciles the whole list and scroll anchoring fails. Detection: a browser test loads page 2 of an infinite list and asserts the first visible item is unchanged with no duplicates; a state check asserts the array grew by append with previous items preserved by identity.
- **Real-world example:** The infinite-scroll-lose-position class in feed UIs where the page counter lives in component state and a remount resets it. The append-vs-replace distinction is the recurring root cause.

### BUG-UX-005 — Modal scroll-lock leaks after close
- **Category:** Usability Glitch · scroll-lock
- **Description:** The user closes a modal and the page behind it can no longer scroll. Mechanism: the open handler sets `document.body.style.overflow = 'hidden'` but the restore only runs on the happy path — an early return, error boundary, or navigation-away unmount skips the cleanup. Detection: a UI test opens a modal, force-unmounts it by navigating away, and asserts `document.body.style.overflow` is restored; a state check snapshots body styles before and after every close path.
- **Real-world example:** The body-scroll-lock-leak class; the `body-scroll-lock` npm package exists specifically because hand-rolled `overflow: hidden` toggles leak on unmount.

### BUG-UX-006 — Scroll anchoring miscalculated after item removal
- **Category:** Usability Glitch · scroll-anchoring
- **Description:** The user deletes an item near the top of a long list; content below shifts and the reading position lands on the wrong row. Mechanism: the browser's CSS scroll anchoring (`overflow-anchor`) pins to a node that is removed or re-keyed, so the anchor is recomputed against a different element; frameworks that disable `overflow-anchor` and hand-roll offset math compute the delta wrong. Detection: a browser test deletes item N and asserts the item visually below N keeps the same viewport offset; a state check compares pre/post `scrollTop` deltas against the removed item's height.
- **Real-world example:** The scroll-jump-after-delete class in chat and feed clients where items are removed above the viewport. Chrome's scroll-anchoring behavior exists for exactly this class of bug.

### BUG-UX-007 — Horizontal scroll appears on mobile
- **Category:** Usability Glitch · horizontal-overflow
- **Description:** The user loads a page on a phone and can scroll sideways into blank space. Mechanism: an element wider than the viewport (a `100vw` container plus padding, a fixed-px table, or a long unbroken string) overflows without `overflow-x: hidden` or a scroll container. Detection: a browser test at 375px width asserts `document.documentElement.scrollWidth <= window.innerWidth`; a DOM audit walks elements and flags any whose bounding rect exceeds the viewport.
- **Real-world example:** The mobile horizontal-overflow class; web.dev's responsive audits flag `scrollWidth > innerWidth` as a top mobile defect.

### BUG-UX-008 — Sticky header overlaps content and anchor targets
- **Category:** Usability Glitch · sticky-overlap
- **Description:** The user clicks an anchor link or scrolls to a section and the section's heading hides under the sticky header. Mechanism: `position: sticky` overlays in-flow content but the page provides no compensating `padding-top` or `scroll-margin-top` on target elements. Detection: a browser test clicks an in-page anchor and asserts the target heading's top edge is at or below the header's bottom edge; a DOM check measures the target's rect against the header's rect after navigation.
- **Real-world example:** The anchor-hidden-under-sticky-header class; CSS `scroll-margin-top` is the standard fix and every major docs site uses it.

### BUG-UX-009 — Scrollbar appearance causes layout shift
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user navigates from a short page to a long one; content shifts horizontally when the vertical scrollbar appears. Mechanism: no `scrollbar-gutter: stable` is set, so the scrollbar's width is subtracted from the viewport only when content overflows, reflowing the layout. Detection: a browser test navigates between pages of different heights and asserts the horizontal position of a fixed-width element is unchanged; a state check compares `document.documentElement.clientWidth` across navigations.
- **Real-world example:** The scrollbar-reflow class on desktop browsers, classic on Windows and Linux where scrollbars consume layout width. `scrollbar-gutter` is the CSS Working Group's standard remedy.

### BUG-UX-010 — Pull-to-refresh hijacks scroll in a PWA
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user scrolls up at the top of an installed web app and the browser's native pull-to-refresh reloads the page, losing app state. Mechanism: `overscroll-behavior` is not set to `none`/`contain` on the scroll container, so the browser's default overscroll action (pull-to-refresh on Android Chrome) fires. Detection: a mobile emulation test simulates an overscroll gesture at scrollTop 0 and asserts no navigation event occurs; a CSS audit flags scroll containers missing `overscroll-behavior`.
- **Real-world example:** The pull-to-refresh-state-loss class; MDN documents `overscroll-behavior: none` as the fix and PWAs routinely ship it to protect in-memory state.

### BUG-UX-011 — Carousel snaps past the selected item
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user clicks a carousel dot or next arrow and the scroll lands between two slides or on the wrong one. Mechanism: `scroll-snap-align` targets don't account for `scroll-padding` or container padding, or the programmatic `scrollTo` computes offsets from a container whose padding differs in RTL layout. Detection: a browser test clicks each dot and asserts the corresponding slide's left edge aligns with the container's content-box left edge; a state check asserts `scrollLeft` matches the computed offset per index.
- **Real-world example:** The carousel-misalignment class in RTL locales, documented in CSS scroll-snap guides; RTL `scrollLeft` sign conventions are the recurring trap.

### BUG-UX-012 — Chat auto-scroll fights the user reading history
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user scrolls up to read older messages and the client force-scrolls back to the bottom on every incoming message. Mechanism: a message handler unconditionally sets `scrollTop = scrollHeight` instead of gating on a distance-from-bottom threshold ("user is at bottom" check). Detection: a browser test scrolls up in a chat, delivers a new message via the realtime channel, and asserts the scroll position is unchanged; a state check asserts the scroll handler reads a bottom-proximity flag before scrolling.
- **Real-world example:** The chat-auto-scroll-fight class in every major chat client; Slack, Discord, and Intercom all implement stick-to-bottom logic because the naive version fights the reader.

### BUG-UX-013 — Virtualized list jumps when estimated row heights are wrong
- **Category:** Usability Glitch · scroll-anchoring
- **Description:** The user scrolls a virtualized list and the viewport jumps backward or content flickers as rows render. Mechanism: `estimateSize` returns heights that diverge from actual rendered heights, so the virtualizer's cumulative offset math drifts and repositions the scroll container. Detection: a browser test scrolls the full list and asserts total scroll height stays monotonic (no negative deltas); a state check compares estimated vs measured heights per row and flags divergence over a threshold.
- **Real-world example:** The react-window/react-virtual estimate-drift class; both libraries document measurement-correction APIs precisely because estimated heights drift for variable content.

### BUG-UX-014 — IntersectionObserver fires twice, duplicating page loads
- **Category:** Usability Glitch · scroll-anchoring
- **Description:** The user scrolls to the bottom sentinel of an infinite list and the next page loads twice, duplicating items and jumping the scroll. Mechanism: the observer callback fires on intersect and again before the in-flight guard is set, because the guard is assigned asynchronously (inside the fetch's `.then`) rather than synchronously in the callback. Detection: a browser test scrolls to the sentinel and asserts exactly one fetch fires (network request count) and item count equals one page's worth; a state check asserts the guard flag is set synchronously before any await.
- **Real-world example:** The infinite-scroll-double-fetch class; IntersectionObserver's async callback semantics make the synchronous-guard requirement a documented pattern.

### BUG-UX-015 — Wheel listener with preventDefault breaks trackpad scrolling
- **Category:** Usability Glitch · scroll-lock
- **Description:** The user scrolls a section with a trackpad and scrolling stutters, is blocked, or pinch-zooms the page. Mechanism: a `wheel` event listener registered with `passive: false` calls `event.preventDefault()` unconditionally, overriding native scroll and pinch-zoom handling. Detection: a browser test dispatches wheel events and asserts default scroll behavior (scrollTop changes) where no custom behavior is intended; a code audit flags `passive: false` without a gated preventDefault.
- **Real-world example:** The passive-listener class; Chrome warns in DevTools about non-passive event listeners and treats them as a scroll-performance defect.

### BUG-UX-016 — Nested scroll containers leak scroll to the parent
- **Category:** Usability Glitch · scroll-lock
- **Description:** The user scrolls an inner panel to its end and the outer page begins scrolling unexpectedly. Mechanism: the inner scroll container lacks `overscroll-behavior: contain`, so scroll chaining hands the gesture to the ancestor. Detection: a browser test scrolls the inner panel past its boundary and asserts the outer container's `scrollTop` is unchanged; a CSS audit flags nested scroll containers missing `overscroll-behavior`.
- **Real-world example:** The scroll-chaining class in dashboard layouts with inner scrolling panels; MDN documents `overscroll-behavior: contain` as the standard fix.

### BUG-UX-017 — Focus change steals the user's scroll position
- **Category:** Usability Glitch · focus-loss
- **Description:** The user Tabs through a form and the page jumps to elements far below the current view. Mechanism: a focus or blur handler calls `scrollIntoView()` on every focus change, overriding the browser's native minimum-scroll focus behavior. Detection: a browser test Tabs through a form and asserts each focus change scrolls the viewport by less than one viewport height; a code audit flags unconditional `scrollIntoView()` calls in focus handlers.
- **Real-world example:** The forced-scrollIntoView class in long forms and wizards; native focus scrolling is minimum-scroll by design and overriding it breaks the user's position.

### BUG-UX-018 — Scroll jumps when images above the viewport finish loading
- **Category:** Usability Glitch · scroll-anchoring
- **Description:** The user reads a long article and content shifts as images above the current position load. Mechanism: `<img>` elements without `width`/`height` attributes or CSS `aspect-ratio` reserve zero height until load, so layout reflows when each image renders. Detection: a browser test loads the page with images throttled and asserts the position of text below images is stable; Lighthouse's CLS audit flags the unattributed layout shift.
- **Real-world example:** The image-load layout shift class; web.dev documents `width`/`height` and `aspect-ratio` reservation as the fix and CLS is a Core Web Vitals metric.

### BUG-UX-019 — Fast scrolling shows blank rows in a virtualized list
- **Category:** Usability Glitch · scroll-anchoring
- **Description:** The user flings a virtualized list quickly and blank gaps appear where rows haven't rendered yet. Mechanism: the overscan count (rows rendered outside the viewport) is too small for the scroll velocity, so rows render after they enter the viewport. Detection: a browser test simulates fast scrolling and asserts every visible row has content; a state check asserts overscan scales with measured scroll velocity or a configured minimum.
- **Real-world example:** The virtualized-blank-rows class; every virtualization library exposes an overscan option because the default is insufficient for fast scrolling.

### BUG-UX-020 — Tab switch resets the scroll container
- **Category:** Usability Glitch · scroll-reset
- **Description:** The user scrolls a list inside a tab, switches to another tab, and returns; the list renders from the top. Mechanism: tab panels are unmounted on switch (conditional render) instead of hidden with the `hidden` attribute or CSS, so the scroll container is destroyed and recreated. Detection: a browser test scrolls the panel, switches tabs away and back, and asserts `scrollTop` is preserved; a state check asserts tab panels stay in the DOM via hidden attributes.
- **Real-world example:** The tab-unmount-scroll-reset class; WAI-ARIA tabs guidance recommends keeping inactive panels in the DOM (hidden), which incidentally preserves scroll.

### BUG-UX-021 — Load-more button unreachable under a sticky footer
- **Category:** Usability Glitch · sticky-overlap
- **Description:** The user scrolls to the bottom of a list and the "Load more" button hides under a fixed footer overlay. Mechanism: the fixed footer overlays in-flow content and the scroll container provides no bottom padding to clear it. Detection: a browser test scrolls to the bottom, clicks the button's center point, and asserts the click hits the button (elementFromPoint check) not the footer; a DOM audit compares the button's rect against the footer's rect at max scroll.
- **Real-world example:** The fixed-footer-overlap class; the elementFromPoint-based click-interception check is the standard automated catch.

### BUG-UX-022 — Page counter state resets on list remount
- **Category:** Usability Glitch · stale-state
- **Description:** The user is on page 5 of a paginated list, a background refetch completes, and the list jumps to page 1's position. Mechanism: the page counter lives in component state and the refetch path remounts the component (key change or route-driven re-render), resetting the counter to its initial value. Detection: a browser test triggers a background refetch while on page 5 and asserts the visible page is unchanged; a state check asserts the page counter is lifted to URL search params or a store that survives remounts.
- **Real-world example:** The page-counter-reset class in admin dashboards; lifting pagination state to the URL is the documented fix (TanStack Router and Next.js docs both recommend it).

### BUG-UX-023 — Button shipped with an empty click handler
- **Category:** Usability Glitch · dead-button
- **Description:** The user clicks a button that appears interactive; nothing happens because the handler is an empty arrow function. Mechanism: a placeholder `onClick={() => {}}` (or a handler that only logs) shipped to production because the component's contract required an `onClick` prop. Detection: a Playwright test clicks every button and asserts a network request, state change, or navigation occurs; a code audit greps for `onClick={() => {}}`.
- **Real-world example:** The dead-button class; CI-time click-everything smoke tests are the standard automated catch, and the empty-handler grep is a known lint-rule target.

### BUG-UX-024 — Toggle changes only local state, never the backend
- **Category:** Usability Glitch · dead-button
- **Description:** The user flips a settings toggle; it appears to save, but reloading the page shows the old value. Mechanism: the handler calls `setState` only — no API call — or the call fires but its result is discarded and state re-initializes from stale server data. Detection: a browser test toggles the control, reloads, and asserts the value persisted; a network assertion asserts a mutation request fires on change.
- **Real-world example:** The local-state-only-toggle class in settings pages; the reload-asserts-persistence test is the standard catch and mirrors how QA closes "it looked saved" tickets.

### BUG-UX-025 — "Delete" button calls the archive endpoint
- **Category:** Usability Glitch · mislabeled-action
- **Description:** The user clicks Delete on a record; the row disappears from the active list but the record still exists and reappears under an "Archived" filter. Mechanism: the button's handler wires to the archive endpoint (`PATCH /items/:id { archived: true }`) instead of the delete endpoint — a copy-paste handler mismatch. Detection: a network assertion inspects the method and URL fired on click (assert DELETE, not PATCH); an end-to-end test deletes a record and asserts a subsequent GET returns 404.
- **Real-world example:** The mislabeled-action class; API-level assertions on click handlers are the standard catch because the UI affordance (row disappears) is identical for both actions.

### BUG-UX-026 — Trash icon opens the wrong panel
- **Category:** Usability Glitch · icon-mismatch
- **Description:** The user clicks a trash icon expecting deletion; a settings or details panel opens instead. Mechanism: icon and action are wired independently — the icon is chosen in markup while the handler belongs to a different concern, and no mapping enforces the pair. Detection: a browser test clicks each icon-only control and asserts the resulting UI change matches the icon's semantic; a component test asserts icon-to-action pairs from a central dictionary.
- **Real-world example:** The icon-action-mismatch class in icon-heavy toolbars; icon dictionaries with test-enforced pairs are the documented prevention pattern.

### BUG-UX-027 — Duplicate buttons render from a list map
- **Category:** Usability Glitch · duplicate-control
- **Description:** The user sees two identical "Save" buttons on a form where one was intended. Mechanism: a `.map()` renders the button per item with a non-unique or index key, and a data update causes React to reconcile in a way that duplicates the node. Detection: a browser test asserts exactly one instance of each labeled control per form; a render-count assertion counts DOM nodes matching a selector after a data update.
- **Real-world example:** The duplicate-node-from-bad-key class; React's key-reconciliation docs describe index keys with dynamic lists as the recurring duplication source.

### BUG-UX-028 — Dead link with no destination
- **Category:** Usability Glitch · dead-link
- **Description:** The user clicks a link styled as navigable; nothing happens. Mechanism: the anchor uses `href="#"` or `href="javascript:void(0)"` with no click handler, or the handler is attached to a parent that stops propagation. Detection: a browser test clicks every anchor and asserts a navigation, hash change, or handled action occurs; a code audit greps for `href="#"` without a click handler.
- **Real-world example:** The dead-link class in placeholder-heavy marketing pages; link-crawl smoke tests that click every anchor are the standard automated catch.

### BUG-UX-029 — Tooltip contradicts the action
- **Category:** Usability Glitch · icon-mismatch
- **Description:** The user hovers a button whose tooltip says "Copy link" and clicks; the button copies the page URL instead of the record's link. Mechanism: tooltip text and handler were written independently (i18n string vs hardcoded action) and no test ties the pair together. Detection: a component test asserts the tooltip string and the clipboard write value derive from the same constant; a browser test hovers, clicks, and asserts the clipboard content matches the tooltip's promise.
- **Real-world example:** The tooltip-action-contradiction class; clipboard-assertion tests via `navigator.clipboard.readText` are the standard automated catch.

### BUG-UX-030 — Disabled state never re-enables after an error
- **Category:** Usability Glitch · dead-button
- **Description:** The user submits a form that fails; the submit button stays disabled and the form cannot be retried. Mechanism: the handler sets `disabled = true` (or `isSaving = true`) at the start but the re-enable only runs in the success path — the `catch`/`finally` block is missing. Detection: a browser test forces a failed submit (offline emulation or a 500 mock) and asserts the button re-enables; a state check asserts the reset runs in `finally` rather than after `await` in the try block.
- **Real-world example:** The never-re-enable class; the error-path-asserts-recovery test is the standard catch and mirrors the "button stuck disabled" support-ticket pattern.

### BUG-UX-031 — "Learn more" link navigates to the same page
- **Category:** Usability Glitch · dead-link
- **Description:** The user clicks a "Learn more" link and lands on the page they are already on. Mechanism: the anchor's href is self-referential (the current route) — a templating default that was never overridden. Detection: a browser test clicks the link and asserts the resulting URL differs from the current one; a link audit crawls hrefs and flags self-referential navigation links.
- **Real-world example:** The self-referential-link class in template-driven sites; crawl-based href audits flag it mechanically.

### BUG-UX-032 — Link opens a new tab without warning
- **Category:** Usability Glitch · icon-mismatch
- **Description:** The user clicks what looks like an internal navigation link; a new browser tab opens instead, losing their in-page state (scroll, form draft). Mechanism: `target="_blank"` is set on the anchor while the visual style signals internal navigation, with no external-link affordance (icon, title) distinguishing it. Detection: a browser test clicks the link and asserts whether a new page opens (popup event); a code audit flags `target="_blank"` on internal-styled links.
- **Real-world example:** The surprise-new-tab class in docs and marketing sites; popup-detection assertions in Playwright are the standard automated catch.

### BUG-UX-033 — Toggle switch shows the opposite of the underlying state
- **Category:** Usability Glitch · stale-state
- **Description:** The user sees a toggle in the "on" position, but the feature it controls is actually off. Mechanism: the component mixes controlled and uncontrolled behavior — the visual state initializes from a default (or a stale prop) while the actual value comes from elsewhere, and no sync path reconciles them. Detection: a browser test asserts the toggle's visual state matches the underlying feature state (query the setting via API or DOM); a component test asserts the value prop drives the visual state exclusively.
- **Real-world example:** The controlled-uncontrolled-mix class; React's controlled-components guidance describes exactly this desync and the fix (single source of truth).

### BUG-UX-034 — Radio group renders no visible selection
- **Category:** Usability Glitch · dead-button
- **Description:** The user opens a form with a saved radio value; no option appears selected even though the form submits the value. Mechanism: the radio input is visually hidden (custom styling hides the native input) and the custom indicator's checked style is not driven by the input's `:checked` state. Detection: a browser test loads a form with a saved value and asserts the corresponding option has the checked visual state (aria-checked or the custom indicator's class); a CSS audit asserts the indicator style keys off `input:checked`.
- **Real-world example:** The hidden-radio-desync class in custom-styled forms; aria-checked assertions are the standard automated catch.

### BUG-UX-035 — Accordion header dead zone
- **Category:** Usability Glitch · dead-button
- **Description:** The user clicks the visible padding area of an accordion header; it doesn't toggle. Mechanism: the click handler is attached to an inner child (a span or text container) rather than the full-width header button, so clicks outside the child's box are dead. Detection: a browser test clicks the header's edges (padding areas) and asserts the toggle fires; a component test asserts the handler lives on the header button element, not a child.
- **Real-world example:** The click-dead-zone class in custom accordions; WAI-ARIA accordion guidance requires the header to be a full-size button, which incidentally fixes the dead zone.

### BUG-UX-036 — Menu item closes the menu without performing the action
- **Category:** Usability Glitch · dead-button
- **Description:** The user clicks a dropdown menu item; the menu closes and nothing happens. Mechanism: close and action are sequenced incorrectly — the close handler unmounts the menu before the action handler fires, or the action is dispatched to a component that no longer exists. Detection: a browser test clicks each menu item and asserts both the menu closes and the intended action occurs (network request or state change); a state check asserts the action fires before unmount or survives it (lifted handler).
- **Real-world example:** The close-before-action class; click-both-effects assertions are the standard automated catch.

### BUG-UX-037 — Wizard "Back" button advances a step
- **Category:** Usability Glitch · mislabeled-action
- **Description:** The user clicks Back in a multi-step wizard; the wizard advances to the next step instead. Mechanism: the step index arithmetic is inverted — the Back handler increments the index (`setStep(step + 1)`) or the step order array is reversed. Detection: a browser test clicks Back on step 2 and asserts the wizard shows step 1; a component test asserts the handler's delta sign against the step array.
- **Real-world example:** The step-index-off-by-one class in wizard components; asserting the step label after each navigation is the standard automated catch.

### BUG-UX-038 — Icon tooltips stay in the old language after a locale switch
- **Category:** Usability Glitch · stale-state
- **Description:** The user switches the interface language; text updates but icon-button tooltips remain in the old language. Mechanism: tooltips use hardcoded `title` attributes (or stale i18n keys) set imperatively once, so they don't re-render on locale change. Detection: a browser test switches locale and asserts every visible tooltip text matches the new locale's strings; a code audit flags imperative `title=` assignments outside the render path.
- **Real-world example:** The stale-tooltip-i18n class; the switch-locale-assert-all-text test is the standard automated catch.

### BUG-UX-039 — Button inside a form submits unintentionally
- **Category:** Usability Glitch · mislabeled-action
- **Description:** The user clicks a secondary button (e.g., "Add field", "Preview") inside a form; the form submits instead. Mechanism: the button has no explicit `type` attribute, so it defaults to `type="submit"` inside a form and triggers the form's submit handler. Detection: a browser test clicks every non-submit button inside a form and asserts no submit fires; a code audit flags `<button` elements inside `<form` without `type=`.
- **Real-world example:** The default-submit class; the HTML spec makes `type="submit"` the button default inside forms, and HTML validators and jsx-a11y rules flag the missing type.

### BUG-UX-040 — Refresh button shows cached data
- **Category:** Usability Glitch · dead-button
- **Description:** The user clicks a "Refresh" button; the UI re-renders but shows the same data as before the click. Mechanism: the handler re-fetches but the response is served from an HTTP cache (no cache-busting) or the render key doesn't change, so the component reuses the previous render. Detection: a browser test clicks Refresh with a mocked API returning changed data and asserts the UI shows the new data; a network assertion asserts the request bypasses cache.
- **Real-world example:** The refresh-shows-cache class; mocking the API with changed payloads is the standard automated catch.

### BUG-UX-041 — Toggle saves to the server but the form's stale copy overwrites it
- **Category:** Usability Glitch · stale-state
- **Description:** The user flips a toggle (which saves immediately), then edits another field and saves the form; the toggle reverts. Mechanism: two writers own the same field — the toggle writes directly while the form holds its own copy in state, and the form's submit sends its stale copy, last-write-wins. Detection: a browser test flips the toggle, saves the form, and asserts the toggle's value persists; a state check asserts the form's payload reads the live value rather than a captured copy.
- **Real-world example:** The dual-writer-last-write-wins class in settings forms; the interleaved-actions-persist test is the standard automated catch.

### BUG-UX-042 — Copy button copies unformatted text
- **Category:** Usability Glitch · icon-mismatch
- **Description:** The user clicks Copy next to a formatted value (a phone number with spaces, indented JSON); the clipboard receives a different, unformatted string. Mechanism: display value and clipboard value come from different code paths — the display applies formatting while the clipboard writes the raw field — and no shared source reconciles them. Detection: a browser test clicks Copy and asserts the clipboard content equals the displayed text; a component test asserts both derive from one formatter.
- **Real-world example:** The display-clipboard-divergence class; clipboard-read assertions are the standard automated catch.

### BUG-UX-043 — Pagination next button dead on a single page
- **Category:** Usability Glitch · dead-button
- **Description:** The user sees a Next button on a list with exactly one page; clicking does nothing. Mechanism: the pagination edge case (total pages <= 1) has no disabled logic, so the button renders enabled with a no-op or an out-of-range request that returns empty. Detection: a browser test loads a single-page list and asserts the Next button is disabled or absent; a state check asserts the disabled condition covers the `page >= totalPages` boundary.
- **Real-world example:** The dead-pagination-edge class; asserting edge-case disabled states is the standard automated catch.

### BUG-UX-044 — Dropdown chevron animates but the menu doesn't open
- **Category:** Usability Glitch · dead-button
- **Description:** The user clicks a dropdown's chevron icon; the chevron rotates but no menu appears. Mechanism: the animation class is applied in the click handler while the menu's open state is driven by a separate flag that isn't set — or the menu renders with zero opacity/height due to a missing class. Detection: a browser test clicks the chevron and asserts the menu is visible (opacity/height/display checks) and the chevron rotation matches the open state; a component test asserts one flag drives both.
- **Real-world example:** The animation-state-desync class; visibility assertions (not just class presence) are the standard automated catch.

### BUG-UX-045 — Infinite spinner from a promise that never resolves
- **Category:** Usability Glitch · loading-state
- **Description:** The user opens a page and the loading spinner runs indefinitely. Mechanism: the awaited promise never settles — a hung request with no timeout, a condition that never becomes true, or a `Promise` constructed without a `resolve` call — and no timeout fallback exists. Detection: a browser test loads the page with a per-page time budget and asserts the spinner clears; a state check asserts every `isLoading` flag has a timeout or error-path reset.
- **Real-world example:** The infinite-spinner class; per-page timeout assertions in E2E suites are the standard automated catch, and request timeouts are the documented prevention.

### BUG-UX-046 — Loading state persists after navigating away and back
- **Category:** Usability Glitch · loading-state
- **Description:** The user navigates away from a slow-loading page, returns, and the spinner is still running even though the data has since loaded. Mechanism: the loading flag was set in component state and never cleared when the query key changed, or the component remounted with a fresh flag that no fetch resets. Detection: a browser test navigates away mid-load, waits, returns, and asserts the spinner state matches the data state; a state check asserts loading flags are cleared in `finally` and keyed to the active request.
- **Real-world example:** The stale-loading-flag class; loading-state-vs-data-state consistency assertions are the standard automated catch.

### BUG-UX-047 — Empty-state text drifts from the copy spec
- **Category:** Usability Glitch · empty-state
- **Description:** The user sees an empty list whose text no longer matches the product's copy spec ("No results found" vs "Nothing here yet — try a different filter"). Mechanism: the empty-state copy is hardcoded in the component (or a snapshot test pins old copy) and a copy change lands in one place but not the other. Detection: a component test asserts the empty-state string against the copy source (i18n file or spec fixture); a snapshot diff flags drift between component copy and the spec.
- **Real-world example:** The empty-state-copy-drift class; copy source-of-truth (i18n catalogs) with test-enforced strings is the documented prevention pattern.

### BUG-UX-048 — Error state renders raw technical messages to users
- **Category:** Usability Glitch · error-state
- **Description:** The user hits a server error and sees a SQL dump, stack trace, or raw exception message in the page. Mechanism: the error handler renders `error.message` (or the raw response body) directly into the DOM instead of mapping to a user-facing message. Detection: a browser test forces an error and asserts no raw technical tokens (SQL keywords, stack-frame patterns, exception class names) appear in the DOM; a code audit greps for direct `error.message` renders into user-facing containers.
- **Real-world example:** The raw-error-to-user class; error-mapping layers (error code to user message) are the documented pattern and the raw-token grep is the automated catch.

### BUG-UX-049 — Fake success: "Deleted" shown while the record persists
- **Category:** Usability Glitch · fake-success
- **Description:** The user deletes a record; the UI shows "Deleted" and removes the row, but reloading shows the record still exists. Mechanism: the UI applies the optimistic removal and shows success before the server confirms, with no rollback on failure (the error is swallowed). Detection: a browser test deletes with a mocked failure and asserts the row returns and no success toast shows; a network assertion asserts the success UI is gated on a 2xx response.
- **Real-world example:** The fake-success class; optimistic-update-without-rollback is a documented anti-pattern and the failure-mock test is the standard catch.

### BUG-UX-050 — Silent failure with no feedback
- **Category:** Usability Glitch · silent-failure
- **Description:** The user performs an action that fails; nothing on screen changes — no error, no toast, no state change. Mechanism: the fetch's `catch` block is empty (or logs only), and no error state is surfaced to the UI. Detection: a browser test forces each action to fail and asserts some error feedback appears (toast, banner, inline message); a code audit greps for empty catch blocks in UI handlers.
- **Real-world example:** The silent-failure class; the force-failure-asserts-feedback test matrix is the standard automated catch.

### BUG-UX-051 — Permission-denied state hidden entirely
- **Category:** Usability Glitch · silent-failure
- **Description:** The user without access to a resource sees an empty list instead of a "no permission" message. Mechanism: the 403 response is handled in the same branch as an empty result (both render the empty state), so permission errors are indistinguishable from "no data". Detection: a browser test loads the list as a user without permission and asserts a permission-specific message appears; a state check asserts 403 and empty-result states are separate branches.
- **Real-world example:** The hidden-403 class; the permission-matrix test (authorized vs unauthorized user) is the standard automated catch.

### BUG-UX-052 — Skeleton shimmer shown forever on error
- **Category:** Usability Glitch · loading-state
- **Description:** The user hits an error and skeleton placeholders keep shimmering instead of an error message appearing. Mechanism: the skeleton renders while `isError` is true because the render branch checks only `isLoading`/`!data` and never swaps to the error UI. Detection: a browser test forces an error and asserts skeletons stop and an error message appears; a state check asserts the render order is loading, then error, then data, with error handled before the skeleton fallback.
- **Real-world example:** The skeleton-on-error class; render-branch order assertions are the standard automated catch.

### BUG-UX-053 — Empty state shown for a list still loading
- **Category:** Usability Glitch · empty-state
- **Description:** The user opens a list and immediately sees "No items" before data arrives. Mechanism: the render branch treats `data.length === 0` and `isLoading` as the same case (both render the empty state) because data defaults to an empty array. Detection: a browser test loads the list with throttled network and asserts the loading state (not the empty state) shows until data arrives; a state check asserts `isLoading` is checked before the empty branch.
- **Real-world example:** The loading-vs-empty conflation class; the throttled-network test is the standard automated catch.

### BUG-UX-054 — Error banner with no dismiss control
- **Category:** Usability Glitch · error-state
- **Description:** The user sees an error banner that cannot be closed — no X button, no auto-dismiss. Mechanism: the banner component renders the error message but the dismiss handler (or a `dismissible` prop defaulting to false) was never wired. Detection: a browser test triggers an error and asserts a dismiss control exists and removes the banner; a component test asserts the dismissible prop or handler is present.
- **Real-world example:** The undismissible-error class; the error-then-dismiss test is the standard automated catch.

### BUG-UX-055 — Retry button on the error state does nothing
- **Category:** Usability Glitch · dead-button
- **Description:** The user clicks "Retry" on an error state; nothing re-fetches. Mechanism: the retry button's handler is missing or doesn't re-invoke the query (no `refetch()` call, or it calls a stale closure). Detection: a browser test forces an error, clicks Retry with a mock that now succeeds, and asserts data loads; a network assertion asserts a new request fires on click.
- **Real-world example:** The dead-retry class; the error-retry-success mock sequence is the standard automated catch.

### BUG-UX-056 — Per-tab loading flags persist after switching tabs
- **Category:** Usability Glitch · loading-state
- **Description:** The user switches between tabs in a dashboard; a previously-loading tab's spinner state leaks into the new tab. Mechanism: loading flags are stored per-tab in a shared state object and not reset or keyed when the active tab changes. Detection: a browser test switches tabs rapidly and asserts each tab's loading state matches its own data state; a state check asserts loading flags are keyed by tab ID.
- **Real-world example:** The cross-tab-state-leak class; per-key state assertions are the standard automated catch.

### BUG-UX-057 — "No results" shown for a search still in flight
- **Category:** Usability Glitch · empty-state
- **Description:** The user types a query and sees "No results" before the search response arrives. Mechanism: the render branch shows the empty state while the debounced fetch is pending because `isFetching`/`isPending` is not distinguished from an empty result. Detection: a browser test types a query with throttled network and asserts a pending indicator (not "No results") shows until the response arrives; a state check asserts the pending branch precedes the empty branch.
- **Real-world example:** The search-pending-vs-empty class; the throttled-search test is the standard automated catch.

### BUG-UX-058 — Success toast fired before the action completes
- **Category:** Usability Glitch · fake-success
- **Description:** The user performs an action that subsequently fails; a "Success" toast appeared immediately. Mechanism: the toast fires before the awaited call — invoked synchronously with the request rather than with its result (outside the `then`/success branch). Detection: a browser test forces a failure and asserts no success toast shows; a code audit asserts the toast call sits inside the success branch of the awaited handler.
- **Real-world example:** The premature-success-toast class; the failure-mock-asserts-no-toast test is the standard automated catch.

### BUG-UX-059 — Error count badge shows zero while errors are listed
- **Category:** Usability Glitch · loading-state
- **Description:** The user sees a badge reading "0 errors" above a list showing several errors. Mechanism: the badge computes from cached or stale data (a separate query that wasn't invalidated) while the list renders fresh data. Detection: a browser test triggers errors and asserts the badge count equals the listed count; a state check asserts badge and list read the same query key or the badge's query is co-invalidated.
- **Real-world example:** The stale-badge-count class; badge-vs-list consistency assertions are the standard automated catch.

### BUG-UX-060 — Upload progress stuck at 99%
- **Category:** Usability Glitch · loading-state
- **Description:** The user uploads a file; the progress bar reaches 99% and stays there until the page is reloaded. Mechanism: the progress handler updates on `progress` events but the completion transition (100%, success state) is wired to an event that never fires or is missing — the final chunk's completion isn't handled. Detection: a browser test uploads a file and asserts the progress reaches 100% and the success state shows; a state check asserts the completion handler is wired to the request's load/done event.
- **Real-world example:** The stuck-at-99-percent class in upload UIs; the complete-upload-asserts-100 test is the standard automated catch.

### BUG-UX-061 — Full-page spinner for a fine-grained update
- **Category:** Usability Glitch · loading-state
- **Description:** The user toggles one row's status; the entire page blanks behind a spinner instead of updating the row in place. Mechanism: the mutation's loading state gates the whole page render (`if (isSaving) return <Spinner/>`) instead of scoping to the affected row. Detection: a browser test performs a row-level action and asserts the rest of the page remains visible; a code audit flags page-level loading gates on fine-grained mutations.
- **Real-world example:** The over-scoped-loading class; the row-action-preserves-page test is the standard automated catch.

### BUG-UX-062 — Error boundary shows a blank section
- **Category:** Usability Glitch · error-state
- **Description:** A component throws during render; the surrounding section renders blank with no message. Mechanism: the error boundary's fallback returns `null` (or an empty container), so the error is contained but invisible. Detection: a browser test forces a render error and asserts a fallback message appears in place of the section; a code audit flags error-boundary fallbacks returning null in user-facing layouts.
- **Real-world example:** The blank-fallback class; the forced-error-asserts-fallback test is the standard automated catch.

### BUG-UX-063 — Offline state not surfaced
- **Category:** Usability Glitch · silent-failure
- **Description:** The user's network drops; the app keeps showing stale data as if current, with no offline indicator. Mechanism: no `navigator.onLine`/connectivity listener drives an offline banner, and mutations queue or fail silently. Detection: a browser test toggles offline emulation and asserts an offline indicator appears; a state check asserts a connectivity listener drives the banner state.
- **Real-world example:** The hidden-offline class; the offline-emulation test is the standard automated catch (Playwright and CDP support network emulation).

### BUG-UX-064 — Load-more loop never terminates on an empty page
- **Category:** Usability Glitch · loading-state
- **Description:** The user clicks "Load more" on the final page; the spinner runs forever because the next page is empty and the loop never terminates. Mechanism: the pagination loop appends and fetches again without checking whether the fetched page was empty (no `hasMore = items.length > 0` guard). Detection: a browser test clicks Load more on the final page (mock returns empty) and asserts the spinner stops and the button disables; a state check asserts the empty-page guard sets `hasMore = false`.
- **Real-world example:** The empty-page-infinite-loop class; the empty-page-mock test is the standard automated catch.

### BUG-UX-065 — Soft-404: valid-looking route renders empty data with 200
- **Category:** Usability Glitch · empty-state
- **Description:** The user opens a deep link to a record that doesn't exist; the page renders with headers and an empty body instead of a not-found state. Mechanism: the route renders its normal layout while the data fetch returns empty/404, and no not-found branch distinguishes the missing record. Detection: a browser test opens a URL for a nonexistent record and asserts a not-found message (and ideally a 404 status) appears; a state check asserts the empty-data branch for a detail route renders the not-found UI.
- **Real-world example:** The soft-404 class; SEO audits flag 200-with-empty-content pages, and the nonexistent-record test is the standard automated catch.

### BUG-UX-066 — Error type discrimination lost in mapping
- **Category:** Usability Glitch · error-state
- **Description:** The user hits a timeout and sees the same generic "Something went wrong" as a validation error, losing the retry-vs-correct-input distinction. Mechanism: the error mapping layer collapses all errors to one message (a single fallback case in the mapping switch) instead of distinguishing error codes. Detection: a browser test forces a timeout and a validation error and asserts distinct messages appear; a code audit asserts the mapping switch has cases per error class.
- **Real-world example:** The collapsed-error-mapping class; error-class-distinct-message assertions are the standard automated catch.

### BUG-UX-067 — Stale state captured in a closure
- **Category:** Usability Glitch · stale-state
- **Description:** The user clicks a button whose handler reads a value they just changed; the handler uses the old value. Mechanism: the handler (in `setTimeout`, `useCallback` with wrong deps, or an event listener registered once) captures the state variable from the render in which it was created, so it reads a stale snapshot. Detection: a unit test invokes the handler after a state change and asserts it reads the current value; a code audit flags `useCallback`/`useEffect` with missing state dependencies and `setTimeout` closures over state.
- **Real-world example:** The stale-closure class; React's hooks guidance describes the deps-array requirement precisely because closures capture render-time state.

### BUG-UX-068 — Out-of-order responses overwrite newer data
- **Category:** Usability Glitch · race-ux
- **Description:** The user changes a filter rapidly twice; the slower (older) response arrives last and overwrites the newer results. Mechanism: no request sequencing exists — no AbortController canceling the prior request and no sequence-number check discarding stale responses — so last-arrival-wins regardless of order. Detection: a browser test fires two requests with controlled latencies (mock delays) and asserts the UI shows the newer request's result; a code audit flags fetch paths without abort or sequence guards.
- **Real-world example:** The out-of-order-response class; the controlled-latency mock test is the standard automated catch and AbortController is the documented prevention.

### BUG-UX-069 — Stale page data after a mutation (missing invalidation)
- **Category:** Usability Glitch · stale-state
- **Description:** The user edits a record on a detail page; the list page still shows the old value when navigated to. Mechanism: the mutation doesn't invalidate the list's query key (no `invalidateQueries`/cache update), so the list serves cached data. Detection: a browser test edits a record, navigates to the list, and asserts the new value appears; a state check asserts the mutation's success path invalidates affected query keys.
- **Real-world example:** The missing-invalidation class; the mutation-then-navigate-asserts-fresh test is the standard automated catch.

### BUG-UX-070 — Lost selection after a list re-render
- **Category:** Usability Glitch · stale-state
- **Description:** The user selects several rows, a background refetch completes, and the selection clears. Mechanism: selection is stored by row index (or the rows' keys change on refetch), so React reconciles the list and the selected indices no longer map to the same rows. Detection: a browser test selects rows, triggers a refetch, and asserts the selection persists; a state check asserts selection keys by stable row ID and the list keys by the same ID.
- **Real-world example:** The selection-lost-on-refetch class; stable-ID keying is the documented fix and the refetch-preserves-selection test is the standard catch.

### BUG-UX-071 — Selection persistence bugs across pagination
- **Category:** Usability Glitch · stale-state
- **Description:** The user selects rows on page 1, goes to page 2, and returns; either the selection cleared or it now includes page-2 rows. Mechanism: selection is stored by index across pages, so index collisions between pages select unintended rows, or the selection resets because the list remounts. Detection: a browser test selects on page 1, navigates to page 2 and back, and asserts exactly the page-1 rows remain selected; a state check asserts selection keys by ID, not index.
- **Real-world example:** The cross-page-selection class; the multi-page selection matrix is the standard automated catch.

### BUG-UX-072 — Filter state resets on navigation
- **Category:** Usability Glitch · stale-state
- **Description:** The user applies filters, navigates to a detail page, and returns; the filters are gone. Mechanism: filter state lives in component state (not URL search params or a store), so the remounted list initializes from defaults. Detection: a browser test applies filters, navigates away and back, and asserts the filters persist; a state check asserts filters are lifted to the URL (search params present after applying).
- **Real-world example:** The filter-reset-on-navigation class; URL-as-state is the documented fix and the navigate-away-back test is the standard catch.

### BUG-UX-073 — Tab state leakage between routes
- **Category:** Usability Glitch · stale-state
- **Description:** The user selects tab 3 in section A, navigates to section B (with its own tabs), and returns; section A shows a different tab. Mechanism: a module-level variable (or shared context without per-route reset) holds the active tab, so both sections read and write the same slot. Detection: a browser test sets a tab in section A, visits section B, returns, and asserts section A's tab is unchanged; a state check asserts tab state is keyed per route or reset on unmount.
- **Real-world example:** The module-level-tab-leak class; per-route state keying assertions are the standard automated catch.

### BUG-UX-074 — Modal state leakage: closing one closes another
- **Category:** Usability Glitch · stale-state
- **Description:** The user closes a secondary modal and a primary modal beneath it also closes. Mechanism: both modals read the same open flag (a shared boolean or context slot), so the close handler flips the shared flag for both. Detection: a browser test opens two modals, closes the top one, and asserts the bottom one remains open; a state check asserts each modal has its own open flag.
- **Real-world example:** The shared-open-flag class; multi-modal state assertions are the standard automated catch.

### BUG-UX-075 — URL state mismatch: browser Back doesn't restore the filter
- **Category:** Usability Glitch · stale-state
- **Description:** The user applies a filter, presses the browser Back button, and the filter remains applied — or the URL shows the filter but the UI doesn't. Mechanism: the filter was written with `history.replaceState` (no history entry) or the UI reads the filter only on mount, so Back doesn't re-derive the state. Detection: a browser test applies a filter, presses Back, and asserts URL and UI agree (filter restored or cleared in both); a state check asserts filter writes use `pushState`/router push and the UI derives from the URL reactively.
- **Real-world example:** The replaceState-vs-pushState class; the back-restores-state assertion is the standard automated catch.

### BUG-UX-076 — UI state not persisting after refresh
- **Category:** Usability Glitch · stale-state
- **Description:** The user sets a view preference (sort, density, expanded sections), refreshes, and it resets. Mechanism: no persistence layer (localStorage, URL param) writes the preference, or the read happens without a corresponding write path. Detection: a browser test sets the preference, reloads the page, and asserts it persists; a state check asserts a persistence write fires on change and a read initializes state.
- **Real-world example:** The unpersisted-preference class; the set-reload-asserts test is the standard automated catch.

### BUG-UX-077 — Background refetch overwrites in-progress form edits
- **Category:** Usability Glitch · stale-state
- **Description:** The user is editing a form, switches tabs away and back (refocus), and a background refetch resets the fields to server values, discarding edits. Mechanism: the query's refetch-on-window-focus writes fresh server data into the form's state unconditionally, with no dirty-check preserving local edits. Detection: a browser test edits a field, blurs and refocuses the window, and asserts the edit persists; a state check asserts the refetch handler checks a dirty flag before overwriting.
- **Real-world example:** The refocus-overwrite class; React Query's refetchOnWindowFocus behavior makes the dirty-check requirement a documented pattern.

### BUG-UX-078 — Optimistic update not rolled back on error
- **Category:** Usability Glitch · stale-state
- **Description:** The user performs an action with an optimistic UI (row removed, count incremented); the server rejects and the optimistic state persists incorrectly. Mechanism: the mutation's error path doesn't restore the previous state (no rollback in `onError`/`catch`), so the UI keeps the optimistic value. Detection: a browser test forces a failure after an optimistic action and asserts the UI returns to the pre-action state; a state check asserts a rollback path exists and is invoked on error.
- **Real-world example:** The missing-rollback class; the optimistic-failure-asserts-revert test is the standard automated catch.

### BUG-UX-079 — Derived state out of sync with its source
- **Category:** Usability Glitch · stale-state
- **Description:** The user changes a source value; a derived display (total, filtered count) shows a stale value. Mechanism: the derivation (`useMemo`) has a wrong dependency array (missing the source variable), so it doesn't recompute. Detection: a unit test changes the source and asserts the derived value updates; a code audit flags `useMemo`/`useEffect` deps arrays missing referenced variables.
- **Real-world example:** The memo-deps-miss class; eslint-plugin-react-hooks' exhaustive-deps rule is the documented automated catch.

### BUG-UX-080 — Two components disagree on the same data
- **Category:** Usability Glitch · stale-state
- **Description:** The user updates a value in one component; another component showing the same value updates only after a reload. Mechanism: one component reads props (live) while the other reads a module-level cache (stale), and no shared store reconciles them. Detection: a browser test updates the value and asserts both components show it without a reload; a state check asserts both read the same store/query key.
- **Real-world example:** The dual-read-path class; single-source-of-truth store assertions are the standard automated catch.

### BUG-UX-081 — Sort state resets when data refreshes
- **Category:** Usability Glitch · stale-state
- **Description:** The user sorts a table by a column; a background refetch completes and the sort resets to the default order. Mechanism: the sort key lives in client state while the refetch returns unsorted server data, and the client doesn't re-apply the sort (or the sort state is reset by a remount). Detection: a browser test sorts, triggers a refetch, and asserts the order persists; a state check asserts the sort key is applied after every data update.
- **Real-world example:** The sort-reset-on-refresh class; the sort-preserves-refetch test is the standard automated catch.

### BUG-UX-082 — Wizard step state lost when navigating between steps via URL
- **Category:** Usability Glitch · stale-state
- **Description:** The user is on step 3 of a wizard, opens step 2 via URL or Back, and returns; step 3's entered data is gone. Mechanism: per-step form state lives in the step component's state, which unmounts on navigation, and no shared wizard state persists it. Detection: a browser test fills step 3, navigates to step 2 and back, and asserts the data persists; a state check asserts wizard state is lifted to a shared store or URL.
- **Real-world example:** The per-step-state-loss class; the wizard-navigate-preserve test is the standard automated catch.

### BUG-UX-083 — Dark mode flag resets on reload
- **Category:** Usability Glitch · stale-state
- **Description:** The user switches to dark mode, reloads, and the app renders light mode. Mechanism: the theme flag lives in memory only (no localStorage or `prefers-color-scheme` persistence), so the reload re-initializes from the default. Detection: a browser test switches theme, reloads, and asserts the theme persists; a state check asserts a persistence write on toggle and a read at boot.
- **Real-world example:** The unpersisted-theme class; the toggle-reload-asserts test is the standard automated catch.

### BUG-UX-084 — Locale switch reverts after navigation
- **Category:** Usability Glitch · stale-state
- **Description:** The user switches language, navigates to another page, and the language reverts. Mechanism: the locale is stored per-page or in a non-global slot (component state), so the next page initializes from the default. Detection: a browser test switches locale, navigates, and asserts the locale persists; a state check asserts the locale lives in a global store or URL.
- **Real-world example:** The per-page-locale class; the switch-navigate-asserts test is the standard automated catch.

### BUG-UX-085 — Infinite scroll page counter resets on unmount
- **Category:** Usability Glitch · stale-state
- **Description:** The user scrolls an infinite list to page 5, opens a detail view, and returns; the list restarts from page 1. Mechanism: the page counter lives in the list component's state, which unmounts on navigation, and no store or URL persists it. Detection: a browser test scrolls to page 5, navigates away and back, and asserts the list restores its position or page; a state check asserts the page counter is lifted to a store or URL.
- **Real-world example:** The unmount-page-reset class; the scroll-away-back test is the standard automated catch.

### BUG-UX-086 — Select-all checkbox desyncs with row checkboxes
- **Category:** Usability Glitch · stale-state
- **Description:** The user checks all rows via the header checkbox, unchecks one row, and the header still shows "all selected" (or vice versa). Mechanism: the header's checked state is computed once (or from a stale count) and not re-derived from the row selection after each change. Detection: a browser test toggles rows and asserts the header's checked/indeterminate state matches the selection at every step; a component test asserts the header state derives from the selection on each render.
- **Real-world example:** The select-all-desync class; the toggle-matrix test is the standard automated catch.

### BUG-UX-087 — Feature flag read once at boot, stale after update
- **Category:** Usability Glitch · stale-state
- **Description:** The user's session shows a feature as disabled even though the flag was enabled server-side mid-session. Mechanism: the flag is fetched once at app boot and cached in a module variable with no re-fetch (no interval, no refetch-on-focus), so the client never sees updates. Detection: a browser test changes the flag server-side (mock) mid-session and asserts the UI updates within a re-fetch cycle; a state check asserts the flag has a refresh path.
- **Real-world example:** The boot-once-flag class; the mid-session-flag-change test is the standard automated catch.

### BUG-UX-088 — Cart quantity edit reverts to the old value
- **Category:** Usability Glitch · stale-state
- **Description:** The user changes a cart item's quantity; after the update round-trips, the quantity displays the old value. Mechanism: the update response handler writes a stale payload (the pre-update snapshot, or an out-of-order response) into state, overwriting the user's edit. Detection: a browser test changes the quantity with a mocked response echoing the new value and asserts the UI shows it; a state check asserts the response handler writes the response's value, not a captured snapshot.
- **Real-world example:** The stale-payload-overwrite class; the echo-response test is the standard automated catch.

### BUG-UX-089 — Mobile input zoom from font-size under 16px
- **Category:** Usability Glitch · form-input
- **Description:** The user taps a text input on iOS; the page zooms in automatically and stays zoomed after typing. Mechanism: the input's computed font-size is under 16px, which triggers iOS Safari's automatic zoom-on-focus behavior. Detection: a mobile emulation test measures every input's computed font-size and flags any under 16px; a browser test focuses the input and asserts the visual viewport scale stays at 1.
- **Real-world example:** The input-zoom class; Apple's Safari zoom-on-focus behavior is well documented and the 16px threshold is the industry-standard fix.

### BUG-UX-090 — Double-submit from an unguarded button
- **Category:** Usability Glitch · double-submit
- **Description:** The user double-clicks a submit button; two records are created (or two payments charged). Mechanism: the handler has no in-flight guard — the button isn't disabled during the request and no idempotency key deduplicates the mutation. Detection: a browser test double-clicks submit and asserts exactly one record is created (network request count or server state); a code audit flags submit handlers without a disabled/once guard.
- **Real-world example:** The double-submit class; Stripe's idempotency-key documentation exists for exactly this class and the double-click test is the standard automated catch.

### BUG-UX-091 — Validation errors not shown until submit
- **Category:** Usability Glitch · form-input
- **Description:** The user fills a form with an invalid email and tabs through; no error appears until they click Submit. Mechanism: validation runs only in the submit handler (no `onBlur`/`onChange` validation), so errors surface only at submit time. Detection: a browser test enters an invalid value, blurs the field, and asserts an inline error appears; a state check asserts the validation function is wired to blur/change events.
- **Real-world example:** The validate-on-submit-only class; progressive validation (onBlur) is the documented UX pattern and the blur-asserts-error test is the standard catch.

### BUG-UX-092 — Lost form data on navigation
- **Category:** Usability Glitch · form-input
- **Description:** The user fills a long form, accidentally navigates away (Back, a link), and returns; all fields are empty. Mechanism: no draft persistence exists — form state lives in the component, unmount discards it, and no `beforeunload` guard or localStorage draft saves the data. Detection: a browser test fills the form, navigates away and back, and asserts the fields are restored (or a leave-confirmation appears); a state check asserts a draft write fires on change.
- **Real-world example:** The lost-form-data class; draft persistence and beforeunload guards are the documented patterns and the navigate-away-back test is the standard catch.

### BUG-UX-093 — Input loses focus while typing
- **Category:** Usability Glitch · focus-loss
- **Description:** The user types in a field and after a few characters the field loses focus; they must click back in to continue. Mechanism: a re-render remounts the input — the component is defined inline inside the parent's render (new component identity each render) or the input's `key` changes — destroying and recreating the DOM node. Detection: a browser test types a long string and asserts focus stays in the field (`document.activeElement` unchanged) and the full value is present; a code audit flags inline component definitions and dynamic keys on inputs.
- **Real-world example:** The lost-focus-while-typing class; the type-asserts-focus-and-value test is the standard automated catch.

### BUG-UX-094 — Browser autofill overwrites a controlled input
- **Category:** Usability Glitch · form-input
- **Description:** The user's browser autofills a field after page load, but the app's state doesn't reflect the filled value (or the autofill is reverted immediately). Mechanism: the controlled input's value is driven by state that initializes empty and doesn't sync with the browser's autofill (no `autocomplete` attribute, no change-event handling for autofill). Detection: a browser test enables autofill profiles and asserts the filled value propagates to app state (submit uses the filled value); a code audit asserts `autocomplete` attributes are set on identity fields.
- **Real-world example:** The autofill-fight class; the autofill-profile test in Chrome/Playwright is the standard automated catch.

### BUG-UX-095 — Placeholder-only labels
- **Category:** Usability Glitch · form-input
- **Description:** The user sees a field whose only label is its placeholder; after typing, the label disappears and they can no longer tell what the field is. Mechanism: the field has no `<label>` element (or `aria-label`) — the placeholder doubles as the label. Detection: a DOM audit asserts every input has an associated label (`for`/`id` pair or aria-label); a browser test types into each field and asserts the field's identity remains determinable from the DOM.
- **Real-world example:** The placeholder-only-label class; label-association audits (axe-core) are the standard automated catch.

### BUG-UX-096 — Wrong input types for the data
- **Category:** Usability Glitch · form-input
- **Description:** The user enters an email or number into a field typed as text; no native keyboard, validation, or inputmode assists. Mechanism: `type="text"` is used where `type="email"`/`type="number"` (or `inputmode`) is appropriate, so mobile keyboards and native validation don't engage. Detection: a code audit asserts email/number/tel fields use the matching `type` or `inputmode`; a mobile emulation test asserts the correct keyboard layout appears per field.
- **Real-world example:** The wrong-input-type class; type/inputmode audits are the standard automated catch.

### BUG-UX-097 — Enter key submits a multi-line textarea
- **Category:** Usability Glitch · form-input
- **Description:** The user presses Enter for a new line in a comment textarea; the form submits instead. Mechanism: the textarea sits inside a form whose submit handler fires on Enter (or a keydown handler submits on Enter without excluding textareas). Detection: a browser test presses Enter in a textarea and asserts a newline is inserted, not a submit; a code audit asserts Enter-submit handlers exclude textarea targets.
- **Real-world example:** The enter-submits-textarea class; the enter-in-textarea test is the standard automated catch.

### BUG-UX-098 — Number input parsing quirks
- **Category:** Usability Glitch · form-input
- **Description:** The user enters a value with leading zeros (an ID like "007") or scientific notation ("1e5") into a number field; the value is silently altered or accepted unexpectedly. Mechanism: `type="number"` parses and normalizes the value (strips leading zeros, accepts `e` notation), and no pattern validation constrains it. Detection: a browser test enters "007" and "1e5" and asserts the submitted value matches intent; a code audit asserts ID-like fields use `type="text"` with `inputmode="numeric"`.
- **Real-world example:** The number-input-parsing class; the leading-zero test is the standard automated catch and the text-plus-inputmode pattern is the documented fix.

### BUG-UX-099 — Masked input caret jumps to the end
- **Category:** Usability Glitch · form-input
- **Description:** The user edits a masked field (phone, date) in the middle; the caret jumps to the end after each keystroke. Mechanism: the mask library rewrites the input's value on every change and sets the caret to the end (or fails to restore the caret position) instead of preserving it. Detection: a browser test positions the caret mid-mask, types, and asserts the caret stays adjacent to the typed position; a component test asserts the mask handler restores the caret.
- **Real-world example:** The mask-caret-jump class; the mid-mask-edit test is the standard automated catch.

### BUG-UX-100 — Password managers fill hidden fields
- **Category:** Usability Glitch · form-input
- **Description:** The user's password manager fills credentials into invisible fields, corrupting the visible form. Mechanism: hidden (`display: none`/`visibility: hidden`) inputs that once held credentials remain in the DOM, and password managers autofill them. Detection: a DOM audit flags hidden inputs with name/autocomplete attributes suggesting credentials; a browser test with an autofill profile asserts hidden fields remain empty.
- **Real-world example:** The hidden-field-autofill class; hidden-credential-input audits are the standard automated catch.

### BUG-UX-101 — Enter key repeat creates duplicate records
- **Category:** Usability Glitch · double-submit
- **Description:** The user holds Enter (or double-taps it) on a submit form; two records are created. Mechanism: the keydown handler submits on every `keydown` event, including OS key-repeat events, with no once-guard. Detection: a browser test dispatches repeated keydown events and asserts exactly one submit; a code audit asserts submit handlers guard against repeats (a submitted flag or `event.repeat` check).
- **Real-world example:** The key-repeat-double-submit class; the repeated-keydown test is the standard automated catch and `event.repeat` is the documented guard.

### BUG-UX-102 — Select resets to placeholder after choosing an option
- **Category:** Usability Glitch · form-input
- **Description:** The user picks an option from a select; the select immediately shows the placeholder again. Mechanism: the select is remounted by a re-render (key change or conditional branch) triggered by the selection, re-initializing it from the default value. Detection: a browser test picks an option and asserts the select shows the chosen value after any re-render; a code audit asserts selects aren't re-keyed on value change.
- **Real-world example:** The select-remount class; the pick-asserts-value test is the standard automated catch.

### BUG-UX-103 — Custom date input rejects typed entry
- **Category:** Usability Glitch · form-input
- **Description:** The user types a date into a date field; the input rejects or garbles the keystrokes and only the picker works. Mechanism: a custom masking/validation layer fights native date input semantics (`type="date"` segmented editing) — the custom handler rewrites the value mid-typing. Detection: a browser test types a full date via keyboard and asserts the value is accepted; a code audit asserts custom masks aren't layered on native date inputs.
- **Real-world example:** The native-date-vs-mask class; the keyboard-date-entry test is the standard automated catch.

### BUG-UX-104 — File input can't re-select the same file
- **Category:** Usability Glitch · form-input
- **Description:** The user uploads a file, then selects the same file again to re-upload; the change event never fires. Mechanism: the input's `value` isn't cleared after the upload, so selecting the same file produces no change event. Detection: a browser test selects the same file twice and asserts two change events (two uploads); a code audit asserts the input value is cleared in the upload handler.
- **Real-world example:** The same-file-no-change class; the re-select-same-file test is the standard automated catch.

### BUG-UX-105 — Checkbox change event fires twice
- **Category:** Usability Glitch · form-input
- **Description:** The user clicks a checkbox; the toggle flips twice (net zero) or state updates twice. Mechanism: the checkbox is wrapped in a label AND a separate click handler toggles it, so the label's default behavior and the handler both toggle. Detection: a browser test clicks the checkbox once and asserts exactly one state change; a code audit asserts handlers don't double-toggle label-wrapped inputs.
- **Real-world example:** The double-toggle class; the single-click-asserts-one-toggle test is the standard automated catch.

### BUG-UX-106 — Input truncates silently at maxLength
- **Category:** Usability Glitch · form-input
- **Description:** The user pastes a long value into a field; it's silently truncated with no indication. Mechanism: `maxLength` is set on the input with no counter or validation message, so truncation is invisible. Detection: a browser test pastes an over-length value and asserts a counter or message appears; a component test asserts a counter accompanies maxLength inputs.
- **Real-world example:** The silent-truncation class; the paste-overlength test is the standard automated catch.

### BUG-UX-107 — Paste into a controlled input loses data
- **Category:** Usability Glitch · form-input
- **Description:** The user pastes multi-line or formatted content into a controlled field; part of it is dropped. Mechanism: the controlled input's `onChange` normalizes or strips the pasted value (or a paste handler prevents default and loses content), discarding data the user pasted. Detection: a browser test pastes multi-line content and asserts the field's value matches the pasted content (or a documented normalization); a state check asserts paste handling is explicit, not accidental.
- **Real-world example:** The paste-loss class; the paste-asserts-value test is the standard automated catch.

### BUG-UX-108 — Required field marked only by color
- **Category:** Usability Glitch · form-input
- **Description:** The user submits a form missing a required field; the field's border turns red but no text explains the error. Mechanism: the validation UI signals errors via CSS only (border/outline color) with no message element and no `aria-describedby`. Detection: a browser test submits an incomplete form and asserts a text message appears per missing field; an a11y audit asserts errors are associated via `aria-describedby`/`aria-invalid`.
- **Real-world example:** The color-only-error class; axe-core's error-association audits are the standard automated catch.

### BUG-UX-109 — Form reset clears fields but not errors
- **Category:** Usability Glitch · form-input
- **Description:** The user clicks "Reset" on a form with errors; the fields clear but the error messages remain. Mechanism: the reset handler clears field state only — the errors state object isn't cleared with it. Detection: a browser test triggers errors, clicks Reset, and asserts both fields and errors clear; a state check asserts the reset path clears both.
- **Real-world example:** The reset-clears-fields-only class; the reset-asserts-clean-state test is the standard automated catch.

### BUG-UX-110 — Character counter counts wrong for emoji and non-Latin text
- **Category:** Usability Glitch · form-input
- **Description:** The user types an emoji or CJK characters; the counter counts more characters than are visible (or fewer than the platform's limit). Mechanism: the counter counts UTF-16 code units (JS `length`) while the visible characters are grapheme clusters (an emoji is 2+ code units), diverging from platform limits that count graphemes. Detection: a unit test asserts the counter matches `Intl.Segmenter` grapheme counts for emoji and CJK strings; a browser test types an emoji and asserts the counter shows 1.
- **Real-world example:** The UTF-16-vs-grapheme class; `Intl.Segmenter` is the documented fix and the emoji-count test is the standard catch.

### BUG-UX-111 — Focus not restored after modal close
- **Category:** Usability Glitch · focus-loss
- **Description:** The user closes a modal and keyboard focus is dropped to `body` instead of returning to the button that opened it. Mechanism: the modal's close path doesn't restore focus to the stored trigger element (no trigger ref captured at open, or the restore runs after the trigger unmounted). Detection: a browser test opens a modal via a button, closes it, and asserts `document.activeElement` is the trigger button; a code audit asserts the trigger ref is captured at open and restored on close.
- **Real-world example:** The lost-focus-after-modal class; WAI-ARIA dialog guidance requires focus restoration and the activeElement assertion is the standard automated catch.

### BUG-UX-112 — Focus trap without an escape hatch
- **Category:** Usability Glitch · focus-trap
- **Description:** The user is Tab-trapped in a modal and cannot reach the browser chrome or other page content even after the modal's purpose is done. Mechanism: the focus trap cycles Tab within the modal but no Escape key handler (or explicit release path) moves focus out. Detection: a browser test presses Escape inside a trapped modal and asserts focus moves out (or the modal closes); a code audit asserts every trap has an Escape handler.
- **Real-world example:** The trap-without-escape class; WAI-ARIA dialog guidance requires Escape to close (or an equivalent) and the Escape test is the standard catch.

### BUG-UX-113 — Tab order jumps across visual sections
- **Category:** Usability Glitch · focus-trap
- **Description:** The user Tabs through a page and focus jumps from a left panel to a far-right element, skipping the visually-adjacent controls. Mechanism: CSS `order`, grid placement, or flex ordering changes the visual layout while DOM order (which drives Tab order) is unchanged. Detection: a browser test records the Tab sequence and asserts it matches the visual reading order (left-to-right, top-to-bottom per section); an a11y audit flags elements whose visual position diverges from DOM order.
- **Real-world example:** The DOM-order-vs-visual class; CSS order and grid reordering is the documented trap and the Tab-sequence-vs-layout test is the standard catch.

### BUG-UX-114 — Custom controls not keyboard accessible
- **Category:** Usability Glitch · keyboard-a11y
- **Description:** The user tries to activate a custom card or toggle with the keyboard; it can't be reached or activated. Mechanism: the control is a `div` (or `span`) with an `onClick` handler but no `role`, `tabindex`, or keydown handler, so it's invisible to keyboard navigation. Detection: a browser test Tabs through the page and asserts every clickable element is focusable and activatable via Enter/Space; an a11y audit (axe-core) flags interactive non-semantic elements.
- **Real-world example:** The div-onclick class; axe-core's "interactive controls must be keyboard accessible" rule is the standard automated catch.

### BUG-UX-115 — Icon-only buttons missing accessible names
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader announces an icon-only button as "button" with no name, or the user can't tell what it does. Mechanism: the button has no `aria-label` (or accessible text), so the accessible name is empty. Detection: an a11y audit asserts every button has a non-empty accessible name; a DOM audit flags icon-only buttons without `aria-label`.
- **Real-world example:** The missing-aria-label class; axe-core's button-name rule is the standard automated catch.

### BUG-UX-116 — Text contrast under WCAG thresholds
- **Category:** Usability Glitch · contrast
- **Description:** The user reads text whose foreground/background contrast is under 4.5:1 (or 3:1 for large text) and cannot read it in bright lighting. Mechanism: the color tokens (or hardcoded colors) yield insufficient contrast ratios in the shipped theme. Detection: an a11y audit computes contrast ratios for all text elements and flags those under WCAG AA thresholds; a design-token test asserts token pairs meet minimum ratios.
- **Real-world example:** The contrast-failure class; axe-core's color-contrast rule is the standard automated catch and WCAG 2.2 AA defines the thresholds.

### BUG-UX-117 — Reduced-motion preference not honored
- **Category:** Usability Glitch · reduced-motion
- **Description:** The user has "reduce motion" enabled in their OS; animations, parallax, and transitions still run. Mechanism: no `prefers-reduced-motion` media query gates the animations (CSS keyframes and JS-driven motion run unconditionally). Detection: a browser test emulates `prefers-reduced-motion: reduce` and asserts animations are disabled or replaced; a code audit asserts a reduced-motion media query exists for animated components.
- **Real-world example:** The ignored-reduced-motion class; the emulated-preference test is the standard automated catch and `prefers-reduced-motion` is the documented gate.

### BUG-UX-118 — Focus rings removed by CSS resets
- **Category:** Usability Glitch · keyboard-a11y
- **Description:** The user Tabs through a page and cannot see where focus is (no visible focus indicator). Mechanism: a CSS reset sets `outline: none` (or `outline: 0`) on interactive elements without a replacement focus style. Detection: a browser test Tabs to each interactive element and asserts a visible focus indicator exists (computed outline, box-shadow, or other style); a code audit greps for `outline: none` without `:focus-visible` replacements.
- **Real-world example:** The removed-focus-ring class; axe-core's focus-visible checks and the outline-grep are the standard catches.

### BUG-UX-119 — Status updates not announced to screen readers
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader doesn't announce a toast or status change ("Saved", "Error"), so they don't know the action completed. Mechanism: the toast/status container has no `aria-live` region (or the wrong politeness), so dynamic updates aren't announced. Detection: an a11y audit asserts toast/status containers have `aria-live` and `role="status"`/`role="alert"`; a browser test asserts the live region's text updates on action.
- **Real-world example:** The missing-live-region class; axe-core's aria-live audits are the standard automated catch.

### BUG-UX-120 — Modal content not announced on open
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader stays in the page content when a modal opens; the modal's title and purpose aren't announced. Mechanism: the modal container lacks `role="dialog"`, `aria-modal="true"`, and an accessible name (`aria-labelledby`), so the screen reader doesn't treat it as a dialog. Detection: an a11y audit asserts modal containers have the dialog role, modal state, and a label; a browser test asserts focus moves into the modal on open.
- **Real-world example:** The unannounced-dialog class; WAI-ARIA dialog guidance and axe-core audits are the standard catches.

### BUG-UX-121 — Custom dropdown not arrow-key navigable
- **Category:** Usability Glitch · keyboard-a11y
- **Description:** The user opens a custom dropdown and tries to navigate options with arrow keys; nothing moves. Mechanism: the menu is a custom list without keyboard handlers (no arrow-key navigation, no `role="listbox"`/`aria-activedescendant`). Detection: a browser test presses ArrowDown in an open dropdown and asserts the highlighted option moves; an a11y audit asserts listbox/option roles and keyboard handlers exist.
- **Real-world example:** The custom-menu-no-keyboard class; WAI-ARIA combobox guidance defines the required keyboard model and the arrow-key test is the standard catch.

### BUG-UX-122 — Skip link missing or non-functional
- **Category:** Usability Glitch · keyboard-a11y
- **Description:** The user Tabs on a long page and must tab through dozens of nav links before reaching content; no skip link exists (or it doesn't move focus). Mechanism: no skip-to-content link is rendered (or the link's href doesn't target a focusable content container). Detection: a browser test presses Tab once and asserts a skip link appears, activates it, and asserts focus moves to main content; a DOM audit asserts the skip target is focusable.
- **Real-world example:** The missing-skip-link class; the first-tab-asserts-skip test is the standard automated catch.

### BUG-UX-123 — Heading hierarchy jumps levels
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader navigates by headings and encounters a jump from h2 to h4, losing the document structure. Mechanism: headings are chosen for visual size (h4 for smaller text) rather than document structure, breaking the hierarchy. Detection: an a11y audit asserts heading levels increase by at most one between consecutive headings; a code audit flags heading tags chosen for styling.
- **Real-world example:** The heading-hierarchy-jump class; axe-core's heading-order rule is the standard automated catch.

### BUG-UX-124 — Form errors not associated with inputs
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader announces "invalid" on a field with no indication of what the error says — the message isn't read. Mechanism: the error message isn't associated with the input via `aria-describedby` (or `aria-invalid` isn't set), so the association is missing. Detection: an a11y audit asserts error messages are referenced by `aria-describedby` and inputs set `aria-invalid`; a browser test asserts the association IDs match.
- **Real-world example:** The unassociated-error class; axe-core's aria-describedby audits are the standard automated catch.

### BUG-UX-125 — Table headers not associated with cells
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader reads a table cell without its column context ("1,500" with no header). Mechanism: `<th>` elements lack `scope` attributes (or the table uses divs without roles), so the header-cell association is missing. Detection: an a11y audit asserts th elements have `scope` (or roles exist for div-based tables); a browser test asserts the accessible name of cells includes the column header.
- **Real-world example:** The missing-table-scope class; axe-core's th-scope rule is the standard automated catch.

### BUG-UX-126 — Disabled button focusable with no explanation
- **Category:** Usability Glitch · a11y-label
- **Description:** The user Tabs to a disabled button; the screen reader announces it as focusable but gives no reason it's disabled. Mechanism: the button is disabled via the attribute with no `aria-disabled` and no explanatory text, so the disabled state communicates nothing. Detection: an a11y audit asserts disabled controls communicate the state (`aria-disabled` or visually-hidden text explaining why); a browser test asserts focus behavior matches the intended semantics.
- **Real-world example:** The unexplained-disabled class; the disabled-communication audit is the standard catch.

### BUG-UX-127 — Custom checkbox announced as "clickable"
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader announces a custom toggle as "clickable" or a generic group instead of "checkbox, checked/unchecked". Mechanism: the toggle is a div-based control without `role="checkbox"` and `aria-checked`, so the semantics are missing. Detection: an a11y audit asserts custom toggles expose checkbox semantics (role plus aria-checked); a browser test asserts the accessible name and state.
- **Real-world example:** The div-checkbox-semantics class; axe-core's role audits are the standard automated catch.

### BUG-UX-128 — Accordion content not keyboard operable
- **Category:** Usability Glitch · keyboard-a11y
- **Description:** The user Tabs to an accordion header and presses Enter/Space; it doesn't expand. Mechanism: the header is not a `<button>` (a div with a click handler), so Enter/Space don't activate it. Detection: a browser test presses Enter and Space on each accordion header and asserts expansion; an a11y audit asserts headers are buttons (or have button role plus keydown handlers).
- **Real-world example:** The accordion-not-keyboard class; WAI-ARIA accordion guidance requires button semantics and the Enter/Space test is the standard catch.

### BUG-UX-129 — Toasts disappear before screen readers read them
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader starts announcing a toast; it disappears (and is removed from the DOM) before the announcement completes. Mechanism: the toast's timeout is shorter than the reading time and the toast is removed from the DOM (not just hidden), so the live region's content vanishes mid-announcement. Detection: a browser test asserts toasts persist in the DOM (visually hidden is acceptable) for a minimum duration after the timeout; a component test asserts the removal delay exceeds a reading-time threshold.
- **Real-world example:** The premature-toast-removal class; the minimum-persistence test is the standard automated catch.

### BUG-UX-130 — Focus visible only via mouse interaction
- **Category:** Usability Glitch · keyboard-a11y
- **Description:** The user Tabs to a button and no focus indicator appears, though clicking it shows one. Mechanism: the focus style is applied via mouse-activated states only, or `:focus-visible` isn't used and a reset removed keyboard focus styles. Detection: a browser test focuses elements via keyboard emulation and asserts a visible indicator; a CSS audit asserts `:focus-visible` styles exist.
- **Real-world example:** The keyboard-focus-invisible class; the keyboard-focus assertion and `:focus-visible` audit are the standard catches.

### BUG-UX-131 — Modal doesn't receive initial focus
- **Category:** Usability Glitch · focus-trap
- **Description:** The user opens a modal and focus stays on the page behind it (or on `body`), so Tab goes to browser chrome first. Mechanism: the modal doesn't move focus into itself on open (no initial focus on the first focusable element or the dialog container). Detection: a browser test opens a modal and asserts `document.activeElement` is inside the modal; a code audit asserts an initial-focus call on open.
- **Real-world example:** The missing-initial-focus class; WAI-ARIA dialog guidance requires moving focus into the dialog and the activeElement test is the standard catch.

### BUG-UX-132 — Landmark regions missing
- **Category:** Usability Glitch · a11y-label
- **Description:** The user's screen reader navigates by landmarks and finds none — the page is an undifferentiated div tree. Mechanism: no `main`, `nav`, `header`, or `aside` (or their ARIA equivalents) wrap the page sections. Detection: an a11y audit asserts landmark regions exist (main, nav); a DOM audit flags pages without semantic containers.
- **Real-world example:** The missing-landmarks class; axe-core's landmark audits are the standard automated catch.

### BUG-UX-133 — Table overflows on mobile without a scroll container
- **Category:** Usability Glitch · responsive
- **Description:** The user opens a data table on a phone; columns are cut off with no way to see them. Mechanism: the table renders at its natural width inside a container without `overflow-x: auto` (or a responsive card layout), so wide tables clip. Detection: a browser test at 375px asserts the table is fully reachable (a scroll container exists and `scrollWidth` matches the table) or a card layout renders; a DOM audit flags tables without overflow containers.
- **Real-world example:** The overflowing-table class; the mobile-table audit is the standard automated catch and responsive card patterns are the documented fix.

### BUG-UX-134 — Cards clip their text content
- **Category:** Usability Glitch · responsive
- **Description:** The user views a card grid; card text is cut off mid-line with no tooltip or expansion. Mechanism: the card has a fixed height with `overflow: hidden` (or line-clamp) and no expansion or tooltip path for the clipped content. Detection: a browser test asserts card text is fully visible or a tooltip/expansion exists; a DOM audit compares each card's scrollHeight vs clientHeight and flags clipping.
- **Real-world example:** The clipped-card class; scrollHeight-vs-clientHeight audits are the standard automated catch.

### BUG-UX-135 — Text overlaps at mid viewports
- **Category:** Usability Glitch · responsive
- **Description:** The user resizes to a tablet-ish width (768-1024px) and two absolutely-positioned elements overlap. Mechanism: absolute positioning (or fixed offsets) tuned for desktop and mobile breakpoints collides at the untested mid-range widths. Detection: a browser test renders at incremental widths (400-1200px) and asserts no element pairs overlap (bounding-rect intersection checks); a visual regression test at mid-range viewports catches it.
- **Real-world example:** The mid-viewport-overlap class; incremental-width bounding-rect audits are the standard automated catch — mid-range widths are the classic untested gap.

### BUG-UX-136 — Touch targets under 44px
- **Category:** Usability Glitch · touch-target
- **Description:** The user taps a small icon button on a phone and misses, hitting an adjacent control. Mechanism: the clickable element's rendered touch target (padding included) is under 44x44px (Apple HIG) or 48x48dp (Material). Detection: a mobile emulation test measures every interactive element's bounding rect and flags those under the threshold; an a11y audit asserts minimum target sizes.
- **Real-world example:** The small-touch-target class; Apple HIG's 44pt and Material's 48dp guidance define the thresholds and the bounding-rect audit is the standard catch.

### BUG-UX-137 — Fixed elements cover content on small screens
- **Category:** Usability Glitch · touch-target
- **Description:** The user scrolls to the bottom of a page on a phone; a fixed bottom bar covers the last content. Mechanism: the fixed bar overlays in-flow content and the page provides no compensating bottom padding (or the padding is tuned for desktop only). Detection: a mobile emulation test scrolls to max, clicks the last element's center, and asserts the click hits the element (elementFromPoint) not the bar; a DOM audit compares the last element's rect against the bar's rect.
- **Real-world example:** The fixed-bar-overlap class; the elementFromPoint test is the standard automated catch.

### BUG-UX-138 — 100vh taller than the visible mobile viewport
- **Category:** Usability Glitch · responsive
- **Description:** The user views a full-height hero or modal on a phone; the bottom is hidden under the browser chrome. Mechanism: `100vh` equals the viewport including browser chrome (which shrinks on scroll), so full-height layouts overflow the visible area. Detection: a mobile emulation test asserts the full-height element's bottom edge is within the visual viewport (`window.visualViewport.height`); a CSS audit flags `100vh` in full-height layouts without `dvh`/`svh`.
- **Real-world example:** The 100vh bug; `dvh`/`svh` units are the documented fix and visualViewport-based tests are the standard catch.

### BUG-UX-139 — Layout shift from late-loading images
- **Category:** Usability Glitch · responsive
- **Description:** The user loads a page and content shifts as images render in (Cumulative Layout Shift). Mechanism: images without `width`/`height` or `aspect-ratio` reserve no space, so the layout reflows on load. Detection: Lighthouse's CLS audit flags the shift; a browser test with throttled images asserts text positions are stable.
- **Real-world example:** The image-CLS class; CLS is a Core Web Vitals metric and web.dev documents the width/height/aspect-ratio reservation as the fix.

### BUG-UX-140 — Dark mode renders unreadable surfaces
- **Category:** Usability Glitch · responsive
- **Description:** The user switches to dark mode; some surfaces stay light (or text becomes invisible against same-color backgrounds). Mechanism: hardcoded colors (not theme tokens) don't switch with the theme, leaving mixed-mode surfaces. Detection: a browser test in dark mode asserts no light-mode surfaces remain (background-color audits against the token set); a design-token test asserts every color comes from the theme.
- **Real-world example:** The mixed-dark-mode class; token-enforced color audits are the standard automated catch.

### BUG-UX-141 — Grid collapses at the wrong width
- **Category:** Usability Glitch · responsive
- **Description:** The user resizes to 900px and a three-column grid collapses to one column too early. Mechanism: the media query breakpoint (or `minmax` floor) is mismatched with the content's minimum width, triggering the collapse before the columns actually can't fit. Detection: a browser test renders at incremental widths and asserts the column count matches the breakpoint spec at each width; a CSS audit asserts breakpoints align with content minimums.
- **Real-world example:** The breakpoint-mismatch class; incremental-width column-count assertions are the standard automated catch.

### BUG-UX-142 — Off-canvas menu visible at the wrong width
- **Category:** Usability Glitch · responsive
- **Description:** The user resizes to a mid width and the off-canvas sidebar overlaps content (or is visible when it should be hidden). Mechanism: the off-canvas transform (translateX) is gated by a breakpoint that doesn't match the layout switch, so the menu is half-visible at some widths. Detection: a browser test renders at incremental widths and asserts the sidebar is fully off-screen or fully docked (transform/position checks); a visual regression test at mid widths catches it.
- **Real-world example:** The half-open-off-canvas class; transform-position audits at incremental widths are the standard automated catch.

### BUG-UX-143 — Footer links overflow horizontally
- **Category:** Usability Glitch · responsive
- **Description:** The user views the footer on a narrow screen; link groups overflow horizontally off-screen. Mechanism: the footer's flex container lacks `flex-wrap` (or uses fixed-width columns), so links don't wrap. Detection: a mobile emulation test asserts the footer's content is within the viewport (`scrollWidth <= innerWidth`); a CSS audit asserts `flex-wrap: wrap` on multi-column footers.
- **Real-world example:** The non-wrapping-footer class; the viewport-fit audit is the standard automated catch.

### BUG-UX-144 — Modal wider than the viewport on mobile
- **Category:** Usability Glitch · responsive
- **Description:** The user opens a modal on a phone; it extends past the screen edges. Mechanism: the modal's width is fixed in px (or a percentage of a wide container) with no `max-width: 100%` or viewport constraint. Detection: a mobile emulation test asserts the modal's bounding rect is within the viewport; a CSS audit asserts max-width constraints on modals.
- **Real-world example:** The overflowing-modal class; the viewport-fit assertion is the standard automated catch.

### BUG-UX-145 — Sticky footer covers the last table row
- **Category:** Usability Glitch · responsive
- **Description:** The user scrolls a table to its last row; a sticky summary footer covers it. Mechanism: the sticky footer overlays in-flow content and the scroll container provides no bottom padding to clear it. Detection: a browser test scrolls to max and asserts the last row's center point is clickable (elementFromPoint); a DOM audit compares the last row's rect against the footer's rect.
- **Real-world example:** The sticky-footer-overlap class; the elementFromPoint test is the standard automated catch.

### BUG-UX-146 — px-based font sizes don't scale with user preferences
- **Category:** Usability Glitch · responsive
- **Description:** The user zooms the browser or sets a larger default font size; text scales inconsistently with the layout (or doesn't scale at all). Mechanism: font sizes in `px` don't respond to user font-size preferences (rem/em do), breaking zoom and accessibility scaling. Detection: a browser test sets a larger default font size and asserts text scales; a CSS audit asserts font-size tokens use rem/em.
- **Real-world example:** The px-font-size class; rem-based typography is the documented accessibility practice and the font-scaling test is the standard catch.

### BUG-UX-147 — Icon font fails to load, showing tofu boxes
- **Category:** Usability Glitch · responsive
- **Description:** The user loads a page on a slow network; icons render as empty boxes (tofu) or invisible glyphs. Mechanism: the icon font uses `font-display: block` (invisible during load) with no fallback glyph and no system-font fallback declared. Detection: a browser test with throttled fonts asserts icons remain visible (fallback or display: swap); a CSS audit asserts `font-display: swap` and fallback fonts.
- **Real-world example:** The icon-font-tofu class; `font-display: swap` is the documented fix and the throttled-font test is the standard catch.

### BUG-UX-148 — Landscape orientation breaks the layout
- **Category:** Usability Glitch · responsive
- **Description:** The user rotates a phone to landscape; the layout breaks (fixed heights, overlapping elements). Mechanism: fixed heights (or vh-based sizing) tuned for portrait don't adapt to the shorter landscape viewport. Detection: a mobile emulation test renders in both orientations and asserts no overflow or overlap (bounding-rect audits); a visual regression test per orientation catches it.
- **Real-world example:** The portrait-only-layout class; per-orientation audits are the standard automated catch.

### BUG-UX-149 — Long unbroken strings break the layout
- **Category:** Usability Glitch · responsive
- **Description:** The user views a record with a long URL or ID; the container stretches horizontally, breaking the layout. Mechanism: no `overflow-wrap: break-word` or `word-break` is set, so unbroken strings extend their container. Detection: a browser test renders a record with a long unbroken string and asserts the container width is unchanged; a CSS audit asserts overflow-wrap on user-content containers.
- **Real-world example:** The unbroken-string class; the long-string test is the standard automated catch.

### BUG-UX-150 — Images distort at non-native aspect ratios
- **Category:** Usability Glitch · responsive
- **Description:** The user views an image in a fixed-ratio container; it stretches or squashes. Mechanism: no `object-fit` is set, so the image fills the container by stretching instead of cropping. Detection: a browser test asserts rendered image dimensions preserve aspect ratio (naturalWidth/Height vs rendered rect); a CSS audit asserts object-fit where containers fix ratios.
- **Real-world example:** The distorted-image class; the aspect-ratio assertion is the standard automated catch.

### BUG-UX-151 — Spacing doesn't scale across breakpoints
- **Category:** Usability Glitch · responsive
- **Description:** The user views a page on mobile; desktop-tuned paddings leave cramped or excessive spacing. Mechanism: spacing tokens are static (single value) rather than responsive (per-breakpoint), so desktop spacing ships to mobile. Detection: a mobile emulation test asserts spacing matches the responsive spec (computed padding/margin audits); a design-token test asserts responsive spacing tokens exist.
- **Real-world example:** The static-spacing class; per-breakpoint spacing audits are the standard automated catch.

### BUG-UX-152 — Dropdown menus clip at the viewport edge
- **Category:** Usability Glitch · responsive
- **Description:** The user opens a dropdown near the right or bottom edge; the menu extends past the viewport and is cut off. Mechanism: no collision detection (floating-ui/popper-style positioning) repositions the menu to fit the viewport. Detection: a browser test opens the dropdown at each edge position and asserts the menu's rect is within the viewport; a component test asserts collision-aware positioning.
- **Real-world example:** The viewport-edge-clip class; collision-aware positioning (Floating UI) is the documented fix and the edge-position test is the standard catch.

### BUG-UX-153 — Text inputs too narrow on mobile
- **Category:** Usability Glitch · responsive
- **Description:** The user taps a search or address input on a phone; the visible portion is too narrow to read what they type. Mechanism: the input's width is fixed in px (or a fraction of a wide container) instead of full-width on mobile. Detection: a mobile emulation test asserts inputs' widths meet the responsive spec (bounding rect vs container); a CSS audit asserts width: 100% on mobile inputs.
- **Real-world example:** The narrow-mobile-input class; the width audit is the standard automated catch.

### BUG-UX-154 — Print stylesheet missing
- **Category:** Usability Glitch · responsive
- **Description:** The user prints a page; it prints with dark backgrounds, hidden content, and broken layout. Mechanism: no `@media print` styles exist, so screen styles (dark theme, fixed elements, hidden sections) ship to print. Detection: a print-emulation test (Playwright media: print) asserts readable output (light backgrounds, visible content); a CSS audit asserts a print media block exists.
- **Real-world example:** The missing-print-styles class; print-emulation tests are the standard automated catch.

### BUG-UX-155 — Rapid clicks create duplicate records
- **Category:** Usability Glitch · race-ux
- **Description:** The user clicks a "Create" button rapidly; two records appear. Mechanism: no idempotency key or in-flight guard deduplicates the mutation — each click fires a request. Detection: a browser test clicks rapidly and asserts one record (server state or network count); a code audit asserts idempotency keys or disabled-during-flight guards.
- **Real-world example:** The duplicate-record class; idempotency keys (Stripe's model) are the documented prevention and the rapid-click test is the standard catch.

### BUG-UX-156 — Back during save loses data
- **Category:** Usability Glitch · race-ux
- **Description:** The user clicks Back while a form save is in flight; the save is canceled (or completes but the UI is gone) and the edits are lost. Mechanism: navigation unmounts the form, discarding in-flight state, and no beforeunload guard or draft persistence protects it. Detection: a browser test clicks Back mid-save and asserts the data is recoverable (draft restored or save completes); a state check asserts an unmount guard exists.
- **Real-world example:** The back-during-save class; beforeunload guards and draft persistence are the documented patterns and the mid-save navigation test is the standard catch.

### BUG-UX-157 — Refresh during an action corrupts state
- **Category:** Usability Glitch · race-ux
- **Description:** The user refreshes mid-action (a multi-step toggle or payment); the UI shows a state inconsistent with the server. Mechanism: client-side in-memory state (step counters, optimistic values) is lost on refresh while partial server mutations persist, leaving a mismatch. Detection: a browser test refreshes mid-action and asserts UI state matches server state (query the server); a state check asserts actions are idempotent or resumable after refresh.
- **Real-world example:** The mid-action-refresh class; the refresh-then-assert-server-consistency test is the standard automated catch.

### BUG-UX-158 — Debounced search returns stale results after the user stopped
- **Category:** Usability Glitch · race-ux
- **Description:** The user types "abc", pauses, then types "abcd"; the older "abc" response arrives after "abcd"'s and overwrites the fresh results. Mechanism: the debounce fires the fetch but doesn't cancel prior in-flight requests (no AbortController), so stale responses land last. Detection: a browser test fires two searches with controlled latencies and asserts the freshest query's results render; a code audit asserts the debounce path aborts prior requests.
- **Real-world example:** The stale-search-overwrite class; the controlled-latency search test is the standard catch and AbortController-in-debounce is the documented fix.

### BUG-UX-159 — Out-of-order fetch responses in a dashboard
- **Category:** Usability Glitch · race-ux
- **Description:** The user switches between two dashboard views quickly; the slower view's data renders in the faster view's layout. Mechanism: no request sequencing (no abort, no sequence check) ensures only the latest request's response renders. Detection: a browser test switches views with controlled latencies and asserts the UI matches the latest view; a code audit asserts sequence guards on view-level fetches.
- **Real-world example:** The out-of-order-dashboard class; the controlled-latency view-switch test is the standard catch.

### BUG-UX-160 — Loading states flash mid-flow on a slow network
- **Category:** Usability Glitch · race-ux
- **Description:** The user completes a multi-step flow on a slow network; intermediate screens flash loading states between steps. Mechanism: each step's fetch sets a loading flag that gates the whole flow container, so every step transition shows a full-page spinner. Detection: a browser test with throttled network completes the flow and asserts no full-page spinner appears mid-flow; a code audit asserts step-level loading scoping.
- **Real-world example:** The mid-flow-spinner class; the throttled-flow test is the standard automated catch.

### BUG-UX-161 — Optimistic updates flash wrong data before correction
- **Category:** Usability Glitch · race-ux
- **Description:** The user toggles a like; the count shows a wrong value briefly, then corrects when the server responds. Mechanism: the optimistic value is computed incorrectly (or applied to the wrong item) and corrected on response, flashing wrong data. Detection: a browser test with controlled latency asserts the optimistic value matches the expected post-action value at every frame (or no flash occurs); a state check asserts the optimistic computation mirrors the server's logic.
- **Real-world example:** The optimistic-flash class; frame-level assertions with controlled latency are the standard catch.

### BUG-UX-162 — Concurrent edits silently discard the first user's changes
- **Category:** Usability Glitch · race-ux
- **Description:** Two users edit the same record; the second save overwrites the first with no conflict warning. Mechanism: no versioning or conflict detection (no ETag, no updated_at check) — last-write-wins silently. Detection: an integration test performs two concurrent saves and asserts a conflict signal or merge behavior; a code audit asserts version checks on mutation.
- **Real-world example:** The silent-last-write-wins class; ETag/If-Match versioning is the documented prevention and the concurrent-save test is the standard catch.

### BUG-UX-163 — Timer-based auto-save fires after unmount
- **Category:** Usability Glitch · race-ux
- **Description:** The user closes a form with auto-save; a timer fires after unmount and throws (or corrupts state). Mechanism: the `setInterval`/`setTimeout` isn't cleared in the cleanup function, so it fires after unmount and calls setState on an unmounted component. Detection: a unit test unmounts the component and asserts no timer fires; a code audit asserts timers are cleared in useEffect cleanup.
- **Real-world example:** The uncleared-timer class; React's cleanup guidance makes timer clearing a documented requirement and the unmount test is the standard catch.

### BUG-UX-164 — Double-click on a link opens two tabs
- **Category:** Usability Glitch · race-ux
- **Description:** The user double-clicks a link; two tabs open. Mechanism: the click handler opens the tab AND the anchor's default behavior also navigates (no preventDefault), so both fire. Detection: a browser test double-clicks and asserts one tab opens; a code audit asserts click handlers call preventDefault when also opening programmatically.
- **Real-world example:** The double-tab class; the double-click assertion is the standard automated catch.

### BUG-UX-165 — Toast for a completed action appears on the wrong page
- **Category:** Usability Glitch · race-ux
- **Description:** The user starts a long action, navigates to another page, and the success toast appears there (out of context). Mechanism: a global toast bus isn't scoped to the originating route, so the toast renders wherever the user is. Detection: a browser test navigates away mid-action and asserts the toast appears only on the originating route (or is suppressed); a state check asserts toast scoping.
- **Real-world example:** The cross-route-toast class; toast-scoping assertions are the standard catch.

### BUG-UX-166 — Session timeout mid-form loses the submission
- **Category:** Usability Glitch · race-ux
- **Description:** The user's session expires while filling a form; clicking Submit fails silently and the data is lost. Mechanism: the 401 response is swallowed (or redirects to login without preserving the form), losing the submission. Detection: a browser test expires the session (mock 401) mid-form and asserts the data is preserved through re-auth (or an explicit error appears); a state check asserts 401 handling preserves form state.
- **Real-world example:** The 401-mid-form class; auth-expiry tests with form preservation are the standard catch.

### BUG-UX-167 — Upload completes but the UI shows in-progress
- **Category:** Usability Glitch · race-ux
- **Description:** The user uploads a file; the server receives it but the progress bar keeps running. Mechanism: the completion event (load/done) isn't wired to the success transition, so the UI never learns the upload finished. Detection: a browser test uploads and asserts the success state shows when the server confirms; a state check asserts the completion handler transitions the UI.
- **Real-world example:** The unhandled-completion class; the upload-completion test is the standard catch.

### BUG-UX-168 — Rate-limited API shows a generic error
- **Category:** Usability Glitch · race-ux
- **Description:** The user triggers a 429 (rate limit); the UI shows "Something went wrong" with no retry guidance. Mechanism: the error handler doesn't distinguish 429 (no Retry-After handling, no backoff-and-retry). Detection: a browser test mocks a 429 and asserts a rate-limit-specific message or auto-retry occurs; a code audit asserts 429 handling.
- **Real-world example:** The unhandled-429 class; Retry-After handling is the documented prevention and the 429-mock test is the standard catch.

### BUG-UX-169 — Click during a re-render hits the wrong element
- **Category:** Usability Glitch · race-ux
- **Description:** The user clicks a button just as the list re-renders; the click lands on a different element (the DOM shifted under the cursor). Mechanism: the DOM swaps (React reconciliation) between the mousedown and click events, so the click's target differs from the pressed element. Detection: a browser test clicks during a triggered re-render and asserts the intended element receives the click; a DOM check asserts click target identity matches mousedown target.
- **Real-world example:** The DOM-shift-click class; mousedown-vs-click target assertions are the standard catch.

### BUG-UX-170 — WebSocket reconnect storm opens multiple connections
- **Category:** Usability Glitch · race-ux
- **Description:** The user's network flakes; the app opens several parallel WebSocket connections, duplicating events. Mechanism: the reconnect logic has no backoff and no connection dedup — each failure spawns a new socket without closing the old. Detection: a browser test toggles offline/online rapidly and asserts one active connection (socket count); a code audit asserts backoff and dedup in reconnect logic.
- **Real-world example:** The reconnect-storm class; exponential backoff is the documented prevention and the connection-count test is the standard catch.

### BUG-UX-171 — Polling interval shorter than request duration
- **Category:** Usability Glitch · race-ux
- **Description:** The app polls an endpoint every 2 seconds while requests take 5 seconds; requests overlap and pile up. Mechanism: the polling loop has no in-flight guard — each tick fires a new request regardless of pending ones. Detection: a browser test with slow mocked responses asserts no overlapping requests (network request timeline); a code audit asserts an in-flight guard in the polling loop.
- **Real-world example:** The overlapping-poll class; the slow-response polling test is the standard catch.

### BUG-UX-172 — Keyboard shortcut fires while typing in an input
- **Category:** Usability Glitch · race-ux
- **Description:** The user types a letter that matches a global shortcut (e.g., "s" for save) in a text field; the shortcut fires. Mechanism: the global keydown handler doesn't exclude events originating from inputs/textareas (no target check). Detection: a browser test types shortcut-matching characters in an input and asserts no shortcut fires; a code audit asserts input-target exclusion in global handlers.
- **Real-world example:** The shortcut-while-typing class; the input-target exclusion test is the standard catch.

### BUG-UX-173 — Optimistic rollback flashes the deleted item
- **Category:** Usability Glitch · race-ux
- **Description:** The user deletes a row optimistically; the server rejects, the rollback restores the row, but the list flashes (removes then re-adds) the row visibly. Mechanism: the rollback restores by refetching (or re-rendering the whole list) rather than surgically reinserting, producing a visible flash. Detection: a browser test with controlled latency asserts no visible flash (the row's DOM presence stays stable or reinserts without a full remount); a state check asserts surgical rollback.
- **Real-world example:** The rollback-flash class; DOM-presence assertions during rollback are the standard catch.

### BUG-UX-174 — Search-as-you-type fires per keystroke
- **Category:** Usability Glitch · race-ux
- **Description:** The user types a 10-character query; 10 API requests fire, burning quota and producing out-of-order responses. Mechanism: no debounce (or an incorrectly configured one) — each keystroke fires a request. Detection: a browser test types a query and asserts the request count matches the debounce config; a code audit asserts a debounce on search-as-you-type.
- **Real-world example:** The per-keystroke-fetch class; debounce is the documented prevention and the request-count test is the standard catch.

### BUG-UX-175 — Skeleton-to-content flash under 100ms
- **Category:** Usability Glitch · race-ux
- **Description:** The user loads fast-cached data; a skeleton flashes for a few frames before content pops in, producing jank. Mechanism: no minimum skeleton display time — content renders as soon as data arrives, even within a single frame. Detection: a browser test loads cached data and asserts either no skeleton appears (fast path) or a minimum display duration is honored; a component test asserts a minimum-skeleton-time config.
- **Real-world example:** The skeleton-flash class; minimum-display-time is the documented prevention and the cached-load test is the standard catch.

### BUG-UX-176 — Lazy-loaded route chunk fails silently
- **Category:** Usability Glitch · race-ux
- **Description:** The user navigates to a lazy route on a flaky network; the chunk fails to load and the route renders blank. Mechanism: the dynamic `import()` has no error handling (no retry, no error boundary), so a failed chunk load renders nothing. Detection: a browser test blocks the chunk request and asserts an error message or retry appears; a code audit asserts error handling around dynamic imports.
- **Real-world example:** The failed-chunk class; chunk-failure handling (retry plus error boundary) is the documented prevention and the blocked-chunk test is the standard catch.

### BUG-UX-177 — Back button in a multi-step form loses everything
- **Category:** Usability Glitch · navigation
- **Description:** The user completes steps 1-3 of a wizard, presses the browser Back button, and returns; all entered data is gone. Mechanism: wizard state lives in per-step component state, unmount discards it, and no persistence or beforeunload guard protects it. Detection: a browser test completes steps, presses Back, returns, and asserts the data persists; a state check asserts wizard state is lifted to a store or URL.
- **Real-world example:** The wizard-back-loss class; the wizard-back-preserve test is the standard catch.

### BUG-UX-178 — Direct URL to a protected route shows a blank page
- **Category:** Usability Glitch · routing
- **Description:** The user pastes a URL to a protected route while logged out; a blank page renders instead of a redirect to login. Mechanism: the auth check is client-side only and the route renders its layout while the auth query resolves (or fails silently), with no guard redirect. Detection: a browser test opens the protected URL logged out and asserts a redirect to login (or an auth message); a code audit asserts route guards redirect on unauthenticated access.
- **Real-world example:** The blank-protected-route class; route-guard redirect assertions are the standard catch.

### BUG-UX-179 — Breadcrumbs built from URL segments show IDs
- **Category:** Usability Glitch · navigation
- **Description:** The user views breadcrumbs reading "Items / 4821 / Edit" instead of "Items / Blue Widget / Edit". Mechanism: the breadcrumb builds from URL path segments (which contain IDs) rather than fetching display names for the entities. Detection: a browser test asserts breadcrumb labels show entity names, not IDs; a code audit asserts breadcrumbs resolve display names.
- **Real-world example:** The ID-in-breadcrumb class; display-name resolution is the documented fix and the label assertion is the standard catch.

### BUG-UX-180 — Next button rendered on the last page
- **Category:** Usability Glitch · navigation
- **Description:** The user on the last page sees an enabled Next button; clicking does nothing (or errors). Mechanism: the pagination edge case lacks disabled logic (no `page >= totalPages` check). Detection: a browser test loads the last page and asserts Next is disabled or absent; a state check asserts the boundary condition.
- **Real-world example:** The dead-pagination class; edge-case disabled assertions are the standard catch.

### BUG-UX-181 — List state lost when navigating away and back
- **Category:** Usability Glitch · navigation
- **Description:** The user filters, sorts, and paginates a list, opens a detail, and returns; the list is reset to defaults. Mechanism: no route-level caching (no query cache retention, no state persistence) — the list remounts fresh. Detection: a browser test applies filters/sort/pagination, navigates away and back, and asserts all persist; a state check asserts route-level state retention.
- **Real-world example:** The list-state-loss class; route-level caching (React Query's cache, URL state) is the documented fix and the navigate-away-back test is the standard catch.

### BUG-UX-182 — Refresh resets the whole SPA state
- **Category:** Usability Glitch · navigation
- **Description:** The user refreshes mid-session; filters, tabs, and modal state are all gone. Mechanism: app state lives in memory only (no URL persistence, no store persistence) — a refresh re-initializes everything. Detection: a browser test sets state, refreshes, and asserts critical state persists (URL-restorable state); a code audit asserts URL or store persistence for key state.
- **Real-world example:** The refresh-resets-everything class; URL-as-state is the documented fix and the refresh-asserts test is the standard catch.

### BUG-UX-183 — All pages show the same document.title
- **Category:** Usability Glitch · navigation
- **Description:** The user has 10 tabs open from the app; every tab shows the same title, making them indistinguishable. Mechanism: `document.title` is set once (or never) and not updated per route. Detection: a browser test navigates routes and asserts the title changes per route; a code audit asserts per-route title updates.
- **Real-world example:** The static-page-title class; per-route title management is the documented fix and the title-per-route test is the standard catch.

### BUG-UX-184 — Deep link opens the wrong tab
- **Category:** Usability Glitch · routing
- **Description:** The user opens a URL meant to show tab 3; the default tab renders. Mechanism: tab state isn't in the URL (no query param or hash), so the deep link can't select it. Detection: a browser test opens the URL with the tab param and asserts the correct tab renders; a code audit asserts tab state is URL-restorable.
- **Real-world example:** The non-URL tab state class; URL-restorable tab state is the documented fix and the deep-link test is the standard catch.

### BUG-UX-185 — Browser Back exits the app instead of the previous view
- **Category:** Usability Glitch · routing
- **Description:** The user opens a modal (or detail overlay), presses Back, and the app exits to the previous site instead of closing the overlay. Mechanism: the overlay isn't pushed to history (no `pushState`/router push), so Back navigates past the app. Detection: a browser test opens an overlay, presses Back, and asserts the overlay closes (not an app exit); a code audit asserts overlays push history entries.
- **Real-world example:** The history-less overlay class; history-integrated overlays are the documented fix and the Back assertion is the standard catch.

### BUG-UX-186 — Hash link scrolls to top in an SPA
- **Category:** Usability Glitch · routing
- **Description:** The user clicks an in-page anchor link; the SPA router intercepts it and scrolls to top (or navigates) instead of scrolling to the anchor. Mechanism: the router's link handler intercepts hash clicks without excluding same-page anchors. Detection: a browser test clicks a same-page anchor and asserts the viewport scrolls to the target; a code audit asserts hash-click exclusion.
- **Real-world example:** The SPA-hash-intercept class; same-page anchor exclusion is the documented fix and the scroll assertion is the standard catch.

### BUG-UX-187 — Trailing-slash mismatch creates duplicate routes
- **Category:** Usability Glitch · routing
- **Description:** The user navigates to `/path/` and gets a different render (or a 404) than `/path`. Mechanism: both routes are registered (or neither normalizes), so the trailing slash produces a distinct route. Detection: a browser test requests both forms and asserts identical renders; a code audit asserts route normalization.
- **Real-world example:** The trailing-slash class; route normalization is the documented fix and the both-forms test is the standard catch.

### BUG-UX-188 — Query params dropped on navigation
- **Category:** Usability Glitch · routing
- **Description:** The user applies filters, clicks a record, then uses the breadcrumb to return; the filters are gone because the link dropped the query params. Mechanism: the link builder doesn't carry the current search params (hardcoded hrefs without query propagation). Detection: a browser test applies filters, navigates via the link, and asserts the params persist in the URL; a code audit asserts query-param propagation in link builders.
- **Real-world example:** The dropped-query-params class; param propagation is the documented fix and the URL assertion is the standard catch.

### BUG-UX-189 — 404s for valid routes after a deploy
- **Category:** Usability Glitch · routing
- **Description:** The user loads the app after a deploy (cached index.html) and routes 404 because the chunk hashes changed. Mechanism: the cached HTML references old chunk filenames that no longer exist post-deploy. Detection: a browser test loads the app with a cached index.html and a fresh deployment and asserts routes load (or the cache is invalidated); a build check asserts cache-busting headers on index.html.
- **Real-world example:** The stale-chunk class; no-cache headers on index.html are the documented fix and the cached-load test is the standard catch.

### BUG-UX-190 — Redirect loop between two routes
- **Category:** Usability Glitch · routing
- **Description:** The user opens a route and the browser loops between two redirects until it errors. Mechanism: two routes redirect to each other (mutual guards with no loop detection). Detection: a browser test opens the route and asserts a terminal render (no loop); a code audit asserts redirect guards can't form cycles.
- **Real-world example:** The redirect-loop class; loop detection in guards is the documented fix and the terminal-render test is the standard catch.

### BUG-UX-191 — Breadcrumb link loses the list filter
- **Category:** Usability Glitch · navigation
- **Description:** The user clicks a breadcrumb to return to a filtered list; the filter is gone. Mechanism: the breadcrumb's href omits the query params that encode the filter. Detection: a browser test applies a filter, navigates to a detail, clicks the breadcrumb, and asserts the filter persists; a code audit asserts breadcrumbs carry query params.
- **Real-world example:** The filter-losing-breadcrumb class; param-carrying breadcrumbs are the documented fix and the assertion is the standard catch.

### BUG-UX-192 — Next/prev buttons don't mirror in RTL
- **Category:** Usability Glitch · navigation
- **Description:** The user in an RTL locale sees the Next arrow pointing right (forward in LTR terms) while content flows right-to-left. Mechanism: directional icons (arrows, chevrons) aren't flipped for RTL (no `[dir='rtl']` styles or logical properties). Detection: a browser test in RTL asserts directional icons mirror the content flow; a CSS audit asserts logical properties or RTL overrides on directional icons.
- **Real-world example:** The RTL-direction class; logical properties (margin-inline, inset-inline) are the documented fix and the RTL test is the standard catch.

### BUG-UX-193 — Route transition animation blocks interaction
- **Category:** Usability Glitch · navigation
- **Description:** The user clicks a link; the transition animation plays and the new page's content is visible but not interactive for a moment. Mechanism: the transition overlay covers the page after content renders (the animation's completion doesn't remove the overlay). Detection: a browser test clicks during the transition and asserts interaction works as soon as content is visible; a state check asserts the overlay removes on animation completion.
- **Real-world example:** The blocking-transition class; overlay-removal-on-completion assertions are the standard catch.

### BUG-UX-194 — Unknown route renders blank instead of a 404 page
- **Category:** Usability Glitch · routing
- **Description:** The user mistypes a URL; a blank page renders with no not-found message. Mechanism: no catch-all route exists, so unknown paths render an empty layout. Detection: a browser test opens an unknown path and asserts a not-found page renders; a code audit asserts a catch-all route exists.
- **Real-world example:** The missing-catch-all class; catch-all route assertions are the standard catch.

### BUG-UX-195 — Modal state not restorable via URL
- **Category:** Usability Glitch · routing
- **Description:** The user opens a record's edit modal, refreshes, and the modal is gone (the page shows the record instead). Mechanism: the modal's open state isn't in the URL (no query param), so refresh can't restore it. Detection: a browser test opens the modal, refreshes, and asserts it reopens (or the URL encodes it); a code audit asserts modal state is URL-restorable where intended.
- **Real-world example:** The non-URL modal state class; URL-restorable modal state is the documented fix and the refresh test is the standard catch.

### BUG-UX-196 — Back from a detail page returns to page 1 of the list
- **Category:** Usability Glitch · navigation
- **Description:** The user on page 5 opens a record, presses Back, and the list renders page 1. Mechanism: pagination state isn't preserved across navigation (not in URL, not in a route-level store that survives). Detection: a browser test on page 5 opens a detail, presses Back, and asserts page 5 renders; a state check asserts pagination is URL-restorable.
- **Real-world example:** The pagination-reset-on-back class; URL-restorable pagination is the documented fix and the Back test is the standard catch.

### BUG-UX-197 — Hard-coded absolute links break under a sub-path deployment
- **Category:** Usability Glitch · routing
- **Description:** The user runs the app at `/app/`; clicking "Settings" navigates to `/settings` (outside the app), producing a 404. Mechanism: links are hardcoded to root-absolute paths (`href="/settings"`) instead of relative or router-generated paths. Detection: a browser test serves the app under a sub-path and asserts all links resolve within it; a code audit asserts router-generated paths.
- **Real-world example:** The root-absolute-link class; router-generated paths are the documented fix and the sub-path test is the standard catch.

### BUG-UX-198 — Hover prefetch warms the wrong route
- **Category:** Usability Glitch · routing
- **Description:** The user hovers a link; the router prefetches a different route (or the same one twice), wasting bandwidth. Mechanism: the prefetch handler reads a stale ref (or the hover fires on a parent element), prefetching the wrong target. Detection: a browser test hovers each link and asserts the prefetched route matches the hovered one (network request URL); a code audit asserts the prefetch reads the current target.
- **Real-world example:** The wrong-prefetch class; prefetch-target assertions are the standard catch.

### BUG-UX-199 — Badge shows a stale count
- **Category:** Usability Glitch · data-display
- **Description:** The user reads a notification badge showing "3" while the list shows 5 unread items. Mechanism: the badge computes from a separate cached query that wasn't invalidated with the list's mutation. Detection: a browser test triggers the mutation and asserts the badge equals the list's count; a state check asserts badge and list share a query key or are co-invalidated.
- **Real-world example:** The stale-badge class; co-invalidation assertions are the standard catch.

### BUG-UX-200 — Timestamps shown in the wrong timezone
- **Category:** Usability Glitch · data-display
- **Description:** The user reads "14:30" for an event that occurred at 09:30 their local time (UTC shown as local, or vice versa). Mechanism: the timestamp is parsed without timezone info (or formatted with `toISOString`/UTC methods) instead of converting to the user's locale timezone. Detection: a browser test with a non-UTC timezone asserts displayed times match the locale-converted value; a unit test asserts the formatter converts timezones.
- **Real-world example:** The timezone-display class; timezone-aware formatting (`Intl.DateTimeFormat` with timeZone) is the documented fix and the non-UTC test is the standard catch.

### BUG-UX-201 — Internal enum names shown to users
- **Category:** Usability Glitch · data-display
- **Description:** The user reads a status of "in_progress" or "PENDING_REVIEW" instead of "In progress" / "Pending review". Mechanism: the enum value renders raw with no display-name mapping. Detection: a browser test asserts statuses render display names, not raw enum tokens; a code audit asserts a display map exists per enum.
- **Real-world example:** The raw-enum-display class; display-name maps are the documented fix and the raw-token assertion is the standard catch.

### BUG-UX-202 — Truncated text with no tooltip
- **Category:** Usability Glitch · data-display
- **Description:** The user views a table cell with ellipsized text; the full content is inaccessible (no tooltip, no expansion). Mechanism: CSS `text-overflow: ellipsis` truncates without a `title` attribute or tooltip wiring. Detection: a browser test asserts every ellipsized cell exposes the full text (tooltip/title/aria-label); a DOM audit compares scrollWidth vs clientWidth and checks for title presence.
- **Real-world example:** The ellipsis-without-tooltip class; the scrollWidth-vs-clientWidth plus title audit is the standard catch.

### BUG-UX-203 — Lists with no stable ordering
- **Category:** Usability Glitch · data-display
- **Description:** The user reloads a list and the items appear in a different order each time. Mechanism: no sort key (or an unstable one — the server returns unsorted data and the client renders insertion order from a Set/Map iteration). Detection: a browser test reloads the list and asserts the order is stable; a code audit asserts a deterministic sort key exists.
- **Real-world example:** The unstable-order class; deterministic sort keys are the documented fix and the reload-stability test is the standard catch.

### BUG-UX-204 — Duplicate items from index keys
- **Category:** Usability Glitch · data-display
- **Description:** The user views a list after an item is inserted mid-list; a duplicate row appears (or rows show wrong data). Mechanism: the list uses `key={index}` with dynamic inserts, so React reconciles by position and reuses DOM nodes with wrong data. Detection: a browser test inserts an item mid-list and asserts no duplicates and correct data per row; a code audit asserts stable unique keys on dynamic lists.
- **Real-world example:** The index-key class; React's key guidance documents index keys with dynamic lists as the duplication source and the insert test is the standard catch.

### BUG-UX-205 — Numbers formatted inconsistently
- **Category:** Usability Glitch · data-display
- **Description:** The user views a dashboard where one metric shows "1.2k" and another "1200" for the same magnitude. Mechanism: multiple formatters (or hardcoded formatting) format numbers differently across components. Detection: a browser test asserts consistent formatting per magnitude across the dashboard; a code audit asserts one shared formatter.
- **Real-world example:** The mixed-formatter class; shared formatters are the documented fix and the consistency assertion is the standard catch.

### BUG-UX-206 — Currency without a symbol or locale format
- **Category:** Usability Glitch · data-display
- **Description:** The user views a price as "1500.00" with no currency symbol or locale-appropriate separators. Mechanism: the value renders raw (no `Intl.NumberFormat` with currency style). Detection: a browser test asserts prices render with the currency symbol and locale format; a code audit asserts a currency formatter exists.
- **Real-world example:** The raw-currency class; Intl currency formatting is the documented fix and the symbol assertion is the standard catch.

### BUG-UX-207 — Relative timestamps frozen
- **Category:** Usability Glitch · data-display
- **Description:** The user leaves a page open; timestamps read "just now" or "5 minutes ago" indefinitely. Mechanism: relative timestamps are computed once at render with no interval re-computation. Detection: a browser test leaves the page open past the threshold and asserts the timestamp updates; a code audit asserts an interval or re-render trigger exists.
- **Real-world example:** The frozen-relative-time class; interval-based re-computation is the documented fix and the staleness test is the standard catch.

### BUG-UX-208 — Table columns misaligned with headers
- **Category:** Usability Glitch · data-display
- **Description:** The user views a table with a fixed header; body columns don't line up with the header labels. Mechanism: the fixed header's column widths diverge from the body's (no `table-layout: fixed`, or the header is a separate table with independent sizing). Detection: a browser test asserts each header's rect aligns with its column's cells; a CSS audit asserts table-layout: fixed or shared width definitions.
- **Real-world example:** The header-body misalignment class; alignment assertions are the standard catch.

### BUG-UX-209 — Booleans rendered as raw "true"/"false" or 1/0
- **Category:** Usability Glitch · data-display
- **Description:** The user views a table cell reading "true" or "1" instead of "Yes"/"No" or a check icon. Mechanism: the boolean renders raw with no display mapping. Detection: a browser test asserts booleans render display values; a code audit asserts a boolean display map.
- **Real-world example:** The raw-boolean class; display maps are the documented fix and the raw-token assertion is the standard catch.

### BUG-UX-210 — Null rendered as "null" or blank
- **Category:** Usability Glitch · data-display
- **Description:** The user views a field with no value; it shows "null" (the raw token) or an indistinguishable blank. Mechanism: the null value renders raw (string interpolation of null) with no display mapping. Detection: a browser test asserts missing values render a display token ("—", "N/A"); a code audit asserts null-display mapping.
- **Real-world example:** The raw-null class; null-display tokens are the documented fix and the raw-token assertion is the standard catch.

### BUG-UX-211 — IDs shown in place of names
- **Category:** Usability Glitch · data-display
- **Description:** The user views a record list showing "user_4821" instead of "Jane Doe". Mechanism: the ID renders where a display name should be (a missing join or lookup in the data layer). Detection: a browser test asserts names render, not raw IDs; a code audit asserts the display-name lookup exists.
- **Real-world example:** The ID-for-name class; display-name lookups are the documented fix and the raw-ID assertion is the standard catch.

### BUG-UX-212 — Percentages sum over 100 after rounding
- **Category:** Usability Glitch · data-display
- **Description:** The user views a breakdown pie or table whose percentages sum to 101% (or 99%). Mechanism: each percentage rounds independently (no largest-remainder allocation), so the sum drifts. Detection: a unit test asserts breakdown percentages sum to 100 (within a documented tolerance); a code audit asserts largest-remainder rounding.
- **Real-world example:** The independent-rounding class; largest-remainder allocation is the documented fix and the sum test is the standard catch.

### BUG-UX-213 — Chart axis labels overlap
- **Category:** Usability Glitch · data-display
- **Description:** The user views a chart with 50 data points; axis labels overlap into unreadability. Mechanism: no tick thinning (the axis renders a label per point regardless of space). Detection: a browser test asserts axis labels don't overlap (bounding-rect checks); a chart-config audit asserts tick thinning.
- **Real-world example:** The overlapping-ticks class; tick thinning is the documented fix and the bounding-rect test is the standard catch.

### BUG-UX-214 — Chart tooltip shows the wrong series
- **Category:** Usability Glitch · data-display
- **Description:** The user hovers a chart point; the tooltip shows another series' values. Mechanism: the tooltip's index/key lookup diverges from the rendered data after an update (stale tooltip state or a key mismatch). Detection: a browser test hovers each point after a data update and asserts the tooltip matches the hovered series; a component test asserts the tooltip key derives from the rendered data.
- **Real-world example:** The tooltip-mismatch class; key-derivation assertions are the standard catch.

### BUG-UX-215 — Empty cells indistinguishable from zero
- **Category:** Usability Glitch · data-display
- **Description:** The user views a metrics table where a missing measurement shows "0" like a real zero. Mechanism: null values render as 0 (coercion or a formatter default) with no distinction. Detection: a browser test asserts missing values render a distinct token; a code audit asserts null-vs-zero distinction in formatters.
- **Real-world example:** The null-as-zero class; null-vs-zero display distinction is the documented fix and the assertion is the standard catch.

### BUG-UX-216 — List order changes on every render
- **Category:** Usability Glitch · data-display
- **Description:** The user interacts with a list (selecting, hovering) and the rows reorder randomly. Mechanism: an unstable sort comparator (one that returns inconsistent results for equal elements) re-sorts on each render. Detection: a browser test interacts with the list and asserts the order is stable across renders; a unit test asserts the comparator is deterministic for equal elements.
- **Real-world example:** The unstable-comparator class; deterministic comparators are the documented fix and the stability test is the standard catch.

### BUG-UX-217 — File sizes shown in raw bytes
- **Category:** Usability Glitch · data-display
- **Description:** The user views an attachment as "10485760 bytes" instead of "10 MB". Mechanism: no human-readable size formatter exists. Detection: a browser test asserts sizes render in human-readable units; a code audit asserts a size formatter.
- **Real-world example:** The raw-byte class; size formatters are the documented fix and the unit assertion is the standard catch.

### BUG-UX-218 — Durations shown in raw milliseconds
- **Category:** Usability Glitch · data-display
- **Description:** The user views a job duration as "45000" instead of "45s" (or "1m 15s" for 75000). Mechanism: the duration renders raw with no formatter. Detection: a browser test asserts durations render in readable units; a code audit asserts a duration formatter.
- **Real-world example:** The raw-duration class; duration formatters are the documented fix and the unit assertion is the standard catch.

### BUG-UX-219 — Nested objects rendered as [object Object]
- **Category:** Usability Glitch · data-display
- **Description:** The user views a field showing "[object Object]" instead of the nested data. Mechanism: an object is interpolated into a string template (template literal or a text node), invoking the default toString. Detection: a browser test asserts no "[object Object]" tokens appear in the DOM; a code audit asserts objects are serialized or mapped before interpolation.
- **Real-world example:** The object-interpolation class; serialization-before-interpolation is the documented fix and the DOM-token assertion is the standard catch.

### BUG-UX-220 — Images without alt text
- **Category:** Usability Glitch · data-display
- **Description:** The user's screen reader skips an informative image (or a broken image shows no text). Mechanism: the `<img>` lacks an `alt` attribute (or has an empty one on informative images). Detection: an a11y audit asserts every informative image has non-empty alt text; a DOM audit flags images without alt.
- **Real-world example:** The missing-alt class; axe-core's image-alt rule is the standard automated catch.

<!-- APPEND -->
