# Supabase Runbook

Required env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Apply migrations in `supabase/migrations/` manually or through approved CI/CD.

Read-only smoke:

```bash
npm run smoke:supabase
```

Mutation smoke is opt-in:

```bash
ALLOW_LIVE_SMOKE_MUTATION=true npm run smoke:supabase
```
