# Phase 16D — Hosted Live Read-Model Runtime

The hosted Cloudflare cockpit now resolves **live** Fitness + Ops read-model data
at Worker request time, instead of serving an empty/baked snapshot. It does so
fs-free, server-side, with read-only anon keys, and with graceful per-domain
degradation.

## What changed

- **`src/runtime/cloudflare-live-read-models.ts`** (new) — builds the read-model
  registry in memory from Worker env (no filesystem), runs the existing
  read-only `buildReadModelRegistrySummary`, derives Fitness/Ops/Factory sources
  via the pure derivers, builds domain panels + source diagnostics, and assembles
  a `CockpitState` with `mode: "hosted"`.
- **`src/runtime/cloudflare-cockpit-worker.ts`** — the default export now passes a
  `liveStateProvider`. `handleCockpitRequest` resolves it **lazily, at most once
  per request, AFTER the auth gate, and only for data routes** (`/`, `/api/state`,
  `/api/freshness`, `/api/read-models/status`, `/api/proposals`, `/api/ask`). So
  `/health`, `/api/login`, OPTIONS, and unauthenticated requests never trigger a
  Supabase read.
- **`read-model-report.ts` / `source-diagnostics.ts`** — added an optional
  injectable `registry`. When provided (hosted Worker), neither `loadReadModelRegistry`
  nor `process.cwd()` is touched. The local cockpit path is unchanged.
- **`cockpit-types.ts`** — `CockpitMode` gains `"hosted"`.
- Config/env docs corrected (`read-models.hosted.example.json`, `.dev.vars.example`,
  `wrangler.cockpit.toml.example`) — real RPC names + Fitness user/agent id vars.

## Data flow (hosted request)

```
fetch → auth gate (fail-closed) → [data route?] → liveStateProvider()
  → buildHostedReadModelRegistry()                 (in-memory, no fs)
  → buildReadModelRegistrySummary({env, registry, clientFactory})
       → defaultClientFactory refuses service_role keys; uses global fetch
       → get_ops_* / get_fitness_* read-only RPCs (allowlisted)
  → deriveFitness/Ops/FactorySource (pure)
  → buildSourceDiagnostics + buildDomainPanels
  → CockpitState (mode: "hosted")
  → views render freshness / brief / panels / ask
```

## Required Worker env

| Var | Kind | Notes |
|---|---|---|
| `HARTOS_OPS_SUPABASE_URL` | var | non-secret endpoint |
| `HARTOS_OPS_SUPABASE_READONLY_KEY` | **secret** | read-only ANON key only |
| `HARTOS_FITNESS_SUPABASE_URL` | var | non-secret endpoint |
| `HARTOS_FITNESS_SUPABASE_READONLY_KEY` | **secret** | read-only ANON key only |
| `HARTOS_FITNESS_USER_ID` | var | uuid; Fitness RPCs are `(user_id, agent_id)`-scoped |
| `HARTOS_FITNESS_AGENT_ID` | var | uuid |

If a domain's env is absent the cockpit still renders; that panel shows
"unavailable + exact setup step". If **no** read-model env is present at all, the
provider returns null and the Worker serves the existing safe placeholder.

## Safety invariants (enforced + tested)

- Read-only by construction (`SupabaseReadClient` has no mutation methods/RPC).
- Service-role keys refused (`isServiceRoleKey`) → domain not live, no network.
- Keys sent only as server-side request headers; never in any HTML/JSON body.
- Only the deployed `get_*` RPCs are allowlisted; anything else is refused.
- No filesystem and no `process.cwd()` on the hosted path.

## Known follow-ups (NOT in 16D)

- **Worker bundling / `nodejs_compat`**: the read-model module graph still
  statically imports `node:fs`/`node:path` (never *called* on the hosted path) and
  `isServiceRoleKey` uses `Buffer`. Real deployment needs the `nodejs_compat`
  flag, or a follow-up to strip these from the hosted import graph. **Do not
  deploy until verified.**
- Optional short-TTL KV cache of last-good live results (fallback + latency).
- **Phase 16E**: backport this pattern into `hartos-agent-factory` templates.
