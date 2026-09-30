# VOICE BOX — QA Bug Ledger

Machine-readable loop state: [`LOOP-STATE.json`](./LOOP-STATE.json) · Loop plan: [`.claude/plans/VOICEBOX-QA-LOOP.md`](../../.claude/plans/VOICEBOX-QA-LOOP.md)

Counters are read from the test runners, never asserted by hand.
Golden baseline 2026-09-24: frontend **1397** / api **1311**.

---

## FIXED

### BUG-011 — Inbox bulk thread cleanup reported success for deletes that never happened
**CATEGORY:** DATA / API / STATE
**SEVERITY:** HIGH
**AREA:** 1-silent-failure-sweep
**WHERE:** `api/_inbox.js:930-1001` (`POST /api/inbox`, `action: "cleanup_threads"`)

**REPRO:** Call the admin action with `patterns` matching an existing thread and make the
`chat_threads` delete return an error (or remove 0 rows). Response before the fix:
`200 { ok: true, deleted: 1, threads: ["e2e-thread-1"] }` — a false success.

**EXPECTED:** The thread row is deleted and *proved*; children are wiped only after the
parent is gone; any delete error surfaces; `deleted` counts only real removals.

**ACTUAL:** Three unchecked deletes (messages → thread → state), `deleted++`
unconditional, then `ok:true`. Consequences:
1. A failed thread delete was announced as "Cleaned up N test threads" while the thread
   stayed in the inbox — the same "says OK but it comes back" class fixed in `_posts`
   and `_polls`.
2. Because messages were wiped **first**, a thread delete that then failed left a live
   thread with its entire history destroyed.
3. A concurrent row removal (delete returns 0 rows) was still counted as deleted.

**ROOT CAUSE:** Unverified write + false success + children-before-parent — the same
architectural pattern as BUG-009 (`_posts`) and BUG-010 (`_polls`): the cascade was
written as fire-and-forget awaits with no `.select()` proof and no `error` check.

**FIX:**
1. Delete the thread row first with `.select("thread_id")`; `error` → throw; 0 rows →
   skip (not counted, children untouched).
2. Only then wipe `chat_messages` and the `inbox_state:*` setting, each with its own
   `error` check → throw.
3. `deleted`/`threads` now report only proven removals; audit fires only when something
   was actually deleted.
Order is safe: `chat_messages.thread_id` is a plain `text` column with **no FK** to
`chat_threads` (baseline migration lines 153-167), same shape as `poll_votes`.

**G1 RED:** `npx vitest run --config vitest.config.api.ts tests/api/inbox-cleanup-threads.test.ts`
→ **4 failed** (order: `expected 'chat_messages' to be 'chat_threads'`; thread delete
failure `resolved … instead of rejecting`; message wipe failure `resolved … instead of
rejecting`; 0-row removal counted as deleted).

**G2 GREEN:** same command → **4 passed (4)**.

**G3 SUITE:** `typecheck=0` · `eslint=0` · `test:api=0 (118 files / 1315 tests)` ·
`npm test=0 (86 files / 1401 tests)` · `build=0`

**G4 BOUNDARY:** frontend 1397→**1401**, api 1311→**1315**. No test deleted, skipped,
or weakened. No new `@ts-ignore` / `eslint-disable`.

**SIBLINGS SEARCHED:** `D:\Temp\opencode\qa\unverified-success.mjs` scanned all 165 API
endpoints for "handler answers ok:true after an unverified write" → 3 files / 15 sites.
This bug is the `_inbox.js` delete family. Remaining siblings recorded below as OPEN —
deliberately NOT bundled into this fix (one root cause at a time).

**STATUS:** FIXED

---

## FIXED — rapid resubmit idempotency, no twin posts (2026-09-27)

Double-tap, retry-after-timeout, and offline-queue flush can deliver the
same payload twice with both copies passing the duplicate scan (neither
has landed when the other is checked) — the legacy table holds 13 such
identical twins as evidence. Same author + exact normalized title + same
category within 90s now returns the original row (200 + deduped:true)
instead of inserting a twin or answering a confusing 409. Deleted/hidden
twins are skipped (fresh reposts stay legitimate); the window is enforced
in JS as well as SQL so mock-ignored filters can never widen it silently.
Client honors server truth: deduped responses open the existing post with
an honest toast, and a server-held status suppresses confetti/poll-attach
even when the client pre-gate saw nothing wrong (previously a spam-held
post celebrated as live).

**G1 RED:** 2 twin tests failed; guards green. **G2 GREEN:** API 50/50
(5 new), Submit 37/37 (2 new). eslint + babel-parse clean. Uncommitted.

**STATUS:** FIXED

---

## NOTE — voice input removed from Submit + inbox (2026-09-28, user request)

