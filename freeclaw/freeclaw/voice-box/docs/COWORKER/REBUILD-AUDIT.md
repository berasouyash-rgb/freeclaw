# VoiceFlow AI Coworker — Engineering Recovery Audit

Status date: 2026-11-16. This document is deliberately blunt. A feature is
**Working** only when a real handler, real data and a real artifact were
observed. "The build passed" is not evidence of a working feature.

---

## 1. Root cause of "the tool ran but I got no output"

Confirmed in source, not inferred:

1. The chat handler had a **private `executeTool` switch** with its own tool
   set, different from `_agent-tool-registry.js`. The registry (validation,
   permissions, retries, audit, evidence) was dead code on the chat path.
2. The provider layer had **no native tool calling**. `openaiCompat.buildBody`
   sent only `{model, max_tokens, temperature, messages}`; `parseResponse`
   returned only `message.content`. There was no `tools`, `tool_choice` or
   `tool_calls` handling anywhere.
3. The protocol was **prose-JSON** (`parseAgentResponse`). A model answering
   in plain prose produced `reply: ""` and `actions: []`.
4. A **silent INTENT/DB fallback** then answered a *different* question with
   pattern-matched queries and no disclosure.
5. `AUTO_EXEC_TOOLS` contained `execute_sql`, `list_tables`, `describe_table`,
   `generate_html` — SQL was the model's primary capability.
6. Tool results were raw payloads with **no standard contract**. `rows` was
   never populated on the chat path, so the client's Excel/PDF export was dead.
7. Writes reported `success: true` from the tool's return value alone —
   **no read-back verification**.

---

## 2. What was changed in this recovery

| Change | File(s) |
|---|---|
| New tool runtime: manifest (`name`, WHEN-to-use, `inputSchema`, `side_effect`, `risk`, `roles`, `idempotent`, `timeout_ms`), pre-validation, standard result (`status/summary/data/artifacts/next_actions/error/meta`), read-back verification for every write | `api/_agent-runtime.js` (new) |
| Extracted the SELECT-only gate + interpreter so the registry and runtime share it without an import cycle | `api/_agent-sql.js` (new) |
| Deleted ~3,600 lines: intent engine, pattern-matched DB fallback, duplicate SQL interpreter, private tool switch, prose synthesiser | `api/_agent-chat.js` |
| Rebuilt the chat turn as a bounded ReAct loop: native tool calls → execute reads → real rows fed back → re-plan → answer; writes stay approval cards | `api/_agent-chat.js` |
| Added native function calling with a 400-on-tools fallback to non-tool body, and `toolCalls` in `callLLMChain` results | `api/_providers.js` |
| Reconciled the tool vocabulary: added `delete_post`, `feature_post`, `set_eta`, `assign_post`, `bulk_update`, `close_poll`, `get_settings` to the audited registry | `api/_agent-tool-registry.js` |
| Removed SQL/self-extension tools from the model's action space; `action:"tools"` exposes the real manifest | `api/_agent-chat.js`, `api/_agent-runtime.js` |
| Rewrote the companion: real trace rows, verified-write copy, voice controls, state machine | `src/pages/admin/buddy/BuddyPet.tsx` |
| Official Spline viewer `@splinetool/viewer@2.0.184`, configurable scene, 9 real states, SVG fallback, no GLB substitute | `src/pages/admin/buddy/SplinePet.tsx` |
| Replaced fake computer-use animation with an honest adapter contract and "not connected" status | `src/lib/coworker/computer-use.ts` (new), `src/components/coworker/workspaces/ComputerUseWorkspace.tsx` |
| Removed the unrelated GLB robot used as a character in the second coworker surface | `src/components/coworker/SplineCoworker.tsx` |
| Rewrote the stale SQL tests to assert the new contract; updated chat tests to native tool calls | `tests/api/agent-chat-*.test.ts`, `tests/setup.ts` |

---

## 3. Honest feature audit

