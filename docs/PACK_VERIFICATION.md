# Pack Verification

**Phase 11D** — HartOS Agent Factory v2

## Purpose

`beezulbub:pack-verify` validates that a pack skeleton or implementation draft is structurally correct and safe before it can be promoted.

Verification is **required** to promote a pack to `verified` status.

## Usage

```bash
npm run beezulbub:pack-verify -- --pack=packs/my-pack
```

Optional: set `BEEZULBUB_PROVENANCE_LEDGER_PATH` to include provenance check.

## Verification checks (13+)

| Check | Description |
|---|---|
| `pack_directory_exists` | Pack directory must exist |
| `manifest_exists` | `pack.manifest.json` must exist |
| `manifest_has_required_fields` | `packName`, `packVersion`, `status` must be present |
| `manifest_status_valid` | Status must be a known PackStatus |
| `manifest_no_secrets` | Manifest must not contain API key patterns |
| `doc_README_md` | `README.md` must exist |
| `doc_adaptation-plan_md` | `adaptation-plan.md` must exist |
| `doc_source-digest-summary_md` | `source-digest-summary.md` must exist |
| `doc_rejected-poison_md` | `rejected-poison.md` must exist |
| `doc_implementation-notes_md` | `implementation-notes.md` must exist |
| `contract_test_exists` | `tests/pack.contract.test.ts` must exist |
| `smoke_plan_exists` | `smoke/smoke-plan.md` must exist |
| `no_.env` | No `.env` file allowed in pack |
| `no_package-lock_json` | No lockfiles in pack directory |
| `provenance_exists` | (optional) Provenance recorded in ledger |
| `no_deploy_script` | No `deploy.sh`, `deploy.ts`, `deploy.js` |

## Result format

```typescript
interface PackVerifyResult {
  packName: string;
  packPath: string;
  status: "passed" | "failed";
  passedCount: number;
  failedCount: number;
  checks: VerificationCheck[];
  nextAction: string;
  verifiedAt: string;
}
```

## Exit codes

- `0` — all checks passed
- `1` — one or more checks failed

## Promotion gate

Pack promotion to `verified` will call `verifyPack()` internally. A failing check blocks promotion.

---

Phase 11D — HartOS Agent Factory v2
