-- Approval Token / Callback Token Table
--
-- Rules (from Ops Agent v2 production lessons):
--   1. Telegram callback_data hard limit: 64 bytes.
--   2. NEVER embed long IDs, UUIDs, or full task IDs directly in callback_data.
--   3. Use short tokens (tok) — alphanumeric + _-, max 20 chars.
--   4. token.consumed_at is set ONLY after the action succeeds.
--   5. telegram_chat_id and telegram_user_id are TEXT — NEVER uuid.
--   6. entity_id (internal Supabase reference) is uuid or null — NEVER a provider string.
--   7. All external refs go in metadata JSONB.

create table if not exists public.action_tokens (
  id               uuid        primary key default gen_random_uuid(),
  -- Short token for callback_data. Must fit within: "tok:ACT:<tok>" <= 64 bytes.
  tok              text        not null unique,
  -- What action this token authorizes. Use a short enum code.
  action_code      text        not null,
  -- What entity this token applies to.
  entity_type      text,
  -- Internal Supabase UUID reference. NULL if target is unresolved.
  entity_id        uuid,
  -- Telegram external IDs stored as TEXT — they are not UUIDs.
  telegram_chat_id text        not null,
  telegram_user_id text        not null,
  -- Safe context: external refs, display info, action parameters.
  -- No secrets. No raw authorization values.
  metadata         jsonb       not null default '{}'::jsonb,
  expires_at       timestamptz not null,
  -- NULL until the action completes successfully.
  -- Set this AFTER the action succeeds, not before.
  consumed_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- tok must be short (<=20 chars) to fit safely in callback_data.
alter table public.action_tokens
  add constraint action_tokens_tok_max_length
    check (char_length(tok) <= 20);

-- tok must use only URL-safe characters.
alter table public.action_tokens
  add constraint action_tokens_tok_safe_chars
    check (tok ~ '^[A-Za-z0-9_-]+$');

-- action_code must be non-empty and short.
alter table public.action_tokens
  add constraint action_tokens_action_code_not_empty
    check (char_length(action_code) > 0 and char_length(action_code) <= 30);

alter table public.action_tokens enable row level security;

-- Fast lookup by short token (used when Telegram callback arrives).
create index if not exists action_tokens_tok_idx
  on public.action_tokens (tok);

-- Fast lookup for expiry cleanup.
create index if not exists action_tokens_expires_idx
  on public.action_tokens (expires_at)
  where consumed_at is null;

-- ─── USAGE PATTERN ────────────────────────────────────────────────────────────
-- 1. Generate tok server-side (never trust client-provided token values).
--    tok = nanoid(12) or similar short random string.
--
-- 2. Build callback_data:
--    callback_data = "tok:" + tok   (e.g. "tok:xK9mP2a3qR7b" = 16 bytes ✓)
--    Always verify: Buffer.byteLength(callback_data, 'utf8') <= 64
--
-- 3. On callback receipt (Cloudflare):
--    - Parse tok from callback_data
--    - Look up token in action_tokens
--    - Verify: not expired, not consumed, chat_id matches, user_id matches
--    - Enqueue Trigger task with token details
--
-- 4. On Trigger execution:
--    - Re-validate token (race condition guard)
--    - Execute the approved action
--    - On success: set consumed_at = now()
--    - Write audit row and debug_event

-- ─── CLEANUP JOB ──────────────────────────────────────────────────────────────
-- Run a scheduled Trigger job to clean up expired unconsumed tokens.
--
-- delete from public.action_tokens
-- where expires_at < now() - interval '7 days'
--   and consumed_at is null;
