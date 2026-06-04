# Supabase Read-Only Boundary (Phase 11I)

`src/read-models/supabase-read-client.ts` is a strict read-only client.

## What it can do

- `select(table, options)` — read rows from an **allowlisted** table (GET via
  PostgREST), with `limit` / `order` / simple equality `filter`.
- `readRpc(name, args)` — call an explicitly **allowlisted read-only** RPC (none
  by default).

## What it cannot do

- **The Supabase read client exposes no mutation methods.** There is no
  `insert`, `update`, `delete`, or `upsert` method, and no mutation RPC helper.
  Mutation is impossible through this client by construction.
- No service-role mutation, no schema changes, no migrations.

## Safety

- A table not in `allowedTables` is refused (`SupabaseReadError`).
- An RPC not in `allowedRpcs` is refused.
- The read-only key is sent only as an auth header; it is **never logged** (and
  never appears in error messages).
- A fetch implementation is injectable, so **tests use a mocked client only** —
  no real network call occurs.

`forbiddenOperations` (`insert`, `update`, `delete`, `upsert`, `rpc_mutation`)
is recorded in config and surfaced in reports as an explicit contract.
