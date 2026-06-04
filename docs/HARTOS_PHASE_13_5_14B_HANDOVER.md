# HartOS Phase 13.5 + 14B Handover — Real Data Activation + Local Proposal Queue

## What shipped

### Phase 13.5 — real read-only data activation
- `src/cockpit/sources/source-diagnostics.ts` — per-domain read-model
  diagnostics (configured/enabled/disabled/missing_env/stale/rejected_unsafe/
  reports_only/unavailable) + rolled-up source lists + setup steps. Rejects
  service-role keys (inspects role claim locally; never prints secrets).
- Factory source/panel: latest validation/test counts + latest cockpit report
  (with freshness), in addition to verification/build artefacts.
- New router intent `read_model_status` answers "show read model status", "what
  sources are connected", "what data is stale", "why is my fitness/ops panel
  missing data" from the diagnostics.
- `CockpitState.sourceDiagnostics`; renderer **Read-model Diagnostics** section.

### Phase 14B — local proposal queue
- `src/cockpit/proposals/proposal-queue.ts` — gitignored `cockpit-proposals/`
  storage; `ProposalQueueItem` (status + updatedAt + auditEvents). Ops: save/
  list/read/resolveRef/reject/markSimulatedApproved/appendAudit/expire/dryRun.
  No execute; secret check before every write.
- Router intents `proposal_list` / `proposal_reject` / `proposal_dryrun` +
  `parseProposalRef`. Bridge saves generated drafts, expires stale, applies
  reject/dry-run to the local queue, fails safely on unknown refs.
- `CockpitState.proposalQueue`; renderer **Proposal Queue** section
  (NON-EXECUTABLE · DRY-RUN ONLY · REAL EXECUTION DISABLED, disabled buttons).
- `.gitignore` template now includes `cockpit-proposals/`, `cockpit-reports/`,
  `cockpit-threads/`.

## Hard boundaries honoured
Read-only. No Cloudflare deploy/snapshot-bake, no KV, no real execution, no
Supabase/ClickUp/Drive/Health/Telegram writes, no service-role keys, no new
tax/invoice/stock agents, no custom auth, no secrets in output/queue files.
Execution always fails closed.

## Tests
- `tests/cockpit-source-diagnostics.test.ts` — configured/disabled/missing/stale/
  rejected states + no secrets.
- `tests/cockpit-proposal-queue.test.ts` — save/list/read/reject/dry-run/expire/
  audit, fail-closed execution, no secrets, graceful degradation.
- Extended router (diagnostics + queue intents) + panels-render (queue +
  diagnostics sections, disabled buttons).
- Factory: `tests/phase13_5-14b.test.ts` — generation + gitignore + wiring + safety.

## Verify
```bash
npm run typecheck && npm run validate && npm test   # factory
# generated:
npm run typecheck && npm test && npm run verify && npm run smoke:local
npm run cockpit:web -- --dry-run
npm run cockpit:ask -- --request="Show read model status"
npm run cockpit:ask -- --request="Create a tax agent"
npm run cockpit:ask -- --request="Show pending proposals"
npm run cockpit:ask -- --request="Dry run proposal 1"
npm run cockpit:ask -- --request="Reject proposal 1"
```

## Next (still deferred)
- Real action execution remains unsupported (future phase, hard-gated).
- Hosted Cloudflare / snapshot-bake.
- Enabling read-models (anon key) will move fitness/ops domains from
  `disabled`/`missing_env` to `live` automatically.
