-- Phase D — Cockpit thread spine.
--
-- Moves cockpit conversation threads OFF the filesystem (cockpit-threads/*.json)
-- so the hosted, read-only Worker can show them (it has no filesystem, so the
-- local thread sidecars were invisible). This closes the last "core state is
-- local-only" gap for Phase D (proposals already moved).
--
-- Per Hart's Phase D decision this lives in the fitness project ("Hart Personal
-- Core", xbuinrnpfjltimofwrdx). Doctrine, enforced by construction (mirrors
-- cockpit_proposals exactly):
--   • Node WRITES with the elevated DB role (service-role / the pooler postgres
--     user). RLS is ON and denies the PostgREST roles, so the browser path can
--     never write.
--   • The Worker READS with the anon key, and ONLY through the security-definer
--     RPC below — never the table directly (it has no anon grant).
--
-- Idempotent: safe to re-run. No data is destroyed.

create table if not exists public.cockpit_threads (
  thread_id      text primary key,
  created_at     timestamptz not null,
  updated_at     timestamptz not null default now(),
  entry_count    int not null default 0,
  latest_request text,
  latest_intent  text,
  latest_summary text,
  -- Full CockpitThread JSON for round-trip fidelity on the Node side. The anon
  -- RPC deliberately does NOT return this column — the hosted surface only needs
  -- the scalar summary fields below.
  payload        jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now()
);

create index if not exists cockpit_threads_updated_idx
  on public.cockpit_threads (updated_at desc);

-- RLS on; deny all PostgREST roles. The owner / service-role bypasses RLS for
-- Node writes. Anon reads flow only through the RPC (security definer) below.
alter table public.cockpit_threads enable row level security;
revoke all on public.cockpit_threads from anon, authenticated;

-- Read RPC — anon-callable, read-only, newest-first, scalar summary columns only.
create or replace function public.get_cockpit_threads(p_limit int default 50)
returns table (
  thread_id      text,
  created_at     timestamptz,
  updated_at     timestamptz,
  entry_count    int,
  latest_request text,
  latest_intent  text,
  latest_summary text
)
language sql
stable
security definer
set search_path = public
as $$
  select thread_id, created_at, updated_at, entry_count, latest_request,
         latest_intent, latest_summary
  from public.cockpit_threads
  order by updated_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.get_cockpit_threads(int) from public;
grant execute on function public.get_cockpit_threads(int) to anon, authenticated;

-- Ask PostgREST to refresh its schema cache so the new RPC is reachable.
notify pgrst, 'reload schema';
