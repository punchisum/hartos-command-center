-- 20260615150000_cockpit_proposals_audit_events.sql
--
-- Live Operations visibility: the hosted cockpit projects proposals into "tasks in flight" but
-- could show NOTHING about what an individual task is actually doing — get_cockpit_proposals
-- returns scalars only, so mapRowToProposalQueueItem hardcodes auditEvents to []. Surface the
-- per-task progress trail by adding TWO derived columns (same pattern as the job_kind migration:
-- derive from the payload jsonb, do NOT ship the whole payload):
--   * audit_events — payload->'auditEvents' (the append-only lifecycle trail: {at,event,detail}).
--                    Event NAMES + short details only; never beforeState/afterState or a secret.
--   * job_arg      — payload->'proposedPayload'->>'jobArg' (what the agent_job was actually asked).
-- Return-type change ⇒ drop + recreate (+ re-grant). Additive: no row is touched, no column added
-- to the table; the RPC simply exposes two more fields it already had in the jsonb.

drop function if exists public.get_cockpit_proposals(int);

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
  expires_at    timestamptz,
  job_kind      text,
  job_arg       text,
  audit_events  jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select id, domain, action_type, title, risk_level, status, source_intent,
         spec_id, created_at, updated_at, expires_at,
         payload->'proposedPayload'->>'jobKind' as job_kind,
         payload->'proposedPayload'->>'jobArg'  as job_arg,
         -- The append-only audit trail; empty array (never null) when a row carries none.
         coalesce(payload->'auditEvents', '[]'::jsonb) as audit_events
  from public.cockpit_proposals
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.get_cockpit_proposals(int) from public;
grant execute on function public.get_cockpit_proposals(int) to anon, authenticated;

notify pgrst, 'reload schema';
