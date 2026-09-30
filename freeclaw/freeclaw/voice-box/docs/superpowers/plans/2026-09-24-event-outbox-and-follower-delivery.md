# Event Outbox and Follower Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared JSON event and follower-fan-out paths with idempotent PostgreSQL events/outbox rows, `FOR UPDATE SKIP LOCKED` workers protected by singleton leases, and durable per-recipient in-app/email/SMS delivery rows with retries, dead letters, and operational metrics.

**Architecture:** Immutable `platform_events` rows are inserted through one transactional `emit_event` RPC that also creates one `event_outbox` row per mapped agent. A dedicated event worker claims outbox rows with `FOR UPDATE SKIP LOCKED`, runs the existing read-only event agents, and completes or retries each row using a claim token. Post follows move from `settings.follows:<anon_id>` to `post_follows`; one database RPC snapshots a follower notification into `follower_notification_batches` plus one `follower_deliveries` row per enabled channel, and a separate singleton worker performs the in-app write/read-back verification, email send, or SMS send outside the originating request.

**Tech Stack:** Node.js 22 ESM, Vercel Node.js functions and cron, Supabase Postgres/PostgREST RPC, `@supabase/supabase-js` 2.99, Vitest 4, existing `logger`, `system_metrics`, `_dispatch.js`, `_notification-delivery.js`, and Vercel cron authentication conventions.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md` (approved), especially §§8.4, 9.2, 11, 15, and 16; `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`; `docs/superpowers/plans/2026-09-24-voice-box-reliability-program.md` Slice 11.

## Global Constraints

- Keep Vercel + Supabase. Add no queue service, Redis, Kafka, ORM, or runtime dependency.
- Apply additive migrations before deploying code that calls their RPCs. Never combine schema activation with a production deployment.
- Preserve the previous Vercel deployment and keep both legacy settings rows (`event_log`, `pending_agent_events`) until the new queues have passed the soak and rollback window.
- Preserve the external `/api/follows` request/response contract: `GET { follows, count }`; `POST/DELETE { success, following, follows }`; the same 400/401/403/429/500 behavior.
- Preserve `settings:notifications:<anon_id>` and `settings:notify_prefs:<anon_id>` in this slice. This work does not normalize the general notification center or preference store.
- Do not log or return notification bodies, email addresses, phone numbers, or full event payloads. Logs may include request ID, event type, aggregate type/ID, agent ID, outbox/delivery ID, channel, attempt, and safe error code.
- Event-agent work is idempotent because every currently mapped event agent is read-only. If a future mapped agent writes state, it must first add a unique side-effect key derived from `event_id`; do not silently expand `EVENT_AGENT_MAP` to a writing agent.
- Use `attempt_count` incremented at claim time. Event agents get 5 attempts; follower deliveries get 6 attempts. Backoff is 5, 10, 20, 40, 80, and 160 seconds, capped at 300 seconds.
- Worker leases are 120 seconds. A stale claimant may never complete, skip, retry, or dead-letter work after a newer claimant receives a different `claim_token`.
- Resend sends use the delivery row's unique `idempotency_key` (`follower:<batch_uuid>:<anon_id>:<channel>`) as the `Idempotency-Key`. MessageBird receives that same value as `reference` for correlation; MessageBird does not provide sender-side idempotency, so an ambiguous SMS network failure becomes a dead letter instead of an automatic resend.
- Domain writes in this slice commit before their event/follower RPC. A queue RPC failure must not turn an already-committed domain update into a false rollback: the post-status path returns an explicit safe warning, and other existing best-effort event callsites log/record the failure and keep their established success contract. Once the RPC succeeds, the event/delivery is durable and survives worker restarts.
- Queue workers stay disabled until `DELIVERY_WORKERS_ENABLED=true`; emitters may enqueue while workers are disabled so activation can be drained deliberately.
- Use exact limits: event worker claims at most 3 rows with concurrency 2 and a 20-second per-agent timeout; follower worker claims at most 12 rows with concurrency 4 and an 8-second per-delivery timeout; API history/dead-letter reads are capped at 200.
- `FOR UPDATE SKIP LOCKED` protects row claims; the `queue_worker_leases` singleton lease limits normal production execution to one active event worker and one active follower worker.
- Do not apply migrations, commit, push, deploy, or change `DELIVERY_WORKERS_ENABLED` without the human gates in `docs/QA/LOOP-STATE.json`.
- The current working tree already has user/concurrent changes in `api/_posts.js`, `api/_polls.js`, and related tests. Re-read those files immediately before editing and make surgical hunks; do not restore or overwrite unrelated work.
- Test and lint commands run sequentially, never in parallel.

## Review Focus

- **Concurrent duplicate emission:** two callers using the same idempotency key produce one immutable event and one outbox row per agent; Task 2 and Task 7 pin this.
- **Worker crash after claim:** a lease-expired row is reclaimed exactly once, and the old claim token cannot mutate the newer claim; Task 2, Task 3, Task 5, and Task 7 pin this.
- **Duplicate follower enqueue:** concurrent calls with one batch key produce one batch and one deterministic delivery set, never a second notification; Task 4 and Task 7 pin this.
- **Preference change after enqueue:** disabling status updates or a channel before execution skips every affected channel; Task 5 pins this.
- **Provider ambiguity:** a provider timeout is never reported delivered; Resend retries with its idempotency key, while an ambiguous SMS send becomes `dead` with a safe correlation reference; Task 5 pins this.

---

## File Structure

### Create

- `api/migrations/017_event_outbox.sql` — immutable events, per-agent outbox, worker leases, claim/complete/fail/requeue RPCs, legacy event/pending backfill, RLS/grants, and event queue health.
- `api/migrations/018_follower_delivery.sql` — normalized `post_follows`, follower notification batches, per-channel deliveries, enqueue/claim/complete/skip/fail/requeue RPCs, legacy-follow backfill, RLS/grants, and combined queue health.
- `api/_cron-auth.js` — constant-time Vercel cron/admin authorization shared by both worker entry points.
- `api/event-worker.js` — authenticated event-agent worker entry point and bounded runtime.
- `api/_follower-delivery.js` — provider-neutral follower dispatch classification and processing loop.
- `api/follower-delivery-worker.js` — authenticated follower delivery worker entry point and bounded runtime.
- `api/_queue-ops.js` — admin-only queue health, bounded dead-letter listing, and manual dead-row requeue endpoint.
- `tests/api/event-outbox-migration.test.ts` — static SQL contract for append-only events, unique idempotency, `SKIP LOCKED`, claim tokens, backfill, and grants.
- `tests/api/event-outbox.test.ts` — `_events.js` RPC contract, duplicate response handling, bounded reads, and callsite idempotency keys.
- `tests/api/event-agent-worker.test.ts` — singleton, success, retry, dead-letter, timeout, and stale-claim behavior.
- `tests/api/follower-delivery-migration.test.ts` — static SQL contract for follows, recipient rows, enqueue transaction, claim index, and backfill.
- `tests/api/follower-delivery.test.ts` — follow API, queue-only fan-out, worker dispatch, preference gates, provider idempotency, retries, skips, and dead letters.
- `tests/api/queue-ops.test.ts` — admin authorization, bounded health/dead-letter responses, and manual requeue.
- `tests/api/queue-sql.integration.test.ts` — real disposable-Supabase concurrency tests for duplicate emission, `SKIP LOCKED`, lease recovery, claim-token fencing, duplicate follower enqueue, and one-time claims.
- `docs/OPERATIONS-ENGINE.md` — queue contracts, worker metrics, dead-letter procedure, and activation order.
- `docs/ROLLBACK.md` — migration, worker, application, and queue-drain rollback procedures.

### Modify

- `api/_events.js` — replace in-memory dedup and settings reads/writes with `emit_event` RPC; query immutable events for dashboard reads; remove legacy `consumeAgentEvents` after worker cutover.
- `api/_follows.js` — read/write `post_follows`; replace inline fan-out with `enqueue_follower_notification` RPC; remove `getNotifyPrefs`, `sendEmail`, and `sendSms` imports.
- `api/_posts.js` — await the critical status event, enqueue follower delivery with a deterministic key, and surface queue health only through logs/metrics.
- `api/_comments.js`, `api/_inbox.js`, `api/_incidents.js`, `api/_polls.js`, `api/_reactions.js`, `api/_reports.js`, `api/_bulk-operations.js`, `api/_workforce.js`, `api/_workforce-bridge.js` — pass stable event idempotency keys and safe source/request metadata.
- `api/_agents-cron.js` — export the existing `AGENTS` map, remove event consumption/claim paths, and stop deleting events before agent execution.
- `api/_event-agents.js` — admin-gate all event reads, make trigger/replay enqueue new immutable events, and stop executing agents inline.
- `api/_incident-cron.js` — replace `settings.event_log` count with bounded event/outbox health.
- `api/_golden-workflows.js` — verify `platform_events`, `event_outbox`, and `follower_deliveries` instead of the legacy event-log settings row.
- `api/_badges.js`, `api/_export.js` — read follows from `post_follows`; keep saved items and notifications in settings.
- `api/_dispatch.js` — add optional Resend `idempotencyKey`, MessageBird `reference`, and safe retry classification fields.
- `api/index.js` — route the admin-only `queue-ops` handler.
- `vercel.json` — add one-minute cron paths and 60-second function limits for both direct worker functions.
- `.env.template` — document `CRON_SECRET`, `MESSAGEBIRD_API_KEY`, `DELIVERY_WORKERS_ENABLED`, and queue batch/timeout controls.
- `tests/api/follows.test.ts`, `tests/api/posts-full.test.ts`, `tests/api/posts-author-notify.test.ts`, `tests/api/post-removal-verify.test.ts`, `tests/api/comments-full.test.ts`, `tests/api/dispatch.test.ts`, `tests/api/badges.test.ts`, `tests/api/data-export.test.ts`, `tests/api/schema-contract.test.ts`, `tests/api/admin-gates-runtime.test.ts` — update mocks and pin new contracts.
- Existing workforce tests that mock `_events.js` — add the new `PersistedEvent` return shape only where the mock is asserted; do not change unrelated workforce behavior.

---

## Data Contracts

### Persisted event returned by `_events.js`

```js
{
  id: "uuid",
  type: "post.status_changed",
  data: { post_id: "post_123", old_status: "open", new_status: "solved" },
  timestamp: "2026-09-24T12:00:00.000Z",
  source: "api:_posts",
  request_id: "request-id-or-null",
  inserted: true,
  duplicate: false,
  agent_job_count: 2
}
```

A duplicate emission returns the same `id`, `inserted: false`, and `duplicate: true`; it never throws merely because the key already exists.

### Event emitter signature

```ts
export declare function emitEvent(
  type: string,
  data?: Record<string, unknown>,
  options?: {
    idempotencyKey: string;
    source?: string;
    requestId?: string | null;
    agentIds?: string[];
    aggregateType?: string | null;
    aggregateId?: string | null;
  },
): Promise<PersistedEvent>;

export declare function emitEventAndBridge(
  type: string,
  data?: Record<string, unknown>,
  options?: EmitEventOptions,
): Promise<PersistedEvent>;
```

`idempotencyKey` is required at every production callsite. The function rejects invalid/oversized keys and rejects on RPC failure; it never converts a database failure into a successful event object.

### Follower queue result

```js
{
  batch_id: "uuid",
  inserted: true,
  recipient_count: 42,
  delivery_count: 57,
  source_event_id: "uuid-or-null"
}
```

`notifyFollowers(postId, notification, options)` returns this result. It performs no `post_follows` scan in Node, no notification-store read/write, and no provider call.

### Stable event keys

| Callsite | Key |
|---|---|
| post created | `post.created:${data.id}` |
| post status changed | `post.status_changed:${data.id}:${data.updated_at}` |
| comment created | `comment.created:${data.id}` |
| inbox message | `inbox.message:${savedMsg.id}` |
| report filed | `user.reported:${data.id}` |
| inbox triage report | `user.reported:inbox:${savedMsg.id}:triage` |
| reaction added | `reaction.added:${insertedReaction.id}` |
| poll vote | `poll.voted:${voteRow.id}:${req.requestId}` |
| task created | `task.created:${data.id}` |
| task assigned | `task.assigned:${task.id}:${agent.id}:${claimedAt}` |
| task handoff | `task.handoff:${child.id}` |
| task completed | `task.completed:${task.id}` |
| task failed | `task.failed:${task.id}` |
| workforce control | `workforce.control:${control}:${agentIdOrDivision}:${req.requestId}` |
| approval requested/approved/rejected | `${decision}.${state}:${task.id}` |
| bulk completion | `bulk.${action}.completed:${req.requestId}` |
| incident created | `incident.created:${incident.id}` |
| follower batch | `followers.${postId}:${updatedAtOrEventId}` |

### Queue states and attempts

- `event_outbox`: `pending → processing → completed`; failure is `processing → retry_wait → processing`; exhausted failure is `dead`; admin requeue is `dead → pending`.
- `follower_deliveries`: `pending → processing → delivered|skipped`; failure is `processing → retry_wait → processing`; exhausted failure is `dead`; admin requeue is `dead → pending`.
- `attempt_count` increments in the claim RPC. A stale `processing` row with `attempt_count >= max_attempts` is dead-lettered before new claims are selected.
- Every mutating RPC requires `(id, claim_token)` and verifies both plus `status='processing'` in the same `UPDATE`.

---

### Task 1: Add the immutable event/outbox migration

**Files:**
- Create: `api/migrations/017_event_outbox.sql`
- Create: `tests/api/event-outbox-migration.test.ts`

**Interfaces:**
- Consumes: existing `settings.event_log` and `settings.pending_agent_events` JSON arrays.
- Produces: `platform_events`, `event_outbox`, `queue_worker_leases`; RPCs `emit_event`, `claim_event_outbox`, `complete_event_outbox`, `fail_event_outbox`, `requeue_dead_event_outbox`, `acquire_worker_lease`, `renew_worker_lease`, `release_worker_lease`, `get_event_queue_health`, and `get_event_stats`.

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/api/event-outbox-migration.test.ts` with an exact SQL contract test:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../api/migrations/017_event_outbox.sql", import.meta.url),
  "utf8",
);
const normalized = sql.toLowerCase();

