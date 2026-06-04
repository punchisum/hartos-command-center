# Capability Scoring: test-agent

Beezulbub scores repositories on 7 dimensions.

---

## Score dimensions (0-10)

| Dimension | Higher = better? | Description |
|-----------|-----------------|-------------|
| `capabilityValue` | ✓ | How many useful, extractable capabilities? |
| `licenseSafety` | ✓ | MIT/Apache = 9, GPL = 1, unknown = 0 |
| `maintenanceHealth` | ✓ | Tests present + modern stack |
| `securityRisk` | ✗ (lower = better) | Poison flags count × severity |
| `dependencyRisk` | ✗ (lower = better) | Number + age of dependencies |
| `hartosCompatibility` | ✓ | TypeScript, Supabase, Cloudflare = ↑ |
| `extractionDifficulty` | ✗ (lower = easier) | Code complexity + poison |

## Overall score

Weighted composite:
```
overall = capabilityValue×0.30 + licenseSafety×0.20 + maintenanceHealth×0.15
        + (10-securityRisk)×0.20 + (10-dependencyRisk)×0.05 + hartosCompatibility×0.10
```

## Verdict thresholds

| Overall | Verdict |
|---------|---------|
| ≥ 7, no critical poison | `DEVOUR` |
| ≥ 4 | `PARTIAL_DEVOUR` |
| capabilityValue ≥ 4 | `REFERENCE_ONLY` |
| maintenanceHealth < 3 | `REJECT_STALE` |
| licenseRisk = risky/unknown | `REJECT_LICENSE` |
| critical poison + low value | `REJECT_POISON` |
