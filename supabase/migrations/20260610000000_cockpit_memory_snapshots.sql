-- Step 2b — Executive Memory snapshot spine.
--
-- Moves executive-memory snapshots off ephemeral/in-memory storage so the hosted,
-- read-only Worker cockpit can render REAL Executive Memory (recurring patterns /
-- trends / lessons) instead of the honest INSUFFICIENT_HISTORY line.
--
-- Same doctrine as the proposal spine (Phase D); lives in the fitness project
-- ("Hart Personal Core", xbuinrnpfjltimofwrdx):
--   • Node WRITES with the elevated DB role (RLS bypass). RLS is ON and denies the
--     PostgREST roles, so the browser/anon path can never write.
--   • The Worker READS with the anon key, ONLY through the security-definer RPC
--     below — never the table directly (no anon grant).
--   • One row per UTC day — matches the capture policy's dedupe-by-day discipline.
--
-- The snapshot JSON is a COMPACT MemorySnapshot (finding subjects + a few metrics +
-- optional decisions). No secrets by construction; the Worker renders it directly.
--
-- Idempotent: safe to re-run. No data is destroyed.

create table if not exists public.cockpit_memory_snapshots (
  day         text primary key,                 -- UTC calendar day (YYYY-MM-DD)
  captured_at timestamptz not null,             -- the snapshot's `at`
  snapshot    jsonb not null,                   -- the compact MemorySnapshot JSON
  synced_at   timestamptz not null default now()
);

create index if not exists cockpit_memory_snapshots_captured_idx
  on public.cockpit_memory_snapshots (captured_at desc);

-- RLS on; deny all PostgREST roles. The owner / service-role bypasses RLS for Node
-- writes. Anon reads flow only through the security-definer RPC below.
alter table public.cockpit_memory_snapshots enable row level security;
revoke all on public.cockpit_memory_snapshots from anon, authenticated;

-- Read RPC — anon-callable, read-only, oldest-first (the memory layer sorts anyway),
-- returns the full compact snapshot JSON the cockpit reasons over.
create or replace function public.get_cockpit_memory_snapshots(p_limit int default 120)
returns table (
  day         text,
  captured_at timestamptz,
  snapshot    jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select day, captured_at, snapshot
  from public.cockpit_memory_snapshots
  order by captured_at asc
  limit greatest(1, least(coalesce(p_limit, 120), 400))
$$;

revoke all on function public.get_cockpit_memory_snapshots(int) from public;
grant execute on function public.get_cockpit_memory_snapshots(int) to anon, authenticated;

-- Ask PostgREST to refresh its schema cache so the new RPC is reachable.
notify pgrst, 'reload schema';
