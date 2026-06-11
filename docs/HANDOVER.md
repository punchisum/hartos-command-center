# Handover

Runtime skeleton and provider wiring generated.

Next steps:

1. Review `agent.yaml` command ownership and approval policy.
2. Implement Supabase client writes for `debug_events`, `command_events`, and `action_tokens`.
3. Apply Supabase migrations manually or through approved CI/CD.
4. Wire Cloudflare Worker deployment config from `wrangler.toml.example`.
5. Register Telegram webhook only after local and staging smoke tests pass.
6. Decide whether Trigger.dev SDK or HTTP enqueue should be wired in Phase 5.
7. Keep all real secrets outside the repo.

## 2026-06-11 — Audit & hardening pass

Full audit + hardening session (branch `claude/hartos-audit-hardening-mr2kcu`):

- **Telegram webhook hardened** (`src/telegram/webhook.ts`): constant-time secret
  comparison, fails closed in production when `TELEGRAM_WEBHOOK_SECRET` is unset,
  rejects malformed JSON with 400. Covered by `tests/telegram-webhook-auth.test.ts`.
- **Shared `safeEqual`** (`src/lib/safe-equal.ts`) now used by both the webhook
  and the cockpit auth gate.
- **LLM domain allowlist** (`src/llm/prompt-contracts.ts` `ALLOWED_DOMAINS`):
  provider output claiming a domain outside finance|fitness|ops|factory|general
  fails validation and falls back to the deterministic provider.
- **Secret heuristic fixed**: the generic long-token pattern in
  `src/beezulbub/pack-safety.ts` (and the matching test assertions) no longer
  treats `/` as token material, so legitimate paths/commands stop failing the
  safety scan. Specific patterns (sk-, JWT, ghp_, PEM) are unchanged.
- **check-env covers the hosted cockpit**: new `cockpit` provider in
  `src/runtime/env.ts` (access token + read-only read-model env vars).
- **Fixture restored**: `tests/fixtures/beezulbub/risky-repo/.env` (fake values)
  was being excluded by `.gitignore`; un-ignored via negation so the poison
  filter tests run. All 1175 tests green (5 were failing before this pass).
- **CI enabled**: `.github/workflows/ci.yml` runs typecheck, tests, verify,
  smoke:local, launch:plan, launch:verify on every push. `npm run verify:all`
  runs the same set locally.
- **`.env.example`**: duplicate `ALLOW_CLOUDFLARE_SECRET_UPLOAD` removed; Phase 16
  hosted cockpit vars documented.

Known live-infra follow-ups (not in this repo's code):
- The deployed `hartos-command-center` Worker bundle contains code newer than
  this repo (e.g. `FITNESS_DETAIL_RPCS` with `get_fitness_bodyweight_series`,
  absent from `FITNESS_ALLOWED_RPCS` in that bundle — that detail call is
  blocked by its own allowlist). Reconcile the deploy source with this repo.
- `gecan-ops-ai-webhook` accepts unauthenticated Telegram posts if its
  `TELEGRAM_WEBHOOK_SECRET` is unset — verify the secret is set on that Worker.
- APPLIED LIVE (2026-06-11): SECURITY DEFINER function grants hardened on
  both Supabase projects (PUBLIC revoked everywhere, service_role granted,
  anon kept only on the cockpit read RPCs + n8n's two RPCs, search_path
  pinned). SQL + rollback notes: `supabase/hardening/`.
- The hosted cockpit's ops read RPCs are returning 401 in live API logs —
  the Worker's `HARTOS_OPS_SUPABASE_READONLY_KEY` is missing or wrong.
  Re-set it with `wrangler secret put` (see backfill checklist).

## 2026-06-11 — CI staging deploy + live cockpit feeds

- CI now has a gated `deploy-staging` job: merged to the default branch =
  deployed to staging (opt-in via the `ENABLE_STAGING_DEPLOY` repo variable +
  GitHub Secrets; see docs/STAGING_DEPLOYMENT.md). Eliminates hand-deploys and
  the repo/deploy drift found in the audit.
- Hosted cockpit `/api/threads` and `/api/proposals` now serve LIVE read-only
  data from the fitness project's cockpit RPCs (get_cockpit_threads /
  get_cockpit_proposals, anon-granted, p_limit arg) when the Phase 16D fitness
  env is configured — with graceful fallback to the local-only responses.
  New module: src/runtime/cloudflare-live-cockpit-feeds.ts.
- `get_fitness_bodyweight_series` added to FITNESS_ALLOWED_RPCS (granted to
  anon in the fitness project; fixes the allowlist gap found in the deployed
  bundle).
