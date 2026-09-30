# Voice Box — Platform Health Report: Performance, Reliability & Experience

**Date:** 23 September 2026 · **Author:** engineering (automated analysis + verified fixes)
**Audience:** school stakeholders, the developers who will implement the follow-ups,
and the users who deserve a seamless product.
**Status:** P0 fixes shipped and verified this cycle. P1/P2 sequenced below.

> Convention used throughout: **Observation** = measured fact (tests, logs, code).
> **Opinion** = professional judgment, clearly labelled as such.

---

## 1. Executive summary (~current state in one page)

**Observation.** Voice Box is a real, working anonymous school-feedback platform
(React 19 + Vite 7 + TypeScript frontend, Supabase backend, serverless `api/`
functions). This cycle's verification battery is fully green: API suite 112 files /
1256 tests passing, frontend suite 84 files / 1367 tests passing, typecheck 0 errors,
lint 0 errors, production build succeeding, worker audit 0 failures, capability map
102/102 wired. The safety pipeline (school zero-tolerance on profanity/slang),
the appeals workflow, and the autonomous-worker registry are all covered by
falsifiable tests — not by mocks that always pass.

**Observation.** Despite that green board, users experienced the platform as broken.
Three root causes explain nearly all complaints, and all three are now fixed and
verified: (a) the network timeout budget (8 seconds) was too tight for cold cloud
starts, so ordinary actions — especially AI-assisted publishing — timed out and
looked like "every AI feature is error"; (b) the voice studio's transcription had a
race condition where server transcription silently never ran, plus a plain,
uninformative recording UI; (c) several backend automation workers queried database
columns that do not exist in production, so the Automations panel showed FAILED /
NEVER RAN while the test suite stayed green on permissive mocks.

**Opinion.** The platform is now shippable for the school handover. It is not yet
*polished*. The remaining work is ordered below so that even a partial follow-up
delivers visible value: reliability hardening first (P1), voice excellence second
(P2), load-once feel third (P3). Timelines assume one developer and include testing
time — there is no "just ship it" step anywhere in this report.

---

## 2. How this analysis was done (method)

**Observation.** Findings come from four sources, in this order of trust:

