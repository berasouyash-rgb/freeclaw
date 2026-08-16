-- ═══════════════════════════════════════════════════════════════
-- 008 — AI WORKFORCE: PERSISTENT TASK QUEUE
-- The agent execution layer (agent_executions, agent_activity_log,
-- agent_memory, tool_calls, system_metrics) already exists. This
-- migration adds the TASK layer: the persistent task queue every
-- worker claims work from, with heartbeats for stale-recovery.
--
-- IMPORTANT: the production DB may already have a LEGACY agent_tasks
-- table (id, thread_id, agent_id, task, priority, status, created_by,
-- created_at, completed_at, result). This script upgrades it in place
-- instead of failing — run it once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════

-- ─── agent_tasks — the persistent task queue ─────────────────────
-- Statuses: queued → claimed → working → verifying → completed
--                                            ↘ failed / blocked
create table if not exists agent_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text,
  task          text,                              -- legacy alias for title
  description   text,
  thread_id     text,                              -- legacy: inbox thread link
  agent_id      text,                              -- legacy: requested agent
  source        text not null default 'manual',   -- report | moderation | error | system | manual | admin
  source_ref    text,                              -- e.g. report:<id> for dedupe/audit
  priority      text not null default 'medium',    -- low | medium | high | critical
  status        text not null default 'queued',    -- queued|claimed|working|verifying|completed|failed|blocked|cancelled|pending
  assigned_agent text,                             -- agent_id currently owning the task
  parent_task_id text,                             -- handoff chain: id of the task that spawned this one
  required_capability text,                        -- capability needed (orchestrator match)
  risk_level    text not null default 'low',       -- low | medium | high | critical
  input         jsonb,                             -- real input payload for the worker
  output        jsonb,                             -- real result produced by the worker
  outcomes      jsonb,                             -- VERIFIED real product changes: [{type, target_id, verified, evidence, at}]
  error         text,                              -- real error if failed
  verification_status text default 'none',         -- none | passed | failed | awaiting_approval
  attempts      int not null default 0,            -- retries so far
  max_attempts  int not null default 3,            -- work budget
  created_by    text default 'system',             -- who created it (system|admin|orchestrator)
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  started_at    timestamptz,
  heartbeat_at  timestamptz,                       -- worker liveness — stale → recovered
  completed_at  timestamptz,
  result        jsonb                              -- legacy result alias
);

-- Upgrade a pre-existing legacy table in place (safe, idempotent)
alter table agent_tasks add column if not exists title text;
alter table agent_tasks add column if not exists task text;
alter table agent_tasks add column if not exists description text;
alter table agent_tasks add column if not exists thread_id text;
alter table agent_tasks add column if not exists agent_id text;
alter table agent_tasks add column if not exists source text not null default 'manual';
alter table agent_tasks add column if not exists source_ref text;
alter table agent_tasks add column if not exists assigned_agent text;
alter table agent_tasks add column if not exists parent_task_id text;
alter table agent_tasks add column if not exists required_capability text;
alter table agent_tasks add column if not exists risk_level text not null default 'low';
alter table agent_tasks add column if not exists input jsonb;
alter table agent_tasks add column if not exists output jsonb;
alter table agent_tasks add column if not exists outcomes jsonb;
alter table agent_tasks add column if not exists error text;
alter table agent_tasks add column if not exists verification_status text default 'none';
alter table agent_tasks add column if not exists attempts int not null default 0;
alter table agent_tasks add column if not exists max_attempts int not null default 3;
alter table agent_tasks add column if not exists created_by text default 'system';
alter table agent_tasks add column if not exists claimed_at timestamptz;
alter table agent_tasks add column if not exists started_at timestamptz;
alter table agent_tasks add column if not exists heartbeat_at timestamptz;
alter table agent_tasks add column if not exists result jsonb;

-- Backfill title from legacy `task` column so the queue is readable
update agent_tasks set title = task where (title is null or title = '') and task is not null;
-- Normalize legacy pending → queued so the orchestrator picks them up
update agent_tasks set status = 'queued' where status = 'pending' and assigned_agent is null;

create index if not exists agent_tasks_status_idx    on agent_tasks (status, priority desc, created_at);
create index if not exists agent_tasks_agent_idx     on agent_tasks (assigned_agent, status);
create index if not exists agent_tasks_heartbeat_idx on agent_tasks (status, heartbeat_at);
create index if not exists agent_tasks_parent_idx    on agent_tasks (parent_task_id);

-- ─── heartbeat_at on agent_executions (runner liveness) ────────────
-- The runner (agents/_runner.js) writes heartbeat_at every 10s while an
-- execution is running, and recoverStaleExecutions() uses it to recover
-- stuck 'running' rows. The pre-existing agent_executions table has no
-- such column — add it here (idempotent).
alter table agent_executions add column if not exists heartbeat_at timestamptz;

-- ─── RLS: service-role only (same posture as other agent tables) ──
-- The API server client uses the service_role key, which bypasses RLS
-- entirely — this policy is defense-in-depth so anon/public connections
-- can neither read nor write the task queue.
alter table agent_tasks enable row level security;

drop policy if exists "agent_tasks_admin_all" on agent_tasks;
create policy "agent_tasks_admin_all"
  on agent_tasks for all
  using ( coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), 'anon') = 'service_role' )
  with check ( coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), 'anon') = 'service_role' );
