# State Machine: Scheduled Briefing Workflow

A scheduled job fires, collects data, generates a briefing, identifies targets, delivers messages, and logs the run.

---

## States

| State | Owner | Description |
|-------|-------|-------------|
| `trigger_fired` | Trigger | Cron job started |
| `data_fetching` | Trigger | Querying Supabase and/or external sources |
| `data_ready` | Trigger | Source data in memory |
| `brief_generating` | Trigger | LLM generating briefing content |
| `brief_ready` | Trigger | Briefing text committed to Supabase |
| `targets_identified` | Trigger | List of recipient chats/users determined |
| `delivery_running` | Trigger | Sending messages to each target |
| `delivery_partial` | Trigger | Some messages sent, some failed |
| `delivery_complete` | Trigger | All messages delivered |
| `run_logged` | Trigger | `briefing_runs` row written with outcome |
| `skipped` | Trigger | No relevant data; briefing not sent |
| `error` | Trigger | Job failed before any delivery |

---

## Transitions

```
trigger_fired → data_fetching
  → [no data / nothing new] → skipped → run_logged (outcome=skipped)
  → [data available] → data_ready

data_ready → brief_generating
  → [LLM result] → brief_ready

brief_ready → targets_identified
  → [no targets] → skipped → run_logged
  → [targets found] → delivery_running

delivery_running
  → [all delivered] → delivery_complete → run_logged (outcome=ok)
  → [some failed] → delivery_partial → run_logged (outcome=partial)
  → [all failed] → error → run_logged (outcome=error)
```

---

## Final State Proof

A scheduled briefing is **done** only when ALL of the following are true:

- [ ] `briefing_runs` row written with `outcome` = `ok` | `partial` | `skipped` | `error`
- [ ] `briefing_runs.targets_count` and `delivered_count` are accurate
- [ ] `briefing_content` committed to Supabase before delivery begins
- [ ] Every target either received the message or has a failure record
- [ ] No target silently missed: delivery failures explicitly recorded
- [ ] `debug_events` row for the run with `trace_id`
- [ ] Next scheduled run cursor/timestamp updated to avoid re-sending

---

## Tables

```sql
create table if not exists public.briefing_runs (
  id               uuid        primary key default gen_random_uuid(),
  feed_key         text        not null,
  outcome          text        not null
                     check (outcome in ('ok', 'partial', 'skipped', 'error')),
  targets_count    integer     not null default 0,
  delivered_count  integer     not null default 0,
  failed_count     integer     not null default 0,
  brief_content    text,
  error_message    text,
  scheduled_for    timestamptz not null,
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.briefing_delivery_log (
  id              uuid        primary key default gen_random_uuid(),
  run_id          uuid        references public.briefing_runs(id),
  telegram_chat_id text       not null,   -- text, never uuid
  delivered       boolean     not null default false,
  failure_reason  text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);
```

---

## Idempotency

Briefing idempotency key: `feed_key:scheduled_for_iso_date`

If a cron job fires twice for the same window (e.g. Trigger retry):
- Check if `briefing_runs` row with this key already has `outcome=ok`
- If yes: skip delivery, log `skipped` with reason `already_delivered`
- Do NOT re-deliver to recipients

---

## Failure Modes

| Failure | State | Recovery |
|---------|-------|----------|
| LLM timeout | `error` | Retry job; idempotency prevents double briefing |
| One recipient unreachable | `delivery_partial` | Log failed; re-deliver on next run |
| All delivery fails | `error` | Alert via debug channel; manual re-trigger |
| No new data | `skipped` | Normal; run_logged with outcome=skipped |
| Cron fires twice | `skipped` (second) | Idempotency key prevents double delivery |
