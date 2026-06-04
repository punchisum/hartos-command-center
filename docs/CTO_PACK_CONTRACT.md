# CTO Pack Contract

**Phase 11D** — HartOS Agent Factory v2

## Purpose

This document specifies the interface between the future CTO Agent (Phase 11F) and the pack governance system (Phase 11D).

The CTO Agent is NOT implemented yet. This contract defines what it will be allowed to read and request when it exists.

## What the CTO agent can READ

- `capabilities/capability-registry.json` — the capability index
- `packs/<name>/pack.manifest.json` — any pack manifest
- Pack lifecycle status (`manifest.status`)
- Pack verification reports (`beezulbub-reports/pack-verify-*.md`)
- `capabilities/provenance-ledger.json` — provenance records
- Conflict reports (`beezulbub-reports/pack-conflicts-*.md`)

## What the CTO agent can REQUEST

- A pack plan for a capability target
- A list of available capabilities
- Verification status for a specific pack
- Conflict analysis for a set of packs

## What the CTO agent must NEVER assume

- ❌ A pack with `status=skeleton` is usable
- ❌ A pack with `status=implementation_draft` is production-ready
- ❌ Provenance-missing packs are safe to compose
- ❌ Verification is optional for promotion
- ❌ `REFERENCE_ONLY` packs can be used as implementations
- ❌ Any pack without a passing pack-verify is safe
- ❌ A pack can be deployed without HartOS promotion gates

## Pack status interpretation for CTO

| Status | Meaning |
|---|---|
| `skeleton` | NOT usable — stubs only, needs implementation |
| `reference_only` | NOT usable — study reference only |
| `implementation_draft` | NOT production-ready — stubs generated, needs review |
| `verified` | Locally verified — can be used in staging with caution |
| `available` | **Safe for CTO to compose into agents** |
| `deprecated` | Do NOT use — replaced by newer version |
| `rejected` | BLOCKED — poison, license, or low value |

## The only usable status

`available` is the only status a CTO agent should use when composing capabilities into agent configurations.

## API

```typescript
import { formatCtoSummary } from "./src/beezulbub/cto-contracts.js";
const summary = formatCtoSummary();
```

---

Phase 11D — CTO Agent implementation in Phase 11F.
HartOS Agent Factory v2
