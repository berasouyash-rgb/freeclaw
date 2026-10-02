# AI Job Queue and Provider Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commit each anonymous inbox message and its AI work atomically, return a fast accepted response, process classification and reply generation from a durable Supabase queue, and keep every AI provider attempt globally bounded, cancellable, budgeted, retryable, and observable.

**Architecture:** Use the managed Supabase `pgmq` extension as the durable transport and a service-role-only `ai_jobs` table as the authoritative job, retry, idempotency, and user-visible status record. A Vercel cron route claims PGMQ messages, performs one structured classification-and-reply provider call when valid, and completes all reply/state changes in one Postgres transaction; a database-backed slot and token-budget ledger replaces the current per-instance NIM-only limiter and applies to batch, fast-lane, and streaming provider calls without adding Redis.

**Tech Stack:** Node.js 22.22+, Vercel Functions and Cron, Supabase Postgres/Data API, `@supabase/supabase-js` 2.x, managed Supabase Queues (`pgmq`), Vitest 4, Testing Library, TypeScript 5.9.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md` (approved design)

**Related inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

## Global Constraints

- Target 10,000 simultaneously active users without adding Redis, Kafka, or another service.
- Use logged Supabase Queues (`pgmq.create`), not the unlogged queue type, because inbox replies must survive restarts.
- Add no npm dependency; the project already has `@supabase/supabase-js`, Vitest, and Testing Library.
- A user-message request must not call an AI provider. It must commit the message and durable job decision before returning `202 Accepted`.
- Keep the API write acknowledgement below the approved p95 target of 800 ms; AI completion is measured separately.
- Store no message body in PGMQ or `ai_jobs`; the queue contains only `job_id`, and the worker loads the authoritative `chat_messages` row.
- Do not log message bodies, provider response bodies, API keys, or raw provider errors.
- Keep `anon` and `authenticated` denied on every new table and function; only the server-only `service_role` may execute queue, job, and budget RPCs.
- Use `SECURITY INVOKER` functions with a pinned `search_path`; do not add a `SECURITY DEFINER` function in exposed schemas.
- Keep provider concurrency global across Vercel instances, cron workers, inbox jobs, `/api/assist`, and streaming calls. An in-memory semaphore is not a global control.
- Default global provider limits are exactly: `max_concurrency=4`, `hourly_token_limit=1000000`, `daily_token_limit=8000000`, and eight physical slot rows; the first four are eligible at the default limit and the remaining four are reserved for a later bounded increase.
- A single inbox provider call is capped at 20,000 ms, uses at most 400 output tokens, retries one `429` or `503` inside that same deadline, and aborts when the worker deadline or cancellation signal fires.
- An inbox job gets three queue-level attempts. Backoff is 15 seconds after attempt 1, 30 seconds after attempt 2, and terminal dead-letter after attempt 3.
- A provider-budget denial or global concurrency saturation is a deferral, not a failed user request and not a burned job attempt.
- Critical keyword detection always routes to the emotional agent, even if model output disagrees; model output can never weaken that safety rule.
- Preserve anonymous identity, PII moderation, `maskPII` outbound scrubbing, admin takeover, per-thread AI disablement, and the platform-wide AI kill switch.
- Add no polling loop. User status changes arrive through the existing `chat_messages` Realtime event, and an explicit refresh/route entry remains authoritative.
- Treat the working tree as shared user work. Run `git status --short --branch` before every task and stage only that task's files.
- Run tests, typecheck, lint, and build sequentially, never concurrently.
- Commit, push, deploy, remote migration, and production activation all require the human gates recorded in `docs/QA/LOOP-STATE.json`.
- Database migrations are additive and deployed before application activation. The previous Vercel deployment must remain a valid rollback while the new columns and tables exist.

## Review Focus

- A client timeout after the database transaction commits, followed by a retry with the same `Idempotency-Key`, returns the original message and job and creates no duplicate.
- Reusing an `Idempotency-Key` with a different thread, sender, body, or attachment returns `409 IDEMPOTENCY_KEY_REUSED` and creates no second message.
- Global AI disablement, user AI disablement, or admin takeover after enqueue causes cancellation before any provider call and leaves the user message available to an admin.
- A worker crash after a provider succeeds but before completion cannot create two AI replies because completion, job transition, source-status transition, and PGMQ archival share one database transaction.
- Concurrency or token-budget exhaustion leaves the job visibly pending, emits a saturation metric, and does not burn an attempt or report a fabricated failure.

---

## Current-Code Findings

- `api/_inbox.js:1465-1749` inserts the user message and then performs up to two inline model stages under a 35-second race. A timeout can still leave late provider work running and fabricates an offline reply after the request budget is exhausted.
- `api/_inbox.js:158-427` classifies emotion and generates a reply independently, so the common path spends two provider calls for one user intent.
- `api/_providers.js:841-911` enforces NIM concurrency only in one warm process. `callProviderInner`, `nvidiaFastOnce`, and `callProviderStream` each have separate outbound paths, so one in-memory counter cannot be a platform-wide cap.
- `api/_work-queue.js:38-42` explicitly documents concurrent read-modify-write claims. It is durable, but it is not the correct transport for a multi-instance AI worker because two cron invocations can observe the same pending job.
- `api/agent-cron.js:51-137` and `api/_incident-cron.js:372-495` establish the repository's authorization, wall-clock budget, and deferred-work conventions.
- `vercel.json:51-69` sends every request whose path begins with `/api/` through `api/index.js` and already uses authenticated five-minute cron routes.
- `api/migrations/001_baseline.sql:153-167` has no asynchronous AI status on `chat_messages`; the new migration must add it without rewriting existing rows.
- `tests/api/providers.test.ts` tests a reimplementation of the provider chain and never imports `api/_providers.js`; provider-bound work must replace that false coverage with real-module tests.
- `tests/api/inbox-classify.test.ts` locks the two-call helper behavior that this slice removes; move its safety assertions to the combined worker seam.
- `src/pages/UserChat.tsx:260-357` keeps `typing` tied to the request. Once acceptance is asynchronous, status must come from `message.ai_status`, not from an HTTP request that has already returned.
- The current Supabase changelog says extension version pins are ignored. Use `CREATE EXTENSION IF NOT EXISTS pgmq;` without a version clause.

## File Map

### Create

- `api/migrations/019_ai_job_queue.sql` — logged PGMQ queue, authoritative AI job/attempt tables, atomic enqueue/claim/complete/fail/cancel/retry RPCs, RLS, grants, and queue indexes.
- `api/migrations/019_ai_job_queue.rollback.sql` — guarded removal of only the 019 objects; preserves all chat messages.
- `api/migrations/019_ai_job_queue.test.sql` — schema, grants, idempotency, atomic completion, cancellation, retry, and dead-letter assertions.
- `api/migrations/020_ai_provider_budget.sql` — global provider slots, UTC hour/day token buckets, atomic acquire/settle/release RPCs, RLS, grants, and configuration row.
- `api/migrations/020_ai_provider_budget.rollback.sql` — guarded removal of only the 020 budget objects.
- `api/migrations/020_ai_provider_budget.test.sql` — concurrency, budget, lease-expiry, settlement, and service-role-only assertions.
- `api/_ai-job-store.js` — typed-by-JSDoc JavaScript adapter for queue and job RPCs.
- `api/_ai-budget.js` — provider-slot, token-budget, safe budget-statistics adapter, and token estimation.
- `api/_ai-inbox-worker.js` — combined inbox prompt, external-output validation, bounded history, and keyword safety override.
- `api/_ai-jobs.js` — authenticated cron/admin route and bounded worker orchestration.
- `scripts/test-ai-migrations.mjs` — disposable local-Postgres migration test runner that refuses non-loopback database URLs.
- `tests/api/ai-job-queue.test.ts` — job-store contract tests.
- `tests/api/ai-provider-budget.test.ts` — budget adapter contract tests.
- `tests/api/ai-inbox-worker.test.ts` — combined classification/reply and cancellation tests.
- `tests/api/ai-jobs-cron.test.ts` — concurrency, recovery, retry, and deadline tests.
- `tests/api/ai-jobs-cron-authz.test.ts` — cron-secret and admin authorization tests.
- `tests/api/inbox-async.test.ts` — atomic acceptance, idempotency, kill-switch, and status-endpoint tests.
- `src/__tests__/UserChatAiJobs.test.tsx` — pending, running, failed, cancelled, and late-reply UI tests.

### Modify

- `api/_inbox.js` — replace inline user-message AI work with atomic enqueue; keep deterministic triage and add job status/cancel/retry actions.
- `api/_providers.js` — add the cancellable bounded JSON interface and route every outbound provider lane through the global budget.
- `api/index.js` — register the `ai-jobs` route through the existing `protect` wrapper.
- `vercel.json` — add the one-minute AI worker cron.
- `src/lib/api.ts` — support an `Idempotency-Key` request header and reduce inbox acceptance to the normal request timeout.
- `src/types/index.ts` — add explicit AI job/status types to chat messages.
- `src/pages/UserChat.tsx` — render durable AI status, remove request-bound typing, and reconcile optimistic sends.
- `src/pages/admin/UnifiedInbox.tsx` — show failed AI status and allow an authorized dead-letter retry.
- `tests/api/providers.test.ts` — delete the copied provider implementation and test the real provider module.
- `tests/api/provider-degraded.test.ts` — preserve fast degraded behavior under the new budget wrapper.
- `tests/api/inbox-classify.test.ts` — replace two-call helper tests with combined-worker safety tests or remove obsolete imports after the assertions move.
- `src/__tests__/UserChat.test.tsx` — update the slow-inline-reply regression to fast acceptance plus later completion.
- `tests/api/schema-contract.test.ts` — include the new chat-message status columns in the schema double.
- `docs/DEPLOY-SCHOOL.md` — add migrations 019/020, the AI cron, budget controls, smoke checks, and rollback order.

## Exact Public Interfaces

### `POST /api/inbox` user-send contract

Request:

```http
POST /api/inbox
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

```json
{
  "thread_id": "anon_example",
  "sender": "user",
  "body": "The library closes before I can study.",
  "attachment_url": null
}
```

Queued response, status `202`:

```json
{
  "message": {
    "id": 481,
    "thread_id": "anon_example",
    "sender": "user",
    "body": "The library closes before I can study.",
    "read": false,
    "ai_status": "pending",
    "ai_job_id": "0a2946fc-3db8-4bb2-8ecf-e123456789ab"
  },
  "auto_reply": null,
  "ai": {
    "mode": "queued",
    "job": {
      "id": "0a2946fc-3db8-4bb2-8ecf-e123456789ab",
      "status": "pending",
      "attempts": 0,
      "max_attempts": 3,
      "status_url": "/api/inbox?action=job_status&job_id=0a2946fc-3db8-4bb2-8ecf-e123456789ab"
    }
  },
  "triage": {
    "reported": false,
    "urgency": "none",
    "private": false
  },
  "deduplicated": false
}
```

A same-key/same-payload replay returns the same `message` and `job` with `deduplicated=true` and the current job state. A same-key/different-payload replay returns status `409`:

