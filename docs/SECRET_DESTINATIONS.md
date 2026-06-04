# Secret Destinations: test-agent

Where each secret must be configured. Run `npm run bootstrap:check` to generate a personalized guide.

---

## Cloudflare Worker secrets (wrangler secret put)

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
wrangler secret put TELEGRAM_BOT_TOKEN --env staging
wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
wrangler secret put OPENAI_API_KEY --env staging
wrangler secret put TRIGGER_SECRET_KEY --env staging
```

Never commit these values. Run interactively (wrangler reads from your terminal).

---

## Local .env files (gitignored)

```bash
# .env.staging.local (gitignored)
SUPABASE_URL=https://your-project.supabase.co
CLOUDFLARE_WORKER_URL=https://your-worker.workers.dev
TRIGGER_PROJECT_ID=your-project-id
GITHUB_TOKEN=your-github-token
CLOUDFLARE_API_TOKEN=your-cloudflare-token
```

---

## CI/CD secrets (GitHub Actions)

For CI deployment, add to repo Settings → Secrets:
- `CLOUDFLARE_API_TOKEN`
- `SUPABASE_URL` (if public, can be a var instead)

See `.github/workflows/staging-checks.yml.example` for the template.
