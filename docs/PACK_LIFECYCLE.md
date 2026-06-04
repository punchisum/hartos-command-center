# Pack Lifecycle

**Phase 11D** — HartOS Agent Factory v2

## Pack status progression

```
candidate
  ↓
planned
  ↓
skeleton          ← pack-generate creates this
  ↓
implementation_draft  ← pack-implement creates this
  ↓
verified          ← pack-verify + pack-promote --to=verified
  ↓
available         ← pack-promote --to=available
```

Terminal states (cannot be promoted from): `deprecated`, `rejected`, `blocked`

## Pack statuses

| Status | Usable? | How to reach |
|---|---|---|
| `candidate` | No | Manual identification |
| `planned` | No | Manual planning |
| `skeleton` | No | `beezulbub:pack-generate` |
| `reference_only` | No | `beezulbub:pack-generate --reference-pack` |
| `implementation_draft` | No | `beezulbub:pack-implement` |
| `verified` | Staging only | `beezulbub:pack-promote --to=verified` |
| `available` | Yes | `beezulbub:pack-promote --to=available` |
| `deprecated` | No | Manual |
| `rejected` | Never | Manual / verdict |
| `blocked` | Never | Automatic gate failure |

## Promotion rules

1. **Gate required**: `BEEZULBUB_ALLOW_PACK_PROMOTE=true` + `--approve-promote`
2. **To `verified`**: pack must pass `beezulbub:pack-verify` (all checks green)
3. **To `available`**: pack must be `verified` first, provenance must exist, verdict must not be `REJECT_*` or `REFERENCE_ONLY`
4. **REJECT_*** verdicts: can never be promoted
5. **REFERENCE_ONLY**: can reach `verified` for study, never `available`

## Lifecycle transitions allowed

```
skeleton → verified        (requires verification)
skeleton → deprecated      (allowed)
skeleton → rejected        (allowed)
implementation_draft → verified  (requires verification)
implementation_draft → deprecated
verified → available       (requires provenance)
verified → deprecated
available → deprecated     (sunsetting)
```

## API

```typescript
import {
  PACK_STATUS_ORDER,
  TERMINAL_PACK_STATUSES,
  isValidPackStatus,
  isUsablePackStatus,
  canPromoteTo,
} from "./src/beezulbub/pack-lifecycle.js";
```

---

Phase 11D — HartOS Agent Factory v2