```json
{
  "error": "Idempotency-Key was already used for a different inbox message.",
  "code": "IDEMPOTENCY_KEY_REUSED"
}
```

When user or global AI is off, the message is still committed with a cancelled job decision and response `ai.mode="off"`. Admin sends remain `201 Created`, create no AI job, and keep `auto_reply=null`.

### `GET /api/inbox?action=job_status&job_id=<uuid>`

- Admin callers receive the safe job summary.
- Non-admin callers must pass `checkUser(job.thread_id)` and may read only their own thread's job.
- The response contains `id`, `status`, `attempts`, `max_attempts`, `run_after`, `last_error_code`, `created_at`, and `updated_at`; it never contains message text, prompt text, provider response text, or raw errors.
- An unknown job returns `404 JOB_NOT_FOUND`; a non-owner receives the same non-enumerating `404` response rather than a confirmation that another thread owns the UUID.

### `api/_ai-job-store.js`

The following declaration-only contract is implemented in JavaScript with equivalent JSDoc types; the declarations are the exact names and data shapes consumed by later tasks.

```ts
export const AI_QUEUE_NAME = "ai_inbox_jobs";
export const AI_JOB_TYPE = "inbox.reply";
export const AI_JOB_STATES = ["pending", "running", "retrying", "succeeded", "failed", "cancelled"] as const;
export type AiJobStatus = (typeof AI_JOB_STATES)[number];
export type JsonObject = Record<string, unknown>;
export type JsonInteger = number | string;
export type Timestamp = string;

export interface AiJobRecord {
  id: string;
  queue_msg_id: JsonInteger | null;
  job_type: "inbox.reply";
  thread_id: string;
  source_message_id: JsonInteger;
  idempotency_key: string;
  request_fingerprint: string;
  payload: JsonObject;
  status: AiJobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  generation: number;
  run_after: Timestamp;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Timestamp | null;
  cancel_requested_at: Timestamp | null;
  cancel_reason: string | null;
  retry_requested_by: string | null;
  retry_reason: string | null;
  provider_id: string | null;
  provider_model: string | null;
  input_tokens: number;
  output_tokens: number;
  last_error_code: string | null;
  last_error_message: string | null;
  deferral_count: number;
  last_deferred_at: Timestamp | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  dead_lettered_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AiJobAttemptRecord {
  id: string;
  job_id: string;
  generation: number;
  attempt_no: number;
  status: "running" | "succeeded" | "failed" | "cancelled";
  provider_id: string | null;
  provider_model: string | null;
  http_status: number | null;
  error_code: string | null;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number | null;
  started_at: Timestamp;
  finished_at: Timestamp | null;
}

export interface EnqueueInboxAiJobInput {
  threadId: string;
  sender: "user" | "admin";
  body: string;
  attachmentUrl: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  priority: number;
  payload: JsonObject;
  cancelReason: string | null;
}

export interface EnqueueInboxAiJobResult {
  duplicate: boolean;
  message: JsonObject;
  aiJob: AiJobRecord;
}

export interface ReadClaimableAiJobsInput {
  workerId: string;
  limit: number;
  visibilitySeconds: number;
}

export interface ListAiJobsInput {
  status: AiJobStatus | "all";
  limit: number;
  offset: number;
}

export interface ClaimedAiJob {
  queueMessageId: JsonInteger;
  job: AiJobRecord;
}

export interface BeginAiJobAttemptInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
  providerId: string | null;
  providerModel: string | null;
}

export interface BeginAiJobAttemptResult {
  job: AiJobRecord;
  attempt: AiJobAttemptRecord;
}

export interface HeartbeatAiJobInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
}

export interface HeartbeatAiJobResult {
  leaseExpiresAt: Timestamp;
  cancelRequested: boolean;
}

export interface DeferAiJobInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
  queueMessageId: JsonInteger;
  errorCode: string;
  errorMessage: string;
  delaySeconds: number;
}

export interface CompleteAiJobInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
  queueMessageId: JsonInteger;
  replyBody: string;
  agent: "general" | "emotional";
  emotion: string;
  level: "none" | "mild" | "moderate" | "high" | "critical";
  escalate: boolean;
  providerId: string;
  providerModel: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  httpStatus: number | null;
}

export interface FailAiJobInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
  queueMessageId: JsonInteger;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  providerId: string | null;
  providerModel: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  httpStatus: number | null;
}

export interface AiJobMutationResult {
  job: AiJobRecord;
  archived: boolean;
}

export interface RetryDeadAiJobInput {
  jobId: string;
  requestedBy: string;
  reason: string;
}

export interface AiJobSummary {
  id: string;
  status: AiJobStatus;
  attempts: number;
  max_attempts: number;
  run_after: Timestamp;
  last_error_code: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AiQueueStats {
  byStatus: Record<AiJobStatus, number>;
  total: number;
  oldestPendingAgeSeconds: number | null;
  deadLetterCount: number;
  budgetDeferredLastHour: number;
}

export interface ConfigureAiBudgetInput {
  maxConcurrency: number;
  hourlyTokenLimit: number;
  dailyTokenLimit: number;
  paused: boolean;
}

export interface ConfigureAiBudgetResult {
  maxConcurrency: number;
  hourlyTokenLimit: number;
  dailyTokenLimit: number;
  paused: boolean;
  updatedAt: Timestamp;
}

export function aiBackoffSeconds(attempt: number): number;
export function enqueueInboxAiJob(input: EnqueueInboxAiJobInput): Promise<EnqueueInboxAiJobResult>;
export function readClaimableAiJobs(input: ReadClaimableAiJobsInput): Promise<ClaimedAiJob[]>;
export function listAiJobs(input: ListAiJobsInput): Promise<AiJobSummary[]>;
export function beginAiJobAttempt(input: BeginAiJobAttemptInput): Promise<BeginAiJobAttemptResult>;
export function heartbeatAiJob(input: HeartbeatAiJobInput): Promise<HeartbeatAiJobResult>;
export function deferAiJob(input: DeferAiJobInput): Promise<AiJobMutationResult>;
export function completeAiJob(input: CompleteAiJobInput): Promise<AiJobMutationResult>;
export function failAiJob(input: FailAiJobInput): Promise<AiJobMutationResult>;
export function cancelAiJobsForThread(threadId: string, reason: string): Promise<number>;
export function retryDeadAiJob(input: RetryDeadAiJobInput): Promise<AiJobRecord>;
export function getAiJob(jobId: string): Promise<AiJobRecord | null>;
export function getAiQueueStats(): Promise<AiQueueStats>;
export function configureAiBudget(input: ConfigureAiBudgetInput): Promise<ConfigureAiBudgetResult>;
```

### `api/_ai-budget.js`

```ts
export interface ProviderMessage {
  role: string;
  content: string;
}

export interface AcquireProviderAttemptInput {
  owner: string;
  purpose: string;
  jobId: string | null;
  priority: number;
  estimatedTokens: number;
  leaseMs: number;
}

export interface ProviderAttemptLease {
  allowed: true;
  slotNumber: number;
  leaseToken: string;
  leaseExpiresAt: string;
  reservedTokens: number;
}

export type AcquireProviderAttemptResult =
  | ProviderAttemptLease
  | {
      allowed: false;
      code: "BUDGET_PAUSED" | "CONCURRENCY_FULL" | "TOKEN_BUDGET_EXHAUSTED";
      retryAfterMs: number | null;
    };

export interface SettleProviderAttemptInput {
  slotNumber: number;
  leaseToken: string;
  inputTokens: number;
  outputTokens: number;
  chargeUnknown: boolean;
}

export interface ReleaseProviderAttemptInput {
  slotNumber: number;
  leaseToken: string;
}

export interface ProviderSettlementResult {
  settled: boolean;
  chargedTokens: number;
}

export interface ProviderBudgetStats {
  paused: boolean;
  maxConcurrency: number;
  hourlyTokenLimit: number;
  dailyTokenLimit: number;
  activeSlots: number;
  hourlyReservedTokens: number;
  hourlySpentTokens: number;
  dailyReservedTokens: number;
  dailySpentTokens: number;
  nextHourResetAt: string;
  nextDayResetAt: string;
}

export function getAiProviderBudgetStats(): Promise<ProviderBudgetStats>;
export function acquireProviderAttempt(input: AcquireProviderAttemptInput): Promise<AcquireProviderAttemptResult>;
export function settleProviderAttempt(input: SettleProviderAttemptInput): Promise<ProviderSettlementResult>;
export function releaseProviderAttempt(input: ReleaseProviderAttemptInput): Promise<void>;
export function estimatePromptTokens(messages: ProviderMessage[], maxOutputTokens: number): number;
```

### `api/_providers.js`

```ts
export interface ProviderAttemptMetadata {
  provider: string;
  model: string;
  durationMs: number;
  status: number | null;
  errorCode: string | null;
}

export interface CallLLMJsonOptions {
  system: string;
  user: string;
  extraMessages: Array<{ role: string; content: string }>;
  priority: "low" | "normal" | "high";
  purpose: string;
  jobId: string | null;
  maxOutputTokens: number;
  timeoutMs: number;
  signal: AbortSignal | null;
  providerLease?: ProviderAttemptLease | null;
}

export type CallLLMJsonResult =
  | {
      ok: true;
      text: string;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      httpStatus: number | null;
      attempts: ProviderAttemptMetadata[];
    }
  | {
      ok: false;
      code: "BUDGET_DENIED" | "CANCELLED" | "TIMEOUT" | "NO_PROVIDER" | "PROVIDER_FAILED";
      message: string;
      retryable: boolean;
      durationMs: number;
      provider: string | null;
      model: string | null;
      inputTokens: number;
      outputTokens: number;
      httpStatus: number | null;
      attempts: ProviderAttemptMetadata[];
    };

export type LegacyLLMChainResult =
  | { provider: string; model: string; text: string }
  | { ok: false; degraded: true; error: string }
  | null;

export function callLLMJson(options: CallLLMJsonOptions): Promise<CallLLMJsonResult>;
export function callLLMChain(
  system: string,
  user: string,
  extraMessages: Array<{ role: string; content: string }>,
  priority: "low" | "normal" | "high",
): Promise<LegacyLLMChainResult>;
```

`ProviderAttemptLease` is imported from `api/_ai-budget.js` into this module; it is a capability token, not a second provider request. A supplied lease is owned by `callLLMJson` for the full provider-chain evaluation, including its internal `429`/`503` retry and failover; `runProviderAttempt` may use it for each HTTP attempt but must not settle it. `callLLMJson` settles that lease once in its outer `finally`. When no lease is supplied, the individual batch, fast-lane, or streaming primitive owns and settles its own lease. `callLLMJson` returns one of the two discriminated result shapes above. It never returns raw provider error text in `message`; the message is a safe operator-facing sentence and the machine-readable code is stable.

Keep `callLLMChain(system, user, extraMessages, priority)` as a compatibility wrapper for existing callers. It delegates to the same budgeted attempt path and preserves its current success shape `{ provider, model, text }`, `null`, and no-key degraded marker.

### `api/_ai-inbox-worker.js`

