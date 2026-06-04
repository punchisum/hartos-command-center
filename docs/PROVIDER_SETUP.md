# Provider Setup

Phase 4 provides boundaries and checks only. It does not create provider resources.

Use `.env.example` as the key list. Keep real values in your local secret manager, Cloudflare secrets, Supabase dashboard, or CI/CD secrets.

Run:

```bash
npm run check:env
npm run provider:status
```

Scripts print `present` or `missing`; they do not print secret values.
