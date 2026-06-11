-- HARTOS audit 2026-06-11 — Hart Personal Core (xbuinrnpfjltimofwrdx)
--
-- Finding (Supabase security advisor): all SECURITY DEFINER functions in
-- `public` are executable by every role via the default PUBLIC grant —
-- including mutators like log_fitness_workout and update_fitness_nutrition_draft,
-- which the anon key (shipped to the cockpit Worker) could call.
--
-- Fix:
--   1) Revoke PUBLIC EXECUTE on every SECURITY DEFINER function; grant
--      service_role explicitly so Trigger.dev / webhook flows keep working.
--      Deliberate explicit grants (anon on read-only get_* RPCs, authenticated
--      on draft approval functions) are NOT touched.
--   2) Pin search_path on the functions flagged "mutable search_path".
--
-- Rollback: GRANT EXECUTE ON FUNCTION <signature> TO PUBLIC; per function
-- (see the grants snapshot in the session report / advisor history).

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('hartos_day_name','hartos_schedule_day_date','hartos_schedule_day_to_index','hartos_today_sg','set_updated_at')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.sig);
  end loop;
end $$;
