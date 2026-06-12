# HartOS Audit — 2026-06-12

**Method:** 5 parallel read-only auditors (capability inventory · truth-reporting surfaces · autonomy/execute path · deployment & flags · fitness-loop depth) + a git/deploy reconciliation. Companion to [HARTOS_BASELINE.md](HARTOS_BASELINE.md).

---

## Headline: the disease fooled the doctor
- **Auditor #1 (capability inventory)** concluded: *"NO THEATER DETECTED — the registry is honest about status."*
- **Auditor #2 (truth surfaces)** proved that registry status is **hand-authored and never re-checked**: `capabilities/capability-registry.json` has `status: "verified"` with `lastVerifiedAt: null` and `usedByAgents: []`; `GET /health` returns `ok: true` **always**, even if the Worker is crashing on every request.

Auditor #1 believed the asserted state — exactly what the cockpit, the memory index, and Hart have all been doing. **This is the single strongest argument for building the truth layer first:** without it, no one — human or AI — can trust any other claim the system makes.

## Scorecard vs. baseline

| Baseline target | Reality | Gap |
|---|---|---|
| Truth layer | ~30% real. Honest: Sentinel liveness, `/api/liveness`, Wolverine verdict, proposal hygiene. Asserted: registry status, v5 `fleetFitness%`, `statusReason` prose, capability-registry, `/health` ok. | Make status *computed*; make `/health` mean something. |
| Capabilities not agents | Sibling registry scaffold exists but is "absorbed code packs," asserts `verified` w/ null timestamp, `usedByAgents:[]`. | Repurpose into "things HartOS does," status computed. |
| Money = advisory | ✅ Tier 3, never auto-executes. | None. |
| Comms = advisory | ✅ Tier 3, never auto-executes. | None. |
| Fitness = autonomous | Most-real (~70%): real Apple Health→Supabase data, deterministic recovery verdict, 08:00 briefing, nightly persist. **Advisory only.** Lives in `hart-os-fitness-trigger` (Trigger.dev). | Build decision→mutation path so it acts + reports after. |
| Own-code = autonomous | One-click, gated by `HARTOS_ALLOW_CLAUDE_EXECUTE` + agent-build-gate. | Needs the climb before autonomy. |
| Approve→execute bulletproof | ~80%: fail-closed 6-condition gate, read-before-write verify, append-only audit, idempotency key. | No post-execution re-read; idempotency replay unenforced. |
| Rollback | ❌ Absent for mutations (only infra, instruction-only). | Build real undo — the gate before any autonomy. |

## Deployment reality (Phase 0)
- Branch `feat/agent-runtime-provision-18d` is **fully pushed** (work is backed up).
- The **deploy/default branch** `feat/cloudflare-hosted-command-center` is **~200 commits behind** — its tip *is* the merge-base `4775d99`. Default has **zero** commits 18d lacks; 18d has ~200 default lacks.
- ⇒ The live cockpit (v5, execution engine, etc.) can only be live via **manual `wrangler deploy` from local 18d**. The git branches **do not reflect what is live.**
- CI auto-deploy (`ci.yml:57`) fires only on push to default **AND** repo var `ENABLE_STAGING_DEPLOY=true`.
- No reliable external deployed-SHA signal (`/health` has `version=BUILD_SHA` but `ok` is hardcoded true).
- **Recommendation:** fast-forward default → 18d (clean FF, no conflicts) so branches reflect reality, after deciding `ENABLE_STAGING_DEPLOY`. **Needs Hart approval** (deploy-adjacent).

## Fitness loop (the "bulletproof first" reference)
Real data path: Apple Health → Trigger.dev → Supabase → read-only RPCs. Deterministic recovery verdict (HRV/RHR/sleep). 08:00 SGT morning briefing → Telegram. Nightly 22:00 persist. X4 adherence logging. **Advisory only** — computes advice, Hart acts manually. To reach autonomous + reports-after: decision→mutation RPCs (adjust plan/calories/defer), stale-data escalation, post-workout re-score.

## Sibling session ("hartOS capabilities")
Untracked work left in the tree: `capabilities/capability-registry.json`, `capabilities/provenance-ledger.json`, `packs/dashboard_layout/` (a Beezulbub "devour-a-repo" code pack). **Decision (approved):** fold the registry *schema* into the canonical capability model (Phase 1/2); do not clobber. Two meanings of "capability" to reconcile: *absorbed code-pack* (sibling) vs *user-facing function* (baseline).
