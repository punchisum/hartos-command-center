# Deployment

Phase 3 does not deploy resources.
Phase 4 adds provider wiring but still does not deploy resources automatically.

Before production:

1. Apply Supabase migrations in order.
2. Replace placeholder Supabase and Trigger implementations with live clients.
3. Register the Telegram webhook with `TELEGRAM_WEBHOOK_SECRET`.
4. Run `npm run check-env`, `npm run typecheck`, `npm test`, and smoke tests.
5. Prove final state with `docs/contracts/deployment-smoke.md`.

Cloudflare deployment is manual:

```bash
cp wrangler.toml.example wrangler.toml
# fill non-secret vars, then use wrangler secret put for secrets
# npm run build
# wrangler deploy
```