| Requested feature | Classification | Evidence / limitation |
|---|---|---|
| Connected AI model, real responses, follow-up context | **Working** | `callLLMChain` from the 20 s budget with last-20 history messages; 503 `model_unavailable` instead of a fallback |
| Streaming text | **Missing** | `callProviderStream` exists in `_providers.js` but is not wired to the chat route. The reply arrives as one completed message |
| Stop generation | **Partial** | The client can cancel speech/listening and discard a late response via a generation counter; the in-flight HTTP request cannot be aborted (`api.postAgent` has no signal) |
| Conversation history / persistence | **Working** | `agent_conversations` read + write on the chat path; `history`/`sessions` actions |
| Message editing | **Missing** | No edit-and-resend control |
| Retry / loading / error handling | **Working** | Retry keeps the question; failure card; generation guard |
| Voice input/output | **Working (client)** | Shared `useCoworkerVoice` wired into Buddy with mic + mute + speaking state; browser autoplay rules still require a user gesture |
| Native tool calling, registry, schemas, validation, permissions | **Working** | Manifest → `tools` → `toolCalls` → registry → `validateParams` + role check → audit + evidence |
| Multi-step execution | **Partial** | Bounded to 2 ReAct rounds; deeper chains stop after the second observation |
| Result verification / execution logs | **Working** | Read-back of the re-read row for writes; `tool_calls`/`tool_evidence` audit |
| SQL not the user experience | **Working** | `execute_sql` and self-extension tools excluded; no SQL editor or Run button in `src` |
| Spline character, official viewer, configurable URL | **Working (integration)**; **Blocked (scene)** | Viewer loaded lazily with the exact supplied URL; scene value is still `not-exported-yet`, so the SVG fallback renders |
| Character states tied to real events | **Working** | `data-agent-state` + `voiceflow:agent-state` driven by request/tool/verification outcomes |
| Idle/listening/thinking/speaking/researching/working/computer-use/success/error | **Working as derived states** | State labels in `SplinePet.tsx`; the published Spline scene's own animation states cannot be driven until the scene is exported |
| Computer use | **Blocked by external dependency** | No authorized runtime. Adapter contract + honest "not connected" panel shipped; fake actions and random cursor removed |
| Proactive briefing from real data | **Partial** | Real DB detection in `_proactive.js` and real persisted briefing in `_briefing.js`; agent-cron is **not scheduled** (Hobby allows only 2 crons, both already used) |
| Workspace surfaces | **Working (shells)** | Report/Presentation/Investigation/Task/Conversation/ComputerUse exist; Investigation is still a shell |
| Real XLSX/PDF from live rows | **Working** | `src/lib/coworker/{xlsx,pdf,export}.ts` write real OOXML/PDF; chat rows feed them |
| Real PPTX generation + download | **Working** | `PptxGen` in `PresentationWorkspace.tsx`, `src/lib/deckExport.ts`, e2e coverage |
| Presentation persistence / reopen / history | **Missing** | Generate → download only; nothing survives reload |
| Reports with tables/charts/explanations | **Working** | `_report-deck.js` builds deterministic specs from live rows |
| Security (admin gates, role checks, SQL allowlist) | **Working** | `protect()` on agent routes; registry role + schema checks; SELECT-only gate |
| Test suite | **Working** | See measured results below |

---

## 4. Measured verification (commands actually run)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json --incremental false` | clean |
| Focused frontend tests | `node --max-old-space-size=4096 ./scripts/vitest-run.mjs run src/pages/admin/buddy/ src/lib/coworker/` | 6 files, **164 tests passed** |
| Full API tests | `node --max-old-space-size=4096 ./scripts/vitest-run.mjs run --config vitest.config.api.ts tests/api/` | 239 files, **2664 tests passed** |
| Production build | `npm run build` | clean, 2845 modules, `Admin-BjFKTHKs.js` 175 kB |
| Bundle scan | `node D:\Temp\opencode\scan-dist-coworker.mjs dist` | state/event/voice markers present; **no stale GLB/model-viewer default** |
| Playwright (direct Chromium) | `node D:\Temp\opencode\pw-verify.mjs` against `vite preview` | public `/` → HTTP 200, title correct; `/admin` → HTTP 200 password gate; console warnings: duplicate Three.js, 404s from **API routes absent in static preview**, heartbeat/announcement fallback warnings |

### Playwright limitation — stated plainly
The Playwright MCP server was locked by another session (`Browser is already in
use … use --isolated`). I drove `@playwright/test` directly against installed
Chrome instead. The static `vite preview` has no Vercel function routes, so API
404s there are expected and are **not** proof of a production defect. The admin
area is password-gated and needs a DB-backed session, so the Buddy dialog could
not be exercised in a real browser in this environment. That workflow is
**not verified in-browser**; it is covered by jsdom component tests and the
API contract tests only.

### Known unrelated failure
`src/__tests__/AppContextCore.test.tsx` → "throws when useApp is used outside
the provider" fails (expected throw, received `undefined`). 34/35 in that file
pass. This test was not touched in this recovery.

