# Harness inventory — the ten decision engines (all verified, all tested)

Each harness is one import with a deterministic contract. Rules live in
exactly one place; callers never re-implement patterns. Calibration =
thresholds locked by the named tests, not ML weights.

| # | Harness | File | Contract | Tests |
|---|---------|------|----------|-------|
| 1 | Decide (single entry) | `api/_harness.js` | `decide(kind, input)` → publish/hold/block + reasons; fail-closed | `tests/api/harness.test.ts` (12) |
| 2 | Slang finder | `api/_slang.js` | `scanSlang`/`slangSummary`/`mergeSlang`; detection only, never blocks | `tests/api/slang.test.ts` (7) |
| 3 | Presence | `src/lib/utils.ts` + `api/_me.js` heartbeat | tiers now/hour/today/idle; 60s ping, 45s throttle, banned refused | `utils.test.ts`, `me.test.ts` |
| 4 | Trending | `src/lib/utils.ts` + `api/_leaderboard.js` | net up-minus-down scoring, floor 0 | `utils.test.ts`, leaderboard tests |
| 5 | Triage | `api/_inbox.js` triage | emergency/urgent/private routing, instant reports | `inbox-triage.test.ts` |
| 6 | Draft proposals | `api/_inbox.js` propose/accept/reject | dedupe, real safety gate, public always held | `inbox-draft.test.ts` (16) |
| 7 | Retention | `api/_cleanup.js` + `_db-stats.js` dry-run | 13 batched passes, proven counts, read-only mirror | cleanup + dry-run tests |
| 8 | Category hints | `api/_harness.js` + `api/_assist.js` | keyword routing hints; LLM suggest authority; user confirms | harness + assist tests |
| 9 | Report context | `Reports.tsx` helpers + `WorkItem` | reporter reliability + related link from loaded rows, no new fetch | `Reports.test.tsx` |
| 10 | Storage | `api/_storage.js` sweep + intel | orphan reclaim, 7d grace, abuse alerts | storage tests |

Rules for extending: one engine per concern, pure functions where
possible, every threshold named in a test, fail-closed defaults.
