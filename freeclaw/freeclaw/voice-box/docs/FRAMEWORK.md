# Voice Box — Operations Engine Framework

> Status: **Design foundation** · Date: 2026-09-23
> Companion to: [`RESEARCH-AGENT-SYSTEMS.md`](./RESEARCH-AGENT-SYSTEMS.md) (primary sources → requirements R1–R20),
> [`WORKFORCE-50.md`](./WORKFORCE-50.md) (worker roster), [`CAPABILITIES-100.md`](./CAPABILITIES-100.md) (spec §41 capability list),
> [`.claude/plans/voicebox-workforce-loop.md`](../../.claude/plans/voicebox-workforce-loop.md) (execution runbook — untouched by this doc).
>
> This document is the single foundation every worker, workflow, and admin surface is built on:
> the laws, the layer model, the canonical pipeline, the contracts/schemas, the six workflow shapes,
> governance, verification, tracing/UI, the 8-domain × 54-capability map, the data model, the
> orchestration loop, AI Coworker flows, the performance envelope, and R1–R20 compliance.

---

## §0 — Laws (invariants; nothing may violate these)

1. **AI ACTIVITY IS NOT AI WORK.** Work = trigger → decision → real tool → real state change →
   independent verification → measured evidence → UI. Anything short of that is activity, not work,
   and is not recorded as success.
2. **`UNKNOWN` ≠ `SUCCESS`.** If verification cannot prove the change, the run terminal state is
   `unknown` and is reported as such — never counted green, never rendered as a checkmark.
3. **Worker self-report ≠ independent verification.** The code that mutated state may not be the
   code that confirms it. Verification re-reads state through a separate verifier path.
4. **Decision ≠ execution (R5).** The model emits a structured decision; deterministic code holds
   the tool handle, enforces scope/caps/policy, and only then executes.
5. **No fake dashboards, no simulated tools, no staged data.** Every number on every admin surface
   traces to an evidence pack. Rendering a metric without its evidence is a bug, not a shortcut.
