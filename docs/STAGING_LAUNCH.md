# Staging Launch: test-agent

One-command staging launch orchestration (Phase 8).

---

## Quick start

```bash
# 1. Review launch plan (no mutations)
npm run launch:plan

# 2. Verify all providers are configured
npm run launch:verify

# 3. Run staging launch with all gates
ALLOW_AUTO_PROVISION=true \
CONFIRM_STAGING_PROVISION=true \
ALLOW_GITHUB_PROVISION=true \
ALLOW_GITHUB_PUSH=true \
ALLOW_OPENAI_VERIFY=true \
ALLOW_SUPABASE_PROVISION=true \
ALLOW_SUPABASE_MIGRATION_APPLY=true \
ALLOW_CLOUDFLARE_PROVISION=true \
ALLOW_CLOUDFLARE_DEPLOY=true \
ALLOW_TELEGRAM_PROVISION=true \
ALLOW_TELEGRAM_WEBHOOK_REGISTER=true \
ALLOW_TRIGGER_PROVISION=true \
ALLOW_TRIGGER_TASK_REGISTER=true \
npm run launch:staging
```

---

## What `launch:staging` does

In order:

1. **Readiness check** — env vars, gates, configuration files
2. **Provision plan** — lists all provider steps (no mutations)
3. **Provider verify** — checks all provider status (read-only)
4. **Provision auto** — runs provisioning engine with staging gates
5. **Deployment check** — verifies Worker health endpoint
6. **Staging smoke** — basic smoke check against staging
7. **Launch report** — writes `launch-reports/staging-launch-*.md`
8. **Rollback plan** — writes `launch-reports/rollback-plan-*.md`

---

## Launch statuses

| Status | Meaning |
|--------|---------|
| `success` | All steps ok, smoke passed |
| `partial` | Some manual_required steps or smoke degraded |
| `blocked_missing_gate` | Global gates missing — no mutations ran |
| `blocked_manual_required` | Steps need CLI/dashboard actions |
| `failed` | At least one step failed — see rollback plan |

---

## Provider dependency order

```
GitHub → OpenAI → Supabase → Cloudflare → Telegram → Trigger.dev → Smoke → Report
```

---

## Manual steps

Some actions cannot be automated and return `manual_required`:

- Supabase project creation → use dashboard at https://supabase.com/dashboard
- Supabase migration apply → use `ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply`
- Cloudflare Worker secrets → use `wrangler secret put <NAME>`
- Trigger.dev task registration → use `npx trigger.dev@latest deploy`

After completing manual steps, re-run `npm run launch:staging`.

---

## Reports

Launch reports are written to `launch-reports/`:
- `staging-launch-*.md` — human-readable report
- `staging-launch-*.json` — machine-readable summary
- `rollback-plan-*.md` — rollback instructions if needed

---

## Safe to run without secrets

`npm run launch:plan` and `npm run launch:verify` are always safe — they make no API calls and perform no mutations.

`npm run launch:staging` without gates set will show a `blocked_missing_gate` report with all missing gates listed clearly.
