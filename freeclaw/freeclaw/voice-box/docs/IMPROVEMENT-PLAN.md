# VOICE BOX — CONTINUOUS ENTERPRISE IMPROVEMENT MASTER PLAN

> **Operation code:** STRYKER-001 (continuous loop, never final)
> **Owner:** Engineering Lead (agent) · **Basis:** docs/ARCHITECTURE.md + live codebase audit
> **Current baseline (verified 2026-08-06):** 664 tests green across 35 files; lint clean; build passes;
> full-stack dev API shim live (zero /api 404s); 17-route browser walk with zero console errors/warnings.

---

## 0. PRINCIPLES OF ENGAGEMENT

1. **User feel first.** Every change must trace to a user-visible improvement or a defense that prevents one.
2. **Evidence over opinion.** No change ships without a test, a measurement, or a browser observation.
3. **Parallel where independent, serial where dependent.** Test/audit/review lanes run concurrently; fixes
   flow from findings through a single ranked backlog.
4. **Institutional quality.** Apple/Stripe/Linear-grade craft: intentional motion, considered states,
   airtight error handling, no generic filler.
5. **Never "done".** Each cycle closes by re-scanning for the next highest-impact issue.

---

## PHASE 1 — USER EMPATHY (gather → map → prioritize)

Goal: know how users feel before touching code. Anonymous school-feedback platform ⇒ users are students
(submitters), admins (moderators), and silent readers.

### 1.1 Gather feedback channels
- [ ] **In-app sentiment probes:** add a lightweight, dismissible feedback CTA (thumbs/emoji + optional text)
      on feed, post detail, and submit success states → POST `/api/feedback` (new endpoint, rate-limited).
- [ ] **Onboarding friction:** first-submit drop-off funnel
      via existing `/api/users` heartbeat timestamps (last_seen deltas ≈ session length).
- [ ] **Support signal:** mine `/api/chat` + `/api/reports` messages for repeated pain phrases
      (regex classifier: "can't submit", "error", "slow", "confusing", "blocked", "banned").
- [ ] **Admin voice:** interview dashboard users on the 5 worst workflow frictions (moderation queue,
      status changes, poll moderation).

### 1.2 Sentiment → code mapping table
| Feeling | Proxy signal | Maps to |
|---|---|---|
| "I can't say it" | submit abandonment, error toasts | Submit.tsx validation, upload path |
| "Nobody's listening" | post → no admin_reply, no status change | Moderation SLA, admin queue |
| "It's confusing" | short sessions, high bounce on /board | IA, empty states, onboarding |
| "It's slow" | LCP > 2.5s, long poll fetch | API latency, bundle size, caching |
| "I'm anxious about privacy" | low trust copy engagement | Privacy page, anonymous branding |

### 1.3 Deliverable
`docs/FEEDBACK.md` — sentiment summary, ranked pain-point backlog, each mapped to a feature/area and a
measurable success metric (e.g., submit completion rate, admin response < 24h).

---

## PHASE 2 — FULL ERROR INVESTIGATION (static + dynamic + triage)

### 2.1 Static analysis (parallel lanes, all runnable today)
- [x] `npm run lint` — clean (baseline).
- [x] `npm run build` — passes (chunk-size warning only).
- [x] `npx vitest run --pool=forks` — 664/664 green.
- [x] `rg TODO|FIXME|HACK|@ts-ignore` in src+api — zero matches.
- [ ] **Type audit:** `npx tsc --noEmit` strict pass; hunt `any` leaks (`rg ": any|as any"`).
- [ ] **Dead code:** knip/depcheck for unused exports, unreachable branches.
- [ ] **Dependency audit:** `npm audit` + `npx audit-ci`; pin vulnerable transitive deps.

### 2.2 Dynamic testing
- [x] **Browser smoke walk (17 routes):** zero console errors/warnings post-shim (baseline).
- [ ] **Interaction fuzz:** Playwright script that clicks every button/CTA on feed, post, polls, board;
      asserts no uncaught exception, no toastless failure.
