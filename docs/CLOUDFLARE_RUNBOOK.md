# Cloudflare Runbook

Phase 4 includes `wrangler.toml.example` only.

Do not commit real account IDs, tokens, or secrets.

Manual deployment path:

```bash
cp wrangler.toml.example wrangler.toml
npm run build
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler deploy
```

Verify a deployed Worker:

```bash
CLOUDFLARE_WORKER_URL=https://your-worker.example.workers.dev npm run verify:cloudflare
```
