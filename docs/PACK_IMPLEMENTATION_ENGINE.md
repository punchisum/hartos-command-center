# Pack Implementation Engine

**Phase 11E** — HartOS Agent Factory v2

## Purpose

`beezulbub:pack-implement` generates HartOS-native implementation stubs for a pack that has reached `skeleton` status.

This command turns a skeleton pack (structure + docs only) into an `implementation_draft` with real TypeScript stubs that can be reviewed and completed by an engineer.

## Critical doctrine

- **Does NOT copy third-party source code**
- All generated stubs contain: `"HartOS-native scaffold. Third-party source code was not copied. Implementation must be completed under HartOS review."`
- All stubs `throw new Error("not yet implemented")` — they are NOT production ready
- No hardcoded secrets in any generated file
- All data contracts reference HartOS-approved sources (Supabase RLS, debug_events)

## Usage

```bash
BEEZULBUB_ALLOW_PACK_IMPLEMENT=true \
  npm run beezulbub:pack-implement -- --pack=packs/my-pack --approve-implementation
```

## Gate requirements

Both of these must be present:

1. `BEEZULBUB_ALLOW_PACK_IMPLEMENT=true` (env var)
2. `--approve-implementation` (CLI flag)

This dual-gate prevents accidental stub generation.

## Pre-conditions

| Condition | Blocked status |
|---|---|
| Gates not set | `blocked_missing_approval` |
| Pack status ≠ `skeleton` | `blocked_bad_status` |
| Verdict is `REJECT_*` or `REFERENCE_ONLY` | `blocked_bad_verdict` |
| Provenance missing (when ledger provided) | `blocked_no_provenance` |
| Safety scan fails | `failed` |

## What gets generated

Based on the primary capability type:

### `dashboard_layout`
- `components/dashboard-shell.ts`
- `components/agent-status-card.ts`
- `tests/pack.contract.test.ts` (upgraded)
- `smoke/smoke-plan.md` (upgraded)

### `receipt_ocr`
- `runtime/receipt-ocr-adapter.ts`
- `runtime/confidence-score.ts`
- `runtime/approval-draft-contract.ts`
- `tests/pack.contract.test.ts` (upgraded)
- `smoke/smoke-plan.md` (upgraded)

### `agent_status_card`
- `components/agent-status-card.ts`
- `runtime/agent-health-contract.ts`
- `tests/pack.contract.test.ts` (upgraded)
- `smoke/smoke-plan.md` (upgraded)

### Generic (any other capability)
- `runtime/capability-boundary.ts`
- `runtime/input-output-contract.ts`
- `tests/pack.contract.test.ts` (upgraded)
- `smoke/smoke-plan.md` (upgraded)

## Status transition

```
skeleton → implementation_draft
```

The manifest `status` field is updated automatically after successful generation.

## After implementation

1. Review the generated stubs in your pack directory
2. Follow `adaptation-plan.md` to complete the implementation
3. Run `npm run beezulbub:pack-verify -- --pack=<path>`
4. When verified: `npm run beezulbub:pack-promote -- --pack=<path> --to=verified --approve-promote`

---

Phase 11E — HartOS Agent Factory v2