- [ ] **Error-path walk:** trigger submit validation errors, upload failure, vote on expired poll,
      admin wrong password, network-offline reload — assert graceful UI each time.
- [ ] **Realtime churn:** simulate Supabase realtime events (post update, poll_votes change, ban flag)
      mid-interaction; assert no state clobber (poll `myVote` regression guard exists).

### 2.3 Triage system
| Severity | Definition | SLA |
|---|---|---|
| **CRITICAL** | Data loss, security breach, hard crash, complete feature outage | fix same cycle |
| **HIGH** | Broken flow, wrong state, accessibility failure, perf regression | next cycle |
| **MEDIUM** | Suboptimal UX, missing empty/error state, minor inconsistency | within 2 cycles |
| **LOW** | Polish, copy, micro-interaction, refactor debt | backlog |

Every finding: `#ID | severity | area | evidence | fix suggestion | status`.

---

## PHASE 3 — TEAM STRUCTURE (roles → board → cadence)

Single-session autonomous squad (subagent lanes) mirroring an enterprise team. Each lane is a named agent
with a defined output contract; findings merge into ONE ranked backlog.

| Role | Agent type | Responsibility | Output |
|---|---|---|---|
| **Lead (me)** | orchestrator | plan, backlog, merge gates, final verification | ranked backlog |
| **User-voice analyst** | ux-researcher | Phase 1 sentiment, funnel, copy | docs/FEEDBACK.md |
| **Bug hunter** | debugger + error-detective | dynamic fuzz, error-path walk, triage | findings w/ repro |
| **Test architect** | test-writer + tdd-guide | gap coverage, regression suite | tests (RED first) |
| **Security reviewer** | security-reviewer + compliance-auditor | OWASP pass, rate limits, secrets | security report |
| **Perf engineer** | performance-optimizer | bundle, API latency, render profile | perf report |
| **A11y auditor** | a11y-architect | WCAG 2.2 AA pass, keyboard, contrast | a11y report |
| **Line reviewer** | code-reviewer + code-simplifier | line-by-line refactor passes | refactor PRs |
| **Docs keeper** | doc-updater | ARCHITECTURE/FEEDBACK updates | docs diff |

