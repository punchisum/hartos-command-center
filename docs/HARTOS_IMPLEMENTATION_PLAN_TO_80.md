# HartOS → 80% Auto — 5-Phase Implementation Plan

**Date:** 2026-06-08 · **Source:** grounded in the 2026-06-08 read-only capability audit · **Status:** Phase 0 greenlit (Phases 1–4 await sign-off after Phase 0 is verified live).

The target end-state is precise: **Hart issues a spec → HartOS scaffolds, provisions, deploys, and _officiates_ a fully functional agent in the cockpit, which then perceives, proposes, and executes one safe action under human approval — with HartOS doing ~80% of the work and Hart approving at named gates.**

---

## What "80% auto" means (and why 80, not 100)

80% auto = the entire agent lifecycle is automated **except four human approval gates**: (1) spec sign-off, (2) provision approval, (3) deploy approval, (4) per-action execution approval. The remaining 20% is _deliberately_ human — the propose-before-execute doctrine makes ~80% the **correct ceiling**, not a shortfall. Going to 100% would violate the system's best property.

## The "Officiation Contract" — what it means for an agent to be _officiated in the Cockpit_ (7 points)

A created agent is **officiated** only when it:
1. is in the agent + read-model registries;
2. resolves a live read-model with source/freshness/confidence;
3. emits a **banded** AgentSignal (green/amber/red — never the UNKNOWN bug);
4. renders as a fleet card **and** `/agent/<type>/ui` detail page;
5. emits typed proposals into the approval spine;
6. is bound by doctrine-as-code (`executable:false` unless an approved adapter);
7. can execute its one allowlisted safe action after approval.

Phases build toward these 7; Phase 4 delivers all 7 automatically.

## Dependency chain (why this order is forced)

```
P0 Truth  ─▶ P1 Agent Contract + reliable depth ─┐
                                                  ├─▶ P4 Create + Officiate + wired F4
P2 Doctrine-as-Code + Approval Spine ─▶ P3 First Safe Adapter ─┘
```

You cannot officiate a created agent until "officiated" is an enforced interface (P1). You cannot execute safely without a code-enforced doctrine + approval spine (P2) feeding one proven adapter (P3). P4 needs all of them.

---

## Phase 0 — Truth Cleanup / Bug Fix

**Objective:** live == local, the cockpit tells the truth on _real_ data, zero known bugs, live infra verified. **No new capability — only truth.** You cannot automate on top of a cockpit that lies.

**Gate reason:** every later phase trusts the cockpit's verdicts; they must be true first.

| # | Workstream | Concrete change (files from audit) | Acceptance |
|---|---|---|---|
| 0.1 | **Ship the divergence** | Commit the 2 uncommitted edits (`cloudflare-cockpit-page.ts:145/342`, `control-surface/render.ts:280/423`); deploy `47f8826` + this fix via `wrangler deploy --config wrangler.cockpit.toml` | `/health` 200; bundle pg-free (`--dry-run` + grep `new Pool`/`require("pg")`); live shows no giant-cream-draft; do-next includes coach/triage |
| 0.2 | **Fix Fitness UNKNOWN** | `read-models/agent-signal.ts:79–80` — replace literal-string verdict with a **banded** map; reuse `coaching-core`'s recovery band; reconcile keys at `fitness-read-model.ts:207` vs live `get_fitness_today_state` | Fresh recovery → green/amber/red, never idle/UNKNOWN; new contract test proves it |
| 0.3 | **Factory honesty** | `cloudflare-cockpit-views.ts:51` + `factory-source.ts:64–66` — relabel "unavailable" → "Local-only · not wired to hosted (by design)" | Factory card no longer reads as breakage (full hosted read-model deferred to P4.2) |
| 0.4 | **Queue hygiene + panel de-dupe** | Show **draft age**; mark stale drafts; ensure `suggest-actions.ts` cross-panel suppression so nothing appears as both a fresh suggestion _and_ a queued proposal | No zombie drafts shown as live; no double-presented action |
| 0.5 | **Live infra truth table (read-only)** | Verify: fitness RPC keys present; `OPENAI_API_KEY` set in prod; proactive-alert cron registered; migrations applied (`get_fitness_user_config`, `approve_fitness_nutrition_draft`); cockpit Access/auth in front; PR-mode location in `agent-scaffold` | A no-secret table: each item **confirmed** or **flagged** |
| 0.6 | **Branch/main consolidation** | Fast-forward the 4 feature branches into `main` (or a release branch); tag the deployed commit | `main` exists, == deployed; repos reconciled |
| 0.7 | **Debt that blocks truth only** | Consolidate duplicated `SEV_RANK`/`PRIORITY_RANK` (6×), `num/cap/slug`; **correct the record: `assessFleetLoad` IS used (`page.ts:377`) — do not prune**; decide 5 unused `summarize*` fns | No misleading "dead code" notes; helpers single-sourced |

