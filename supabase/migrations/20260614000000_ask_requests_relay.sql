-- 20260614000000_ask_requests_relay.sql
--
-- P-B0 — Ask-relay table + security-definer read-by-id RPC + TTL hygiene query.
--
-- DESIGNED, NOT APPLIED — applying this migration is Hart's gate.
-- Target project: cockpit/fitness Supabase project (xbuinrnpfjltimofwrdx),
-- per the two-DB split (ask_requests belongs with cockpit_proposals, NOT GECAN OPS).
--
-- Implements Option B (async Supabase relay) from the design:
--   docs/superpowers/specs/2026-06-14-worker-claude-max-routing-design.md
--
-- Flow:
--   1. Worker POSTs redacted_request+context → relay-ask Edge Function → INSERT row (status=pending)
--   2. Daemon polls `status=pending`, runs buildHostGateway() (Claude-Max), writes answer+status=answered
--   3. Worker short-polls read-by-id RPC (~600ms cadence, ~10s budget) → sees answered → returns LlmResult
--   4. Timeout/error → Worker falls back to existing Gemini buildAskInfer (never hard-fails)
--
-- Security:
--   - REVOKE all from public/anon/authenticated on the table (service-role only for writes)
--   - The relay-ask Edge Function self-authenticates via HARTOS_ASK_WRITE_TOKEN (service-role key
--     is auto-injected server-side, same as persist-cockpit-proposal)
--   - The read-by-id RPC is SECURITY DEFINER, scoped to a single id — the Worker (anon key) can
--     poll its own row but can never enumerate or read other rows
--   - Secret-scan on both write paths (request insert + answer update)
--
-- Grant hardening mirrors the pattern from 2026060900000001_cockpit_spine_service_role_grants.sql.
-- notify pgrst at the end so PostgREST re-introspects the schema immediately.

-- ── Table ────────────────────────────────────────────────────────────────────

create table if not exists public.ask_requests (
  id            text        primary key,       -- worker-generated UUID / content id
  status        text        not null default 'pending'
                            check (status in ('pending', 'answered', 'expired')),
  redacted_request text     not null,          -- already redacted by the Worker (§16)
  context       jsonb,                         -- deep-redacted grounding context
  answer        jsonb,                         -- the validated LlmResult the daemon writes
  provider      text,                          -- 'claude-max' when answered by the daemon
  error         text,                          -- nullable; daemon-side failure reason
  created_at    timestamptz not null default now(),
  answered_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '2 minutes')
);

comment on table public.ask_requests is
  'P-B0: async Ask-relay request queue (Worker → daemon → Worker). '
  'Rows are short-lived (~2 min TTL). '
  'Design: docs/superpowers/specs/2026-06-14-worker-claude-max-routing-design.md';

comment on column public.ask_requests.redacted_request is
  'Already redacted by the Worker before writing (§16 doctrine). Never the raw request.';
comment on column public.ask_requests.context is
  'Deep-redacted grounding context (AskGrounding + intent + Rinnegan briefing) forwarded to daemon.';
comment on column public.ask_requests.answer is
  'The validated LlmResult (8-field LlmStructuredOutput + provider/mode/validation fields) the daemon writes.';
comment on column public.ask_requests.expires_at is
  'TTL: default now()+2min. The hygiene pass expires stragglers; stale rows are automatically cleaned.';

-- Index: daemon polls pending rows (status=pending, order by created_at asc for FIFO).
create index if not exists ask_requests_pending_idx
  on public.ask_requests (created_at asc)
  where status = 'pending';

-- Index: TTL hygiene pass (status=pending|answered, expires_at < now()).
create index if not exists ask_requests_expiry_idx
  on public.ask_requests (expires_at asc)
  where status in ('pending', 'answered');

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Fail-closed: no public/anon/authenticated access. All writes go through the
-- relay-ask Edge Function (service-role key, server-side). The Worker reads via
-- the security-definer RPC below, NOT direct table access.

alter table public.ask_requests enable row level security;

-- Revoke all from public, anon, and authenticated — service_role bypasses RLS by default.
revoke all on public.ask_requests from public;
revoke all on public.ask_requests from anon;
revoke all on public.ask_requests from authenticated;

-- ── Security-definer read-by-id RPC ──────────────────────────────────────────
-- The Worker polls this RPC with its read-only anon key to learn the status/answer
-- for ONE specific id it already knows. It cannot enumerate rows, read other ids, or
-- access any other table. SECURITY DEFINER = runs as the function owner (service_role),
-- bypassing RLS — but it is deliberately scoped to a single id via the WHERE clause.
-- Grant to anon so the Worker (anon key) can call it via /rest/v1/rpc/hartos_get_ask_request.

create or replace function public.hartos_get_ask_request(p_id text)
returns table (
  id            text,
  status        text,
  answer        jsonb,
  provider      text,
  error         text,
  answered_at   timestamptz,
  expires_at    timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id,
    r.status,
    r.answer,
    r.provider,
    r.error,
    r.answered_at,
    r.expires_at
  from public.ask_requests r
  where r.id = p_id
  limit 1;
$$;

comment on function public.hartos_get_ask_request(text) is
  'P-B0: Security-definer read-by-id RPC for the ask_requests relay table. '
  'Called by the Worker (anon key) to poll the status/answer for its own in-flight row. '
  'Scoped to a single id; cannot enumerate other rows. '
  'SECURITY DEFINER = runs as owner to bypass RLS, but WHERE id=p_id limits exposure.';

grant execute on function public.hartos_get_ask_request(text) to anon;
grant execute on function public.hartos_get_ask_request(text) to authenticated;

-- ── TTL hygiene RPC ──────────────────────────────────────────────────────────
-- The daemon's ask-relay pass calls this (or an equivalent direct query) to expire
-- stale pending/answered rows whose TTL has elapsed. Service-role-only. The daemon
-- holds the pg connection string (HARTOS_SUPABASE_DB_URL), not called from the Worker.
--
-- NOTE: The daemon can also run this directly via SQL on the pool connection. This
-- function is provided as a convenience RPC for future tooling.

create or replace function public.hartos_expire_ask_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  update public.ask_requests
    set status = 'expired'
  where status in ('pending', 'answered')
    and expires_at < now();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

comment on function public.hartos_expire_ask_requests() is
  'P-B0: TTL hygiene — marks stale pending/answered ask_requests rows as expired. '
  'Called by the daemon ask-relay pass. Service-role only (not granted to anon).';

-- Revoke from anon/authenticated — daemon uses the direct pg connection
revoke execute on function public.hartos_expire_ask_requests() from public;
revoke execute on function public.hartos_expire_ask_requests() from anon;
revoke execute on function public.hartos_expire_ask_requests() from authenticated;

-- ── Notify PostgREST ─────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
