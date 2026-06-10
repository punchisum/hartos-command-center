-- Five-upgrade batch — cockpit pulse-run spine (serves BOTH the Last-Pulse tile and
-- forecast-accuracy scoring from one table).
--
-- Each daily autopilot pulse writes ONE row: its verdict, the Prophet forecast verdict, a short
-- summary, the finding count, and the forecast's consequence subjects. The cockpit reads the latest
-- row for the "Last Pulse" tile (so the 7am pulse is visible, not buried in a log), and the recent
-- series feeds a pure forecast-accuracy scorer (did predicted consequences persist or resolve?).
--
-- Lives in the "Hart Personal Core" project (xbuinrnpfjltimofwrdx). Doctrine, mirrors
-- cockpit_proposals / cockpit_threads EXACTLY:
--   • Node WRITES with the elevated DB role (owner bypasses RLS).
--   • The Worker READS with the anon key ONLY through the security-definer RPC below.
-- Idempotent: safe to re-run. No data is destroyed.

create table if not exists public.cockpit_pulse_runs (
  id                   bigint generated always as identity primary key,
  at                   timestamptz not null,
  verdict              text,
  forecast_verdict     text,
  summary              text,
  finding_count        int not null default 0,
  -- The forecast's predicted consequence subjects — the input the accuracy scorer compares
  -- across consecutive pulses (persisted = forecast held; gone = resolved).
  consequence_subjects text[] not null default '{}',
  payload              jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists cockpit_pulse_runs_at_idx
  on public.cockpit_pulse_runs (at desc);

alter table public.cockpit_pulse_runs enable row level security;
revoke all on public.cockpit_pulse_runs from anon, authenticated;

-- Read RPC — anon-callable, read-only, newest-first, scalar columns only.
create or replace function public.get_recent_pulse_runs(p_limit int default 14)
returns table (
  id                   bigint,
  at                   timestamptz,
  verdict              text,
  forecast_verdict     text,
  summary              text,
  finding_count        int,
  consequence_subjects text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select id, at, verdict, forecast_verdict, summary, finding_count, consequence_subjects
  from public.cockpit_pulse_runs
  order by at desc
  limit greatest(1, least(coalesce(p_limit, 14), 100))
$$;

revoke all on function public.get_recent_pulse_runs(int) from public;
grant execute on function public.get_recent_pulse_runs(int) to anon, authenticated;

-- Ask PostgREST to refresh its schema cache so the new RPC is reachable.
notify pgrst, 'reload schema';
