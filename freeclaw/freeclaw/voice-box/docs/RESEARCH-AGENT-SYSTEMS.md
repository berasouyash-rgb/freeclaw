# Research: How Real Production Agent Systems Work

Primary-source research into how OpenAI, Anthropic, and Google actually build autonomous/automated agent systems that do real-world work — gathered before designing Voice Box's autonomous workforce framework.

**Method:** every claim below is linked to the official docs, first-party engineering posts, or official SDK documentation it comes from. Anything not verified from a primary source is marked UNVERIFIED or omitted.

**Date:** 2026-09-23

---

## 1. Executive summary — what all three labs share

1. **A tiny set of primitives, not a zoo of architectures.** OpenAI's Agents SDK deliberately ships only *agents, handoffs/agents-as-tools, and guardrails* on top of a loop — "few enough primitives to make it quick to learn" ([OpenAI Agents SDK Intro](https://openai.github.io/openai-agents-python/)). Anthropic: "the most successful implementations use simple, composable patterns rather than complex frameworks" ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)).
2. **Workflows ≠ agents — and labs say use the simplest thing that works.** Anthropic draws an explicit architectural line: *workflows* = LLMs orchestrated through predefined code paths; *agents* = LLMs dynamically direct their own process and tool usage ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)). "Find the simplest solution possible, and only increase complexity when needed."
3. **The canonical loop is: model ⇄ tools, grounded on real environment feedback at every step.** Anthropic: during execution "it's crucial for the agents to gain 'ground truth' from the environment at each step (such as tool call results or code execution) to assess its progress" ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)).
4. **The model never touches the world directly — a deterministic tool layer does.** Tools are "a contract between deterministic systems and non-deterministic agents" ([Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)); OpenAI SDK executes function tools in code with Pydantic validation ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)).
5. **Guardrails run in parallel and fail fast.** OpenAI: guardrails "run input validation and safety checks in parallel with agent execution, and fail fast when checks do not pass" ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)).
6. **Human-in-the-loop and confirmation for impact.** OpenAI ships built-in human-in-the-loop mechanisms ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)); Google ADK ships **action confirmations** for function tools and a dedicated Safety & Security area ([ADK components](https://google.github.io/adk-docs/runtime/)).
7. **Durable state + resumable execution are first-class.** OpenAI: *sessions* = "a persistent memory layer for maintaining working context within an agent loop" ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)); Google ADK: sessions/state/events/memory, an event loop with a **yield/pause/resume** cycle, and **resume agents** ([ADK Agent Runtime](https://google.github.io/adk-docs/runtime/)).
8. **Tracing/observability ships in the box.** OpenAI Agents SDK has built-in tracing "to visualize and debug agentic flows, as well as evaluate them" ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)); Google ADK ships Logging/Metrics/Traces observability ([ADK docs nav](https://google.github.io/adk-docs/runtime/)).
9. **Verification is external to the model.** Anthropic: coding agents work because "code solutions are verifiable through automated tests" and "agents can iterate on solutions using test results as feedback" ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)); their tool-eval method pairs every task "with a verifiable response or outcome" ([Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).
10. **Evaluation is a required production component, not an afterthought.** Google ADK has a full Evaluation section (criteria, user simulation, environment simulation, custom metrics, optimization) plus Safety/Security ([ADK docs nav](https://google.github.io/adk-docs/runtime/)); OpenAI's tracing feeds "evaluation, fine-tuning, and distillation tools" ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)).

---

## 2. Anthropic — architecture, patterns, verification

**Source:** [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Dec 2024; the post now notes the tooling landscape has changed and points to *Claude Managed Agents* + [Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview) for their current approach — the pattern taxonomy below remains the foundational engineering guidance).

### The distinction
- **Agentic systems** split into **workflows** ("LLMs and tools orchestrated through predefined code paths") and **agents** ("LLMs dynamically direct their own processes and tool usage").
- Workflow patterns catalog (each with an explicit "when to use"):
  1. **Prompt chaining** — sequential steps with **programmatic gates** between calls ("ensure that the process is still on track").
  2. **Routing** — classify input → specialized follow-up; separates concerns.
  3. **Parallelization** — *sectioning* (independent subtasks) and *voting* (same task, many calls, aggregate).
  4. **Orchestrator-workers** — central LLM dynamically decomposes and delegates; synthesis at the end. "Subtasks aren't pre-defined, but determined by the orchestrator."
  5. **Evaluator-optimizer** — one LLM generates, another evaluates in a loop against clear evaluation criteria.
- **Agents** = "typically just LLMs using tools based on environmental feedback in a loop." Crucial controls:
  - gain **ground truth from the environment at each step** (tool results, code execution),
  - **pause for human feedback at checkpoints or blockers**,
  - **stopping conditions** ("such as a maximum number of iterations") to maintain control,
  - **extensive testing in sandboxed environments** with guardrails, because autonomy means "higher costs, and the potential for compounding errors."

### When NOT to use agents
- "Often the answer is don't build agentic systems at all… optimizing single LLM calls with retrieval and in-context examples is usually enough."
- Frameworks "can create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug."
- Three principles: **simplicity**, **transparency** (explicitly show planning steps), **carefully crafted agent-computer interface (ACI)**.

### Tool design (Appendix 2 of the post + [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents))
- Invest as much in the **ACI** as in the HCI. Tools need descriptions with example usage, edge cases, input formats, boundaries vs other tools.
- **Poka-yoke your tools** — make wrong calls structurally hard. Example: they forced **absolute filepaths** after the model misused relative paths, and "found that the model used this method flawlessly."
- SWE-bench time was spent "more time optimizing our tools than the overall prompt."
- From the tools post:
  - **Choose tools for agent affordances, not API shape.** Don't wrap existing endpoints blindly. Replace `list_users`/`list_events`/`create_event` with `schedule_event`; `read_logs` → `search_logs`; `get_customer_by_id`+`list_transactions`+`list_notes` → `get_customer_context`. Prefer "a few thoughtful tools targeting specific high-impact workflows."
  - **Namespacing** (`asana_search`, `jira_search`) delineates boundaries across hundreds of tools.
  - **Return meaningful context**: high-signal, natural-language fields beat `uuid`/`mime_type`; resolving UUIDs to meaningful names "significantly improves… precision in retrieval tasks by reducing hallucinations."
  - **Token efficiency**: pagination/filter/truncation with sane defaults (Claude Code caps tool responses at 25,000 tokens); error responses should be "specific and actionable," not opaque codes/tracebacks.
  - **Prompt-engineer descriptions** like onboarding docs for a new hire; unambiguous parameter names (`user_id`, not `user`). "Even small refinements can yield dramatic improvements."
  - **MCP tool annotations** "help disclose which tools require open-world access or make destructive changes" ([MCP spec: tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).

### Verification & evaluation
- Grounded in their own agent work: **coding agents succeed because automated tests make outputs verifiable**; human review still required for broader alignment ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)).
- Tool-eval method ([Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)):
  - Generate eval tasks "grounded in real world uses"; avoid "overly simplistic or superficial sandbox environments."
  - **Every prompt must be paired with a verifiable response or outcome** — from exact string match up to model-judging. "Avoid overly strict verifiers that reject correct responses due to spurious differences."
  - Run evals as **simple agentic loops** (`while`-loops wrapping alternating LLM API and tool calls), one per task.
  - Collect not just accuracy: **runtime per tool call, total tool calls, token consumption, tool errors.**
  - Use **held-out test sets** to avoid overfitting; "what agents omit in their feedback… can often be more important than what they include" — read raw transcripts, not just stated reasoning.

---

## 3. OpenAI — architecture (Agents SDK / Responses API)

**Source:** [OpenAI Agents SDK documentation](https://openai.github.io/openai-agents-python/)

- **Positioning:** production upgrade of Swarm; "a lightweight, easy-to-use package with very few abstractions." Two design principles: *(1) enough features to be worth using, but few enough primitives to make it quick to learn; (2) works great out of the box, but you can customize exactly what happens.*
- **The three primitives:** **Agents** (LLM + instructions + tools, "built-in loop that continues until the task is complete"), **Agents-as-tools / Handoffs** (delegate to other agents), **Guardrails** (validate inputs and outputs, fail fast).
- **SDK vs raw API rule:** use the **Responses API directly** when "you want to own the loop, tool dispatch, and state handling yourself" and the workflow is short-lived; use the **SDK** when "the runtime should manage turns, tool execution, guardrails, handoffs, or sessions," or the agent "should produce artifacts or operate across multiple coordinated steps." Both coexist in one app.
- **Tools:** function tools = any Python function with automatic schema generation + Pydantic-powered validation; MCP tool calling built in; **tool guardrails** are a distinct ref-level concept; **tool output trimmer** extension exists for context control.
- **Orchestration:** two supported modes — **handoffs** (agent→agent transfer) and **agents-as-tools / manager-style orchestration**, with a dedicated *Agent orchestration* page to choose between them; handoff filters shape what transfers.
- **Guardrails:** input validation + safety checks run **in parallel** with agent execution → fail fast.
- **Human-in-the-loop:** "built-in mechanisms for involving humans during agent runs" (dedicated docs section).
- **Sessions / memory:** persistent memory layer for working context inside the loop; pluggable session backends (SQLAlchemy, SQLite, encrypted, Redis, MongoDB, Dapr) → durable, inspectable state.
- **Sandbox agents:** "run specialists inside real isolated workspaces" with **manifest-defined files, sandbox client selection, resumable sandbox sessions**; ref includes **Permissions**, **Capabilities** (filesystem/shell/memory/skills/compaction), **snapshots** → isolation + least privilege + checkpoint/resume.
- **Results/lifecycle:** first-class *Results* (outputs, run items, interruptions, resume state), *Run error handlers*, *Lifecycle* hooks, *Run config/state*.
- **Tracing:** built-in; visualize/debug/evaluate flows; feeds OpenAI's evaluation, fine-tuning, and distillation tooling.
- **Testing:** first-class "Testing" section + `ref/testing` — agents are tested infrastructure, not demos.

---

## 4. Google — architecture (ADK, runtime, A2A)

**Sources:** [ADK home](https://google.github.io/adk-docs/), [ADK Agent Runtime](https://google.github.io/adk-docs/runtime/)

- **Framing:** "Build production agents, not prototypes… reliable AI agents at enterprise scale," open-source, five languages (Python, TypeScript, Go, Java, Kotlin).
- **Graph workflows (ADK 2.0):** "Weave deterministic code with adaptive AI reasoning… structured, graph-based architectures, **with explicit execution paths and predictable outcomes**" — i.e., deterministic control flow *around* model decisions, exactly Anthropic's workflow concept, productized ([ADK home](https://google.github.io/adk-docs/)).
- **Multi-agent building blocks:** sequential / loop / parallel **template workflow agents**, agent routing, collaborative workflows, workflow patterns ([ADK nav](https://google.github.io/adk-docs/runtime/)).
- **Runtime:**
  - **Event loop** with a **yield/pause/resume cycle**; **Resume Agents** ("resume agent execution from a previous state"); **Cancel** via AbortSignal; **RunConfig** for runtime configuration.
  - **Ambient Agents:** "autonomous agents that process events, monitor systems, and respond asynchronously without human intervention" — the event-driven 24/7 worker model ([ADK runtime](https://google.github.io/adk-docs/runtime/)).
  - **API server / dev UI / CLI** run modes + deployment targets (Cloud Run, GKE, managed Agent Runtime).
- **State & context:** Sessions, State, Events, Memory, **context compression (compaction)**, **model context caching**, session rewind/migrate — durable conversational + workflow state with explicit lifecycle.
- **Tools:** function tools, **MCP tools**, **OpenAPI tools**, auth handling, a **Tool limitations** page, tool performance page, and **Action confirmations** — user confirmation required before a function tool executes its action ([ADK components](https://google.github.io/adk-docs/runtime/)).
- **Callbacks & plugins:** before/after callbacks as policy hooks (e.g., gate or log every action in deterministic code).
- **Observability:** first-class Logging, Metrics, Traces pages.
- **Evaluation:** Criteria, **User Simulation**, **Environment Simulation**, Custom Metrics, Optimization — including simulating the *environment* to test side effects.
- **Safety:** dedicated Safety & Security section; guardrails also appear under Live/voice production docs.
- **Cross-agent & cross-org:** **A2A Protocol** (agent-to-agent) — expose/consume agents over a standard protocol with extensions ([ADK nav](https://google.github.io/adk-docs/runtime/)).
- **MCP support:** first-class (see §5).

---

## 5. Cross-cutting production patterns

| Pattern | Labs | Source | Voice Box application |
|---|---|---|---|
| Predefined **workflow** (chaining w/ gates, routing, parallel, orchestrator-workers, evaluator-optimizer) before free-form agents | Anthropic | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Each of the ~56 roles gets a fixed pipeline shape chosen from this catalog — not an ad-hoc loop |
| Single loop: model ⇄ tools, **ground truth each step** | Anthropic/OpenAI/Google | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | One canonical engine; worker must re-read DB state via `verify()`, never self-report |
| **Model decision ≠ execution**: deterministic tool layer with validation | Anthropic/OpenAI/Google | [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents), [SDK](https://openai.github.io/openai-agents-python/) | AI outputs a structured decision; Action Executor + Policy/Permission engines perform the write |
| **Guardrails fail fast**, run in parallel | OpenAI | [SDK intro](https://openai.github.io/openai-agents-python/) | Pre-publish moderation + policy engine gate every action before execution |
| **Human-in-the-loop / action confirmations** for impact | OpenAI/Google | [SDK](https://openai.github.io/openai-agents-python/), [ADK components](https://google.github.io/adk-docs/runtime/) | High-risk actions (ban/delete/blast) queue for admin approval — already the Approvals tab |
| **Tool annotations** disclose destructive / open-world tools; **namespaced** tools | Anthropic/MCP | [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | Tool Registry entries carry `destructive: bool`, scope, and `vb.*` namespace |
| **Few, ergonomic, high-signal tools** — consolidate endpoints into workflow-shaped tools | Anthropic | [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | Tool Registry curated: `moderate_comment`, `optimize_indexes`, `resolve_report` — not raw CRUD |
| **Sandboxed execution / permissions / capabilities** | OpenAI | [SDK sandbox agents](https://openai.github.io/openai-agents-python/) | Workers run in a sandboxed context; per-worker scoped credentials, no arbitrary DB write |
| **Durable sessions + yield/pause/resume + ambient event-driven agents** | OpenAI/Google | [SDK sessions](https://openai.github.io/openai-agents-python/), [ADK runtime](https://google.github.io/adk-docs/runtime/) | Durable Work Queue + Event Engine; crash-resumable work items with state machine |
| **Built-in tracing → evidence** | OpenAI/Google | [SDK tracing](https://openai.github.io/openai-agents-python/), [ADK observability](https://google.github.io/adk-docs/runtime/) | Worker Trace + Evidence Store: every action spans tool call, result, verification, cost |
| **Verifiable outcomes** (tests as verifiers; every eval task paired with verifiable response) | Anthropic | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | `UNKNOWN ≠ SUCCESS`; verification = independent re-read of system state |
| **Evaluator-optimizer / voting** for quality | Anthropic | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Quality workers re-score peers' output; votes across models |
| **Model-graded + simulation evaluation** with held-out sets | Anthropic/Google | [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents), [ADK evaluate](https://google.github.io/adk-docs/runtime/) | Continuous eval harness for every worker contract; regression suite before enabling |
| **Metrics beyond accuracy**: tool-call runtime, call counts, tokens, tool errors | Anthropic | [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | Cost Governor + Metrics Engine: per-worker latency/token/error budgets |
| **Stopping conditions** (max iterations) + error handlers + lifecycle hooks | Anthropic/OpenAI | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [SDK](https://openai.github.io/openai-agents-python/) | Attempt caps, cost caps, watchdog, quarantine |
| **Multi-model, no single-provider dependency** | Google (all) | [ADK models nav](https://google.github.io/adk-docs/runtime/) | Provider abstraction with fallback chain (already required by spec §3) |
| **MCP-standard tool integration** (supported by Claude, ChatGPT, VS Code, Cursor) | All | [MCP intro](https://modelcontextprotocol.io/docs/getting-started/intro) | Tool Registry shaped MCP-compatible so tools stay portable & annotated |
| **Deterministic graph paths around AI decisions** | Google | [ADK home](https://google.github.io/adk-docs/) | Trigger→observe→decide→act→verify is fixed code; only "decide" is a model call |
| **Transparency: show the plan/trace** | Anthropic | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Admin UI renders the real Worker Trace (steps, tools, verify result), not a status badge |

---

## 6. Warnings and failure modes (what the labs say NOT to do)

1. **Don't build agents when a single call + retrieval works.** Complexity must "demonstrably improve outcomes" ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)).
2. **Compounding errors & cost.** Autonomy → "higher costs, and the potential for compounding errors"; require sandboxed testing + guardrails + **stopping conditions** like max iterations ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)).
3. **Framework abstraction hides the truth.** Extra layers "obscure the underlying prompts and responses, making them harder to debug" — "incorrect assumptions about what's under the hood are a common source of customer error" ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)).
4. **Models hallucinate tool use.** An agent "might hallucinate or even fail to grasp how to use a tool"; they may "call the wrong tools, call the right tools with the wrong parameters, call too few tools, or process tool responses incorrectly" ([Anthropic, Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)).
5. **Raw API-wrapped tools are a common error.** "Tools that merely wrap existing software functionality or API endpoints" mismatch agent affordances and burn context ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)).
6. **Opaque errors and low-signal returns derail agents.** Opaque error codes/tracebacks should be replaced with actionable messages; cryptic IDs induce hallucination ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)).
7. **Superficial evals lie.** "Avoid overly simplistic or superficial sandbox environments"; pair every task with a verifiable outcome; use held-out sets; don't overfit; don't build verifiers so strict they reject correct answers ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)).
8. **Agents' self-reports are not evidence.** "What agents omit in their feedback… can often be more important than what they include… LLMs don't always say what they mean" — read raw transcripts/system state instead ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)).
9. **Destructive/open-world tools must be disclosed up front** — MCP tool annotations exist precisely so clients can see which tools are destructive ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents) → [MCP spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).
10. **Too many overlapping tools distract agents.** Selective, namespaced tool design measurably reduces mistakes ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)).
11. **The labs' guidance evolves — anchor to patterns, pin versions.** Anthropic's 2024 post itself redirects to *Managed Agents* for current tooling; Google ships breaking-shape changes (ADK 2.0 graphs). Version-pin and re-verify ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)).

---

## 7. Framework requirements checklist for Voice Box's autonomous workforce

Every requirement grounded in a source above.

**Engine (§4/§5 of the workforce spec)**
- [ ] **R1 — One canonical engine**, few primitives (loop, tools, guardrails, handoffs) — *OpenAI "few enough primitives"; Anthropic "simple, composable patterns"* ([SDK](https://openai.github.io/openai-agents-python/), [Anthropic](https://www.anthropic.com/engineering/building-effective-agents)).
- [ ] **R2 — Fixed workflow shapes first** (chaining-gates / routing / parallel / orchestrator-worker / evaluator-optimizer), free-form agent only when steps are unpredictable — *Anthropic workflow catalog* ([link](https://www.anthropic.com/engineering/building-effective-agents)).
- [ ] **R3 — Deterministic control flow around model calls**; only "decide" is probabilistic — *Google graph workflows "explicit execution paths and predictable outcomes"* ([link](https://google.github.io/adk-docs/)).
- [ ] **R4 — Ground truth every step**: worker re-reads system state; self-report is an input, never proof — *Anthropic "gain ground truth from the environment at each step"* ([link](https://www.anthropic.com/engineering/building-effective-agents)).

**Tools & permissions**
- [ ] **R5 — Decision/execution separation**: model emits structured decision; policy+permission engines gate; executor performs the write — *OWASP-style least privilege as restated by the labs' confirmation/permission models* ([ADK action confirmations](https://google.github.io/adk-docs/runtime/)).
- [ ] **R6 — Curated, namespaced, workflow-shaped tools** with `destructive` annotations; no raw CRUD exposure — *Anthropic tool principles + MCP annotations* ([link](https://www.anthropic.com/engineering/writing-tools-for-agents)).
- [ ] **R7 — Action confirmations / approvals for high-impact actions** — *OpenAI human-in-the-loop, Google action confirmations* ([SDK](https://openai.github.io/openai-agents-python/)).
- [ ] **R8 — Tool responses return high-signal context, token-budgeted, actionable errors** — *Anthropic* ([link](https://www.anthropic.com/engineering/writing-tools-for-agents)).

**Execution & durability**
- [ ] **R9 — Durable queue + state machine with yield/pause/resume**; crash-resumable work items — *OpenAI sessions, ADK event loop/resume* ([SDK](https://openai.github.io/openai-agents-python/), [ADK](https://google.github.io/adk-docs/runtime/)).
- [ ] **R10 — Ambient event-driven workers** for 24/7 operation — *ADK ambient agents* ([link](https://google.github.io/adk-docs/runtime/)).
- [ ] **R11 — Stopping conditions**: attempt caps, cost caps, watchdog, quarantine — *Anthropic "stopping conditions… maximum number of iterations"* ([link](https://www.anthropic.com/engineering/building-effective-agents)).
- [ ] **R12 — Isolated execution context per worker** (scoped credentials, sandboxed capabilities) — *OpenAI sandbox agents manifest/permissions/capabilities* ([link](https://openai.github.io/openai-agents-python/)).

**Verification, evaluation, evidence**
- [ ] **R13 — Independent verification from system state; `UNKNOWN` ≠ success** — *Anthropic verifiable outcomes; tests-as-verifiers* ([link](https://www.anthropic.com/engineering/building-effective-agents)).
- [ ] **R14 — Every worker has a contract + held-out eval** with verifiable expected outcomes; run as simple agentic loops — *Anthropic tool-eval method* ([link](https://www.anthropic.com/engineering/writing-tools-for-agents)).
- [ ] **R15 — Tracing on by default → Evidence Store** (spans: trigger, decision, tool call, result, verification, tokens/cost) — *OpenAI built-in tracing, ADK traces* ([SDK](https://openai.github.io/openai-agents-python/)).
- [ ] **R16 — Measure more than pass/fail**: runtime, call counts, tokens, error rates per worker — *Anthropic eval metrics* ([link](https://www.anthropic.com/engineering/writing-tools-for-agents)).
- [ ] **R17 — Guardrails run in parallel and fail fast**; moderation gates inputs AND outputs — *OpenAI guardrails* ([link](https://openai.github.io/openai-agents-python/)).

**Multi-agent & UI**
- [ ] **R18 — Two orchestration modes only**: handoff (specialist takes over) vs orchestrator-as-tool (manager delegates); pick per workflow — *OpenAI orchestration, Anthropic orchestrator-workers* ([SDK](https://openai.github.io/openai-agents-python/)).
- [ ] **R19 — Transparency**: admin UI renders the real trace/plan/evidence pack, never a self-reported badge — *Anthropic principle "transparency"* ([link](https://www.anthropic.com/engineering/building-effective-agents)).
- [ ] **R20 — Provider abstraction** across models/languages; no single-model dependency — *Google multi-model support* ([ADK nav](https://google.github.io/adk-docs/runtime/)).

---

*Next step: design the Voice Box full flow / foundation / framework directly against R1–R20, mapping each requirement onto concrete modules (Event Bus, Work Queue, Tool Registry, Policy/Permission, Executor, Verification, Evidence, Trace, Watchdog, Cost Governor, Eval Harness, Realtime UI).*
