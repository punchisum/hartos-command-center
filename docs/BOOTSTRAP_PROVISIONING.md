# Bootstrap Provisioning: test-agent

Phase 10 adds a bootstrap layer to help you configure all providers from scratch.

---

## Bootstrap commands

| Command | Purpose |
|---------|---------|
| `npm run bootstrap:check` | Check credential coverage + secret destinations |
| `npm run bootstrap:plan` | Show bootstrap plan (no mutations) |
| `npm run bootstrap:auto` | Execute automated bootstrap steps (gated) |
| `npm run bootstrap:verify` | Verify bootstrap state |

---

## Bootstrap flow

```
1. npm run bootstrap:check    → understand what's missing
2. Configure env vars (see .env.example)
3. npm run bootstrap:plan     → review what would happen
4. Set wrangler secrets manually (manual_required)
5. npm run bootstrap:auto     → execute what can be automated
6. npm run bootstrap:verify   → confirm state
7. npm run launch:staging     → one-command staging launch
```

---

## What's automated vs manual

| Step | Status |
|------|--------|
| GitHub repo creation | ✓ Automated (ALLOW_GITHUB_PROVISION=true) |
| Supabase project creation | ⚒ Manual (dashboard) |
| Supabase migrations | ✓ Automated (ALLOW_SUPABASE_MIGRATION_APPLY=true) |
| Cloudflare secret upload | ⚒ Manual (wrangler secret put) |
| Cloudflare deploy | ✓ Automated (ALLOW_CLOUDFLARE_DEPLOY=true) |
| Telegram webhook | ✓ Automated (ALLOW_TELEGRAM_WEBHOOK_REGISTER=true) |
| Trigger.dev tasks | ⚒ Manual (npx trigger.dev@latest deploy) |

---

## Bootstrap gates

```bash
ALLOW_BOOTSTRAP_PROVISION=true
CONFIRM_BOOTSTRAP_PROVISION=true
```

Plus per-step gates (see .env.example).
