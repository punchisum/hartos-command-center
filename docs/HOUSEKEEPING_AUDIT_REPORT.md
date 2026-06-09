# HartOS Housekeeping Audit Report — 2026-06-09

Scope: `hartos-command-center` (primary), cross-check `hartos-agent-factory`, `ops-agent-v2`, `hart-os-fitness-trigger`.

---

## Summary

| Category | Finding | Severity | Status |
|---|---|---|---|
| Secrets | `.env` / service-role keys never in Worker — confirmed | ✅ Clean | No action |
| Secrets | `supabase/.temp/` not gitignored | ⚠️ Low | **Fixed** |
| Docs | Stale handover docs untracked | ℹ️ Info | **Fixed** (gitignored) |
| Docs | `HARTOS_BLUEPRINT_V2.md` untracked | ℹ️ Info | Staged for commit |
| Security | CORS default-denied — confirmed | ✅ Clean | No action |
| Security | Kill-switch on all execution adapters — confirmed | ✅ Clean | No action |
| Security | ALLOW_EXEC_* flags default-OFF — confirmed | ✅ Clean | No action |
| Security | ClickUp token header-only, never logged — confirmed | ✅ Clean | No action |
| Logging | exec-audit `detail` = outcome.summary only (non-sensitive) | ✅ Clean | No action |
| Build | Factory coordinator + officiator + cockpit panel — local commit `dda578b` | ✅ Built | Awaiting push |
| Tests | 2100 pass / 0 fail post-audit | ✅ Green | No action |

---

## Findings Detail

### 1. `supabase/.temp/` not gitignored (FIXED)

Supabase CLI writes transient metadata to `supabase/.temp/` during `supabase db push` runs. This directory was untracked and would have appeared in `git status` noise — no secrets, but unnecessary. Added `supabase/.temp/` to `.gitignore`.

Applies to: `hartos-command-center` (fixed). `ops-agent-v2` has no `supabase/` directory at all (migrations-only pattern).

### 2. Stale handover docs (FIXED)

Three untracked files in `docs/`:
- `HANDOVER_2026-06-08_CDE-gaps-then-F.md`
- `HANDOVER_2026-06-08_audit-then-validate.md`

These are session-boundary handover notes generated during development. They carry no persistent value after the session and should not accumulate in git. Added `docs/HANDOVER_*.md` glob to `.gitignore`.

`HARTOS_BLUEPRINT_V2.md` is NOT a handover note — it is a live planning document authored 2026-06-06 and staged for commit with this patch.

### 3. Service-role keys — confirmed clean

Verified: `src/runtime/cloudflare-cockpit-worker.ts` uses only the anon/publishable key (`SUPABASE_URL` + `SUPABASE_ANON_KEY` env vars). The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is consumed only in the Node execution host (`src/cockpit/proposals/supabase-proposal-db.ts`, `writeProposal`), which is never bundled into the Worker. The Worker's `createCockpitWorkerContext` path does not import from the pg/supabase-proposal-db module.

### 4. CORS — confirmed default-denied

`src/runtime/cloudflare-security.ts` returns `null` from `getAllowedOrigin()` when no origins are configured, and all response helpers check for a non-null cors value before emitting the `Access-Control-Allow-Origin` header. Blank CORS = no header = same-origin only. No relaxation needed.

### 5. Kill-switch coverage — confirmed complete

All six execution runner files (`run-clickup-comment.ts`, `run-clickup-move.ts`, `run-refresh-sync.ts`, `run-archive-rejected.ts`, `run-reject-drafts.ts`, `run-mark-reviewed.ts`) derive `hasCapabilityToken` from environment variable presence. `runExecutionAdapter` fails closed when the token is absent. `HARTOS_EXECUTION_KILL_SWITCH=on` overrides at the top of every runner before any adapter code runs.

### 6. exec-audit console.log — confirmed safe

Every `writeAudit("event", detail)` call passes `outcome.summary` as `detail`. The summary strings are plain-language descriptions (e.g. "dry-run: would post comment to card …"). No token values, no key material, no proposal body content is included. Logging is framework-level trace only; the durable audit row is written separately by the proposal spine.

### 7. TLS warning in supabase-proposal-db.ts — acknowledged, not fixed

`src/cockpit/proposals/supabase-proposal-db.ts:46` emits a `console.warn` when no custom CA certificate is configured for the pg pool. This is correct defensive behavior (warning the operator that TLS is unverified). It fires once per pool instantiation, not per query. Left as-is — removing it would reduce operator visibility.

### 8. Factory coordinator — locally committed, awaiting push

Commit `dda578b` on branch `feat/agent-runtime-provision-18d` contains:
- `src/hartos/factory-coordinator.ts` — pure AgentJob lifecycle coordinator (Inbox → Interrogator → Compiler → Planner)
- `src/hartos/factory-officiator.ts` — auto-officiation from compiled manifest
- `src/runtime/views/factory-job-view.ts` — honest cockpit panel (empty until go-live wiring)
- `src/runtime/cloudflare-cockpit-worker.ts` — `/api/factory-job` route wired
- `src/runtime/cloudflare-cockpit-page.ts` — factory job panel in cockpit grid
- `tests/factory-coordinator.test.ts` — 7 tests, all green
- `tests/factory-officiator.test.ts` — 5 tests, all green

Push requires explicit Hart authorization.

---

## Repos Not Requiring Changes

| Repo | Status |
|---|---|
| `hartos-agent-factory` | 1462 tests pass, no untracked secrets, no gitignore gaps found |
| `ops-agent-v2` | No supabase/ dir, `.env` properly gitignored, migrations-only pattern |
| `hart-os-fitness-trigger` | Not audited in this pass (no active changes) |

---

## Post-Audit Test Results

```
# tests 2100
# pass 2100
# fail 0
```

TypeScript build: clean (0 errors).

---

*Audit conducted 2026-06-09. Changes: .gitignore (2 entries added), HOUSEKEEPING_AUDIT_REPORT.md (this file), HARTOS_BLUEPRINT_V2.md staged.*
