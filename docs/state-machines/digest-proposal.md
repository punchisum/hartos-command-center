# State Machine: Digest / Proposal Workflow

Data is collected, a digest is generated, proposals are created, and changes are applied only after human selection.

---

## States

| State | Owner | Description |
|-------|-------|-------------|
| `data_collection` | Trigger | Fetching records from source (Supabase / external) |
| `digest_generated` | Trigger | LLM digest written; digest row updated |
| `proposals_created` | Trigger | Individual proposal rows created in Supabase |
| `preview_sent` | Trigger | Summary preview delivered to user |
| `cards_sent` | Trigger | Per-proposal cards with buttons delivered |
| `tokens_issued` | Trigger | Short tokens issued for each proposal card |
| `awaiting_selection` | Cloudflare | Waiting for user to select a card |
| `selection_received` | Cloudflare | User clicked a card; token validated |
| `applying` | Trigger | Executing approved proposal changes |
| `applied` | Trigger | Proposal applied; external system updated |
| `token_consumed` | Trigger | `action_tokens.consumed_at` set |
| `proof_stored` | Trigger | Audit row and debug_event written |
| `skipped` | Cloudflare | User dismissed proposal |
| `expired` | Cron | No selection before token expiry |
| `error` | Trigger | Failure during generation or application |

---

## Transitions

```
data_collection
  → [records fetched] → digest_generated
  → [proposals built] → proposals_created
  → [summary preview sent] → preview_sent
  → [cards rendered] → cards_sent
  → [tokens created] → tokens_issued → awaiting_selection

awaiting_selection
  → [user selects card] → selection_received
  → [user dismisses] → skipped
  → [token expires] → expired

selection_received
  → [Trigger enqueued] → applying
  → [external change applied] → applied
  → [consumed_at set] → token_consumed
  → [audit + debug_event] → proof_stored
```

---

## Final State Proof

A digest/proposal workflow is **done** only when ALL of the following are true:

- [ ] `proposals.status = 'applied'` (or `'skipped'`) for every card delivered
- [ ] `action_tokens.consumed_at` set for each applied token
- [ ] External system reflects all applied proposals
- [ ] Digest cursor updated to prevent re-processing the same records
- [ ] `debug_events` row with `outcome=ok` for the run
- [ ] User received final acknowledgement message

---

## Cursor / Idempotency

Digest jobs must maintain a cursor to avoid re-processing:

```sql
create table if not exists public.digest_cursors (
  id          uuid        primary key default gen_random_uuid(),
  feed_key    text        not null unique,
  last_processed_at timestamptz,
  last_processed_id uuid,
  updated_at  timestamptz not null default now()
);
```

Idempotency key for proposals: `digest_run_id:record_id:proposal_type`
(never use LLM-generated text)

---

## Failure Modes

| Failure | State | Recovery |
|---------|-------|----------|
| LLM times out during digest | `error` | Re-trigger; cursor not advanced |
| Card delivery fails | `proposals_created` | Retry delivery; do not re-run LLM |
| Some proposals applied, some fail | partial | Log failed proposals; re-trigger with cursor at last success |
| Duplicate proposal for same record | `error` | Idempotency key prevents duplicate rows |
