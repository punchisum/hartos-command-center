# Cloudflare Hosted Cockpit (Phase 11J)

The cockpit can be served from a Cloudflare Worker as a **read-only** surface,
in addition to the local cockpit. The hosted runtime is a thin adapter over the
existing cockpit logic — it does not fork the cockpit.

```
Cloudflare Request
   ↓
cloudflare-cockpit-worker.ts  (thin adapter)
   ↓
existing cockpit render/validate logic + deterministic LLM
   ↓
safe Response (read-only)
```

## Key facts

- **Hosted cockpit is read-only.** No action execution exists in this phase; all
  action buttons render disabled.
- **Local cockpit remains** available unchanged (`npm run cockpit:web`,
  `cockpit:snapshot`, `cockpit:ask`).
- **No secrets are exposed to the frontend.** All provider keys stay server-side.
  Status endpoints report env PRESENCE only, never values.
- **Deployment uses Factory gates/patterns, not a separate path.** See
  [CLOUDFLARE_FACTORY_DEPLOYMENT_BRIDGE.md](CLOUDFLARE_FACTORY_DEPLOYMENT_BRIDGE.md).
- **Real deploy is gated and blocked by default.**
- **Cloudflare Access is recommended before production exposure.** See
  [CLOUDFLARE_ACCESS_SETUP.md](CLOUDFLARE_ACCESS_SETUP.md).

## Routes

```
GET  /                          cockpit HTML (from a baked snapshot)
GET  /health                    { ok: true }
GET  /api/state                 read-only cockpit state
GET  /api/reports               read-only report list
GET  /api/threads               read-only thread list
GET  /api/debug/status          safe, redacted metadata (presence only)
POST /api/orchestrator/message  validated; deterministic, read-only classification
```

## Snapshot model

Cloudflare Workers have no filesystem. The state/HTML the Worker serves is a
**snapshot** built in Node (via the existing `buildCockpitState` /
`renderCockpitHtml`) and baked in at deploy time. The Worker never reads the
filesystem at request time and never mutates anything.

## Commands

```
npm run cockpit:cloudflare:check       # validate runtime/config/env + gates (no deploy)
npm run cockpit:cloudflare:dry-run     # mocked requests against the Worker handler
npm run cockpit:cloudflare:deploy-plan # write a deploy plan report (no mutation)
npm run cockpit:cloudflare:deploy      # GATED; blocked_missing_gate by default
```

Reports are written under `cloudflare-cockpit-reports/` (gitignored). No secrets.
