# Phase 9: Industrial Factory — test-agent

Phase 9 completes the industrial release control layer for HartOS agents.

---

## Complete command set (Phases 5-9)

### Deployment (Phase 5)
- `npm run migrations:plan` — plan pending migrations
- `npm run migrations:apply` — apply migrations (gated)
- `npm run deploy:staging` — deploy to staging (gated)
- `npm run deployment:check` — pre-deployment readiness

### Provisioning (Phase 6-7)
- `npm run provision:plan` — plan all providers
- `npm run provision:verify` — verify provider status
- `npm run provision:auto` — auto-provision (gated)
- `npm run provision:rollback-plan` — rollback instructions

### Staging Launch (Phase 8)
- `npm run launch:plan` — show launch plan (safe)
- `npm run launch:verify` — verify provider readiness (safe)
- `npm run launch:staging` — one-command staging launch
- `npm run launch:report` — show latest report

### Production Promotion (Phase 9)
- `npm run production:check` — pre-production readiness (safe)
- `npm run production:smoke` — production smoke (safe)
- `npm run release:compare` — compare releases (safe)
- `npm run observability:check` — check debug_events (safe)
- `npm run promote:production` — full production promotion (gated)
- `npm run launch:production` — alias for promote:production

---

## Promotion decision matrix

| Staging Status | promote:production |
|---------------|-------------------|
| `success` | ✅ Allowed |
| `partial` + `ALLOW_PARTIAL_STAGING_PROMOTION=true` | ✅ Allowed with override |
| `partial` (no override) | 🚫 Blocked |
| `blocked_*` or `failed` | 🚫 Blocked |
| No staging report | 🚫 Blocked |

---

## Never automated

These always require manual action:
- Supabase project creation
- Cloudflare secret upload
- Trigger.dev task registration (use CLI)
- Rollback execution (unless ALLOW_ROLLBACK_EXECUTION=true)

---

## Phase 10 candidates

1. GitHub Actions production promotion with manual approval gates
2. Supabase Management API project creation
3. Real Trigger.dev task registration via SDK
4. Automated rollback on failed smoke
5. Multi-environment promotion (dev → staging → production)
6. Slack/Telegram notifications on launch status
