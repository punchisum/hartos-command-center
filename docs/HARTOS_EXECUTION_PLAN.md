# HartOS Hardening Plan — Consolidated, Execution-Ready

**Date:** 2026-06-12 · **Companion to** [HARTOS_BASELINE.md](HARTOS_BASELINE.md) + [HARTOS_AUDIT_2026-06-12.md](HARTOS_AUDIT_2026-06-12.md) · **Produced by** a 9-agent workflow (7 per-phase code-grounded planners → adversarial completeness critic → synthesis); all critique claims verified against the working tree on 2026-06-12.

> Doctrine: *Hands inside the fence, advice outside it.* Definition of done: **observable as live in the truth layer**, not "tests pass locally."

---

## 1. Overview & through-line

The trust ladder has one ordering; you climb it rung by rung, no skipping:

```
truth layer → capability census → approve→execute hardening → rollback → autonomous fitness (hands) → autonomous self-mod (summit)
   P1              P2                     P3                      P4             P5                            P6
```

The disease is **asserted status** (hand-authored `meta-agent-registry` status, `fleetFitness%` from counts not liveness, `capability-registry.json` with `status:"verified"` + `lastVerifiedAt:null`). Everything inherits credibility from the truth layer, so it is built **first** and every later phase reports *into* it. Self-mod is last because it is the only rung where a mistake can leave the fence (it edits the code that enforces the fence) — and because the doctrine itself currently *forbids* it.

**Two structural realities the first-pass plans got wrong (now corrected throughout):**

- **There is no `src/launch/daemon.ts`.** The runner (the hands) is `src/jobs/live-runner.ts` (entrypoints `dist/scripts/hartos-runner.js` / `run-live-runner.js`; npm `hartos:runner` / `live:runner`). Every "wire into the daemon" task points here.
- **The doctrine hard-caps execution closed and CI enforces it.** `src/doctrine/doctrine.ts:104-114` fails its invariant if `ACTION_EXECUTION !== "disabled"` or if `executionAllowed()` returns `true` under a forced flag, and `tests/doctrine-conformance.test.ts` fails CI on violation. **There are TWO separate gates:** (a) `executeProposal`/`executionAllowed` — the hard-capped, conformance-guarded path; (b) `executeApprovedProposals` → `dispatchMutation`, gated by per-adapter `ALLOW_EXEC_*` flags + `src/doctrine/execution-gate.ts` — the path that actually runs ClickUp/refresh-sync today. **P5 and P6 ride path (b) and must never flip path (a) to non-disabled.** (First-class workstream W2.)

Other corrected facts: Beezulbub is the directory `src/beezulbub/` (~40 files), not a single agent file; no `src/routes/` (the `/api/v5` route lives in `src/runtime/cloudflare-cockpit-worker.ts`); `ProposalDomain = "fitness" | "ops" | "factory" | "system" | "research"` (no `tax`/`clickup` — ClickUp is `ops`); two idempotency modules exist (`src/lib/idempotency-key.ts` and `src/lib/idempotency.ts`) and must be reconciled; `computeNutritionModifier` lives inside `src/lib/recovery-verdict.ts`; wired adapters include `mark-reviewed` and `clickup-comment`; the JSON capability registry is already the serialized output of the canonical `CapabilityEntry` interface in `src/beezulbub/capability-registry.ts`, so "fold the schema" is largely a no-op — the real work is making `status` **computed**.

---

## 2. Sequencing & cross-phase dependencies

```
W1 git/deploy reconcile (Phase 0)
   └─> P1 truth layer ──> P2 capability census (P1 READS the registry; P2 OWNS the fold — never both edit it)
                            └─> W2 gate reconciliation (NEW: pin the two-gate model, merge idempotency modules)
                                  └─> P3 post-exec verification ──┐
                                  └─> P4 rollback ────────────────┴─> (P3 lands first; P4 extends its audit/lifecycle union)
                                        └─> P5 autonomous fitness (rides ALLOW_EXEC path, NOT executionAllowed)
                                              └─> W3 claude-execute hardening (NEW: the REAL P6 prerequisite)
                                                    └─> P6 self-mod (summit) — needs a Constitutional Amendment that
                                                         explicitly REPLACES the doctrine execution-disabled invariant
```

