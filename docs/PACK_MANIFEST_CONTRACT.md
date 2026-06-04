# Pack Manifest Contract: test-agent

The `pack.manifest.json` file is the machine-readable contract for a pack skeleton.

---

## Schema

```json
{
  "packName": "dashboard_layout",
  "packVersion": "0.1.0",
  "status": "skeleton",
  "source": {
    "digestId": "digest-from-beezulbub-reports",
    "repoName": "clean-dashboard",
    "sourceUrl": null,
    "verdict": "DEVOUR",
    "scoreOverall": 7.9,
    "license": "MIT"
  },
  "capabilities": ["dashboard_layout", "admin_table"],
  "hartosCompatibility": {
    "requiresSupabase": false,
    "requiresTrigger": false,
    "requiresCloudflare": false,
    "requiresTelegram": false,
    "requiresApprovalGate": true
  },
  "absorb": ["layout shell pattern", "card UI pattern"],
  "reject": [
    "foreign auth model",
    "foreign database schema",
    "foreign deployment assumptions"
  ],
  "requiredTests": [
    "pack contract test (manifest valid)",
    "no secret report test",
    "smoke plan exists"
  ],
  "createdAt": "2026-06-04T00:00:00.000Z"
}
```

---

## Status values

| Status | Meaning |
|--------|---------|
| `skeleton` | Stubs generated — needs implementation |
| `reference_only` | Study only — not for implementation |
| `implementation` | Fully implemented (Phase 11D+) |
| `blocked` | Generation was blocked |

---

## Contract test

Every pack must pass `tests/pack.contract.test.ts`:
- `pack.manifest.json` exists and is valid JSON
- `packName`, `packVersion`, `status` are all present
- `adaptation-plan.md` exists
- No secrets in manifest
- `smoke/smoke-plan.md` exists
