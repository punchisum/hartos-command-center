# test-agent

Scaffolded from HartOS Agent Factory v2.

## Start here

1. Review `agent.yaml` and replace any remaining placeholders before deploying.
2. Select matching state machines from `docs/state-machines/`.
3. Use `docs/contracts/` and `src/lib/` as implementation contracts.
4. Build Supabase migrations from `supabase/templates/`.
5. Prove final state with `docs/contracts/deployment-smoke.md`.

## Provider setup

Phase 4 provider wiring is scaffolded but never creates resources automatically.

1. Review `.env.example` and configure secrets outside the repo.
2. Run `npm run check:env` and `npm run provider:status`.
3. Follow `docs/PROVIDER_SETUP.md` and provider-specific runbooks.
4. Run `npm run smoke:local` before live smoke checks.