Dependency rules that resolve the ordering bugs:
1. **Capability-registry fold happens exactly ONCE, in P2.** P1 only *reads* `capabilities/capability-registry.json`.
2. **`statusReason` is NOT deleted.** It is demoted to an optional `expectationNote` documenting intent, while a new **computed** `status`/`statusReason` are produced by the truth layer. Both coexist — expectation vs reality is the whole point.
3. **P3 lands before P4.** P3 defines the `execution_verification` audit shape; P4's rollback statuses extend the same `ProposalQueueStatus` union and read P3's rows. Migrations use full 14-digit timestamps after the existing `…120000`/`…130000`.
4. **W2 sits between P1 and P5** — pins the two-gate model + merges the two idempotency modules before P3 hardens replay.
5. **P6's true prerequisite is W3 (a hardened `claude.execute` path), not P5.**

---

## Workstream W1 — Phase 0: Git / deploy reconciliation & deployed-SHA signal

**Goal:** make "live" == a known commit SHA; reconcile work branch with deploy branch; preserve untracked sibling work; no auto-deploy.

- **0a — recompute divergence + clean state.** `git fetch --all`; commit the two pending regression-test files (`src/cockpit/suggestions/suggestion-to-mutation.ts`, `tests/approved-executor.test.ts` — real regression tests for the 2026-06-10 payload-shape bug). *(Note: the branch fast-forward of `feat/cloudflare-hosted-command-center` → HEAD `8e56804` was already done 2026-06-12; default now equals the work branch.)*
- **0b — preserve untracked sibling work.** `.gitignore` (with comments): `capabilities/`, `packs/`, `cockpit-v4-live.html`, `scripts/render-v4-preview.mjs`, `scripts/run-memory-heartbeat.cmd`. **Exception:** `capabilities/capability-registry.json` + `provenance-ledger.json` are folded canonically in P2 — `git stash --include-untracked` before any rebase; do not lose them.
- **0c — deployed-SHA surface (corrected mechanism).** Drop the self-contradictory `deploy-manifest.json` idea (a file can't be both committed and gitignored, and the Worker serves no filesystem at request time). **Correct:** inject `BUILD_SHA` + `BUILD_TIME` as Worker **vars** at deploy — update `scripts/deploy-cloudflare.ts` to pass `--var BUILD_SHA:$(git rev-parse --short HEAD) --var BUILD_TIME:...`. `GET /health` already reads these env vars; they are simply never injected today.

**Tests:** clean `git status`; `wrangler deploy --dry-run --var BUILD_SHA:...` succeeds; **`smoke:staging` asserts `/health.version == git rev-parse --short HEAD`** (the deployed-SHA verification); sibling work restorable from stash.

**Acceptance:** after a manual deploy from the reconciled branch, `GET /health` returns a non-null `version` equal to a known commit SHA, proven by `smoke:staging`. **Effort:** 0.5–1 day.

---

## Phase 1 — Truth layer (single source of truth)

**Goal:** every human-visible status is **computed from the same evidence the system runs on**, never asserted. Extend Sentinel's honest pattern (`src/sentinel/sentinel-liveness.ts`) to all capabilities.

- **1.1** new `src/sentinel/evidence-model.ts` — per-source "last successful run" schema (Worker request ts; Supabase RPC snapshot + freshness; local-runner / Trigger.dev status; cron log). ISO only; future timestamps → `unknown`.
- **1.2** new `src/sentinel/heartbeat-gatherer.ts`; extend `sentinel-liveness.ts` (today only cockpit/fitness/ops). Local-runner source may stub `[]` until W3/P5 — documented gap, never silently "up".
- **1.3** `src/agents/meta-agent-registry.ts` becomes **catalog only**: add `evidenceSourceId`, `expectedFreshnessHours`; **demote** ~25 hand-authored `status`/`statusReason` entries to optional `expectationNote` (do not delete).
- **1.4** new `src/truth-layer/truth-layer-api.ts` — pure `computeFleetVerdict({ evidenceBySource, registry, now })`. Catalog/verdict split (no cycle).
- **1.5** `GET /health` (`cloudflare-cockpit-worker.ts:276-288`) → `{ ok, version, builtAt, fleetVerdict, computedAt, capabilities }`.
- **1.6** v5 `fleetFitness%` (`cloudflare-cockpit-v5.ts:308-343`) from the truth layer, not agent counts.
- **1.7** `GET /api/liveness` → computed verdicts + evidence refs.
- **1.8** `src/cockpit/status-split.ts` groups derive from evidence.
- **1.9** new `src/truth-layer/truth-layer-persist.ts` — append-only `cockpit_truth_snapshots`.

**Tests (`tests/truth-layer.test.ts`):** status-shown == computed-from-evidence; **absence of evidence == `unknown`, never up**; stale threshold (26h) honored; v5 `healthPct` never diverges from verdict; `/health` and `/api/liveness` agree at one timestamp; every registry agent has a mapped evidence source or explicit `no_assessment`.

**Acceptance:** deployed `/health` + `/api/liveness` return evidence-derived verdicts; `meta-agent-registry` has no authoritative status (only `expectationNote`); invariant suite green. **Effort:** 4–5 days.

---

## Phase 2 — Capability census (OWNS the fold)

**Goal:** ONE canonical capability model; status **computed** from P1 evidence; prune theater.

- **2.1** Don't redesign the schema — `CapabilityEntry` in `src/beezulbub/capability-registry.ts` is already canonical. Rework `loadRegistry`/`saveRegistry`/`registerPackGenerated` so `status` is a function of P1 evidence, `usedByAgents` derived from `meta-agent-registry` cross-ref, `lastVerifiedAt` from last successful-run evidence.
- **2.2** Census every agent + pack (`packs/*/pack.manifest.json`) + capability signature (`src/beezulbub/capability-extractor.ts`); classify REAL / EXPERIMENTAL / THEATER with citations; wire each to P1, Wolverine, execution-gate audit.
- **2.3** Fold sibling JSON into the computed-status behavior (no duplicate, no clobber); preserve provenance in `src/beezulbub/provenance-ledger.ts`.
- **2.4** Reconcile the two meanings: `PackCapability` (provenance) vs `AgentCapability` (`readOnly`/`proposal`/`execution`); a pack may be *promoted*. Distinct types, one registry.
- **2.5** Prune policy: REAL stays; EXPERIMENTAL → REFERENCE_ONLY; THEATER → DELETE (Hart-approved). `dashboard_layout` (`verified` + `lastVerifiedAt:null` + `usedByAgents:[]`) is the canonical THEATER candidate.
- **2.6** CI gate `verify:capabilities` (path-scoped) — fails if `status==verified ∧ lastVerifiedAt==null`, or `lastSuccessfulRun > threshold`.
- **2.7** Fitness as the REAL gold standard (Apple Health → Supabase → `fitness-read-model.ts`).

**Tests:** computed status + derived fields; census covers all; gate **specifically fails on `dashboard_layout`'s null case**; fitness REAL with `lastSuccessfulRun ≤ 24h`. **Effort:** 5–7 days.

---

## Workstream W2 — Gate reconciliation (between P1 and P5)

- **W2.1** Pin the two-gate model in docs + conformance test: `executeProposal`/`executionAllowed` stays **permanently hard-capped disabled** (CI-guarded); the live path is `executeApprovedProposals`→`dispatchMutation` gated by `execution-gate.ts` + `ALLOW_EXEC_*`. Assert no PR moves a capability from path (b) to path (a).
- **W2.2** Merge the two idempotency modules: keep `src/lib/idempotency-key.ts` (has batch-duplicate detection), port unique logic from `src/lib/idempotency.ts`, delete the latter, update importers. **Must land before P3's replay detector.**

**Effort:** 1–1.5 days.

---

## Phase 3 — Harden approve→execute (post-exec re-read + replay)

**Goal:** prove mutations *landed* + enforce replay. **Scoped honestly:** `approved-executor.ts:165` already records `executed` vs `no_write` from `res.delta`, and refresh-sync already re-reads its row before write. The gap: "wrote" means "adapter returned a delta," not "a fresh re-read confirms the external system changed." P3 closes that.

- **3.1** new `src/execution/execution-verification.ts` (pure types).
- **3.2** new per-adapter verifiers `clickup-move-verify.ts`, `clickup-comment-verify.ts`, `refresh-sync-verify.ts` (store injected): move → `card.status==toStatus`; comment → idempotency marker present; refresh-sync → stale count decreased.
- **3.3** `src/execution/execution-dispatch.ts` — after a non-null delta, call adapter verify; **coordinate with refresh-sync's existing read** (no double-read/race).
- **3.4–3.6** post-exec verify inside `run-clickup-move.ts`, `run-clickup-comment.ts`, `run-refresh-sync.ts`.
- **3.7** new `src/execution/idempotency-replay.ts` + `approved-executor.ts` — pre-execute, skip if key already `executed ∧ landed`; uses the **single** W2 module.
- **3.8** new migration `supabase/migrations/20260612140000_execution_verification.sql` (full timestamp) — `execution_verification` event on append-only `cockpit_proposal_audit` + index.
- **3.9–3.11** audit-event builder; `state-delta.ts` `verificationOutcome`; surface `landed`/`unverified`/`failed_verification` in Mutation Center + truth layer.

**Tests:** per-adapter landed-vs-failed; replay skips + returns cached; same-batch dupes caught pre-dispatch; **verify never crashes open** (read error → `landed=false`, logged); **post-exec verify and refresh-sync's read don't double-count/race**. **Acceptance:** all three adapters verify; failures recorded with snapshots + surfaced; no change to `execution-gate.ts` (additive only). **Effort:** 4–5 days.

---

## Phase 4 — Rollback (ladder rung 3)

**Goal:** real, data-driven, Hart-approved rollback for executed mutations; capture inverse ops at execution time; fail-closed gate; append-only audit. Reconcile with `src/launch/rollback-execution.ts` (infra-only) — the new `src/cockpit/rollback/` + `src/execution/rollback-*` are the *proposal-mutation* subsystem; distinct, documented.

- **4.1** `src/execution/execution-adapter.ts` — `ExecutionOutcome` + reversibility metadata + inverse payload.
- **4.2** `proposal-types.ts` (`ProposalQueueStatus` ~147) — add `rollback_pending_approval → … → rollback_executed | rollback_failed`. Migration `…20260612150000_rollback_proposals.sql` (after P3's `…140000`).
- **4.3** new `src/doctrine/rollback-gate.ts` — mirror `execution-gate.ts`; refuse unless audit proves original execution succeeded AND live target == original `outcome.after`.
- **4.4** add `rollback()` to **all wired adapters** (including the two the first plan missed): `clickup-move-status.ts`, `clickup-comment.ts`, `refresh-sync.ts`, `reject-drafts.ts`, `archive-rejected.ts`, **`mark-reviewed.ts`** + new `rollback-adapter.ts`.
- **4.5–4.10** rollback-proposal generator; rollback-executor (mirrors approved-executor, dispatches via rollback-gate); capture rollback metadata at execution time; Mutation Center "Rollback" action on `executed`; reversals in audit chain; `irreversible-handler.ts` (refuse + compensating-action guidance).

**Tests:** reversibility flag + complete `outcome.after`; gate refuses on live-state mismatch; ClickUp move-back validated against `APPROVED_CLICKUP_TRANSITIONS` reversed; **rollback never auto-executes** (Hart approves each). **Effort:** 5–7 days.

---

## Phase 5 — Autonomous fitness (first hands inside the fence)

**Goal:** decision→mutation path for fitness; deterministic rules (never LLM); rides the **`ALLOW_EXEC`/`dispatchMutation` path**, never `executionAllowed`. Blast radius = Hart's fitness only.

**Corrections folded in:** `decide()` returns a `ConciergeDecision`, not a `ProposalQueueItem`; `baseTierFor()` already maps fitness mutation actions to Tier 1 — **the missing piece is the materialization layer** `ConciergeDecision → ProposalQueueItem` (T5.2 re-scoped to build that, not re-edit the classifier). Fitness payloads use domain `"fitness"`. `computeNutritionModifier` is inside `recovery-verdict.ts`. **The cross-repo transport has no owner today** — assign it: the **local runner (`src/jobs/live-runner.ts`)** owns the Pull poller (`get_pending_mutations` RPC → ingest into `ProposalQueueItem`).

- **5.1** Fitness-project RPCs: `set_fitness_training_plan_adjustment`, `set_fitness_calorie_adjustment`, `escalate_stale_sync`, `get_pending_mutations` (idempotent upsert on `state_date + recovery_band + mutation_type`).
- **5.2** (re-scoped) materialization layer `ConciergeDecision → ProposalQueueItem`. Do **not** edit `baseTierFor()`.
- **5.3** fitness payload `{ state_date, recovery_band, recovery_score, old_value, new_value, reason (from verdict.reason, ≤300 chars, never LLM), idempotency_key }`.
- **5.4** wire through `execution-gate.ts` + `cloudflare-security.ts`: `approved_for_execution`, token, audit, `actionAllowlisted` (`HARTOS_ALLOW_FITNESS_ADJUST`, default OFF), `liveStatusVerified`.
- **5.5–5.10** Trigger.dev task `apply-recovery-verdict`; `fitness-adjustment-rules.ts` (hardcoded constants); `fitness_mutation_audit` table; `fitness-mutations.ts` wrapper; command-center `fitness-mutation-adapter.ts` (mirrors `clickup-move-status.ts`, into `dispatchMutation` union); morning-briefing async-spawns the task.
- **5.11** Pull poller owned by `live-runner.ts`.
- **5.12** stale >24h → `escalate_stale_sync` → Tier 2 one-click, never auto-mutate.
- **5.13–5.17** rollback via Phase 4 gate (guard undo→re-propose loops via `reversed_by_state_date`); deterministic Telegram "reports-after"; idempotency via the single W2 module; post-workout re-score (distinct `mutation_type`); `HARTOS_ALLOW_FITNESS_ADJUST` flag.

**Tests:** deterministic verdict + rules; create→approve→execute via `dispatchMutation`; **gate denies when flag OFF**; >24h escalation = Tier 2; **end-to-end cross-repo test that a fitness row links to a command-center `ProposalQueueItem`** (the lost-mutation gap). **Acceptance:** flag ON → mutation appears in both audits, surfaces in truth layer, reports via Telegram, observed on the deployed surface. No `executionAllowed` change. **Effort:** 8–10 days.

---

## Workstream W3 — Harden the `claude.execute` path (the real P6 prerequisite)

Harden `src/jobs/agent-job.ts` (`claude.execute` kind, armed by `HARTOS_ALLOW_CLAUDE_EXECUTE`, git-reversible, code-edit tools only) + `src/execution/claude-task-executor.ts`: bound the subprocess, capture git baseline, enforce code-edit-only tool scope, audit the run. P6's guards wrap this. **Effort:** 2–3 days.

---

## Phase 6 — Autonomous self-mod (the summit)

**Goal:** guardrailed own-code modification within a **Constitutional Amendment** that explicitly **replaces** the doctrine's execution-disabled invariant — it does not bypass it.

**The blocker, plainly:** `src/doctrine/doctrine.ts:104-114` + `tests/doctrine-conformance.test.ts` fail CI if `ACTION_EXECUTION !== "disabled"` or if `executionAllowed()` is ever `true`. P6 cannot reach "Tier 1 auto-run" by flipping a flag. **The amendment must rewrite the invariant itself** — from "execution is impossible" to "execution is impossible *except* through the amendment-gated, scope-bounded, pre/post-verified, rollback-captured self-mod path" — and the conformance test is amended **in the same PR** to assert the new fail-closed default (armed=false unless amendment approved AND class flag AND kill-switch off).

**Corrected targets:** daemon wiring → `src/jobs/live-runner.ts`; Beezulbub intent → a file under `src/beezulbub/`; amendment panel → `cloudflare-cockpit-worker.ts` (`/api/v5`); amendment doc → **create** `docs/CONSTITUTION.md`.

- **6.1** `docs/CONSTITUTION.md` + `doctrine.ts` — Amendment §6 + replacement invariant.
- **6.2** `src/execution/self-mod-scope-guard.ts` — allowlist + fail-closed denylist (own runtime + doctrine; never mutation adapters, secrets, external integrations).
- **6.3** `self-mod-pre-verify.ts` — re-read baseline (git, Sentinel, Wolverine) + capture rollback point.
- **6.4** `self-mod-post-verify.ts` — in-scope diff only, no secret leak, doctrine holds, tests pass; failure → rollback.
- **6.5** `self-mod-rollback.ts` (`git stash` + baseline + conditional `git checkout`).
- **6.6** `self-mod-executor.ts` — amendment-gate → pre-verify → scope-check → **wrap W3's executor** → post-verify → rollback-on-fail; audit each stage.
- **6.7** `src/doctrine/amendment-gate.ts` — pure: armed iff amendment approved AND class flag AND kill-switch off.
- **6.8** `self-mod-fix.ts` adapter + add `"self-mod-fix"` to `AUTOHEAL_ELIGIBLE_ADAPTER_IDS`.
- **6.9–6.19** decision-engine recognizes self-mod intents (gated); `"self-mod"` `ProposalDomain`; Wolverine `self-mod-drift` detector; integration test (rollback on out-of-scope / secret leak / doctrine break / test fail); kill-switch blocks Tier 1; `/api/v5` amendment panel; `live-runner.ts` routes approved self-mod proposals; **conformance test asserts the new amendment-gated invariant fails closed by default.**

**Effort:** 40–60 hours.

---

## 4. First three PRs (start immediately)

1. **PR-1 — git/deploy reconcile + deployed-SHA signal (W1 / Phase 0).** Commit the two pending regression-test files; `.gitignore` sibling artifacts; inject `--var BUILD_SHA/BUILD_TIME` in `scripts/deploy-cloudflare.ts`; add the `smoke:staging` assertion `/health.version == git rev-parse --short HEAD`. *Unblocks "live == known SHA," which every later acceptance needs.* Lowest risk.
2. **PR-2 — truth-layer evidence model + read API (P1.1, 1.4, 1.5, 1.9 + tests).** Pure `evidence-model.ts` + `truth-layer-api.ts` + `/health` extension + invariant test. Demote `meta-agent-registry` status to `expectationNote` in the same PR (the contract change everything downstream depends on).
3. **PR-3 — gate reconciliation (W2).** Document + conformance-test the two-gate boundary; merge `idempotency.ts` into `idempotency-key.ts`. *Must precede P3/P5.*

---

## 5. Human-approval gates (per doctrine)

| Action | Gate |
|---|---|
| **Push** any branch to origin | HART-APPROVAL |
| **Merge** work ↔ deploy branch | HART-APPROVAL (after dry-run) |
| **Deploy** (manual `wrangler deploy`) | HART-APPROVAL |
| **Run a DB migration** (P3 `…140000`, P4 `…150000`, P5 fitness tables) | HART-APPROVAL (append-only ≠ unattended) |
| **Flip `HARTOS_ALLOW_FITNESS_ADJUST` ON** | HART-APPROVAL + auto Telegram notice on first Tier-1 action |
| **Flip `HARTOS_ALLOW_CLAUDE_EXECUTE` ON** | HART-APPROVAL (W3) |
| **Approve Constitutional Amendment §6** | HART-APPROVAL (formal, written); amendment replaces the invariant + conformance test amended same PR |
| **Arm self-mod class flag** | HART-APPROVAL (second, distinct opt-in) |
| **Per self-mod / per rollback execution** | HART-APPROVAL each time |

**Standing floors (never lift without the amendment):** `executeProposal`/`executionAllowed` stays hard-capped disabled forever (W2.1 guards it); money + comms stay advisory (Tier 3). The kill-switch (`HARTOS_EXECUTION_KILL_SWITCH`) disables every autonomous path including Tier 1.
