# Backend Truthfulness and Agent-Dependency Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate false-success responses and dangerous read fallbacks across the backend while preserving every automatic, manual, AI, and non-AI capability and its audit trail.

**Architecture:** Fix shared audit/settings and control-plane primitives first, then the highest-impact user-facing mutations (reports, moderation, inbox, notifications, preferences), then cleanup/timeline/pre-publish/provider/chat surfaces. Produce a dependency/capability map that distinguishes automatic, manual, and shared consumers; no route, worker, registry, or control is removed as part of this plan.

**Tech Stack:** Node.js 25 ESM, Vercel-style `api/index.js`, Supabase JS query builders, existing Vitest API harness, existing API error helpers and logger.

**Spec:** `docs/superpowers/specs/2026-09-24-voice-box-reliability-admin-rebuild-design.md`

## Global Constraints

- No browser automation.
- No deployment, commit, push, or secret rotation.
- Do not delete, skip, or weaken existing tests.
- Supabase query builders can resolve `{ error }`; a `try/catch` alone is not error handling.
- A failed read is not an empty result.
- A failed primary mutation must not trigger downstream state changes or success audit entries.
- A successful primary mutation with a failed side effect must return an explicit partial/degraded result.
- Do not remove product AI, agent/workforce, automatic, manual, or non-AI capabilities.
- Do not remove a route, worker, registry, report, audit surface, or control as a side effect of this audit.

## Review Focus

- A returned `{ error }` from a Supabase mutation must not produce `ok: true`.
- A returned `{ error }` from a read must not produce an empty dashboard, inbox, notification list, or default control state.
- Destructive cleanup must count only confirmed deletions.
- Moderation must not report a user sanction that was not persisted.
- Session/control writes must be verified before login or control success is returned.
- The audit trail must never claim a write that failed.
- Every automatic and manual capability remains reachable and produces an authoritative audit/state result.
- A capability dependency map must classify each consumer as automatic, manual, or shared; no `safe-to-delete` or quarantine action is permitted in this plan.

---

### Task 1: Establish backend returned-error regression harnesses

**Files:**
- Create: `tests/api/supabase-error-contract.test.ts`
- Modify: `tests/api/announcement-write.test.ts`
- Modify: `tests/api/agent-suggestion-dismiss.test.ts`
- Modify: `tests/api/admin-gates-runtime.test.ts`

**Interfaces:**

- API tests must be able to simulate a Supabase query builder that resolves `{ data: null, error: Error }` without rejecting.
- Existing handlers must throw/sanitize the error rather than return success.

- [ ] **Step 1: Add a reusable chain helper in the new test file**

The helper must support `select`, `eq`, `maybeSingle`, `single`, `insert`, `update`, `upsert`, `delete`, and `then`, with a configurable `error` returned for a selected operation/table.

- [ ] **Step 2: Add failing contract cases**

Add cases proving that these handlers reject or return a non-success response when the builder resolves an error:

- `api/_announcement.js` update, insert, and clear delete;
- `api/_agent.js` dismiss and approve;
- `api/_chat.js` mark-read and set-status;
- `api/_admin.js` `setSetting()` through login/session persistence.

- [ ] **Step 3: Run the contract test and verify RED**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/supabase-error-contract.test.ts
```

Expected: current handlers resolve successful responses for the configured errors.

- [ ] **Step 4: Keep the failing tests as the canonical reproduction**

Do not remove or weaken these cases after fixes. Each later task must rerun its relevant case.

---

### Task 2: Make audit logs and admin session/settings truthful

**Files:**
- Modify: `api/_auth.js:248-258`
- Modify: `api/_admin.js:46-58,105-121`
- Create: `tests/api/audit-log-write.test.ts`
- Create: `tests/api/admin-session-persistence.test.ts`

**Interfaces:**

- `auditLog(actor, action, detail): Promise<boolean>` returns `true` only when the insert result has no error.
- `getSetting(key): Promise<unknown>` throws on a database read error.
- `setSetting(key, value): Promise<void>` throws on a database write error.
- `mintSession(ip)` returns a token only after the session row is persisted.

- [ ] **Step 1: Write failing audit tests**

Test that `auditLog` returns `false` when the insert builder resolves `{ error: new Error("audit unavailable") }`, and returns `true` only for `{ error: null }`.

- [ ] **Step 2: Write failing session tests**

Test that login/mint-session does not return a token when the settings read or write resolves an error. Assert the handler does not emit a successful login response.

- [ ] **Step 3: Run tests and verify RED**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/audit-log-write.test.ts tests/api/admin-session-persistence.test.ts
```