```ts
export const INBOX_COMBINED_SCHEMA_VERSION = "inbox.combined.v1";

export type InboxLevel = "none" | "mild" | "moderate" | "high" | "critical";
export type InboxEmotion =
  | "neutral"
  | "frustrated"
  | "anxious"
  | "sad"
  | "angry"
  | "positive"
  | "critical_distress";
export type InboxAgent = "general" | "emotional";

export interface KeywordClassification {
  level: InboxLevel;
  emotion: InboxEmotion;
  agent: InboxAgent;
  matchedKeyword: string;
}

export interface ParseInboxDecisionOptions {
  keywordClassification: KeywordClassification | null;
}

export interface InboxDecision {
  level: InboxLevel;
  emotion: InboxEmotion;
  agent: InboxAgent;
  reply: string;
  escalate: boolean;
  handoff: false;
}

export interface InboxMessageHistoryItem {
  sender: "user" | "admin" | "ai";
  content: string;
}

export interface BuildInboxCombinedMessagesInput {
  sourceMessage: {
    id: string | number;
    thread_id: string;
    body: string;
    attachment_url: string | null;
  };
  history: InboxMessageHistoryItem[];
  threadState: {
    agent: InboxAgent;
    handoff: boolean;
    emotion_history: string[];
  };
}

export interface PrepareInboxAiJobInput {
  job: AiJobRecord;
  signal: AbortSignal;
}

export type PrepareInboxAiJobResult =
  | {
      kind: "ready";
      context: BuildInboxCombinedMessagesInput;
      estimatedTokens: number;
    }
  | {
      kind: "cancel";
      code: "AI_DISABLED" | "HANDOFF" | "MESSAGE_DELETED";
      message: string;
    }
  | {
      kind: "fail";
      code: string;
      message: string;
      retryable: boolean;
    };

export interface ProcessClaimedInboxAiJobInput {
  job: AiJobRecord;
  queueMessageId: JsonInteger;
  workerId: string;
  leaseToken: string;
  preparedContext: BuildInboxCombinedMessagesInput;
  providerLease: ProviderAttemptLease;
  signal: AbortSignal;
}

export type ProcessClaimedInboxAiJobResult =
  | {
      kind: "complete";
      decision: InboxDecision;
      providerResult: Extract<CallLLMJsonResult, { ok: true }>;
    }
  | {
      kind: "cancel";
      code: "AI_DISABLED" | "HANDOFF" | "MESSAGE_DELETED";
      message: string;
    }
  | {
      kind: "defer";
      code: "PROVIDER_BUDGET_DENIED";
      message: string;
      delaySeconds: number;
    }
  | {
      kind: "fail";
      code: string;
      message: string;
      retryable: boolean;
      providerResult: Extract<CallLLMJsonResult, { ok: false }> | null;
    };

export function detectKeywordClassification(text: string): KeywordClassification | null;
export function parseInboxDecision(text: string, options: ParseInboxDecisionOptions): InboxDecision;
export function buildInboxCombinedMessages(input: BuildInboxCombinedMessagesInput): Array<{ role: string; content: string }>;
export function prepareInboxAiJob(input: PrepareInboxAiJobInput): Promise<PrepareInboxAiJobResult>;
export function processClaimedInboxAiJob(input: ProcessClaimedInboxAiJobInput): Promise<ProcessClaimedInboxAiJobResult>;
```

`detectKeywordClassification` returns `null` when no keyword matches. `parseInboxDecision` always returns a bounded `reply`; the keyword classification, when non-null, overrides the model's level, emotion, and agent. `prepareInboxAiJob` loads the bounded source/history/settings context once and returns either a ready context with a conservative token estimate or a cancellation/failure result before any provider slot is acquired. `processClaimedInboxAiJob` consumes that prepared context, returns exactly one member of the four result variants, and never exposes provider response text in a log or error. The worker passes its already-acquired `ProviderAttemptLease` to `callLLMJson`; the provider adapter does not acquire a second slot for that call. The worker module imports `AiJobRecord`, `JsonInteger`, `ProviderAttemptLease`, and `CallLLMJsonResult` from the three sibling contracts above.

### `api/_ai-jobs.js`

```ts
export interface RunAiJobWorkerOptions {
  workerId?: string;
  maxJobs?: number;
  maxConcurrency?: number;
  deadlineMs?: number;
  now?: () => number;
}

export interface AiWorkerSummary {
  workerId: string;
  claimed: number;
  completed: number;
  deferred: number;
  failed: number;
  cancelled: number;
  unprocessed: number;
  saturated: number;
}

export interface CronRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface CronResponse {
  status(code: number): CronResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export function runAiJobWorker(options?: RunAiJobWorkerOptions): Promise<AiWorkerSummary>;
export default function handler(req: CronRequest, res: CronResponse): Promise<void>;
```

`runAiJobWorker` applies these defaults before work begins: `workerId=crypto.randomUUID()`, `maxJobs=12`, `maxConcurrency=4`, `deadlineMs=45000`, and `now=Date.now`. The route handler parses the request method/query/body, applies the authorization matrix below, and always sends a JSON response with a safe error shape.

HTTP actions are exact:

- `GET ?action=run` — `CRON_SECRET` or admin; runs the worker.
- `GET ?action=stats` — admin only; returns `getAiQueueStats()` plus `getAiProviderBudgetStats()` with queue and budget saturation.
- `GET ?action=jobs&status=failed&limit=50&offset=0` — admin only; `status` must be one of `AI_JOB_STATES` or `all`, `limit` is clamped to 1-100, and `offset` is clamped to 0-10000.
- `POST { action: "configure", max_concurrency, hourly_token_limit, daily_token_limit, paused }` — admin only; validates and updates limits.
- `POST { action: "retry", job_id, reason }` — admin only; validates a 1-200 character printable reason with no message body and retries one dead-letter job.

---

### Task 1: Add the durable PGMQ job schema and atomic inbox enqueue RPC

**Files:**
- Create: `api/migrations/019_ai_job_queue.sql`
- Create: `api/migrations/019_ai_job_queue.rollback.sql`
- Create: `api/migrations/019_ai_job_queue.test.sql`
- Create: `scripts/test-ai-migrations.mjs`

**Interfaces:**
- Consumes: existing `chat_messages(id bigint primary key)` and `settings(key, value, updated_at)`.
- Produces: logged queue `ai_inbox_jobs`, tables `ai_jobs` and `ai_job_attempts`, chat status columns, and the exact queue/job RPC names listed below.

- [ ] **Step 1: Write the migration test before the migration**

Create `api/migrations/019_ai_job_queue.test.sql` with real schema assertions:

```sql
DO $$
DECLARE
  queue_row record;
BEGIN
  IF to_regclass('public.ai_jobs') IS NULL THEN
    RAISE EXCEPTION 'public.ai_jobs is missing';
  END IF;
  IF to_regclass('public.ai_job_attempts') IS NULL THEN
    RAISE EXCEPTION 'public.ai_job_attempts is missing';
  END IF;
  SELECT * INTO queue_row FROM pgmq.list_queues() WHERE queue_name = 'ai_inbox_jobs';
  IF queue_row IS NULL THEN
    RAISE EXCEPTION 'logged queue ai_inbox_jobs is missing';
  END IF;
  IF has_table_privilege('anon', 'public.ai_jobs', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'anon must not have ai_jobs privileges';
  END IF;
  IF has_table_privilege('authenticated', 'public.ai_jobs', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'authenticated must not have ai_jobs privileges';
  END IF;
  IF to_regprocedure('public.enqueue_inbox_ai_job(text,text,text,text,text,text,smallint,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'enqueue_inbox_ai_job signature mismatch';
  END IF;
  IF to_regprocedure('public.get_ai_job(uuid)') IS NULL THEN
    RAISE EXCEPTION 'get_ai_job signature mismatch';
  END IF;
  IF to_regprocedure('public.list_ai_jobs(text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'list_ai_jobs signature mismatch';
  END IF;
END $$;
```

- [ ] **Step 2: Add the disposable local migration runner**

Create `scripts/test-ai-migrations.mjs` and run it only with a local PostgreSQL client (`psql`) and a loopback admin URL. It must parse `VOICEBOX_TEST_ADMIN_DATABASE_URL`, accept only `localhost`, `127.0.0.1`, or `[::1]`, create a database named `voicebox_ai_test_<pid>`, apply `001` through the selected migration in filename order with `ON_ERROR_STOP=1`, run the selected `.test.sql`, and always terminate/drop the temporary database.

```js
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(projectRoot, "api", "migrations");
const selectedPrefix = process.argv[2] ?? "";
const adminUrl = process.env.VOICEBOX_TEST_ADMIN_DATABASE_URL ?? "";

if (!/^\d{3}_[a-z0-9_]+$/.test(selectedPrefix)) {
  throw new Error("Pass a migration prefix such as 019");
}
if (!adminUrl) {
  throw new Error("VOICEBOX_TEST_ADMIN_DATABASE_URL is required");
}

const parsedAdminUrl = new URL(adminUrl);
if (!new Set(["postgresql:", "postgres:"]).has(parsedAdminUrl.protocol)) {
  throw new Error("VOICEBOX_TEST_ADMIN_DATABASE_URL must be a PostgreSQL URL");
}
if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsedAdminUrl.hostname)) {
  throw new Error("Migration tests refuse a non-loopback database");
}

const migrationNames = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .filter((name) => !name.includes(".rollback.") && !name.includes(".test."))
  .sort();
const selectedName = `${selectedPrefix}.sql`;
if (!migrationNames.includes(selectedName)) {
  throw new Error(`Migration ${selectedName} was not found`);
}
const testFile = join(migrationsDirectory, `${selectedPrefix}.test.sql`);
if (!statSync(testFile).isFile()) {
  throw new Error(`Test SQL ${testFile} was not found`);
}

function psql(url, args) {
  const result = spawnSync("psql", ["--set=ON_ERROR_STOP=1"].concat(args, [url]), {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `psql exited ${result.status}`);
  }
  return result.stdout;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

const database = `voicebox_ai_test_${process.pid}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${database}`;
let databaseCreated = false;
try {
  psql(adminUrl, ["--command", `CREATE DATABASE ${quoteIdentifier(database)}`]);
  databaseCreated = true;
  for (const migrationName of migrationNames.slice(0, migrationNames.indexOf(selectedName) + 1)) {
    const migrationFile = join(migrationsDirectory, migrationName);
    if (!statSync(migrationFile).isFile()) {
      throw new Error(`Migration file ${migrationFile} is not a regular file`);
    }
    psql(databaseUrl.toString(), ["--file", migrationFile]);
  }
  psql(databaseUrl.toString(), ["--file", testFile]);
  console.log(`PASS ${selectedPrefix}: migration SQL and test SQL passed`);
} finally {
  if (databaseCreated) {
    try {
      psql(adminUrl, [
        "--command",
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
      ]);
    } finally {
      psql(adminUrl, ["--command", `DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`]);
      console.log(`DROPPED ${database}`);
    }
  }
}
```

Use `readdirSync`, `statSync`, and explicit file paths in the implementation; do not execute SQL from a network response or interpolate a caller-provided filename.