describe("017 event outbox migration", () => {
  it("enforces immutable uniquely idempotent events", () => {
    expect(normalized).toContain("create table if not exists public.platform_events");
    expect(normalized).toContain("idempotency_key text not null unique");
    expect(normalized).toContain("platform_events_reject_mutation");
    expect(normalized).toContain("before update or delete on public.platform_events");
  });

  it("claims outbox work with SKIP LOCKED and a fencing token", () => {
    expect(normalized).toContain("for update skip locked");
    expect(normalized).toContain("claim_token = gen_random_uuid()");
    expect(normalized).toContain("lease_expires_at");
    expect(normalized).toContain("j.id = p_job_id");
    expect(normalized).toContain("j.claim_token = p_claim_token");
  });

  it("backfills both legacy event stores without deleting them", () => {
    expect(normalized).toContain("legacy_event_log");
    expect(normalized).toContain("legacy_pending_agent_events");
    expect(normalized).not.toMatch(/delete\s+from\s+settings/i);
  });

  it("keeps all new tables and RPCs service-role only", () => {
    expect(normalized).toContain("alter table public.platform_events enable row level security");
    expect(normalized).toContain("revoke all on function public.emit_event");
    expect(normalized).toContain("grant execute on function public.emit_event");
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails because the migration is absent**

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/event-outbox-migration.test.ts
```

Expected: FAIL with `ENOENT` for `api/migrations/017_event_outbox.sql`.

- [ ] **Step 3: Create the additive schema and event RPCs**

Create `api/migrations/017_event_outbox.sql` with this exact core schema and behavior. The implementation may add comments, but must not weaken these constraints:

```sql
begin;

create extension if not exists pgcrypto;

create table if not exists public.platform_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (char_length(event_type) between 1 and 120),
  aggregate_type text,
  aggregate_id text,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 256),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source text not null default 'api' check (char_length(source) between 1 and 120),
  request_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists platform_events_occurred_idx
  on public.platform_events (occurred_at desc, id desc);
create index if not exists platform_events_type_occurred_idx
  on public.platform_events (event_type, occurred_at desc, id desc);
create index if not exists platform_events_aggregate_idx
  on public.platform_events (aggregate_type, aggregate_id, occurred_at desc)
  where aggregate_id is not null;

create or replace function public.reject_platform_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'platform_events is append-only';
end;
$$;

drop trigger if exists platform_events_reject_mutation on public.platform_events;
create trigger platform_events_reject_mutation
before update or delete on public.platform_events
for each row execute function public.reject_platform_event_mutation();

create table if not exists public.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.platform_events(id) on delete restrict,
  agent_id text not null check (char_length(agent_id) between 1 and 120),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry_wait', 'completed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  claim_token uuid,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_requeued_by text,
  last_requeued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, agent_id)
);

create index if not exists event_outbox_claim_idx
  on public.event_outbox (available_at, created_at, id)
  where status in ('pending', 'retry_wait');
create index if not exists event_outbox_lease_idx
  on public.event_outbox (lease_expires_at, id)
  where status = 'processing';
create index if not exists event_outbox_dead_idx
  on public.event_outbox (dead_lettered_at desc, id desc)
  where status = 'dead';
create index if not exists event_outbox_status_created_idx
  on public.event_outbox (status, created_at desc);

create table if not exists public.queue_worker_leases (
  worker_name text primary key check (char_length(worker_name) between 1 and 120),
  lease_owner uuid not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  check (lease_expires_at > acquired_at)
);

create or replace function public.emit_event(
  p_event_type text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_agent_ids text[] default '{}'::text[],
  p_source text default 'api',
  p_request_id text default null,
  p_aggregate_type text default null,
  p_aggregate_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_occurred_at timestamptz;
  v_inserted boolean;
  v_job_count integer;
begin
  if p_event_type is null or char_length(trim(p_event_type)) not between 1 and 120 then
    raise exception 'invalid event_type';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 256 then
    raise exception 'invalid idempotency_key';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'event payload must be an object';
  end if;

  insert into public.platform_events (
    event_type, aggregate_type, aggregate_id, idempotency_key,
    payload, source, request_id
  ) values (
    trim(p_event_type), nullif(trim(p_aggregate_type), ''),
    nullif(trim(p_aggregate_id), ''), p_idempotency_key,
    p_payload, left(coalesce(nullif(trim(p_source), ''), 'api'), 120),
    nullif(left(p_request_id, 160), '')
  )
  on conflict (idempotency_key) do nothing;

  v_inserted := found;

  select e.id, e.occurred_at
    into v_event_id, v_occurred_at
  from public.platform_events e
  where e.idempotency_key = p_idempotency_key;

  insert into public.event_outbox (event_id, agent_id)
  select v_event_id, agent_id
  from (
    select distinct btrim(agent_id) as agent_id
    from unnest(coalesce(p_agent_ids, '{}'::text[])) agent_id
    where btrim(agent_id) <> ''
  ) agents
  on conflict (event_id, agent_id) do nothing;

  select count(*) into v_job_count
  from public.event_outbox j
  where j.event_id = v_event_id;

  return jsonb_build_object(
    'event_id', v_event_id,
    'inserted', v_inserted,
    'duplicate', not v_inserted,
    'occurred_at', v_occurred_at,
    'agent_job_count', v_job_count
  );
end;
$$;

create or replace function public.claim_event_outbox(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_limit integer default 3
)
returns table (
  id uuid,
  event_id uuid,
  agent_id text,
  status text,
  attempt_count integer,
  max_attempts integer,
  claim_token uuid,
  event_type text,
  payload jsonb,
  request_id text,
  source text,
  aggregate_type text,
  aggregate_id text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_lease_seconds := least(300, greatest(15, p_lease_seconds));
  p_limit := least(20, greatest(1, p_limit));

  update public.event_outbox j
     set status = 'dead',
         dead_lettered_at = now(),
         last_error_code = 'lease_expired_max_attempts',
         last_error_message = 'worker lease expired after final attempt',
         claim_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where j.status = 'processing'
     and j.lease_expires_at <= now()
     and j.attempt_count >= j.max_attempts;

  return query
  with candidates as (
    select j.id
      from public.event_outbox j
     where (
             j.status in ('pending', 'retry_wait')
             and j.available_at <= now()
           )
        or (
             j.status = 'processing'
             and j.lease_expires_at <= now()
             and j.attempt_count < j.max_attempts
           )
     order by j.available_at, j.created_at, j.id
     for update skip locked
     limit p_limit
  ), updated as (
    update public.event_outbox j
       set status = 'processing',
           attempt_count = j.attempt_count + 1,
           claim_token = gen_random_uuid(),
           claimed_by = left(p_worker_id, 120),
           claimed_at = now(),
           started_at = coalesce(j.started_at, now()),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           last_error_code = null,
           last_error_message = null,
           updated_at = now()
      from candidates c
     where j.id = c.id
     returning j.*
  )
  select u.id, u.event_id, u.agent_id, u.status, u.attempt_count,
         u.max_attempts, u.claim_token, e.event_type, e.payload,
         e.request_id, e.source, e.aggregate_type, e.aggregate_id, e.occurred_at
    from updated u
    join public.platform_events e on e.id = u.event_id
   order by u.created_at, u.id;
end;
$$;

create or replace function public.complete_event_outbox(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.event_outbox j
     set status = 'completed',
         completed_at = now(),
         lease_expires_at = null,
         last_error_code = null,
         last_error_message = null,
         updated_at = now()
   where j.id = p_job_id
     and j.claim_token = p_claim_token
     and j.status = 'processing';
  return found;
end;
$$;

create or replace function public.fail_event_outbox(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer;
  v_max integer;
  v_status text;
  v_delay integer;
begin
  select j.attempt_count, j.max_attempts
    into v_attempt, v_max
  from public.event_outbox j
  where j.id = p_job_id
    and j.claim_token = p_claim_token
    and j.status = 'processing'
  for update;

  if not found then
    return jsonb_build_object('updated', false, 'reason', 'claim_lost');
  end if;

  v_delay := least(300, (5 * power(2, greatest(v_attempt - 1, 0)))::integer);

  if v_attempt >= v_max or p_error_code = 'unknown_agent' then
    v_status := 'dead';
  else
    v_status := 'retry_wait';
  end if;

  update public.event_outbox j
     set status = v_status,
         available_at = case when v_status = 'retry_wait'
                             then now() + make_interval(secs => v_delay)
                             else j.available_at end,
         dead_lettered_at = case when v_status = 'dead' then now() else null end,
         last_error_code = left(coalesce(p_error_code, 'worker_error'), 120),
         last_error_message = left(coalesce(p_error_message, ''), 500),
         claim_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where j.id = p_job_id
     and j.claim_token = p_claim_token
     and j.status = 'processing';

  return jsonb_build_object(
    'updated', true,
    'status', v_status,
    'attempt_count', v_attempt,
    'next_delay_seconds', case when v_status = 'retry_wait' then v_delay else null end
  );
end;
$$;

create or replace function public.requeue_dead_event_outbox(
  p_job_id uuid,
  p_actor text,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.event_outbox j
     set status = 'pending',
         attempt_count = 0,
         available_at = now(),
         claim_token = null,
         claimed_by = null,
         claimed_at = null,
         lease_expires_at = null,
         started_at = null,
         completed_at = null,
         dead_lettered_at = null,
         last_error_code = null,
         last_error_message = null,
         last_requeued_by = left(coalesce(p_actor, 'admin'), 120),
         last_requeued_at = now(),
         updated_at = now()
   where j.id = p_job_id
     and j.status = 'dead';
  return found;
end;
$$;

create or replace function public.acquire_worker_lease(
  p_worker_name text,
  p_owner uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_lease_seconds := least(300, greatest(15, p_lease_seconds));
  insert into public.queue_worker_leases (
    worker_name, lease_owner, acquired_at, heartbeat_at, lease_expires_at
  ) values (
    p_worker_name, p_owner, now(), now(), now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (worker_name) do update
     set lease_owner = excluded.lease_owner,
         acquired_at = now(),
         heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where public.queue_worker_leases.lease_expires_at <= now();
  return found;
end;
$$;

create or replace function public.renew_worker_lease(
  p_worker_name text,
  p_owner uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_lease_seconds := least(300, greatest(15, p_lease_seconds));
  update public.queue_worker_leases l
     set heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where l.worker_name = p_worker_name
     and l.lease_owner = p_owner;
  return found;
end;
$$;

create or replace function public.release_worker_lease(
  p_worker_name text,
  p_owner uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.queue_worker_leases l
   where l.worker_name = p_worker_name
     and l.lease_owner = p_owner;
  return found;
end;
$$;

create or replace function public.get_event_queue_health()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with counts as (
    select
      count(*) filter (where status in ('pending', 'retry_wait')) as depth,
      count(*) filter (where status = 'processing') as processing,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'dead') as dead,
      count(*) filter (where status = 'retry_wait') as retry_wait,
      count(*) filter (where attempt_count > 1) as retried,
      min(created_at) filter (where status in ('pending', 'retry_wait', 'processing')) as oldest_at
    from public.event_outbox
  )
  select jsonb_build_object(
    'queue', 'event_agent',
    'depth', depth,
    'processing', processing,
    'completed', completed,
    'dead', dead,
    'retry_wait', retry_wait,
    'retried', retried,
    'oldest_age_seconds', case when oldest_at is null then null
      else greatest(0, extract(epoch from (now() - oldest_at))::bigint) end,
    'lease', (
      select case when count(*) = 0 then null else jsonb_agg(jsonb_build_object(
        'worker_name', worker_name,
        'heartbeat_at', heartbeat_at,
        'lease_expires_at', lease_expires_at
      )) end
      from public.queue_worker_leases
      where worker_name = 'event-agent-worker'
    )
  )
  from counts;
$$;

create or replace function public.get_event_stats()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with totals as (
    select count(*)::integer as total from public.platform_events
  ), recent as (
    select count(*)::integer as last24h
    from public.platform_events
    where occurred_at >= now() - interval '24 hours'
  ), grouped as (
    select coalesce(jsonb_object_agg(event_type, event_count), '{}'::jsonb) as by_type
    from (
      select event_type, count(*)::integer as event_count
      from public.platform_events
      where occurred_at >= now() - interval '24 hours'
      group by event_type
    ) counts_by_type
  )
  select jsonb_build_object(
    'total', totals.total,
    'last24h', recent.last24h,
    'byType', grouped.by_type,
    'lastEvent', (select max(occurred_at) from public.platform_events),
    'queue', public.get_event_queue_health()
  )
  from totals
  cross join recent
  cross join grouped;
$$;
```

After the function block, add the exact backfill and security block:

```sql
with legacy_events as (
  select
    s.id as settings_id,
    s.updated_at as row_updated_at,
    e.event,
    e.ordinality
  from public.settings s
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(s.value -> 'events') = 'array' then s.value -> 'events'
      else '[]'::jsonb
    end
  ) with ordinality as e(event, ordinality)
  where s.key = 'event_log'
), normalized as (
  select
    'legacy:event:' || md5(
      settings_id::text || ':' || ordinality::text || ':' || coalesce(event ->> 'type', '')
    ) as idempotency_key,
    case
      when event ->> 'timestamp' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then (event ->> 'timestamp')::timestamptz
      else row_updated_at
    end as occurred_at,
    left(coalesce(nullif(event ->> 'type', ''), 'legacy.unknown'), 120) as event_type,
    case
      when jsonb_typeof(event -> 'data') = 'object' then event -> 'data'
      else '{}'::jsonb
    end as payload
  from legacy_events
)
insert into public.platform_events (
  event_type, idempotency_key, payload, source, occurred_at, created_at
)
select event_type, idempotency_key, payload, 'legacy_event_log', occurred_at, occurred_at
from normalized
on conflict (idempotency_key) do nothing;

with legacy_triggers as (
  select
    s.id as settings_id,
    s.updated_at as row_updated_at,
    t.trigger,
    t.ordinality
  from public.settings s
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(s.value -> 'triggers') = 'array' then s.value -> 'triggers'
      else '[]'::jsonb
    end
  ) with ordinality as t(trigger, ordinality)
  where s.key = 'pending_agent_events'
    and coalesce(t.trigger ->> 'consumed', 'false') <> 'true'
), normalized as (
  select
    'legacy:trigger:' || md5(
      settings_id::text || ':' || ordinality::text || ':' ||
      coalesce(trigger ->> 'agent_id', '') || ':' ||
      coalesce(trigger ->> 'event_type', '') || ':' ||
      coalesce(trigger ->> 'timestamp', '')
    ) as idempotency_key,
    case
      when trigger ->> 'timestamp' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then (trigger ->> 'timestamp')::timestamptz
      else row_updated_at
    end as occurred_at,
    left(coalesce(nullif(trigger ->> 'event_type', ''), 'legacy.pending'), 120) as event_type,
    case
      when jsonb_typeof(trigger -> 'event_data') = 'object' then trigger -> 'event_data'
      else '{}'::jsonb
    end as payload,
    nullif(left(trigger ->> 'agent_id', ''), '') as agent_id
  from legacy_triggers
  where nullif(left(trigger ->> 'agent_id', ''), '') is not null
), inserted_events as (
  insert into public.platform_events (
    event_type, idempotency_key, payload, source, occurred_at, created_at
  )
  select event_type, idempotency_key, payload, 'legacy_pending_agent_events', occurred_at, occurred_at
  from normalized
  on conflict (idempotency_key) do nothing
  returning id, idempotency_key
)
insert into public.event_outbox (event_id, agent_id)
select i.id, n.agent_id
from inserted_events i
join normalized n on n.idempotency_key = i.idempotency_key
on conflict (event_id, agent_id) do nothing;

with mapping(event_type, agent_id) as (
  values
    ('post.created', 'problem-intelligence'),
    ('post.created', 'duplicate-detector'),
    ('post.created', 'content-moderator'),
    ('post.created', 'sentiment-engine'),
    ('post.created', 'trend-spotter'),
    ('post.updated', 'trend-spotter'),
    ('post.updated', 'problem-intelligence'),
    ('post.status_changed', 'trend-spotter'),
    ('post.status_changed', 'analytics-aggregator'),
    ('comment.created', 'sentiment-engine'),
    ('comment.created', 'content-moderator'),
    ('inbox.message', 'problem-intelligence'),
    ('inbox.message', 'sentiment-engine'),
    ('reaction.added', 'trend-spotter'),
    ('reaction.added', 'analytics-aggregator'),
    ('user.reported', 'risk-assessor'),
    ('user.reported', 'escalation-protocol'),
    ('moderation.flagged', 'content-moderator'),
    ('moderation.flagged', 'risk-assessor'),
    ('moderation.flagged', 'escalation-protocol'),
    ('system.alert', 'ops-monitor'),
    ('system.alert', 'error-pattern-detector')
)
insert into public.event_outbox (event_id, agent_id)
select e.id, m.agent_id
from public.platform_events e
join mapping m on m.event_type = e.event_type
where e.source = 'legacy_event_log'
on conflict (event_id, agent_id) do nothing;

alter table public.platform_events enable row level security;
alter table public.event_outbox enable row level security;
alter table public.queue_worker_leases enable row level security;

drop policy if exists service_role_all on public.platform_events;
create policy service_role_all on public.platform_events
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.event_outbox;
create policy service_role_all on public.event_outbox
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.queue_worker_leases;
create policy service_role_all on public.queue_worker_leases
  for all to service_role using (true) with check (true);

revoke all on public.platform_events from anon, authenticated, public;
revoke all on public.event_outbox from anon, authenticated, public;
revoke all on public.queue_worker_leases from anon, authenticated, public;

revoke all on function public.reject_platform_event_mutation() from public, anon, authenticated;
revoke all on function public.emit_event(text, text, jsonb, text[], text, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_event_outbox(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_event_outbox(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_event_outbox(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.requeue_dead_event_outbox(uuid, text, text) from public, anon, authenticated;
revoke all on function public.acquire_worker_lease(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.renew_worker_lease(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_worker_lease(text, uuid) from public, anon, authenticated;
revoke all on function public.get_event_queue_health() from public, anon, authenticated;
revoke all on function public.get_event_stats() from public, anon, authenticated;

grant execute on function public.emit_event(text, text, jsonb, text[], text, text, text, text) to service_role;
grant execute on function public.claim_event_outbox(text, integer, integer) to service_role;
grant execute on function public.complete_event_outbox(uuid, uuid) to service_role;
grant execute on function public.fail_event_outbox(uuid, uuid, text, text) to service_role;
grant execute on function public.requeue_dead_event_outbox(uuid, text, text) to service_role;
grant execute on function public.acquire_worker_lease(text, uuid, integer) to service_role;
grant execute on function public.renew_worker_lease(text, uuid, integer) to service_role;
grant execute on function public.release_worker_lease(text, uuid) to service_role;
grant execute on function public.get_event_queue_health() to service_role;
grant execute on function public.get_event_stats() to service_role;

commit;
```

- [ ] **Step 4: Run the migration contract test**

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/event-outbox-migration.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run SQL formatting/static checks without touching a database**

Run:

```powershell
rg -n "FOR UPDATE SKIP LOCKED|platform_events_reject_mutation|pending_agent_events|event_log" api/migrations/017_event_outbox.sql
npx eslint tests/api/event-outbox-migration.test.ts
```

Expected: the migration contains the claim/backfill markers and ESLint exits 0.

- [ ] **Step 6: Commit the additive migration only after the human commit gate**

```powershell
git add api/migrations/017_event_outbox.sql tests/api/event-outbox-migration.test.ts
git diff --cached --check
git commit -m "feat(events): add durable event outbox schema"
```

---

### Task 2: Cut every event producer and event agent over to the outbox

**Files:**
- Modify: `api/_events.js`
- Modify: `api/_posts.js`
- Modify: `api/_comments.js`
- Modify: `api/_inbox.js`
- Modify: `api/_incidents.js`
- Modify: `api/_polls.js`
- Modify: `api/_reactions.js`
- Modify: `api/_reports.js`
- Modify: `api/_bulk-operations.js`
- Modify: `api/_workforce.js`
- Modify: `api/_workforce-bridge.js`
- Modify: `api/_agents-cron.js`
- Create: `api/_cron-auth.js`
- Create: `api/event-worker.js`
- Create: `tests/api/event-outbox.test.ts`
- Create: `tests/api/event-agent-worker.test.ts`
- Modify: focused existing event mocks in post/comment/workforce tests listed in File Structure

**Interfaces:**
- Consumes: migration 017 RPCs and the current `EVENT_AGENT_MAP`/`AGENTS` definitions.
- Produces: durable `emitEvent`/`emitEventAndBridge`, one singleton `event-worker` entry point, and no application reads/writes of `settings.event_log` or `settings.pending_agent_events`.

- [ ] **Step 1: Write failing emitter tests**

Create `tests/api/event-outbox.test.ts` around an `rpc` mock. Pin this behavior:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("../../api/_db-client.js", () => ({ default: { rpc } }));
vi.mock("../../api/_observability.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("emitEvent", () => {
  it("persists the event and mapped outbox jobs in one RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        event_id: "event-1",
        inserted: true,
        duplicate: false,
        occurred_at: "2026-09-24T12:00:00.000Z",
        agent_job_count: 2,
      },
      error: null,
    });
    const { emitEvent, EVENT_AGENT_MAP } = await import("../../api/_events.js");
    const result = await emitEvent(
      "post.created",
      { post_id: "p1" },
      { idempotencyKey: "post.created:p1", source: "api:_posts", requestId: "r1" },
    );
    expect(rpc).toHaveBeenCalledWith("emit_event", {
      p_event_type: "post.created",
      p_idempotency_key: "post.created:p1",
      p_payload: { post_id: "p1" },
      p_agent_ids: EVENT_AGENT_MAP["post.created"],
      p_source: "api:_posts",
      p_request_id: "r1",
      p_aggregate_type: "post",
      p_aggregate_id: "p1",
    });
    expect(result).toMatchObject({ id: "event-1", inserted: true, duplicate: false });
  });

  it("returns the existing event instead of failing on a duplicate key", async () => {
    rpc.mockResolvedValue({
      data: {
        event_id: "event-1",
        inserted: false,
        duplicate: true,
        occurred_at: "2026-09-24T12:00:00.000Z",
        agent_job_count: 2,
      },
      error: null,
    });
    const { emitEvent } = await import("../../api/_events.js");
    const result = await emitEvent("post.created", { post_id: "p1" }, {
      idempotencyKey: "post.created:p1",
    });
    expect(result).toMatchObject({ id: "event-1", inserted: false, duplicate: true });
  });

  it("rejects rather than returning a fabricated event when the RPC fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "outbox unavailable" } });
    const { emitEvent } = await import("../../api/_events.js");
    await expect(emitEvent("post.created", { post_id: "p1" }, {
      idempotencyKey: "post.created:p1",
    })).rejects.toThrow("outbox unavailable");
  });
});
```

Add a static assertion that `_events.js` no longer contains `settings`, `event_log`, `pending_agent_events`, `_recentEvents`, or `triggerAgents`.

- [ ] **Step 2: Run the emitter test and verify it fails**

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/event-outbox.test.ts
```

Expected: FAIL because `_events.js` still calls `.from("settings")` and has no `rpc("emit_event")` call.

- [ ] **Step 3: Implement the exact emitter contract**

In `api/_events.js`:

- Keep `EVENT_TYPES` and `EVENT_AGENT_MAP` exports.
- Remove `MAX_EVENTS`, `DEDUP_WINDOW_MS`, `_recentEvents`, `dedupKey`, `triggerAgents`, and `consumeAgentEvents`.
- Export `emitEvent` with the Data Contract signature above.
- Validate `type`, object payload, and `idempotencyKey` before RPC.
- Derive `aggregateType` from a small explicit map (`post`, `comment`, `poll`, `report`, `inbox`, `task`, `incident`, `system`) and `aggregateId` from the safe identifier fields.
- Throw on Supabase `error`; return a new `PersistedEvent` shape on success.
- Keep the current workforce type translation table, renamed `WORKFORCE_EVENT_TYPE_MAP`, and add the durable `event_id` to the bridge payload.
- Keep workforce bridging after persistence and make bridge failure log-only because the event is already durable.
- Preserve incident correlation for `system.alert` and `security.event` as a post-persistence side effect: call `correlateEvent(type, data)` only after `emit_event` succeeds. Correlation failure remains a safe log-only failure; it must not delete or mutate the immutable event.

The core implementation is:

```js
const EVENT_AGGREGATE_FIELDS = Object.freeze({
  "post.created": ["post", "post_id"],
  "post.updated": ["post", "post_id"],
  "post.status_changed": ["post", "post_id"],
  "comment.created": ["comment", "comment_id"],
  "inbox.message": ["inbox", "thread_id"],
  "reaction.added": ["reaction", "reaction_id"],
  "poll.voted": ["poll", "poll_id"],
  "user.reported": ["report", "report_id"],
  "moderation.flagged": ["moderation", "target_id"],
  "system.alert": ["system", "service"],
  "security.event": ["system", "service"],
});

function inferAggregate(type, data) {
  const rule = EVENT_AGGREGATE_FIELDS[type];
  if (!rule) return { aggregateType: null, aggregateId: null };
  const [aggregateType, field] = rule;
  return {
    aggregateType,
    aggregateId: data[field] == null ? null : String(data[field]).slice(0, 160),
  };
}

export async function emitEvent(type, data = {}, options = {}) {
  const inferred = inferAggregate(type, data);
  const {
    idempotencyKey,
    source = "api",
    requestId = null,
    agentIds = EVENT_AGENT_MAP[type] || [],
    aggregateType = inferred.aggregateType,
    aggregateId = inferred.aggregateId,
  } = options;

  if (typeof type !== "string" || !type.trim()) {
    throw new Error("event type is required");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 256) {
    throw new Error("event idempotencyKey must contain 1-256 characters");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("event data must be an object");
  }

  const { data: result, error } = await supabase.rpc("emit_event", {
    p_event_type: type,
    p_idempotency_key: idempotencyKey,
    p_payload: data,
    p_agent_ids: agentIds,
    p_source: source,
    p_request_id: requestId,
    p_aggregate_type: aggregateType,
    p_aggregate_id: aggregateId,
  });
  if (error) throw new Error(`event emit failed for ${type}: ${error.message}`);
  if (!result?.event_id) throw new Error(`event emit returned no event id for ${type}`);

  return {
    id: result.event_id,
    type,
    data,
    timestamp: result.occurred_at,
    source,
    request_id: requestId,
    inserted: result.inserted,
    duplicate: result.duplicate,
    agent_job_count: result.agent_job_count,
  };
}

export async function emitEventAndBridge(type, data = {}, options = {}) {
  const event = await emitEvent(type, data, options);
  const workforceType = WORKFORCE_EVENT_TYPE_MAP[type] || type;
  if (event.inserted) {
    pushToWorkforce(workforceType, { ...data, event_id: event.id }).catch((error) => {
      logger.warn("events", "workforce bridge failed after durable emit", {
        event_id: event.id,
        event_type: type,
        error: error.message,
      });
    });
  }
  if (event.inserted && (type === "system.alert" || type === "security.event")) {
    import("./_incidents.js")
      .then(({ correlateEvent }) => correlateEvent(type, data))
      .catch((error) => {
        logger.warn("events", "incident correlation failed after durable emit", {
          event_id: event.id,
          event_type: type,
          error: error.message,
        });
      });
  }
  return event;
}

export async function emitEventBestEffort(type, data = {}, options = {}) {
  try {
    return await emitEventAndBridge(type, data, options);
  } catch (error) {
    logger.error("events", "event_queue_write_failed", {
      event_type: type,
      request_id: options.requestId || null,
      error: String(error.message || error).slice(0, 160),
    });
    await supabase.from("system_metrics").insert({
      metric_name: "event_queue_write_failed",
      metric_value: 1,
      tags: { event_type: type, source: options.source || "api" },
    }).catch(() => {});
    return null;
  }
}
```

Replace the dashboard readers with bounded table reads; do not reconstruct them from the settings archive:

```js
export async function getRecentEvents(limit = 50, typeFilter = null) {
  const bounded = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let query = supabase
    .from("platform_events")
    .select("id,event_type,payload,source,request_id,occurred_at")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(bounded);
  if (typeFilter) query = query.eq("event_type", typeFilter);
  const { data, error } = await query;
  if (error) throw new Error(`event history read failed: ${error.message}`);
  return (data || []).map((row) => ({
    id: row.id,
    type: row.event_type,
    data: row.payload,
    source: row.source,
    request_id: row.request_id,
    timestamp: row.occurred_at,
  }));
}

export async function getEventStats() {
  const { data, error } = await supabase.rpc("get_event_stats");
  if (error) throw new Error(`event stats read failed: ${error.message}`);
  return {
    total: data.total,
    last24h: data.last24h,
    byType: data.byType,
    lastEvent: data.lastEvent,
    queue: data.queue,
  };
}
```

Migration 017 defines `get_event_stats()` from indexed `platform_events` aggregates and includes `get_event_queue_health()` under `queue`. The final API response preserves `{ total, last24h, byType, lastEvent, queue }`; it never reports the legacy 200-row JSON length as a platform total.

- [ ] **Step 4: Update all event-producing callsites with stable keys**

Make these exact behavioral changes:

```js
// api/_posts.js — create
await emitEventBestEffort(EVENT_TYPES.POST_CREATED, payload, {
  idempotencyKey: `post.created:${data.id}`,
  source: "api:_posts",
  requestId: req.requestId,
});

// api/_posts.js — status
await emitEventAndBridge(EVENT_TYPES.POST_STATUS_CHANGED, payload, {
  idempotencyKey: `post.status_changed:${data.id}:${data.updated_at}`,
  source: "api:_posts",
  requestId: req.requestId,
});

// api/_comments.js
await emitEventBestEffort(EVENT_TYPES.COMMENT_CREATED, payload, {
  idempotencyKey: `comment.created:${data.id}`,
  source: "api:_comments",
  requestId: req.requestId,
});

// api/_inbox.js — both INBOX_MESSAGE branches
await emitEventBestEffort(EVENT_TYPES.INBOX_MESSAGE, payload, {
  idempotencyKey: `inbox.message:${savedMsg.id}`,
  source: "api:_inbox",
  requestId: req.requestId,
});

// api/_inbox.js — triage report; capture filed.report.id from fileInboxReport
await emitEventBestEffort(EVENT_TYPES.USER_REPORTED, {
  report_id: filed.report.id,
  ...payload,
}, {
  idempotencyKey: `user.reported:inbox:${savedMsg.id}:triage`,
  source: "api:_inbox",
  requestId: req.requestId,
});

// api/_reports.js
await emitEventBestEffort(EVENT_TYPES.USER_REPORTED, {
  report_id: data.id,
  ...payload,
}, {
  idempotencyKey: `user.reported:${data.id}`,
  source: "api:_reports",
  requestId: req.requestId,
});
```

For `_reactions.js`, change the insert to return the durable row before emission:

```js
const { data: insertedReaction, error: insError } = await supabase
  .from("reactions")
  .insert({ target_id, target_type, author_id, kind })
  .select("id")
  .single();
if (insError) throw insError;
```

Then emit `{ reaction_id: insertedReaction.id, target_id, target_type, kind, author_id }` with `idempotencyKey: \`reaction.added:${insertedReaction.id}\``.

For `_polls.js`, make the insert/update select the vote row ID, include `poll_id: poll.id` and `poll_vote_id: voteRow.id` in the payload, and use `poll.voted:${voteRow.id}:${req.requestId}`. Add `EVENT_TYPES.POLL_VOTED = "poll.voted"` and map it to the same two analytics agents as `reaction.added`; stop labeling a poll vote as a generic reaction.

For `_bulk-operations.js`, correct the current invalid object-as-event-type call to:

```js
await emitEvent(
  `bulk.${action}.completed`,
  auditEntry,
  {
    idempotencyKey: `bulk.${action}.completed:${req.requestId}`,
    source: "api:_bulk-operations",
    requestId: req.requestId,
  },
);
```

For `_workforce.js`, use the task table mapping in the Data Contract table. For claim events, return `claimed_at` from `claimTask` and include it in the key. For `_workforce-bridge.js`, pass the request `task_id`, `agent_id`, and `requestId` into the `emit_event` tool context and derive `bridge:${agentId}:${taskId || req.requestId}` when no explicit key is supplied. For `_incidents.js`, use `incident.created:${incident.id}`.

Use `emitEventBestEffort` at every post-commit noncritical callsite (`_comments.js`, `_inbox.js`, `_reactions.js`, `_polls.js`, `_reports.js`, `_bulk-operations.js`, `_workforce.js`, `_workforce-bridge.js`, `_incidents.js`) after supplying the stable key. Keep existing success responses, but replace silent `.catch(() => {})` blocks with the helper's structured failure metric/log. The post-status path uses the explicit warning handling in Task 4 because it also owns follower enqueue.

- [ ] **Step 5: Run emitter and callsite tests**

Run sequentially:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/event-outbox.test.ts tests/api/posts-full.test.ts tests/api/comments-full.test.ts tests/api/polls-full.test.ts tests/api/posts-author-notify.test.ts tests/api/post-removal-verify.test.ts
```

Expected: PASS. Update the existing `emitEventAndBridge` mocks to return a complete `PersistedEvent` object for the post status test so `notifyFollowers` can receive its ID in Task 4.

- [ ] **Step 6: Write failing event-worker tests**

Create `tests/api/event-agent-worker.test.ts`, set `process.env.DELIVERY_WORKERS_ENABLED="true"` in `beforeEach`, and mock Supabase RPC plus the agent runner. Pin these cases:

```ts
const rpc = vi.fn();
const runAgent = vi.fn();
vi.mock("../../api/_db-client.js", () => ({ default: { rpc } }));
vi.mock("../../api/agents/_runner.js", () => ({ runAgent }));

it("does not claim work when another invocation owns the singleton lease", async () => {
  rpc.mockResolvedValueOnce({ data: false, error: null });
  const result = await runEventAgentWorker();
  expect(result).toMatchObject({ ok: true, skipped: "singleton_lease_held" });
  expect(rpc.mock.calls.map(([name]) => name)).not.toContain("claim_event_outbox");
});

it("completes a successful claimed agent with the same claim token", async () => {
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: [{
      id: "job-1",
      event_id: "event-1",
      agent_id: "problem-intelligence",
      claim_token: "token-1",
      attempt_count: 1,
      event_type: "post.created",
      payload: { post_id: "p1" },
    }], error: null })
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: { depth: 0 }, error: null })
    .mockResolvedValueOnce({ data: true, error: null });
  runAgent.mockResolvedValue({ status: "completed", output: { summary: "ok" } });
  const result = await runEventAgentWorker();
  expect(runAgent).toHaveBeenCalledWith(
    "problem-intelligence",
    "Problem Intelligence",
    "analytics",
    expect.any(Function),
    "event",
    expect.objectContaining({ event_id: "event-1", event_type: "post.created" }),
  );
  expect(rpc).toHaveBeenCalledWith("complete_event_outbox", {
    p_job_id: "job-1",
    p_claim_token: "token-1",
  });
  expect(result.completed).toBe(1);
});

it("fails a failed run and does not mark it completed", async () => {
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: [{ id: "job-1", claim_token: "token-1", agent_id: "problem-intelligence" }], error: null })
    .mockResolvedValueOnce({ data: { updated: true, status: "retry_wait" }, error: null })
    .mockResolvedValueOnce({ data: { depth: 1 }, error: null })
    .mockResolvedValueOnce({ data: true, error: null });
  runAgent.mockResolvedValue({ status: "failed", error: "provider failed" });
  await runEventAgentWorker();
  expect(rpc).toHaveBeenCalledWith("fail_event_outbox", expect.objectContaining({
    p_job_id: "job-1",
    p_claim_token: "token-1",
    p_error_code: "agent_failed",
    p_error_message: "provider failed",
  }));
  expect(rpc.mock.calls.map(([name]) => name)).not.toContain("complete_event_outbox");
});

it("dead-letters an unknown mapped agent", async () => {
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: [{ id: "job-2", claim_token: "token-2", agent_id: "missing-agent" }], error: null })
    .mockResolvedValueOnce({ data: { updated: true, status: "dead" }, error: null })
    .mockResolvedValueOnce({ data: { depth: 0 }, error: null })
    .mockResolvedValueOnce({ data: true, error: null });
  await runEventAgentWorker();
  expect(rpc).toHaveBeenCalledWith("fail_event_outbox", expect.objectContaining({
    p_job_id: "job-2",
    p_claim_token: "token-2",
    p_error_code: "unknown_agent",
  }));
});
```

Also add a timeout test with fake timers. The unresolved `runAgent` promise must produce one call to `failEventOutbox("job-1", "token-1", "agent_timeout", "agent exceeded 20000ms")`; it must not call `completeEventOutbox`.

- [ ] **Step 7: Run the worker test and verify it fails because the module does not exist**

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/event-agent-worker.test.ts
```

Expected: FAIL resolving `api/event-worker.js`.

- [ ] **Step 8: Implement shared cron auth and the bounded singleton event worker**

Create `api/_cron-auth.js` using the exact constant-time comparison already used by `api/agent-cron.js`; accept only a valid `CRON_SECRET` or a real admin session. A missing/incorrect secret is 401 and never falls back to localhost outside development.

```js
import { timingSafeEqual } from "node:crypto";
import { isAdmin } from "./_auth.js";

export async function isCronAuthorized(req) {
  const expected = process.env.CRON_SECRET || "";
  const authorization = String(req.headers?.authorization || "");
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  const provided = req.headers?.["x-vercel-cron-secret"]
    || req.headers?.["x-cron-secret"]
    || bearer;

  if (expected && provided) {
    const actualBuffer = Buffer.from(String(provided));
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length === expectedBuffer.length
      && timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return true;
    }
  }

  return isAdmin(req);
}
```

Export `AGENTS` from `api/_agents-cron.js`, remove its import of `consumeAgentEvents`/`EVENT_AGENT_MAP`, and replace the inline event-consumption blocks at current lines 2824-2876, 2895-2957, and 2959-3027 with durable job creation. Keep the existing manual event control route as a compatibility adapter: it authenticates the actor, validates the event/agent selection, enqueues a replay through the durable RPC, and returns `202` with the new job ID and status URL. It never directly consumes or marks a job.

Return this explicit response for a legacy synchronous consume request after the adapter has successfully enqueued the work:

```json
{
  "ok": true,
  "mode": "queued",
  "job_id": "<durable-job-id>",
  "status_url": "/api/queue-ops?action=health"
}
```

The adapter must preserve the manual control while preventing a caller from stealing or prematurely marking durable jobs.

Implement `api/event-worker.js` with these module-local RPC adapters so worker logic never performs table writes directly:

```js
import supabase from "./_db-client.js";

async function acquireWorkerLease(workerName, ownerId, leaseSeconds) {
  const { data, error } = await supabase.rpc("acquire_worker_lease", {
    p_worker_name: workerName,
    p_owner: ownerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`worker lease acquire failed: ${error.message}`);
  return Boolean(data);
}

async function claimEventOutbox(workerName, leaseSeconds, limit) {
  const { data, error } = await supabase.rpc("claim_event_outbox", {
    p_worker_id: workerName,
    p_lease_seconds: leaseSeconds,
    p_limit: limit,
  });
  if (error) throw new Error(`event outbox claim failed: ${error.message}`);
  return data || [];
}

async function completeEventOutbox(jobId, claimToken) {
  const { data, error } = await supabase.rpc("complete_event_outbox", {
    p_job_id: jobId,
    p_claim_token: claimToken,
  });
  if (error) throw new Error(`event outbox completion failed: ${error.message}`);
  return Boolean(data);
}

async function failEventOutbox(jobId, claimToken, errorCode, errorMessage) {
  const { data, error } = await supabase.rpc("fail_event_outbox", {
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_error_code: errorCode,
    p_error_message: String(errorMessage || "").slice(0, 500),
  });
  if (error) throw new Error(`event outbox failure update failed: ${error.message}`);
  return data;
}

async function releaseWorkerLease(workerName, ownerId) {
  const { error } = await supabase.rpc("release_worker_lease", {
    p_worker_name: workerName,
    p_owner: ownerId,
  });
  if (error) throw new Error(`worker lease release failed: ${error.message}`);
}

async function getEventQueueHealth() {
  const { data, error } = await supabase.rpc("get_event_queue_health");
  if (error) throw new Error(`event queue health failed: ${error.message}`);
  return data;
}
```

Then use these constants and control flow:

```js
const WORKER_NAME = "event-agent-worker";
const MAX_LIMIT = 3;
const CONCURRENCY = 2;
const AGENT_TIMEOUT_MS = 20_000;
const LEASE_SECONDS = 120;

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`agent exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runBounded(items, concurrency, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index]);
      }
    }),
  );
}