- [ ] **Step 4: Implement the minimal fixes**

In `_auth.js`, destructure the insert result and return `false` when `error` exists. In `_admin.js`, destructure read/write results, throw on error, and call `setSetting()` before returning the minted token.

- [ ] **Step 5: Run focused and existing auth tests**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/audit-log-write.test.ts tests/api/admin-session-persistence.test.ts tests/api/admin-settings.test.ts tests/api/admin-audit-reads.test.ts
```

Expected: all pass.

- [ ] **Step 6: Verification checkpoint**

Do not commit. Confirm no login path can return a token before persistence is confirmed.

---

### Task 3: Make workforce control and persistence safe

**Files:**
- Modify: `api/_workforce.js:97-135,1397-1427,2857-2871`
- Modify: `api/_workforce-core.js:80-109,255-256,293-294,399-400`
- Create: `tests/api/workforce-control-persistence.test.ts`
- Create: `tests/api/workforce-ledger-persistence.test.ts`
- Create: `tests/api/workforce-alert-persistence.test.ts`

**Interfaces:**

- `getConfig(): Promise<WorkforceConfig>` throws on read error rather than returning permissive defaults.
- `setConfig(patch): Promise<WorkforceConfig>` throws on write error and returns the persisted config.
- `ledgerAppend(row): Promise<void>` throws on read/write error.
- `readLedger(limit): Promise<Row[]>` throws on read error.
- `writeAlerts(alerts): Promise<void>` throws on write error.
- `onEscalate`/`notifyAdmin` failures are recorded as degraded state or re-thrown; they are never discarded.

- [ ] **Step 1: Add failing control tests**

Simulate `getConfig()` and `setConfig()` returning `{ error }` and assert pause/stop commands do not return `{ ok: true }` and do not write a success audit row.

- [ ] **Step 2: Add failing ledger tests**

Simulate a settings upsert error and assert `runWorker` does not return a durable `verified_success` row without an explicit degraded persistence state.

- [ ] **Step 3: Add failing alert/escalation tests**

Simulate a failed alert upsert and a rejected `onEscalate`/`notifyAdmin`; assert the operation exposes the failure rather than returning an apparently clean row.

- [ ] **Step 4: Run tests and verify RED**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/workforce-control-persistence.test.ts tests/api/workforce-ledger-persistence.test.ts tests/api/workforce-alert-persistence.test.ts
```

- [ ] **Step 5: Implement safe control and persistence**

- Distinguish a missing settings row (`data === null && error === null`) from a failed query.
- Check every settings read/write result.
- Make ledger/alert writes throw on error.
- Convert `runWorker` to return `persistence_status: "failed"` or re-throw before reporting verified success.
- Replace empty escalation catches with a durable fallback alert and an explicit degraded marker.

- [ ] **Step 6: Run focused and existing workforce tests**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/workforce-control-persistence.test.ts tests/api/workforce-ledger-persistence.test.ts tests/api/workforce-alert-persistence.test.ts tests/api/workforce-reality.test.ts tests/api/workforce-batch6.test.ts
```

Expected: all pass; existing verified-success tests still pass only when persistence succeeds.

- [ ] **Step 7: Verification checkpoint**

Do not commit. Confirm a failed control read cannot make a stopped workforce appear active.

---

### Task 4: Fix moderation, report, inbox, and notification false-success paths

**Files:**
- Modify: `api/_reports.js:87-158,518-555`
- Modify: `api/_comment-watch.js:90-281`
- Modify: `api/_inbox.js:268-281,1032-1144,1161-1210,1645-1748,1752-1781`
- Modify: `api/_notifications.js:80-173`
- Modify: `api/_notify-prefs.js:35-56,118-130`
- Create: `tests/api/moderation-write-truthfulness.test.ts`
- Create: `tests/api/inbox-notification-truthfulness.test.ts`
- Create: `tests/api/notify-preferences-fail-closed.test.ts`

**Interfaces:**

- Report resolution returns `verified: false` when target enforcement cannot be confirmed.
- Comment-watch result distinguishes `hidden`, `sanction_applied`, `alert_persisted`, and partial errors.
- Inbox mutations return success only after the relevant message/thread row is persisted.
- Notification reads return an error/unavailable state on database failure, never an empty list.
- AI/notification preferences fail closed when their state cannot be read.

- [ ] **Step 1: Add failing report/moderation tests**

Cover:

- report target hide update returning `{ error }`;
- comment user-meta update/insert returning `{ error }`;
- alert upsert returning `{ error }`;
- successful comment hide with failed sanction must not report a complete strike.

- [ ] **Step 2: Add failing inbox/notification tests**

Cover:

- thread-state read error;
- dedup delete error while returning a removed count;
- takeover message insert error;
- mark-read and set-status update errors;
- AI reply insert error and fallback insert error;
- notification GET error, create error, mark-read error, and clear error;
- notification preference GET/POST errors.

- [ ] **Step 3: Run tests and verify RED**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/moderation-write-truthfulness.test.ts tests/api/inbox-notification-truthfulness.test.ts tests/api/notify-preferences-fail-closed.test.ts
```