Submit voice studio (record-first + dictation + server-transcribe take),
inbox mic dictation + record-first voice messages + hands-free auto-send:
all removed. Typed-text Transform (structure_complaint), read-aloud output
(post + reply Listen buttons), and typewriter stay. Deleted: VoiceMicButton
+ VoiceOrb components/tests, speech.ts input half (output-only now),
voice CSS blocks (also fixed a duplicate vb-orbit keyframe collision with
the 404 page's orbit). Server /api/transcribe + voice_complaint task KEPT:
workforce callers + health ring + admin AI tab depend on them, and they
cost nothing idle. Voice test blocks removed; output/read-aloud coverage kept.

## NOTE — crons cut to Hobby-compliant 2×daily (2026-09-28, deploy check)

Vercel Hobby rejects sub-daily cron expressions, so vercel.json now has
exactly 2 daily jobs: keep-alive 06:00 UTC (Supabase pause prevention;
cold starts possible, wake path handles them) and value-audit 03:00 UTC
(unchanged; carries the no-fake-metrics verdict flags). Removed agent-cron
*/5 and plain incident-cron */5 — the latter returned 400 on plain GET
anyway (only ?action=* branches do work), so nothing that worked was lost.
Autonomous agent ticks + incident scans now run on demand (OpsCenter Run
buttons drive the same code paths); dashboards show real last-run times.
Stale schedule comments + README cron line updated to match.

**STATUS:** DONE, uncommitted

---

## NOTE — AI management harness slices 1–3 (2026-09-27)

Approved program: registry → impact map → health ring + console →
chaos → perf ledger → behavior (injection evals pulled forward as slice 0
for security value). Status:

- Slice 0, injection evals: DONE. 11 tests; found + fixed 2 real holes
  (triageThread/summarizeThread had no output allowlists — an injected
  model could page admins with fake urgency or fake resolution).
- Slice 1, registry: DONE. api/_ai-registry.js (10 tasks, verified lanes,
  timeouts, fallbacks, rate buckets) + 8-test contract. Pure additive.
- Slice 2, impact map: DONE. docs/platform-map.json (15 flows) +
  scripts/check-platform-map.mjs + contract test. 0 broken refs; 24
  unmapped modules listed as warnings (map grows over time).
- Slice 3, health ring + console: DONE. api/_ai-health.js (bounded ring,
  demotion, aiHealthCheck, registry passthrough) wired observe-only into
  assist×4/transcribe/inbox×4, /api/health ai section, admin AI Systems
  tab (registry + measured stats + explicit refresh). 21 ring + 2 wiring
  + 5 console tests; 130-test non-disturbance sweep green.
- Slices 4–6 QUEUED: unified chaos suite, perf ledger + CI gates,
  human-behavior suite.

Environment note: C: hit 0 bytes mid-session (two zero-byte truncations:
Layout.test.tsx recovered by reconstruction, api/_assist.js restored from
git + changes re-applied). ~23 MB of gitignored build caches removed to
restore writability. Full tsc/typecheck remains environment-blocked;
user must free OS disk space.

**STATUS:** DONE (slices 0–3), all suites green at each gate

---

## NOTE — animated VoiceLogo brand mark (2026-09-27)

User-supplied art direction (purple speaker + radiating sound arcs).
Shipped as original art, not copied pixels: src/components/VoiceLogo.tsx
(gradient tile + speaker figure + 3 staggered arcs, opacity/scale only,
unique gradient ids, static mode + global reduced-motion cover).
Unified across splash core (ripple rings kept as outgoing sound),
favicon.svg, and sidebar + mobile brand marks. Announcement icons
deliberately keep the megaphone. Mark visually verified by headless
render at 128/48/16px. 4/4 component tests; Layout suites green.

**STATUS:** DONE

---

## INCIDENT — test-file truncation incident (2026-09-27, recovered)

During the mobile More-sheet work, `src/__tests__/Layout.test.tsx` was
found at 0 bytes shortly after a green run (10 tests). A 30-file
integrity sweep of every file touched this session showed exactly one
other anomaly — a false alarm (a marker string that never existed in
that file; content verified intact). Cause undetermined: disk-full
truncated write and a concurrent writer in this repo are both on record
as possibilities (LOOP-STATE integrity warnings; 9 MB free on C:).

Recovery: the file was untracked (no git copy), so it was reconstructed
from observed behavior + the intact component contracts (verified strings
in Layout.tsx first), then verified 10/10 green + eslint clean — 6
original behaviors plus the 4 new More-sheet tests. Going forward every
file write in this environment gets a read-back length check.

**STATUS:** RECOVERED, no test coverage lost

---

## FIXED — feed text overlaps (2026-09-27 · audit scan)

External audit flagged reaction-row text overlapping card headers plus
the sidebar footer overlapping nav (the latter already fixed this session
via scroll containment — still uncommitted, needs a reload to go live).
Static verification: card layout is sound (flex-wrap rows, min-w-0, no
absolute positioning, opacity/scale-only animations), all 12 <img> have
alt, icon-only buttons carry aria-labels, SPA routes + React handlers +
contact page + loading/error/confirm patterns all exist — the bulk of the
scan is false positives (incl. a 970px-wide element flagged "too small").

Two real defects fixed in `src/components/PostCard.tsx`:
1. Long unbroken user strings (prod titles) had no break rules and the
   card has no overflow containment, so tokens painted over neighbouring
   rows — title + description now `break-words`.
2. The Deleted-by-user bordered chip was nested inside the status bordered
   chip (prior edit damage) — now a sibling with clean indentation.

Tests: 2 new overlap-hardening assertions, suite 30/30, eslint +
babel-parse clean. Uncommitted; needs browser reload to go live.

Side observation (no action taken — deletes are forbidden): the prod feed
contains load-test junk rows ("Load test test-issue…", "probe probe
body", "hello the plat form is working") — someone ran the loadtest
script against production. Recommend admin Merge/Remove via admin UI.

**STATUS:** FIXED

---

## NOTE — launch capacity (free tiers) + image downscale (2026-09-27)

School launch (~4000 students + parents): operator cannot pay, so headroom
must be engineered, not bought. Measured read-only against local dev:
- 100 concurrent: 1096 reqs, 0.09% errors, p50 ~1.1s / p95 ~2.5s, zero 5xx.
- 300 concurrent: 5504 reqs @ 74 rps, ZERO errors/5xx, p95 <2s served —
  but 25.6% shed as 503 by the per-instance 100-slot guard. The database
  never blinked: the cap, not Postgres, was the binding constraint.
- Search cache works (p50 8–26ms); feed/polls/communities/leaderboard all
  carry CDN + SWR layers; no N+1 (batched chunk fan-in in _posts.js).
- Search correctly has NO shared edge cache (responses vary by viewer —
  caching them at the edge would leak unmasked author ids).

Shipped:
1. Load cap 100 → 200 in api/_load-guard.js with the measurement in the
   comment + /api/health shed_total monitoring. Guard tests adaptive (6/6).
   LIVE ONLY AFTER DEV-SERVER RESTART (api loads once) — 300-profile
   re-run still owed to confirm shedding drops with p95 stable.
2. Client image downscale (src/lib/image.ts): 1280px JPEG/0.82 before
   upload — a 3 MB photo (~4 MB base64, server cap 4 MB) shrinks 5–10×,
   saving storage + egress on every free tier. GIF/SVG passthrough,
   small files untouched, 10s bounded decode, total fallback to original.
   6/6 tests; Submit pickImage rewired; Submit suite 35/35.

Deliberately NOT run: 500/1000/2000/3000 profiles — local dev talks to the
shared PRODUCTION Supabase; firing thousands of concurrent users at it
risks real users. Those profiles must run against staging post-deploy
(harness already supports --users/--slo-p95/--slo-error/--yes).

Proposal awaiting approval (DDL migration): drop duplicate reports index
(idx_reports_created vs idx_reports_time, Supabase WARN). All other
advisor flags are foreign tables on the shared DB, deliberate janitor
indexes, or the verified service-role RLS posture.

Launch infra notes (operator actions, all free): Hobby + free-Supabase can
carry bell-time peaks IF sheds stay near zero after retune; watch
/api/health shed_total + Supabase bandwidth/DB/Realtime dashboards first
week. Realtime degrades gracefully (badge-only + polling fallback) when
free-tier sockets exhaust. Paid upgrades remain optional, not required.

**STATUS:** DONE (pending restart-gated re-measurement)

---

## NOTE — storage contract — clear cache deletes nothing (2026-09-27)

User requirement: everyday "clear cache" (cached images/files) must
never sign out, lose drafts/bookmarks/settings, or orphan votes — only a
full cookies-and-site-data wipe may start a fresh ID. Backup-file and
recovery-code designs were offered and declined (non-technical users
won't keep artifacts); a zero-action website cannot survive a full wipe,
so the guarantee is scoped to cache clears, stated honestly.

Audit result: no user data lives in sessionStorage, Cache API, or
IndexedDB (only admin token, vote-dedupe flags, reload guard — correctly
session-scoped). Identity/drafts/bookmarks/settings persist via
localStorage with cookie/memory fallbacks; posts/comments/votes persist
server-side by anonymous ID.

Shipped: `src/__tests__/storage-contract.test.ts` (4 tests — volatile
stores rigged absent/throwing, critical flows still work), Privacy page
"Clearing your browser cache" guarantee copy. Suites: storage-contract
+ identity + identity-blocked 51/51, eslint clean.

**STATUS:** DONE

---

## FIXED — voice/transcribe failure was silent (2026-09-27 · user-reported)

### BUG-024 — failed transcription showed nothing; the degraded branch was dead
**CATEGORY:** UX / ERROR-HANDLING · **SEVERITY:** HIGH (voice looked broken)
**WHERE:** `src/pages/Submit.tsx` transcribeTake, `src/pages/UserChat.tsx`
transcribeTake, vs `src/lib/api.ts` ApiError contract

User report: Submit records but never transcribes; inbox mic "does not
listen". Server-side ruled out by measurement: dev server up and serving
current code (POST /api/transcribe {} → 400 Missing audioBase64), .env
keys present AND live (Groq + NVIDIA both HTTP 200 on models endpoints),
.env predates the server processes (no stale-env), client record→upload
flow coherent, mic-denial path already truthful.

**ROOT CAUSE:** `api.post/postSlow` THROWS ApiError on every non-2xx —
including the transcribe endpoint's 503 `{degraded:true}`. Submit's
`catch {}` swallowed 502/503/403/429/timeout into total silence (record →
stop → spinner clears → no words, no message — the exact symptom), and
the `r?.degraded` branch was dead code: a 503 rejects, it never resolves,
so the "not set up" notice could never fire. Inbox showed a generic
line while discarding the server's reason/detail.

**FIX (success paths untouched):**
1. Submit: status-mapped catch (503 → once-per-visit not-set-up notice;
   429 → server wait time; 403 → reload; else persistent inline error +
   toast naming the server reason) + `transcribeError` state with a
   "Transcribe again" retry reusing the kept take (no re-record).
2. Inbox: catch maps 503/429/403 explicitly and appends the server
   message (≤120 chars) to the persistent voice error; kept take +
   existing Try-again button unchanged.
3. Status read through a type-only ApiError import (erased at compile) +
   local duck-type helper — zero test-mock churn.

**G1 RED:** 4 new tests failed (Submit silence×3 incl. dead 503 branch,
inbox missing server reason×1); all pre-existing tests green.

**G2 GREEN:** Submit 34/34 (31 incl. Transform suite + 3 new), UserChat
43/43 (42 + 1 new) — 77/77 across both files.

**G3 SUITE:** eslint clean on all 4 touched files (run singly — combined
runs OOM on the 9 MB-free disk); babel-parse OK (vite:react-babel
strictness) on all 4. Full `tsc -b` still environment-blocked.

**G4 BOUNDARY:** +4 tests (2 files extended, nothing deleted/weakened).
No new @ts-ignore / eslint-disable.


### Follow-up (same day): the 403 needed a code, and "reload" was wrong advice
The user hit the new 403 branch: "Session expired — reload the page and
try again". Investigation showed reload can essentially never fix a 403
from verifyCallerIdentity — expired/missing records self-heal by minting
inside the SAME request, so a 403 always means retry fails identically:
a live server record with no browser cookie (cookies cleared) or a stale
cookie outside the mint grace window. Posting still works in that state
because posts use the laxer checkUser while transcribe (and export,
follows, me, notifications, saved) requires the strict cookie-bound proof.

**FIX:** 403s now carry codes (`invalid_identity` for malformed/mismatched
ids; `session_unrecoverable` for the two permanent dead ends — _auth.js +
transcribe pre-check), `ApiError` plumbs an optional `code` from the body,
and both voice clients map `session_unrecoverable` to the truthful
recovery: reloading won't fix it; posts stay public; start a fresh
anonymous ID by clearing site data (export activity first — matches the
FAQ's documented semantics). Unknown 403s keep reload advice as fallback.

**G1 RED:** `session-identity-codes.test.ts` (new, 6 tests) → 4 failed
(codes absent); mint/valid pins green. **G2 GREEN:** 6/6 + transcribe 14.
Frontend recovery-copy tests (Submit + UserChat) written against the fix,
green with it: 79/79 across both files. eslint clean on all touched files
(singly), babel-parse OK, auth/transcribe/api-client suites green (no
regressions). Full `tsc -b` still environment-blocked.

**STATUS:** FIXED (client contract). If the user's takes still fail, the
UI now names the cause — report that text back instead of silence.

---

## FIXED — agent-team activation ids (2026-09-27 · iteration-11 logged LOW)

### BUG-023 — activate/deactivate/setAutonomous accepted any `b.id` as an object key
**CATEGORY:** DATA / INTEGRITY · **SEVERITY:** LOW (admin-only, as logged)
**WHERE:** `api/_agent-team.js` — `activate`, `deactivate`, `setAutonomous`

Follow-up to the REAL-but-LOW the iteration-11 sweep logged and deliberately
deferred (`state[b.id]` prototype pollution). Only `if (!b.id)` stood guard,
then the id became a plain-object key persisted into the
`agent_activation_state` settings row: `__proto__` mutated the state's
prototype, `constructor`/`prototype` created phantom entries — and the audit
log certified e.g. “Activated agent: __proto__”. Readers
(`selectAgentsForTask`, `activationState`, `agent-cron`) only look up known
ids, so the damage was phantom entries + a lying audit trail, never
privilege escalation.

**FIX:** `validActivationId` — string, 1–80 chars, `[a-zA-Z0-9_-]`, with
`__proto__`/`constructor`/`prototype` refused outright (400, no write, no
audit). Applied to all three single-id writers. Deliberately NOT an
existence allowlist: customAgents is in-memory while activation state
persists in the DB, so an allowlist would wrongly reject activations after
a cold start. The Map-based delete path is immune and untouched. No
frontend calls these actions (verified: zero src references), so the 400
surface has no UI blast radius.

**G1b RED (same cycle, sibling in the same handlers):** `saveActivationState`
updated the in-memory cache FIRST, then swallowed a failed settings upsert
(console.error only) — activate answered ok:true + audited while the row
never landed. 3 new tests failed (loud-failure, no-audit, cache-coherence).

**Fix:** persist-first — the upsert `{error}` is checked and thrown, the
cache advances only after proven persistence. Plus the follow-on the tests
caught: handlers mutate the returned state object in place
(`state[b.id] = ...`), which poisoned the shared cache even with
persist-first — so `getActivationState` now returns a defensive shallow
copy at both returns (writers only ever replace top-level keys, never
mutate nested values, so shallow is sufficient).

**G2b GREEN:** 24/24 (21 id-validation + 3 persistence).

**G1 RED:** `tests/api/agent-team-activation.test.ts` (new, 21 id-validation tests) → **15
failed** (`expected 200 to be 400` on every dangerous/malformed id), **6
passed** (built-in + custom id flows, empty/null pins — harness sound).

**G2 GREEN:** 24/24 (21 id-validation + 3 persistence). Roster suite `agent-team.test.ts` 60/60 (threads pool;
the forks-pool `spawn UNKNOWN` on that file is the known C:-full
environment failure, not a test result).

**G3 SUITE:** eslint clean on both touched files; `node --check` clean.
Full `tsc -b` still environment-blocked (C: 9 MB free).

**G4 BOUNDARY:** api +24 tests (1 new file, nothing deleted/skipped/
weakened). No new @ts-ignore / eslint-disable.

**STATUS:** FIXED

---

## FIXED — inbox admin writes (2026-09-27 · BUG-012 residuals + BUG-014)

### What was open
- BUG-012 residuals (`api/_inbox.js` reply/handoff/settings writes unchecked) —
  admin_reply, set_ai_mode, and the create_task notice were fixed in earlier
  cycles; remaining: takeover handoff notice, send_to_agent notice + null
  task, bulk_action close, dedup_messages/dedup_all deletes, PUT
  mark_read/set_status.
- BUG-013 (agent suggestion dismissal) — already FIXED in-tree before this
  cycle: `api/_agent.js` dismiss/approve both check their writes
  (`tests/api/agent-suggestion-dismiss.test.ts`, 7 tests, green). The OPEN
  label below was stale.
- BUG-014 (takeover/transfer + AI-config + task-message) — AI-config
  (set_ai_mode) was already fixed; takeover/transfer state writes go
  through setThreadState (retries + throws). Remaining: the takeover
  handoff notice and the send_to_agent notice — fixed here.

### Fixes (`api/_inbox.js`, all fail-loud, no behavior change on success)
1. takeover: the handoff notice insert is proven FIRST (checked), then
   state flips, then audit. A lost notice throws — no state change, no
   audit, never ok:true.
2. send_to_agent: null createTask answers 500 (was 200 ok:true with
   task:null); the notice insert is checked and the audit runs only after.
3. bulk_action close: per-thread results — a failed thread reports
   ok:false with its error, is skipped for state, and is NOT counted in
   `processed`; the batch continues. No frontend consumes `processed`
   (verified: zero src references).
4. dedup_messages / dedup_all: batch deletes checked; `removed` /
   `totalRemoved` count proven deletes only; failure throws instead of
   reporting removed:N over surviving rows.
5. PUT mark_read / set_status: update errors throw (were silent ok:true).
   UserChat's mark_read call sites already run inside try/catch with a
   /api/chat fallback, so a failure degrades, never crashes.
6. Triaged as NOT bugs (honest already): set_ai_mode (checked),
   admin_reply (checked), create_task notice (checked), summary upsert
   (explicit best-effort try/catch, live result still reports),
   notifyAdmin (caught + logged, called via allSettled), AI-reply save
   (failure yields auto_reply:null — truthful, user message proven),
   thread touch-up after a proven message save (secondary, message safe).

**G1 RED:** `tests/api/inbox-admin-writes.test.ts` (new, 13 tests) → **8
failed** with the exact false-success responses (ok:true + handoff flipped
with no message; removed:1 over 2 surviving rows; processed:1 on a failed
close; 200 task:null), **5 passed** (success-path pins, harness sound).

**G2 GREEN:** 13/13 after the fix.

**G3 SUITE:** inbox family + agent-dismiss 8 files → **73 passed**;
UnifiedInbox + UserChat + Layout → **82 passed**; eslint clean on both
touched files; `node --check` clean. Full `tsc -b` BLOCKED by environment
(C: 9 MB free → native alloc failure, same as 2026-09-27 Layout cycle);
the API diff is plain JS with no type surface, the test file is covered
by the vitest transform + eslint.

**G4 BOUNDARY:** api +13 tests (1 new file, nothing deleted/skipped/
weakened). No new @ts-ignore / eslint-disable.

**STATUS:** FIXED

---

## OPEN (from the sibling scan — queued for their own TDD cycles)

### BUG-012 — `_inbox.js` reply/handoff/settings writes unchecked
**CATEGORY:** DATA / STATE · **SEVERITY:** MEDIUM · **STATUS:** FIXED 2026-09-27 — see “FIXED — inbox admin writes” above
`api/_inbox.js` lines ~1143, 1187, 1234, 1249, 1256, 1298, 1430 — admin reply insert,
`inbox_ai_config` upsert, thread status update, mark-read update and task-created system
message all `await` a write without checking `error`, then report success. Same class as
BUG-011; needs its own fail-before/pass-after tests.

### BUG-013 — Agent suggestion dismissal not verified
**CATEGORY:** DATA · **SEVERITY:** MEDIUM · **STATUS:** FIXED 2026-09-27 — see “FIXED — inbox admin writes” above
`api/_agent.js:450-464` (`PUT`) — updates `agent_suggestions` to `dismissed` with no error
check, then returns `ok:true`. A failed dismissal leaves the suggestion open while the UI
shows it resolved.

### BUG-014 — Inbox takeover/transfer + AI-config + task-message writes unchecked
**CATEGORY:** DATA / STATE · **SEVERITY:** MEDIUM · **STATUS:** FIXED 2026-09-27 — see “FIXED — inbox admin writes” above
`api/_inbox.js` ~1187 (`inbox_ai_config` upsert), ~1298 (task-created system message),
~1430 (takeover/transfer) — same class as BUG-012: write awaited, `error` ignored,
`ok:true` returned.

---

## FIXED — iteration 2

### BUG-012 — Admin support reply reported delivered when it was never stored
**CATEGORY:** DATA / WORKFLOW / STATE
**SEVERITY:** HIGH (core support workflow, silent message loss)
**AREA:** 1-silent-failure-sweep
**WHERE:** `api/_inbox.js:1257-1290` (`POST /api/inbox`, `action: "admin_reply"`)

**REPRO:** `POST /api/inbox` with `{action:"admin_reply", thread_id:"thread-1", body:"We are on it"}`
and make the `chat_messages` insert return an error. Response before the fix:
`200 { ok: true, message: null }` — with the user's message already flipped to `read`.

**EXPECTED:** The reply is proven persisted (or the call fails loudly). No downstream
state mutation and no audit entry unless the reply exists.

**ACTUAL:** `const { data: ins } = await …insert(…).select(��.single()` destructured only
`data` — **`error` was discarded entirely**. On a failed insert the handler still:
1. set `state.handoff = true` / `agent = "admin"` (thread marked as taken over),
2. wrote the thread status,
3. marked every unread **user** message `read: true`,
4. wrote the `inbox_reply` audit entry,
5. answered `200 { ok: true, message: null }`.

So the admin's reply was never delivered, the user's unread messages were silently
consumed, the audit trail recorded a reply that did not exist, and both the admin UI
and the API reported success.

**ROOT CAUSE:** Same family as BUG-009/010/011 (unverified write → false success), but
the error channel was structurally unreachable: the destructuring pattern itself
discarded it, so no later check could have caught it.

**FIX:**
1. Destructure `error` and throw on it; also throw when the insert resolves with no row
   (`{data:null, error:null}` from a driver must not read as delivered).
2. The handoff flag, thread-status update, mark-read update and audit now run **only
   after** the reply is proven persisted.
3. The two follow-up writes got explicit `error` checks (same root cause, same handler).

**G1 RED:** `npx vitest run --config vitest.config.api.ts tests/api/inbox-admin-reply.test.ts`
→ **3 failed**: `promise resolved "{ statusCode: 200, …(5) }" instead of rejecting`
(insert error, unread-preservation, no-audit-on-failure). The success-path test was
already green, proving the harness was sound.

**G2 GREEN:** inbox-admin-reply + inbox-cleanup-threads → **8 passed (8)**.

**G3 SUITE:** `typecheck=0` · `eslint=0` · `test:api=0 (1319 tests)` ·
`npm test=0 (1406 tests)` · `build=0`

**G4 BOUNDARY:** api 1315→**1319**. Frontend 1401→**1406** — **not authored by this loop**;
see the tree-integrity warning below.

**SIBLINGS SEARCHED:** remaining unchecked writes in the same POST block
(`inbox_ai_config` upsert ~1187, task-created system message ~1298, takeover/transfer
~1430) remain OPEN below. They are not bundled here — one root cause per cycle.

**STATUS:** FIXED

---

## FIXED — iteration 3

### BUG-013 — Dismissed AI suggestions stayed PENDING while the audit claimed dismissal
**CATEGORY:** DATA / STATE · **SEVERITY:** MEDIUM
**AREA:** 1-silent-failure-sweep
**WHERE:** `api/_agent.js:463-477` (`PUT /api/agent`, `action: "dismiss"`)

**REPRO:** `PUT /api/agent` `{id, action:"dismiss"}` with the
`agent_suggestions` update returning an error → response before the fix:
`200 { ok: true }`, audit row `agent_dismiss` written, row still `pending`.

**ACTUAL:** The status update was awaited with no `error` check, then audited and
answered `ok:true`. The UI removed the suggestion; the server still had it pending,
so it reappeared on the next load, and the audit trail recorded a dismissal that never
happened.

**ROOT CAUSE:** Unverified write → false success (BUG-009/010/011/012 family).

**FIX:** Destructure `error` and throw; the audit entry now only runs on a proven update.
The existing idempotent "already resolved → 200 `{already:true}`" path is preserved.

**G1 RED:** `tests/api/agent-suggestion-dismiss.test.ts` → **2 failed**
(`promise resolved 200 instead of rejecting`; audit written for a dismissal that failed).
**G2 GREEN:** **4 passed (4)**.

---

### BUG-014 — Task confirmation message could vanish from the conversation
**CATEGORY:** DATA / WORKFLOW · **SEVERITY:** MEDIUM
**AREA:** 1-silent-failure-sweep
**WHERE:** `api/_inbox.js:1336-1342` (`POST /api/inbox`, `action: "create_task"`)

**REPRO:** `POST /api/inbox` `{action:"create_task", thread_id, body}` with the
`chat_messages` insert failing → before the fix: `201 { ok: true, task }` plus an
`inbox_task` audit row, with no message in the thread.

**ACTUAL:** The workforce task was created (and correctly null-checked), but the
follow-up system message — the only place the conversation tells anyone the task
exists — was inserted without an `error` check. A failure left the task real and the
conversation silent.

**ROOT CAUSE:** Same family; the guard existed on the primary write but not the
user-visible confirmation write.

**FIX:** Check the insert's `error` and throw before the audit/201.

**G1 RED:** this fix was applied before its test existed (process error). To restore the
RED→GREEN contract the production change was reverted, the test re-run
(**1 failed**: `resolved 201 instead of rejecting`), then the fix re-applied.
**G2 GREEN:** `inbox-admin-reply + agent-suggestion-dismiss + inbox-cleanup-threads`
→ **14 passed (14)**.

**G3 SUITE (iteration 3):** `typecheck=0` · `eslint=0` · `test:api=0 (121 files / 1329
tests)` · `npm test=0 (1408 tests)` · `build=0`
**G4 BOUNDARY:** api 1319→**1329** (+10, all authored by this loop). Frontend 1406→**1408**
(not authored here — see integrity warning).

### Environment note — two timeouts were contention, not regression
The first iteration-3 API run failed with 30s timeouts in
`agent-cron-registry.test.ts` and `workforce-core-coverage.test.ts` (normally 7-8s).
Both files passed in isolation (**54 passed, 22.5s**) and the re-run full suite was
clean. Neither test touches `_inbox.js` or `_agent.js`. Cause: machine contention from
the concurrent writer. Recorded so a future run is not misread as a product regression —
these two tests are simply close to the 30s ceiling under load.

---

## FIXED — iteration 4

### BUG-015 — Platform-wide AI kill switch reported "applied" when the write failed
**CATEGORY:** DATA / SAFETY-RELEVANT STATE · **SEVERITY:** HIGH
**AREA:** 1-silent-failure-sweep
**WHERE:** `api/_inbox.js:1213-1227` (`POST /api/inbox`, `action: "set_ai_mode"`)

**REPRO:** `POST /api/inbox` `{action:"set_ai_mode", enabled:false, thread_id:"…"}` with
the `settings` upsert failing → before the fix: `200 { ok:true, enabled:false }` plus an
`inbox_ai_mode` audit row reading "disabled platform-wide".

**ACTUAL:** The `inbox_ai_config` upsert had no `error` check. This toggle is the
platform-wide switch that turns AI auto-replies **off**; a failed write left AI replies
ON for every user while the admin UI showed "disabled" and the audit trail claimed the
kill switch had been thrown.

**ROOT CAUSE:** Unverified write → false success (same family). Notable because the
affected control is a safety lever, not a cosmetic setting.

**FIX:** Destructure `error` and throw before the audit and the 200.

**G1 RED:** `tests/api/inbox-admin-reply.test.ts` → **1 failed**
(`promise resolved 200 instead of rejecting`).
**G2 GREEN:** the three inbox/agent suites → **16 passed (16)**.

**Sibling triage — why the other 12 scanner hits were deliberately NOT changed:**
every `takeover` / `release` / `transfer_emotional` / `handoff` action routes through
`setThreadState()`, which already destructures `error`, retries once and rethrows
(`api/_inbox.js:297-317`, "FIX #8") — those were false positives. The `chat_messages` hit
near line 1430 is a SELECT (the 10s dedup probe), also a false positive. Editing them
would have been churn against code that is already correct.

**G3 SUITE (iteration 4):** `typecheck=0` · `eslint=0` · `test:api=0 (1331 tests)` ·
`npm test=0 (1412 tests)` · `build=0`
**G4 BOUNDARY:** api 1329→**1331** (+2, loop-authored). Frontend 1408→**1412** (concurrent
writer, not this loop).

### Environment note — build OOM under contention
The first iteration-4 build died with `FATAL ERROR: process out of memory` (~800 MB
heap). Re-run in isolation: **exit 0, 1m 2s**. Earlier builds today took 21-34s, so the
machine is heavily loaded by the concurrent writer. Not a code regression — recorded so
a future OOM is not misread as one.

---

## FIXED — iteration 5 · AREA 4 (authorization boundary)

### BUG-016 — CRITICAL: unauthenticated caller could revoke EVERY admin session
**CATEGORY:** AUTHORIZATION / SECURITY · **SEVERITY:** **CRITICAL**
**AREA:** 4-authorization-boundary
**WHERE:** `api/_admin.js:189-196` (`POST /api/admin`, `action: "revoke_all_sessions"`)

**REPRO:** No credentials of any kind.
```
POST /api/admin   { "action": "revoke_all_sessions" }
→ 200 { "ok": true }
```
Every outstanding admin session is destroyed and a forged `admin` audit row is written.

**EXPECTED:** 403 for any non-admin; the session store untouched; no audit entry.

**ACTUAL (before the fix):** `200 ok:true`, `admin_sessions` overwritten with
`{tokens: []}`, `invalidateAdminTokenCache()` called, and
`auditLog("admin", "revoke_all_sessions", "All admin sessions revoked")` written —
all with **zero** authentication. Impact: a one-request, unauthenticated,
platform-wide **admin lockout** (every moderator and admin signed out simultaneously),
plus a forged audit trail blaming a legitimate admin.

**ROOT CAUSE:** **Branch ordering.** The handler authenticates at a single choke point
("everything below requires admin", `api/_admin.js:211`) and dispatches actions by
`if (action === …)` *above* it. `revoke_all_sessions` was one of those pre-gate
branches. Its own comment asserted the opposite of the truth:

> `// Must itself be admin-authed (it sits below the isAdmin gate).`

The comment documented the intended invariant; the code never implemented it. A comment
is not a control.

**FIX:** The branch now authenticates itself before any write:
`if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });`

**G1 RED:** `tests/api/admin-revoke-sessions-authz.test.ts` → **5 failed**:
`expected 200 to be 403` (no token), `expected 200 to be 403` (non-admin token),
`expected settingWrites to have length 0 but got 1` (**the session store WAS wiped**),
`expected auditLog not to be called with ["admin","revoke_all_sessions",…]`
(**forged audit entry written**), and the admin happy-path.

**G2 GREEN:** **5 passed (5)** — plus `providers-authz` (12) = **17 passed**.

**Sibling search (every other pre-gate branch in `_admin.js`, all triaged):**
| Branch | Verdict |
|--------|---------|
| `auth_mode` | SAFE — returns only `{env_secret: boolean}`; no secret, no mutation |
| `login` | SAFE — IP rate-limited (`isLoginBlocked`), `timingSafeHexEqual` compare, audits failures |
| `verify` | SAFE — read-only echo of the caller's own token validity |
| `logout` | SAFE — removes only the CALLER's own token (`t.t !== token`); needs no privilege |
| all others | Below the `isAdmin` choke point |

**Also hardened in this iteration (no bug, missing coverage):** `tests/api/providers-authz.test.ts`
(**12 tests**) now exercises the REAL `api/_providers.js` handler. The pre-existing
`providers.test.ts` (23 tests) tests a *reimplementation* of the provider chain defined
inside the test file and never imports the handler — so the admin gate protecting the
API-key store had **zero** runtime coverage. Verified correct: `?action=list` 403s a
non-admin, all 8 POST actions 403 **before** any dispatch, `?action=categories` stays
public, and an admin gets through (proving the gate is not a blanket deny).

**G3 SUITE (iteration 5):** `typecheck=0` · `eslint=0` · `test:api=0 (1364 tests)` ·
`npm test=0 (1418 tests)` · `build=0 (31.4s)`
**G4 BOUNDARY:** api 1331→**1364** (+33; 17 of those are this iteration's two new authz
files). Nothing deleted, skipped, or weakened.

---

## VERIFIED (no defect found) — iteration 6 · AREA 4 continued

### V-001 — Branch-ordering sweep across all admin-gated handlers: clean
**TOOL:** `D:\Temp\opencode\qa\authz-branch-order.mjs` — reproduces BUG-016's exact
shape (a mutating action branch dispatched ABOVE the handler's first `isAdmin` gate).
**RESULT:** 74 admin-gated handlers audited → **0 candidate findings**. BUG-016 was the
only instance of that pattern, and it is fixed.

### V-002 — Appeals API authorization: correct, now proven at runtime
**SURFACE:** `api/_appeals.js` — the endpoint that upholds or **overturns bans**.
It previously had **no** authorization test. `tests/api/appeals-authz.test.ts` (**7
tests**) now drives the real handler against a faithful settings-KV stand-in:

| Contract | Result |
|---|---|
| `PUT overturn` by a non-admin (the banned user) | **refused** (401/403), appeal stays `open` |
| `PUT overturn` with no token | **refused**, appeal stays `open` |
| `PUT overturn` by an admin | succeeds → `overturned` |
| `GET` as a user | returns **only** that user's appeals — no cross-user leak |
| `GET` with neither token nor anon id | **refused** |
| `POST` filing for another user's id | **refused 403**, no row created |
| `POST` with `status:"overturned"` | cannot resolve — filed as `open` only |

**No defect found — the design is sound:** POST can only *file* (ownership-checked);
resolution is PUT-only and admin-gated.

**Positive finding worth keeping:** `publishOverturn` is **fail-closed** — after
republishing the vindicated content it re-reads the row and throws
`"overturned post not readable after insert"` if the write did not land, rather than
reporting a successful overturn. That is exactly the discipline BUG-016 lacked.

**G3 SUITE (iteration 6):** `typecheck=0` · `eslint=0` · `test:api=0 (1374 tests)` ·
`npm test=0 (1426 tests)` · `build=0`
**G4 BOUNDARY:** api 1364→**1374** (+7 appeals authz). Nothing deleted, skipped, weakened.

---

## FIXED — iteration 8 · AREA 5 (the user's own report)

### BUG-017 — Bulk-resolved reports were written as "solved" and never resolved
**CATEGORY:** DATA / UI / WORKFLOW · **SEVERITY:** HIGH
**AREA:** 5-reports-approval-wording
**WHERE:** `api/_bulk-operations.js` — `ACTIONS.reports.resolve` and `ACTIONS.reports.status`

**This is the user's own report, reproduced and root-caused:**
> *"Where the admin reject the approval … showing it is the problem is solved Why?"*

**REPRO:** `POST /api/bulk-operations` with
`{resource:"reports", ids:[…], action:"resolve", params:{reason:"…"}}` → the `reports`
row is written with `status: "solved"`.

**EXPECTED:** `status: "resolved"` — the only value the platform reads for a resolved
report.

**ACTUAL:** `status: "solved"` was written — a **post** status in the **reports** table.
`reports.status` is a free-text column, so nothing rejected it. Consequences:
1. The report never reached the Resolved section. `Reports.tsx` splits on
   `status === "resolved"`, so a bulk-resolved report stayed in `openReports` — the admin
   resolves in bulk and **the reports appear to come back**.
2. Any status→label map renders `"solved"` as **"Solved"** (green) — precisely the
   "why does this say Solved?" confusion.
3. `reports.status` validated the **post** vocabulary
   `["reported","in_progress","solved","archived"]`, so an admin could write statuses that
   do not exist for a report (`in_progress`, `reported`).

**ROOT CAUSE — vocabulary confusion across two resources.** The reports action block was
written with the posts status set. The single-report path got it right all along
(`api/_reports.js:533` writes `"resolved"`; `:544` checks `=== "resolved"`), so the
platform had **two different answers** to "what does resolved mean" and only the bulk
path was wrong.

**FIX:**
1. `reports.resolve` now writes `status: "resolved"`.
2. A named `REPORT_STATUSES = ["open","pending","resolved","archived"]` constant now
   gates `reports.status`, so a post-only status is **refused (400)** rather than written.
3. A comment records why the two vocabularies must not be merged.

**G1 RED:** `tests/api/bulk-operations-reports.test.ts` → **5 failed**, including
`expected 'solved' to be 'resolved'` and
`expected ['reported','in_progress','solved'] to not include 'solved'`.
**G2 GREEN:** **5 passed (5)**.

**Sibling sweep (same file, same class):** `users_meta.status` correctly uses
`suspended`/`active`; `comments.resolve` correctly uses `deleted: true`. The reports block
was the only vocabulary leak.

**G3 SUITE (iteration 8):** `typecheck=0` · `eslint=0` · `test:api=0 (1405 tests)` ·
`npm test=0 (1432 tests)` · `build=0`
**G4 BOUNDARY:** api 1400→**1405** (+5). Nothing deleted, skipped, or weakened.

---


### V-003 — All 7 previously-untested admin gates proven at runtime
`tests/api/admin-gates-runtime.test.ts` (**22 tests**) executes each REAL handler with a
non-admin caller, then with an admin, so a gate that is merely *always-deny* cannot pass:

| Handler | Admin path exercised | Non-admin | No token | Admin allowed |
|---|---|---|---|---|
| `_chat.js` | `GET ?threads=1` all-threads view | 403 | 403 | yes |
| `_incidents.js` | `POST {action:"create"}` | 403 | 403 | yes |
| `_duplicates.js` | `GET` duplicate scan | 403 | 403 | yes |
| `_event-agents.js` | `POST {action:"trigger"}` | 403 | 403 | yes |
| `_routing.js` | `GET ?action=stats` | 403 | 403 | yes |
| `_performance.js` | `GET` | 403 | 403 | yes |
| `_meta-agent.js` | `GET` | 403 | 403 | yes |

**No defect found in any of the seven.**

### V-004 — Chat impersonation: a user CANNOT post as admin
`_chat.js` accepts `sender` from the request body, so this was the highest-risk shape in
the set. Verified safe: the insert writes
`sender: fromAdmin ? "admin" : "user"` — the sender is **derived server-side** from
`b.sender === "admin" && await isAdmin(req)`, never taken from the caller's claim.
A regression test sends `sender:"admin"` with a body of *"I am the administrator, lift my
ban"* from a non-admin and asserts the stored row is `sender: "user"`.

The same handler also checks its insert's `error` (`if (error) throw error`), so it does
not share the BUG-011 class either.

### AREA 4 SUMMARY
| Metric | Value |
|---|---|
| Admin-gated handlers audited (static branch-ordering) | **74** |
| Branch-ordering flaws remaining | **0** |
| Runtime authorization tests added this area | **46** (providers 12, appeals 7, gates 22, revoke 5) |
| Defects found & fixed | **1 CRITICAL** (BUG-016) |

**G3 SUITE (iteration 7):** `typecheck=0` · `eslint=0` · `test:api=0 (1400 tests)` ·
`npm test=0 (1426 tests)` · `build=0`
**G4 BOUNDARY:** api 1374→**1400** (+22). Nothing deleted, skipped, or weakened.
Two lint errors introduced by my own test (unused params) were **fixed**, not suppressed —
`eslint` re-run to 0 with no `eslint-disable` added anywhere.

---

## FIXED — iteration 9 · AREA 5 continued (sibling of BUG-017, same file)

### BUG-018 — Bulk "suspend" silently LIFTED existing suspensions; unknown status was a no-op
**CATEGORY:** AUTHORIZATION / DATA / STATE · **SEVERITY:** HIGH
**AREA:** 5-reports-approval-wording
**WHERE:** `api/_bulk-operations.js` — `ACTIONS.users.status`

**REPRO:** `POST /api/bulk-operations`
`{resource:"users", ids:["anon_1"], action:"status", params:{status:"suspended"}}`
(no `until`) → before the fix: **200**, with the row written `suspended_until: null`.

**EXPECTED:** Either a dated suspension, or a loud 400. Never a silent un-suspension.

**ACTUAL — two distinct silent failures, both reported as success:**
1. **`suspended` with no `until`** wrote `suspended_until = null`. `checkUser`
   (`api/_auth.js:112`) only blocks when `suspended_until > now`, so `null` means **not
   suspended**. A bulk "suspend" therefore **actively lifted suspensions already in
   force** while reporting the users as processed — a moderation bypass, not cosmetics.
2. **Any unknown status** (`"banned"`, a typo) passed `validate: (p) => !!p.status`, fell
   through both branches, and issued an **empty-patch** `.update({})` — a no-op write
   reported as `processed`.

**ROOT CAUSE:** The action modelled "status" as free text over a table with no status
column — only `suspended_until`. No closed vocabulary and no well-formedness check meant
anything not explicitly handled became a silent no-op. Same family as BUG-017: an
unvalidated vocabulary standing in for a contract.

**FIX:**
- `validate` accepts exactly two states: `active`, or `suspended` **with a parsable `until`
  strictly in the future**.
- `execute` builds a real patch from those two cases — no empty-patch path remains.
- Missing/past date and unknown status are both refused with **400**.

**G1 RED:** 3 of 5 new assertions failed with `expected 200 to be 400` (unknown status;
no-date suspension; past-date suspension). The two legitimate paths (dated suspend,
`active`) were already green, proving the harness was sound.
**G2 GREEN:** **10 passed (10)**.

**G3 SUITE (iteration 9):** `typecheck=0` · `eslint=0` · `test:api=0 (1410 tests)` ·
`npm test=0 (86 files / 1413 tests)` · `build=0`

---

## FIXED — iteration 10 · user-reported "it only refreshes once"

### BUG-019 — Live updates were starved to death during normal activity
**CATEGORY:** REALTIME / STATE · **SEVERITY:** HIGH
**AREA:** 7-realtime-cache-coherence (revisited — the earlier fix here reduced
*frequency*; this bug is the opposite failure: updates *stop*)

**User report:** *"like olsve it only referesh once"*

**REPRO (deterministic, in the test):** mount `useRealtime(["posts"], cb, 2500)` with the
channel SUBSCRIBED, then deliver 150 `postgres_changes` events, one every 100 ms — 15
seconds of continuous activity, each event well inside the 2.5 s debounce window.
Before the fix: **`onChange` was called 0 times.**

**EXPECTED:** A busy feed still refreshes. Coalescing may reduce the number of refreshes;
it must never reach zero.

**ACTUAL:** `useRealtime`'s debounce was a **pure reset-on-every-event timer**:

```ts
if (sub.timer) clearTimeout(sub.timer);
sub.timer = setTimeout(() => sub.callback(table, payload), sub.debounceMs);
```

On a platform where posts arrive faster than the debounce window, the timer is reset
*before it ever fires*, forever. The callback is starved. An admin sees the list update
once — during a quiet gap — and then it silently stops, which is exactly the reported
"it only refreshes once."

**ROOT CAUSE:** A debounce is the wrong primitive for a continuous event stream. It
answers "did the user stop clicking?" — on a live feed the answer is always no, so the
timer never fires. The correct primitive is a debounce **with a max-wait guarantee**.

**FIX:** Kept the debounce (a short burst must still coalesce into one refresh) and added
a ceiling:
- `Subscriber.burstStartedAt` records when the current burst began.
- If a pending burst has already waited `MAX_BURST_WAIT_MS` (10 s), the subscriber is
  flushed **immediately** instead of having its timer reset again.
- Otherwise the normal reset-and-debounce continues.
- `burstStartedAt` is cleared on fire and on unsubscribe, so no stale anchor leaks.

Net effect: bursts still coalesce (the 5-events-in-500 ms test asserts **exactly one**
delivery), but sustained activity now guarantees a refresh at least every 10 s.

**G1 RED:** `expected 0 to be greater than 0` — the starvation reproduced exactly.
**G2 GREEN:** `useRealtime` **16 passed (16)**, including the pre-existing
"coalesces duplicate realtime events" and "delivers debounced events to EVERY subscriber"
contracts, so the fix did not weaken coalescing or multi-subscriber delivery.

**G3 at time of writing:** `test:api=0 (1412 tests)` · `useRealtime=16/16` · frontend
suite `0 (1417 tests)` when last run · `eslint=0`.
**Typecheck is currently RED on one pre-existing error that is NOT this loop's:**
`src/__tests__/Submit.test.tsx:344` — `Conversion of type 'null' to type
'Record<string, unknown>' may be a mistake`. That file is being edited by the concurrent
session; this loop did not touch it and deliberately did not "fix" it to avoid a write
collision. It is the **only** typecheck error in the tree.

**SIBLING NOTE:** this also explains a behaviour that looked like a feature — the
staleness fallback only starts polling after **2 minutes** of silence, so a starved
debounce took up to ~2.5 minutes to be rescued. The max-wait fixes the root cause rather
than waiting for that safety net.

---

## FIXED — iteration 11 · multi-class defect sweep (290 files, 13 heuristics)

Ran `D:\Temp\opencode\qa\class-sweep.mjs` over every non-test source file, checking 13
bug classes at once. **29 raw hits → 4 real defects, 5 false-positive classes.**

### BUG-020 — The platform-wide announcement banner published nothing, silently
**CATEGORY:** DATA / WORKFLOW · **SEVERITY:** HIGH
**WHERE:** `api/_announcement.js` (clear + set paths)

The `settings` delete / update / insert were awaited with **no `error` check**, then the
handler answered `200 { ok: true, value }` echoing the admin's own text.

Impact — this is the banner **every user sees**, i.e. the surface for an urgent notice
("lift out of service", "campus closed", "security incident"):
1. The admin saw their notice published.
2. Every user still saw the **previous** announcement.
3. The audit log recorded `set_announcement` for a write that never landed.
4. `clear` had the same defect — the admin cleared an emergency notice that stayed live.

So the case where the banner matters most was the case that failed quietly.

**G1 RED:** 4 failed — `promise resolved 200 instead of rejecting` (update, insert,
delete/clear) + the no-audit assertion. **G2 GREEN:** **7 passed (7)**.

### BUG-021 — AI suggestion approval recorded nothing while the action was already applied
**CATEGORY:** DATA / STATE · **SEVERITY:** HIGH
**WHERE:** `api/_agent.js` — `PUT`, `action: "approve"`

The sibling of BUG-013 (which I fixed for `dismiss`), and **more dangerous**. The approve
path applies the real moderation action FIRST — and that write *is* checked — then records
the suggestion as approved. That final update was unchecked:

- A failure left the suggestion **PENDING** while the moderation action was **already live**.
- The admin was told it was approved; the list still offered it.
- Re-approving could **duplicate the moderation action**.

**G1 RED:** 2 failed (`resolved 200 instead of rejecting`, + no-audit). **G2 GREEN:** **7 passed (7)**.

### BUG-022 — Chat mark-read and thread-close reported success on failed writes
**CATEGORY:** STATE / UI · **SEVERITY:** MEDIUM
**WHERE:** `api/_chat.js` — `PUT` `mark_read` and `set_status`

Both awaited their update unchecked then returned `ok:true`. A failed mark-left-read left
messages unread while the inbox looked handled; a failed close left a "closed" thread open
in the queue. Fixed with explicit `error` checks.

**G1 RED → G2 GREEN:** folded into `admin-gates-runtime.test.ts` → **25 passed (25)**,
including a new assertion that a **non-admin is still refused before any write** (the
admin gate is intact, not weakened).

### False positives — investigated and cleared (not "fixed")
| Class | Hits | Verdict |
|---|---|---|
| XSS via `dangerouslySetInnerHTML` | 3 | **SAFE** — 2 were doc comments; the 1 real site (`UnifiedInbox`) uses `renderMarkdown`, which escapes HTML first and allowlists link schemes, explicitly defeating the `java\u0009script:` control-char bypass |
| Mass assignment (`.update({...patch})`) | 1 | **SAFE** — `patch` is a hardcoded server literal (`{ pinned: true }`), never caller input |
| Numeric without guard | 2 | **SAFE** — `Number(x) \|\| 0` is a correct NaN guard |
| Async handler without catch | 10 | **SAFE** — the heuristic only sees the opening `onClick={async () => {` line; the handlers have internal try/catch |
| Prototype pollution (`state[b.id]`) | 3 | **REAL but LOW** — `_agent-team.js` activate/deactivate accepts an unvalidated `b.id`. Admin-only, so it is data-integrity (phantom/corrupt activation entries), **not** privilege escalation. Left unchanged deliberately and logged rather than bundled into this iteration |

**G3 SUITE (iteration 11):** `typecheck=0` · `eslint=0` · `test:api=0 (1425 tests)` ·
`npm test=0 (1419 tests)` · `build=0 (14.4s)`
**G4 BOUNDARY:** api 1412→**1425** (+13: 7 announcement, 3 approve, 3 chat). Nothing
deleted, skipped, or weakened.

**Build note:** an earlier build in this iteration failed with 4 × TS2554 in
`src/lib/api.ts` — the concurrent session refactoring that file live. It cleared on
re-run; `src/lib/api.ts` is not a file this loop touched.

---

## ⚠ CONCURRENT-WRITER EVENT — features and tests removed by another session

During iteration 9 the frontend suite first went **red** with 4 ×
`Cannot find module '.../AdminAIFailures.test.tsx'`. The files were not failing — they
were being **deleted mid-run**.

`git status` at that moment:
```
 D src/__tests__/AdminAIQuality.test.tsx
 D src/hooks/useDashboardLayout.ts
 D src/pages/admin/AIQuality.tsx
 D src/pages/admin/DashboardBuilder.tsx
```
plus three untracked test files removed outright — `AdminAIFailures`,
`AdminModelPerformance`, `AdminSafetyIntel` (their pages too).

**Assessment:** a coherent, deliberate feature removal. The AI admin surfaces (AI Quality,
AI Failures, Model Performance, Safety Intel) and their tests went together, matching the
standing request to *"remove the ai agents … add AI features, but not ai agents"*. The
suite re-run immediately after is **green (86 files / 1413 tests)** and the build passes,
so the tree is internally consistent.

**These files were therefore NOT restored** — undoing another session's intentional work
would cause exactly the collision this warning exists to prevent.

**G4 anchor note:** the frontend count moved 1432 → **1413** (−19) from those deletions.
That is the other session's change, not a regression from this loop, and it is why count
attribution is only trustworthy for the API half while two writers share the tree.

**Worth a human check:** `src/hooks/useDashboardLayout.ts` and
`src/pages/admin/DashboardBuilder.tsx` are tracked deletions that do **not** obviously
belong to an AI-feature removal. If unintentional, recover with
`git checkout -- <path>`.

---

without this loop authoring those tests, and `PostsTable.test.tsx` / `index.css` changed
mid-read. Another agent or session is writing to this repo.

**Consequence for the loop:** the G4 reconciliation anchor (test counts) is only valid
against a quiescent tree. Until the concurrent writer stops, a count change cannot be
attributed, and edits may collide.

**Human action required:** stop the other session (or confirm it is intentional) before
the loop continues, otherwise iteration evidence is not trustworthy.

---


| ID | Title | Area | Tests |
|----|-------|------|-------|
| BUG-009 | Admin post hard-delete returned `ok:true` on 0 rows / silent errors | `_posts.js` | posts-full 42 |
| BUG-010 | Poll delete wiped votes before proving the poll row; vote-wipe error discarded | `_polls.js` | polls-full 44 |
| BUG-006 | Page-boundary backfill prepended to top after a delete ("comes from anywhere") | `PostsTable.tsx` | PostsTable 37 |
| BUG-007 | Realtime refresh refetched unfiltered page → rows + `N total` jumped | `PostsTable.tsx` | PostsTable 37 |
| BUG-008 | Filter change blanked the table to skeletons (every search debounce pause) | `useInfiniteScroll` | hook 19 |
| BUG-005 | Platform-wide left→right shimmer sweeps read as constant reloading | `index.css` | motion-policy 4 |

---

## Native shells — desktop (Electron) + mobile (Capacitor), 2026-09-29

One codebase, three shells. `src/lib/platform.ts` detects web/desktop/mobile
(Capacitor native flag, `window.vbDesktop` preload bridge); `api.ts` prefixes
a baked-in `VITE_API_BASE` origin in native shells (same-origin on web);
`App.tsx` uses HashRouter in native shells (no server rewrites over file://),
BrowserRouter on web. localStorage stays the ONLY user-data store — it is
already device-local inside the Electron profile and the Capacitor WebView,
so identity/activity/drafts/bookmarks record on-device with zero migration.
Privacy page copy is platform-aware (`storageWhere()`). New: `electron/`
(locked-down main + preload bridge), `electron-builder.yml` (per-user NSIS),
`capacitor.config.ts` (no external type import — typechecks pre-install),
`scripts/make-icons.mjs` (sharp; CI-installed), `docs/NATIVE.md`,
`.github/workflows/native.yml` (CI builds .exe + debug .apk; local builds
impossible on 0-byte C:). `VITE_API_BASE` documented in `.env.template`.
Verified: platform 12/12, Privacy + storage-contract suites green, eslint
clean on all touched files, `tsc --noEmit` clean. Binaries NOT produced
locally — first .exe/.apk come from the Native workflow after push.

---

## FIXED — iteration 12 · the reported defects: dead API, keyword-first AI, slow feed

User report driving this iteration: "inbox + admin dashboard full of bugs",
"high stress never shows in the dashboard", "many errors", "mobile too many gaps",
"user page loads the top first, posts arrive ~5s later".

Baseline re-measured at the start of the run (tests are the counters):
api **1748/159 files** green, frontend green. Both suites ended this iteration
at api **1786/162** and frontend **1623/109**.


### BUG-025 — CRITICAL: the ENTIRE `/api/*` surface returned 500
**CATEGORY:** BUILD / MODULE-CONTRACT · **SEVERITY:** CRITICAL (every route dead)
**WHERE:** `api/index.js` ↔ `api/_moderation.js`

**ROOT CAUSE:** `api/index.js` imported `getSpamConfig` (and the
`record/check/clearSafetyRepost` family) from `api/_moderation.js`, which did not
export them. Vite's SSR runner resolves a missing named export to `undefined`
instead of raising a link error, so the import *succeeded* and every handler
threw on first use — 500 on `/api/posts`, `/api/categories`, `/api/leaderboard`,
everything. `npm run typecheck` can never catch this: `api/` is plain JS outside
the tsconfig program, so `tsc -b` exits 0 against a completely dead API.
A second consequence: the admin spam-sensitivity controls wrote a `settings` row
that **nothing read**, because the only consumer (`getSpamConfig`) was the
missing export.

**FIX:** implemented `DEFAULT_SPAM_CONFIG`, `normalizeSpamConfig` (integer 0–100
else default; the flag→review→quarantine ladder forced strictly ascending with
+5 gaps), `getSpamConfig(supabase)` (fails safe to defaults) and
`spamAnalyze(..., spamConfig)` deriving its `action` from configured thresholds;
rewired the post submission gate to `spamResult.action` instead of hardcoded
`>= 80` / `>= 60`; added the safety-repost family.

**G1 RED:** 6 failures in `tests/api/admin-settings.test.ts` —
`getSpamConfig is not a function`.
**G2 GREEN:** 22/22 admin-settings. Live server: `/api/posts` **200**, 44 566 B,
1.60 s cold / **0.62 s warm**; `/api/categories` 200 @ 0.42 s; `/api/leaderboard`
200. Admin spam sensitivity now actually changes the gate's behavior.

**G4 BOUNDARY (added later this iteration):** a runtime link-check imported
every `api/*.js` module directly under node and reported **162/162 linked,
0 failed** — so the whole module graph is clean, not just the one import pair
that broke. This check is stronger than the static parser (real ESM link step),
but it executes import side effects, so the committed guard stays the static
`tests/api/module-contract.test.ts`.


### BUG-026 — CRITICAL: the classifier was keyword-FIRST — it missed suicide-baiting and explicit threats, and escalated homework
**CATEGORY:** AI / CONTENT-SAFETY · **SEVERITY:** CRITICAL (missed safety signal)
**WHERE:** `api/_inbox.js` `classifyEmotion` → new `api/_context-classify.js`

**ROOT CAUSE:** a lexicon hit returned a severity and nothing else ever ran, so
the only context considered was "does this word appear". Anything the lexicon
missed was delegated to an LLM — which means on a provider outage, a rate limit,
or a deployment without the key, the fallback was the `none` default. The lexicon
also listed `"hate this"` under `distress`, so ordinary coursework venting scored
HIGH while actual directed abuse scored NONE. Inverted in both directions.

**G1 RED (executed against the pre-change code, providers stubbed — i.e. exactly
the "no model reachable" condition):**

| input | old | new (deterministic) |
|---|---|---|
| `Rahul, I hate you.` | **none** | high · targeted-harassment · target=name:Rahul |
| `Rahul I hate you, I will hurt you.` | **none** | high · threat |
| `bro go kys` | **none** | high · threat |
| `I hate this homework.` | **high** | mild · anger (no person target) |

`kys` — suicide baiting — was classified as harmless with no model reachable.
That is the single worst defect found this session.

**FIX:** new `api/_context-classify.js`. Lexicon hits become EVIDENCE, not
verdicts. Layered: normalize (zero-width chars, smart quotes, digit de-leet) →
signals (target via vocative / mid-sentence capital / third-person pronoun /
second person; asserted vs quoted-or-reported; script) → bounded deterministic
severity → optional model refinement **inside** those bounds → allowlisted
output. Two rules stay deterministic on purpose: the **crisis floor** (self-harm
language can never be reasoned down) and the **output allowlist** (a garbage or
prompt-injected reply can only produce a value from the fixed enum). When the
deterministic pass is already decisive no model is called at all — no network
on the hot path for the obvious cases.

**GOLDEN DATASET:** `tests/api/context-classify.test.ts` — 18 cases, all running
`useModel:false`, so every contextual guarantee holds with no model reachable.
Pins: asserted vs reported (`I hate you.` high ↔ `Rahul said 'I hate you'
yesterday.` mild + `reported_or_quoted:true`), quoted vs asserted threat
(`go die.` high ↔ `people say 'go die' online` reported), names as targets,
AUTHORITY: the model may refine but never drop below the deterministic floor;
only enum values can ever be emitted.

**G2 GREEN:** 18/18 new + 13/13 `inbox-classify` + 11/11 `prompt-injection-evals`.

**G3 SUITE:** api 162 files / **1786** tests green; frontend 109 files / **1623**
green; `tsc -b --force` exit 0.

**G4 BOUNDARY:** the two pre-existing suites (`inbox-classify`,
`prompt-injection-evals`) were kept passing UNCHANGED — the containment contract
(a valid model classification is honoured, critical forces the emotional agent,
garbage collapses to defaults) is preserved rather than loosened to fit the
rewrite. `level` is accepted as an alias for `severity` so a model echoing the
older field name cannot cause a false "deterministic only" result.

**NOT CHANGED (explicit product decision still open):** `I hate you 😂` scores
high. A laughing emoji may signal a joke; lowering direct second-person
hostility on an emoji is a policy call for the school, not a classifier default.
The model lane is free to revise it when enabled.


### BUG-027 — A second, incompatible emotion vocabulary with substring matching
**CATEGORY:** AI / DUPLICATED-LOGIC · **SEVERITY:** MEDIUM
**WHERE:** `api/_conversation-assist.js`

**ROOT CAUSE:** this endpoint carried its own `EMOTIONAL_KEYWORDS` and its own
`lower.includes(kw)` matching, so it reproduced two inbox defects independently:
substring false positives (`"alone"` matched **"along"** — agree with a plan →
classified sad) and a second vocabulary (`distressed`/`angry`/`anxious`/`sad`)
that no consumer understood. Only `distressed` escalated, so a threat here was
labelled LOW and dropped from the admin notification stream.

**FIX:** route through the shared `makeEmotionLexicon` (one implementation of the
word-boundary rule, so the boundary cannot be dropped by hand again) +
`analyzeContext`. `getEmotionMeta` now keys on the canonical severity, and both
`high` and `critical` escalate.

**G1 RED → G2 GREEN:** `tests/api/conversation-assist-classify.test.ts` (4 tests) —
`along` → none/neutral; `alone` → sad; `bro go kys` → high (its own lexicon has
no threat word at all, which proves the contextual engine — not just the local
list — is running); only canonical severities emitted.


### BUG-028 — The feed could not paint on a reload; the snapshot lived only in memory
**CATEGORY:** PERFORMANCE / UX · **SEVERITY:** MEDIUM (the reported "posts arrive ~5s later")
**WHERE:** `src/pages/Home.tsx`

**ROOT CAUSE:** measuring first ruled out an in-app waterfall — identity is
synchronous, posts + reactions are `Promise.all`'d, and polls follow. The visible
gap was the cold `/api/posts` round-trip (1.60 s locally, worse on a Vercel cold
start and on mobile) with nothing to show meanwhile. `homeSnapshot` already
existed and was already painted instantly on an in-app revisit, but it was
module memory only: a real reload threw it away, so a cold entry had nothing to
paint and waited on the network for the first row.

**FIX:** persist the snapshot to **sessionStorage** (not localStorage — it dies
with the tab, so a shared school machine never shows the previous student's feed
and nothing outlives the anonymous session). Written through on every
default-view load; on read every field is re-validated (`v` tag, array shapes,
numeric `at`) because sessionStorage is origin-writable and can hold a truncated
write — a bad shape would otherwise paint a broken feed or throw during render.
Expired snapshots (`> 60 s`) are ignored, and only the default view is ever
stored, never a search or filter result.

**G1 RED (probed by disabling hydration):** exactly **2** tests fail — the cold
paint and the reconciliation below — and all others stay green, proving the new
tests bind to the new behavior rather than passing incidentally.
**G2 GREEN:** `src/__tests__/Home.test.tsx` 23/23, `Home.realtime.test.tsx` 7/7.


### BUG-029 — A restored snapshot would have kept deleted posts on screen for the whole session
**CATEGORY:** STATE / REALTIME · **SEVERITY:** HIGH (the "it still shows the deleted post" class)
**WHERE:** `src/pages/Home.tsx` (revalidation branch)

Found while implementing BUG-028 — the persisted snapshot would have made an
existing latent hazard reachable.

**ROOT CAUSE:** the quiet-merge revalidation only ever ADDS and UPDATES rows; it
never removes. That is correct for an in-session snapshot (never delete a row the
user is mid-scroll on) but wrong for one restored after a reload: a post deleted
while the tab was closed would sit in the feed for the rest of the session.

**FIX:** a snapshot restored from storage reconciles with a **full replace**; an
in-session snapshot keeps the quiet merge it always used. The list is already
painted, so this still shows no skeleton and no empty flash.

**G2 GREEN:** `drops a row the server no longer has instead of merging it back` —
holds the response open, asserts the stale row IS painted from storage, then
asserts it is gone after the replace while the still-present row survives.


### CONCURRENT-WRITER NOTE — this repo was edited by another session DURING this work
Mid-iteration another session was committing to the same files. Observed live:
`api/_context-moderation.js` appeared after an `ls` that did not list it;
`tests/api/context-moderation-wiring.test.ts` went 8 failing → 16/16 passing
between two of my runs; `tests/api/comments-full.test.ts` went 6 failing → 27/27
the same way. I did not write any of those three files.

Notably that session's contextual **moderation** layer imports
`classifyContextual` from the `api/_context-classify.js` **I** created, and its
test's mocked decision shape matches that module's real output field-for-field
(`severity`, `target {kind,value}`, `recommended_action`, `policy_version`,
`reported_or_quoted`, `language`). Two independent sessions converged on the same
interface. I left that session's files untouched to avoid clobbering in-flight
work — with one deliberate exception, below.

Everything above was re-verified against the tree as it stood at the end of the
run: api **1786/162** green, frontend **1623/109** green. Because the writer is
still active, treat those counts as a snapshot, not a standing guarantee.

**Left in place, flagged not fixed (not mine, and not safe to edit mid-flight):**
`api/_safety-pipeline.js` `evaluateContentAsync` still contains two leftover
debug lines — `console.error("[DEBUG] ctxMod ->", ...)` and
`console.error("[DEBUG] ctxMod THREW:", ...)`. The first serialises contextual
flag types for every evaluated write into server logs; that is both log noise on
a hot path and a content-adjacent privacy smell. Remove both before release.
Also in `api/_context-moderation.js`, the mild/moderate branch ends
`return flag === "threat" ? ["threat_report"] : ["threat_report"]` — both arms
are identical, so the ternary is dead. It currently behaves as intended
(review-grade → `threat_report`), but it reads as unfinished. **Resolved in this
pass** — collapsed to a single `return ["threat_report"];` (behaviour unchanged,
intent now readable). The earlier "Left in place" debug-line note is also moot:
no `[DEBUG]` lines remain in `api/_safety-pipeline.js`.


### BUG-030 — A poll author whose wording tripped the gate saw only a dead Publish button
**CATEGORY:** UI/UX · **SEVERITY:** HIGH (a block with no explanation — the user's "many UI/UX errors" report)
**WHERE:** `src/pages/Submit.tsx` (poll branch vs. non-poll branch of the type ternary)

**ROOT CAUSE:** the live moderation feedback panel, the "Checking content…"
spinner, and the "No issues found so far" panel all rendered *inside the
non-poll branch*. `liveText` — the text the verdict describes — already included
the poll question and every option, so the verdict existed and was correct for
polls; it simply had nowhere to render. A poll author got a disabled "Fix issues
first" button with nothing on screen saying why.

**FIX:** extracted the feedback into one `renderLiveModerationFeedback()` helper
and called it from BOTH branches. The "no issues" trigger also now counts
`liveText.trim().length > 10`, so poll text qualifies. One definition, so the two
branches can never drift apart.

**RED:** the new test `explains a poll block on the poll tab instead of only
disabling Publish` failed with `Unable to find an element with the text:
/content blocked/i` before the helper was shared.
**GREEN:** `src/__tests__/Submit.test.tsx` **26/26**.


### BUG-031 — Any sentence with a reporting verb was treated as a report of abuse
**CATEGORY:** AI / OVER-BLOCKING · **SEVERITY:** CRITICAL
**WHERE:** `api/_context-classify.js` `extractSignals().reported`

**ROOT CAUSE:** `reported` was `REPORTING_RE.test(text) || quotedHostility`. A bare
`said`/`says`/`told`/`wrote`/… anywhere in the message set `reported = true` with
no hostile content required. `contextualFlags()` returns `["threat_report"]` the
moment `reported` is true, and POLICY routes `threat_report` to QUARANTINE on posts
and BLOCK on comments. So "the notice says the lab closes at 4" was held or
blocked, and a privacy-only finding that merely contained "says" was mislabelled
as a threat (the very thing `contextualFlags`' own comment warns against).

**FIX:** a report of abuse requires something hostile to report —
`(reporting && (threatHits.length > 0 || hostilityHits.length > 0)) || quotedHostility`.
Genuine reported-abuse semantics are unchanged; a neutral sentence with a
reporting verb no longer fires.

**RED (captured):** with the old expression restored, exactly the two new
`moderation-preview` cases failed (2 failed / 18 passed) —
`"the notice says the lab closes at 4"` and
`"the teacher told us the exam moved to friday"`.
**GREEN:** `tests/api/moderation-preview.test.ts` 20/20, `context-classify.test.ts`
18/18.


### BUG-032 — A model that ran and found nothing was reported as a provider outage
**CATEGORY:** AI / TELEMETRY · **SEVERITY:** MEDIUM
**WHERE:** `api/_safety-pipeline.js` `evaluateContentDeep`

**ROOT CAUSE:** when the deep layer produced **no flags**, the branch hardcoded
`model_used: false`. But "no flags" is a valid judgment (the model ran, its JSON
parsed, severity `none`) and `contextualModerationDeep` already distinguishes it
from a timeout/outage via its own `model_used`. Collapsing a real, paid judgment
into "the model never ran" is dishonest telemetry and mis-scores any routing or
trust logic that keys off `model_used`.

**FIX:** propagate `model_used: deep?.model_used === true`. Timeout / outage /
unparsable output still report `false` (those tests are unchanged).
**GREEN:** `tests/api/deep-moderation.test.ts` **7/7**.


### BUG-033 — `sanitizeError` called with the wrong signature threw inside the handler that caught the error
**CATEGORY:** ERROR HANDLING · **SEVERITY:** HIGH (a handled 500 became an unhandled crash)
**WHERE:** `api/_moderate.js`, `api/_communities.js`, `api/_transcribe.js`, `api/_workforce.js`

**ROOT CAUSE:** `sanitizeError`'s real signature is `(res, err, context)` — it
**sends the response itself**. Four call sites used `sanitizeError(err)` or wrapped
it in their own `res.status(500).json({ … })`. With an `Error` passed as `res`,
`res.status` is undefined, so the call threw *from inside the error handler*:
a caught failure escaped as an unhandled rejection (observed as
`TypeError: res.status is not a function` at `api/_error.js:88`). `api/_moderate.js`
also returned the raw `err.message` in its 200 envelope — an information leak,
the exact thing `api/_error.js` exists to prevent.

**FIX:** the standard `return sanitizeError(res, err, "<surface>")` everywhere.
`api/_moderate.js` is a 200 envelope that must not send its own response, so it
now returns a static `error: "Moderation check failed"` and no longer imports
`sanitizeError`.

**NOTE:** two tests had *encoded the broken call* by mocking `sanitizeError` as a
1-arg `(err) => err.message` helper that production never calls; both were
updated to the real signature and the real, non-leaking contract
(`workforce-quality.test.ts`, `workforce-ops-health.test.ts`).

**GREEN:** api suite **1829 passed / 165 files, 0 failures**; the
`res.status is not a function` unhandled rejection is gone.
