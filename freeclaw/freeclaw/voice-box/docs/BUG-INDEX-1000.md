# Voice Flow — Technical Bug Index (1,000+ Compilation)

A categorized reference of technical bugs, errors, and glitches frequently encountered in
software applications. QA validates against it; developers use it to sharpen debugging;
PMs use it to anticipate development pitfalls.

## Structure

| Section | File | Category | Entries |
|---|---|---|---|
| 1 | [`docs/bug-index/logical-errors.md`](./bug-index/logical-errors.md) | Logical Errors — code logic that produces incorrect outcomes | 250+ |
| 2 | [`docs/bug-index/hardcoded-issues.md`](./bug-index/hardcoded-issues.md) | Hardcoded Issues — values fixed in code that should be dynamic | 250+ |
| 3 | [`docs/bug-index/syntax-errors.md`](./bug-index/syntax-errors.md) | Syntax Errors — code that prevents compilation or execution | 250+ |
| 4 | [`docs/bug-index/usability-glitches.md`](./bug-index/usability-glitches.md) | Usability Glitches — behaviors that negatively impact user experience | 250+ |

## Entry format

Every entry carries:

- **A unique ID** (`BUG-<CAT>-<nnn>`) so it can be referenced from test manifests and audits.
- **Category label** (one of the four above, plus a sub-pattern tag where useful).
- **Description** — objective: potential causes and effects. No vague terms.
- **Real-world example** — recognized industry issues and repeatable patterns (the AJAX
  race-condition class, the off-by-one pagination class, the N+1 query class, the
  silent-catch fallback class), plus provenance where the pattern was found in this
  codebase (e.g. the `callLLMChain` bogus-argument bug that silently disabled the AI
  analysis path, and the `securityCheck` object-comparison bug that never rate-limited).

## Methodology

- **Objective vs opinion:** descriptions state causes/effects and are verifiable; anything
  judgment-based (severity calls, "this is worse than that") is labeled as such.
- **Depth bar:** every entry names the mechanism (what code construct or design produces
  it), the failure mode (what actually goes wrong at runtime), and the detection surface
  (how a debugger or test catches it). Entries that cannot meet this bar are excluded.
- **No fake counts:** the per-section tallies below are updated as sections land.

## Progress

- [ ] Logical Errors (250+)
- [ ] Hardcoded Issues (250+)
- [ ] Syntax Errors (250+)
- [ ] Usability Glitches (250+)
