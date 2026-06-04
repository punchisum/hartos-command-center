# Release Checklist: test-agent

Complete this checklist before and after every release.

---

## Pre-release (any environment)

- [ ] All tests pass: `npm test`
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] Local smoke passes: `npm run smoke:local`
- [ ] Env vars checked: `npm run check:env`
- [ ] Provider status reviewed: `npm run provider:status`
- [ ] Migration plan reviewed: `npm run migrations:plan`
- [ ] Deployment readiness checked: `npm run deployment:check`
- [ ] No real secrets in code, docs, or commits
- [ ] `wrangler.toml` (not `.example`) is NOT committed

---

## Staging release

- [ ] Pre-release checklist complete
- [ ] Migrations applied (if any): `ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply`
- [ ] Worker deployed: `ALLOW_CLOUDFLARE_DEPLOY=true npm run deploy:staging`
- [ ] Webhook registered (if URL changed): `ALLOW_TELEGRAM_WEBHOOK_REGISTER=true npm run telegram:register-webhook`
- [ ] Staging smoke passes: `APP_ENV=staging npm run smoke:staging`
- [ ] Release report generated: `APP_ENV=staging npm run release:report`
- [ ] `migration-reports/smoke-staging-*.md` shows `Passed: ✓ yes`

---

## Production promotion

- [ ] Staging release checklist complete
- [ ] Staging smoke evidence exists: `ls migration-reports/smoke-staging-*.md`
- [ ] Team lead has reviewed staging smoke report
- [ ] Production secrets set in Cloudflare dashboard
- [ ] Production gates confirmed ready:
  - [ ] `CONFIRM_PRODUCTION_DEPLOY=true`
  - [ ] `ALLOW_CLOUDFLARE_DEPLOY=true`
  - [ ] `ALLOW_SUPABASE_MIGRATION_APPLY=true` (if migrations pending)
  - [ ] `ALLOW_TELEGRAM_WEBHOOK_REGISTER=true` (if webhook URL changed)
- [ ] Production migration plan reviewed: `APP_ENV=production npm run migrations:plan`
- [ ] Production deployment complete: `APP_ENV=production npm run promote:production`
- [ ] Production smoke passes: `APP_ENV=production npm run smoke:production`
- [ ] Production release report generated: `APP_ENV=production npm run release:report`

---

## Post-release

- [ ] Health check confirms: `npm run verify:cloudflare`
- [ ] Telegram bot responds to test command
- [ ] Trigger jobs are registered and active (verify in Trigger dashboard)
- [ ] Debug events are appearing in Supabase: check `debug_events` table
- [ ] Handover written: update `docs/HANDOVER.md`

---

## If anything fails

1. Stop. Do not proceed.
2. Run: `APP_ENV=<environment> npm run rollback:plan`
3. Follow `docs/ROLLBACK.md`
4. Write a post-mortem in `docs/HANDOVER.md`
