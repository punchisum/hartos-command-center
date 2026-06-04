# Cloudflare Factory Deployment Bridge (Phase 11J)

Phase 11J does **not** create a separate Cloudflare deployment path. It bridges
the hosted cockpit into the existing Factory deployment/provisioning gate
doctrine (Phase 6 gates, Phase 7B Cloudflare adapter, Phase 10 bootstrap).

`src/runtime/cloudflare-deploy-bridge.ts` reuses the Factory
`checkAutoProvisionGate` and layers the cockpit-specific confirmation gates.

## Gate doctrine

A real cockpit deploy is **gated** and **blocked by default**. All of these are
required:

| Gate / env | Required value |
| --- | --- |
| `ALLOW_AUTO_PROVISION` | `true` (reused Factory gate) |
| `CONFIRM_CLOUDFLARE_DEPLOY` | `true` |
| `ALLOW_CLOUDFLARE_COCKPIT_DEPLOY` | `true` |
| `CLOUDFLARE_API_TOKEN` | present (value never printed) |
| `CLOUDFLARE_ACCOUNT_ID` | present (value never printed) |

If anything is missing, `cockpit:cloudflare:deploy` reports
`blocked_missing_gate`, writes a report, and exits without deploying.

## Bridge stages (mirrors Factory readiness → plan → verify)

1. **check** — runtime files/config/env presence + gate status.
2. **dry-run** — mocked Worker requests confirm HTML/API responses.
3. **deploy-plan** — readiness, gate status, security + Cloudflare Access
   checklist, deploy/health/rollback steps.
4. **deploy** — gated safe stub. When all gates are open it emits the exact
   manual `wrangler` steps; it never invokes wrangler itself, so no deploy ever
   happens during tests/CI.

## What it is not

It does not enable action execution, does not mutate Supabase/providers, and does
not bypass the Factory. Deployment remains a deliberate, gated, human action.