- [ ] **Step 4: Implement report and moderation fixes**

Check the returned error for every enforcement write. Re-read the target after hide/delete. Count a user sanction only after the user-meta row is confirmed. Return partial evidence if the comment is hidden but the sanction or alert write fails.

- [ ] **Step 5: Implement inbox and notification fixes**

- `getThreadState` throws on read error and defaults only for a confirmed missing row.
- Dedup counts only confirmed deletes.
- Takeover, mark-read, set-status, and AI reply writes check errors and verify the row where needed.
- Remove the fabricated fallback message object when its insert did not persist; return an explicit AI persistence/unavailable state.
- Notification reads return an error rather than `[]`; all mutations check errors.
- Preference/config reads fail closed for AI auto-reply and global AI mode.

- [ ] **Step 6: Run focused and existing suites**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/moderation-write-truthfulness.test.ts tests/api/inbox-notification-truthfulness.test.ts tests/api/notify-preferences-fail-closed.test.ts tests/api/inbox-admin-reply.test.ts tests/api/comment-watch.test.ts tests/api/notifications.test.ts
```

Expected: all pass.

- [ ] **Step 7: Verification checkpoint**

Do not commit. Confirm no moderation or notification operation reports a successful state that is absent after a simulated read-back.

---

### Task 5: Fix provider, cleanup, timeline, pre-publish, and AI-chat persistence

**Files:**
- Modify: `api/_providers.js:649-692,1568-1707`
- Modify: `api/_cleanup.js:26-387`
- Modify: `api/_timeline.js:20-93`
- Modify: `api/_pre-publish.js:880-952`
- Modify: `api/_ai-chat.js:924-1015`
- Create: `tests/api/provider-persistence.test.ts`
- Create: `tests/api/cleanup-write-counts.test.ts`
- Create: `tests/api/timeline-prepublish-persistence.test.ts`
- Create: `tests/api/ai-chat-persistence.test.ts`

**Interfaces:**

- Provider reads never turn a database error into `{}`; provider writes throw on error.
- Cleanup returns confirmed deletion counts and a partial error list.
- Timeline returns `201` only after the event and optional status-history write are confirmed.
- High-risk pre-publish review returns an unavailable/review-required result when its review row cannot be persisted.
- AI chat can return a response while explicitly reporting history persistence degraded; it must not claim durable history when the insert failed.

- [ ] **Step 1: Add failing tests for each subsystem**

Test returned `{ error }` from provider update/insert, cleanup delete/upsert, timeline settings/post update, pre-publish review insert, and AI conversation insert.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/provider-persistence.test.ts tests/api/cleanup-write-counts.test.ts tests/api/timeline-prepublish-persistence.test.ts tests/api/ai-chat-persistence.test.ts
```

- [ ] **Step 3: Implement provider persistence checks**

On read error, throw rather than returning `{}`. On write error, throw before audit/200. Verify the persisted provider map after mutation.

- [ ] **Step 4: Implement confirmed cleanup counts**

Replace unchecked delete calls with a helper that checks each returned error. Count only confirmed IDs. Return `partial: true` and an `errors` array when a sweep cannot finish.

- [ ] **Step 5: Implement timeline/pre-publish checks**

Check settings read/write and post status-history write errors. A failed timeline write returns an error response. A failed high-risk review insert returns a review-required/unavailable response and never a normal success with `review_id: null`.

