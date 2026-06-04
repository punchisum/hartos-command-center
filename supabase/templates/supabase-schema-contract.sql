-- Supabase Schema Contract Template
--
-- Rules (from Ops Agent v2 production lessons):
--   1. TypeScript union types MUST match Supabase CHECK constraints exactly.
--   2. Adding a status to TypeScript requires a migration to update the CHECK constraint FIRST.
--   3. NEVER add a new status to TypeScript without updating the DB constraint.
--   4. Run schema smoke tests (insert every valid status) before deploying.
--   5. No silent status drift — constraint failure surfaces as Postgres 23514.
--
-- Ops Agent v2 bug this prevents:
--   TypeScript added 'scanned_pdf_requires_ocr' but the CHECK constraint did not allow it.
--   Result: Postgres 23514 check_violation on every insert with that status.

-- ─── STEP 1: Define your TypeScript union ─────────────────────────────────────
-- Keep this comment block in the migration for traceability.
--
-- TypeScript:
--   type RecordStatus =
--     | 'pending'
--     | 'processing'
--     | 'done'
--     | 'failed'
--     | 'degraded';
--   // ⚠ Adding a new value here requires adding it to the CHECK constraint below.

-- ─── STEP 2: Create the table with matching CHECK constraint ──────────────────

create table if not exists public.example_records (
  id          uuid       primary key default gen_random_uuid(),
  status      text       not null    default 'pending'
                check (status in ('pending', 'processing', 'done', 'failed', 'degraded')),
  -- internal UUID columns only — external provider IDs go in metadata
  related_id  uuid,
  -- external provider IDs always stored as text
  external_ref  text,
  metadata    jsonb      not null    default '{}'::jsonb,
  created_at  timestamptz not null   default now(),
  updated_at  timestamptz not null   default now()
);

alter table public.example_records enable row level security;

-- ─── STEP 3: Schema smoke test ────────────────────────────────────────────────
-- Run this block in psql to verify all valid statuses are accepted.
-- This must pass before shipping.
--
-- begin;
-- insert into public.example_records (status) values ('pending');
-- insert into public.example_records (status) values ('processing');
-- insert into public.example_records (status) values ('done');
-- insert into public.example_records (status) values ('failed');
-- insert into public.example_records (status) values ('degraded');
-- rollback;

-- ─── STEP 4: Adding a new status (safe migration pattern) ────────────────────
-- When adding a new TypeScript status value:
--
-- 1. Add the migration to alter the CHECK constraint FIRST.
-- 2. Deploy the migration.
-- 3. Then add the new value to the TypeScript union.
-- 4. Run the smoke test again.
--
-- alter table public.example_records
--   drop constraint example_records_status_check;
-- alter table public.example_records
--   add constraint example_records_status_check
--     check (status in ('pending', 'processing', 'done', 'failed', 'degraded', 'new_status'));

-- ─── STEP 5: Bulk insert idempotency guard ────────────────────────────────────
-- For bulk inserts: use ON CONFLICT DO NOTHING with a unique idempotency key.
-- The idempotency_key column must be built from trusted fields only (never LLM text).
--
-- alter table public.example_records
--   add column if not exists idempotency_key text unique;
--
-- insert into public.example_records (status, idempotency_key, ...)
-- values ('pending', 'record_id:2024-01-15:batch_001', ...)
-- on conflict (idempotency_key) do nothing;

-- ─── STEP 6: debug_events table ───────────────────────────────────────────────
-- Required for all agents. See observability-debug.ts for the TypeScript emitter.

create table if not exists public.debug_events (
  id           uuid        primary key default gen_random_uuid(),
  trace_id     text        not null,
  runtime      text        not null
                 check (runtime in ('cloudflare', 'trigger')),
  route        text        not null,
  stage        text        not null,
  outcome      text        not null
                 check (outcome in ('ok', 'degraded', 'error')),
  failure_code text,
  metadata     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists debug_events_trace_id_idx
  on public.debug_events (trace_id);
create index if not exists debug_events_created_at_idx
  on public.debug_events (created_at desc);
