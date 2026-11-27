# Loop Runbook: Autonomous Improve Loop (sequential, safe mode)

## Objective
Continuously make the actual product better: reproduce → root-cause → fix →
test → criticize → break-test → regression-test → document. No simulated
work, no fabricated evidence, no premature "done".

## Branch strategy
- Work on `initial-review-branch`. No commits/pushes without explicit user
  approval (harness policy overrides loop defaults).

## Stop conditions (ANY halts the loop)
1. Diminishing returns (a full iteration finds nothing actionable).
2. Same item fails validation twice (needs human).
3. Scope hits: migrations, auth-model redesign, dependency upgrades,
   anything needing production access (Vercel env, Supabase console).
4. User says "stop".

## Safety defaults
- Memory-safe validation only (`--maxWorkers=1`, per-file API runs).
  Full `tsc -b` / full suite need a stronger machine (documented, not ignored).
- Safe auto-fix: validation, error paths, timeouts, tests, ARIA, copy.
  Manual-flag: schema/RLS/policy, new deps, prompt redesigns, deletions.
- Never print secrets. Never claim untested results.

## Iteration log
### Iter 1 — Pre-existing API failures (13 across 4 files) [EXECUTING]
- authorization.test.ts (1), reactions.test.ts (1), search-perf.test.ts (2),
  v3-tools.test.ts (9). All reproduce on clean tree (proven via stash).
- Method: smallest first (authorization → reactions → search-perf → v3-tools).

## Monitor
- This file is the progress log. Gate per iteration: targeted tests green.
- Re-entry: "continue loop" resumes at next unchecked item.
