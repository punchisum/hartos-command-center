create extension if not exists pgcrypto;

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  route text not null,
  status text not null,
  input_json jsonb not null default '{}',
  result_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists command_events (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  route text not null,
  status text not null,
  input_json jsonb not null default '{}',
  result_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
