# HartOS CTO MVP

**Phase 11F** — CTO technical review module

## Role

The CTO is the **engineering / build specialist** inside the Orchestrator.
It handles engineering and build matters only. It is not the top-level boss —
the Orchestrator routes to it.

## What it reads (read-only)

```
capabilities/capability-registry.json
capabilities/provenance-ledger.json
packs/<name>/pack.manifest.json     (optional cross-check)
beezulbub-reports/pack-verify-*.md  (future)
beezulbub-reports/pack-conflicts-*.md (future)
```

## Usability doctrine

A capability is treated as **usable** only when ALL hold:

- registry status is `verified` or `available`
- provenance exists in the ledger

Lifecycle treatment:

| Registry status | CTO treatment |
|---|---|
| `available` / `verified` + provenance | **usable** |
| `verified` / `available` WITHOUT provenance | NOT usable (provenance required) |
| `implementation_draft` | planning-only — NOT production |
| `pack_skeleton_created` | NOT usable (needs implementation) |
| `missing` | acquire via Beezulbub |

Skeleton packs are never treated as production-ready.

## Command

```bash
npm run hartos:cto-review -- --request="Build a receipt OCR agent"
```

## Output shape

```json
{
  "technicalVerdict": "build_with_existing_capabilities",
  "existingCapabilities": [],
  "missingCapabilities": [],
  "planningOnlyCapabilities": [],
  "recommendedBeezulbubActions": [],
  "recommendedFactoryActions": [],
  "risks": [],
  "dependencies": [],
  "implementationSequence": [],
  "humanApprovalsRequired": []
}
```

### Technical verdicts

- `build_with_existing_capabilities` — all required capabilities usable
- `build_with_new_capabilities` — some usable, some to acquire
- `needs_beezulbub_acquisition` — all required capabilities missing
- `blocked_missing_capabilities`
- `defer_to_strategy`
- `insufficient_information`

## Safety

The CTO produces recommendations only. It never mutates packs, registries,
providers, or Supabase, and never calls live services.

---

Phase 11F — HartOS Agent Factory v2