**Doctrine preserved:** Worker stays read-only + pg-free; no execution touched.
**Rollback:** single deploy, revertable to `dbaad6db`; all edits are isolated.
**DoD / exit metric:** truthful, bug-free, deployed cockpit; infra table green-or-flagged; `main` consolidated. **Useful cockpit 75 → ~85%.**
**Explicitly NOT:** no new agent logic, no execution, no doctrine refactor.

---

## Phase 1 — Reliable Worker-Agent Depth + the Agent Contract

**Objective:** make the two real agents **reliable** (no silent degradation, contract-tested), and extract their proven pattern into a reusable **Agent Contract + Archetype** — the enforced interface a created agent must satisfy to be officiated. "Depth" here = the archetype is deep, observable, and trustworthy enough to mass-produce.

**Gate reason:** you can't officiate created agents until "what an officiated agent _is_" is concrete code; you can't automate on flaky agents.

| # | Workstream | Concrete change | Acceptance |
|---|---|---|---|
| 1.1 | **Define the Agent Contract** (the officiation interface) | New `src/agents/agent-contract.ts`: typed interface = read-model adapter (→ summary w/ source/freshness/confidence), **banded** AgentSignal (verdict + nextAction + blindSpots), typed proposal emitter (`executable:false`), detail-panel renderer + a **conformance test harness** | Fitness + Ops formally conform; harness is green; this is the spec P4 targets |
| 1.2 | **Kill silent degradation** | Ops `DeterministicDigestSummarizer` + fitness `freeform-coach.fallbackReply()`: when LLM keys absent, **surface "mechanical mode (LLM unavailable)"** in cockpit + logs; make the deterministic text cite **real** HRV/sleep/card numbers | Forced no-LLM run is visibly flagged; fallback text contains real metrics |
| 1.3 | **RPC contract hardening** (root of the UNKNOWN bug) | Live-shape contract tests per agent RPC: assert the live RPC returns the keys the read-model picks; **fail loudly on drift**; repair the assumed migrations | Drift breaks CI, not the cockpit |
| 1.4 | **Calibration + alerts made real** | Wire fitness X4 self-scoring to a **persisted adherence store**; confirm + schedule ops proactive-alert cron (Trigger.dev/wrangler), observable | Calibration reads real history; cron run visible |
| 1.5 | **Observability baseline** | Each agent emits a structured, secret-free **append-only run log** — the audit-trail seed for P2.3; begin moving off the 821-file FS sprawl | Every run leaves one structured record |
| 1.6 | **Research agent: reliable, not broader** | Make the deterministic planner robust + surfaced; **explicitly defer live web** (doctrine) | Planner output trustworthy; web stays off |
| 1.7 | **Ops waiting-card detail** | Surface triage-core's existing `waiting_on_hart` + `nextAction` per card in the ops panel | Each waiting card shows _why_ + next action |

**Doctrine preserved:** still read-only/propose-only; no execution; honesty contract extended (degradation made honest).
**DoD / exit metric:** both agents conform to the contract, zero silent fallback, RPC contracts tested, observability on. **Governed-OS 60 → ~68%.**
**Explicitly NOT:** no new agents, no execution, no live web, no F4 wiring.

---

## Phase 2 — Doctrine-as-Code + Approval Spine

**Objective:** convert doctrine from prose into an **imported, CI-enforced library**, and build the full proposal **lifecycle + audit trail + approval UI** — the single fail-closed chokepoint every future execution must pass through.

**Gate reason:** execution (P3) is only safe behind a real approval spine + code-enforced doctrine. This must exist before any execute path.

