# Rollback Runbook: test-agent

Use this document when a deployment needs to be reversed.

Generate the current rollback plan before starting:

```bash
APP_ENV=staging npm run rollback:plan
# or
APP_ENV=production npm run rollback:plan
```

The generated plan is written to `migration-reports/rollback-plan-*.md`.

---

## 1. Cloudflare Worker rollback

```bash
# Option A — wrangler rollback (if available):
wrangler rollback --env staging
wrangler rollback --env production

# Option B — redeploy previous release:
git checkout <previous-release-tag>
ALLOW_CLOUDFLARE_DEPLOY=true npm run deploy:staging
# or with CONFIRM_PRODUCTION_DEPLOY=true for production
```

Verify after rollback:
```bash
npm run verify:cloudflare
```

---

## 2. Telegram webhook rollback

If the webhook URL changed and must be reverted:

```bash
TELEGRAM_WEBHOOK_URL=<previous-url> \
ALLOW_TELEGRAM_WEBHOOK_REGISTER=true \
npm run telegram:register-webhook
```

For production:
```bash
TELEGRAM_WEBHOOK_URL=<previous-url> \
ALLOW_TELEGRAM_WEBHOOK_REGISTER=true \
CONFIRM_PRODUCTION_DEPLOY=true \
npm run telegram:register-webhook
```

Verify:
```bash
npm run verify:telegram
```

---

## 3. Supabase migration rollback

Database migrations are **not** automatically reversed.

Check which migrations were applied:
```bash
cat .migration-ledger.json
```

For each migration that must be reversed:

1. Write a reverting migration file:
   ```bash
   # Example: 000099_revert_add_users.sql
   touch supabase/migrations/000099_revert_add_users.sql
   ```

2. Add the reverting SQL. For example:
   ```sql
   -- Revert: 000010_add_users.sql
   drop table if exists public.users;
   ```

3. Apply via Supabase CLI or dashboard — do not auto-apply without review.

4. Mark as applied:
   ```bash
   ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply -- --mark-applied
   ```

---

## 4. Data repair

If a partial workflow left inconsistent state:

```sql
-- Find failed events from the failed deployment:
select trace_id, route, stage, outcome, failure_code, metadata
from public.debug_events
where outcome = 'error'
order by created_at desc
limit 20;

-- Reset affected rows (adjust table/status as needed):
update public.reports
set status = 'pending'
where status = 'processing'
  and updated_at > '<deployment-timestamp>';
```

---

## 5. Verify rollback

```bash
npm run verify
npm run smoke:local
npm run deployment:check
```

---

## 6. Write a handover

After rollback is confirmed, write a handover explaining:
- What was deployed
- What failed
- What was rolled back
- What the next steps are

```bash
# Generate a post-rollback release report:
APP_ENV=<environment> npm run release:report
```
