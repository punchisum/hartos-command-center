# Staging Deployment Runbook: test-agent

Deploy to staging after local smoke tests pass.
Every mutating step requires an explicit gate env var.
No step silently mutates infrastructure.

---

## Pre-deployment checklist

- [ ] `npm run verify` passes
- [ ] `npm run smoke:local` passes
- [ ] `npm run deployment:check` shows no critical failures
- [ ] `npm run migrations:plan` reviewed
- [ ] `wrangler.toml.example` copied to `wrangler.toml` and filled
- [ ] Staging secrets set in Cloudflare dashboard (`wrangler secret put ...`)
- [ ] `.env.staging.example` reviewed — staging env vars configured locally if needed

---

## Deployment commands

### 1. Check readiness (no side effects)

```bash
APP_ENV=staging npm run deployment:check
APP_ENV=staging npm run migrations:plan
```

### 2. Apply migrations (gated)

```bash
APP_ENV=staging \
ALLOW_SUPABASE_MIGRATION_APPLY=true \
npm run migrations:apply
```

After running, confirm via Supabase CLI or dashboard that migrations applied.
Then mark as applied in ledger:

```bash
APP_ENV=staging \
ALLOW_SUPABASE_MIGRATION_APPLY=true \
npm run migrations:apply -- --mark-applied
```

### 3. Deploy Worker (gated)

```bash
APP_ENV=staging \
ALLOW_CLOUDFLARE_DEPLOY=true \
npm run deploy:staging
```

### 4. Register Telegram webhook (gated)

```bash
APP_ENV=staging \
STAGING_TELEGRAM_WEBHOOK_URL=https://your-staging-worker.workers.dev/webhook \
ALLOW_TELEGRAM_WEBHOOK_REGISTER=true \
npm run telegram:register-webhook
```

Verify:
```bash
npm run verify:telegram
```

### 5. Run staging smoke

```bash
APP_ENV=staging npm run smoke:staging
```

### 6. Generate release report

```bash
APP_ENV=staging npm run release:report
```

### 7. Full automated workflow (all gates required)

```bash
APP_ENV=staging \
ALLOW_SUPABASE_MIGRATION_APPLY=true \
ALLOW_CLOUDFLARE_DEPLOY=true \
ALLOW_TELEGRAM_WEBHOOK_REGISTER=true \
npm run deploy:staging
```

---

## What the staging workflow does NOT do automatically

- Auto-create Supabase projects
- Auto-create Telegram bots
- Deploy to production
- Apply migrations without `ALLOW_SUPABASE_MIGRATION_APPLY=true`

---

## If staging smoke fails

```bash
APP_ENV=staging npm run rollback:plan
```

Follow the generated rollback runbook.
Do not promote to production until staging smoke passes.
