# Phase 10: Bootstrap Auto-Provisioning — test-agent

Phase 10 adds a bootstrap layer that reduces repeated manual setup.

---

## Full getting-started flow (Phases 1-10)

```bash
# 1. Review the agent manifest
cat agent.yaml

# 2. Check what needs to be configured
npm run bootstrap:check

# 3. Plan all provisioning
npm run provision:plan
npm run launch:plan

# 4. Configure missing provider credentials (see .env.example)
# Set credentials in .env.local, wrangler secrets, etc.

# 5. Run bootstrap plan
npm run bootstrap:plan

# 6. Execute automated bootstrap steps
ALLOW_BOOTSTRAP_PROVISION=true \
CONFIRM_BOOTSTRAP_PROVISION=true \
npm run bootstrap:auto

# 7. Complete manual_required steps (follow the generated instructions)

# 8. Stage launch
npm run launch:staging

# 9. Verify and promote
npm run production:check
npm run promote:production
```

---

## What Phase 10 adds

| Command | Purpose |
|---------|---------|
| `bootstrap:check` | Full credential + gate status check |
| `bootstrap:plan` | Preview bootstrap plan |
| `bootstrap:auto` | Execute automated steps |
| `bootstrap:verify` | Verify bootstrap completion |

---

## Phase 11 candidates

1. Supabase project creation via Management API
2. Real Trigger.dev task deployment via SDK
3. Non-interactive Cloudflare secret upload
4. Multi-agent bootstrap coordination
5. Slack/Teams launch notifications
6. GitHub Actions automated staging deployment