### Tests explicitly performed against the required workflow list
1. Normal message → real AI response: API test with native tool call + grounded reply — **pass** (mocked provider, real registry execution).
2. Follow-up context: handler passes last-20 history to `callLLMChain` — **code-verified**, not a live-provider test.
3. Invoke a registered tool: `get_analytics` executed through registry — **pass**.
4. Receive real tool result: rows returned and asserted — **pass**.
5. Multi-step workflow: 2-round loop asserted — **pass (bounded)**.
6. Failed tool call: `tool_not_available` / honest error asserted — **pass**.
7. Verify an admin operation: read-back verification implemented; **not** end-to-end tested against the live DB (no write executed against production).
8. Load Spline scene when URL provided: **not testable** — no exported URL; fallback asserted in jsdom.
9. Real AI states in character: `data-agent-state` + event dispatch asserted in bundle and component tests.
10. Voice interaction: hook wired and constructible; **not** tested with a real microphone/speaker.
11. Connected computer-use runtime: **blocked** — no runtime; adapter status asserted.
12. Download a real presentation: existing e2e test exists; **not re-run in this recovery**.
13. Report from real data: existing report-deck + export tests in the API suite — **pass**.
14. Proactive briefing on real activity: real detectors exist; **not scheduled**, so no live briefing test.
15. Unauthorized operations: existing admin-gate suite passes (**2664 API tests**).

---

## 5. Blocked by external dependency (no fabrication)

- **Your Spline scene URL** is still `not-exported-yet`. Set
  `VITE_SPLINE_PET_URL=https://my.spline.design/<slug>/embed`. Until then the
  SVG fallback shows; no other avatar is substituted.
- **Computer-use runtime**: no authorized browser-control runtime is connected.
  Register one through `registerComputerUseAdapter()`; until then Buddy states
  "not connected" and performs no simulated actions.
- **Admin in-browser verification**: requires a DB-backed admin session and the
  deployed function routes, neither available in static preview.
- **Android `google-services.json` for `app.voicebox`** and **Firebase service
  account credentials** remain absent; no credentials were invented.
- **Independent control-plane store** (Upstash/Redis REST) credentials absent;
  memory fallback is test-only.
- **Release signing identity** for the APK absent; current APK is debug-signed.

---

## 6. NVIDIA-grounded rebuild blueprint (all catalog skills already installed)

Live catalog check (`npx -y skills add nvidia/skills --list` + raw
`skills.sh.json`, Agentic AI grouping) confirmed the following. **No installs
were performed** — installing requires your explicit approval.

| Rebuild concern | NVIDIA skill lane | Use |
|---|---|---|
| Typed tool/adapter contract | `nemo-fabric-build-adapter`, `nemo-fabric-integrate` | The same adapter discipline used for the computer-use boundary and tool registry |
| Instrumentation, traces, typed wrappers | `nemo-relay-instrument-calls`, `nemo-relay-instrument-typed-wrappers`, `nemo-relay-plugin-observability` | Structured tool traces and state events |
| Retrieval, quality gates, performance gates | `rag-blueprint`, `rag-eval`, `rag-perf` | Knowledge-base answers with measured quality/latency gates |
| Structured knowledge access | `nvidia-ontology-query` | Domain queries instead of free-form SQL |
| Safety policy | `nemotron-policy-generator` | Admin action policy and approval rules |
| Token efficiency | `tao-token-efficient-execution` | Bounded ReAct rounds and payload trimming |
| Voice | `nemotron-voice-agent-builder`, `nemotron-speech` | Replace the browser-only voice path with a managed pipeline |
| Multi-node inference routing | `dynamo-*` | Future hosted inference topology |
| Vision/computer use | `vss-*`, `rtvi-*` | Authorized computer-use observation/verification runtime |
| Physical AI / Robotics (your GLB asset) | `physical-ai-*`, `paidf-*`, `foundationpose-*`, `i4h-*` | Only if the robot model later becomes a physical/robotics asset — it is **not** your Spline character |

Reliability figures (RPO, RTO, replication lag, failover time, measured
concurrency, quota limits) were **not measured in this recovery** and are not
invented here. They remain as previously documented unknowns in
`docs/RELIABILITY/AUDIT.md` and `docs/RELIABILITY/RECOVERY-POINT.md`.

---

## 7. Deployment state

Nothing was pushed. No production migrations were run. No destructive command
was executed. The working tree remains heavily dirty with pre-existing
untracked files; only the files listed in section 2 were changed.
