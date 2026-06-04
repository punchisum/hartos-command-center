# State Machine: Report Approval Workflow

A report is generated, previewed to the user, and applied to an external system only after explicit human approval via a callback token.

---

## States

| State | Owner | Description |
|-------|-------|-------------|
| `pending` | Trigger | Report row created; analysis not yet started |
| `analysis_running` | Trigger | LLM is processing the input |
| `analysis_ready` | Trigger | Analysis complete; report row updated |
| `preview_sent` | Trigger | Preview message delivered to user |
| `buttons_sent` | Trigger | Inline keyboard with approve/reject buttons delivered |
| `token_issued` | Trigger | Short approval token row created in `action_tokens` |
| `awaiting_user` | Cloudflare | Waiting for user to click a button |
| `user_selected` | Cloudflare | Callback received; token validated |
| `mutation_running` | Trigger | Approved action executing on external system |
| `applied` | Trigger | External mutation confirmed successful |
| `token_consumed` | Trigger | `action_tokens.consumed_at` set after success |
| `proof_stored` | Trigger | Audit row and debug_event written |
| `rejected` | Cloudflare | User clicked reject; no mutation executed |
| `expired` | Cron | Token expired without user action |
| `error` | Trigger | Unrecoverable failure; debug_event written |

---

## Transitions

```
pending
  → [Trigger starts analysis] → analysis_running
  → [LLM returns result] → analysis_ready
  → [Preview sent to chat] → preview_sent
  → [Buttons delivered] → buttons_sent
  → [Token row created] → token_issued → awaiting_user

awaiting_user
  → [User clicks approve] → user_selected (Cloudflare validates token)
  → [User clicks reject] → rejected
  → [expires_at exceeded] → expired

user_selected
  → [Trigger enqueued] → mutation_running
  → [External system confirms] → applied
  → [consumed_at set] → token_consumed
  → [Audit + debug_event] → proof_stored

mutation_running
  → [External system error] → error (debug_event, no token_consumed)
```

---

## Final State Proof

A report approval workflow is **done** only when ALL of the following are true:

- [ ] `reports.status = 'applied'` in Supabase
- [ ] `action_tokens.consumed_at` is set (not null)
- [ ] External system (e.g. ClickUp) shows the mutation applied
- [ ] `debug_events` row with `outcome=ok` and correct `trace_id`
- [ ] Audit row in `{{AUDIT_TABLE}}` with action and actor
- [ ] User received final confirmation message in Telegram

**"Trigger job completed" is NOT final state proof.**

---

## Failure Modes

| Failure | State | Recovery |
|---------|-------|----------|
| LLM timeout | `error` | Re-trigger analysis job |
| Preview not delivered | `analysis_ready` | Retry delivery; do not re-run LLM |
| Token expired before use | `expired` | Re-issue token; do not re-run analysis |
| External mutation failed | `error` | Re-attempt mutation with same token (if not consumed) |
| Token consumed before mutation confirmed | BUG | Never set consumed_at before action succeeds |

---

## SQL

```sql
-- Reports table (minimal)
create table if not exists public.reports (
  id              uuid        primary key default gen_random_uuid(),
  status          text        not null    default 'pending'
                    check (status in (
                      'pending', 'analysis_running', 'analysis_ready',
                      'preview_sent', 'buttons_sent', 'token_issued',
                      'awaiting_user', 'user_selected', 'mutation_running',
                      'applied', 'rejected', 'expired', 'error'
                    )),
  idempotency_key text        unique,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```