export async function runEventAgentWorker({
  limit = MAX_LIMIT,
  concurrency = CONCURRENCY,
} = {}) {
  if (process.env.DELIVERY_WORKERS_ENABLED !== "true") {
    return { ok: true, enabled: false, claimed: 0, completed: 0, retried: 0, dead: 0, claim_lost: 0 };
  }

  const start = Date.now();
  const ownerId = crypto.randomUUID();
  const acquired = await acquireWorkerLease(WORKER_NAME, ownerId, LEASE_SECONDS);
  if (!acquired) {
    return { ok: true, enabled: true, skipped: "singleton_lease_held", claimed: 0, completed: 0, retried: 0, dead: 0, claim_lost: 0, duration_ms: Date.now() - start };
  }

  try {
    const jobs = await claimEventOutbox(WORKER_NAME, LEASE_SECONDS, limit);
    let completed = 0;
    let retried = 0;
    let dead = 0;
    let claimLost = 0;

    await runBounded(jobs, concurrency, async (job) => {
      const agent = AGENTS[job.agent_id];
      if (!agent) {
        const result = await failEventOutbox(
          job.id,
          job.claim_token,
          "unknown_agent",
          "agent is not present in AGENTS",
        );
        if (!result.updated) claimLost++;
        else if (result.status === "dead") dead++;
        else retried++;
        return;
      }

      let result;
      try {
        result = await withTimeout(
          runAgent(job.agent_id, agent.name, agent.division, agent.task, "event", {
            event_id: job.event_id,
            event_type: job.event_type,
            event_data: job.payload,
            triggered_by: "event-worker",
            outbox_id: job.id,
            attempt: job.attempt_count,
          }),
          AGENT_TIMEOUT_MS,
        );
      } catch (error) {
        const failure = await failEventOutbox(
          job.id,
          job.claim_token,
          String(error.message).includes("exceeded") ? "agent_timeout" : "agent_exception",
          String(error.message || "agent threw").slice(0, 500),
        );
        if (!failure.updated) claimLost++;
        else if (failure.status === "dead") dead++;
        else retried++;
        return;
      }

      if (result.status === "completed") {
        if (await completeEventOutbox(job.id, job.claim_token)) completed++;
        else claimLost++;
        return;
      }

      const failure = await failEventOutbox(
        job.id,
        job.claim_token,
        "agent_failed",
        String(result.error || "agent returned a non-completed status"),
      );
      if (!failure.updated) claimLost++;
      else if (failure.status === "dead") dead++;
      else retried++;
    });

    const health = await getEventQueueHealth();
    return {
      ok: true,
      enabled: true,
      claimed: jobs.length,
      completed,
      retried,
      dead,
      claim_lost: claimLost,
      health,
      duration_ms: Date.now() - start,
    };
  } finally {
    await releaseWorkerLease(WORKER_NAME, ownerId);
  }
}
```

The HTTP handler accepts GET/POST, calls the exported function, returns 200 for disabled/singleton-skip/no-work, 401 for auth failure, and 500 only for an unhandled worker failure. `config` is `{ runtime: "nodejs" }`.

- [ ] **Step 9: Verify the event subsystem**

Run sequentially:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/event-outbox.test.ts tests/api/event-agent-worker.test.ts tests/api/posts-full.test.ts tests/api/comments-full.test.ts tests/api/polls-full.test.ts
rg -n "event_log|pending_agent_events|consumeAgentEvents|_recentEvents" api/_events.js api/_agents-cron.js
npm run typecheck
npm run lint
```

