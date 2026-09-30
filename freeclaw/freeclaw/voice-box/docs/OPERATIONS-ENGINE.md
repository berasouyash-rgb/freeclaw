# Voice Box Autonomous Operations Engine — Full Framework

Status: **Design → Build** · Date: 2026-09-23
Grounded in: [`RESEARCH-AGENT-SYSTEMS.md`](./RESEARCH-AGENT-SYSTEMS.md) (primary-source research, requirements R1–R20) ·
[`WORKFORCE-50.md`](./WORKFORCE-50.md) (50-worker roster + contract) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
[`SAFETY-MODERATION.md`](./SAFETY-MODERATION.md) · [`CAPABILITIES-100.md`](./CAPABILITIES-100.md)

This document is the **single foundation** for the autonomous workforce: the engine, the canonical
flow, the schemas, the domain map (8 domains / 54 capabilities), the per-capability playbook
(trigger → tools → state change → independent verification → evidence → UI), the AI Coworker
design, and the traceability matrix back to the lab-researched requirements R1–R20.

---

## 0. Non-negotiable ground rules (research-derived)

1. **AI ACTIVITY IS NOT AI WORK.** A run is real work only when it ends in a state change
   *independently verified by re-reading the system* (R4/R13). `UNKNOWN` ≠ success. Worker
   self-reports, "completed" rows, and animations are not proof.
2. **The model never touches production.** Only one step of the canonical flow is
   nondeterministic (`ANALYZE`). Everything else — queueing, policy, permissions, execution,
   verification — is deterministic code (R3/R5).
3. **Workflows before agents.** Every capability is assigned a fixed workflow shape from
   Anthropic's catalog (chaining-gates / routing / parallel / orchestrator-worker /
   evaluator-optimizer / deterministic-sweep). Free-form loops are forbidden (R2).
4. **Few primitives, one engine.** All 54 capabilities run on the same engine (R1). No
   per-team agent frameworks.
5. **Everything is traced.** Every run emits an Evidence Pack; the admin UI renders the trace,
   not a status badge (R15/R19).
