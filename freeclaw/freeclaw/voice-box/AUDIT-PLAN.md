# Voice-Box Full-Codebase Bug Audit — Working Plan (2026-09-24)

Target: C:\Users\lenovo\freeclaw\freeclaw\freeclaw\voice-box (local, user-owned, read-only audit)

## Passes
- [x] P0: Scope + secret exposure check (.env tracked in git? committed keys?) — clean; anon key excluded per scope
- [x] P1: Automated scans — npm audit (0 vulns), grep dangerous patterns; eslint/tsc OOM (tooling, not app bug)
- [x] P2: Agent A — api/ core auth + user/data endpoints (authz, IDOR, injection) — findings #1 #2 #6 #11
- [x] P3: Agent B — api/ AI/agent/workforce/cron endpoints (SSRF, injection, privileged ops) — findings #3 #4 #10
- [x] P4: Agent C — src/ frontend (XSS, secret leakage, logic bugs) — clean (markdown.ts escape-first verified)
- [x] P5: Agent D — config/deploy/services/scripts/.github (secrets, CI, SSRF, Docker) — findings #5 #7 #8 #9 #12
- [x] P6: Aggregate findings → AUDIT-REPORT.md with severity + file:line — **done: 12 findings, 5 HIGH**

## Rules
- Read-only. No exploit execution, no writes to source.
- Findings must be concrete: file:line, reachable path, real impact. No theoretical bugs.
