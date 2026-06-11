-- HARTOS audit 2026-06-11 — GECAN OPS AGENT (tbdkveyixqjksamcdemr)
--
-- Finding (Supabase security advisor + grants snapshot): every SECURITY
-- DEFINER function — including mutators such as create_ops_raw_event,
-- upsert_ops_sync_status, apply_/reject_ ops digest proposal functions —
-- is executable by anon AND authenticated AND PUBLIC. Anyone with the anon
-- key can write ops data.
--
-- Observed live callers (API logs, last 24h):
--   - gecan-ops-ai-webhook Worker: direct table writes that succeed despite
--     RLS-without-policies => runs as service_role (unaffected).
--   - n8n: rpc/create_ops_audit_event + rpc/get_ops_system_state (kept granted
--     in case n8n uses the anon key).
--   - Hosted cockpit: the 5 read RPCs below (currently 401 — key misconfigured
--     on the Worker, see backfill checklist).
--
-- Fix:
--   1) Revoke PUBLIC everywhere; grant service_role explicitly.
--   2) Revoke anon + authenticated on everything EXCEPT the cockpit read
--      allowlist and the two RPCs n8n calls.
--   3) Pin search_path on ops_set_updated_at (advisor: mutable search_path).
--
-- Rollback: GRANT EXECUTE ON FUNCTION <signature> TO anon, authenticated;

do $$
declare
  fn record;
  keep_anon constant text[] := array[
    -- hosted cockpit read-only allowlist (read-models)
    'get_ops_overview','get_ops_attention_cards','get_ops_recent_updates',
    'get_ops_status_counts','get_ops_risk_flags',
    -- observed n8n callers (possibly on anon key)
    'get_ops_system_state','create_ops_audit_event'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
    if not (fn.name = any(keep_anon)) then
      execute format('revoke execute on function %s from anon', fn.sig);
      execute format('revoke execute on function %s from authenticated', fn.sig);
    end if;
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
      and p.proname = 'ops_set_updated_at'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.sig);
  end loop;
end $$;
