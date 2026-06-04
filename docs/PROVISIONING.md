# Provisioning Engine: test-agent

The Phase 6 provisioning engine builds a plan, runs it against provider adapters, and records results.

---

## Commands

| Command | Gates required | Mutates |
|---------|---------------|---------|
| `npm run provision:plan` | none | never |
| `npm run provision:verify` | none | never |
| `npm run provision:rollback-plan` | none | never |
| `npm run provision:auto -- --env=staging` | `ALLOW_AUTO_PROVISION` + `CONFIRM_STAGING_PROVISION` | yes (Phase 7) |
| `npm run provision:auto -- --env=production` | `ALLOW_AUTO_PROVISION` + `CONFIRM_PRODUCTION_DEPLOY` | yes (Phase 7) |

---

## Engine sequence

```
load env + agent config
build ProvisionPlan (all adapters, no side effects)
check global + environment gates
for each step:
  check step gate
  if gate missing → status: gate_missing (skip, report)
  if read-only → run verify()
  if mutating + adapter has apply() → run apply()
  if mutating + no apply() → status: not_implemented
write ProvisionLedger
write ProvisionReport
```

---

## Phase 6 limitations

- All real provider `apply()` implementations are `not_implemented`.
- `not_implemented` steps are Phase 7 scope.
- No real provider resources are created.
- The engine, gates, ledger, and reports are fully functional.

---

## Provision plan

```bash
# Local
npm run provision:plan

# Staging
npm run provision:plan -- --env=staging

# Production
npm run provision:plan -- --env=production
```

Plan output is written to `provision-reports/provision-plan-*.md`.

---

## Auto-provision (Phase 6: mock/read-only only)

```bash
# Staging
ALLOW_AUTO_PROVISION=true \
CONFIRM_STAGING_PROVISION=true \
npm run provision:auto -- --env=staging

# Production
ALLOW_AUTO_PROVISION=true \
CONFIRM_PRODUCTION_DEPLOY=true \
npm run provision:auto -- --env=production
```

Ledger: `provision-reports/provision-ledger.json`
Report: `provision-reports/provision-report-*.md`

---

## Provider verify

```bash
npm run provision:verify
npm run provision:verify -- --env=staging
```

---

## Rollback plan

```bash
npm run provision:rollback-plan
npm run provision:rollback-plan -- --env=staging
```

---

## Gate reference

| Gate | Required for |
|------|-------------|
| `ALLOW_AUTO_PROVISION=true` | Any `provision:auto` run |
| `CONFIRM_STAGING_PROVISION=true` | Staging `provision:auto` |
| `CONFIRM_PRODUCTION_DEPLOY=true` | Production `provision:auto` or any mutating production step |
| `ALLOW_GITHUB_PROVISION=true` | GitHub `create_repo` step |
| `ALLOW_SUPABASE_PROVISION=true` | Supabase `create_project`, `apply_migrations` steps |
| `ALLOW_CLOUDFLARE_PROVISION=true` | Cloudflare `set_secret`, `deploy_worker` steps |
| `ALLOW_TRIGGER_PROVISION=true` | Trigger.dev `register_task` step |
| `ALLOW_TELEGRAM_PROVISION=true` | Telegram `register_webhook` step |
| `ALLOW_OPENAI_VERIFY=true` | OpenAI `verify_model` step |

No gate is set to `true` by default.
