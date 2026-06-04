# HartOS Phase 13 + 14A Handover — Live Read-Only Data + Safe Proposals

## What shipped

### Phase 13 — live read-only data foundation
- New read-only source layer `src/cockpit/sources/`:
  `source-types` (SourceResult/SourceValue/diagnostics), `freshness`
  (fresh/stale/unknown + confidence), `secret-guard` (rejects service-role
  keys), `local-report-source` + `handover-source` parsers, `supabase-source`
  wrapper, `layered` priority resolver, and `fitness/ops/factory` resolvers.
- Panel fields now carry `lastUpdated` + a freshness verdict + confidence +
  source. Builders consume a resolved `SourceResult` (priority: live read-model
  → local report → handover → unavailable + exact setup step) and stay pure via
  a derive-from-summaries fallback.
- `read-model-report` refuses a Supabase service-role key for the read boundary.
- Renderer shows per-field freshness badges; unavailable fields keep showing the
  exact setup step.

### Phase 14A — safe action proposal layer (NO execution)
- New `src/cockpit/proposals/`: `proposal-types` (ActionProposal + DryRunResult,
  `executable: false`), `gates` (proposals gate; execution hard-capped false;
  `executeProposal()` fails closed), `proposal-simulator` (dry-run only),
  `proposal-generator` (drafts from intent + panels).
- Router attaches `proposals` to its result (build/improve/ops/fitness/strategy).
  Bridge passes `now` + `env`, attaches `response.proposals`. cockpit-ask prints
  them. Renderer shows an **Action Proposals** section, non-executable / dry-run
  only, with disabled buttons.

## Hard boundaries honoured
Read-only. No Cloudflare deploy, no snapshot-bake, no KV, no real execution, no
Supabase/ClickUp/Drive/Health/Telegram writes, no service-role keys, no new
tax/invoice/stock agents, no secrets in output. Phase 13 never depends on env
gates; proposal execution always fails closed.

## Tests
- `tests/cockpit-sources.test.ts` — freshness, stale-as-stale, partial data,
  service-role rejection, no secrets.
- `tests/cockpit-proposals.test.ts` — drafts only, execution fails closed,
  simulation read-only, gates, no secrets.
- Extended `cockpit-intent-router` (proposal awareness) + `cockpit-panels-render`
  (freshness badges + proposal section + disabled buttons).
- Factory: `tests/phase13-14a.test.ts` — generation + wiring + regression.

## Verify
```bash
npm run typecheck && npm run validate && npm test       # factory
# generated:
npm run typecheck && npm test && npm run verify && npm run smoke:local
npm run cockpit:web -- --dry-run
npm run cockpit:ask -- --request="How's recovery?"
ALLOW_COCKPIT_ACTION_PROPOSALS=true npm run cockpit:ask -- --request="Create a tax agent"
```

## Next (not in scope)
- Real action execution remains unsupported (future phase, behind a hard gate).
- Hosted Cloudflare / snapshot-bake still deferred.
- Exposing nutrition/HRV/load tables (fitness) and card status/priority (ops) in
  the read-models will light up currently-degraded fields automatically.
