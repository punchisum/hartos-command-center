-- 20260614140000_organ_runs_errored.sql
-- SP-Organs: distinguish a GENUINE error (escaped throw) from an honest ok:false (disarmed /
-- not-yet-live). Without this, deriveOrganStatus mapped any ok:false run to FAILED, so honestly
-- disarmed/partial organs (prophet, council, factory, ops, ...) rendered FAILED — a dishonest
-- cockpit. errored=true => FAILED; honest ok:false => PARTIAL. Target: cockpit DB (xbuinrnpfjltimofwrdx).

alter table public.organ_runs add column if not exists errored boolean not null default false;

comment on column public.organ_runs.errored is
  'SP-Organs: true only when the organ run threw an unexpected error (escaped the adapter). An honest '
  'ok:false (disarmed / not-yet-live) is NOT errored. deriveOrganStatus maps errored -> FAILED; '
  'honest ok:false -> PARTIAL.';

-- The readback RPC must surface `errored` so the Worker's deriver can map it to FAILED.
drop function if exists public.hartos_list_organ_runs(integer);
create function public.hartos_list_organ_runs(p_limit integer default 5)
returns table (
  organ_id text, run_at timestamptz, trigger text, ok boolean, disarmed boolean, errored boolean,
  output_ref text, summary text, duration_ms integer
)
language sql security definer stable set search_path = public as $$
  select s.organ_id, s.run_at, s.trigger, s.ok, s.disarmed, s.errored, s.output_ref, s.summary, s.duration_ms
  from (
    select o.*, row_number() over (partition by o.organ_id order by o.run_at desc) rn
    from public.organ_runs o
  ) s where s.rn <= greatest(1, least(p_limit, 50)) order by s.organ_id asc, s.run_at desc;
$$;
grant execute on function public.hartos_list_organ_runs(integer) to anon;
grant execute on function public.hartos_list_organ_runs(integer) to authenticated;

notify pgrst, 'reload schema';