- [ ] **Step 3: Run the migration test and verify RED**

Run:

```powershell
node scripts/test-ai-migrations.mjs 019
```

Expected: non-zero exit with `public.ai_jobs is missing`.

- [ ] **Step 4: Write migration 019 tables and constraints**

`api/migrations/019_ai_job_queue.sql` must begin exactly:

```sql
CREATE EXTENSION IF NOT EXISTS pgmq;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'ai_inbox_jobs'
  ) THEN
    PERFORM pgmq.create('ai_inbox_jobs');
  END IF;
END $$;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_job_id uuid,
  ADD COLUMN IF NOT EXISTS ai_error_code text;

CREATE TABLE IF NOT EXISTS public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_msg_id bigint UNIQUE,
  job_type text NOT NULL DEFAULT 'inbox.reply' CHECK (job_type = 'inbox.reply'),
  thread_id text NOT NULL,
  source_message_id bigint NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','retrying','succeeded','failed','cancelled')),
  priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  cancel_reason text,
  retry_requested_by text,
  retry_reason text,
  provider_id text,
  provider_model text,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  last_error_code text,
  last_error_message text,
  deferral_count integer NOT NULL DEFAULT 0 CHECK (deferral_count >= 0),
  last_deferred_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'succeeded' OR completed_at IS NOT NULL),
  CHECK (status <> 'failed' OR dead_lettered_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_source_message_uq
  ON public.ai_jobs(source_message_id);
CREATE INDEX IF NOT EXISTS ai_jobs_claimable_idx
  ON public.ai_jobs(run_after, priority, created_at)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS ai_jobs_thread_status_idx
  ON public.ai_jobs(thread_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_jobs_dead_letter_idx
  ON public.ai_jobs(dead_lettered_at, priority)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS ai_jobs_deferred_recent_idx
  ON public.ai_jobs(last_deferred_at)
  WHERE last_deferred_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_ai_job_idx
  ON public.chat_messages(ai_job_id)
  WHERE ai_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ai_jobs(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  attempt_no integer NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled')),
  provider_id text,
  provider_model text,
  http_status integer,
  error_code text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(job_id, generation, attempt_no)
);

CREATE INDEX IF NOT EXISTS ai_job_attempts_job_started_idx
  ON public.ai_job_attempts(job_id, started_at DESC);
```

Add the `chat_messages_ai_status_check`, `chat_messages_ai_job_fkey`, and all queue RPC grants idempotently with `DO` blocks that inspect `pg_constraint`; do not use unsupported `ADD CONSTRAINT IF NOT EXISTS`. Define `chat_messages.ai_job_id` with `ON DELETE SET NULL` so deleting a source message cannot be blocked by the reciprocal `ai_jobs.source_message_id` cascade.

- [ ] **Step 5: Implement the atomic enqueue RPC**

Implement this exact signature in `public`:

```sql
enqueue_inbox_ai_job(
  p_thread_id text,
  p_sender text,
  p_body text,
  p_attachment_url text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_priority smallint,
  p_payload jsonb,
  p_cancel_reason text
) returns table(duplicate boolean, message jsonb, ai_job jsonb)
```

Its transaction must:

1. Validate `p_sender IN ('user','admin')`, thread/body bounds, and non-empty idempotency/fingerprint inputs.
2. Look up `ai_jobs.idempotency_key`; on fingerprint mismatch raise SQLSTATE `22023` with `IDEMPOTENCY_KEY_REUSED`.
3. Acquire `pg_advisory_xact_lock(hashtextextended(p_thread_id, 731))` so duplicate `chat_threads` rows are not created while this feature ships before the separately approved unique-thread reconciliation.
4. Insert the `chat_messages` row once.
5. Insert an `ai_jobs` row once. If `p_cancel_reason` is non-null, set `status='cancelled'`, `cancel_reason`, `completed_at=now()`, and do not send PGMQ. Otherwise set `status='pending'`, `run_after=now()`, and call `pgmq.send('ai_inbox_jobs', jsonb_build_object('job_id', job_id), 0)`.
6. Update the source message with `ai_job_id` and `ai_status`.
7. Return `to_jsonb(message)` and `to_jsonb(job)`.

Use `SECURITY INVOKER SET search_path = pgmq, public, pg_temp`, schema-qualify every table/function, and grant execute only to `service_role`.

- [ ] **Step 6: Implement claim, attempt, heartbeat, defer, complete, fail, cancel, retry, and stats RPCs**

Create these exact signatures:

```sql
read_ai_inbox_jobs(text, integer, integer) returns table(queue_message_id bigint, job jsonb)
begin_ai_job_attempt(uuid, text, uuid, text, text) returns jsonb
heartbeat_ai_job(uuid, text, uuid) returns jsonb
defer_ai_job(uuid, text, uuid, bigint, text, text, integer) returns jsonb
complete_ai_job(uuid, text, uuid, bigint, text, text, text, text, boolean, text, text, integer, integer, integer, integer) returns jsonb
fail_ai_job(uuid, text, uuid, bigint, text, text, boolean, text, text, integer, integer, integer, integer) returns jsonb
cancel_ai_jobs_for_thread(text, text) returns integer
retry_dead_ai_job(uuid, text, text) returns jsonb
get_ai_job(uuid) returns jsonb
list_ai_jobs(text, integer, integer) returns table(job jsonb)
get_ai_queue_stats() returns jsonb
```

Required transition rules:

`completeAiJob` maps its fields in this exact order: `p_job_id`, `p_worker_id`, `p_lease_token`, `p_queue_message_id`, `p_reply_body`, `p_agent`, `p_emotion`, `p_level`, `p_escalate`, `p_provider_id`, `p_provider_model`, `p_input_tokens`, `p_output_tokens`, `p_duration_ms`, `p_http_status`. `failAiJob` maps `p_job_id`, `p_worker_id`, `p_lease_token`, `p_queue_message_id`, `p_error_code`, `p_error_message`, `p_retryable`, `p_provider_id`, `p_provider_model`, `p_input_tokens`, `p_output_tokens`, `p_duration_ms`, `p_http_status`.

- `read_ai_inbox_jobs` calls `pgmq.read('ai_inbox_jobs', clamped visibility 30-300 seconds, clamped quantity 1-8)`. For every message, claim only a matching job in `pending`/`retrying`, or a `running` job whose lease expired. Terminal, cancelled, or not-due duplicates are archived without provider work. A successful claim gets a fresh `lease_token`, owner, 45-second lease, and source `ai_status='running'`.
- `begin_ai_job_attempt` verifies owner/token/status, accepts null provider metadata until a provider is selected, increments `attempts`, inserts one `ai_job_attempts` row, and refuses when `attempts >= max_attempts`; terminal store operations update the selected provider/model and usage on that row.
- `heartbeat_ai_job` extends the lease only for the owner and returns `cancel_requested`; it never changes attempt count.
- `defer_ai_job` archives the current PGMQ message, sends one replacement with the supplied 1-300 second delay, stores the replacement `queue_msg_id`, increments `deferral_count`, sets `last_deferred_at=now()`, clears the lease, keeps source status `pending`, and does not increment attempts.
- `complete_ai_job` locks the job row, verifies owner/token/status and refuses when `cancel_requested_at` is non-null; on that cancellation path it closes the attempt as `cancelled`, sets job/source to `cancelled`, and archives the PGMQ message without inserting an AI reply. The normal path inserts exactly one AI `chat_messages` row, updates `inbox_state:<thread_id>` under the same thread advisory lock, sets job/source to `succeeded`, closes the attempt row, and archives the PGMQ message in one transaction.
- `fail_ai_job` closes the active attempt when one exists; it also accepts a pre-provider failure before `begin_ai_job_attempt`, records that failed attempt with null provider fields, and applies the same retry/dead-letter policy. `last_error_message` stores only a bounded operator-safe sentence, never a provider body, stack trace, or raw upstream error. Retryable failures below `max_attempts` become `retrying` with `run_after` and a delayed replacement PGMQ message whose `queue_msg_id` is stored; all other failures become terminal `failed` with `dead_lettered_at`. The terminal path archives the message and sets source `ai_status='failed'` with a safe error code.
- `cancel_ai_jobs_for_thread` cancels pending/retrying rows immediately and sets `cancel_requested_at` for running rows. It updates source messages to `cancelled` immediately; an in-flight worker observes the flag and aborts its provider signal, and a racing completion cannot insert a reply after that flag is set.
- `retry_dead_ai_job` accepts only `failed`, requires a 1-200 character printable reason with no message body and an authenticated requester, stores `retry_requested_by` and `retry_reason`, increments `generation`, resets attempts to zero, clears `dead_lettered_at`, `last_error_code`, `last_error_message`, and the old `queue_msg_id`, sets `pending`, updates source status, and sends a new PGMQ message. It never deletes attempt history.
- `get_ai_job` returns the current service-role job row for an internal authorization check; the inbox handler projects only the safe `AiJobSummary` fields and never returns idempotency keys, payloads, thread text, or raw errors.
- `list_ai_jobs` accepts `status='all'` or one `AI_JOB_STATES` value, clamps `limit` to 1-100 and `offset` to 0-10000, orders by `created_at DESC, id DESC`, and returns safe summary JSON only.
- `get_ai_queue_stats` returns counts for every `AI_JOB_STATES` value, total, oldest pending age, dead-letter count, and the number of jobs whose `last_deferred_at` is within the last hour.

Every 019 and 020 RPC uses `SECURITY INVOKER SET search_path = pgmq, public, pg_temp`, schema-qualifies every table and function, and grants execute only to `service_role`.

- [ ] **Step 7: Add RLS and service-role-only grants**

Apply RLS to `ai_jobs` and `ai_job_attempts`, create `service_role_all` policies for both, revoke all table/function privileges from `PUBLIC`, `anon`, and `authenticated`, grant `USAGE` on the `pgmq` schema only to `service_role`, revoke client execute privileges on PGMQ functions, grant `service_role` execute on only the PGMQ operations used by the wrappers (`read`, `archive`, and `send`), and grant execute on only these 019 functions: `enqueue_inbox_ai_job`, `read_ai_inbox_jobs`, `begin_ai_job_attempt`, `heartbeat_ai_job`, `defer_ai_job`, `complete_ai_job`, `fail_ai_job`, `cancel_ai_jobs_for_thread`, `retry_dead_ai_job`, `get_ai_job`, `list_ai_jobs`, and `get_ai_queue_stats`. Also revoke client access to the `pgmq` schema; the public wrappers are the only server entry points.

- [ ] **Step 8: Write the guarded rollback**

`019_ai_job_queue.rollback.sql` must first raise an exception if any job is `pending`, `running`, or `retrying`. After the operator drains/cancels work, it drops the 019 RPCs, the chat-message FK/check, `ai_job_attempts`, `ai_jobs`, the three chat columns, and finally calls:

```sql
SELECT pgmq.drop_queue('ai_inbox_jobs');
```

Do not drop the `pgmq` extension; another queue may use it later.

- [ ] **Step 9: Run migration and concurrency tests**

Run:

```powershell
node scripts/test-ai-migrations.mjs 019
```

Expected: exit 0 and the runner reports the temporary database was dropped. Then run two concurrent `read_ai_inbox_jobs` calls against one queued job and prove exactly one returns it while the other archives the duplicate or returns no claim.

- [ ] **Step 10: Commit after the human commit gate**

```powershell
git add api/migrations/019_ai_job_queue.sql api/migrations/019_ai_job_queue.rollback.sql api/migrations/019_ai_job_queue.test.sql scripts/test-ai-migrations.mjs
git commit -m "feat(db): add durable inbox ai job queue"
```

### Task 2: Add global provider slots and token budgets

**Files:**
- Create: `api/migrations/020_ai_provider_budget.sql`
- Create: `api/migrations/020_ai_provider_budget.rollback.sql`
- Create: `api/migrations/020_ai_provider_budget.test.sql`

**Interfaces:**
- Consumes: migration 019 and the existing provider call sites.
- Produces: `ai_runtime_limits`, `ai_provider_slots`, `ai_budget_buckets`, and atomic global acquire/settle/release/configuration/stats RPCs.

- [ ] **Step 1: Write the budget migration test**

`020_ai_provider_budget.test.sql` must assert the default row, eight slots, zero client grants, service-role function grants, and behavior:

```sql
DO $$
DECLARE
  limits_row public.ai_runtime_limits%ROWTYPE;
BEGIN
  SELECT * INTO limits_row FROM public.ai_runtime_limits WHERE id = true;
  IF limits_row.max_concurrency <> 4 THEN
    RAISE EXCEPTION 'default max_concurrency must be 4';
  END IF;
  IF limits_row.hourly_token_limit <> 1000000 THEN
    RAISE EXCEPTION 'default hourly_token_limit must be 1000000';
  END IF;
  IF limits_row.daily_token_limit <> 8000000 THEN
    RAISE EXCEPTION 'default daily_token_limit must be 8000000';
  END IF;
  IF (SELECT count(*) FROM public.ai_provider_slots) <> 8 THEN
    RAISE EXCEPTION 'provider slot table must contain eight rows';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_provider_slots'
      AND column_name IN ('hour_bucket_start', 'day_bucket_start')
    GROUP BY table_schema, table_name
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'provider slots must persist both UTC bucket starts';
  END IF;
  IF to_regprocedure('public.get_ai_provider_budget_stats()') IS NULL THEN
    RAISE EXCEPTION 'get_ai_provider_budget_stats signature mismatch';
  END IF;
END $$;
```

- [ ] **Step 2: Run the budget test and verify RED**

```powershell
node scripts/test-ai-migrations.mjs 020
```

Expected: non-zero exit with `relation public.ai_runtime_limits does not exist`.

- [ ] **Step 3: Write the budget tables and default row**

```sql
CREATE TABLE IF NOT EXISTS public.ai_runtime_limits (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_concurrency integer NOT NULL DEFAULT 4 CHECK (max_concurrency BETWEEN 1 AND 8),
  hourly_token_limit bigint NOT NULL DEFAULT 1000000 CHECK (hourly_token_limit >= 10000),
  daily_token_limit bigint NOT NULL DEFAULT 8000000 CHECK (daily_token_limit >= hourly_token_limit),
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ai_runtime_limits
  (id, max_concurrency, hourly_token_limit, daily_token_limit, paused)
VALUES
  (true, 4, 1000000, 8000000, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_provider_slots (
  slot_no smallint PRIMARY KEY CHECK (slot_no BETWEEN 0 AND 7),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  job_id uuid REFERENCES public.ai_jobs(id) ON DELETE SET NULL,
  purpose text,
  priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  estimated_tokens integer NOT NULL DEFAULT 0 CHECK (estimated_tokens >= 0),
  reserved_tokens integer NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  hour_bucket_start timestamptz,
  day_bucket_start timestamptz,
  acquired_at timestamptz,
  CHECK ((hour_bucket_start IS NULL) = (day_bucket_start IS NULL))
);

CREATE TABLE IF NOT EXISTS public.ai_budget_buckets (
  period text NOT NULL CHECK (period IN ('hour','day')),
  bucket_start timestamptz NOT NULL,
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(period, bucket_start)
);
```

Seed slot numbers 0 through 7 with `generate_series(0, 7)` and `ON CONFLICT DO NOTHING`. A slot is eligible when `slot_no < ai_runtime_limits.max_concurrency`; the default therefore makes slots 0 through 3 eligible and keeps slots 4 through 7 available for a later admin increase.

- [ ] **Step 4: Implement atomic provider-slot RPCs**

Create these exact functions:

```sql
acquire_ai_provider_slot(text, text, uuid, smallint, integer, integer) returns jsonb
settle_ai_provider_slot(smallint, uuid, integer, integer, boolean) returns jsonb
release_ai_provider_slot(smallint, uuid) returns jsonb
configure_ai_provider_budget(integer, bigint, bigint, boolean) returns jsonb
get_ai_provider_budget_stats() returns jsonb
```

`acquire_ai_provider_slot(text owner, text purpose, uuid job_id, smallint priority, integer estimated_tokens, integer lease_ms)` must:

1. Clamp `estimated_tokens` to 1-4000, `lease_ms` to 5000-30000, and `priority` to 0-100.
2. Lock the singleton `ai_runtime_limits` row `FOR UPDATE` to serialize decisions.
3. Convert expired leases into conservative spent reservations: decrement `reserved_tokens` and add the original `reserved_tokens` to `spent_tokens` in both stored `hour_bucket_start` and `day_bucket_start` rows, then clear the slot. An expired unknown call is charged, not refunded.
4. Compute `date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'` and `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.
5. Return `{allowed:false, code:'BUDGET_PAUSED'}` when paused, `{allowed:false, code:'CONCURRENCY_FULL', retryAfterMs:250}` when no slot with `slot_no < max_concurrency` is free, and `{allowed:false, code:'TOKEN_BUDGET_EXHAUSTED', retryAfterMs:<maximum-ms-to-hour-or-day-reset>}` when either bucket would exceed its limit.
6. Select one free eligible slot with `FOR UPDATE SKIP LOCKED`, reserve estimated tokens in both current UTC buckets, store both bucket starts on the slot, and return `{allowed:true, slotNumber, leaseToken, leaseExpiresAt}`.

`settle_ai_provider_slot` must verify slot/token, use the stored `hour_bucket_start` and `day_bucket_start` values to remove the reservation from both buckets, add `max(inputTokens + outputTokens, estimated_tokens)` when usage is known, or add the original estimate when `charge_unknown=true`, then clear the lease and both bucket-start columns. It is idempotent for an already-cleared slot. `release_ai_provider_slot` removes a reservation without spending it, clears the lease and both bucket-start columns, and is also idempotent. Lowering `max_concurrency` never kills an active provider call; it prevents new acquisitions until active leases settle, and the stats endpoint exposes that temporary saturation.

- [ ] **Step 5: Add RLS, grants, indexes, and rollback**

`get_ai_provider_budget_stats` is read-only: it reports active and expired lease counts plus current UTC bucket totals without mutating rows. Acquisition performs the locked expiry sweep before selecting a slot. `configure_ai_provider_budget` validates `max_concurrency` in 1-8, rejects a daily limit below the hourly limit, and rejects a new token limit below any current `reserved_tokens + spent_tokens` in the affected UTC buckets. The route maps validation failures to a safe `400` response and never partially updates the singleton row. Enable RLS on all three tables, add `service_role_all` policies, revoke client privileges, and grant execute on only `acquire_ai_provider_slot`, `settle_ai_provider_slot`, `release_ai_provider_slot`, `configure_ai_provider_budget`, and `get_ai_provider_budget_stats` to `service_role`. Keep the primary-key index on `ai_budget_buckets(period, bucket_start)` and add `ai_provider_slots(lease_expires_at)` for expiry sweeps; do not create a duplicate bucket index. The rollback refuses while any slot is active, then drops 020 functions/tables but does not alter migration 019.

- [ ] **Step 6: Run migration tests and prove global limits**

```powershell
node scripts/test-ai-migrations.mjs 020
```

Prove with concurrent SQL sessions that only four slots can be acquired at the default limit, the fifth returns `CONCURRENCY_FULL`, an over-limit estimate returns `TOKEN_BUDGET_EXHAUSTED`, and settlement moves reserved tokens to spent without double counting a replayed settle.

- [ ] **Step 7: Commit after the human commit gate**

```powershell
git add api/migrations/020_ai_provider_budget.sql api/migrations/020_ai_provider_budget.rollback.sql api/migrations/020_ai_provider_budget.test.sql
git commit -m "feat(db): add global ai provider budgets"
```

### Task 3: Implement the job-store adapter

**Files:**
- Create: `api/_ai-job-store.js`
- Create: `tests/api/ai-job-queue.test.ts`

**Interfaces:**
- Consumes: the 019 job RPCs and the 020 budget-configuration RPC.
- Produces: the exact `api/_ai-job-store.js` public interface from this plan.

- [ ] **Step 1: Write failing adapter tests**

Mock `supabase.rpc` and assert exact argument names and bounded values:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../api/_db-client.js", () => ({
  default: { rpc: mocks.rpc },
}));

describe("AI job store", () => {
  beforeEach(() => vi.resetModules());

  it("reads no more than eight jobs and clamps visibility to 300 seconds", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const store = await import("../../api/_ai-job-store.js");
    await store.readClaimableAiJobs({
      workerId: "worker-1",
      limit: 99,
      visibilitySeconds: 999,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("read_ai_inbox_jobs", {
      p_worker_id: "worker-1",
      p_limit: 8,
      p_visibility_seconds: 300,
    });
  });

  it("uses exact exponential retry delays", async () => {
    const store = await import("../../api/_ai-job-store.js");
    expect(store.aiBackoffSeconds(1)).toBe(15);
    expect(store.aiBackoffSeconds(2)).toBe(30);
    expect(store.aiBackoffSeconds(3)).toBe(60);
  });
});
```

