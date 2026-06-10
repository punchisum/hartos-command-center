# Deploying the HartOS Cockpit (single source of truth)

There is exactly ONE supported way to deploy the hosted cockpit Worker. Use it; ignore the others.

## The one true command

```sh
# from hartos-command-center/, with .env.local providing CLOUDFLARE_API_TOKEN (+ account id)
npm run build
npx wrangler deploy --config wrangler.cockpit.toml \
  --var BUILD_SHA:"$(git rev-parse --short HEAD)" \
  --var BUILD_TIME:"$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

- `--config wrangler.cockpit.toml` is REQUIRED — it is the only config that matches this Worker.
- The two `--var` flags stamp deploy provenance into `/health` (`version`, `builtAt`) and the
  Technical page diagnostics, so you can tell WHICH code is live. They're optional but recommended
  (omitting them just leaves `version: null`).

## Verify after deploy

```sh
curl -s https://hartos-command-center.hartos.workers.dev/health
# { "ok": true, "mode": "hosted", "actionExecution": "disabled", "version": "<sha>", "builtAt": "<iso>" }
```

Confirm `version` matches the SHA you deployed. Pre-flight gate (creds-free, run before deploying):

```sh
npm run cockpit:cloudflare:bundle-check   # build + wrangler dry-run; proves the bundle is Worker-safe
```

## Do NOT use these for the cockpit (divergent paths)

- **`npm run deploy:production` / `npm run deploy:staging`** → route through `scripts/promote.js` →
  `deploy-cloudflare.ts` → `wrangler deploy --env staging|production`. But `wrangler.cockpit.toml`
  has only a top-level `[vars]` block and **no `[env.*]` blocks**, so `--env` cannot match this
  Worker. These scripts are for the GENERATED-AGENT runtimes, not the cockpit.
- **`npm run cockpit:cloudflare:deploy`** → `scripts/cockpit-cloudflare-deploy.ts` is a GATED
  CHECKER/stub by design: it verifies the gates and prints the manual steps, but never invokes
  wrangler (deploy is a deliberate human action). Use it as a pre-flight, not as the deploy.

## Secrets (set once, persist across deploys)

```sh
wrangler secret put HARTOS_COCKPIT_ACCESS_TOKEN --config wrangler.cockpit.toml
wrangler secret put OPENAI_API_KEY --config wrangler.cockpit.toml
wrangler secret put HARTOS_OPS_SUPABASE_READONLY_KEY --config wrangler.cockpit.toml
wrangler secret put HARTOS_FITNESS_SUPABASE_READONLY_KEY --config wrangler.cockpit.toml
```

Use ONLY read-only anon keys for Supabase. Never put a service-role key on the Worker.

## Rollback

Cloudflare keeps prior versions. Roll back in the dashboard (Workers → hartos-command-center →
Deployments → roll back to a prior Version ID), or re-deploy a known-good commit with the command
above. The `/health` `version` tells you what's live before and after.
