-- Rinnegan context pack — the Worker-readable mirror of the Obsidian vault's meaning notes.
--
-- The deployed Worker has no filesystem, so it can't read the local vault. Node (Rinnegan) mirrors
-- the vault's note metadata + a body excerpt into this table; the Worker reads it via the anon RPC
-- and runs the PURE Rinnegan compiler in-request (notes + live facts) to brief the LLM Ask.
--
-- Same doctrine as the proposal/memory spines (fitness project xbuinrnpfjltimofwrdx):
--   Node WRITES (elevated DB role, RLS bypass); Worker READS via the security-definer RPC only.
-- Body excerpts are MEANING (not raw facts/secrets). Idempotent: safe to re-run.

create table if not exists public.cockpit_context_pack (
  rel_path     text primary key,              -- vault-relative note path (stable id)
  title        text not null,
  tags         text[] not null default '{}',
  folder       text,
  body_excerpt text not null,                 -- first ~4k chars (meaning), for relevance + snippet
  review_by    timestamptz,
  age_days     int,
  synced_at    timestamptz not null default now()
);

create index if not exists cockpit_context_pack_synced_idx
  on public.cockpit_context_pack (synced_at desc);

alter table public.cockpit_context_pack enable row level security;
revoke all on public.cockpit_context_pack from anon, authenticated;

create or replace function public.get_cockpit_context_pack(p_limit int default 400)
returns table (
  rel_path     text,
  title        text,
  tags         text[],
  folder       text,
  body_excerpt text,
  review_by    timestamptz,
  age_days     int
)
language sql
stable
security definer
set search_path = public
as $$
  select rel_path, title, tags, folder, body_excerpt, review_by, age_days
  from public.cockpit_context_pack
  order by synced_at desc
  limit greatest(1, least(coalesce(p_limit, 400), 1000))
$$;

revoke all on function public.get_cockpit_context_pack(int) from public;
grant execute on function public.get_cockpit_context_pack(int) to anon, authenticated;

notify pgrst, 'reload schema';