Expected: focused tests PASS; `rg` returns no matches; typecheck and lint exit 0.

- [ ] **Step 10: Commit after the human gate**

```powershell
git add api/_events.js api/_posts.js api/_comments.js api/_inbox.js api/_incidents.js api/_polls.js api/_reactions.js api/_reports.js api/_bulk-operations.js api/_workforce.js api/_workforce-bridge.js api/_agents-cron.js api/_cron-auth.js api/event-worker.js tests/api/event-outbox.test.ts tests/api/event-agent-worker.test.ts tests/api/posts-full.test.ts tests/api/comments-full.test.ts tests/api/polls-full.test.ts tests/api/posts-author-notify.test.ts tests/api/post-removal-verify.test.ts
git diff --cached --check
git commit -m "feat(events): route agent triggers through durable outbox"
```

---

### Task 3: Add normalized follows and the durable recipient queue schema

**Files:**
- Create: `api/migrations/018_follower_delivery.sql`
- Create: `tests/api/follower-delivery-migration.test.ts`

**Interfaces:**
- Consumes: `settings` rows whose keys start with `follows:`.
- Produces: `post_follows`, `follower_notification_batches`, `follower_deliveries`, `enqueue_follower_notification`, delivery claim/finalization RPCs, and `get_queue_health(text)`.

