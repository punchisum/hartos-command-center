# Phase 18F — Hosted Live Read-Only Cockpit

Serves the Phase 18E control surface from the existing Cloudflare cockpit Worker,
with live data fetched from read-only adapters. It reuses the 18E
assembler/rules/summarizer/render unchanged: deterministic facts, verdict,
confidence, and severity are computed **server-side**; the LLM (default
deterministic) may only summarize / select / explain.

## Routes added

| Method | Path | Auth | Live | Response |
|---|---|---|---|---|
| GET | `/control` | required | yes | The 18E control-surface HTML (with in-place live refresh) |
| GET | `/api/control-surface` | required | yes | Sanitized read-only JSON (cards, attention, system verdict, builder) |

Both are added to `SUPPORTED_ROUTES`, gated behind the same fail-closed auth as
`/`, and resolved at most once per request **after** auth via
`controlSurfaceProvider`. `/health`, login, and unauthenticated requests never
trigger a live read.

## Live data sources

| Source | How | Hosted state |
|---|---|---|
| Fitness | read-only Supabase RPC (allowlisted), via `buildHostedReadModelRegistry` | live when env present, else UNKNOWN |
| Ops | read-only Supabase RPC (allowlisted) | live when env present, else UNKNOWN |
| Factory / build | local reports only | honest UNKNOWN (local-only) |
| Runtime provision | local reports only | honest UNKNOWN (local-only) |
| Proposal queue | local store only | counts 0 (local-only) |
| Provider statuses | derived from read-model availability (read-only) | g / unknown |

Tax and Factory render as honest UNKNOWN cards ("local-only — not served in
hosted read-only mode") rather than being hidden. If no read-model env is
configured at all, every domain is UNKNOWN and `systemVerdict = UNKNOWN`.

## Freshness model (unchanged from 18E)

`< 6h` fresh · `6–72h` stale · `> 72h` or failed-check dead · `null` unknown.

## Hard boundaries (enforced)

- No browser-side secrets; no service-role key to client JS. Keys are sent only
  as server-side request headers; the JSON payload passes `assertNoSecrets`
  before it leaves the Worker.
- No provider mutation from browser/Worker. Every action is copy-CLI / open /
  approve. The browser refresh script issues **GET only** — no POST/PUT/DELETE,
  no execute path.
- No Telegram webhook mutation, no Cloudflare secret upload, no Trigger deploy,
  no proposal execution, no production destructive changes, no Fitness/Ops
  runtime mutation.
- Live adapter failure degrades to UNKNOWN — never a crash, never a fabricated
  value.
- The request path never touches the filesystem (the 18E disk loader is not
  imported here); `node:fs` remains in the import graph only as the existing
  16D pattern (nodejs_compat), never called on the hosted path.

## Local dev / smoke

```
npm run cockpit:live          # local server on :8788 — open /control
npm run cockpit:live:smoke    # run probes through the handler, no server
npm run cockpit:control       # static local 18E preview (no fetch)
```

`cockpit:live` runs the real Worker handler locally with auth bypassed (dev
only) and a control-surface provider backed by live read-models when configured,
falling back to the local disk surface otherwise.

## Deployment plan (Cloudflare Worker — same Worker as 16D)

This phase adds routes to the existing `cloudflare-cockpit-worker.ts`; there is
no new deploy target.

1. **Bundle check (no deploy):**
   ```
   cp wrangler.cockpit.toml.example wrangler.cockpit.toml   # gitignored
   npm run cockpit:cloudflare:bundle-check                  # wrangler deploy --dry-run
   ```
   Confirmed bundling: ~310 KiB (75 KiB gzip), `compatibility_flags = ["nodejs_compat"]`.

2. **Credentials (set as Worker secrets only — never sent to the browser):**
   - `HARTOS_COCKPIT_ACCESS_TOKEN` — fail-closed access (required in production)
   - `HARTOS_OPS_SUPABASE_READONLY_KEY` — read-only **anon** key only
   - `HARTOS_FITNESS_SUPABASE_READONLY_KEY` — read-only **anon** key only

   Non-secret vars: `HARTOS_OPS_SUPABASE_URL`, `HARTOS_FITNESS_SUPABASE_URL`,
   `HARTOS_FITNESS_USER_ID`, `HARTOS_FITNESS_AGENT_ID`, `APP_ENV`.

   Use **read-only anon keys**. The `SupabaseReadClient` refuses service-role
   keys (`isServiceRoleKey`). If a service-role key were ever required, it would
   be stored only as a Worker secret and never sent to the browser — but this
   surface does not need one.

3. **Deploy** (only after explicit approval):
   ```
   wrangler secret put HARTOS_COCKPIT_ACCESS_TOKEN --config wrangler.cockpit.toml
   wrangler secret put HARTOS_OPS_SUPABASE_READONLY_KEY --config wrangler.cockpit.toml
   wrangler secret put HARTOS_FITNESS_SUPABASE_READONLY_KEY --config wrangler.cockpit.toml
   wrangler deploy --config wrangler.cockpit.toml
   ```

   No production mutation occurs: the Worker only reads. **Stop before live
   deployment unless explicitly approved.**