6. **Hard caps everywhere.** Attempt caps, cost caps, duration caps, watchdog, quarantine (R11).
7. **Simplicity gate.** If a single deterministic function or one LLM call can do the job, it is
   registered as a class-A deterministic worker — not an "agent" (research: "don't build
   agentic systems at all" when unnecessary).

---

## 1. Architecture layers (spec §1 — preserved)

```
VOICE BOX (product: posts/comments/replies/polls/ideas/categories/search/notifications/admin)
    ↓
USER EXPERIENCE
    ↓
AI COWORKER (chat · voice · files · research · coding · investigation · delegation · reports)
    ↓
WORKFORCE ORCHESTRATOR (_workforce.js / _workforce-core.js)
    ↓
EVENT ENGINE (_events.js — emitEventAndBridge, dedupe, bridge → realtime)
    ↓
DURABLE WORK QUEUE (task queue + cron driver agent-cron.js, 60 s window)
    ↓
AI / DETERMINISTIC WORKERS (50 existing + domain expansions; classes A/B/C/AI)
    ↓
REAL TOOL SYSTEM (namespaced Tool Registry: vb.* → Supabase / APIs / providers)
    ↓
REAL STATE CHANGE (rows, KV ledger workforce_actions_kv, alerts, indexes, caches)
    ↓
VERIFICATION (verify() independent re-read → { ok: true } required)
    ↓
EVIDENCE (Evidence Pack → store → trace span)
    ↓
REALTIME (Supabase channels + _events bridge)
    ↓
USER / ADMIN UI (Overview · OpsCenter · Reports · AI Quality · domain dashboards · Coworker)
```

Existing engine surfaces (kept, not replaced — research R1: extend what works):

| Engine piece | File | Role in this framework |
|---|---|---|
| Scheduling registry | `api/_automation-registry.js` | `WORKERS[]` single source of truth; cron iterates it; last-runs persisted |
| Lifecycle engine | `api/_workforce-core.js` | TRIGGER→OBSERVE→ANALYZE→DECIDE→SAFETY→EXECUTE→VERIFY→MEASURE→LOG→ALERT; refuses `verified_success` without `verify()→{ok:true}` |
| Cron driver | `api/agent-cron.js` | 60 s hard window, tick budget, `deferred` + next-tick pickup |
| Workforce API | `api/_workforce*.js` | Orchestrator, task queue, patrol, supervisor, stale recovery |
| Event bus | `api/_events.js` | Event emission + realtime bridge |
| Provider abstraction | `api/_providers.js` | 50+ providers + failover — no single-model dependency (R20) |

---

## 2. The domain map — 8 domains, 54 capabilities

```
VOICE BOX AUTONOMOUS OPERATIONS ENGINE
├── ORCHESTRATION   (6)  ← the engine itself; deterministic infrastructure + meta-workers
├── TRUST & SAFETY (10)
├── COMMUNITY       (6)
├── SEARCH & KNOWLEDGE (5)
├── PLATFORM        (7)
├── SECURITY        (5)
├── QUALITY         (7)
└── AI COWORKER     (8)  ← UI client of the same engine (delegates, never bypasses)
                       ─
                   54 capability nodes ↔ 50-worker roster (§3) + named NEW enrollments
```

Determinism split (R3): **Orchestration = deterministic code** (no model calls in queue/retry/
watchdog/scheduling paths). Every other capability: deterministic `observe/execute/verify`,
model only in `analyze` for ambiguity.

---

## 3. Foundation

### 3.1 WorkerContract (every capability must declare exactly this)

```ts
type WorkerContract = {
  id: string;                        // e.g. "tst-threat-detect"
  name: string;
  domain: "orchestration" | "trust_safety" | "community" | "search_knowledge"
        | "platform" | "security" | "quality" | "coworker";
  capability: string;                // one of the 54 nodes
  workflow_shape: "chaining_gates" | "routing" | "parallel_voting"
                | "orchestrator_worker" | "evaluator_optimizer"
                | "deterministic_sweep" | "event_driven";
  execution_class: "A" | "B" | "C" | "AI";   // A auto-act · B bounded · C evidence-only · AI ambiguity
  trigger: { kind: "event" | "cron" | "ai_class"; expr: string };
  tools: string[];                   // namespaced Tool Registry refs (vb.*)
  budget: { hourly_runs: number; max_attempts: number; max_duration_ms: number;
            max_tokens_per_run: number };
  approval_required: boolean;        // → Approvals queue instead of auto-execute
  disable_test: string;              // "if off 24 h, <measurable X> degrades"
  observe(ctx): Promise<Facts>;      // ground-truth reads ONLY (no memory, no self-report)
  analyze(facts): Promise<Decision>; // the ONLY nondeterministic step (structured JSON)
  policy(decision): "allow" | "deny" | "escalate";
  execute(decision): Promise<Mutation>;            // deterministic tool calls
  verify(before: Facts, after: Facts): VerifyResult; // independent re-read
  measure(delta): Metrics;           // latency · tokens · cost · state delta
};
```

### 3.2 WorkItem state machine (durable, crash-resumable — R9)

```
queued → claimed → observing → decided → gated → executing → verifying
   → verified_success
   |  → failed            (tool/verify error → Retry Engine)
   |  → deferred          (budget/time window exhausted → next tick)
   |  → standby           (nothing to do — honest no-op)
   |  → escalated         (class C or approval_required → Approvals queue)
   |  → quarantined       (watchdog: verify-mismatch streak / budget breach)
```

Transitions are written to the ledger (`workforce_actions_kv`) + trace span. A work item can
never jump `decided → verified_success` — `executing` and `verifying` are mandatory.

### 3.3 Evidence Pack (what the UI shows; the only acceptable "done")

```ts
type EvidencePack = {
  work_item_id: string; worker_id: string; domain: string; capability: string;
  trigger: { kind: string; ref: string; at: string };
  before: FactsSnapshot;             // system state before
  decision: { model?: string; rationale: string; tokens: number; confidence: string };
  policy: { verdict: "allow" | "deny" | "escalate"; rule: string };
  tool_calls: { tool: string; args_digest: string; result_digest: string }[];
  after: FactsSnapshot;              // system state after
  verify: { method: string; ok: boolean; re_read_at: string };  // ok:false ⇒ NOT success
  metrics: { duration_ms: number; attempts: number; cost_usd: number };
  span_id: string;
};
```

Storage: evidence table + KV ledger (existing pattern) with the realtime bridge emitting
`workforce_alerts` / evidence events to the admin UI.

### 3.4 Tool Registry rules (Anthropic tool principles, R6/R8)

- **Namespaced** `vb.<domain>.<verb>` — no overlapping vague tools; curated set only; **no raw
  CRUD exposure** to any model.
- Every entry declares: `destructive: boolean`, `scopes: string[]`, `rate_limit`,
  `permission_class`, `output_schema` (high-signal fields, natural-language names, no bare
  UUIDs), `error_format` (actionable message, never an opaque code).
- High-impact tools (`vb.security.ban_account`, `vb.enforcement.delete_content`,
  `vb.platform.apply_migration`) set `destructive: true` → **forced through the Approvals
  queue** (R7; MCP tool-annotation principle).
- Consolidation example: `vb.community.resolve_case` (finds + updates + notifies + verifies)
  instead of `list/get/update/notify` chains.

### 3.5 Policy & permission gate (between `analyze` and `execute`)

| Class | Rule | Examples |
|---|---|---|
| **A** deterministic auto-act | Scope-allow-listed mutations, no model ambiguity | poll close sweep, PII mask, stale-queue recovery |
| **B** bounded act | Model decision + caps + policy allow → executes within budget | summaries, category assignment, priority bumps |
| **C** evidence-only | Never mutates; produces evidence + escalates | red-team findings, UX intelligence, child-safety edge review |
| **Approval** | Destructive/high-impact → Approvals queue (human confirms → executor runs) | bans, migrations, mass edits |

Policy inputs: contract class, tool `destructive` flag, scope match, budget remaining,
approval flag, rate limit. Deny/escalate paths still produce a full Evidence Pack with
`policy.verdict` recorded (the no-action path, §4b).

### 3.6 Verification patterns (the core — R13)

| Pattern | When | Method |
|---|---|---|
| **Positive re-read** | Row/state should change | Independent SELECT/GET after execute; compare `after` vs expected delta |
| **Negative re-read** | No-action path | Re-read proves state did **not** change and shouldn't have |
| **Counterfactual** | Moderation/enforcement | The content that should be hidden IS hidden (fetch as a normal user would) |
| **Metric delta** | Platform/perf workers | Measured p95/throughput/backlog moved in the intended direction |
| **Re-probe** | Security fixes | Re-run the exact probe that found the hole; it must now fail closed |

Rules: `verify()` runs **after** execute in a fresh read (never trusts execute's return value);
`ok:false` or thrown error ⇒ run status is `failed`/`UNKNOWN`, never success; a verify-mismatch
streak trips the Watchdog → `quarantined`.

### 3.7 Watchdog, retry, quarantine, disable test

- **Retry Engine**: exponential backoff, `budget.max_attempts`, jitter; retryable = transient
  tool/network errors only; policy-denies are terminal.
- **Dependency Manager**: `source_ref` chains (existing dedupe pattern) + explicit
  `depends_on` edges — downstream items claim only after upstream `verified_success`.
- **Watchdog** (meta-worker, deterministic): heartbeat per worker, failure/verify-mismatch
  streaks, budget breaches, cron overruns → `quarantined` + alert; auto-release only after a
  passing eval re-run.
- **Disable test + Workforce Auditor (#49)**: every contract's `disable_test` is a scheduled
  assertion — worker off 24 h ⇒ named metric degrades; auditor culls workers that fail
  (nothing is kept for show).

### 3.8 Evaluation harness (R14/R16)

- Per-worker **held-out contract tests**: each test = realistic trigger + verifiable expected
  outcome (exact state assertion or model-graded with lenient verifier), run as a simple
  agentic loop — the existing api/vitest suites are this harness; every new contract ships
  with its tests **before** enrollment.
- Metrics beyond pass/fail: runtime per run, attempts, tokens, tool-error rate, cost —
  surfaced per worker in OpsCenter.
- Golden-workflow regression gate (`_golden-workflows.js`) + red-team suite run continuously.

---

## 4. Canonical workflow — THE FULL FLOW

### 4a. Action path

```
TRIGGER (deterministic event | cron tick | AI-class signal)
  → EVENT ENGINE          dedupe, normalize, emit → enqueue WorkItem (durable)
  → WORK DISPATCHER       match contract (domain/capability/trigger), budget check, claim
  → OBSERVE               fresh reads from real systems → Facts          [ground truth, R4]
  → ANALYZE               model call (only nondeterministic step) → structured Decision
  → POLICY GATE           verdict: allow | deny | escalate(approval queue)   [R5/R7]
  → PERMISSION CHECK      tool scope + destructive flag + rate + budget      [R6]
  → EXECUTE               deterministic vb.* tools → REAL state change
  → VERIFY                independent re-read → { ok: true }?               [R13]
  → MEASURE               duration · attempts · tokens · cost · delta        [R16]
  → EVIDENCE PACK         before/decision/policy/tools/after/verify/metrics → store + span
  → REALTIME + UI         bridge event → admin UI renders the trace          [R19]
  → MONITOR               watchdog, eval harness, disable-test audit         [R11]
```

### 4b. Deliberate no-action path (also real work — verified)

```
TRIGGER → OBSERVE → ANALYZE → NO_ACTION
  → VERIFY: re-read proves content/system is unchanged AND should be unchanged
  → EVIDENCE PACK (policy verdict + negative verification) → UI
```

### 4c. Failure / quarantine path

```
execute/verify error → RETRY ENGINE (backoff ≤ max_attempts)
  → attempts exhausted → failed + EvidencePack(attempts, errors) → alert
  → verify-mismatch streak or budget breach → QUARANTINED + watchdog alert
  → quarantine release only after held-out eval passes
```

### 4d. Approval path (destructive / class C escalations)

```
policy → escalate → APPROVALS QUEUE (admin sees WHY + evidence + before/after)
  → human approves → EXECUTOR runs the same execute→verify→evidence tail
  → human rejects → denied verdict recorded (still evidenced)
```

---

## 5. Domain playbooks (capability → real worker → real verification → UI)

Column key: **Shape** = workflow shape · **W#** = roster number in WORKFORCE-50 ·
**Verify** = independent verification method (§3.6) · **UI** = where the evidence is rendered.
Every row's evidence follows the §3.3 pack.

### 5.1 ORCHESTRATION (6) — deterministic engine + meta-workers

| Capability | Worker | Shape | Trigger → tools | Real state change | Verify | UI |
|---|---|---|---|---|---|---|
| Event Engine | `_events.js` (code) | deterministic | DB/webhook events → enqueue | WorkItem rows + event log | Event-log continuity counter (count in = count queued) | OpsCenter event ticker |
| Work Dispatcher | `_workforce.js` queue | deterministic | queue read → claim/dispatch | claim rows, `source_ref` dedupe | no double-claims (re-read claims) | OpsCenter queue panel |
| Scheduler | `agent-cron.js` | deterministic | 60 s window → registry loop | last-run stamps per worker | every enrolled worker has fresh last-run or honest `deferred` | OpsCenter scheduler panel |
| Retry Engine | **NEW** `_retry.js` | deterministic | failed items → backoff queue | attempt counters, retry rows | attempts ≤ max; terminal states reached | OpsCenter retry panel |
| Dependency Manager | **NEW** `_deps.js` | deterministic | `depends_on`/`source_ref` edges | dependency edges, gated claims | downstream never claims before upstream `verified_success` | OpsCenter DAG view |
| Watchdog | Workforce Auditor #49 + `_workforce.js` recoverStale | deterministic_sweep | heartbeats → quarantine/release | quarantine flags, stale recovery | quarantined worker actually stops running (re-read runs) | OpsCenter watchdog card |

### 5.2 TRUST & SAFETY (10)

| Capability | Worker | Shape | Trigger → tools | Real state change | Verify | UI |
|---|---|---|---|---|---|---|
| Content Understanding | #2 Submission Understanding + #4 Category | routing | new post/comment → `vb.knowledge.classify`, `vb.community.assign_category` | `ai_summary`, category fields | re-read row has summary/category | Reports AI Review tab |
| Context/Slang | Slang contract worker (SAFETY-MODERATION §14) | chaining_gates | flagged text → `vb.t_safety.slang_context` (context gate BEFORE any masking) | verdict rows in review queue | verdict row exists; `safe:true` slang not actioned | Reports AI Review tab |
| Harassment | #22 Content Moderation | parallel_voting | comment-watch sweep → `vb.t_safety.harass` + `vb.t_safety.bully_v` | hide/strike rows | counterfactual: content hidden as a normal user | Reports queue + evidence pack |
| Threat Detection | #22 + threat bucket (score ≥60) | chaining_gates | event → detect → policy (auto-escalate) | removal + alert rows | counterfactual re-fetch + alert exists | Reports + OpsCenter alert |
| PII Protection | #39 Data Exposure Protection | deterministic_sweep | event → `vb.t_safety.mask_pii` | masked row (**gate raw text first, mask only at insert**) | re-read shows PII gone, meaning preserved | evidence pack (before/after diff) |
| Child Safety | specialized pipeline (SAFETY-MODERATION) | chaining_gates (allow-list first) | event → specialized class-C review | escalation rows only (never auto-allow) | escalation exists + content restricted | Approvals queue |
| Sexual Safety | #22 buckets (explicit ≥50) | routing | event → category route → enforcement | moderation rows | counterfactual hidden | Reports queue |
| Scam/Fraud | **NEW** `_fraud.js` (class B) | parallel_voting | pattern vote → `vb.t_safety.fraud` | scam labels/blocks | blocked content re-read | Reports queue |
| Spam/Abuse | #23 Abuse Detection | event_driven | rapid-fire/spam → `_spam.js` throttle | throttle rows, hidden spam | blocked request re-probe fails | OpsCenter security card |
| Enforcement | enforcement ladder (SAFETY-MODERATION) | orchestrator_worker | verdict → ladder step → `vb.enforcement.*` (destructive ⇒ approval) | strikes/bans/hide rows | counterfactual + ladder state re-read | Approvals + Reports |

### 5.3 COMMUNITY (6)

| Capability | Worker | Shape | Trigger → tools | Real state change | Verify | UI |
|---|---|---|---|---|---|---|
| Duplicate Detection | #7 Duplicate Case (`_duplicates.js`) | deterministic_sweep | cron → `vb.community.duplicate_scan` | duplicate flag/merge rows | dual-read: cluster recomputed matches flags | OpsCenter community card |
| Issue Clustering | #8 Related + #14 Recurring (`_trend-watch.js`) | orchestrator_worker | daily batch → relate/recur analysis | related/recurring rows | re-read links resolve | OpsCenter trends card |
| Priority | #9 Priority (`_sla.js`) | deterministic_sweep | cron → `vb.community.prioritize` | priority field bumps | re-read order matches PRIORITY_ORDER | case list |
| Case Lifecycle | #10 Assignment · #11 SLA · #12 Follow-up · #13 Resolution Verification | deterministic_sweep + chaining | events/cron → createTask/`checkSLA`/`checkFollowups`/`verifyReportResolution` | task rows, warnings, verified closures | **#13 counterfactual**: falsely-resolved report reopened + content visible again | Reports (resolved evidence) |
| Poll Operations | #19 Poll Creation · #20 Poll Integrity | deterministic_sweep | cron → `_poll-sweeper.js`/`_poll-integrity.js` | closed/expired/quarantined-vote rows | re-read poll state + fraud votes excluded | poll admin + OpsCenter |
| Community Health | #21 Community Health (**NEW** `_community-health.js`) | evaluator_optimizer | cron → badges/leaderboard signals | health metric rows + flags | metric recomputation matches | Overview health strip |

### 5.4 SEARCH & KNOWLEDGE (5)

| Capability | Worker | Shape | Trigger → tools | Real state change | Verify | UI |
|---|---|---|---|---|---|---|
| Search | #16 Search Intelligence | deterministic_sweep | cron → `_search-quality.js` metrics | metric rows | metric recompute matches | search dashboard |
| Ranking | **NEW** ranking evaluator (class B) | evaluator_optimizer | engagement sample → rank eval → tweak weights | ranking weight/config rows | nDCG/proxy metric delta improves | search dashboard |
| RAG | #17 Knowledge + `_rag.js` searchKB | chaining_gates | query → retrieve → synthesize **with citations** | answer rows w/ source refs | **every citation resolves to a real KB/post row** | coworker chat citations |
| Knowledge Updates | #17 `maintainKB` | chaining_gates | resolved cases → draft KB entry → gate (fact check) → publish | KB rows | re-read entry exists + matches source case | knowledge admin |
| Zero-result Recovery | #40 Search Repair + #16 | routing | zero-result event → synonym/expand repair | synonyms/expansions rows | **before/after**: same query now returns >0 | search dashboard |

### 5.5 PLATFORM (7)

| Capability | Worker | Shape | Trigger → tools | Real state change | Verify | UI |
|---|---|---|---|---|---|---|
| Database | #32 Database Intelligence (`_db-stats.js`) | chaining_gates | slow-query/analyze → `vb.platform.suggest_index` (apply ⇒ approval) | index/migration rows | EXPLAIN plan + p95 delta measured | Platform dashboard |
| Cache | **NEW** `_cache-ops.js` (class A/B) | deterministic_sweep | TTL/stale events → warm/invalidate via `vb.platform.cache_*` | cache version rows | hit-rate/latency delta improves | Platform dashboard |
| Queue | #33 Queue Recovery | deterministic_sweep | stale scan → recover/drain | recovered item rows | backlog gauge re-read drops | OpsCenter queue panel |
| Realtime | **NEW** `_realtime-health.js` | event_driven | channel errors → reconnect/repair actions | health event rows | end-to-end probe message delivered | OpsCenter realtime card |
| Storage | storage sweep (enrolled) + #24 Upload | deterministic_sweep | cron → `vb.platform.storage_scan` | reclaimed/orphan rows | checksum/size re-read matches | Platform dashboard |
| Notifications | #34 Notification Intelligence | chaining | delivery failures → repair/batch actions | repaired/digested rows | delivery receipt re-read | notification admin |
| Performance | #31 Performance Intelligence + **load manager** | chaining_gates | metrics → `vb.platform.*` optimizations | perf config/query changes | **TARGET ENVELOPE**: 500-concurrent workload run — DB util <30%, p95/p99, error rate, backlog, realtime latency, memory, CPU all measured before/after | PERF dashboard (measured numbers only) |

### 5.6 SECURITY (5)

| Capability | Worker | Shape | Trigger → tools | Real state change | Verify | UI |
|---|---|---|---|---|---|---|
| Detection | #36 Security Operations (`_security.js`) | event_driven | auth/rate anomalies → `vb.security.detect` | security event rows | event re-read exists + classified | Security dashboard |
| Authorization Testing | #37 Authorization Protection | deterministic_sweep | cron probe suite (scoped, non-destructive) → `vb.security.authz_probe` | probe result rows; findings | **re-probe** after fix must fail closed | Security dashboard (probe evidence) |
| Abuse Detection | #36/#23 traffic side (rate-limit evasion, credential stuffing) | parallel_voting | traffic sample → vote → block rules (approval for account bans) | block/rule rows | replayed abusive pattern blocked | Security dashboard |
| Incident Response | #35 Incident Recovery | orchestrator_worker | incident event → playbook steps → contain/notify | incident rows + mitigations | post-incident probe confirms contained | Incident view |
| Verification | re-probe pass (shared with AuthZ) | chaining_gates | after any fix → exact original probe | verified-fix rows | probe fails closed / service healthy | Security dashboard green proof |

### 5.7 QUALITY (7)

| Capability | Worker | Shape | Trigger → tools | Real state change | Verify | UI |
|---|---|---|---|---|---|---|
| E2E QA | #30 Product QA (`_golden-workflows.js` / e2e runner) | deterministic_sweep | cron/deploy → journey suite | run result rows + artifacts | **test results are the verifier** (pass/fail from real runs) | QA dashboard |
| Mobile QA | **NEW** viewport/responsive suite (class C) | deterministic_sweep | cron → mobile journeys | run rows + screenshots | suite pass/fail from real runs | QA dashboard |
| Accessibility | **NEW** axe audit worker (class C) | deterministic_sweep | cron → axe on key pages | issue rows | re-audit: issue gone after fix | QA dashboard |
| AI Evaluation | #25 AI Quality (`_evaluation-engine.js`) | evaluator_optimizer | output sample → score vs rubric | score rows + trends | score recompute + held-out set | AI Quality page |
| Regression | #27 AI Regression (`_golden-workflows.js`) | chaining_gates | change event → golden cases | regression verdict rows | golden assertions from real runs | AI Quality page |
| Red Team | #26 AI Red-Team (**NEW** `_red-team.js`, class C) | parallel_voting | cron → injection probes vs moderation/AI | finding rows (evidence-only) | finding reproduces on replay | AI Quality page |
| Drift | #28 AI Drift (**NEW** `_drift.js`) | evaluator_optimizer | cron → eval deltas vs baseline | drift metric rows | delta recompute matches | AI Quality page |

### 5.8 AI COWORKER (8) — see §6

---

## 6. AI COWORKER — flow of flows (client of the same engine)

The Coworker never bypasses the engine. Every "do something" is either a **read-only answer**
(class C tools) or a **delegated WorkItem** (orchestrator-workers shape, R18). Every answer
that claims work happened renders the resulting Evidence Pack inline.

```
USER (chat text | voice | file | admin ask)
  → INTENT ENGINE (_agent-chat.js)
     ├─ READ/ANSWER  → class C tools (query posts/ledger/metrics) → answer + cited sources
     │                 (RAG verification: citations must resolve)
     └─ ACT          → ENQUEUE WorkItem(domain/capability match) → §4 canonical flow
                        → coworker streams trace (observed → decided → verified)
                        → message shows Evidence Pack (before/after + verify ok)
```

| Capability | Shape | Real tools | State change | Verify | UI |
|---|---|---|---|---|---|
| Chat | routing (intent) | `vb.coworker.read_*` (read-only), enqueue | none inline; delegated items change state | any claimed action shows its pack | `AgentChat.tsx` (slice 11) |
| Voice | chaining | `_assist.js` + `_transcribe.js` (server ASR) | voice → case rows (#1 Voice-to-Case) | transcript row re-read | Submit voice UI + inbox summary |
| Files | chaining_gates | `_upload.js`/`_storage.js` scan → classify | file metadata/verdict rows | re-read file row + scan verdict | upload review UI |
| Research | chaining_gates | provider calls + KB/URL retrieval | note rows with citations | **citations resolve**; claims marked unverified otherwise | coworker research panel |
| Coding | chaining_gates | diff generation → repo gates | patch rows (proposal only) | **gates green**: tsc + eslint + vitest run results are the verifier | review UI (human merges — R5/R7) |
| Investigation | deterministic read-only (class C) | `vb.coworker.query_*` over ledger/DB | evidence rows only, never mutation | findings reproduce from raw rows | investigation report view |
| Delegation | orchestrator_worker | enqueue by contract match to the 54 | child WorkItems | child's own `verify()` chain | OpsCenter DAG (§5.1 Dependency Manager) |
| Reports | deterministic aggregation | ledger/evidence reads | report rows (3-tab model shipped in slice 12) | counts recomputed from evidence | `Reports.tsx` + briefings (#18) |

Rules for the Coworker (research warnings):
- It may **never** claim a result it cannot show an Evidence Pack for — chat renders
  `verify.ok`, attempts, and the after-state, or it says "not verified."
- Delegation picks workers **by contract match** (domain/capability/trigger), never
  free-form "do whatever."
- Coding stays human-merge: the coworker proposes patches; deterministic gates are the
  verifier; a human lands them (separation of decision and execution, R5).

---

## 7. Realtime & UI wiring (proof surfaces)

| Surface | Shows | Source |
|---|---|---|
| **OpsCenter** | Worker cards: last-run, status, budget burn, attempts, quarantine state, queue/retry/watchdog panels, event ticker | registry last-runs + ledger + Evidence Packs |
| **Reports** (3-tab, slice 12) | Unified queue with per-row status + AI Review + Approvals (WHY + evidence), resolved rows carry verification | `_reports.js` (`verifyReportResolution`, `attachWorkerEvidence`) |
| **Overview** | REPORTS panel (all reports + status chips + conditional actions), health/perf strips | live API reads |
| **AI Quality** | eval scores, regression/red-team/drift, golden-workflow runs (Training Center removed — training runs in background) | evaluation engine rows |
| **Security / Platform / Search dashboards** | probe evidence, perf numbers (TARGET ENVELOPE), search metrics | worker metric rows |
| **Coworker chat** | inline Evidence Pack per claimed action | delegation results |

UI rule (R19): a badge saying "AI ACTIVITY: 432" is forbidden anywhere it isn't backed by
packs; every count links to the underlying evidence rows.

---

## 8. Traceability — R1–R20 → framework components

| Req | Source (in RESEARCH-AGENT-SYSTEMS.md) | Where it lives here |
|---|---|---|
| R1 one engine, few primitives | OpenAI SDK / Anthropic simplicity | §1 engine table; §2 single map |
| R2 workflows before agents | Anthropic catalog | §0.3 + Shape column everywhere |
| R3 deterministic paths | Google graph workflows | §2 determinism split; §4 flow |
| R4 ground truth each step | Anthropic loop | `observe()` fresh reads only |
| R5 decision ≠ execution | Anthropic/OpenAI/Google | §3.5 policy gate; §6 coding rule |
| R6 curated namespaced tools | Anthropic tools post | §3.4 |
| R7 confirmation for impact | OpenAI HITL / Google confirmations | §4d Approvals path |
| R8 high-signal token-budgeted returns | Anthropic | Tool output schemas + trim in §3.4 |
| R9 durable resume | OpenAI sessions / ADK resume | §3.2 state machine + cron `deferred` |
| R10 ambient 24/7 workers | ADK ambient agents | cron + event_driven triggers |
| R11 stopping conditions | Anthropic max-iterations | budgets, Retry Engine, Watchdog, quarantine |
| R12 isolated scoped execution | OpenAI sandbox | per-worker scopes + classes A/B/C |
| R13 independent verification | Anthropic verifiable outcomes | §3.6 patterns; `verify()` mandatory |
| R14 contract + held-out evals | Anthropic eval method | §3.8 harness |
| R15 tracing → evidence | OpenAI tracing / ADK traces | §3.3 Evidence Pack + span |
| R16 measure beyond pass/fail | Anthropic metrics | `measure()` + OpsCenter metrics |
| R17 guardrails fail fast | OpenAI guardrails | policy gate before execute |
| R18 two orchestration modes | OpenAI handoffs vs agents-as-tools | delegation (orchestrator-worker) + enforcement ladder (handoff) |
| R19 transparency in UI | Anthropic principle | §7 proof surfaces |
| R20 no single-model dependency | Google multi-model; spec §3 | `_providers.js` failover chain + deterministic fallbacks |

---

## 9. Build order (foundation-first; each slice gated)

1. **Foundation gaps**: Retry Engine + Dependency Manager + watchdog quarantine wiring
   (§3.7), Evidence Pack table + span emission standardized (§3.3).
2. **Domain fill**: enroll roster PART/NEW workers domain-by-domain in the §5 order where
   risk is highest (Trust & Safety first), each with contract + held-out tests + disable test.
3. **Coworker delegation**: intent engine → contract-matched enqueue + inline evidence (§6).
4. **Verification depth**: counterfactual/re-probe patterns (§3.6) into Reports/Security.
5. **TARGET ENVELOPE run**: Platform/Performance under the representative 500-user workload;
   publish measured numbers only.
6. **Auditor pass**: Workforce Auditor #49 executes every `disable_test`; cull failures.

Each slice follows the standing rules: gates green (vitest/api/eslint, never concurrent),
one verified commit per slice, no `git add -A`, evidence before claims.
