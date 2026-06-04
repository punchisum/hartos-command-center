# HartOS Build Plan Contract

**Phase 11F** — build plan generation

## Command

```bash
npm run hartos:build-plan -- --request="Build a dashboard cockpit"
```

## What a build plan contains

```
Build request
Classification
Strategy verdict
CTO verdict
Existing capabilities
Missing capabilities
Recommended Beezulbub actions
Recommended Factory actions
Suggested phase breakdown (build sequence)
Database/domain placement
Approval gates
Risks
Do-not-build list
Next prompt skeleton
```

## Example: Tax Agent

Recommendation: **do not build the Tax Agent first.**

Build sequence:

```
1. Receipt / Finance Document Agent
2. Expense Classification
3. Accountant Export
4. Tax Specialist Agent
```

Reason: tax depends on clean document ingestion and an evidence trail.

## Example: Dashboard Cockpit

Build sequence:

```
1. Data Contract (Phase 11G)
2. Single value view (approval queue OR report viewer)
3. Status + manual-required panels
4. Full cockpit assembly
```

Reason: do not build cockpit UI before the data contract is defined.

## Approval gates (always present)

- Strategy approval (Hart) before committing build effort
- `BEEZULBUB_ALLOW_PACK_IMPLEMENT` + `--approve-implementation` before implementing a pack
- `BEEZULBUB_ALLOW_PACK_PROMOTE` + `--approve-promote` before promoting a pack
- `CONFIRM_PRODUCTION_DEPLOY` (and provider gates) before any deployment

## Do-not-build list (always present)

- Command Center frontend UI before the Phase 11G data contract
- Autonomous execution / self-healing / worker swarm
- Provider mutations without explicit CONFIRM gates
- Treating skeleton / implementation_draft packs as production-ready

## Next prompt skeleton

Every build plan ends with a deterministic "next prompt skeleton" block,
suitable for pasting into the next session to continue the work safely.

---

Phase 11F — HartOS Agent Factory v2
