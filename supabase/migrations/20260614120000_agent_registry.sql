-- 20260614120000_agent_registry.sql
--
-- P-cockpit — dynamic agent-registry table + security-definer list RPC.
--
-- DESIGNED, NOT APPLIED — applying this migration is Hart's gate.
-- Target project: cockpit Supabase project (xbuinrnpfjltimofwrdx),
-- per the two-DB split (the agent registry belongs with cockpit_proposals, NOT GECAN OPS).
--
-- Design: docs/superpowers/specs/2026-06-14-dynamic-agent-registration-cockpit.md
-- Contract: src/agents/agent-manifest.ts (AgentManifest + deriveAgentStatus).
--
-- Constitutional requirement (Hart, 2026-06-14): the cockpit is a VISUALIZATION of the
-- source of truth, not a static dashboard. Each agent publishes an AgentManifest record
-- on Synapse approval (the existing proposal approval gate); `lifecycle` is the AUTHORED
-- part. The DISPLAYED status is NEVER stored — it is DERIVED at read time from manifest +
-- liveness read-model + arming, via deriveAgentStatus. Nothing is "live" unless its
-- manifest is approved AND a health read-model confirms it (liveness "up").
--
-- Flow:
--   1. Node (elevated, service_role) writes/upserts a manifest row on Synapse approval.
--   2. The Worker (anon key) reads the non-secret manifest columns via the security-definer
--      RPC hartos_list_agent_registry() — it cannot read the table directly.
--   3. The cockpit derives DerivedStatus client-side (deriveAgentStatus) from the manifest +
--      Sentinel liveness read-model + kill-switch — status is computed, never hardcoded.
--
-- Security:
--   - REVOKE all from public/anon/authenticated on the table (service_role only for writes)
--   - The list RPC is SECURITY DEFINER, returns only the non-secret manifest columns for
--     NON-RETIRED agents, granted to anon + authenticated (the Worker reads via this)
--
-- Grant hardening mirrors 20260614000000_ask_requests_relay.sql /
-- 2026060900000001_cockpit_spine_service_role_grants.sql.
-- notify pgrst at the end so PostgREST re-introspects the schema immediately.

-- ── Table ────────────────────────────────────────────────────────────────────
-- Columns mirror the AgentManifest contract (src/agents/agent-manifest.ts) 1:1.

create table if not exists public.agent_registry (
  agent_id           text        primary key,     -- stable slug (AgentManifest.agentId)
  display_name       text        not null,
  capability_summary text        not null,        -- one-line capability summary
  parent_id          text,                        -- org-hierarchy parent; null = root
  tier               text        not null,        -- autonomy tier, e.g. "T0".."T6"
  lifecycle          text        not null default 'draft'
                                 check (lifecycle in (
                                   'draft',
                                   'pending_approval',
                                   'approved',
                                   'provisioning',
                                   'live',
                                   'retired'
                                 )),
  permissions        jsonb       not null default '{"propose": false, "execute": false}'::jsonb,
  arming_flag        text,                         -- env flag that arms its hands, or null
  source_proposal_id text,                         -- build_agent_plan proposal, or null
  known_risks        jsonb       not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  approved_at        timestamptz,
  retired_at         timestamptz,
  synced_at          timestamptz not null default now()
);

comment on table public.agent_registry is
  'P-cockpit: the dynamic agent registry — durable AgentManifest records written on Synapse '
  'approval (Node/service_role, elevated). The cockpit VISUALIZES these as source of truth; '
  'DerivedStatus is computed at read time (deriveAgentStatus), never stored here. '
  'Contract: src/agents/agent-manifest.ts. '
  'Design: docs/superpowers/specs/2026-06-14-dynamic-agent-registration-cockpit.md';

comment on column public.agent_registry.agent_id is
  'Stable slug (AgentManifest.agentId). Primary key.';
comment on column public.agent_registry.lifecycle is
  'AUTHORED lifecycle (build/approval pipeline). The DISPLAYED status is derived, never authored.';
comment on column public.agent_registry.permissions is
  'AgentManifest.permissions: {propose: bool, execute: bool}. permissions.execute gates the disarmed rule.';
comment on column public.agent_registry.arming_flag is
  'The env flag that arms its hands (e.g. "HARTOS_ALLOW_SELF_MOD"), or null if none.';
comment on column public.agent_registry.known_risks is
  'JSON array of known-risk strings (AgentManifest.knownRisks).';
comment on column public.agent_registry.synced_at is
  'Last upsert timestamp from the Node writer; distinct from created_at/approved_at.';

-- Index: the list RPC filters out retired agents (lifecycle <> 'retired').
create index if not exists agent_registry_active_idx
  on public.agent_registry (created_at asc)
  where lifecycle <> 'retired';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Fail-closed: no public/anon/authenticated access. All writes go through Node
-- (service_role, elevated). The Worker reads via the security-definer RPC below,
-- NOT direct table access.

alter table public.agent_registry enable row level security;

-- Revoke all from public, anon, and authenticated — service_role bypasses RLS by default.
revoke all on public.agent_registry from public;
revoke all on public.agent_registry from anon;
revoke all on public.agent_registry from authenticated;

-- service_role needs explicit table-level DML (RLS-bypass is not a PostgREST grant).
-- SELECT/INSERT/UPDATE only — the Node writer upserts (retire = lifecycle update), never deletes.
grant select, insert, update on table public.agent_registry to service_role;

-- ── Security-definer list RPC ────────────────────────────────────────────────
-- The Worker (anon key) calls this to read the NON-SECRET manifest columns for all
-- NON-RETIRED agents. SECURITY DEFINER = runs as owner (bypasses RLS), but it exposes
-- only the authored manifest fields the cockpit needs to derive status — no secrets are
-- stored on the row, so the whole non-retired manifest set is safe to return. Grant to
-- anon so the Worker can call /rest/v1/rpc/hartos_list_agent_registry.

create or replace function public.hartos_list_agent_registry()
returns table (
  agent_id           text,
  display_name       text,
  capability_summary text,
  parent_id          text,
  tier               text,
  lifecycle          text,
  permissions        jsonb,
  arming_flag        text,
  source_proposal_id text,
  known_risks        jsonb,
  created_at         timestamptz,
  approved_at        timestamptz,
  retired_at         timestamptz,
  synced_at          timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.agent_id,
    r.display_name,
    r.capability_summary,
    r.parent_id,
    r.tier,
    r.lifecycle,
    r.permissions,
    r.arming_flag,
    r.source_proposal_id,
    r.known_risks,
    r.created_at,
    r.approved_at,
    r.retired_at,
    r.synced_at
  from public.agent_registry r
  where r.lifecycle <> 'retired'
  order by r.created_at asc;
$$;

comment on function public.hartos_list_agent_registry() is
  'P-cockpit: Security-definer list RPC for the agent_registry. Called by the Worker (anon key) '
  'to read the non-secret AgentManifest columns for all NON-RETIRED agents. The cockpit derives '
  'DerivedStatus from these + the Sentinel liveness read-model (deriveAgentStatus); status is never '
  'stored. SECURITY DEFINER = runs as owner to bypass RLS; only authored manifest fields are returned.';

grant execute on function public.hartos_list_agent_registry() to anon;
grant execute on function public.hartos_list_agent_registry() to authenticated;

-- ── Notify PostgREST ─────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
