# Runtime Ownership Map

Every capability in the agent belongs to exactly one runtime.
Violating ownership boundaries causes split state, race conditions, and un-debuggable failures.

---

## Ownership Table

| Layer | Runtime | Owns | Must NOT do |
|-------|---------|------|-------------|
| **Interface** | Telegram / Web / Mobile / Dashboard | Deliver messages, receive input, render buttons | Store state, run intelligence, execute mutations |
| **Gateway** | Cloudflare Worker | Auth, input normalization, dedup, session staging, fast reply, callback intake, enqueue Trigger task | Run LLM, run long workflows, heavy document processing, risky external mutations (unless explicitly safe) |
| **Workflow / Intelligence** | Trigger.dev | LLM calls, document analysis, digest/proposal generation, scheduled jobs, external sync, retries, file processing, approved mutation execution | Accept raw webhook without auth, store canonical state outside Supabase |
| **Source of Truth** | Supabase | Canonical state, sessions, reports, proposals, tokens, audit logs, debug events, failed syncs, sync runs, digest cursors | Be used as a queue or temporary cache |
| **Auxiliary Dashboards** | ClickUp / Notion / Sheets / Airtable / Linear | Human visibility, manual task management | Be the source of truth, be written to without approval |

---

## Cloudflare Worker Responsibilities

```
Incoming request
  → verify auth (token / webhook secret)
  → normalize input (Telegram update → internal event)
  → dedup (idempotency key check in Supabase)
  → stage lightweight session row
  → send fast acknowledgement (200 OK / "Working on it...")
  → enqueue Trigger.dev task
  → intake callback_data tokens (resolve short tok → action)
```

**Cloudflare must never:**
- Call OpenAI or run LLM inference
- Run long document processing
- Execute ClickUp mutations without approval
- Perform retries with business logic
- Store canonical outcome state (that belongs in Supabase)

---

## Trigger.dev Responsibilities

```
Receive task payload from Cloudflare
  → validate payload
  → run LLM / document analysis
  → generate digest / proposal / report
  → write results to Supabase (source of truth)
  → issue approval tokens if mutation required
  → deliver preview to Telegram (via Cloudflare or direct)
  → on approval: execute approved mutation
  → write audit/debug event to Supabase
  → emit debug notification (throttled)
```

**Trigger must never:**
- Execute a risky mutation without an explicit approval token
- Silently swallow errors (every failure must produce a debug_event)
- Use LLM-generated text as an idempotency key

---

## Supabase Responsibilities

```
Canonical state store
  sessions           → active user sessions, staging
  reports            → generated reports
  proposals          → digest proposals, approval state
  action_tokens      → approval/callback tokens
  debug_events       → observability per workflow run
  failed_syncs       → external sync failures for repair
  sync_runs          → audit of every sync execution
  digest_cursors     → last-processed position per feed
```

**Supabase must:**
- Be the single source of truth for every durable state transition
- Have CHECK constraints that match TypeScript unions exactly
- Use uuid for internal IDs, text for external provider IDs

---

## External Auxiliary Tools (ClickUp, Notion, Sheets, etc.)

These are human dashboards only.

- Written to only after Supabase state is committed
- Never queried as source of truth for business logic
- All mutations require approval unless explicitly marked safe
- Failures in auxiliary writes must not fail the main workflow (log and continue)

---

## Decision Rules

When adding a new capability, answer these questions:

1. **Does it store durable state?** → Supabase
2. **Does it run LLM or take longer than 2s?** → Trigger.dev
3. **Does it receive user input or deliver output?** → Cloudflare (intake) + interface layer (delivery)
4. **Does it mutate an external system?** → Trigger.dev + approval token required
5. **Does a human need to see it?** → auxiliary dashboard (after Supabase write)
