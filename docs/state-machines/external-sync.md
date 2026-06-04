# State Machine: External Sync Workflow

Records from an external system are fetched, diffed against Supabase state, staged as proposals, approved by a human, and applied. Failures are logged for repair.

---

## States

| State | Owner | Description |
|-------|-------|-------------|
| `sync_triggered` | Trigger | Sync job started (scheduled or manual) |
| `records_fetching` | Trigger | Fetching records from external system |
| `records_fetched` | Trigger | External records in memory |
| `diffing` | Trigger | Comparing external records against Supabase state |
| `mutations_staged` | Trigger | Changed records written to `sync_proposals` |
| `approval_pending` | Trigger | Approval message sent to user (if required) |
| `approved` | Cloudflare | User approved via callback token |
| `mutations_applying` | Trigger | Writing changes to Supabase and/or external system |
| `mutations_applied` | Trigger | All changes committed |
| `sync_logged` | Trigger | `sync_runs` row written; cursors updated |
| `failed_syncs_cleared` | Trigger | Previously failed records re-tried and cleared (if applicable) |
| `skipped` | Cloudflare | User rejected changes; no mutation |
| `partial_failure` | Trigger | Some records applied, some failed |
| `error` | Trigger | Sync failed before any mutations |

---

## Transitions

```
sync_triggered → records_fetching
  → [fetch fails] → error (sync_runs row with outcome=error)
  → [fetch succeeds] → records_fetched

records_fetched → diffing
  → [no changes] → sync_logged (outcome=ok, no mutations)
  → [changes detected] → mutations_staged

mutations_staged
  → [approval required] → approval_pending → approved (via callback) | skipped
  → [approval not required] → mutations_applying

mutations_applying
  → [all succeed] → mutations_applied → sync_logged → failed_syncs_cleared
  → [some fail] → partial_failure → sync_logged (record failures in failed_syncs table)
  → [all fail] → error → sync_logged
```

---

## Final State Proof

An external sync is **done** only when ALL of the following are true:

- [ ] `sync_runs` row written with `outcome` = `ok` | `partial` | `error`
- [ ] `sync_runs.records_fetched`, `records_changed`, `records_failed` counts are correct
- [ ] All staged mutations either applied or recorded in `failed_syncs`
- [ ] Supabase state reflects the external system (for applied records)
- [ ] Cursors in `sync_cursors` updated to mark last successful position
- [ ] User received sync summary if approval was required
- [ ] `debug_events` row for the sync run
- [ ] No silent failures: every failed record has a `failed_syncs` row

---

## Tables

```sql
-- Sync run audit
create table if not exists public.sync_runs (
  id                uuid        primary key default gen_random_uuid(),
  feed_key          text        not null,
  outcome           text        not null
                      check (outcome in ('ok', 'partial', 'error', 'skipped')),
  records_fetched   integer     not null default 0,
  records_changed   integer     not null default 0,
  records_failed    integer     not null default 0,
  error_message     text,
  started_at        timestamptz not null,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- Failed sync records for manual repair
create table if not exists public.failed_syncs (
  id              uuid        primary key default gen_random_uuid(),
  sync_run_id     uuid        references public.sync_runs(id),
  external_id     text        not null,   -- text, never uuid
  failure_reason  text        not null,
  payload         jsonb       not null default '{}'::jsonb,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
```

---

## Failure Modes

| Failure | State | Recovery |
|---------|-------|----------|
| External API rate limit | `error` | Retry with backoff; do not partial-apply |
| Supabase write fails | `partial_failure` | Record in `failed_syncs`; retry failed rows next run |
| Diff logic bug | `error` | Fix diff; replay sync from same cursor position |
| Approval token expires | `skipped` | Re-run sync; re-stage mutations; re-issue token |
| External ID in UUID column | BUG | `identifier-contract.ts` prevents this at write time |
