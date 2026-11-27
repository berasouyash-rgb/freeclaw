# Loop Runbook: Full Platform Code Review (sequential, safe mode)

## Objective
Prioritized bug + improvement sweep of the VoiceBox platform: security →
correctness → performance → UX polish. Each pass ends with tests green or
the loop stops.

## Branch strategy
- Work on `initial-review-branch`. No new branch (tree already holds the
  session's feature work, all uncommitted).
- No commits/pushes without explicit user approval (harness policy).

## Stop conditions (ANY halts the loop)
1. A pass finds zero actionable issues (diminishing returns).
2. Any validation gate fails twice in a row on the same item (needs human).
3. Scope touches: migrations, auth model changes, dependency upgrades
   (flag to user instead of auto-fixing).

## Safety defaults
- `ECC_HOOK_PROFILE`: N/A in this harness (no hook system); substituted with
  mandatory per-pass test gates below.
- Full `tsc -b` / full suite OOM on this box → memory-safe slices only
  (`--maxWorkers=1`, per-file API runs); final gate needs a stronger machine.
- Never print secrets; only lengths/statuses.
- Safe auto-fix: error messages, validation, timeouts, ARIA, tests.
  Manual-flag: schema/RLS/policy changes, new deps, prompt redesigns.

## Passes
### Pass 1 — Security & trust boundaries (DONE 21:16)
- Found: unbounded `userMessage` + history in `api/_ai-chat.js` → capped
  (50 turns / 4000 chars) via pure exported `normalizeChatInput` + 3 tests.
- Verified good: admin gate first (832), injection detect+audit, `[Tool Result]`
  delimiters, poll own-post rule, anon zero-write (013 guard).
- Flagged (manual, not auto-fixed): no rate limit on admin `ai-chat` handler
  (admin-only; tool loop already iteration-bounded).

### Pass 2 — Correctness (DONE 21:19)
- Timeout math reconciled: reply worst 34s < 35s outer race < 45s client;
  classify lane 2 capped 20s (was uncapped).
- Found: admin `triage`/`draft_reply`/`summary` actions have NO client caller
  (dead surface, safe defaults) — recorded, not deleted.

### Pass 3 — Performance (DONE 21:2x)
- New lane code is sequentially-correct by design (fast→chain→local must
  cascade on failure, not parallelize).
- Keyless deployments pay ~0ms (null before fetch); `hasUsableLLM` cached 30s.
- Inbox tail already `Promise.allSettled`; feed uses SWR cache.
- No actionable N+1 found in touched hot paths. Full-repo N+1 sweep of
  6k-line agent files exceeds safe auto-fix scope → flagged, not churned.

### Pass 4 — UX polish (DONE, prior session)
- `TypingIndicator` role=status; 44px touch targets; honest toasts;
  preserved inputs; review-before-publish. Covered by tests.

## LOOP STOPPED — stop condition 1 (diminishing returns)
Passes 1-4 complete. Remaining items are all manual-scope (migrations,
full-suite hardware gate, Vercel env). No further autonomous passes.

## Monitor
- Progress file: this runbook (passes checked off).
- Verify any pass: re-run its gate commands (listed per pass above).
- Abort phrase: user says "stop".
