-- 20260612130000_cockpit_proposals_job_kind.sql
--
-- Live Operations fix: the hosted cockpit projects agent_job proposals into "tasks in flight",
-- but get_cockpit_proposals did not return the job kind (it lives inside the payload jsonb the
-- RPC intentionally does not expose wholesale). Add ONE derived column — job_kind — so the
-- tasks view can label work honestly (researching / building / sweeping) without shipping the
-- full payload to the read-only surface. Return-type change ⇒ drop + recreate (+ re-grant).

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
  job_kind      text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, domain, action_type, title, risk_level, status, source_intent,
         spec_id, created_at, updated_at, expires_at,
         payload->'proposedPayload'->>'jobKind' as job_kind
  from public.cockpit_proposals
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;
revoke all on function public.get_cockpit_proposals(int) from public;
grant execute on function public.get_cockpit_proposals(int) to anon, authenticated;

notify pgrst, 'reload schema';