- [ ] **Step 1: Write the failing follower migration contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../api/migrations/018_follower_delivery.sql", import.meta.url),
  "utf8",
);
const normalized = sql.toLowerCase();

describe("018 follower delivery migration", () => {
  it("normalizes follows without deleting the legacy JSON", () => {
    expect(normalized).toContain("create table if not exists public.post_follows");
    expect(normalized).toContain("primary key (user_id, post_id)");
    expect(normalized).toContain("jsonb_array_elements_text");
    expect(normalized).not.toMatch(/delete\s+from\s+settings/i);
  });

  it("creates one durable row per recipient and channel", () => {
    expect(normalized).toContain("create table if not exists public.follower_deliveries");
    expect(normalized).toContain("channel text not null check (channel in ('in_app', 'email', 'sms'))");
    expect(normalized).toContain("unique (batch_id, recipient_user_id, channel)");
  });

  it("materializes all channels atomically from one idempotent batch", () => {
    expect(normalized).toContain("create or replace function public.enqueue_follower_notification");
    expect(normalized).toContain("insert into public.follower_notification_batches");
    expect(normalized).toContain("insert into public.follower_deliveries");
    expect(normalized).toContain("on conflict (idempotency_key) do nothing");
  });

  it("claims with SKIP LOCKED and fences by claim token", () => {
    expect(normalized).toContain("for update skip locked");
    expect(normalized).toContain("claim_token = gen_random_uuid()");
    expect(normalized).toContain("d.id = p_delivery_id");
    expect(normalized).toContain("d.claim_token = p_claim_token");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing migration failure**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/follower-delivery-migration.test.ts
```

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Create migration 018 with exact tables and enqueue transaction**

Use this schema:

```sql
begin;

create table if not exists public.post_follows (
  user_id text not null check (user_id ~ '^anon_[a-z0-9]{1,35}$'),
  post_id text not null check (char_length(post_id) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists post_follows_post_user_idx
  on public.post_follows (post_id, user_id);

create or replace function public.enforce_post_follow_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_existing integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id, 0));
  if exists (
    select 1 from public.post_follows
    where user_id = new.user_id and post_id = new.post_id
  ) then
    return new;
  end if;
  select count(*) into v_existing
  from public.post_follows
  where user_id = new.user_id;
  if v_existing >= 200 then
    raise exception 'post follow limit reached for user %', new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists post_follows_limit_guard on public.post_follows;
create trigger post_follows_limit_guard
before insert on public.post_follows
for each row execute function public.enforce_post_follow_limit();

create table if not exists public.follower_notification_batches (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid references public.platform_events(id) on delete restrict,
  post_id text not null check (char_length(post_id) between 1 and 80),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 256),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  request_id text,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  delivery_count integer not null default 0 check (delivery_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists follower_batches_post_created_idx
  on public.follower_notification_batches (post_id, created_at desc, id desc);
create index if not exists follower_batches_event_idx
  on public.follower_notification_batches (source_event_id)
  where source_event_id is not null;

create table if not exists public.follower_deliveries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.follower_notification_batches(id) on delete restrict,
  post_id text not null check (char_length(post_id) between 1 and 80),
  recipient_user_id text not null check (recipient_user_id ~ '^anon_[a-z0-9]{1,35}$'),
  channel text not null check (channel in ('in_app', 'email', 'sms')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 256),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry_wait', 'delivered', 'skipped', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 6 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  claim_token uuid,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  delivered_at timestamptz,
  skipped_at timestamptz,
  dead_lettered_at timestamptz,
  provider text,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  last_requeued_by text,
  last_requeued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, recipient_user_id, channel)
);

create index if not exists follower_deliveries_claim_idx
  on public.follower_deliveries (available_at, created_at, id)
  where status in ('pending', 'retry_wait');
create index if not exists follower_deliveries_lease_idx
  on public.follower_deliveries (lease_expires_at, id)
  where status = 'processing';
create index if not exists follower_deliveries_dead_idx
  on public.follower_deliveries (dead_lettered_at desc, id desc)
  where status = 'dead';
create index if not exists follower_deliveries_status_created_idx
  on public.follower_deliveries (status, created_at desc);
create index if not exists follower_deliveries_batch_idx
  on public.follower_deliveries (batch_id, channel, status);
```

Implement `enqueue_follower_notification` so duplicate calls return the original batch and do not notify followers who joined later:

```sql
create or replace function public.enqueue_follower_notification(
  p_idempotency_key text,
  p_post_id text,
  p_payload jsonb,
  p_source_event_id uuid default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid;
  v_source_event_id uuid;
  v_inserted boolean;
  v_created_at timestamptz;
  v_recipient_count integer;
  v_delivery_count integer;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 256 then
    raise exception 'invalid follower idempotency_key';
  end if;
  if p_post_id is null or char_length(p_post_id) not between 1 and 80 then
    raise exception 'invalid follower post_id';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'follower payload must be an object';
  end if;

  insert into public.follower_notification_batches (
    source_event_id, post_id, idempotency_key, payload, request_id
  ) values (
    p_source_event_id, p_post_id, p_idempotency_key, p_payload,
    nullif(left(p_request_id, 160), '')
  )
  on conflict (idempotency_key) do nothing;

  v_inserted := found;

  select b.id, b.source_event_id, b.created_at, b.recipient_count, b.delivery_count
    into v_batch_id, v_source_event_id, v_created_at, v_recipient_count, v_delivery_count
  from public.follower_notification_batches b
  where b.idempotency_key = p_idempotency_key;

  if v_inserted then
    with recipients as (
      select f.user_id, prefs.value
      from public.post_follows f
      left join lateral (
        select s.value
        from public.settings s
        where s.key = 'notify_prefs:' || f.user_id
        order by s.updated_at desc, s.id desc
        limit 1
      ) prefs on true
      where f.post_id = p_post_id
    ), channels as (
      select user_id, 'in_app'::text as channel from recipients
      union all
      select user_id, 'email'::text
      from recipients
      where coalesce(value ->> 'status_updates', 'true') <> 'false'
        and coalesce(value ->> 'email_enabled', 'true') <> 'false'
        and nullif(btrim(coalesce(value ->> 'email', '')), '') is not null
      union all
      select user_id, 'sms'::text
      from recipients
      where coalesce(value ->> 'status_updates', 'true') <> 'false'
        and coalesce(value ->> 'sms_enabled', 'true') <> 'false'
        and nullif(btrim(coalesce(value ->> 'phone', '')), '') is not null
    )
    insert into public.follower_deliveries (
      batch_id, post_id, recipient_user_id, channel,
      idempotency_key, payload
    )
    select
      v_batch_id,
      p_post_id,
      c.user_id,
      c.channel,
      'follower:' || v_batch_id::text || ':' || c.user_id || ':' || c.channel,
      p_payload || jsonb_build_object(
        'notification_id', 'notif_' || replace(v_batch_id::text, '-', ''),
        'created_at', v_created_at
      )
    from channels c
    on conflict (batch_id, recipient_user_id, channel) do nothing;

    get diagnostics v_delivery_count = row_count;

    select count(*)::integer
      into v_recipient_count
    from public.post_follows
    where post_id = p_post_id;

    update public.follower_notification_batches b
       set recipient_count = v_recipient_count,
           delivery_count = v_delivery_count
     where b.id = v_batch_id;
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'inserted', v_inserted,
    'recipient_count', v_recipient_count,
    'delivery_count', v_delivery_count,
    'source_event_id', v_source_event_id
  );
end;
$$;
```

- [ ] **Step 4: Add delivery claim/finalization RPCs**

Append these exact functions to migration 018:

```sql
create or replace function public.claim_follower_deliveries(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_limit integer default 12
)
returns table (
  id uuid,
  batch_id uuid,
  post_id text,
  recipient_user_id text,
  channel text,
  payload jsonb,
  status text,
  attempt_count integer,
  max_attempts integer,
  claim_token uuid,
  request_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_lease_seconds := least(300, greatest(15, p_lease_seconds));
  p_limit := least(50, greatest(1, p_limit));

  update public.follower_deliveries d
     set status = 'dead',
         dead_lettered_at = now(),
         last_error_code = 'lease_expired_max_attempts',
         last_error_message = 'worker lease expired after final attempt',
         claim_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where d.status = 'processing'
     and d.lease_expires_at <= now()
     and d.attempt_count >= d.max_attempts;

  return query
  with candidates as (
    select d.id
      from public.follower_deliveries d
     where (
             d.status in ('pending', 'retry_wait')
             and d.available_at <= now()
           )
        or (
             d.status = 'processing'
             and d.lease_expires_at <= now()
             and d.attempt_count < d.max_attempts
           )
     order by d.available_at, d.created_at, d.id
     for update skip locked
     limit p_limit
  ), updated as (
    update public.follower_deliveries d
       set status = 'processing',
           attempt_count = d.attempt_count + 1,
           claim_token = gen_random_uuid(),
           claimed_by = left(p_worker_id, 120),
           claimed_at = now(),
           started_at = coalesce(d.started_at, now()),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           last_error_code = null,
           last_error_message = null,
           updated_at = now()
      from candidates c
     where d.id = c.id
     returning d.*
  )
  select u.id, u.batch_id, u.post_id, u.recipient_user_id, u.channel,
         u.payload, u.status, u.attempt_count, u.max_attempts,
         u.claim_token, b.request_id
    from updated u
    join public.follower_notification_batches b on b.id = u.batch_id
   order by u.created_at, u.id;
end;
$$;

create or replace function public.complete_follower_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.follower_deliveries d
     set status = 'delivered',
         delivered_at = now(),
         provider = nullif(left(p_provider, 40), ''),
         provider_message_id = nullif(left(p_provider_message_id, 200), ''),
         last_error_code = null,
         last_error_message = null,
         claim_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where d.id = p_delivery_id
     and d.claim_token = p_claim_token
     and d.status = 'processing';
  return found;
end;
$$;

create or replace function public.skip_follower_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_reason_code text,
  p_reason_message text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.follower_deliveries d
     set status = 'skipped',
         skipped_at = now(),
         last_error_code = left(coalesce(p_reason_code, 'skipped'), 120),
         last_error_message = left(coalesce(p_reason_message, ''), 500),
         claim_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where d.id = p_delivery_id
     and d.claim_token = p_claim_token
     and d.status = 'processing';
  return found;
end;
$$;

create or replace function public.fail_follower_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_terminal boolean default false,
  p_delivery_unknown boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer;
  v_max integer;
  v_status text;
  v_delay integer;
begin
  select d.attempt_count, d.max_attempts
    into v_attempt, v_max
  from public.follower_deliveries d
  where d.id = p_delivery_id
    and d.claim_token = p_claim_token
    and d.status = 'processing'
  for update;

  if not found then
    return jsonb_build_object('updated', false, 'reason', 'claim_lost');
  end if;

  v_delay := least(300, (5 * power(2, greatest(v_attempt - 1, 0)))::integer);

  if p_terminal or p_delivery_unknown or v_attempt >= v_max then
    v_status := 'dead';
  else
    v_status := 'retry_wait';
  end if;

  update public.follower_deliveries d
     set status = v_status,
         available_at = case when v_status = 'retry_wait'
                             then now() + make_interval(secs => v_delay)
                             else d.available_at end,
         dead_lettered_at = case when v_status = 'dead' then now() else null end,
         last_error_code = case
           when p_delivery_unknown then left('delivery_unknown_' || coalesce(p_error_code, 'provider'), 120)
           else left(coalesce(p_error_code, 'delivery_error'), 120)
         end,
         last_error_message = left(coalesce(p_error_message, ''), 500),
         claim_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where d.id = p_delivery_id
     and d.claim_token = p_claim_token
     and d.status = 'processing';

  return jsonb_build_object(
    'updated', true,
    'status', v_status,
    'attempt_count', v_attempt,
    'next_delay_seconds', case when v_status = 'retry_wait' then v_delay else null end
  );
end;
$$;

create or replace function public.requeue_dead_follower_delivery(
  p_delivery_id uuid,
  p_actor text,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.follower_deliveries d
     set status = 'pending',
         attempt_count = 0,
         available_at = now(),
         claim_token = null,
         claimed_by = null,
         claimed_at = null,
         lease_expires_at = null,
         started_at = null,
         delivered_at = null,
         skipped_at = null,
         dead_lettered_at = null,
         last_error_code = null,
         last_error_message = null,
         last_requeued_by = left(coalesce(p_actor, 'admin'), 120),
         last_requeued_at = now(),
         updated_at = now()
   where d.id = p_delivery_id
     and d.status = 'dead';
  return found;
end;
$$;

create or replace function public.get_queue_health(p_queue text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_queue = 'event_agent' then
    return public.get_event_queue_health();
  end if;

  if p_queue = 'follower' then
    return (
      with counts as (
        select
          count(*) filter (where status in ('pending', 'retry_wait')) as depth,
          count(*) filter (where status = 'processing') as processing,
          count(*) filter (where status = 'delivered') as delivered,
          count(*) filter (where status = 'skipped') as skipped,
          count(*) filter (where status = 'dead') as dead,
          count(*) filter (where status = 'retry_wait') as retry_wait,
          count(*) filter (where attempt_count > 1) as retried,
          min(created_at) filter (where status in ('pending', 'retry_wait', 'processing')) as oldest_at
        from public.follower_deliveries
      ), by_channel as (
        select coalesce(
          jsonb_object_agg(channel, totals),
          '{}'::jsonb
        ) as channels
        from (
          select channel, jsonb_build_object(
            'depth', count(*) filter (where status in ('pending', 'retry_wait')),
            'processing', count(*) filter (where status = 'processing'),
            'delivered', count(*) filter (where status = 'delivered'),
            'skipped', count(*) filter (where status = 'skipped'),
            'dead', count(*) filter (where status = 'dead')
          ) as totals
          from public.follower_deliveries
          group by channel
        ) channel_rows
      )
      select jsonb_build_object(
        'queue', 'follower',
        'depth', counts.depth,
        'processing', counts.processing,
        'delivered', counts.delivered,
        'skipped', counts.skipped,
        'dead', counts.dead,
        'retry_wait', counts.retry_wait,
        'retried', counts.retried,
        'oldest_age_seconds', case when counts.oldest_at is null then null
          else greatest(0, extract(epoch from (now() - counts.oldest_at))::bigint) end,
        'channels', by_channel.channels,
        'lease', (
          select case when count(*) = 0 then null else jsonb_agg(jsonb_build_object(
            'worker_name', worker_name,
            'heartbeat_at', heartbeat_at,
            'lease_expires_at', lease_expires_at
          )) end
          from public.queue_worker_leases
          where worker_name = 'follower-delivery-worker'
        )
      )
      from counts
      cross join by_channel
    );
  end if;

  raise exception 'unknown queue: %', p_queue;
end;
$$;
```

- [ ] **Step 5: Backfill follows without deleting legacy rows**

```sql
insert into public.post_follows (user_id, post_id, created_at)
select
  lower(substr(s.key, 9)),
  btrim(follow_id),
  coalesce(s.updated_at, now())
from public.settings s
cross join lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(s.value -> 'follows') = 'array' then s.value -> 'follows'
    else '[]'::jsonb
  end
) follow(follow_id)
where s.key like 'follows:%'
  and lower(substr(s.key, 9)) ~ '^anon_[a-z0-9]{1,35}$'
  and btrim(follow_id) <> ''
on conflict (user_id, post_id) do nothing;
```

Do not backfill already-delivered follower notifications: the old inline path had no durable pending marker, and existing `notifications:*` values remain the user-visible record.

- [ ] **Step 6: Add RLS and exact function grants**

Append this security block to migration 018:

```sql
alter table public.post_follows enable row level security;
alter table public.follower_notification_batches enable row level security;
alter table public.follower_deliveries enable row level security;

drop policy if exists service_role_all on public.post_follows;
create policy service_role_all on public.post_follows
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.follower_notification_batches;
create policy service_role_all on public.follower_notification_batches
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.follower_deliveries;
create policy service_role_all on public.follower_deliveries
  for all to service_role using (true) with check (true);

revoke all on public.post_follows from anon, authenticated, public;
revoke all on public.follower_notification_batches from anon, authenticated, public;
revoke all on public.follower_deliveries from anon, authenticated, public;

revoke all on function public.enforce_post_follow_limit() from public, anon, authenticated;
revoke all on function public.enqueue_follower_notification(text, text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_follower_deliveries(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_follower_delivery(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.skip_follower_delivery(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_follower_delivery(uuid, uuid, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.requeue_dead_follower_delivery(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_queue_health(text) from public, anon, authenticated;

grant execute on function public.enqueue_follower_notification(text, text, jsonb, uuid, text) to service_role;
grant execute on function public.claim_follower_deliveries(text, integer, integer) to service_role;
grant execute on function public.complete_follower_delivery(uuid, uuid, text, text) to service_role;
grant execute on function public.skip_follower_delivery(uuid, uuid, text, text) to service_role;
grant execute on function public.fail_follower_delivery(uuid, uuid, text, text, boolean, boolean) to service_role;
grant execute on function public.requeue_dead_follower_delivery(uuid, text, text) to service_role;
grant execute on function public.get_queue_health(text) to service_role;

commit;
```

- [ ] **Step 7: Run migration and unit contracts**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/follower-delivery-migration.test.ts
rg -n "FOR UPDATE SKIP LOCKED|delivery_unknown_|post_follows|follower_deliveries" api/migrations/018_follower_delivery.sql
npx eslint tests/api/follower-delivery-migration.test.ts
```

Expected: 4 migration tests PASS; marker search succeeds; ESLint exits 0.

- [ ] **Step 8: Commit after the human gate**

```powershell
git add api/migrations/018_follower_delivery.sql tests/api/follower-delivery-migration.test.ts
git diff --cached --check
git commit -m "feat(followers): add durable recipient delivery schema"
```

---

### Task 4: Move follow state and follower fan-out out of the originating request

**Files:**
- Modify: `api/_follows.js`
- Modify: `api/_posts.js`
- Modify: `api/_badges.js`
- Modify: `api/_export.js`
- Modify: `tests/api/follows.test.ts`
- Modify: `tests/api/posts-full.test.ts`
- Modify: `tests/api/posts-author-notify.test.ts`
- Modify: `tests/api/post-removal-verify.test.ts`
- Modify: `tests/api/badges.test.ts`
- Modify: `tests/api/data-export.test.ts`
- Create/modify: `tests/api/follower-delivery.test.ts`

**Interfaces:**
- Consumes: `post_follows` and `enqueue_follower_notification` from migration 018.
- Produces: unchanged follow API contract plus queue-only `notifyFollowers`.

- [ ] **Step 1: Rewrite follow tests to require table/RPC behavior**

Update `tests/api/follows.test.ts` so:

- GET selects `post_id` from `post_follows` ordered by `created_at desc, post_id`.
- POST `following=true` inserts one row with `onConflict: "user_id,post_id", ignoreDuplicates:true`.
- POST `following=false` and DELETE delete one row by `user_id` and `post_id`.
- A repeated follow returns the same authoritative list and performs no JSON settings upsert.
- `notifyFollowers` calls exactly one `enqueue_follower_notification` RPC and does not call `getNotifyPrefs`, `appendNotification`, `sendEmail`, or `sendSms`.
- Re-submitting the same already-persisted status or identical admin reply performs no event emission and no follower enqueue; add this regression to `posts-full.test.ts`.

Pin the queue-only test:

```ts
it("enqueues one recipient batch and performs no inline delivery", async () => {
  rpc.mockResolvedValue({
    data: {
      batch_id: "batch-1",
      inserted: true,
      recipient_count: 2,
      delivery_count: 3,
      source_event_id: "event-1",
    },
    error: null,
  });
  const { notifyFollowers } = await import("../../api/_follows.js");
  const result = await notifyFollowers(
    "post_abc",
    { type: "post", title: "Solved", body: "Fixed" },
    { idempotencyKey: "followers.post_abc:2026-09-24T12:00:00.000Z", sourceEventId: "event-1", requestId: "r1" },
  );
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("enqueue_follower_notification", {
    p_idempotency_key: "followers.post_abc:2026-09-24T12:00:00.000Z",
    p_post_id: "post_abc",
    p_payload: {
      type: "post",
      title: "Solved",
      body: "Fixed",
    },
    p_source_event_id: "event-1",
    p_request_id: "r1",
  });
  expect(result).toMatchObject({ batch_id: "batch-1", delivery_count: 3 });
});
```

- [ ] **Step 2: Run follow tests and verify the old settings behavior fails them**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/follows.test.ts tests/api/follower-delivery.test.ts
```

Expected: FAIL because `_follows.js` still selects/upserts `settings` and calls providers inline.

- [ ] **Step 3: Implement normalized follow CRUD**

In `_follows.js`:

- Remove `getNotifyPrefs`, `sendEmail`, and `sendSms` imports.
- Keep `verifyCallerIdentity`, rate limits, `clean`, `FOLLOWS_LIMIT=200`, and the public response shape.
- `getFollows(userId)` reads `post_follows` and returns at most 200 IDs.
- POST follow uses one insert; POST unfollow/DELETE uses one delete.
- After insert/delete, call `getFollows` once for the authoritative response.
- Reject a missing/overlong post ID before any DB call.

- [ ] **Step 4: Implement queue-only `notifyFollowers`**

Use this exact signature and behavior:

```js
export async function notifyFollowers(postId, notification = {}, options = {}) {
  const { idempotencyKey, sourceEventId = null, requestId = null } = options;
  if (!postId || !idempotencyKey) {
    throw new Error("notifyFollowers requires postId and idempotencyKey");
  }
  const payload = {
    type: clean(notification.type || "post", 40),
    title: clean(notification.title || "Post updated", 200),
    body: clean(notification.body || "", 1000),
  };
  const { data, error } = await supabase.rpc("enqueue_follower_notification", {
    p_idempotency_key: idempotencyKey,
    p_post_id: postId,
    p_payload: payload,
    p_source_event_id: sourceEventId,
    p_request_id: requestId,
  });
  if (error) throw new Error(`follower enqueue failed: ${error.message}`);
  return data;
}
```

Do not catch and convert the error to `undefined`; `_posts.js` owns safe logging because it has request/event context.

- [ ] **Step 5: Await the post event and enqueue the follower batch**

In `_posts.js`, add `import { logger } from "./_observability.js";`. Define effective changes before queue work so a client retry of an already-applied status/reply does not emit or enqueue again:

```js
const statusChanged = Boolean(patch.status && patch.status !== post.status);
const adminReplyChanged = Boolean(
  patch.admin_reply !== undefined && patch.admin_reply !== post.admin_reply,
);
```

Capture queue outcomes after the authoritative post update has succeeded:

```js
const deliveryWarnings = [];
let statusEvent = null;

if (statusChanged) {
  try {
    statusEvent = await emitEventAndBridge(EVENT_TYPES.POST_STATUS_CHANGED, {
      post_id: id,
      old_status: post.status,
      new_status: patch.status,
    }, {
      idempotencyKey: `post.status_changed:${data.id}:${data.updated_at}`,
      source: "api:_posts",
      requestId: req.requestId,
    });
  } catch (error) {
    deliveryWarnings.push("event_processing_delayed");
    logger.error("posts", "event_queue_write_failed", {
      request_id: req.requestId,
      post_id: id,
      error: String(error.message || error).slice(0, 160),
    });
    await supabase.from("system_metrics").insert({
      metric_name: "event_queue_write_failed",
      metric_value: 1,
      tags: { route: "posts", post_id: id },
    }).catch(() => {});
  }
}

if (admin && (statusChanged || adminReplyChanged)) {
  try {
    await notifyFollowers(id, {
      type: "post",
      title: statusChanged
        ? `Status updated: ${patch.status.replace(/_/g, " ")}`
        : "Admin replied",
      body: post.title || "A post you follow was updated",
    }, {
      idempotencyKey: `followers.${id}:${data.updated_at}`,
      sourceEventId: statusEvent?.id || null,
      requestId: req.requestId,
    });
  } catch (error) {
    deliveryWarnings.push("follower_notification_delivery_delayed");
    logger.error("posts", "follower_queue_write_failed", {
      request_id: req.requestId,
      post_id: id,
      error: String(error.message || error).slice(0, 160),
    });
    await supabase.from("system_metrics").insert({
      metric_name: "follower_queue_write_failed",
      metric_value: 1,
      tags: { route: "posts", post_id: id },
    }).catch(() => {});
  }
}

const responseBody = deliveryWarnings.length
  ? { ...data, warnings: deliveryWarnings }
  : data;
```

Return `responseBody` from the existing success path. If the post update has already committed, a queue failure must not change the successful domain update into a false rollback. The only safe warning values are:

```json
{
  "warnings": [
    "event_processing_delayed",
    "follower_notification_delivery_delayed"
  ]
}
```

Never include provider or queue internals in the warning.

- [ ] **Step 6: Update follows consumers**

- `_badges.js`: keep saved items in settings, but count follows with `supabase.from("post_follows").select("post_id", { count: "exact", head: true }).eq("user_id", id)`.
- `_export.js`: replace `settingsValue(\`follows:${id}\`)` with a `post_follows` select returning `{ post_id }[]`; map to `post_id` so the export shape remains `follows: string[]`.
- Update `badges.test.ts` and `data-export.test.ts` mocks accordingly.

- [ ] **Step 7: Run focused tests and typecheck**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/follows.test.ts tests/api/follower-delivery.test.ts tests/api/posts-full.test.ts tests/api/posts-author-notify.test.ts tests/api/post-removal-verify.test.ts tests/api/badges.test.ts tests/api/data-export.test.ts
npm run typecheck
```

Expected: PASS with no changed public follow response contract.

- [ ] **Step 8: Commit after the human gate**

```powershell
git add api/_follows.js api/_posts.js api/_badges.js api/_export.js tests/api/follows.test.ts tests/api/follower-delivery.test.ts tests/api/posts-full.test.ts tests/api/posts-author-notify.test.ts tests/api/post-removal-verify.test.ts tests/api/badges.test.ts tests/api/data-export.test.ts
git diff --cached --check
git commit -m "feat(followers): enqueue recipient deliveries asynchronously"
```

---

### Task 5: Deliver in-app, email, and SMS from a durable singleton worker

**Files:**
- Create: `api/_follower-delivery.js`
- Create: `api/follower-delivery-worker.js`
- Modify: `api/_dispatch.js`
- Modify: `tests/api/dispatch.test.ts`
- Modify: `tests/api/follower-delivery.test.ts`

**Interfaces:**
- Consumes: follower delivery claim/finalization RPCs, `getNotifyPrefs`, `appendNotification`, `verifyNotificationStored`, `sendEmail`, and `sendSms`.
- Produces: per-channel delivery outcomes and the `follower-delivery-worker` HTTP entry point.

- [ ] **Step 1: Write failing provider idempotency tests**

Add to `tests/api/dispatch.test.ts`:

```ts
it("sends Resend Idempotency-Key", async () => {
  process.env.RESEND_API_KEY = "re-test-key";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: "email-1" }),
    text: async () => "",
  }));
  const result = await sendEmail(
    "user@example.com",
    "Post solved",
    "Fixed",
    { idempotencyKey: "follower:batch-1:anon_1:email" },
  );
  const [, init] = vi.mocked(fetch).mock.calls[0];
  expect(init.headers["Idempotency-Key"]).toBe("follower:batch-1:anon_1:email");
  expect(result).toMatchObject({ ok: true, provider_message_id: "email-1" });
});

it("sends MessageBird reference for correlation", async () => {
  process.env.MESSAGEBIRD_API_KEY = "mb-test-key";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ id: "sms-1" }),
    text: async () => "",
  }));
  await sendSms("+15551234567", "Fixed", { reference: "follower:batch-1:anon_1:sms" });
  const [, init] = vi.mocked(fetch).mock.calls[0];
  expect(JSON.parse(init.body).reference).toBe("follower:batch-1:anon_1:sms");
});
```

Add a network-error test asserting `delivery_unknown:true` and no thrown exception.

- [ ] **Step 2: Run dispatch tests and verify signature/header assertions fail**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/dispatch.test.ts
```

Expected: FAIL because the current functions accept three arguments and send no idempotency/reference fields.

- [ ] **Step 3: Extend `_dispatch.js` with safe result classification**

New signatures:

```js
export async function sendSms(phone, body, { reference = null } = {})
export async function sendEmail(to, subject, body, { idempotencyKey = null } = {})
```

Return contract:

```js
{
  ok: boolean,
  provider: "messagebird" | "resend",
  provider_message_id: string | null,
  error: string | null,
  detail: string | null,
  retryable: boolean,
  delivery_unknown: boolean
}
```

Classification:

- `not_configured`, `invalid_phone`, `invalid_email`, `empty_body`: `retryable=false`, `delivery_unknown=false`.
- Provider 400/401/403/404/422 except 408/429: `retryable=false`, `delivery_unknown=false`.
- Provider 408/425/429/5xx: `retryable=true`, `delivery_unknown=false`.
- Fetch/network exception: `retryable=true`, `delivery_unknown=true`.
- Parse the provider response ID when present; never log recipient values or provider bodies beyond the existing 200-character safe detail.

- [ ] **Step 4: Write failing follower dispatch tests**

In `tests/api/follower-delivery.test.ts`, add cases for:

1. `getNotifyPrefs` returning `null` retries with `preferences_read_failed` and sends nothing.
2. `status_updates=false` marks in-app/email/SMS `skipped` with `preference_disabled` and calls no provider/store.
3. In-app writes deterministic notification ID `notif_<batch-without-dashes>`, then calls `verifyNotificationStored`; only a true read-back completes the row.
4. In-app write success with false verification calls `failFollowerDelivery`, never complete.
5. Email passes `delivery.idempotency_key` to `sendEmail` and stores `provider_message_id` on completion.
6. Retryable provider response calls `failFollowerDelivery` with `p_terminal=false` and `p_delivery_unknown=false`.
7. Ambiguous SMS response calls `failFollowerDelivery("delivery-1", "token-1", "network_error", "fetch failed", false, true)` and ends `dead` without automatic resend.
8. A false result from a conditional complete/fail RPC is counted as `claim_lost`, never success.
9. A second worker invocation with an active lease claims nothing.

- [ ] **Step 5: Implement `_follower-delivery.js` with a pure classifier and bounded runner**

Export:

```js
export function classifyDeliveryResult(result, channel) {
  if (result.ok) {
    return { outcome: "delivered", errorCode: null, terminal: false, deliveryUnknown: false };
  }
  if (["not_configured", "preference_disabled", "destination_missing"].includes(result.error)) {
    return { outcome: "skipped", errorCode: result.error, terminal: false, deliveryUnknown: false };
  }
  if (result.delivery_unknown && channel === "sms") {
    return { outcome: "dead", errorCode: "network_error", terminal: true, deliveryUnknown: true };
  }
  if (result.retryable) {
    return {
      outcome: "retry",
      errorCode: result.error,
      terminal: false,
      deliveryUnknown: Boolean(result.delivery_unknown),
    };
  }
  return {
    outcome: "dead",
    errorCode: result.error || "provider_rejected",
    terminal: true,
    deliveryUnknown: false,
  };
}
```

`runFollowerDeliveryWorker` must acquire `follower-delivery-worker`, claim at most 12, process with concurrency 4, and wrap each row in 8 seconds. `deliverOne` re-reads `getNotifyPrefs(recipient_user_id)` immediately before any channel. Exact channel behavior:

- `prefs === null`: do not send any channel; call `failFollowerDelivery(row.id, row.claim_token, "preferences_read_failed", "preference read failed", false, false)` so a transient preference-read failure retries without bypassing consent.
- `prefs.status_updates === false`: skip all channels with `preference_disabled`.
- `in_app`: build the deterministic notification from `payload`, call `appendNotification`, then `verifyNotificationStored`; complete only on true.
- `email`: call `sendEmail(prefs.email, payload.title, text, { idempotencyKey: row.idempotency_key })`.
- `sms`: call `sendSms(prefs.phone, text, { reference: row.idempotency_key })`.
- Missing destination after enqueue: skip with `destination_missing`.
- Any thrown error: `failFollowerDelivery(job.id, job.claim_token, "handler_exception", safeCode, false, false)`; a provider classifier passes `p_terminal=true` for terminal provider rejection and `p_delivery_unknown=true` for an ambiguous SMS send.

- [ ] **Step 6: Add the follower worker entry point**

`api/follower-delivery-worker.js` uses the same auth/disabled/lease/HTTP response contract as `api/event-worker.js`. Its successful response is:

```json
{
  "ok": true,
  "enabled": true,
  "claimed": 12,
  "delivered": 9,
  "skipped": 1,
  "retried": 1,
  "dead": 1,
  "claim_lost": 0,
  "queue": {},
  "duration_ms": 4210
}
```

`config` is `{ runtime: "nodejs" }`.

- [ ] **Step 7: Run focused worker/provider tests**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/dispatch.test.ts tests/api/follower-delivery.test.ts tests/api/event-agent-worker.test.ts
npm run typecheck
npm run lint
```

Expected: PASS; no test contacts a real provider; no recipient value appears in captured logs.

- [ ] **Step 8: Commit after the human gate**

```powershell
git add api/_dispatch.js api/_follower-delivery.js api/follower-delivery-worker.js tests/api/dispatch.test.ts tests/api/follower-delivery.test.ts tests/api/event-agent-worker.test.ts
git diff --cached --check
git commit -m "feat(followers): process durable channel deliveries"
```

---

### Task 6: Add queue operations, metrics, cron activation, and legacy diagnostic cutover

**Files:**
- Create: `api/_queue-ops.js`
- Create: `tests/api/queue-ops.test.ts`
- Modify: `api/_event-agents.js`
- Modify: `api/_incident-cron.js`
- Modify: `api/_golden-workflows.js`
- Modify: `api/index.js`
- Modify: `vercel.json`
- Modify: `.env.template`
- Modify: `tests/api/admin-gates-runtime.test.ts`
- Modify: `tests/api/schema-contract.test.ts`

**Interfaces:**
- Consumes: event/follower health, dead-letter, and requeue RPCs.
- Produces: admin-only `/api/queue-ops`, bounded manual replay through immutable events, one-minute cron schedules, and queue metrics.

- [ ] **Step 1: Write failing queue-ops authorization and contract tests**

Create `tests/api/queue-ops.test.ts` with these cases:

```ts
it("rejects a non-admin before reading queue data", async () => {
  isAdmin.mockResolvedValue(false);
  const res = await callQueueOps({ method: "GET", query: { queue: "event_agent" } });
  expect(res.statusCode).toBe(403);
  expect(getEventQueueHealth).not.toHaveBeenCalled();
});

it("caps dead-letter reads at 200", async () => {
  isAdmin.mockResolvedValue(true);
  await callQueueOps({ method: "GET", query: { queue: "follower", view: "dead" } });
  expect(from).toHaveBeenCalledWith("follower_deliveries");
  expect(limit).toHaveBeenCalledWith(200);
});

it("requeues only a dead event row", async () => {
  isAdmin.mockResolvedValue(true);
  await callQueueOps({
    method: "POST",
    body: { queue: "event_agent", id: "job-1", action: "requeue" },
  });
  expect(rpc).toHaveBeenCalledWith("requeue_dead_event_outbox", {
    p_job_id: "job-1",
    p_actor: "admin",
    p_request_id: "request-1",
  });
});
```

- [ ] **Step 2: Run the test and verify missing module failure**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/queue-ops.test.ts
```

Expected: FAIL resolving `api/_queue-ops.js`.

- [ ] **Step 3: Implement the admin-only queue-ops handler**

Contract:

- `GET /api/queue-ops?queue=event_agent|follower&view=health|dead`
- `POST /api/queue-ops` body `{ queue, id, action:"requeue" }`
- Every method requires `isAdmin(req)` before any queue read/write.
- `view=dead` selects only safe columns: ID, batch/event ID, agent/channel, status, attempt/max, error code, timestamps, requeue metadata. It never selects payload, email, phone, or recipient ID in the API response.
- Requeue invokes the exact RPC and returns 404 when `updated=false`.
- Log requeue with queue, row ID, request ID, and actor; do not log payload.

- [ ] **Step 4: Make `_event-agents.js` enqueue instead of running inline**

Apply one admin gate before all GET/POST actions. `action=events` and `action=stats` continue to return the existing response shapes backed by `platform_events`/health RPCs. `action=trigger` emits a new immutable event and returns 202:

```json
{
  "accepted": true,
  "event": {},
  "queued_agents": 5
}
```

Use key `manual:${eventType}:${req.requestId}`. `action=replay` emits one new event per selected historical event with:

```json
{
  "replay_of_event_id": "uuid",
  "triggered_by": "admin_replay"
}
```

and key `replay:${historicalEventId}:${req.requestId}`. It must not resurrect or mutate the original outbox row.

- [ ] **Step 5: Replace legacy diagnostics**

In `_incident-cron.js`, replace the event-log settings read with `getEventQueueHealth()` and set:

```js
metrics.event_count = eventHealth.depth;
metrics.event_processing = eventHealth.processing;
metrics.event_dead = eventHealth.dead;
metrics.event_oldest_age_seconds = eventHealth.oldest_age_seconds;
```

In `_golden-workflows.js`, replace `event_log_exists` with `event_outbox_exists` and verify all three relations through bounded `select("id").limit(1)` reads. Preserve the rest of the golden workflow unchanged.

- [ ] **Step 6: Add the route, environment contract, and cron schedules**

In `api/index.js`, add the import beside the other handler imports:

```js
import queueOps from "./_queue-ops.js";
```

Add this entry to the existing `routes` object beside the other `protect(handler, name)` calls:

```js
"queue-ops": protect(queueOps, "queue-ops"),
```

In `.env.template`, add:

```dotenv
# Queue worker activation and provider
DELIVERY_WORKERS_ENABLED=false
CRON_SECRET=
MESSAGEBIRD_API_KEY=
EVENT_WORKER_BATCH_SIZE=3
FOLLOWER_DELIVERY_BATCH_SIZE=12
```

In `vercel.json`, add:

```json
"api/event-worker.js": { "maxDuration": 60 },
"api/follower-delivery-worker.js": { "maxDuration": 60 }
```

and these cron entries:

```json
{ "path": "/api/event-worker", "schedule": "* * * * *" },
{ "path": "/api/follower-delivery-worker", "schedule": "* * * * *" }
```

- [ ] **Step 7: Persist required queue metrics**

At the end of each worker run, write `system_metrics` rows through the existing `recordMetric` helper. Required names:

```text
event_queue_depth
event_oldest_age_seconds
event_jobs_claimed
event_jobs_completed
event_job_retries
event_jobs_dead
follower_queue_depth
follower_oldest_age_seconds
follower_jobs_claimed
follower_delivered
follower_skipped
follower_job_retries
follower_jobs_dead
follower_provider_429
follower_provider_5xx
follower_delivery_unknown
queue_singleton_conflicts
```

Tag metrics with only `{ queue, channel, provider, error_code }`. The API worker response must include the final health object so cron/Vercel logs expose queue depth and oldest age even if metric persistence is unavailable.

- [ ] **Step 8: Update schema and admin-gate coverage**

- Add `platform_events`, `event_outbox`, `post_follows`, `follower_notification_batches`, and `follower_deliveries` column sets to `tests/api/schema-contract.test.ts`.
- Add `_queue-ops.js` and event-agent GET actions to `tests/api/admin-gates-runtime.test.ts`; prove non-admin and missing-token callers are refused before any `rpc`/table access.
- Assert `vercel.json` parses and contains the two one-minute schedules in `tests/api/queue-ops.test.ts`.

- [ ] **Step 9: Run focused and full API verification sequentially**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/queue-ops.test.ts tests/api/admin-gates-runtime.test.ts tests/api/schema-contract.test.ts tests/api/event-outbox.test.ts tests/api/event-agent-worker.test.ts tests/api/follower-delivery.test.ts
npm run typecheck
npm run lint
npm run test:api
```

Expected: focused and full API tests PASS; typecheck and lint exit 0.

- [ ] **Step 10: Commit after the human gate**

```powershell
git add api/_queue-ops.js api/_event-agents.js api/_incident-cron.js api/_golden-workflows.js api/index.js vercel.json .env.template tests/api/queue-ops.test.ts tests/api/admin-gates-runtime.test.ts tests/api/schema-contract.test.ts
git diff --cached --check
git commit -m "feat(ops): expose durable queue health and dead letters"
```

---

### Task 7: Prove real Postgres concurrency, document activation, and rehearse rollback

**Files:**
- Create: `tests/api/queue-sql.integration.test.ts`
- Modify: `docs/OPERATIONS-ENGINE.md`
- Modify: `docs/ROLLBACK.md`

**Interfaces:**
- Consumes: both migrations and all worker/emitter APIs.
- Produces: executable concurrency evidence, a staged activation runbook, and a non-destructive rollback runbook.

- [ ] **Step 1: Write real-Supabase integration tests against a disposable project**

Create `tests/api/queue-sql.integration.test.ts` using `createClient` from the existing dependency. The suite is skipped during the normal API run, but when `RUN_SUPABASE_INTEGRATION=1` it must fail before any write unless all credentials are present and the URL project ref equals `VOICEBOX_ALLOWED_TEST_PROJECT_REF`; it must never accept the production project.

```ts
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const integrationEnabled = process.env.RUN_SUPABASE_INTEGRATION === "1";
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("durable queue SQL integration", () => {
  let db: ReturnType<typeof createClient>;
  const runId = `test:${crypto.randomUUID()}`;

  beforeAll(() => {
    const url = process.env.SUPABASE_TEST_URL;
    const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
    const allowedRef = process.env.VOICEBOX_ALLOWED_TEST_PROJECT_REF;
    if (!url || !key || !allowedRef) {
      throw new Error(
        "SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY, and VOICEBOX_ALLOWED_TEST_PROJECT_REF are required",
      );
    }
    const actualRef = new URL(url).hostname.split(".")[0];
    if (actualRef !== allowedRef) {
      throw new Error(
        `Refusing integration test: ${actualRef} is not the allowlisted test project ${allowedRef}`,
      );
    }
    db = createClient(url, key, { auth: { persistSession: false } });
  });
});
```

Add exact tests:

- Call `emit_event` twice concurrently with the same key and two agent IDs; assert one `platform_events` row and two `event_outbox` rows.
- Insert one pending job, call `claim_event_outbox` concurrently from two owners, assert the total claimed row count is one and the row has one current token.
- Let a claim lease expire, reclaim it, and assert the old token makes `complete_event_outbox=false` while the new token returns true.
- Exhaust five failed claims and assert the final state is `dead` with `attempt_count=5`.
- Insert three `post_follows` rows, configure one follower with in-app+SMS only, and call `enqueue_follower_notification` twice concurrently; assert one batch, three recipients, and exactly the enabled channel rows.
- Claim one delivery from two workers and assert only one receives it.
- Attempt delivery completion with a wrong token and assert the row remains `processing`.

Do not delete `platform_events` in this suite: the append-only trigger intentionally rejects cleanup. Every test uses the per-run `runId`/`source=test:event-outbox`, and the database must be disposable. Follower and outbox rows are left for query evidence and can be removed only by recreating the disposable project; never truncate a shared table.

- [ ] **Step 2: Apply migrations to the disposable database and run the integration suite**

Use PowerShell with operator-provided dedicated test credentials:

```powershell
psql "$env:SUPABASE_TEST_DB_URL" -v ON_ERROR_STOP=1 -f api/migrations/017_event_outbox.sql
psql "$env:SUPABASE_TEST_DB_URL" -v ON_ERROR_STOP=1 -f api/migrations/018_follower_delivery.sql
$env:RUN_SUPABASE_INTEGRATION="1"
npx vitest run --config vitest.config.api.ts tests/api/queue-sql.integration.test.ts
```

Expected: all integration tests PASS. A project-ref mismatch aborts before any write.

- [ ] **Step 3: Verify backfill counts before activation**

Run these read-only queries against staging after migrations:

```sql
select
  (select count(*) from public.platform_events where source = 'legacy_event_log') as event_log_backfilled,
  (select count(*) from public.platform_events where source = 'legacy_pending_agent_events') as pending_backfilled,
  (select count(*) from public.post_follows) as follows_backfilled,
  (select count(distinct lower(substr(key, 9)))
     from public.settings
    where key like 'follows:%') as legacy_follow_users;
```

Expected: `event_log_backfilled` equals the number of valid elements in the captured legacy `event_log`; pending backfill equals valid unconsumed triggers; every legacy follow user is represented in `post_follows`, with duplicate IDs collapsed by the primary key. Record any mismatch and stop activation.

- [ ] **Step 4: Document the exact activation order**

In `docs/OPERATIONS-ENGINE.md`, add this order:

1. Apply migration 017 to dedicated staging; run backfill and integration tests.
2. Apply migration 018; run backfill and integration tests.
3. Deploy with `DELIVERY_WORKERS_ENABLED=false`; emitters may build queues while workers remain paused.
4. Verify `GET /api/queue-ops?queue=event_agent&view=health` and the follower equivalent as admin.
5. Run both worker endpoints manually with valid cron auth; verify claims/completions and no false delivered rows.
6. Set `DELIVERY_WORKERS_ENABLED=true` on a fresh deployment.
7. Observe queue depth, oldest age, retries, dead count, provider errors, and singleton conflicts for 24 hours.
8. Only after 7 days without unexplained loss and with rollback window still open, remove legacy settings rows in a separate human-approved cleanup migration.

- [ ] **Step 5: Document non-destructive rollback**

In `docs/ROLLBACK.md`, define:

1. Set `DELIVERY_WORKERS_ENABLED=false`; queues remain durable and workers stop claiming.
2. If application code is the problem, redeploy the previous Vercel deployment. Do not drop tables and do not delete queued rows.
3. If drain-before-rollback is required, leave workers enabled until `depth=0` and `processing=0`; dead rows are not a drain blocker because they remain auditable.
4. If a schema rollback is explicitly requested after export, use this exact destructive transaction; normal rollback does not run it:

```sql
begin;
drop function if exists public.get_queue_health(text);
drop function if exists public.requeue_dead_follower_delivery(uuid, text, text);
drop function if exists public.fail_follower_delivery(uuid, uuid, text, text, boolean, boolean);
drop function if exists public.skip_follower_delivery(uuid, uuid, text, text);
drop function if exists public.complete_follower_delivery(uuid, uuid, text, text);
drop function if exists public.claim_follower_deliveries(text, integer, integer);
drop function if exists public.enqueue_follower_notification(text, text, jsonb, uuid, text);
drop function if exists public.get_event_stats();
drop function if exists public.get_event_queue_health();
drop function if exists public.release_worker_lease(text, uuid);
drop function if exists public.renew_worker_lease(text, uuid, integer);
drop function if exists public.acquire_worker_lease(text, uuid, integer);
drop function if exists public.requeue_dead_event_outbox(uuid, text, text);
drop function if exists public.fail_event_outbox(uuid, uuid, text, text);
drop function if exists public.complete_event_outbox(uuid, uuid);
drop function if exists public.claim_event_outbox(text, integer, integer);
drop function if exists public.emit_event(text, text, jsonb, text[], text, text, text, text);
drop table if exists public.follower_deliveries;
drop table if exists public.follower_notification_batches;
drop table if exists public.post_follows;
drop table if exists public.event_outbox;
drop table if exists public.queue_worker_leases;
drop table if exists public.platform_events;
drop function if exists public.enforce_post_follow_limit();
drop function if exists public.reject_platform_event_mutation();
commit;
```

5. This schema rollback is destructive and requires separate approval plus an exported copy of every new table. Legacy settings rows are retained until the final cleanup migration, so the previous deployment can resume its original behavior.

- [ ] **Step 6: Run the complete sequential quality gate**

```powershell
npm run test:api
npm run test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0 in sequence. Do not run them in parallel.

- [ ] **Step 7: Review the final diff for forbidden legacy reads/writes**

```powershell
rg -n 'from\("settings"\).*event_log|key", "event_log"|key", "pending_agent_events"|follows:\$\{' api
rg -n 'sendEmail|sendSms|getNotifyPrefs' api/_follows.js
rg -n 'FOR UPDATE SKIP LOCKED' api/migrations/017_event_outbox.sql api/migrations/018_follower_delivery.sql
git diff --check
git status --short
```

Expected: no active application event-log/pending-agent settings access; no provider import in `_follows.js`; both migrations contain `SKIP LOCKED`; no whitespace errors. Reconcile the final status with pre-existing concurrent changes instead of staging unrelated files.

- [ ] **Step 8: Commit tests and runbooks after the human gate**

```powershell
git add tests/api/queue-sql.integration.test.ts docs/OPERATIONS-ENGINE.md docs/ROLLBACK.md
git diff --cached --check
git commit -m "test(events): prove queue concurrency and rollback"
```

## Final Acceptance Checklist

- [ ] `settings.event_log` and `settings.pending_agent_events` receive no new application writes.
- [ ] Concurrent duplicate event keys create one immutable event and one outbox row per mapped agent.
- [ ] Event and follower claims use `FOR UPDATE SKIP LOCKED` and conditional claim tokens.
- [ ] Duplicate cron invocations cannot run two active instances of the same worker.
- [ ] Expired leases are reclaimed; the old claimant cannot complete or fail the new claim.
- [ ] Event agents run only after a durable outbox claim and are complete only after a successful execution.
- [ ] Follower API storage uses `post_follows`; external follow response shapes are unchanged.
- [ ] An admin post update creates one durable follower batch, not inline notification-store/provider fan-out.
- [ ] In-app delivery uses a deterministic notification ID and independent read-back verification.
- [ ] Email retries use the same Resend `Idempotency-Key`; ambiguous SMS is dead-lettered, not falsely delivered.
- [ ] Preferences are checked at execution time, not only at enqueue time.
- [ ] Queue depth, oldest age, attempts, retries, dead letters, provider saturation, and singleton conflicts are visible through worker responses, `system_metrics`, and admin queue ops.
- [ ] Migrations are additive, backfills are verified, legacy rows are retained for rollback, and cleanup is a later human-approved migration.
- [ ] Focused tests, real disposable-Postgres integration tests, full API/frontend tests, typecheck, lint, and build pass sequentially.
