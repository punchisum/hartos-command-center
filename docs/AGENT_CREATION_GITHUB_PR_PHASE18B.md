# Phase 18B — Controlled GitHub PR Mode (first external mutation)

The first phase that mutates **real external state**, scoped to **GitHub only**: push the 18A-built
scaffold branch + open a PR against an **existing** repo. Everything is gated; with any gate closed it
returns **dry-run instructions** and touches nothing. Node CLI only — never reachable from the Worker.

## Scope (enforced)
- ✅ Add credentials for a one-shot push, push the generated branch, open a PR, write the PR URL to a local report.
- ❌ **No repo creation** (target must already exist → fail closed with instructions). ❌ No merge.
- ❌ No Supabase / Cloudflare / Telegram / Trigger. ❌ No provisioning. ❌ No deploy. ❌ No running the agent.

## Gates (ALL required; any missing → dry-run only)
| Gate / key | Purpose |
|---|---|
| `ALLOW_GITHUB_PUSH=true` | authorizes the branch push |
| `CONFIRM_GITHUB_PR=true` | second key — authorizes opening the PR |
| `HARTOS_GITHUB_TOKEN` | host env only; never logged, committed, or written to `.git/config` |
| `HARTOS_GITHUB_OWNER`, `HARTOS_GITHUB_REPO` | the existing target repo |
| `HARTOS_GITHUB_BASE_BRANCH` | optional, default `main` |
| `ALLOW_GITHUB_REMOTE_ROLLBACK=true` | (rollback only) enables automated close-PR + delete-branch |

Carried forward: proposal `approved_for_execution` (Key 1) and a built 18A scaffold
(`build-manifest.json` present). `executeProposal()` still throws; the proposal is **not** advanced to
executed/merged — opening a PR is recorded via audit (`github_pr_opened`) + a local report only.

## Flow
```
18A-built scaffold (files + build-manifest.json)
  + ALLOW_GITHUB_PUSH=true + CONFIRM_GITHUB_PR=true + token/owner/repo   ← npm run agent:scaffold-pr
  → fetch the EXISTING base branch (e.g. main) into a scratch prep repo
  → create the scaffold branch FROM base, lay the scaffold files on top, commit
    (shared history → PR-able; 18A's local branch is orphan-history and is NOT pushed as-is)
  → push the branch (one-shot authenticated URL; token never persisted to .git/config)
  → open PR (REST) against the base branch; capture PR URL/number
  → write github-pr-report.json; audit github_pr_opened
  (any gate closed → dry-run instructions; no fetch, no push, no PR, no network)
```

## Commands (Node host only)
- `agent:scaffold-pr -- --id=<id>` — gated push + PR (dry-run if gates closed).
- `agent:scaffold-pr-rollback -- --id=<id>` — manual instructions by default; gated auto close-PR + delete-branch.

## Rollback
- **Local:** `agent:scaffold-rollback` (18A) removes the workdir + `.pr` dir.
- **Remote (default):** prints manual steps — close the PR, `git push origin --delete <branch>`. No remote mutation.
- **Remote (gated):** with `ALLOW_GITHUB_REMOTE_ROLLBACK=true`, closes the PR (never merges) + deletes the remote branch.

## Architecture & safety
- `src/execution/github-pr.ts` — injectable `GitHubPrOps` (push / open / close PR / delete branch). The
  real impl (REST via `fetch` + a one-shot `git push`) is the ONLY network code and is reached only when
  gated. The token is scrubbed from any error output and never written to `.git/config`.
- `src/execution/run-github-pr.ts` — gate checks, dry-run default, report + audit, rollback.
- Tests mock `GitHubPrOps` and install a throwing `fetch` → **zero network**. A test asserts the hosted
  Worker does not import `src/execution`, and that this path references no provider/provisioning module.

## Next (later, separately gated)
- Merge the PR (human, in GitHub) — not automated here.
- Provider provisioning (Supabase/Cloudflare/Telegram/Trigger), one `ALLOW_*` gate at a time.
- Repo creation, if ever — its own phase.
