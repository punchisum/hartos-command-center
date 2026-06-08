-- Phase 2.3 — append-only audit log for cockpit proposal transitions.
--
-- Each approve/reject (and, later, execution) writes ONE immutable row. The Edge
-- Function (service_role) only ever INSERTs; nothing updates or deletes. Lives
-- alongside cockpit_proposals in the "Hart Personal Core" project (xbuinrnpfjltimofwrdx).
-- Doctrine §audit-trail: every state transition is recorded who/what/when.

create table if not exists public.cockpit_proposal_audit (
  id bigint generated always as identity primary key,
  proposal_id text not null,
  event text not null,
  to_status text,
  at timestamptz not null default now()
);

create index if not exists cockpit_proposal_audit_proposal_id_idx
  on public.cockpit_proposal_audit (proposal_id, at desc);

alter table public.cockpit_proposal_audit enable row level security;

-- Append-only: service_role may INSERT + SELECT only. UPDATE/DELETE are deliberately
-- NOT granted, so the audit trail cannot be rewritten through PostgREST.
grant select, insert on public.cockpit_proposal_audit to service_role;

comment on table public.cockpit_proposal_audit is
  'Phase 2.3: append-only audit of cockpit proposal transitions (approve/reject/...). Insert-only by design.';
