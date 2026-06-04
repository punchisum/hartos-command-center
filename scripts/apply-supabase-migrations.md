# Apply Supabase Migrations

Phase 4 does not create Supabase projects or apply migrations automatically.

Apply these files manually or through your approved CI/CD path:

1. `supabase/migrations/000001_core.sql`
2. `supabase/migrations/000002_debug_events.sql`
3. `supabase/migrations/000003_action_tokens.sql`

Then run:

```bash
npm run smoke:supabase
```

Mutation smoke requires:

```bash
ALLOW_LIVE_SMOKE_MUTATION=true
```