Add cases for enqueue replay, `22023` mapping to `IdempotencyError`, owner/token arguments on every mutation, `get_ai_job` safe-row normalization, `list_ai_jobs` status/limit/offset clamping, queue stats, budget configuration, and unknown RPC errors.

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm run test:api -- tests/api/ai-job-queue.test.ts
```

Expected: FAIL because `api/_ai-job-store.js` does not exist.

- [ ] **Step 3: Implement checked RPC adapters**

Every adapter must throw on `error`, convert a single returned row to an object, fill missing `AI_JOB_STATES` counters with zero, and export `IdempotencyError`. Use snake-case RPC parameters exactly:

```js
export class IdempotencyError extends Error {
  constructor() {
    super("Idempotency-Key was already used for a different inbox message.");
    this.name = "IdempotencyError";
    this.code = "IDEMPOTENCY_KEY_REUSED";
  }
}
```

Do not catch and replace database errors with success. Do not fall back to a settings JSON queue.

- [ ] **Step 4: Run the test and verify GREEN**

```powershell
npm run test:api -- tests/api/ai-job-queue.test.ts
```

Expected: all adapter tests pass.

- [ ] **Step 5: Commit after the human commit gate**

```powershell
git add api/_ai-job-store.js tests/api/ai-job-queue.test.ts
git commit -m "feat(api): add durable ai job store adapter"
```

### Task 4: Enforce global budget and cancellation inside every provider lane

**Files:**
- Create: `api/_ai-budget.js`
- Create: `tests/api/ai-provider-budget.test.ts`
- Modify: `api/_providers.js:840-1485`
- Modify: `tests/api/providers.test.ts`
- Modify: `tests/api/provider-degraded.test.ts`

**Interfaces:**
- Consumes: 020 RPCs and provider definitions already exported by `_providers.js`.
- Produces: `callLLMJson`, global budget enforcement for batch/fast/stream lanes, and backward-compatible `callLLMChain`.

- [ ] **Step 1: Write failing budget-adapter tests**

```ts
it("estimates prompt plus output tokens", async () => {
  const budget = await import("../../api/_ai-budget.js");
  expect(
    budget.estimatePromptTokens(
      [
        { role: "system", content: "abcd" },
        { role: "user", content: "abcdefgh" },
      ],
      400,
    ),
  ).toBe(403);
});
```

Mock `acquire_ai_provider_slot` to return denial and assert `acquireProviderAttempt` returns `allowed:false` without throwing. Mock successful acquire/settle and assert token values are passed unchanged. Mock `get_ai_provider_budget_stats` and assert `getAiProviderBudgetStats` normalizes the safe counters and reset timestamps.

- [ ] **Step 2: Replace the copied provider-chain test with a real-module test**

In `tests/api/providers.test.ts`, remove the local `PROVIDER_DEFS`, `testProvider`, `callProviderWithTimeout`, and copied `callLLMChain`. Import the real `buildChain` and `callLLMJson`, mock only `_db-client.js` and `_ai-budget.js`, and prove:

- OpenAI-compatible and Anthropic request bodies still parse correctly.
- A real provider `429` retries once inside one 20-second deadline.
- A real provider `503` retries once.
- A `401` fails over to the next configured provider.
- An external `AbortSignal` cancels fetch and returns `code:'CANCELLED'`.
- A timeout returns `code:'TIMEOUT'` and never returns a fabricated text response.
- A supplied `providerLease` is reused through the complete chain and `acquire_ai_provider_slot` is called zero additional times.
- A budget denial returns `code:'BUDGET_DENIED'` before `fetch` is called.

- [ ] **Step 3: Run the provider tests and verify RED**

```powershell
npm run test:api -- tests/api/ai-provider-budget.test.ts tests/api/providers.test.ts tests/api/provider-degraded.test.ts
```

Expected: FAIL because `_ai-budget.js` and `callLLMJson` do not exist.

- [ ] **Step 4: Implement the budget adapter**

`acquireProviderAttempt` calls `acquire_ai_provider_slot`; `settleProviderAttempt` sends `inputTokens + outputTokens` and lets the database charge the greater of reported usage and the original reservation; `releaseProviderAttempt` calls `release_ai_provider_slot`. All cleanup is idempotent and runs in `finally`.

`estimatePromptTokens(messages, maxOutputTokens)` is exactly:

```js
export function estimatePromptTokens(messages, maxOutputTokens) {
  const inputCharacters = messages.reduce(
    (sum, message) => sum + String(message.content ?? "").length,
    0,
  );
  return Math.max(1, Math.ceil(inputCharacters / 4) + maxOutputTokens);
}
```

- [ ] **Step 5: Add one bounded provider-attempt primitive**

Inside `_providers.js`, create an internal `runProviderAttempt` that:

1. Uses `options.providerLease` when the caller already acquired a lease; otherwise acquires one global slot with estimated input plus `maxOutputTokens`.
2. Returns `BUDGET_DENIED` immediately when an acquisition is denied; an existing lease is never acquired again.
3. Combines the caller signal with `AbortSignal.timeout(effectiveTimeoutMs)`.
4. Applies `maskPII` before serialization.
5. Uses at most two HTTP attempts for `429`/`503`, sharing one deadline.
6. Parses provider output and usage.
7. When it owns the lease, settles with actual usage or the original conservative estimate; when `options.providerLease` is supplied, leaves settlement to the outer `callLLMJson` owner.
8. Releases an unspent reservation when the fetch was never started, and makes every settle/release path idempotent.

Use `AbortSignal.any` because Node 22 is the declared runtime floor.

- [ ] **Step 6: Route all outbound lanes through the primitive**

- `callProvider` uses `runProviderAttempt` and no longer calls `acquireNimSlot`/`releaseNimSlot`.
- `nvidiaFastOnce` uses the primitive; fast-model hedging may request several slots but can never exceed the global cap.
- `callProviderStream` holds one slot for the full stream, aborts on caller signal/TTFB/total timeout, estimates streamed output from accumulated text when the provider omits usage, and settles in `finally`.
- Remove the per-instance NIM active counter and queue because they are no longer authoritative; keep provider cooldown maps as a local optimization only.

- [ ] **Step 7: Implement `callLLMJson` and preserve `callLLMChain`**

`callLLMJson` validates option bounds, passes an existing `providerLease` through to `runProviderAttempt` when present, acquires and releases a lease for ordinary callers, uses only fresh configured providers, returns safe per-provider attempt metadata plus safe token counts on both success and failure, and never returns provider error text. `callLLMChain` delegates to it with `maxOutputTokens=2048`, `timeoutMs=30000`, and preserves `{ok:false,degraded:true,error:'AI PROVIDER DEGRADED — no API key configured'}` when no key exists.

- [ ] **Step 8: Run focused and existing provider tests**

```powershell
npm run test:api -- tests/api/ai-provider-budget.test.ts tests/api/providers.test.ts tests/api/providers-authz.test.ts tests/api/provider-degraded.test.ts
```

Expected: all pass, with no copied provider implementation left in the test file.

- [ ] **Step 9: Commit after the human commit gate**

```powershell
git add api/_ai-budget.js api/_providers.js tests/api/ai-provider-budget.test.ts tests/api/providers.test.ts tests/api/provider-degraded.test.ts
git commit -m "feat(ai): bound and budget provider attempts globally"
```

### Task 5: Combine inbox classification and reply into one validated worker operation

**Files:**
- Create: `api/_ai-inbox-worker.js`
- Create: `tests/api/ai-inbox-worker.test.ts`
- Modify: `tests/api/inbox-classify.test.ts`

**Interfaces:**
- Consumes: `callLLMJson`, an already-acquired `ProviderAttemptLease`, `triageInboxMessage`, authenticated `chat_messages` and `settings` reads.
- Produces: the exact `api/_ai-inbox-worker.js` interface from this plan, including one preparation call and one provider call per ready job.

- [ ] **Step 1: Write failing keyword and output-validation tests**

Cover Hindi/Gujarati/Bengali distress keywords, critical override, prompt injection in model output, missing reply, overlong reply, unknown level/emotion/agent, and fenced JSON. Assert that `prepareInboxAiJob` loads no more than six recent messages oldest-to-newest, bounds the source body to 800 characters, and returns `kind:"ready"` with a token estimate only after the source and settings checks pass. The critical test must assert model output `agent:"general"` still returns `agent:"emotional"` and `level:"critical"`.

- [ ] **Step 2: Write the one-call and cancellation tests**

Mock `prepareInboxAiJob` and `callLLMJson` and assert:

- A normal text message prepares once, then calls `callLLMJson` once with the prepared context.
- The request asks for exactly `level`, `emotion`, `agent`, `reply`, and `escalate` under `inbox.combined.v1`.
- At most six recent messages are loaded, oldest-to-newest, and current message content is bounded to 800 characters.
- `handoff:true`, global AI off, user AI off, or a deleted source message returns `kind:"cancel"` from preparation with zero provider calls.
- A budget denial returns `kind:"defer"` and does not parse model text.
- An already-aborted signal is passed to preparation and provider calls and returns `kind:"fail", code:"CANCELLED"`.

- [ ] **Step 3: Run the test and verify RED**

```powershell
npm run test:api -- tests/api/ai-inbox-worker.test.ts
```

Expected: FAIL because `api/_ai-inbox-worker.js` does not exist.

- [ ] **Step 4: Implement deterministic classification normalization**

Use these exact mappings:

```js
const KEYWORD_LEVELS = Object.freeze({
  critical: "critical",
  distress: "high",
  anxious: "moderate",
  sad: "moderate",
  positive: "none",
});
```

Critical always maps emotion to `critical_distress` and agent to `emotional`. Other keyword matches use the existing emotion word, normalized level, and `emotional` agent except `positive`, which uses `general`.

- [ ] **Step 5: Implement strict combined-output parsing**

Extract the first balanced JSON object rather than a greedy `/\{[\s\S]*\}/` match. Allow only:

```js
const LEVELS = new Set(["none", "mild", "moderate", "high", "critical"]);
const EMOTIONS = new Set(["neutral", "frustrated", "anxious", "sad", "angry", "positive"]);
const AGENTS = new Set(["general", "emotional"]);
```

Require a trimmed reply between 1 and 800 characters. When a keyword classification exists, it overrides model classification. When no keyword exists, invalid individual fields fall back to `level:'none'`, `emotion:'neutral'`, and `agent:'general'`; a missing or invalid reply is `INVALID_MODEL_OUTPUT` and is retryable.

- [ ] **Step 6: Implement the worker preparation and provider call**

Implement `prepareInboxAiJob` to load at most six messages, settings state, source message, and AI config, reject deleted/disabled/handoff sources before provider work, and return a ready context plus a conservative token estimate. Map persisted `sender='ai'` history rows to the provider role `assistant` while retaining the database sender in the typed history item. `processClaimedInboxAiJob` accepts that context, performs one final bounded cancellation/AI-off/handoff check immediately before the provider call, builds a concise system prompt that includes the general/emotional agent rules, crisis rule, PII prohibition, 100-word reply cap, and strict JSON schema, and does not reread the thread. The function owns `input.providerLease`: if it returns before calling the provider, it releases that lease; once `callLLMJson` is invoked, `callLLMJson` owns and settles the lease exactly once after the complete chain. Call:

```js
callLLMJson({
  system,
  user,
  extraMessages: [],
  priority: "high",
  purpose: "inbox_combined",
  jobId: job.id,
  maxOutputTokens: 400,
  timeoutMs: 20000,
  signal,
  providerLease: input.providerLease,
});
```

Do not call `classifyEmotion`, `generateReply`, `callNvidiaFast`, or `callLLMChain` from this worker.

- [ ] **Step 7: Move the old safety tests and run GREEN**

Remove obsolete two-call helper imports from `inbox-classify.test.ts`; retain the keyword/critical assertions against `detectKeywordClassification` and `parseInboxDecision`.

```powershell
npm run test:api -- tests/api/ai-inbox-worker.test.ts tests/api/inbox-classify.test.ts tests/api/inbox-triage.test.ts
```

Expected: all pass and the provider mock is called at most once per normal job.

- [ ] **Step 8: Commit after the human commit gate**

```powershell
git add api/_ai-inbox-worker.js tests/api/ai-inbox-worker.test.ts tests/api/inbox-classify.test.ts
git commit -m "feat(ai): combine inbox classification and reply"
```

### Task 6: Add the bounded Vercel cron worker and admin controls

**Files:**
- Create: `api/_ai-jobs.js`
- Create: `tests/api/ai-jobs-cron.test.ts`
- Create: `tests/api/ai-jobs-cron-authz.test.ts`
- Modify: `api/index.js:16-293`
- Modify: `vercel.json:51-69`

**Interfaces:**
- Consumes: queue store, provider budget, combined inbox worker, and `isCronAuthorized`/`isAdmin`.
- Produces: `/api/ai-jobs` cron/admin route and a worker that finishes inside 45 seconds.

- [ ] **Step 1: Write failing worker-orchestration tests**

Use deferred promises to prove:

- No more than four claimed jobs execute concurrently.
- At most twelve jobs are claimed in one invocation.
- The 45-second deadline leaves unclaimed jobs in PGMQ.
- Budget denial defers a job without a provider call or attempt increment.
- A preparation failure records a null-provider failed attempt and follows the 15/30-second retry policy; it does not acquire a slot.
- A successful `processClaimedInboxAiJob` reuses the pre-acquired lease and never requests a second slot.
- A completed job is not processed again when its PGMQ message later reappears.
- A stale running lease is reclaimed and the source message remains one row.
- Provider timeout fails attempt 1, delays attempt 2, then dead-letters attempt 3 with source `ai_status='failed'`.
- Admin takeover cancellation aborts the signal and archives without inserting an AI reply.

- [ ] **Step 2: Write failing authorization tests**

Copy the existing incident-cron matrix: anonymous `run` is `401`, wrong secret is `401`, correct `CRON_SECRET` succeeds, admin succeeds, non-admin cannot list/configure/retry, and a denied request never calls the worker or budget RPC.

- [ ] **Step 3: Run tests and verify RED**

```powershell
npm run test:api -- tests/api/ai-jobs-cron.test.ts tests/api/ai-jobs-cron-authz.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 4: Implement the worker pool**

