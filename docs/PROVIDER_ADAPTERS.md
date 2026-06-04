# Provider Adapters: test-agent

Each provider has an adapter in `src/provisioning/adapters/`.

---

## Interface

```typescript
interface ProviderAdapter {
  readonly provider: ProviderName;
  plan(context: ProvisionContext): Promise<ProvisionStep[]>;
  verify(context: ProvisionContext): Promise<ProviderVerificationResult>;
  apply?(step: ProvisionStep, context: ProvisionContext): Promise<ProvisionStepResult>;
  rollback?(step: RollbackStep, context: ProvisionContext): Promise<ProvisionStepResult>;
}
```

`plan()` and `verify()` are always safe (no side effects).
`apply()` and `rollback()` are Phase 7 scope for real providers.

---

## Phase 6 adapter status

| Provider | plan() | verify() | apply() | rollback() |
|----------|--------|---------|---------|-----------|
| GitHub | ✓ stub | ✓ env check | Phase 7 | Phase 7 |
| Supabase | ✓ stub | ✓ env check | Phase 7 | Phase 7 |
| Cloudflare | ✓ stub | ✓ env check | Phase 7 | Phase 7 |
| Trigger.dev | ✓ stub | ✓ env check | Phase 7 | Phase 7 |
| Telegram | ✓ stub | ✓ env check | Phase 7 | Phase 7 |
| OpenAI | ✓ stub | ✓ env check | Phase 7 | Phase 7 |
| Mock | ✓ | ✓ always OK | ✓ safe mock | ✓ safe mock |

---

## Provider details

### GitHub (`src/provisioning/adapters/github.ts`)
- Required env: `GITHUB_TOKEN`, `GITHUB_ORG`
- Gate: `ALLOW_GITHUB_PROVISION=true`
- Steps: `create_repo`

### Supabase (`src/provisioning/adapters/supabase.ts`)
- Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Gate: `ALLOW_SUPABASE_PROVISION=true`
- Steps: `create_project`, `apply_migrations`, `run_smoke`
- Note: migrations are also managed by `npm run migrations:apply`

### Cloudflare (`src/provisioning/adapters/cloudflare.ts`)
- Required env: `CLOUDFLARE_WORKER_URL`
- Gate: `ALLOW_CLOUDFLARE_PROVISION=true`
- Steps: `set_secret`, `deploy_worker`, `run_smoke`
- Note: deploy is also managed by `npm run deploy:staging`

### Trigger.dev (`src/provisioning/adapters/trigger.ts`)
- Required env: `TRIGGER_SECRET_KEY`
- Gate: `ALLOW_TRIGGER_PROVISION=true`
- Steps: `register_task`, `run_smoke`

### Telegram (`src/provisioning/adapters/telegram.ts`)
- Required env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`
- Gate: `ALLOW_TELEGRAM_PROVISION=true`
- Steps: `register_webhook`, `run_smoke`
- Note: webhook is also managed by `npm run telegram:register-webhook`

### OpenAI (`src/provisioning/adapters/openai.ts`)
- Required env: `OPENAI_API_KEY`
- Gate: `ALLOW_OPENAI_VERIFY=true`
- Steps: `verify_model` (read-only)

### Mock (`src/provisioning/adapters/mock.ts`)
- Used in tests and as a fallback
- No real provider calls
- `apply()` marks steps as applied without side effects

---

## Adding a Phase 7 adapter

To implement real `apply()` for a provider:

1. Add the apply() method to the adapter class
2. Implement the real API call (no secrets in logs)
3. Return `ProvisionStepResult` with status `applied` on success
4. Return `failed` on error with a safe error message
5. Implement `rollback()` if the action is reversible
6. Add integration tests that mock the provider API

```typescript
async apply(step: ProvisionStep, context: ProvisionContext): Promise<ProvisionStepResult> {
  // Never log context.env values directly
  const url = context.env["SUPABASE_URL"];
  if (!url) throw new Error("SUPABASE_URL not configured");
  // ... real provider call
  return { step: { ...step, status: "applied" }, status: "applied", message: "...", timestamp: ... };
}
```
