# VOICE BOX — Autonomous QA + Repair Loop

**Status:** ACTIVE · **Mode:** safe · **Pattern:** sequential servo
**Repo:** `C:\Users\lenovo\freeclaw\freeclaw\freeclaw\voice-box` (branch `initial-review-branch`)
**Created:** 2026-09-24

---

## 0. Why this is a loop, and why it is bounded

The 4-condition gate (miss any one → don't build):

| # | Condition | Voice Box |
|---|-----------|-----------|
| 1 | Task repeats | Yes — the surface is 25 routes / 21 admin tabs / 165 API endpoints; more bugs remain than one session can hold |
| 2 | Verification automatable | Yes — deterministic suites: typecheck, eslint, 1311 API tests, 1397 frontend tests, build |
| 3 | Budget supports it | **Only with a cap** → hard cap of 12 iterations, 3 retries/area |
| 4 | Tools run and observe | Yes — shell + test runners read real output |

The mission as written ("make the platform work", "don't stop until") is a **vague goal**
and cannot be the loop's exit condition — an LLM will burn the whole budget "managing
well" and never terminate. The decidable goal is below. **Human judgment stays human:**
this loop never commits, pushes, deploys, or deletes a test.

---

## 1. The machine-decidable goal

**Unit of work = one AREA** (a route, admin tab, or API cluster from the inventory).

An area is **CLOSED** only when all four gates pass:

| Gate | Requirement | How it is judged |
|------|-------------|------------------|
| **G1 REPRO** | A test exists that **FAILS** on the unfixed code | RED output pasted into the bug record |
| **G2 GREEN** | That same test **PASSES** after the fix | GREEN output pasted into the bug record |
| **G3 SUITE** | `typecheck && eslint && test:api && npm test && build` all exit 0 | Exit codes, machine-read |
| **G4 BOUNDARY** | No test deleted or weakened; no new skip; no new `@ts-ignore`/`eslint-disable`; frontend `it()` count ≥ 1397; API `it()` count ≥ 1311 | Diff + counts, machine-read |

**LOOP DONE** when: every area in `docs/QA/INVENTORY.md` is `CLOSED`, or is
`DEFERRED` with a human-written reason. **Never** when tests merely pass.

### Reconciliation anchor (anti-Goodhart)

G3 alone is gameable: an agent can delete the failing test and go green. So the
**external fact** is the test inventory, not the agent's assertion that it is done:

```
frontend it() count  >= 1397   (golden, 2026-09-24)
api      it() count  >= 1311   (golden, 2026-09-24)
test files            >= 218   (85 frontend + 132 api + 1)
```

A drop in any count invalidates the iteration no matter how green the run is.

---

## 2. Boundaries — what the loop must NOT do

1. **Never** delete or weaken an existing test. No `it.skip`, `describe.skip`, `.only`.
2. **Never** add `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` to go green.
3. **Never** lower a threshold, loosen an assertion, or widen a mock to hide a failure.
4. **Never** `git commit` / `push` / `deploy` / `vercel`. The human flips that switch.
5. **Never** claim a bug is fixed without a G1+G2 pair in the ledger.
6. **Never** install Playwright / Selenium / Puppeteer, or add browser automation.
   (A `playwright.config.ts` already exists in the repo — it is **not** to be used
   or extended by this loop.)
7. **Never** invent bug counts, fake successes, or report a fix without evidence.
8. **Never** touch production secrets. The NVIDIA key pasted in chat must be rotated
   by the human before deploy.

---

## 3. Loop type + skeleton

**Type: servo (has a done-test) with a retry cap.**

Skeleton — **plan / build / judge**, three separated roles:

| Role | Who | Does |
|------|-----|------|
| **Plan** | loop | Read `LOOP-STATE.json` → pick next uncovered area from the inventory → write the hypothesis + intended RED test into the ledger |
| **Build** | loop | Write ONLY the failing test. Run it. Confirm RED. Then implement the minimal root-cause fix. Re-run. Confirm GREEN. |
| **Judge** | **deterministic commands, not opinion** | `npm run typecheck && npx eslint . && npm run test:api && npm test && npm run build` + the boundary counters |

The judge is never "looks right". Three failed attempts at the same fix → mark
`BLOCKED`, record the evidence, move to the next area. Never attempt fix #4
without questioning the architecture.

---

## 4. Damping (anti-runaway)

- Max **12 iterations** (token/rate guard).
- Max **3 fix attempts per area**, then `BLOCKED` + escalate.
- Any G3 failure **not caused by the current change** → stop the loop immediately
  and escalate (a pre-existing red is a human decision, not something to grind on).
- No "clarify at runtime" points: every ambiguity is resolved by the human now, or
  the item is deferred.

---

## 5. Areas (priority order)

Priority: BLOCKER → CRITICAL → SECURITY → DATA LOSS → AUTHORIZATION → CORE
WORKFLOW → HIGH-FREQ UX → PERF → A11Y → COSMETIC.

| # | Area | Surface | State |
|---|------|---------|-------|
| 1 | Silent-failure sweep across `api/` (catch{}, unchecked .then, unverified writes) | 165 endpoints | TODO |
| 2 | Admin feed — bulk delete, selection, scroll anchor | Feed tab | DONE (5 bugs) |
| 3 | Polls CRUD + vote integrity | `/api/polls`, Polls, PollManager | DONE (1 bug) |
| 4 | Authorization boundary — every admin API with anon/user/admin | `api/_auth`, tests | TODO |
| 5 | Reports/approval/reject wording + state machine | Reports tab | TODO |
| 6 | Form contracts — Submit, Settings, ProviderSettings | 81 inputs | TODO |
| 7 | Realtime + cache coherence | useRealtime, useInfiniteScroll | DONE (4 bugs) |
| 8 | Notification/appeal lifecycle | appeals, notifications | TODO |
| 9 | Search/filter/pagination correctness | Search, Saved, Insights | TODO |
| 10 | Input validation + injection surface | all API handlers | TODO |
| 11 | Accessibility contracts (labels, focus, keyboard) | all pages | TODO |
| 12 | Dead/mislabeled buttons + icon-action mismatches | 306 buttons | PARTIAL (1 smell FP) |

---

## 6. Bug ledger record format

Every confirmed bug appends to `docs/QA/BUG-LEDGER.md`:

```
### BUG-NNN — <title>
CATEGORY: FUNCTIONAL|UI|UX|STATE|DATA|API|DATABASE|AUTH|SECURITY|PERF|A11Y|REALTIME|CONCURRENCY
SEVERITY: BLOCKER|CRITICAL|HIGH|MEDIUM|LOW|COSMETIC
AREA: <area name>
WHERE: <file:line>
REPRO: <exact steps / failing command>
EXPECTED: <what should happen>
ACTUAL: <what happens instead>
ROOT CAUSE: <why — not the symptom>
FIX: <what changed>
G1 RED: <command + failing assertion>
G2 GREEN: <command + pass count>
G3 SUITE: <all five exit codes>
SIBLINGS SEARCHED: <the related-bug sweep that was run>
STATUS: OPEN|FIXED|BLOCKED
```

---

## 7. Commands

```powershell
cd C:\Users\lenovo\freeclaw\freeclaw\freeclaw\voice-box

# Judge (must be all-zero for G3)
npm run typecheck ; npx eslint . ; npm run test:api ; npm test ; npm run build

# Boundary counters
node D:\Temp\opencode\qa\inventory.mjs .
# frontend it() >= 1397, api it() >= 1311

# Loop state
Get-Content docs\QA\LOOP-STATE.json
```
