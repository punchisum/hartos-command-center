create table if not exists debug_events (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  runtime text not null,
  route text not null,
  stage text not null,
  outcome text not null check (outcome in ('ok','error','degraded','skipped')),
  failure_code text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists debug_events_trace_id_idx on debug_events(trace_id);
create index if not exists debug_events_created_at_idx on debug_events(created_at);
