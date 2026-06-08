-- Phase D — Cockpit proposal spine.
--
-- Moves the cockpit proposal queue OFF the filesystem so the hosted, read-only
-- Worker can show real proposals (it has no filesystem, so the local
-- cockpit-proposals/*.json sidecars were invisible → the "0 proposals" bug).
--
-- Per Hart's Phase D decision this lives in the fitness project ("Hart Personal
-- Core", xbuinrnpfjltimofwrdx). Doctrine, enforced by construction:
--   • Node WRITES with the elevated DB role (service-role / the pooler postgres
--     user). RLS is ON and denies the PostgREST roles, so the browser path can
--     never write.
--   • The Worker READS with the anon key, and ONLY through the security-definer
--     RPC below — never the table directly (it has no anon grant).
--
-- Idempotent: safe to re-run. No data is destroyed.

create table if not exists public.cockpit_proposals (
  id            text primary key,
  domain        text not null,
  action_type   text not null,
  title         text not null,
  risk_level    text not null,
  status        text not null,
  source_intent text,
  spec_id       text,
  created_at    timestamptz not null,
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz,
  -- Full ProposalQueueItem JSON for round-trip fidelity on the Node side. The
  -- anon RPC deliberately does NOT return this column — the hosted surface only
  -- needs the scalar fields below.
  payload       jsonb not null default '{}'::jsonb,
  synced_at     timestamptz not null default now()
);

create index if not exists cockpit_proposals_status_created_idx
  on public.cockpit_proposals (status, created_at desc);

-- RLS on; deny all PostgREST roles. The owner / service-role bypasses RLS for
-- Node writes. Anon reads flow only through the RPC (security definer) below.
alter table public.cockpit_proposals enable row level security;
revoke all on public.cockpit_proposals from anon, authenticated;

-- Read RPC — anon-callable, read-only, newest-first, scalar columns only.
-- security definer + a pinned search_path so it runs as the owner and ignores
-- the (deny-all) RLS for the caller, exposing ONLY these safe columns.
create or replace function public.get_cockpit_proposals(p_limit int default 50)
returns table (
  id            text,
  domain        text,
  action_type   text,
  title         text,
  risk_level    text,
  status        text,
  source_intent text,
  spec_id       text,
  created_at    timestamptz,
  updated_at    timestamptz,
  expires_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, domain, action_type, title, risk_level, status, source_intent,
         spec_id, created_at, updated_at, expires_at
  from public.cockpit_proposals
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.get_cockpit_proposals(int) from public;
grant execute on function public.get_cockpit_proposals(int) to anon, authenticated;

-- Ask PostgREST to refresh its schema cache so the new RPC is reachable.
notify pgrst, 'reload schema';