6. **Every worker ships**: contract, lifecycle states, disable test ("off 24h → X measurably
   degrades"), evidence pack, cost/attempt/duration caps, watchdog + quarantine (R11).
7. **Scoped, annotated tools only (R6/R7).** Tools are namespaced, capability-scoped, annotated
   destructive/non-destructive; destructive calls require confirmation (Approvals queue).
8. **Masked text never feeds `serverModerate`.** Moderation always sees raw input; masked text
   exists only for display/persistence per `SAFETY-MODERATION.md`.
9. **One commit per verified slice; no `git add -A`; evidence precedes every claim.**
10. **No single-model dependency (R20).** Provider abstraction with fallback; deterministic
    regex/emergency path when no model answers.

---

## §1 — Layer model (foundation)

```
L7  UI / ADMIN SURFACES     Overview · Reports(3 tabs) · OpsCenter · domain dashboards · proof UI
L6  REALTIME                channel broadcasts: run events, queue depth, evidence arrival
L5  EVIDENCE + TRACE        evidence packs, trace spans, cost ledger — immutable, append-only
L4  VERIFICATION            independent verifier reads (V1–V6, §6) — the only path to "success"
L3  GOVERNANCE              policy/permission · classes A/B/C · caps · approvals · quarantine
L2  EXECUTION               scoped tools → real state change (DB/KV/notify/index/cache…)
L1  DECISION                structured Decision object (the only probabilistic layer)
L0  ORCHESTRATION (deterministic)
    Event Engine · Work Dispatcher · Scheduler · Retry Engine · Dependency Manager · Watchdog
```

Rules:
- **L0 is pure deterministic code.** Events are durable; the queue is at-least-once with
  idempotent execution; retries are bounded; the watchdog reaps leases and quarantines.
- **L1 is the only layer that calls a model.** Everything below/above it is testable without a
  provider key.
- **Every layer emits trace spans** (§7); a run with missing spans is `unknown`, not success.
- Maps onto the existing repo stack (ARCHITECTURE.md): React+Vite L7, Vercel serverless L2–L4,
  Supabase Postgres L0/L2 state, SWR L7 data.

---

## §2 — Canonical pipeline (the full flow — every worker, no exceptions)

```
TRIGGER ─► OBSERVE ─► DECIDE ─► POLICY ─► ACT ─► VERIFY ─► EVIDENCE ─► TRACE ─► UI
 (event/    (read      (L1 model   (L3 gates:  (L2 scoped (L4 separate   (L5 pack:  (L5 spans) (L7 render,
  cron/     ground     Decision    class,       tool →     verifier      before/                  links to
  manual)   truth)     object)     caps, scope, real state re-reads       after,                   pack)
                                 approvals)   change)    state)          result, cost)
```

Terminal states (a run ends in exactly one):

| State | Meaning | Counts as success? |
|---|---|---|
| `verified_success` | Act executed AND verifier proved the intended state change | ✅ yes |
| `verified_noop` | Decision was `no_action` AND verifier proved nothing changed (and nothing should have) | ✅ yes (honest zero) |
| `failed` | Tool/policy/verifier disproved the change | ❌ |
| `unknown` | Change may have happened; verification inconclusive | ❌ never |
| `deferred` | Budget/window/dependency not met; requeued with reason | ❌ (not a result) |
| `quarantined` | Watchdog stopped it (fault streak, cap breach, verify-fail streak) | ❌ |

State machine:

```
registered ─► enabled ─► pending ─► running ─► verifying ─┬─► verified_success
     ▲            │                    │    │             ├─► verified_noop
     │            ▼                    ▼    ▼             ├─► failed ──(retry ≤attempt cap)──► pending
  disabled ◄── disable-test runs       timeout/lease       ├─► unknown (retry or escalate)
                     │                    expiry            ├─► deferred (requeue: reason)
                     └── fault streak / cap breach ────────┴─► quarantined ──(auditor clears)──► enabled
```

Idempotency: every trigger carries a `trigger_key`; the dispatcher dedupes, and `act` is
idempotent per key so at-least-once delivery never double-mutates.

---

## §3 — Contracts (the schema foundation)

```ts
// One per worker — registered before it may run (R14).
interface WorkerContract {
  id: string;                      // "trend-watch"
  domain: Domain;                  // one of the 8 (§8)
  capability: Capability;          // one of the 54 (§8)
  class: "A" | "B" | "C";          // A deterministic auto-act · B bounded act · C evidence-only/escalate
  trigger: { kind: "event" | "cron" | "manual"; expr: string };
  tools: ToolSpec[];               // scoped handles the worker may request via L3
  caps: { costUsdPerRun: number; attempts: number; durationMs: number };
  workflow: WorkflowShape;         // one of the 6 (§4)
  disableTest: string;             // measurable degradation if off 24h
  verify: VerifyMethod[];          // V1–V6 chosen up front (§6)
}

interface WorkItem {               // durable queue row
  id: string; triggerKey: string; workerId: string;
  state: RunState; attempt: number; leaseUntil: string;
  dependencyIds: string[];         // Dependency Manager (R18)
  input: unknown; createdAt: string; updatedAt: string;
}

interface Decision {               // L1 output — validated, never trusted raw
  action: string; args: Record<string, unknown>;
  confidence: "high" | "low";      // low → policy forces class-C path (evidence-only)
  rationale: string; model: string; tokens: { in: number; out: number };
}

interface ToolSpec {
  name: string;                    // "posts.update" — namespaced, no bare model access
  scope: string[];                 // rows/fields touchable
  destructive: boolean;            // true → Approvals confirmation required (R7)
  dryRunSupported: boolean;
}

interface EvidencePack {           // append-only; the ONLY thing UI may render as proof
  runId: string; workerId: string; triggerKey: string;
  before: StateRef; after: StateRef;            // row ids + content hashes (what changed)
  decision: Decision; toolCalls: ToolCallReceipt[];
  verification: { method: string; ok: boolean; detail: string };
  costUsd: number; attempts: number; durationMs: number;
  terminalState: RunState; createdAt: string;
}

interface TraceSpan {              // one per pipeline stage (§2)
  runId: string; stage: "trigger"|"observe"|"decide"|"policy"|"act"|"verify"|"emit";
  startedAt: string; durationMs: number; ok: boolean; error?: string;
}
```

Lifecycle + contract enforcement: a worker whose contract is missing/fails schema validation is
never dispatched; a run that loses its trace spans mid-flight is downgraded to `unknown`.

---

## §4 — Workflow shapes (pick one per capability; R2)

| Shape | Skeleton | Use when |
|---|---|---|
| **Chaining + gates** | step → gate → step → gate → … | fixed-sequence work where a bad step must not propagate (pre-publish checks, KB draft→fact-check→publish) |
| **Routing** | classifier → one of N specialist paths | input determines which specialist handles it (content understanding → category pipeline) |
| **Parallelization (voting/sectioning)** | fan-out → aggregate/merge | independent subtasks or subjective votes (harassment multi-signal scoring, clustering sectioning) |
| **Orchestrator–workers** | central planner spawns bounded workers, aggregates | goal decomposes into dynamic subtasks (Delegation, incident response, red-team campaigns) |
| **Evaluator–optimizer** | generator → critic → refine loop (bounded) | quality bar exists and is judgeable (ranking tuning, drift repair, summary quality) |
| **Deterministic sweep** | cron → pure function → guarded mutation | no model needed at all (scheduler, PII regex masks, queue backlog drain) — **prefer this first** |

Selection rule (R2/R1 simulation-free): start at the bottom of the table; only move up when a
measured failure proves determinism insufficient. A deterministic sweep that works is a finished
worker, not a prototype.

---

## §5 — Governance (L3)

**Execution classes**
- **Class A — deterministic auto-act**: no model in the loop; pure function + guarded mutation.
  Examples: scheduler ticks, regex PII mask, backlog drain, poll close.
- **Class B — bounded act**: model decides (§3 `Decision`), L3 validates against contract
  (scope, caps, confidence), tool executes with caps enforced *by the tool handle*, not the model.
  `confidence: "low"` auto-demotes to class C.
- **Class C — evidence-only**: never mutates production state; produces evidence and an
  escalation into the Approvals queue (enforcement decisions, structural changes, red-team
  findings, child-safety edge cases).

**Cross-cutting controls**
- **Caps**: cost/attempts/duration enforced in L0/L3 (R11). Breach → `deferred` (requeue reason)
  or `quarantined` on repeated breach.
- **Approvals queue** (Reports tab 3): destructive tool calls and all class-C escalations land
  here with the evidence pack attached; a human confirms; execution re-enters the pipeline at ACT.
- **Watchdog**: reaps expired leases, tracks fault/verify-fail streaks, trips quarantine.
- **Quarantine**: worker stops dispatching; auditor (disable-test + evidence audit) clears it.
- **Disable test**: run on schedule; if "off 24h → X degrades" does not hold, the worker is a
  liability — flagged for removal (mirrors Workforce Auditor duties in WORKFORCE-50.md).

---

## §6 — Verification framework (L4 — how `success` is earned)

Independent verifier methods (contract picks ≥1, ordered by strength):

| ID | Method | Shape |
|---|---|---|
| **V1** | **Re-read**: verifier queries the mutated row/aggregate after commit and asserts the intended delta | strongest for DB state |
| **V2** | **Counterfactual**: verifier asserts a *control* that must NOT change stayed unchanged | catches over-broad tools |
| **V3** | **Side-channel**: independent observable — notify receipt, realtime broadcast ack, rendered UI fetch | when the state lives outside the DB |
| **V4** | **Metric delta**: expected measurable shift inside a time window (p95, backlog, error rate) | performance/ops workers |
| **V5** | **Replay idempotence**: same `triggerKey` re-dispatched → no second mutation | proves at-least-once safety |
| **V6** | **Spot check**: sampled human/LLM-judge review of subjective output, recorded in the pack | summaries, reports, classification audits |

Failure taxonomy (drives retry vs quarantine): `tool_error` · `policy_denied` · `budget_exceeded` ·
`timeout` · `verify_failed` · `verify_unknown`. `verify_failed`/`verify_unknown` streaks are the
primary quarantine trigger — a worker that repeatedly cannot prove its work is disabled first,
explained second.

Verifier independence rule: verification code lives in a different module from execution code and
re-queries through read paths the executor cannot write to (e.g., executor writes via RPC,
verifier reads via the client-facing query path).

---

## §7 — Tracing + UI (L5–L7: where work becomes visible)

- **Every run** → one evidence pack + a span per pipeline stage. Stored append-only; cost ledger
  sums from packs (never from worker self-reports).
- **Realtime (L6)** broadcasts run-terminal events so admin surfaces update without polling.
- **Proof UI rule**: a success indicator may only be rendered from a pack whose
  `verification.ok === true`; `unknown` renders distinctly (amber "UNVERIFIED"), `failed` red with
  the taxonomy reason, `deferred` neutral with the requeue reason. Never a generic spinner-as-proof.
- **Surfaces**:
  - `Overview` — metric strips, all fed by packs (slice 12 already wired status chips).
  - `Reports` (3 tabs: reports / review / approvals) — queue + subjective review + human gates.
  - `OpsCenter` — live run stream: spans, cost, attempts, quarantine state per worker.
  - Domain dashboards — per-domain KPIs, each cell drillable to the underlying packs.
- **Worker card** (admin): contract summary, lifecycle state, last 20 runs with terminal states,
  cost burn vs caps, disable-test result, quarantine status.

---

## §8 — Domain map (8 domains × 54 capabilities)

Legend — **Shape** (§4): DS=deterministic sweep, CH=chaining+gates, RT=routing, PA=parallel,
OW=orchestrator–workers, EO=evaluator–optimizer. **Class** (§5): A/B/C.
**Verify** (§6): V1–V6. Trigger: E=event, C=cron, M=manual/approval.
"Cap §41" = the capability's number owner in `CAPABILITIES-100.md`; worker IDs map to
`WORKFORCE-50.md` roster (gap = no worker yet → runbook item).

### 8.1 ORCHESTRATION (6) — L0 engine, deterministic by law

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| Event Engine | DS | A | E | V5 (replay) + span continuity | OpsCenter |
| Work Dispatcher | DS | A | E/C | V1 (queue rows consistent) | OpsCenter |
| Scheduler | DS | A | C | V4 (tick drift bound) | OpsCenter |
| Retry Engine | DS | A | E | V1 (attempt counts) | OpsCenter |
| Dependency Manager | DS | A | E | V2 (no premature dispatch) | OpsCenter |
| Watchdog | DS | A | C | V5 (leased-run reap replay) | OpsCenter |

### 8.2 TRUST & SAFETY (10)

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| Content Understanding | RT | B | E | V1 + V6 | Reports▸Review |
| Context/Slang | CH | B | E | V1 (decision row) + V6 | Reports▸Review |
| Harassment | PA | B/C | E | V1 + V6 | Reports▸Review |
| Threat Detection | CH | B→C | E | V1 + V3 (post hidden on read path) | Reports▸Approvals |
| PII Protection | DS | A | E/M | V1 + V2 (mask didn't alter meaning fields) | Reports▸Review |
| Child Safety | CH | C | E | V6 (human spot check mandatory) | Reports▸Approvals |
| Sexual Safety | CH | B→C | E | V1 + V3 | Reports▸Review |
| Scam/Fraud | PA | B/C | C | V1 + V4 (fraud rate delta) | Reports▸Review |
| Spam/Abuse | PA | A/B | E | V1 + V2 (legit posts unaffected) | Reports▸Review |
| Enforcement | CH | C | M | V1 + V6 (ladder applied once) | Reports▸Approvals |

### 8.3 COMMUNITY (6)

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| Duplicate Detection | PA | B | C | V1 (links created) + V6 precision sample | Reports▸Review |
| Issue Clustering | PA | B | C | V1 + V6 | Reports▸Review |
| Priority | DS+EO | B | C | V4 (time-to-first-response delta) | Reports |
| Case Lifecycle | CH | A/B | E/C | V1 (state advanced) + V2 (closed case reopens correctly) | Reports |
| Poll Operations | DS | A | C | V1 + V5 | Reports |
| Community Health | EO | B | C | V4 (health metrics) + V6 | Overview |

### 8.4 SEARCH & KNOWLEDGE (5)

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| Search | DS+CH | B | E/C | V4 (p95, zero-result rate) | Overview |
| Ranking | EO | B | C | V4 (rank-quality metric delta) | Overview |
| RAG | CH | B | E | V1 (answer cites retrievable sources) + V6 | Reports▸Review |
| Knowledge Updates | CH | B | E | V1 + V2 (stale entry actually replaced) | Reports▸Review |
| Zero-result Recovery | EO | B | C | V4 (zero-result rate delta) | Overview |

### 8.5 PLATFORM (7)

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| Database | DS | A/B | C | V4 (EXPLAIN/latency before-after) + V1 | Overview |
| Cache | DS | A | E | V4 (hit-rate delta) + V2 (correctness re-read) | Overview |
| Queue | DS | A | C | V4 (backlog depth) | OpsCenter |
| Realtime | DS | A | C | V3 (broadcast ack) | OpsCenter |
| Storage | DS | A | C | V1 (object/row counts reconcile) | Overview |
| Notifications | DS | A | E | V3 (delivery receipt) | Reports |
| Performance (load manager) | DS+EO | B | C | V4 (TARGET ENVELOPE §11) + V1 | Overview |

### 8.6 SECURITY (5)

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| Detection | PA | B | E/C | V1 (finding row) + V6 | OpsCenter |
| Authorization Testing | DS | A/C | C | V5 (probe replay) + V1 | OpsCenter |
| Abuse Detection | PA | B/C | E | V1 + V4 (abuse rate delta) | OpsCenter |
| Incident Response | OW | C | E/M | V3 (containment observable) + V1 | OpsCenter |
| Verification (meta) | DS | A | C | V5 (verifier self-tests) | OpsCenter |

### 8.7 QUALITY (7)

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| E2E QA | DS | A | C | V5 (suite replay) | OpsCenter |
| Mobile QA | DS | A | C | V5 | OpsCenter |
| Accessibility | DS | B | C | V1 (axe findings → fix rows) + V6 | OpsCenter |
| AI Evaluation | EO | B | C | V6 (judge agreement) + V1 | OpsCenter |
| Regression | DS | A | E | V5 | OpsCenter |
| Red Team | OW | C | C | V6 (finding reproduces) | OpsCenter |
| Drift | EO | B | C | V4 (distribution delta) + V6 | OpsCenter |

### 8.8 AI COWORKER (8) — the conversational edge of the same engine

Coworker turns (the full flow for each mode):

```
CHAT     user msg → intent route → [answer in-thread (class B, cited) | spawn WorkItem → §2 pipeline] → reply carries evidence ref
VOICE    record → server transcribe (`serverModerate` sees RAW text) → same as CHAT from intent onward
FILES    upload → scan (PII/harmful gates) → stored object + metadata row → evidence pack → inline preview
RESEARCH question → retrieve (RAG, cited) → draft with per-claim source links → V6 spot check → answer (UNKNOWN claims marked)
CODING   task → plan → diff → run gates (tsc/eslint/tests) as V5 verify → present patch, human merges (never auto-merge)
INVESTIGATION  question → read-only class C probes → findings + evidence links → NO mutation, explicitly labeled read-only
DELEGATION  coworker emits a WorkItem with contract target → §2 pipeline runs in worker domain → status streamed back in-thread
REPORTS  aggregation over evidence packs (never over worker self-reports) → Reports tabs + export
```

Rules: the coworker never gets a tool handle — it produces intents/WorkItems that enter L0 like
any other trigger (R5 holds at the conversational edge). Delegation uses orchestrator–workers;
handoff mode is used only for full-ownership transfers (enforcement→human) per R18.

| Capability | Shape | Class | Trigger | Verify | UI |
|---|---|---|---|---|---|
| Chat | RT | B | M/E | V1 (WorkItem created when action claimed) | Coworker panel |
| Voice | CH | B | M | V3 (transcript receipt) + V1 | Submit voice UI |
| Files | CH | A/B | M | V1 (object+row) + V2 (scan didn't alter file) | Coworker panel |
| Research | CH | B | M | V6 + cited-source V1 | Coworker panel |
| Coding | CH | B | M | V5 (gate suite green on diff) | Coworker panel |
| Investigation | DS | C | M | V1 (read receipts logged) | Coworker panel |
| Delegation | OW | B | M | V1 (child run terminal state) | Coworker + OpsCenter |
| Reports | DS | A | C/M | V1 (counts reconcile to packs) | Reports (3 tabs) |

**Roster gap note**: domains above are the *capability* map. Mapping each row to an existing
worker ID in `WORKFORCE-50.md` (or flagging GAP → new worker → contract → disable test) is a
runbook step per domain, executed when that domain's slices start.

### 8.9 Spec §7 system crosswalk (A–Q)

Spec §7's 17 systems and §8's 8 domains describe the same workforce at different grain.
Canonical, machine-checked copy: `api/_domain-map.js` — `validateDomainMap()` fails on any
missing/extra/renamed/uncited/unmapped key, with held-out tests in
`tests/api/domain-enrollment.test.ts`. Enrolled contracts: `api/_worker-contracts.js`.

| Spec §7 system | Primary §8 domain | Carrying §8 rows |
|---|---|---|
| A OPERATIONS | 8.1 ORCHESTRATION | Event Engine, Work Dispatcher, Scheduler, Retry Engine, Dependency Manager, Watchdog |
| B TRUST & SAFETY | 8.2 TRUST & SAFETY | Harassment, Threat Detection, PII Protection, Child Safety, Sexual Safety, Spam/Abuse, Enforcement |
| C CONTENT UNDERSTANDING | 8.2 TRUST & SAFETY | Content Understanding, Context/Slang |
| D COMMUNITY OPERATIONS | 8.3 COMMUNITY | Duplicate Detection, Issue Clustering, Priority, Poll Operations, Community Health |
| E CASE MANAGEMENT | 8.3 COMMUNITY | Case Lifecycle |
| F SEARCH & KNOWLEDGE | 8.4 SEARCH & KNOWLEDGE | Search, Ranking, RAG, Knowledge Updates, Zero-result Recovery |
| G DATABASE | 8.5 PLATFORM | Database |
| H PERFORMANCE | 8.5 PLATFORM | Performance (load manager) |
| I QUEUES | 8.5 PLATFORM | Queue (+ §8.1 Work Dispatcher/Retry/Dependency queue mechanics) |
| J NOTIFICATIONS | 8.5 PLATFORM | Notifications |
| K STORAGE | 8.5 PLATFORM | Storage |
| L REALTIME | 8.5 PLATFORM | Realtime |
| M SECURITY | 8.6 SECURITY | Detection, Authorization Testing, Abuse Detection, Incident Response, Verification (meta) |
| N QA | 8.7 QUALITY | E2E QA, Mobile QA, Accessibility |
| O AI QUALITY | 8.7 QUALITY | AI Evaluation, Red Team, Drift |
| P RELEASE & CHANGE | 8.7 QUALITY | Regression (golden journeys) |
| Q AUTONOMOUS COWORKER | 8.8 AI COWORKER | Chat, Voice, Files, Research, Coding, Investigation, Delegation, Reports |

Rule: exactly one primary domain per system (its §8 home rows); rows living in other domains
are cited in `_domain-map.js` `source`, never promoted to a second primary.

---

## §9 — Data model foundation (Supabase)

Core tables (names indicative; existing tables win on collision — reconcile, don't duplicate):

| Table | Purpose | Key columns |
|---|---|---|
| `worker_registry` | contracts, lifecycle, caps | id, domain, capability, class, contract_json, state, disable_test, created_at |
| `work_items` | durable queue | id, trigger_key (unique), worker_id, state, attempt, lease_until, dependency_ids, input |
| `run_spans` | trace | run_id, stage, started_at, duration_ms, ok, error |
| `evidence_packs` | append-only proof | run_id, before_ref, after_ref, decision_json, tool_receipts, verification_json, cost_usd, terminal_state |
| `approvals` | class-C/destructive gates | id, work_item_id, pack_id, status, decided_by, decided_at |
| `cost_ledger` | budget rollups | worker_id, day, cost_usd (derived from packs) |
| `quarantine_log` | watchdog actions | worker_id, reason, streak, cleared_by, cleared_at |

Indexes: `work_items(state, lease_until)`, `work_items(trigger_key)`,
`evidence_packs(worker_id, created_at)`, `run_spans(run_id)`.

---

## §10 — Orchestration loop (L0 detail)

1. **Triggers enter** three ways only: event (webhook/DB change), cron (scheduler table), manual
   (admin/coworker intent). All normalize to a `WorkItem` with `trigger_key`.
2. **Dispatcher** claims items: dependency check (Dependency Manager) → contract exists/enabled →
   not quarantined → caps remaining → lease with `lease_until` now + duration cap.
3. **Runner** executes §2 pipeline, emitting spans; heartbeats extend the lease.
4. **Retry Engine**: on `tool_error`/`timeout`/`verify_unknown` → backoff, attempt+1, ≤ attempts cap.
   `policy_denied`/`budget_exceeded` are terminal-defer (no blind retry).
5. **Watchdog** every tick: expired leases → requeue (attempt+1, V5-safe); verify-fail streak ≥ N →
   quarantine; cost breach → quarantine.
6. **Terminal** → pack persisted → realtime emit → UI renders strictly per §7.

Concurrency: worker-level parallelism bounded by dispatcher concurrency slots; per-worker at most
one in-flight run per `trigger_key` (idempotence).

---

## §11 — Performance envelope (TARGET ENVELOPE)

No performance claim exists without a measured run of: **500 concurrent users (representative
load), sustained DB utilization < 30% where meaningful, plus p95/p99 latency, error rate,
queue backlog, realtime latency, memory, CPU** — measured before AND after each optimization,
evidence-pack attached (V4). The load manager (Platform▸Performance) exists to make the site
smooth via *real* DB optimization (indexes, query plans, pooling) — every change carries an
EXPLAIN/before-after receipt. Simulated smoothness is a Law §0.5 violation.

---

## §13 — Delivery mapping (complements the runbook; does not modify it)

- Runbook (`.claude/plans/voicebox-workforce-loop.md`) = **what ships next, per slice**, one
  verified commit each.
- This framework = **what every slice must conform to**: contract registered, pipeline stages
  spanned, verifier chosen from §6, pack rendered in UI per §7, caps + watchdog wired, domain row
  in §8 updated from GAP→EXISTS with the worker ID.
- Slice gate (unchanged): unit/api/eslint green sequentially → stage slice files only → runbook
  updated → one commit.
- Domain rollout order: Trust & Safety → Community → Search & Knowledge → Platform → Security →
  Quality → AI Coworker → Orchestration polish (L0 hardening runs continuously underneath).

---

## §14 — R1–R20 compliance (pointer table; sources in RESEARCH-AGENT-SYSTEMS.md)

| Req | Summary | Enforced by |
|---|---|---|
| R1 | One engine, few primitives, workflows before agents | §1–§2 single pipeline; §4 shape table |
| R2 | Explicit workflows, no open-ended loops | §4; model only at L1 |
| R3 | Separate decision from execution | Law §0.4; §5 classes |
| R4 | Ground-truth observation per step | §2 OBSERVE; spans |
| R5 | Scoped, annotated, minimal tools | Law §0.7; `ToolSpec` §3 |
| R6 | Destructive actions confirmed | §5 Approvals |
| R7 | Hard caps: cost/attempts/duration | §5 caps; §10 retry rules |
| R8 | Independent verification ≠ self-report | Law §0.3; §6 V1–V6 |
| R9 | UNKNOWN ≠ SUCCESS | §2 terminal states |
| R10 | Durable queue, idempotent replay | §10; V5 |
| R11 | Watchdog + quarantine | §5; §10.5 |
| R12 | Disable test per worker | §5; worker_registry |
| R13 | Evidence packs, append-only | §3; §9 |
| R14 | Contract before dispatch | §3; §10.2 |
| R15 | Traces across all stages | §7 |
| R16 | UI renders proof only | §7 proof rule; Law §0.5 |
| R17 | Human gates for high-impact | §5 Approvals; Reports tab 3 |
| R18 | Orchestrator vs handoff chosen deliberately | §8.8 coworker rules |
| R19 | Deterministic fallback, no single model | Law §0.10 |
| R20 | Measured perf, no simulated dashboards | §11 TARGET ENVELOPE; Law §0.5 |
