# Capability Registry

**Phase 11D** — HartOS Agent Factory v2

## Purpose

The capability registry (`capabilities/capability-registry.json`) is a machine-readable index of all capabilities known to this agent factory. It tracks:

- Which pack owns each capability
- The current capability lifecycle status
- When each capability was first registered and last updated

## File location

```
capabilities/capability-registry.json
```

Configurable via `BEEZULBUB_CAPABILITY_REGISTRY_PATH` env var.

## Capability lifecycle statuses

| Status | Meaning |
|---|---|
| `missing` | Not yet scouted |
| `scouted` | Candidate identified |
| `devour_recommended` | Digest recommends devour |
| `pack_skeleton_created` | Pack skeleton exists — NOT ready for use |
| `implementation_pending` | Awaiting stubs |
| `implementation_draft` | Stubs generated — NOT production-ready |
| `verified` | Locally verified — staging with caution |
| `available` | Safe to compose into agents |
| `in_use` | Active in one or more agents |
| `retired` | No longer maintained |
| `rejected` | BLOCKED |

## API

```typescript
import {
  loadRegistry,
  saveRegistry,
  registerPackGenerated,
  updateCapabilityStatus,
  formatCapabilityList,
} from "./src/beezulbub/capability-registry.js";
```

### `registerPackGenerated(registryPath, packName, capabilityIds)`

Called automatically by `beezulbub:pack-generate` after skeleton generation. Sets all capabilities to `pack_skeleton_created`.

### `updateCapabilityStatus(registryPath, capabilityId, status)`

Called by `pack-implement` and `pack-promote` to advance capability status.

### `formatCapabilityList(registry)`

Returns a human-readable table of all registered capabilities and their statuses.

## CLI

```bash
npm run beezulbub:capability-list
```

## Schema

```json
{
  "version": 1,
  "lastUpdated": "2026-01-01T00:00:00Z",
  "capabilities": {
    "dashboard_layout": {
      "capabilityId": "dashboard_layout",
      "packName": "dashboard-layout",
      "status": "pack_skeleton_created",
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:00:00Z"
    }
  }
}
```

## Rules

- Registry is non-destructive: registering an existing capability updates `updatedAt` only if status advances.
- Registry is informational — it does NOT gate operations. Use `BEEZULBUB_ALLOW_PACK_*` gates for that.
- Registry is always written atomically (via `writeFile`).

---

Phase 11D — HartOS Agent Factory v2
