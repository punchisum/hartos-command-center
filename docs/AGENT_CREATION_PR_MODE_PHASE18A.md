# Phase 18A — Controlled Execution / PR Mode (local-only)

From a proposal Hart has **authorized for execution**, produce a **real, Factory-scaffolded agent
repo on a local git branch + commit + a PR-prep bundle** — with **no push, no GitHub API, no
network, and no provider mutation**. The actual push / repo-create / PR-open move to 18B behind
provider gates. Builds on 17C (architecture) and 17D (authorization + dry-run).

## Decisions baked in (approved 2026-06-05)
- **Local-git only, no push.** 18A does `git init` → branch → commit + generates a PR body & patch
  **locally**. It never pushes or calls the GitHub API; the `LocalGitOps` interface has **no push
  method** (mutation is architecturally impossible on this path). Push/repo-create/PR-open = 18B.
- **CC invokes Factory as a child process** (`HARTOS_FACTORY_PATH`): `resolve-agent-spec` (draft →
  AgentConfig) then `create-agent-project`. CC re-implements no config/scaffold logic, and Factory
  stays out of CC's Worker bundle. The call is dependency-injected so CC's tests run hermetically.

## Flow
```
approved_for_execution proposal (17C/17D, Key 1)
  + ALLOW_LOCAL_SCAFFOLD=true on the host (Key 2, LOCAL)            ← npm run agent:scaffold-build
  → write plan-level spec-draft.json
  → Factory: resolve-agent-spec (draft → AgentConfig) → create-agent-project (scaffold into workdir)
  → safety: no workdir escape, no ROOT real-secret files, secret-scan CC-authored + non-test files
  → local git: init → branch agent-scaffold/<agent>-<shortToken> → add → commit   (NO remote, NO push)
  → PR-prep bundle: PR_BODY.md + scaffold.patch + build-manifest.json (in a sibling .pr dir)
  → audit "local_scaffold_built"; proposal STAYS approved_for_execution (not advanced)
```

## Commands (Node host only)
- `ALLOW_LOCAL_SCAFFOLD=true npm run agent:scaffold-build -- --id=<id>` — build the local scaffold + PR bundle.
- `npm run agent:scaffold-rollback -- --spec=<specId>` — clean local delete (workdir + .pr dir).

## Boundaries (enforced + tested)
- ❌ No push, no GitHub API, no repo creation — the local-git interface has no push; remotes stay empty.
- ❌ No provider mutation — no provider adapter is imported on this path; `providerMutations: 0`.
- ❌ No network — tests install a `fetch` that throws and assert it is never called.
- ❌ No real-secret files at repo root (`.env`, `.dev.vars`, `*.local.json`, `.env.*.local`); generated
  files must stay inside the workdir; CC content-scans the files it authors + non-test generated files.
  **Factory owns test/fixture secret-hygiene** (its `validate-factory` secret-scans the whole template
  tree every build), so CC does not re-scan vetted template test fixtures.
- ❌ No execution — the proposal is **not** advanced to `executing`/`executed` (18B); `executeProposal()`
  still throws.
- ✅ Rollback is automated: nothing remote exists, so deleting the workdir + .pr dir is a clean undo.

## CC ↔ Factory boundary
- **Factory owns:** `AgentConfig` + `resolveAgentSpec` (draft → config), templates, scaffold generation,
  config/repo validation + template secret-hygiene. Holds no secrets.
- **CC owns:** proposals + lifecycle + gates, the executor orchestration, local git + PR-prep, audit,
  rollback. Holds host secrets (none are needed for 18A). Spawns Factory as a child process; consumes
  its file manifest. No shared module graph, no network between them.

## Next (gated, future)
- **18B** — open `ALLOW_GITHUB_PROVISION` / `ALLOW_GITHUB_PUSH` (then Supabase/Cloudflare/Telegram/Trigger),
  one provider at a time: push the branch + open the PR for real, then dry-run → apply → ledger → smoke →
  rollback-ready per provider. First phase to mutate real external state.