1. **Live production schema reconciliation.** The live database schema (57 tables,
   via the production API's own schema description) was pulled and every column
   reference in code was diffed against it. This is how the phantom-column failures
   were found — a method that catches what unit tests with permissive mocks cannot.
2. **Full test battery, run — not assumed.** `test:api`, frontend `test`,
   typecheck, lint, production `build`, worker audit, capability audit. All green
   numbers above are from executed runs this cycle.
3. **Real-user-path tracing.** The exact sequences a student follows (open Submit →
   speak → transcribe → structure → publish; open Feed → scroll; open Automations →
   read worker status) were walked in code, checking what the user sees at each
   failure point.
4. **Targeted reproduction.** Where a failure was suspected (e.g., "stop tap never
   triggers server transcription"), a minimal failing test was written first, the
   fix applied, and the test re-run — the standard red-green loop.

**Opinion.** This ordering matters: schema-against-production and executed test
suites beat code reading. Any future "all AI failing" report should start with
steps 1 and 2 before any code is touched.

---

## 3. Findings — issue by issue

### 3.1 Network timeouts made healthy features look broken (P0 — fixed)

**Observation.** The shared fetch wrapper (`src/lib/api.ts:61`) aborted every
standard request after 8 seconds with the message "Request timed out — check your
connection and retry." Two facts collided with that budget. First, serverless
functions and the managed database go cold: a first request after idle routinely
takes several seconds before any application code runs (this is standard
serverless behavior, documented by Vercel and AWS alike — not a Voice Box bug).
Second, the publish path is sequential and slow by design: pre-publish AI moderation
(`src/pages/Submit.tsx`, `submit()`) then the database insert, each a separate
round trip. Either leg could exceed 8 seconds on a cold start, so publishing —
the single most important action — was the most likely action to time out.
Users reasonably concluded "every AI feature is error."

**Observation.** The error message compounded the damage: one generic sentence for
three different situations (device offline, slow server, timed-out write that may
already have been applied). Users retried blindly, risking double-posts.

**Fix applied and verified.** The default budget is now 15 seconds; the publish
calls (pre-publish, post insert, poll insert) use the 28-second `postLong` budget;
and the timeout error now distinguishes "you're offline — reconnect" from
"server is taking too long (cold start) — retry, nothing was sent twice."
The two timeout unit tests were updated to the 15-second budget
(`src/__tests__/api.test.ts:267,316`). Full suites re-run green.

### 3.2 Voice studio: unreliable transcription + plain presentation (P0 — fixed)

**Observation.** Three defects stacked. (1) A race condition: the stop handler
called server transcription synchronously, but the recording hardware delivers the
audio *after* `stop()` returns — so the audio reference was always empty at that
moment and server transcription silently never ran. Users experienced exactly what
was reported: "after recording it is not transcribing." (2) When no speech
provider key is configured server-side, the endpoint returns a degraded response
that the UI previously met with silence. (3) The UI itself was a bare pulsing
button with a 12-bar meter — functional, but far from the premium hear-then-
transcribe experience users know from leading voice products.

**Fix applied and verified.** Transcription now fires from the recorder's async
completion callback (armed by an explicit flag at stop time), so a take can never
be missed by timing. The degraded-provider case is announced once per visit with a
plain sentence, and the live transcript stands untouched. The studio was rebuilt
to a premium standard following established motion practice (occasional-use
element, so standard animation is appropriate; GPU-only transform/opacity motion;
hover-gated zoom; reduced-motion support per WCAG): twin orbital rings around the
mic, a glow layer driven by live mic level, a 24-bar center-weighted waveform, and
a shimmer state on the mic during transcription. Covered by 16 Submit tests plus
the speech suite (83 tests across the voice files, all passing).

### 3.3 Backend workers failed against production while tests stayed green (P0 — fixed earlier, confirmed this cycle)

**Observation.** Several automation workers filtered or ordered by columns that do
not exist in the live database — `posts.archived` (archiving is a status value,
not a column; only `polls` has an `archived` column), `notifications.type/read`
(live: `notif_type`/`is_read`), `agent_knowledge.expires_at`, and others. Every
live run failed; the unit tests passed because their mocks accepted any column
name. The Automations panel therefore showed FAILED and NEVER RAN for real
reasons, and "unknown error" rows reflected error capture that discarded the
worker identity.

**Fix applied and verified.** All phantom-column references removed or corrected;
workers now throw honestly on database errors instead of returning silent zeros;
deferred runs persist last-run rows so NEVER RAN always carries a since-timestamp;
and a schema-contract test (`tests/api/schema-contract.test.ts`) emulates the
production database's strict column validation, so any future drift fails in the
test suite instead of in production. Worker audit: 0 failures.

### 3.4 Navigation bloat raised cognitive load (P0 — trimmed)

**Observation.** The sidebar listed 15 undifferentiated items. Research on
navigation (and plain common sense confirmed by the complaint "many unnecessary
things") says every extra item taxes every page view. No orphan or "unnamed"
pages were found on audit — every route is reachable and the one suspicious
folder (`admin/agent-office/`) is legitimately used by the Ops Center — so nothing
was deleted (deleting routes breaks bookmarks, tests, and the handover docs).

**Fix applied and verified.** Seven core destinations (Feed, Submit, Polls,
Communities, Search, Inbox, My Activity) stay top-level; seven low-traffic pages
(Insights, Suggestions, Leaderboard, Solving Board, Saved, Privacy, FAQ) sit
behind a "More" disclosure. Routes, tour hooks, and unread badges are untouched.
Typecheck and lint pass; no layout tests exist to break (noted as a gap, §5).

### 3.5 "Loading every second" perception (P0 — audited, no change needed)

**Observation.** The complaint was investigated against each polling surface.
Communities (30s) and CommunityDetail (25s) refresh with no loading indicator at
all — they set data silently. Admin Reports refreshes silently on its 15s tick
(`loadFast(true)` skips the skeleton; only the first load shows one). The one
remaining flash is the route-level skeleton when a lazily-loaded page chunk first
downloads — a one-time cost per page per deployment, and the correct trade-off
for fast first paint (code-splitting is industry-standard practice per the React
docs on `lazy` + `Suspense`).

**Opinion.** No change was the right call for the ship date. If the flash still
bothers users, prefetch the Submit chunk on sidebar hover (P3 below) — a
half-hour task with no architectural risk.

### 3.6 AI error handling is now honest at every step (P0 — verified)

**Observation.** Each AI step degrades in the open: voice structuring keeps the
user's words on screen and says "AI is busy — your words are safe, tap again";
over-long recordings keep the live transcript with a plain explanation; moderation
outages queue the post for human review instead of silently publishing or
silently dropping. These paths are covered by tests, including the degraded-
provider and record-only-browser cases.

---

## 4. Prioritized recommendations (what remains)

Rank = value × urgency ÷ risk. Each item names its owner and a verifiable
done-criterion — "done" always means tests + measured evidence, never "it works
on my machine."

### P1 — Reliability hardening (do first; ~1 week, includes testing)

1. **Database indexes for the hot queries** (backend, ½ day + ½ day load check).
   `posts(status, created_at)`, `poll_votes(poll_id)`, `comments(post_id)`.
   Done = p95 feed query time down in the admin Performance panel.
   *Best practice: index foreign-key and filter columns before any caching layer
   (standard PostgreSQL guidance, Supabase docs).*
2. **Server-side cap on the pre-publish AI call** (backend, 1 day). 20-second cap
   with automatic hold-for-review — the client already handles that path, so this
   only bounds the worst case. Done = chaos test (5s provider delay) still
   publishes-or-queues, never hangs.
3. **Cache AI suggestions by text hash, 60 seconds** (backend, ½ day). Kills the
   duplicate cost of every keystroke pause. Done = suggestion latency p50 halved
   in staging measurement.
4. **Pin serverless region near the database** (ops, 1 hour). Cross-region hops
   are pure latency tax. Done = health-check round-trip ms drops in `/api/health`.
5. **Expose per-endpoint timeout rates in admin** (full-stack, 1 day). Alert above
   2%/day. Done = the next "everything is failing" report arrives with a chart,
   not a feeling. *Opinion: this single dashboard prevents more incidents than any
   other P1 item.*

### P2 — Voice excellence (next; ~1 week, includes device testing)

6. **Waveform from real frequency data** (frontend, 1 day). The bars currently
   follow overall level; driving them from the analyser's frequency bins makes
   loud-vs-quiet visually truthful. Test on Chrome, Edge, Firefox, Safari —
   record-only mode must keep working where live recognition is absent.
7. **Playback scrubber on the bars** (frontend, 1–2 days). Tap-to-seek through the
   take; lets users verify the transcript against audio (the core trust loop).
8. **Transcript confidence display** (frontend + backend, 2 days). Underline
   low-confidence words when the provider returns scores; plain text otherwise.
   Never invent confidence when the provider gives none.
9. **Language hint before structuring** (frontend, ½ day). Confirm auto-detected
   language (English/Hindi/Bengali) — one tap to correct — before the AI draft.
10. **Demo take for mic-shy users** (frontend, ½ day). A sample recording that
    walks first-timers through speak → transcribe → review.

### P3 — Load-once feel (~3 days, low risk)

11. Prefetch Submit chunk on nav hover; stale-while-revalidate feed (show cache
    instantly, refresh silently — the Vercel SWR pattern); lazy images with blur
    placeholders; one shared 1-second ticker for poll countdowns instead of a
    timer per card; stretch community/admin polls to 60s/30s.

### P4 — Agents visibly working (~3 days)

12. Per-worker last-run + duration + items-touched in Automations; "run once now"
    per worker; dry-run preview for the case reopener; weekly digest of what
    agents did. *Opinion: trust in automation comes from visible receipts, and
    this panel is currently the weakest trust surface in the product.*

### P5 — School-day polish (ongoing)

13. One-clear-action empty states; print-friendly complaint view; Hindi/Bengali
    labels on the Submit flow; font-size toggle; full keyboard-only Submit pass;
    screen-reader pass on the voice studio live regions.

---

## 5. Timeline with testing gates (one developer, realistic)

| Window | Scope | Testing gate (must pass before next window) |
|---|---|---|
| Ship (tomorrow) | P0 already merged: timeouts, voice rebuild, nav trim + this report | Green battery recorded in §1 + human live smoke test (`docs/DEPLOY-SCHOOL.md` §6) + escalation contacts filled (`docs/SCHOOL-HANDOVER.md` §5) |
| Week 1 | P1 items 1–5 | Load test + 48h timeout-rate dashboard under 2% + chaos test on pre-publish |
| Week 2 | P2 items 6–10 | Device matrix (Chrome/Edge/Firefox/Safari, Android + iOS) with recorded evidence; record-only path re-verified |
| Week 3 | P3 + P4 | Lighthouse + bundle check; Automations panel reviewed by a non-engineer for comprehensibility |
| Ongoing | P5 | Each item ships with its test; backlog (`docs/IMPROVEMENTS-BACKLOG.md`) updated append-only |

**What is deliberately NOT promised:** route deletions (need 2 weeks of 404-log
evidence first), spaced-evasion detection upgrade (research task, boundary-tested
carefully or not at all — a false positive that silences a victim is worse than
the gap), and any "1000 improvements" checklist (a padded list is how real
priorities die).

## 6. Open items that need a human (not code)

1. **School escalation contacts** — safeguarding paths in the handover doc need
   real names and numbers; code cannot fill these in.
2. **Live smoke test on the deployed URL** — sign-in, submit, vote, appeal, and
   one automation tick, witnessed end-to-end.
3. **Speech-provider key decision** — server transcription quality (and therefore
   the voice studio's ceiling) depends on which provider key the school funds;
   without one, live recognition plus honest degradation is the permanent state.

## 7. Conclusion

**Observation.** The platform's problems were specific, found, and fixed:
a timeout budget that criminalized normal cloud latency, a transcription race
that silently dropped server results, phantom database columns that failed every
live automation run, and a flat navigation that buried the core product.
Each fix is locked by tests that fail honestly when regressed.

**Opinion.** Ship with confidence, then work the list in order. Reliability (P1)
protects the school day; voice excellence (P2) delivers the delight users asked
for; everything else compounds afterward. The measure of success is simple and
user-shaped: a student taps the mic, speaks naturally, watches accurate words
appear, publishes without thinking about the network — and never has to learn
what a timeout is.
