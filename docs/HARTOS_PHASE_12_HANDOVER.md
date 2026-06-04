# HartOS Phase 12 Handover — Command Cockpit v0

## What shipped

Phase 12 turns the cockpit from a generic skeleton into Hart's command surface.

### 12A — Custom domain panels
- New contract: `src/cockpit/panels/panel-types.ts` (`DomainPanel`, `PanelField`,
  placeholder constants, `okField`/`unavailableField` helpers).
- Builders: `fitness-panel.ts`, `ops-panel.ts`, `factory-panel.ts`, aggregated by
  `panels/index.ts` (`gatherPanelInputs`, `buildDomainPanels`).
- Panels are built into `CockpitState.panels` by `cockpit-read-model.ts` from the
  existing read-only inputs (agent integration, read-models, reports, capability
  registry). They never fabricate data and always emit the exact next setup step.

### 12B — Command HartOS routing
- New router: `src/cockpit/cockpit-intent-router.ts` with intents
  `system_status | fitness_status | ops_status | build_agent | improve_agent |
  strategy_review | unknown`. Deterministic + testable.
- Wired in `cockpit-orchestrator-bridge.ts`: every Ask HartOS message gets a
  grounded intent answer (panels + orchestrator facts) attached to the response
  (`intent`, `intentSummary`, `intentHighlights`, `intentGaps`, `intentNextSteps`,
  `intentSuggestedCommands`, `intentClarifyingQuestion`, `panels`).
- Rendered by `cockpit-renderer.ts` (server-side + live client updater).

## Hard boundaries honoured
- Read-only. No execution, no KV, no Supabase/ClickUp/Drive/Health/Telegram
  writes, no custom auth, no Cloudflare deploy, no secrets in output.
- LLM enhancement stays optional/gated; deterministic fallback always works.

## Tests
- `tests/cockpit-domain-panels.test.ts` — missing / partial / available data.
- `tests/cockpit-intent-router.test.ts` — all required commands + grounded answers.
- `tests/cockpit-panels-render.test.ts` — panels + intent render, read-only.
- Factory: `tests/phase12.test.ts` — generation + wiring + regression.

## Verify
```bash
npm run typecheck && npm test
npm run verify && npm run smoke:local
npm run cockpit:web -- --dry-run
npm run cockpit:ask -- --request="What's my system status?"
```

## Next (not in scope here)
- Hosted Cloudflare snapshot-bake (Phase 11K) — deferred.
- Exposing nutrition / HRV / training-load tables in the fitness read-model and
  card status/priority in the ops read-model will light up the currently-degraded
  fields automatically (no panel code change needed).
