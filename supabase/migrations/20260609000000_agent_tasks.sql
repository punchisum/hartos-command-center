-- PLANNING-ONLY — apply is gated/go-live; do not apply from this build.
--
-- The typed-task spine: a durable `agent_tasks` table (one row per task) for the gated
-- autonomy loop (propose → approve → execute → audit). It is the persistent analog of
-- the in-memory AgentJob / AgentTask types in src/tasks/agent-task-types.ts. This file
-- is a PLANNING artifact only — NOTHING in this build applies it, and there is no apply
-- path wired to it. It exists so the schema is reviewable ahead of the gated go-live pass.
--
-- Additive + fail-closed by construction (classified SAFE by src/supabase/destructive-sql-scan.ts):
--   • CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only — no DROP/TRUNCATE/DELETE.
--   • RLS is ENABLED and PostgREST roles are DENIED, mirroring cockpit_proposals: Node
--     writes with the elevated DB role (RLS-bypassing); the hosted Worker, if it ever
--     reads, would go only through a future security-definer RPC (not declared here).
--   • Executor-only states (in_progress/done/failed) are enforced in the PURE lifecycle
--     (src/tasks/agent-task-lifecycle.ts), not in SQL — the table just stores the status.
--   • Idempotent: safe to re-run. No data is destroyed.
--
-- Lifecycle (status CHECK): queued → assigned → in_progress → done | failed | cancelled.

create table if not exists public.agent_tasks (
  id                      text primary key,
  domain                  text not null
                            check (domain in ('fitness', 'ops', 'factory', 'system', 'research')),
  owner                   text,
  owner_agent_type        text,
  task_type               text not null,
  title                   text not null,
  status                  text not null default 'queued'
                            check (status in ('queued', 'assigned', 'in_progress', 'done', 'failed', 'cancelled')),
  -- Link to the authorizing proposal/spec (no authorizing proposal = no execution).
  authorizing_proposal_id text,
  authorizing_spec_id     text,
  -- The approval floor — always 'Hart' in this build (mirrors cockpit_proposals).
  required_approval       text not null default 'Hart' check (required_approval = 'Hart'),
  -- Descriptive payload + the append-only audit trail, carried as jsonb for round-trip
  -- fidelity with the AgentTask type. Nothing here is executed by the DB.
  payload                 jsonb not null default '{}'::jsonb,
  audit_events            jsonb not null default '[]'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Newest-first by status — the cockpit's "open work" view and the orchestrator's routing
-- both scan by (status, created_at).
create index if not exists agent_tasks_status_created_idx
  on public.agent_tasks (status, created_at desc);

-- Route/lookup by owning agent.
create index if not exists agent_tasks_owner_idx
  on public.agent_tasks (owner);

-- Trace a task back to the proposal that authorized it.
create index if not exists agent_tasks_authorizing_proposal_idx
  on public.agent_tasks (authorizing_proposal_id);

-- RLS on; deny all PostgREST roles. The owner / service-role bypasses RLS for Node
-- writes. No anon/authenticated grant — a future read path would be a security-definer
-- RPC (deliberately NOT declared in this planning artifact).
alter table public.agent_tasks enable row level security;
revoke all on public.agent_tasks from anon, authenticated;

comment on table public.agent_tasks is
  'PLANNING-ONLY (not applied in this build): durable typed-task spine for the gated autonomy loop. Status lifecycle enforced in the pure src/tasks lifecycle; executor-only states (in_progress/done/failed) set only by the Node executor.';