- [ ] **Step 6: Implement AI-chat persistence signaling**

Keep the user-visible response if the LLM succeeded, but return a structured `persistence_status: "degraded"` field when conversation persistence fails. Do not silently treat a null insert as a durable assistant message.

- [ ] **Step 7: Run focused and existing suites**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/provider-persistence.test.ts tests/api/cleanup-write-counts.test.ts tests/api/timeline-prepublish-persistence.test.ts tests/api/ai-chat-persistence.test.ts tests/api/pre-publish.test.ts tests/api/pre-publish-review.test.ts
```

Expected: all pass.

- [ ] **Step 8: Verification checkpoint**

Do not commit. Confirm no cleanup result or AI response labels an unpersisted side effect as complete.

---

### Task 6: Build the capability dependency inventory

**Files:**
- Create: `docs/QA/CAPABILITY-DEPENDENCY-MAP.md`
- Create: `scripts/audit-capability-dependencies.mjs`
- Modify: `src/__tests__/admin-navigation-contract.test.tsx`
- Modify: `tests/api/capability-route-contract.test.ts` if it exists; otherwise create it

**Interfaces:**

The audit script must emit, for each agent/workforce/product-AI module:

- file path;
- imported by;
- route registered in `api/index.js`;
- frontend consumer;
- test consumer;
- execution mode (`automatic`, `manual`, or `both`);
- product-AI dependency (`true`/`false`);
- preservation status (`keep`, `shared`, `manual-control`, `automatic-worker`).

- [ ] **Step 1: Write the failing audit-script test**

The test must run the script against the repository and assert that the output includes `api/_agent-team.js`, `api/_workforce.js`, `api/_agent-chat.js`, `api/_ai.js`, `api/_assist.js`, `src/pages/Admin.tsx`, and `src/pages/Submit.tsx`.

- [ ] **Step 2: Run it and verify RED**

```powershell
node scripts/audit-capability-dependencies.mjs
```

Expected: script-not-found failure.

- [ ] **Step 3: Implement the dependency scanner**

Use `node:fs`, `node:path`, and regular expressions to walk `src/` and `api/`. Do not execute imported modules or make network requests. Normalize relative paths and emit JSON plus a human-readable Markdown table.

- [ ] **Step 4: Classify every dependency**

Mark execution mode and preservation status for each capability. Keep product AI, agent/workforce, automatic, manual, and shared consumers explicit. No row may be marked for deletion in this plan.

- [ ] **Step 5: Add route contract tests**

Assert that all existing admin tabs, AI routes, worker routes, manual controls, reports, and audit surfaces remain reachable and authorized. The map and tests must agree before the next workstream.

- [ ] **Step 6: Review the map**

Inspect every row for frontend, API, cron, migration, and test consumers. A missing consumer is evidence for a later product decision, not permission to remove a feature in this plan.

- [ ] **Step 7: Verification checkpoint**

Do not commit. The capability dependency map is the evidence artifact for future optimization and migration planning.

---

### Task 7: Backend workstream verification

**Files:**
- No new production files.
- Update only tests and the capability dependency map.

- [ ] **Step 1: Run all backend-focused tests**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/supabase-error-contract.test.ts tests/api/audit-log-write.test.ts tests/api/admin-session-persistence.test.ts tests/api/workforce-control-persistence.test.ts tests/api/workforce-ledger-persistence.test.ts tests/api/workforce-alert-persistence.test.ts tests/api/moderation-write-truthfulness.test.ts tests/api/inbox-notification-truthfulness.test.ts tests/api/notify-preferences-fail-closed.test.ts tests/api/provider-persistence.test.ts tests/api/cleanup-write-counts.test.ts tests/api/timeline-prepublish-persistence.test.ts tests/api/ai-chat-persistence.test.ts
```

- [ ] **Step 2: Run the full local battery**

```powershell
npm run typecheck
npm run lint
npm run test:api
npm test
npm run build
```

- [ ] **Step 3: Verify the capability-preservation boundary**

Run:

```powershell
node scripts/audit-capability-dependencies.mjs
```

Confirm:

- product AI dependencies remain;
- automatic, manual, and shared capabilities are classified;
- all admin routes/tabs and manual controls remain reachable;
- no live claim is made before human redeploy and live smoke testing.
