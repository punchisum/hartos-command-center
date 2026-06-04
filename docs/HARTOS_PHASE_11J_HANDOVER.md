# HartOS Phase 11J Handover — Cloudflare Hosted Read-Only Cockpit + Factory Deploy Bridge

## What shipped

- **Cloudflare-compatible cockpit runtime** under `src/runtime/`:
  `cloudflare-cockpit-worker.ts` (thin adapter + default `fetch` export),
  `cloudflare-cockpit-types.ts`, `cloudflare-env.ts`, `cloudflare-response.ts`,
  `cloudflare-security.ts`, `cloudflare-deploy-bridge.ts`.
- **Routes:** `GET /`, `/health`, `/api/state`, `/api/reports`, `/api/threads`,
  `/api/debug/status`, `POST /api/orchestrator/message`.
- **Factory deployment bridge** reusing `checkAutoProvisionGate` + cockpit gates.
- **Commands:** `cockpit:cloudflare:check`, `:dry-run`, `:deploy-plan`, `:deploy`.
- **Config:** `.dev.vars.example` (no secrets); existing `wrangler.toml.example`.
- **Reports:** `cloudflare-cockpit-reports/` (gitignored).
- **Docs:** hosted cockpit, security, Cloudflare Access setup, deployment bridge.

## Doctrine (unchanged boundaries)

- Hosted cockpit is read-only; no action execution exists in this phase.
- Cloudflare Access is recommended before production exposure (no homemade auth).
- No secrets are exposed to the frontend; all provider keys stay server-side.
- Local cockpit remains available and unchanged.
- Deployment uses Factory gates/patterns, not a separate path.
- Real deploy is gated and blocked by default (`blocked_missing_gate`).
- No Supabase/ClickUp/Google Drive/Apple Health/Telegram mutation; no Telegram.

## Works locally (no internet)

`cockpit:cloudflare:check`, `:dry-run` (mocked requests), `:deploy-plan`, and a
gated `:deploy` all run offline. The local cockpit and all Phase 11F–11I
commands are unchanged.

## Ready for Cloudflare

The Worker handler is Cloudflare-compatible (Web `Request`/`Response`, no fs at
request time). A snapshot is baked at deploy time. Gates + Cloudflare Access
checklist are produced in the deploy plan.

## Still requires manual Cloudflare setup

Real deploy: set the three gates true, ensure `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` are present, bake a snapshot, run `wrangler deploy`, and
configure Cloudflare Access. The deploy script emits these steps but never runs
them.

## Not implemented by design

Live action execution, full production deploy by default, Supabase writes,
ClickUp/Drive/Apple Health/Telegram mutation, custom auth.

## Suggested Phase 11K

Snapshot-baking build step for the Worker; optional KV-backed live read-only
state; Cloudflare Access policy-as-code in the deploy plan.
