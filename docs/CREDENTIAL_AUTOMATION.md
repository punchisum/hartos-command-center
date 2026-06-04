# Credential Automation: test-agent

What credentials the factory can configure automatically vs what requires manual action.

---

## Principle

The factory never creates provider accounts from nothing. You must:
1. Create provider accounts manually
2. Obtain bootstrap tokens/keys
3. Store them locally (gitignored)
4. Let the factory handle repeated provisioning

---

## Manual once (you do this)

| Credential | Source |
|-----------|--------|
| GitHub account | github.com |
| GitHub token | github.com/settings/tokens |
| Supabase account | supabase.com |
| Cloudflare account | dash.cloudflare.com |
| Cloudflare API token | dash.cloudflare.com/profile/api-tokens |
| Telegram bot | BotFather (@BotFather) |
| OpenAI API key | platform.openai.com |
| Trigger.dev account | trigger.dev |

---

## Factory handles repeatedly

| Task | Gate |
|------|------|
| GitHub repo creation | ALLOW_GITHUB_PROVISION=true |
| Supabase migrations | ALLOW_SUPABASE_MIGRATION_APPLY=true |
| Cloudflare deploy | ALLOW_CLOUDFLARE_DEPLOY=true |
| Telegram webhook | ALLOW_TELEGRAM_WEBHOOK_REGISTER=true |
| Launch orchestration | ALLOW_AUTO_PROVISION=true |

---

## Never automated (security reasons)

- Supabase project creation (use dashboard)
- Cloudflare secret upload (interactive terminal)
- Trigger task registration (requires CLI deploy)