**Cadence (per loop cycle):** Kickoff → lanes run in parallel → merge board → fix wave (TDD) →
full re-verify (lint + build + 664+ tests + browser walk) → review gate → next cycle.
**Task tracking:** `docs/ISSUES.md` (ranked backlog with #ID + status) doubles as the task board; no
external tool required, stays in-repo, diffable.

---

## PHASE 4 — COMPLETE TESTING MATRIX (parallel triggers)

| Layer | Tool | Trigger | Owner | Gate |
|---|---|---|---|---|
| Unit | Vitest + React Testing Library | `npx vitest run <file> --pool=forks` | test-writer | 80%+ line coverage/file |
| Integration | Vitest + mocked fetch (`__tests__/mocks.ts`) | per module (polls, posts, auth) | test-writer | all green |
| E2E | Playwright (chrome-devtools MCP + playwright MCP) | browser walk script, interaction fuzz | bug hunter | zero console errors |
| A11y | axe-core via Playwright | `axe.run()` on 8 key routes | a11y auditor | WCAG 2.2 AA, 0 critical |
| Security | npm audit + manual OWASP pass | `npx security-audit` + code review | security reviewer | 0 high+ vulns |
| Perf | Lighthouse + React Profiler + network timing | `/` and `/board` profiles | perf engineer | LCP < 2.5s, no N+1 |
| Regression | full suite | `npx vitest run --pool=forks` | lead | 664+ green |

**Parallel execution model:** lanes are file-scoped (no overlapping edits): tests touch `src/__tests__/*`
+ coverage targets; security touches `api/` + `src/lib/auth`; perf touches `vite.config`/components;
a11y touches components + styles; line reviewer works oldest→newest component files with no lane overlap.

---

## PHASE 5 — LINE-BY-LINE CODE REVIEW & IMPROVEMENT

### 5.1 Pass order (coverage-score informed, worst first)
1. `src/components/ErrorBoundary.tsx` (40.8% cov) — crash-safety, retry semantics
2. `src/pages/Submit.tsx` (~45%) — validation, upload, error states, disabled states
3. Remaining components by oldest-modified → newest.

### 5.2 Checklist per file
- **Correctness:** state init vs sync (useEffect), stale closures, race guards, idempotency
- **Performance:** no render loops, memo where hot, no N+1 fetch, event listener cleanup
- **Security:** input validation at boundary, no secrets, no dangerous innerHTML
- **A11y:** semantic HTML, focus management, aria on interactive, reduced-motion respect
- **Maintainability:** < 500 lines/file, small functions, no deep nesting, no dead props
- **Polish:** empty/loading/error states on every async surface, consistent copy

---

## PHASE 6 — PARALLEL EXECUTION & FEEDBACK LOOPS (the loop)

```
                ┌──────────────► BACKLOG (ranked) ───────────────┐
                │                                                   │
  User voice ───┤                                                   ▼
                │                                        FIX WAVE (TDD: RED→GREEN)
  Bug hunt ─────┤                                                   │
                │                                                   ▼
  Security ─────┼──────────────► MERGE GATE (review + lint) ───► FULL RE-VERIFY
                │                                                   │
  Perf ─────────┤                                                   ▼
                │                                        GAP? → back to ANALYZE
  A11y ─────────┤                                                   │
                │                                                   ▼
  Line review ──┴────────────────────────────────────────► CYCLE N+1 (never stop)
```

**Feedback rules**
- Bug hunt findings → immediately filed as RED tests → fix wave.
- Perf findings → targeted optimizations with before/after measurement.
- A11y findings → fix in same cycle as touched component.
- User voice re-runs each cycle; sentiment shift re-prioritizes backlog.

---

## PHASE 7 — EVERY TOOL, SKILL, MCP, PLUGIN IN PLAY

| Category | Asset | Used for |
|---|---|---|
| Testing | vitest, RTL, Playwright, chrome-devtools MCP, axe | matrix above |
| Docs | context7 MCP (library truth), docs-lookup agent | verify APIs before edits |
| Security | security-audit tool, security-reviewer agent, npm audit | Phase 2/4 |
| Analysis | eslint, tsc, knip, depcheck, benchmark skill | static lanes |
| Design | DESIGN.md (neo-kinpaku system), impeccable skill | polish/consistency gate |
| Code quality | tdd-workflow, code-review-and-quality, code-simplification | review lanes |
| Orchestration | task tool (parallel subagents), sequential-thinking | planning + merge gates |
| Browser | playwright MCP (this session) | walk, fuzz, screenshots |

---

## PHASE 8 — SUCCESS CRITERIA (each cycle must hit)

- [ ] 664+ tests green (regressions never reduce the count)
- [ ] Coverage ≥ 80% lines on every touched file; overall ≥ 87%
- [ ] `npm run lint` and `npm run build` clean
- [ ] Browser walk (17 routes): zero console errors/warnings
- [ ] `npm audit`: zero high/critical (or documented exception)
- [ ] No `TODO|FIXME|HACK|@ts-ignore` introduced
- [ ] Every new async surface has loading/empty/error states
- [ ] Every interactive element keyboard-navigable + focus-visible
- [ ] Every animation respects `prefers-reduced-motion`
- [ ] Backlog shrinks each cycle; findings → fixes → tests, never lost

## CLOSING LOOP
After each cycle: full re-verify → update docs/FEEDBACK.md + docs/ISSUES.md → run one final design
review ("does this feel like Apple/Stripe/Linear?") → if any answer is NO, return to ANALYZE.
Stop ONLY when a full cycle produces zero actionable findings.
