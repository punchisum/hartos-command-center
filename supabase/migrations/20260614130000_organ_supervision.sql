-- 20260614130000_organ_supervision.sql
-- SP-Organs: runtime-contract columns on agent_registry + organ_runs evidence ledger + RPCs.
-- Target project: cockpit Supabase (xbuinrnpfjltimofwrdx).
-- Spec: docs/superpowers/specs/2026-06-14-sp-organs-design.md
-- Plan: docs/superpowers/plans/2026-06-14-sp-organs.md
--
-- Doctrine: UI = Reflect(SOT). Status is DERIVED from evidence (deriveOrganStatus), never stored as
-- truth. can_execute = permissions.execute; required_approval_gate = arming_flag; authority_tier = tier.

-- 1) Runtime-contract columns on the existing agent_registry table.
alter table public.agent_registry
  add column if not exists runtime_kind text not null default 'daemon-supervised'
    check (runtime_kind in ('worker','daemon','daemon-supervised','external-webhook','projection')),
  add column if not exists heartbeat_source text,
  add column if not exists can_write_external boolean not null default false,
  add column if not exists detail_page text,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_output_ref text,
  add column if not exists staleness_threshold_sec integer not null default 900,
  add column if not exists failure_state jsonb;

comment on column public.agent_registry.runtime_kind is
  'SP-Organs: where the organ runs (worker/daemon/daemon-supervised/external-webhook/projection).';
comment on column public.agent_registry.heartbeat_source is
  'SP-Organs: pointer to the evidence that proves liveness (table/daemon_id/RPC/worker-route).';
comment on column public.agent_registry.last_run_at is
  'SP-Organs: updated by the supervisor on each organ run; feeds deriveOrganStatus.';
comment on column public.agent_registry.last_output_ref is
  'SP-Organs: SOT-readable handle to the last output (row id / vault path); part of the LIVE gate.';

-- 2) organ_runs — append-only run/output evidence ledger.
create table if not exists public.organ_runs (
  id          bigint generated always as identity primary key,
  organ_id    text        not null references public.agent_registry(agent_id) on delete cascade,
  run_at      timestamptz not null default now(),
  trigger     text        not null check (trigger in ('scheduled','on_demand','worker')),
  ok          boolean     not null,
  disarmed    boolean     not null default false,
  output_ref  text,
  summary     text,
  detail      jsonb,
  duration_ms integer
);
comment on table public.organ_runs is
  'SP-Organs: append-only run/output evidence per organ. fresh heartbeat + real run + output_ref + '
  'cockpit readback => LIVE (deriveOrganStatus). Insert-only by design.';
create index if not exists organ_runs_recent_idx on public.organ_runs (organ_id, run_at desc);

alter table public.organ_runs enable row level security;
revoke all on public.organ_runs from public;
revoke all on public.organ_runs from anon;
revoke all on public.organ_runs from authenticated;
grant select, insert on table public.organ_runs to service_role;

-- 3) Replace the registry list RPC to also return the new contract + evidence columns.
-- DROP first: the return type (OUT params) changes, which CREATE OR REPLACE cannot do.
drop function if exists public.hartos_list_agent_registry();
create function public.hartos_list_agent_registry()
returns table (
  agent_id text, display_name text, capability_summary text, parent_id text, tier text,
  lifecycle text, permissions jsonb, arming_flag text, source_proposal_id text, known_risks jsonb,
  created_at timestamptz, approved_at timestamptz, retired_at timestamptz, synced_at timestamptz,
  runtime_kind text, heartbeat_source text, can_write_external boolean, detail_page text,
  last_run_at timestamptz, last_output_ref text, staleness_threshold_sec integer, failure_state jsonb
)
language sql security definer stable set search_path = public as $$
  select r.agent_id, r.display_name, r.capability_summary, r.parent_id, r.tier, r.lifecycle,
         r.permissions, r.arming_flag, r.source_proposal_id, r.known_risks, r.created_at,
         r.approved_at, r.retired_at, r.synced_at, r.runtime_kind, r.heartbeat_source,
         r.can_write_external, r.detail_page, r.last_run_at, r.last_output_ref,
         r.staleness_threshold_sec, r.failure_state
  from public.agent_registry r where r.lifecycle <> 'retired' order by r.created_at asc;
$$;
grant execute on function public.hartos_list_agent_registry() to anon;
grant execute on function public.hartos_list_agent_registry() to authenticated;

-- 4) Recent-runs RPC for the cockpit readback (non-secret; latest N runs per organ).
drop function if exists public.hartos_list_organ_runs(integer);
create function public.hartos_list_organ_runs(p_limit integer default 5)
returns table (
  organ_id text, run_at timestamptz, trigger text, ok boolean, disarmed boolean,
  output_ref text, summary text, duration_ms integer
)
language sql security definer stable set search_path = public as $$
  select s.organ_id, s.run_at, s.trigger, s.ok, s.disarmed, s.output_ref, s.summary, s.duration_ms
  from (
    select o.*, row_number() over (partition by o.organ_id order by o.run_at desc) rn
    from public.organ_runs o
  ) s where s.rn <= greatest(1, least(p_limit, 50)) order by s.organ_id asc, s.run_at desc;
$$;
grant execute on function public.hartos_list_organ_runs(integer) to anon;
grant execute on function public.hartos_list_organ_runs(integer) to authenticated;

notify pgrst, 'reload schema';
