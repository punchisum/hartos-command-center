-- 20260612140000_execution_verification.sql
--
-- P3 (approve→execute hardening): record whether a gated mutation actually LANDED.
--
-- dispatchMutation now does an INDEPENDENT fresh re-read AFTER a write and judges whether the
-- change landed (fail-closed: an unverifiable write is 'unverified', never silently 'done'). The
-- host executor persists that verdict as ONE append-only `execution_verification` row on
-- cockpit_proposal_audit: to_status = 'landed' | 'unverified', with the human-readable reason in
-- the new `detail` column.
--
-- Purely additive: existing inserts (approve / reject / executed / autoheal_*) never set `detail`
-- and keep working unchanged. Append-only by design — service_role still holds INSERT + SELECT
-- only (granted in 20260608170000_cockpit_proposal_audit.sql); UPDATE/DELETE remain ungranted, so
-- the audit trail cannot be rewritten.

alter table public.cockpit_proposal_audit
  add column if not exists detail text;

-- Fast lookup of recent verification verdicts across proposals (truth layer / Mutation Center).
create index if not exists cockpit_proposal_audit_verification_idx
  on public.cockpit_proposal_audit (at desc)
  where event = 'execution_verification';

comment on column public.cockpit_proposal_audit.detail is
  'P3: free-text detail for an audit event (e.g. the execution_verification verdict reason). Nullable; older event kinds do not set it.';

notify pgrst, 'reload schema';