`runAiJobWorker` uses a queue and at most `min(maxConcurrency, 4)` workers. Read in one or more calls of at most eight jobs, stop claiming at `maxJobs` or the deadline, and process each claimed job exactly once. For every claimed job it:

1. Starts a job lease heartbeat every 1,000 ms.
2. Aborts its `AbortController` when heartbeat returns `cancelRequested:true` or the worker deadline expires.
3. Calls `prepareInboxAiJob` without acquiring a provider slot; cancellation takes the cancellation-completion path, while a preparation failure calls `failAiJob` with null provider fields so the normal attempt/dead-letter policy is preserved.
4. Calls `acquireProviderAttempt` with `prepared.estimatedTokens`; budget denial calls `deferAiJob` and consumes no attempt, using `min(300, max(1, ceil(retryAfterMs/1000)))` when the RPC supplies a delay and 30 seconds for `BUDGET_PAUSED`.
5. Calls `beginAiJobAttempt` only after a slot is available, records null provider metadata until the selected provider returns, then passes that exact `ProviderAttemptLease` and `prepared.context` to `processClaimedInboxAiJob`.
6. Calls `processClaimedInboxAiJob` once; its `callLLMJson` invocation reuses the passed lease and cannot acquire a second slot.
7. Calls exactly one terminal store operation: `completeAiJob`, `deferAiJob`, `failAiJob`, or cancellation completion; a retryable `failAiJob` receives `aiBackoffSeconds(attemptNo)` so the first two delays are exactly 15 and 30 seconds.
8. Stops the heartbeat in `finally`; it does not issue a second lease release because `processClaimedInboxAiJob` and `callLLMJson` have one idempotent lease owner.

Structured logs include `request_id`, normalized route, `job_id`, `worker_id`, safe error code, attempt, duration, token counts, and provider/model; they exclude thread text and model output. Use stable event names `ai_job_claimed`, `ai_job_deferred`, `ai_job_completed`, `ai_job_failed`, and `ai_provider_attempt`. Keep `request_id`, `job_id`, and `worker_id` in logs/traces, never in metric labels; metric labels are bounded values such as `status_class`, `provider`, `reason_code`, and `period`.

The on-call questions answered by this slice are: Is the queue backing up? Which safe reason causes retries/dead letters? Are provider slots or UTC token buckets saturated? Are user acknowledgements still below the 800 ms p95 target? Emit `ai_job_queue_depth`, `ai_job_oldest_age_seconds`, `ai_job_retries_total`, `ai_job_dead_letters_total`, `ai_provider_active_slots`, `ai_provider_saturation_total`, and `ai_provider_tokens_total` with histograms for durations and bounded reason/provider labels. Add a sampled trace span around enqueue, claim, provider attempt, and completion, and verify the fields in staging before activation.

- [ ] **Step 5: Implement the route**

`GET ?action=run` requires `isCronAuthorized(req)`. `stats`, `jobs`, `configure`, and `retry` require `isAdmin(req)`. Unknown action is `400`; non-GET/POST is `405`. Return safe job/admin summaries, never provider text or stack traces.

- [ ] **Step 6: Register route and cron**

Add:

```js
import aiJobs from "./_ai-jobs.js";
```

and:

```js
"ai-jobs": protect(aiJobs, "ai-jobs"),
```

Add to `vercel.json`:

```json
{
  "path": "/api/ai-jobs",
  "schedule": "* * * * *"
}
```

Vercel cron invokes GET in UTC. Duplicate invocations are safe because PGMQ visibility and global provider slots make claims idempotent; do not add an in-memory singleton lock.

- [ ] **Step 7: Run route and regression tests**

```powershell
npm run test:api -- tests/api/ai-jobs-cron.test.ts tests/api/ai-jobs-cron-authz.test.ts tests/api/agent-cron-registry.test.ts tests/api/incident-cron-authz.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit after the human commit gate**

```powershell
git add api/_ai-jobs.js api/index.js vercel.json tests/api/ai-jobs-cron.test.ts tests/api/ai-jobs-cron-authz.test.ts
git commit -m "feat(api): add durable ai job cron worker"
```

### Task 7: Commit inbox messages and enqueue AI work atomically

**Files:**
- Modify: `api/_inbox.js:150-427,745-1790`
- Create: `tests/api/inbox-async.test.ts`
- Modify: `tests/api/schema-contract.test.ts`

**Interfaces:**
- Consumes: `enqueueInboxAiJob`, `cancelAiJobsForThread`, `retryDeadAiJob`, `getAiJob`, `getInboxAiConfig`, and the existing auth/moderation/triage helpers.
- Produces: the exact `POST /api/inbox` and job-status contracts in this plan.

- [ ] **Step 1: Write the fast-acceptance RED test**

Mock provider modules with throwing spies, mock `enqueueInboxAiJob`, and assert a user send returns `202` with `ai.mode='queued'`, the idempotency key and SHA-256 fingerprint reach the RPC, the user message is authoritative, and neither provider spy is called.

- [ ] **Step 2: Write idempotency RED tests**

Cover same-key/same-payload replay, same-key/different-payload `409`, different keys with the same body creating two messages, and a timeout-after-commit simulation where the second request replays the original row.

- [ ] **Step 3: Write kill-switch and cancellation RED tests**

Cover global AI off, user AI off, current handoff, attachment-only input, empty body with attachment, invalid idempotency key, PII block, rate limit, and a queue RPC failure. Queue failure must return `503 AI_QUEUE_UNAVAILABLE` with `Retry-After: 5` and must not claim the message was saved unless the RPC actually returned a row.

- [ ] **Step 4: Write status authorization and admin-action RED tests**

Prove only the owning anonymous identity or an admin can read `job_status`; takeover/close cancels queued jobs; `retry_ai` retries a failed job only for an admin; ordinary users cannot retry arbitrary jobs.

- [ ] **Step 5: Run tests and verify RED**

```powershell
npm run test:api -- tests/api/inbox-async.test.ts
```

Expected: FAIL because the handler still runs inline AI and has no job status action.

- [ ] **Step 6: Replace inline user-message AI with the enqueue RPC**

Keep existing validation, profanity masking, PII moderation, rate limit, deterministic triage, and report filing. Replace the current 10-second read-before-insert for supported user sends with one `enqueueInboxAiJob` transaction. Validate `Idempotency-Key` as a 1-128 character printable ASCII token before any database write. Set `sender` from the validated request (`"user"` for this path), then compute the fingerprint from canonical JSON:

```js
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify([
      threadId,
      sender,
      body,
      attachmentUrl || null,
    ]),
  )
  .digest("hex");
