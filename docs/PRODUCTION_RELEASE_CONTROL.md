# Production Release Control: test-agent

Phase 9 adds industrial-grade production promotion control.

---

## Production promotion flow

```
1. Staging proof check — verify staging launched and was green
2. Production gate check — all gates must be set
3. Production provision plan
4. Production provider verify
5. Production provision auto (gated)
6. Production smoke
7. Release comparison
8. Production release report
9. Rollback plan
```

---

## Gates required for production

| Gate | Required for |
|------|-------------|
| `ALLOW_PRODUCTION_PROMOTION=true` | Any production promotion |
| `CONFIRM_PRODUCTION_DEPLOY=true` | Any production mutation |
| `ALLOW_AUTO_PROVISION=true` | Running provision engine |
| Provider gates | Per-provider mutations |

---

## Quick commands

```bash
# Check production readiness (no mutations)
npm run production:check

# Run production smoke (read-only)
npm run production:smoke

# Compare latest releases
npm run release:compare

# Check observability (read-only)
npm run observability:check

# Promote to production (requires all gates + staging proof)
ALLOW_PRODUCTION_PROMOTION=true \
CONFIRM_PRODUCTION_DEPLOY=true \
ALLOW_AUTO_PROVISION=true \
npm run promote:production
```

---

## Staging proof requirement

Production promotion requires a successful staging launch. If no staging report exists:

```
blocked_no_staging_proof
```

Run staging first: `npm run launch:staging`

If staging was partial (not fully successful):

```
blocked_staging_not_green
```

Either fix staging issues or override with:
```bash
ALLOW_PARTIAL_STAGING_PROMOTION=true npm run promote:production
```

---

## Reports

All production reports are written to `launch-reports/`:
- `staging-launch-*.md/json` — staging launch reports
- `release-compare-*.md` — release comparison
- `rollback-plan-production-*.md` — rollback instructions
