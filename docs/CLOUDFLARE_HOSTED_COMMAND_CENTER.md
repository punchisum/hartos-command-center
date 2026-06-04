# Cloudflare Hosted Read-Only Command Center (Phase 16)

A Cloudflare Worker that serves the HartOS Command Center cockpit as a hosted,
**read-only** control surface, gated by a simple access token.

```
Browser ──▶ Cloudflare Worker ──▶ read-only read-models (Supabase RPC, anon keys) ──▶ Browser
```

Builds on the Phase 11J hosted scaffolding (`CLOUDFLARE_HOSTED_COCKPIT.md`,
`CLOUDFLARE_COCKPIT_SECURITY.md`) and folds in the freshness/sync surface
(Phase 15C) and a hosted Daily Command Brief.

## Hard boundaries

- Read-only. No real execution, no provider mutation, no ClickUp/Supabase/
  Telegram writes, no agent creation, no real import execution.
- Action buttons render **disabled**. `actionExecution` is always `"disabled"`.
- The browser never receives powerful credentials. Only **read-only anon keys**
  are used for Supabase, server-side in the Worker. **No service-role key** is
  used or exposed. (If a hosted read-model ever required a service-role key, the
  build stops and reports rather than shipping unsafe hosting.)
- No secrets are committed; no `.env.local`, `.dev.vars`, or `*.local.json`.
- The Worker **fails closed** when required auth/config is missing.

## Routes

| Route | Auth | Description |
|---|---|---|
| `GET /` | gated (login screen if unauth) | Hosted cockpit page |
| `GET /health` | public | Safe health check (`{ ok, actionExecution }`) |
| `POST /api/login` | public | Exchange access token for a secure session cookie |
| `GET /api/state` | gated | Read-only cockpit state JSON |
| `POST /api/ask` | gated | Ask HartOS — grounded deterministic answer (incl. Daily Command Brief) |
| `GET /api/freshness` | gated | Freshness / sync summary |
| `GET /api/read-models/status` | gated | Read-model status (presence/status only) |
| `GET /api/proposals` | gated | Compact read-only proposal queue view (or local-only notice) |
| `POST /api/orchestrator/message` | gated | Deterministic classification (Phase 11J) |
| `GET /api/reports`, `GET /api/threads` | gated | Read-only listings |
| `GET /api/debug/status` | gated | Env **presence** only — never values |

Unsupported methods → `405`. Unknown routes → `404`. Oversized bodies → `413`.
Secret-looking input → `400`.

## Auth (access-token gate)

A single shared token, `HARTOS_COCKPIT_ACCESS_TOKEN` (set as a Wrangler secret),
gates every protected route. Accepted as either:

- `Authorization: Bearer <token>` (API clients / scripts), or
- `Cookie: hartos_cockpit_session=<token>` (set by the login form;
  `HttpOnly; Secure; SameSite=Strict`).

Enforcement rules (fail-closed):

- Auth is **required** when `APP_ENV=production`, OR a token is configured, OR
  `HARTOS_COCKPIT_REQUIRE_AUTH=true`.
- **Production with no token fails closed** — every protected route returns
  `401` and the UI shows a LOCKED page.
- Unauthenticated API requests return `401`; the UI shows a login screen.
- Local dev bypass: `HARTOS_COCKPIT_DEV_AUTH_BYPASS=true` opens the cockpit
  **only when not in production** (ignored in prod).
- When auth is not required (no token, not production, no require flag) the
  cockpit is open — this is the default for local Node tests / dry-runs.

No OAuth, no user database, no auth framework.

## Daily Command Brief

Ask any of: *"What needs my attention today?"*, *"Daily command brief"*,
*"Command brief"*, *"What should I focus on today?"*. Returns:

- Overall verdict: **Green / Amber / Red** (worst of ops + freshness)
- Main action (single next step)
- Top attention items (grounded; never invented)
- Fitness summary, Ops summary, Factory/Proposal summary, Freshness summary
- Known gaps

If Ops is stale it says not to make important ops decisions until refresh; if
hosted Factory reports are unavailable it says so honestly. **Brief, status, and
freshness questions create zero proposals.**

## Freshness / sync visibility

`GET /api/freshness` and the Freshness section show per-domain freshness
(Fitness / Ops / Factory), the latest ClickUp sync/activity timestamp, the stale
reason, and the safe manual next step. Ask *"Is my data fresh?"*, *"What needs
refreshing?"*, *"Why is ops stale?"*, *"Show freshness status"*. The cockpit
**cannot execute a refresh** — it recommends the manual step only.

## Local development

```bash
npm run dev:cloudflare -- --dry-run     # mocked probes, no server/network
npm run smoke:hosted                    # full mocked smoke incl. auth fail-closed
npm run dev:cloudflare                   # prints the exact `wrangler dev` command
```

To run a real local Worker dev server:

1. `cp wrangler.cockpit.toml.example wrangler.cockpit.toml` (gitignored).
2. Put secrets in `.dev.vars` (gitignored):
   ```
   HARTOS_COCKPIT_ACCESS_TOKEN=<choose-a-strong-token>
   HARTOS_COCKPIT_DEV_AUTH_BYPASS=true        # optional, local only
   HARTOS_OPS_SUPABASE_READONLY_KEY=<anon read-only key>
   HARTOS_FITNESS_SUPABASE_READONLY_KEY=<anon read-only key>
   ```
3. `npm run build && npx wrangler dev --config wrangler.cockpit.toml`

## Deployment (requires explicit approval)

Deployment is gated by the Factory doctrine and is **blocked by default**.

```bash
npm run deploy:cloudflare      # gated; prints manual wrangler steps, never auto-deploys
```

Required gates + env (see `cloudflare-deploy-bridge.ts`):
`ALLOW_AUTO_PROVISION=true`, `CONFIRM_CLOUDFLARE_DEPLOY=true`,
`ALLOW_CLOUDFLARE_COCKPIT_DEPLOY=true`, plus `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` present. Set the access token + read-only keys as
secrets:

```bash
wrangler secret put HARTOS_COCKPIT_ACCESS_TOKEN --config wrangler.cockpit.toml
wrangler secret put HARTOS_OPS_SUPABASE_READONLY_KEY --config wrangler.cockpit.toml
wrangler secret put HARTOS_FITNESS_SUPABASE_READONLY_KEY --config wrangler.cockpit.toml
npx wrangler deploy --config wrangler.cockpit.toml
```

Then put the URL behind **Cloudflare Access** (`CLOUDFLARE_ACCESS_SETUP.md`)
before sharing it.

## Verification

```bash
npm run typecheck
npm test
npm run verify
npm run smoke:local
npm run smoke:hosted
npm run dev:cloudflare -- --dry-run
```

## Known gaps (hosted MVP)

- **Data is served from a baked snapshot.** The Worker handler renders a cockpit
  snapshot built in Node (where read-only keys + config resolve the read-models).
  Live request-time Supabase RPC calls from the Worker are a future enhancement;
  the security model (read-only anon keys, server-side only, no service-role) is
  already in place for it.
- **Factory** local reports are not available in hosted mode — the cockpit marks
  them as unavailable rather than faking freshness.
- The **proposal queue** is local-only for create/manage; the hosted cockpit
  shows a read-only snapshot view (or a local-only notice) and never executes.
