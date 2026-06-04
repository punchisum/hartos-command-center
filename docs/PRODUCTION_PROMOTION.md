# Production Promotion: test-agent

Promote a staging-verified agent to production.

---

## Prerequisites

Before running `promote:production`:

1. Run `npm run launch:staging` and confirm it succeeds
2. Run `npm run production:check` to review readiness
3. Set all required gates (see below)

---

## Required gates

```bash
ALLOW_PRODUCTION_PROMOTION=true
CONFIRM_PRODUCTION_DEPLOY=true
ALLOW_AUTO_PROVISION=true
# Provider gates as needed:
ALLOW_CLOUDFLARE_DEPLOY=true
ALLOW_SUPABASE_PROVISION=true
ALLOW_TELEGRAM_WEBHOOK_REGISTER=true
ALLOW_TRIGGER_TASK_REGISTER=true
```

---

## Run promotion

```bash
ALLOW_PRODUCTION_PROMOTION=true \
CONFIRM_PRODUCTION_DEPLOY=true \
ALLOW_AUTO_PROVISION=true \
ALLOW_CLOUDFLARE_DEPLOY=true \
npm run promote:production
```

---

## Promotion blocks if

| Condition | Status |
|-----------|--------|
| No staging launch report | `blocked_no_staging_proof` |
| Staging failed | `blocked_staging_not_green` |
| Staging partial (without override) | `blocked_staging_not_green` |
| Gates missing | `blocked_missing_gate` |
| Provider returned manual_required | `blocked_manual_required` |

---

## After promotion

1. Verify: `npm run production:smoke`
2. Check observability: `npm run observability:check`
3. Compare releases: `npm run release:compare`
4. If something fails: see `launch-reports/rollback-plan-production-*.md`
