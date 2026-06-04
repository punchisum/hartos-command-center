# Full Auto Mode: test-agent

Full-auto provisioning provisions all required infrastructure from a single command.

**Phase 6: engine + gates are implemented. Real provider mutations are Phase 7.**

---

## What full-auto does (Phase 7 target)

```
1. Read agent.yaml + env profile
2. Discover all required providers
3. Build ProvisionPlan (listing every step)
4. Print plan for review
5. Check all gates
6. For each step, in order:
   a. Check step gate
   b. If gate open AND adapter has apply() → apply
   c. If gate missing → skip (gate_missing)
   d. If not implemented → skip (not_implemented)
7. Verify each applied step
8. Write ProvisionLedger
9. Write ProvisionReport
10. Print rollback plan instructions
```

---

## Phase 6 actual behavior

Running `provision:auto` in Phase 6:

1. Checks `ALLOW_AUTO_PROVISION` and environment gate
2. Builds the full plan (same as Phase 7)
3. For each step:
   - Read-only steps → run verify() → status: verified
   - Mutating steps with gate → status: **not_implemented** (Phase 7)
   - Mutating steps without gate → status: gate_missing
4. Writes ledger + report
5. Never calls real provider APIs

---

## Full staging provision (Phase 7 preview)

```bash
ALLOW_AUTO_PROVISION=true \
CONFIRM_STAGING_PROVISION=true \
ALLOW_GITHUB_PROVISION=true \
ALLOW_SUPABASE_PROVISION=true \
ALLOW_CLOUDFLARE_PROVISION=true \
ALLOW_TRIGGER_PROVISION=true \
ALLOW_TELEGRAM_PROVISION=true \
npm run provision:auto -- --env=staging
```

Expected Phase 7 outcome:
- GitHub repo exists
- Supabase project exists, migrations applied
- Cloudflare Worker deployed
- Telegram webhook registered
- Trigger tasks registered
- Ledger + report written

---

## Full production provision (Phase 7 preview)

```bash
ALLOW_AUTO_PROVISION=true \
CONFIRM_PRODUCTION_DEPLOY=true \
ALLOW_SUPABASE_PROVISION=true \
ALLOW_CLOUDFLARE_PROVISION=true \
ALLOW_TRIGGER_PROVISION=true \
ALLOW_TELEGRAM_PROVISION=true \
npm run provision:auto -- --env=production
```

**Never run full production auto-provision without reviewing the staging provision first.**

---

## Incremental provisioning

You can open only the gates you need:

```bash
# Only apply migrations
ALLOW_AUTO_PROVISION=true \
CONFIRM_STAGING_PROVISION=true \
ALLOW_SUPABASE_PROVISION=true \
npm run provision:auto -- --env=staging
```

All other provider steps will show `gate_missing` and be skipped safely.

---

## Phase 7 gaps

1. GitHub `create_repo` apply()
2. Supabase `create_project` and `apply_migrations` apply()
3. Cloudflare `set_secret` and `deploy_worker` apply()
4. Trigger.dev `register_task` apply()
5. Telegram `register_webhook` apply()
6. OpenAI `verify_model` apply() (real API ping)
7. Rollback execution (rollback() on adapters)
