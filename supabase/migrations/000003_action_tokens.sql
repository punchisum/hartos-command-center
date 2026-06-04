create table if not exists action_tokens (
  id uuid primary key default gen_random_uuid(),
  tok text not null unique,
  action_code text not null,
  entity_type text not null,
  entity_id uuid,
  telegram_chat_id text not null,
  telegram_user_id text not null,
  payload jsonb not null default '{}',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint action_tokens_tok_short check (char_length(tok) <= 20)
);

create index if not exists action_tokens_expires_at_idx on action_tokens(expires_at);

comment on column action_tokens.tok is 'Short token for Telegram callback_data format tok:<token>; callback_data must stay under 64 bytes.';
comment on column action_tokens.consumed_at is 'Set only after the approved action succeeds.';
comment on column action_tokens.telegram_chat_id is 'External Telegram chat ID stored as text, never uuid.';
comment on column action_tokens.telegram_user_id is 'External Telegram user ID stored as text, never uuid.';