| # | Workstream | Concrete change | Acceptance |
|---|---|---|---|
| 2.1 | **`@hartos/doctrine` code module** | Extract command-center's _real_ enforcement (`ACTION_EXECUTION` gating, `executable:false` defaults, pg-free build guard, anon-read/service-role-write separation, secret rules) into one importable lib. Generated agents import it → inherit **real guards**. `DOCTRINE.md` is **generated from** the code (doc ← code) | A **doctrine-conformance test** fails CI on violation (pg-in-Worker, `executable:true` without an approved adapter) |
| 2.2 | **Full proposal lifecycle** | States: `draft → pending_approval → approved → executed \| rejected \| expired \| superseded`. **Status-safe** transitions (deferred #4 fix): switch `persist-cockpit-proposal/index.ts` to a **conditional write** (`WHERE status IN (...)`), never downgrade. TTL/expire job; reject path | Same proposal persisted twice never downgrades; expiry + reject work |
| 2.3 | **Append-only audit log** | Every transition (and future execution) writes an **immutable** entry (who/what/when/before/after) to Supabase — replaces the weak FS trail | 100% of transitions audited |
| 2.4 | **Approval UI in cockpit** | Approve / Reject / Defer, writing **only** via the capability-token Edge Function (`HARTOS_ASK_WRITE_TOKEN` pattern) — **never** a DB key, never from the Worker with elevated creds | Worker stays read-only; writes go through the token path |
| 2.5 | **Fail-closed precondition** | Doctrine-as-code asserts: **no execution without** `(approved ∧ non-expired proposal) ∧ capability-token ∧ audit-entry-written ∧ per-action-flag-on` | The precondition function is the only gate P3 may call |

**Doctrine preserved & strengthened:** this phase _is_ the doctrine, now in code. `ACTION_EXECUTION` stays **disabled** — the spine is built, the adapter is P3.
**DoD / exit metric:** doctrine importable + CI-enforced; lifecycle + audit + approval UI live; persist hardened. **Governed-OS 68 → ~80%.**
**Explicitly NOT:** no execution yet; no global execution enable.

---

## Phase 3 — First Safe Execution Adapter

**Objective:** prove the **approve → execute → audit → report** loop end-to-end with exactly **one** reversible, logged, flagged, single action of minimal blast radius.

**Gate reason:** needs the approval spine + doctrine-as-code (P2) and reliable agents (P1).

| # | Workstream | Concrete change | Acceptance |
|---|---|---|---|
| 3.1 | **Choose the first action: read-refresh/sync** | Implement the existing `Refresh / sync repair plan (ops)` proposal as the adapter: re-pull ClickUp → **re-bake HartOS's own snapshot**. Mutates **only HartOS's own cache** — zero external blast radius, inherently reversible (re-run) | A real action, lowest possible risk |
| 3.2 | **ExecutionAdapter interface** | Typed adapter: preconditions (calls P2.5 gate only), `dryRun()`, `execute()`, capture before/after, write audit, report to cockpit, **idempotency key**, reversible/no-op-safe. Global `ACTION_EXECUTION` stays `disabled`; a **per-action allowlist + feature flag (default OFF)** enables only this one | Interface is the sole execution path |
| 3.3 | **Execution runs through the spine** | Approved proposal → capability-token Edge Function (service_role) runs the adapter → audit (before/after) → result in cockpit + agent run log. **Worker never executes** | End-to-end via token, fully logged |
| 3.4 | **Safety rails** | Dry-run first → canary (one entity) → rate-limit → idempotent → compensating/rollback action → **kill-switch** (flag off = instant stop) → "Last execution" cockpit panel | All rails demonstrably work |
| 3.5 | **Adversarial tests** | Expired / unapproved / flag-off **all blocked**; double-execute idempotent; audit complete; kill-switch verified | Every block path tested |

**Doctrine preserved:** execution exists only for one flagged, allowlisted, approved, reversible, audited action. Everything else stays disabled.
**DoD / exit metric:** Hart approves a refresh-sync in the cockpit → it executes once, safely, logged, reversible, reported. **Semi-autonomous execution 12 → ~45–50%.**
**Explicitly NOT:** no second/external-mutation adapter yet; no global execution enable.

---

## Phase 4 — Controlled Multi-Agent Autonomy + Agent-Creation Officiation

**Objective:** the end-state. The factory **creates a fully functional agent** (instantiating the P1 archetype) that **auto-officiates** in the cockpit, and the fleet runs **controlled cross-agent work** via the now-justified **wired F4 orchestrator** — all under the approval spine. This is where 80% auto lands.

**Gate reason:** needs the Agent Contract (P1), doctrine-as-code + spine (P2), and a proven adapter (P3). Only now do ≥2 real agents + a created one justify wiring F4.

| # | Workstream | Concrete change | Acceptance |
|---|---|---|---|
| 4.1 | **Close the factory creation loop** | (a) **Archetype instantiation:** factory takes a spec → instantiates the **monitoring/triage archetype** (the fitness/ops pattern from P1) parameterized by `{data source, scoring rules, proposal types}` → output is **functional**, not a skeleton. (b) **Auto PR mode:** add the **missing** `gh`/octokit call → real PR. (c) **Gated provisioning:** automate Supabase migrate + Cloudflare deploy **behind approval gates** | Created agent runs real logic; PR opens; provisioning needs only approvals |
| 4.2 | **Auto-officiation** (the 7-point contract) | On create+deploy: auto-register into agent + read-model registries, fleet card, `/agent/<type>/ui`, proposals into the spine, doctrine-as-code binding, and (if applicable) its one safe adapter. Also delivers the **real hosted Factory read-model** deferred from P0.3 | `create agent X` → after approvals → **X is a real, banded, governed fleet card with live read-model + proposals — zero manual cockpit wiring** |
| 4.3 | **Wire F4 typed-task spine** | Orchestrator (`fleet/orchestrator.ts` core) assigns **typed tasks on the shared Supabase spine**; agents pick up work; CTO reconciles. Capacity/wave logic exists — wire it to the spine + real agents | Cross-agent tasks flow with human approval at gates |
| 4.4 | **Controlled-autonomy loop** | Scheduled, **gated** cognitive loop: perceive (Rinnegan) → forecast (Prophet) → propose (suggest-actions) → **human approves** → execute (P3 adapter) → audit → re-perceive | The loop runs; Hart approves, doesn't operate |
| 4.5 | **End-to-end acceptance** | Staging test: spec → created agent → officiated → proposes → approved → executes safe action → appears in orchestration | Full lifecycle green in staging before prod |

**Doctrine preserved (even at 80%):** approval gates remain; no unattended execution; no live web / Wolverine / broad external mutation. **80% is the ceiling, by design.**
**DoD / exit metric:** a brand-new HartOS-created agent is **fully functional and officiated**, governed + executing its safe action under approval; F4 wired; gated cognitive loop runs. **Fleet 22 → ~50%+, Governed-OS 80 → ~85%, composite ≈ 80% auto.**

---

## Coverage map — every audit finding lands in a phase

| Audit finding | Phase |
|---|---|
| Fitness UNKNOWN verdict | **0.2** |
| Factory "unavailable" (honesty / real hosted read-model) | **0.3** → **4.2** |
| Live Worker stale / hosted-vs-local divergence + uncommitted CSS fix | **0.1** |
| Branches not on `main` ("23 unpushed" myth) | **0.6** |
| Stale proposals / no lifecycle / persist #4 weakness | **0.4** (interim) → **2.2** (full) |
| Duplicate suggested actions (cross-panel) | **0.4** |
| Ops waiting-card detail thin | **1.7** |
| Silent LLM fallback (ops + fitness templated text) | **1.2** |
| RPC key-mismatch fragility | **1.3** |
| X4 calibration data source uncertain | **1.4** |
| Proactive-alert cron unverified | **0.5** (verify) → **1.4** (real) |
| Research agent thin / no web | **1.6** (reliable; web deferred) |
| 821-file FS-as-DB sprawl | **1.5** → **2.3** |
| Doctrine prose-only (no runtime guard) | **2.1** |
| Weak audit trail | **2.3** |
| Approval only draft/pending | **2.2 + 2.4** |
| Execution disabled / no adapter | **3** |
| Factory: no PR mode | **4.1** |
| Factory: manual provisioning | **4.1** |
| Factory: manual business logic | **4.1** (archetype) |
| F4 unwired | **4.3** |
| Cockpit auth unverified | **0.5** verify (harden only if exposed) |
| Dead/dup code; `assessFleetLoad` "prune" error | **0.7** |

## Invariants held across all 5 phases (non-negotiable)

Read-only-first Worker · pg-free Worker bundle · propose-before-execute · human approval at every gate · writes only via capability token (never a DB key, never from the Worker) · no secret exposure · freshness/confidence honesty · fail-closed · append-only audit. **No phase may weaken these** — `@hartos/doctrine` (P2.1) makes that CI-enforced.

## Anti-overbuild guardrails (the audit's "do not build yet" stays parked until its phase)

- Broad/external execution → **stays off** until after P3 proves one adapter.
- New domain agents (tax/invoice/stock) → only via the P4 archetype, never hand-built.
- F4 spine / cognitive loop → **P4 only**, never earlier (no real work to orchestrate before then).
- Live web research, Wolverine, more KV/Access complexity → **out of scope for 80%**; each needs its own governance phase later.

## Suggested cadence (relative size, not promises)

P0 small (1 focused cycle) · P1 medium · P2 medium-large (governance backbone) · P3 small-but-careful (safety-dominated) · P4 large (the payoff). **Each phase ends deployed + truthful before the next starts.**
