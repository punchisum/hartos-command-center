-- T3 — the closed learning loop's store: did an executed proposal actually resolve its target?
--
-- Each pulse, for each recently-executed proposal, HartOS compares the subject the proposal
-- targeted against the subjects still present, and appends ONE observation row here: resolved
-- (gone), persisted (still there), or unknown (no subject). This is the EFFECT half memory never
-- had — efficacyByActionType (src/learning/outcome-scoring.ts) rolls it into a per-action-type
-- track record the proposer + the state report consult. Append-only time series (a fix can resolve
-- then regress; both observations matter). Lives in "Hart Personal Core" (xbuinrnpfjltimofwrdx).
--
-- NOT YET APPLIED. Applying it is a gated DB mutation (Hart's call). Until applied, the pulse's
-- OUTCOME step logs an honest "outcomes table not present" and writes nothing — never throws.

create table if not exists public.cockpit_decision_outcomes (
  id bigint generated always as identity primary key,
  proposal_id text not null,
  action_type text,
  subject text not null,
  outcome text not null,           -- resolved | persisted | unknown
  observed_at timestamptz not null default now()
);

create index if not exists cockpit_decision_outcomes_proposal_idx
  on public.cockpit_decision_outcomes (proposal_id, observed_at desc);
create index if not exists cockpit_decision_outcomes_action_idx
  on public.cockpit_decision_outcomes (action_type, outcome);

alter table public.cockpit_decision_outcomes enable row level security;

-- Append-only: the elevated Node host INSERTs + SELECTs only. UPDATE/DELETE are deliberately
-- NOT granted, so the learning record cannot be rewritten through PostgREST.
grant select, insert on public.cockpit_decision_outcomes to service_role;

comment on table public.cockpit_decision_outcomes is
  'T3 learning loop: append-only observations of whether an executed proposal resolved its target subject. Insert-only by design.';
