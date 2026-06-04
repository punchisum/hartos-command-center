# HartOS Phase 11H Handover — Local Visible Cockpit MVP

## What shipped

The first **visible** cockpit. A dependency-free local browser console under
`src/cockpit/`:

- `cockpit-types.ts` — message, response, card-view, state, validation types
- `cockpit-state.ts` — request validation (empty/oversized/secret) + id helpers
- `cockpit-read-model.ts` — builds render state from the 11G contract + reports
- `cockpit-renderer.ts` — self-contained HTML (inline CSS + vanilla JS), no React
- `cockpit-server.ts` — `node:http` local server + testable `routeRequest`
- `cockpit-orchestrator-bridge.ts` — routes Ask HartOS into `runOrchestrator`
- `cockpit-report.ts` — secret-safe snapshot + thread reports/writers
- `cockpit.ts` — entry point + snapshot builder

Scripts (compiled `dist/scripts/*.js` + `pre<script>` build hooks):
`cockpit:web`, `cockpit:snapshot`, `cockpit:ask`.

## Architecture

```text
Orchestrator         = brain (decides)
Command Center contract = nervous system (defines what exists / is safe)
Cockpit              = visible control surface (renders + routes locally)
```

## How to run (offline)

```bash
npm run cockpit:snapshot                          # static reports + HTML
npm run cockpit:ask -- --request="Build a tax specialist agent"
npm run cockpit:web                               # http://localhost:3000
npm run cockpit:web -- --once                     # smoke-safe start/close
npm run cockpit:web -- --dry-run                  # build without binding a port
```

## Routes

```text
GET  /                          GET /api/state    GET /api/reports
GET  /api/threads               POST /api/orchestrator/message
```

## Security boundaries

No provider/Supabase/pack mutation, no deploys, no network. All action buttons
disabled (no execution). Dangerous actions blocked; approval/manual actions
non-executable. Input validated; secret-looking input rejected. Reports
secret-safe. See [COCKPIT_SECURITY_BOUNDARIES.md](COCKPIT_SECURITY_BOUNDARIES.md).

## What is intentionally NOT implemented

- No hosted Cloudflare cockpit, no auth.
- No Supabase persistence (local files only).
- No Telegram / Obsidian / Cerebro integration.
- No Fitness/Ops agent integration.
- No action execution of any kind.

## Recommended next phase

**Phase 11I — Local action surface:** wire the read-only + local-report actions
(`view_report`, `generate_report`, `run_*`) to the existing npm commands behind
explicit confirmation, still with no provider/Supabase/pack mutation. Approval
and forbidden actions remain non-executable.
