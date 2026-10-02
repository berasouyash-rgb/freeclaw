# Loop Runbook — Voice Box Autonomous Improvement Loop

- **Pattern:** sequential (fix highest-value issue → verify → next)
- **Mode:** safe
- **Branch:** `initial-review-branch` (work accumulates uncommitted alongside 33 pre-existing modified files; do not commit or revert pre-existing changes)
- **Repo:** `C:\Users\lenovo\freeclaw\freeclaw\freeclaw\voice-box`

## Loop-Start Safety Checks (verified 2026-09-17)

| Check | Result | Evidence |
|-------|--------|----------|
| Tests pass before first iteration | PASS | Frontend: 90 files / 1514 tests. API: 50 files / 737 tests. |
| Production build | PASS | `npm run build` → `✓ built in 46.87s`, exit 0 |
| Typecheck | PASS | `npx tsc -b --pretty false` → exit 0 |
| Lint | PASS | `npx eslint .` → exit 0 |
| `ECC_HOOK_PROFILE` not disabled | PASS | Env var empty/unset |
| Explicit stop condition | DEFINED | see below |

## Stop Condition

The loop stops when any of:
1. A full verification gate fails twice on the same strategy (escalate instead of retry-loop).
2. No remaining issue ranks above "maintainability polish" and all known issues are documented.
3. Environment limits block verification (disk space on C:, tool failures) — report BLOCKED with evidence.
4. User explicitly stops the loop.

## Iteration Protocol (per issue)

1. Pick highest-value issue (correctness > security > data integrity > user impact > reliability > accessibility > performance > UX).
2. Reproduce / confirm root cause before editing.
3. Debate at least 2 approaches for non-trivial fixes; pick the simplest that solves the root cause.
4. Implement minimally.
5. Verify: targeted test → full gates (tsc → lint → frontend suite w/ 6GB heap → API suite → build).
6. Criticize + attempt to break the fix; check regressions in adjacent features.
7. Append evidence entry to `changelog.md` in this directory.
8. Repeat.

## Environment Constraints

- **C: drive critically low.** Monitor before builds/test runs. D:/E:/F: have space if needed for temp.
- Windows cmd shell: no `cat`/`tail`/`grep` in bash tool — use `findstr`, `dir`, PowerShell where needed.
- Frontend suite needs `set NODE_OPTIONS=--max-old-space-size=6144`.
- The `edit` tool truncated `src/lib/dashboard/widgets.tsx` to 0 bytes once (disk-full during write). After any large edit, verify file size/line count.
- Incident postmortem for the truncation: see `changelog.md` entry 2026-09-17.