```

Remove the user-send path's calls to `classifyEmotion`, `generateReply`, `isAdminOnline`, the 35-second race, fallback AI message, and `auto_reply` generation. Preserve `auto_reply:null` for compatibility. Keep the non-user admin branch on the direct insert path.

- [ ] **Step 7: Add job status and cancellation actions**

Before general admin actions, handle:

- GET `action=job_status`.
- POST `action=takeover`: after the handoff state write succeeds, call `cancelAiJobsForThread(threadId, 'admin_takeover')`.
- POST `action=close`: cancel pending AI work before/with the close state transition.
- POST `action=retry_ai`: require admin, require a 1-200 character printable reason that contains no message body, call `retryDeadAiJob`, and return the current safe job summary.

Apply the existing per-identity/IP rate limiter to `job_status`, `takeover`, `close`, and `retry_ai`; keep the service-role worker RPC path free of client throttling.

- [ ] **Step 8: Add safe logs and schema-contract fields**

Log acceptance latency, duplicate status, queue result, and safe error code with request ID. Extend `schema-contract.test.ts` with `ai_status`, `ai_job_id`, and `ai_error_code` on `chat_messages` so a migration/code drift fails locally.

- [ ] **Step 9: Run focused inbox tests**

```powershell
npm run test:api -- tests/api/inbox-async.test.ts tests/api/inbox-triage.test.ts tests/api/inbox-summaries.test.ts tests/api/inbox-admin-reply.test.ts tests/api/schema-contract.test.ts
```

Expected: all pass, with zero provider calls from `POST /api/inbox` user sends.

- [ ] **Step 10: Commit after the human commit gate**

```powershell
git add api/_inbox.js tests/api/inbox-async.test.ts tests/api/schema-contract.test.ts
git commit -m "feat(inbox): enqueue durable ai replies after commit"
```

### Task 8: Show durable pending/failed states and support idempotent client sends

**Files:**
- Modify: `src/lib/api.ts:62-68,191-448`
- Modify: `src/types/index.ts:152-168`
- Modify: `src/pages/UserChat.tsx:37-357,460-614`
- Modify: `src/pages/admin/UnifiedInbox.tsx:42-86,368-783,1020-1336`
- Create: `src/__tests__/UserChatAiJobs.test.tsx`
- Modify: `src/__tests__/UserChat.test.tsx`
- Modify: `src/__tests__/UnifiedInbox.test.tsx`

**Interfaces:**
- Consumes: the accepted-response and job-status contracts from Task 7.
- Produces: explicit `none|pending|running|succeeded|failed|cancelled` UI state without new polling.

- [ ] **Step 1: Write failing UserChat acceptance tests**

Mock a `202` response with `auto_reply:null`, `message.ai_status='pending'`, and a queued job. Assert:

- The input clears after the fast response.
- Exactly one optimistic/confirmed user bubble remains.
- `AI reply queued` appears in a polite live region.
- Send becomes enabled again immediately.
- No request remains in a typing state.

Then simulate a Realtime `chat_messages` update for the same thread with `ai_status='running'`, then an AI reply insert, and assert the status changes without a page timer.

- [ ] **Step 2: Write failing failure/cancellation tests**

Render a thread with:

- `pending` user message: queue label.
- `running` user message: composing label.
- `failed` user message: `AI reply unavailable. Your message is saved for an admin.`
- `cancelled` user message plus handoff state: `AI replies are paused; an admin will respond.`
- succeeded user message with an AI reply: no stale pending label.

Assert labels use `role='status'` or `aria-live='polite'` and do not rely on color alone.

- [ ] **Step 3: Write failing timeout and idempotency tests**

Simulate a network timeout after the server committed, retry exactly once with the same `Idempotency-Key` and canonical body/attachment, and assert the response is the original message/job with no second database row; the draft is not restored. If the retry itself returns `503`, retain the draft and show one explicit retry action, with no automatic retry loop. On a provably absent message, assert the draft is restored and the optimistic bubble is removed.

- [ ] **Step 4: Write failing admin dead-letter retry test**

In `UnifiedInbox.test.tsx`, render a failed user message, click `Retry AI`, assert `POST /api/inbox` with `action:'retry_ai'`, `job_id`, and a non-empty reason, then assert the local message becomes pending from the authoritative response.

- [ ] **Step 5: Run UI tests and verify RED**

```powershell
npm test -- src/__tests__/UserChatAiJobs.test.tsx src/__tests__/UserChat.test.tsx src/__tests__/UnifiedInbox.test.tsx
```

Expected: FAIL because chat types and rendering do not include durable AI status.

- [ ] **Step 6: Add request options and idempotency header**

Change the internal request signature to accept `opts.headers`. Add this public method without breaking existing two-argument callers:

```ts
postInbox: <T = unknown>(
  path: string,
  body: unknown,
  idempotencyKey?: string,
) =>
  request<T>("POST", path, body, TIMEOUT_MS, {
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  }),
```

Merge caller headers first, then apply the built-in admin/anon authentication headers so a caller cannot override authentication headers. Remove the 45-second inbox constant and the comments claiming the server generates AI inline.

- [ ] **Step 7: Add exact chat status types**

```ts
export type ChatAiStatus =
  | "none"
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ChatAiJobSummary {
  id: string;
  status: ChatAiStatus;
  attempts: number;
  max_attempts: number;
  status_url: string;
}
```

Extend `ChatMessage` with optional `ai_status`, `ai_job_id`, and `ai_error_code`.

- [ ] **Step 8: Reconcile UserChat state from the accepted response**

Generate one `crypto.randomUUID()` per send intent and retain that key with the optimistic message until the accepted response, one timeout retry, or an explicit failure. Keep the optimistic message until the response proves otherwise. Merge the accepted message and optional compatibility `auto_reply`; do not call `load()` merely to wait for AI. Derive typing/pending UI from messages with `ai_status='pending'` or `'running'`. Remove request-bound `setTyping(true/false)` behavior.

- [ ] **Step 9: Render accessible durable states**

Render a small text status under the source user message for pending, running, failed, and cancelled. Preserve the current message bubble layout. Failed copy must explicitly say the user message is saved and an admin can still respond. Do not insert a temporary AI message that could be mistaken for a real reply.

- [ ] **Step 10: Add admin retry reconciliation**

Show `Retry AI` only for an admin-selected thread with a failed AI job. Send the job ID and a fixed human reason such as `admin_manual_retry`; update the matching source message to pending from the server response. Never optimistically claim success before the POST resolves.

- [ ] **Step 11: Run UI tests and verify GREEN**

```powershell
npm test -- src/__tests__/UserChatAiJobs.test.tsx src/__tests__/UserChat.test.tsx src/__tests__/UnifiedInbox.test.tsx src/__tests__/UnifiedInboxAutoSummary.test.tsx
```

Expected: all pass with no timer or polling added.

- [ ] **Step 12: Commit after the human commit gate**

```powershell
git add src/lib/api.ts src/types/index.ts src/pages/UserChat.tsx src/pages/admin/UnifiedInbox.tsx src/__tests__/UserChatAiJobs.test.tsx src/__tests__/UserChat.test.tsx src/__tests__/UnifiedInbox.test.tsx
git commit -m "feat(ui): show durable inbox ai job states"
```

### Task 9: Document rollout, prove the full slice, and preserve rollback

**Files:**
- Modify: `docs/DEPLOY-SCHOOL.md:16-105`
- Modify: `package.json:9-22` only if a named migration-test script is added.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible local, staging, activation, observability, and rollback evidence.

- [ ] **Step 1: Update deployment documentation**

Add `019_ai_job_queue.sql`, `020_ai_provider_budget.sql`, the `/api/ai-jobs` one-minute cron, required `CRON_SECRET`, default budget commands for admins, queue metrics, and rollback order. Add symptom-based alerts for queue age, dead-letter growth, provider saturation, and acknowledgement p95, each linked to a short runbook section. Document that 019/020 must be applied in dedicated staging before code activation and that the previous Vercel deployment remains valid after additive migration.

- [ ] **Step 2: Run all focused tests sequentially**

```powershell
node scripts/test-ai-migrations.mjs 019
node scripts/test-ai-migrations.mjs 020
npm run test:api -- tests/api/ai-job-queue.test.ts tests/api/ai-provider-budget.test.ts tests/api/ai-inbox-worker.test.ts tests/api/ai-jobs-cron.test.ts tests/api/ai-jobs-cron-authz.test.ts tests/api/inbox-async.test.ts
npm test -- src/__tests__/UserChatAiJobs.test.tsx src/__tests__/UserChat.test.tsx src/__tests__/UnifiedInbox.test.tsx
```

Expected: every command exits 0.

- [ ] **Step 3: Run the complete repository gates sequentially**

```powershell
npm test
npm run test:api
npm run typecheck
npm run lint
npm run build
```

Expected: zero failures and exit code 0 for each command. Do not run these commands in parallel.

- [ ] **Step 4: Review query plans and index evidence**

On a production-sized staging copy, run `EXPLAIN (ANALYZE, BUFFERS)` for the job claim RPC, thread/status lookup, queue stats, and budget acquire RPC. Record plan, rows, latency, and buffer reads. Confirm the new claim/dead-letter/thread indexes are used. If a plan is not improved, remove the unneeded index in a new forward migration before activation; do not edit an already-applied migration.

- [ ] **Step 5: Apply 019 then 020 to dedicated staging**

Use the documented SQL Editor workflow and record the Voice Flow Supabase project ref before applying. Run the test SQL from both migrations afterward, inspect queue metrics, and verify `anon`/`authenticated` receive no table or function access.

- [ ] **Step 6: Run a staging end-to-end smoke**

1. Send a normal inbox message; record acknowledgement latency and `202` body.
2. Trigger `/api/ai-jobs?action=run` with the staging cron secret.
3. Verify one AI reply, source `ai_status='succeeded'`, one attempt on success, and archived PGMQ message.
4. Send a critical-keyword message; verify critical/emotional routing even if the mocked model disagrees.
5. Temporarily set the provider budget to one slot and exhaust the hourly budget; enqueue two messages and verify one runs while the other remains pending without burning attempts.
6. Abort a worker after claim; wait for visibility expiry and verify recovery creates at most one reply.
7. Force three provider failures; verify attempt delays 15/30 seconds, terminal failed status, retained failure code, and admin retry.
8. Take over the thread during a running call; verify provider cancellation, no AI reply, and admin-handling status.

Use a dedicated staging school/test identity and clean only test rows after evidence is recorded.

- [ ] **Step 7: Measure before/after evidence**

Record user-send p50/p95/p99, provider-call count per normal message (target one successful structured call instead of two independent calls), queue depth, oldest job age, global active slots, hourly/daily tokens, retries, dead letters, and cancellation latency. Do not claim 10,000-user support from this slice; it proves this AI path's contribution to the broader validation ladder.

- [ ] **Step 8: Document rollback triggers**

Rollback immediately for duplicate user messages/replies, unauthorized job access, `anon`/`authenticated` grants, lost committed messages, provider calls exceeding the configured global cap, budget overshoot caused by application logic, worker functions exceeding 60 seconds, or any unexplained mutation. Preserve logs, job IDs, and staging evidence.

- [ ] **Step 9: Execute rollback in the safe order after a human decision**

1. Disable `/api/ai-jobs` in the Vercel dashboard.
2. Promote the previous deployment; old synchronous inbox behavior becomes active while messages remain intact.
3. If database rollback is required, cancel/drain all nonterminal jobs.
4. Run `020_ai_provider_budget.rollback.sql` in staging first, then `019_ai_job_queue.rollback.sql`.
5. Re-run schema grants and the existing inbox/admin-reply tests.
6. Keep PGMQ installed; dropping the extension is not required for application rollback.

- [ ] **Step 10: Commit documentation after the human commit gate**

```powershell
git add docs/DEPLOY-SCHOOL.md package.json
git commit -m "docs: add ai queue rollout and rollback runbook"
```

If `package.json` did not change, stage only `docs/DEPLOY-SCHOOL.md`.

## Final Acceptance Checklist

- [ ] `POST /api/inbox` commits the user message before returning and performs no provider call in the request.
- [ ] Message + job/idempotency decision is atomic; same-key replay is safe and changed-payload replay is `409`.
- [ ] PGMQ is the logged Supabase queue; Redis and new services are absent.
- [ ] Classification and reply are one structured call on the normal path.
- [ ] Critical keyword routing cannot be weakened by model output.
- [ ] Every batch, fast, and streaming provider lane uses the global DB slot/token budget.
- [ ] Every attempt has a 20-second ceiling, shared retry deadline, and external cancellation signal.
- [ ] Budget/concurrency denial remains pending and does not burn an attempt.
- [ ] Job retries are 15/30 seconds; the third failure is a retained dead letter.
- [ ] Worker crash/replay cannot create duplicate AI replies.
- [ ] User and admin UIs show honest pending/running/failed/cancelled states with accessible text.
- [ ] User-visible failures state that the message is saved for an admin; no fake AI reply is inserted.
- [ ] Queue/admin endpoints distinguish anonymous users, thread owners, and admins.
- [ ] New tables/functions deny `anon` and `authenticated` and log no message/provider text.
- [ ] 019 and 020 have tested forward and guarded rollback paths.
- [ ] Focused tests, full unit/API suites, typecheck, lint, and build pass sequentially.
- [ ] Staging evidence records acknowledgement latency, queue depth, retries, dead letters, provider saturation, and token use.
- [ ] Production migration, deployment, activation, commit, and push each wait for their documented human gate.
