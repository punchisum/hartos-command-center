# Read Model Integration (Phase 11I)

A reusable, read-only architecture for surfacing real structured data in the
cockpit. This phase wires only safe, explicitly configured sources.

## Config-first

Copy `read-models.example.json` to `read-models.local.json` (gitignored). Read
models are **disabled by default**:

```json
{
  "readModels": [
    { "id": "ops_supabase_read", "type": "ops", "enabled": false,
      "mode": "supabase_readonly",
      "supabaseUrlEnv": "HARTOS_OPS_SUPABASE_URL",
      "supabaseKeyEnv": "HARTOS_OPS_SUPABASE_READONLY_KEY",
      "allowedTables": ["projects", "clickup_cards", "card_updates", "agent_logs", "sync_runs"],
      "allowedRpcs": [],
      "forbiddenOperations": ["insert", "update", "delete", "upsert", "rpc_mutation"] }
  ]
}
```

## Rules

- `read-models.local.json` is **gitignored**; `read-models.example.json` has no
  secrets (only env var **names**).
- A read happens **only** when `enabled=true` **and** the referenced env vars
  resolve. Otherwise the summary is `disabled`/`missing`.
- **Read models are read-only.** See
  [SUPABASE_READ_ONLY_BOUNDARY.md](SUPABASE_READ_ONLY_BOUNDARY.md).

## Output

`npm run read-models:status` writes a report under `read-model-reports/` listing
configured/enabled read models, missing env (names only), allowed tables/RPCs,
forbidden operations, and data freshness when available.
