# Phase 17C — Agent-Creation Execution Architecture (DESIGN GATE — no code)

**Status: design proposal for Hart's approval. This phase writes no execution code.**
Its only deliverable is *this document*: a written execution architecture with explicit
gates, so 17D/18A/18B build against a decided design instead of improvising one.

> Doctrine carried forward from 17A: **propose, don't act**; **pure & Worker-safe planning**;
> **plan-level, not execution**; **no Factory-artifact fork into CC**. 17C does not weaken any
> of these — it defines how an *approved* plan eventually becomes real code/infra **outside**
> the cockpit, behind a two-key gate, with the dry-run path staying hard-capped forever.

---

## 0. Key finding — most of the execution machinery already exists

17C is **not greenfield**. Command Center already contains a working, gated provisioning layer:

- `src/provisioning/engine.ts` — `runProvisionEngine(plan, adapters, ctx)`: gate-checks every
  step, runs `verify()` for read-only steps, `apply()` for mutating steps, returns a result set.
- `src/provisioning/gates.ts` — the gate ladder (see §3). Read-only steps never gate; mutating
  steps require their provider gate; staging/production require extra confirm gates.
- `src/provisioning/adapters/*` — real adapters. **GitHub already has a real `apply()`** (Phase 7A:
  `create_repo` / `set_remote` / `initial_push`) behind `ALLOW_GITHUB_PROVISION` + `ALLOW_GITHUB_PUSH`
  + production gate, with rigorous secret redaction (`safe()`), env-only secrets, no token logging.
- `src/provisioning/ledger.ts` + `rollback.ts` — ledger records each applied step with
  `rollbackAvailable`; `buildRollbackPlan()` emits a per-step reversal plan (manual instructions today).
- `src/launch/*` — higher-level launch/promotion/readiness/rollback-execution orchestration.

**So the gap 17C must close is not "build execution." It is "wire the 17A cockpit plan to the
existing Node-side engine across the CC↔Factory boundary, and define the lifecycle + gates that
let an approved proposal cross from the pure planning world into the Node execution world."**

---

## 1. The central boundary: Worker plans, Node executes (never the Worker)

There are two execution worlds in HartOS, and the whole safety model rests on keeping them apart:

| | **Cockpit / planning world** | **Execution host (Node) world** |
|---|---|---|
| Runs in | hosted Cloudflare Worker + cockpit code | local CLI **or** CI runner |
| Capabilities | pure: no fs, no network-to-providers, **no secrets** | fs, provider network, **secrets in env** |
| Owns | intent → `planAgentCreation` → `agent_creation_plan` proposal | scaffold generation + `runProvisionEngine` |
| Execution | `executeProposal()` **throws, forever** (`executable:false`) | the *only* place `apply()` can run |
| 17A code | `src/cockpit/agent-planner/` (Worker-safe, pure) | `src/provisioning/*`, `src/launch/*` (Node) |

**Decision 17C-1 — the hosted Worker is never an executor.** It holds no provider secrets and its
request path cannot reach `apply()`. The cockpit's job ends at *"emit an approved, secret-free plan."*
Real creation happens only when **Hart runs the Node executor** against that approved plan. A chat
prompt therefore cannot mutate anything: the mutating code is not reachable from the request path,
and the executor that *can* reach it is a separate, human-invoked process holding the secrets.

This directly answers *"how do we prevent random prompt → real provider mutation?"* — see §5.

---

## 2. The bridge: from `AgentCreationPlan` to applied infrastructure

The 17A `AgentCreationPlan` (plan-level, no exact `AgentConfig`, no byte-precise manifest) and the
provisioning engine's `ProvisionPlan` (`ProvisionStep[]`, keyed by `agentName`) are **different
shapes**. Three bridge components connect them. Two largely exist; one is the real new work for 17D+.

```
  [Worker / cockpit, pure]                 [Node execution host — Hart-invoked]
  Ask "Create a tax agent"
    → planAgentCreation()  ───────────►  approved agent_creation_plan proposal
                                          (secret-free, queue-persisted, audited)
                                                     │
                                    (A) Spec resolver │  plan-level draft → exact Factory AgentConfig
                                                     ▼
                                    (B) Scaffold generator   AgentConfig → real repo files in a workdir
                                          [lives in Agent Factory]         (17D = local only; 18A = PR)
                                                     │
                                    (C) ProvisionPlan compiler  adapters[].plan(ctx) → ProvisionPlan
                                          [EXISTS: provisioning engine]
                                                     ▼
                                          runProvisionEngine(plan, adapters, ctx)
                                          gates closed by default → 18B opens them per-provider
```

- **(A) Spec resolver — NEW, lives in Factory.** Turns the plan-level draft + Hart's answers into the
  exact `AgentConfig`. 17A deliberately did **not** fork this into CC; 17C keeps it that way (avoids the
  drift class 16E fixed). CC calls *into* the Factory to resolve, never re-implements it.
- **(B) Scaffold generator — EXISTS in Factory** (`create-agent-project.ts` + templates, the 16E
  hosted-cockpit inheritance). 17D drives it in *local-only* mode (artifacts on disk, no push); 18A adds
  branch/PR mode.
- **(C) ProvisionPlan compiler + engine — EXISTS in CC** (`src/provisioning`). Each adapter's `plan()`
  produces gated `ProvisionStep[]`; `runProvisionEngine` executes them respecting gates. 18B is mostly
  "open the gates one provider at a time," not "write the engine."

---

## 3. The gate ladder (as it exists today — 17C reuses, does not reinvent)

From `src/provisioning/gates.ts` + adapter step definitions:

| Layer | Gate (env var, must = `"true"`) | Scope |
|---|---|---|
| Global | `ALLOW_AUTO_PROVISION` | nothing mutating runs unless open |
| Environment | `CONFIRM_STAGING_PROVISION` / `CONFIRM_PRODUCTION_DEPLOY` | per target env |
| Per-provider | `ALLOW_GITHUB_PROVISION`, `ALLOW_SUPABASE_PROVISION`, `ALLOW_CLOUDFLARE_PROVISION`, `ALLOW_TRIGGER_PROVISION`, `ALLOW_TELEGRAM_PROVISION`, `ALLOW_OPENAI_VERIFY` | per provider |
| Per-action (extra) | e.g. `ALLOW_GITHUB_PUSH` (separate from repo create) | the sharpest single actions |
| Per-step | `step.mutation` + `step.requiredGate` + `step.productionGateRequired` | each individual step |

Behaviour (already implemented): **missing gate = skip step safely, report gate name** — never fail
into a partial mutation. Read-only steps never require a gate. This is exactly the "fail closed" posture
17C wants; 17C's contribution is to add the *cockpit-approval* key on top (§4), not to change this ladder.

---

## 4. Where approval lives — the two-key model

**Decision 17C-2 — approval is a two-key gate; neither key alone can create anything.**

- **Key 1 — Cockpit approval (the proposal queue).** The proposal queue (`proposal-queue.ts`) is the
  single source of approval truth. Today its lifecycle deliberately has **no executed state**
  (`draft → pending_approval → approved_simulated | rejected | expired`). 17C adds controlled-execution
  states *without* touching the dry-run invariant:

  ```
  draft → pending_approval → approved_simulated      (unchanged; cockpit/Worker path stops here)
                           ↘ approved_for_execution   (NEW: Hart explicitly authorizes the Node executor)
  approved_for_execution → executing → executed | execution_failed   (NEW: set by the Node executor ONLY)
  ```

  The Worker can move a proposal to `approved_for_execution` but **can never set `executing`/`executed`** —
  those transitions are writable only by the Node executor process. `executeProposal()` in the cockpit
  stays a hard-capped throw.

- **Key 2 — Host gates (env vars).** Even with `approved_for_execution`, nothing mutates unless the Node
  host has the relevant gates open (§3). Hart sets these on the host he controls; they are never in the
  Worker, never in a proposal, never in the repo.

**A prompt provides at most Key 1. Mutation needs Key 1 *and* Key 2 *and* a human running the executor.**

---

## 5. Preventing "prompt → real provider mutation" (defense in depth)

Layered so that any single failure is not catastrophic:

1. **Unreachable code path.** The Worker request path does not import a usable `apply()`; `executeProposal()`
   throws. (Architectural, not configurable.)
2. **No secrets in the planning world.** The Worker holds no provider tokens; even if it tried to call a
   provider it has no credentials. Secrets live only in the Node host env.
3. **Separate, human-invoked executor.** The only process that can `apply()` is a Node CLI Hart runs.
4. **Gates default closed.** `ALLOW_AUTO_PROVISION` + env-confirm + per-provider + per-action, all off by
   default; missing gate = skip, not partial-apply.
5. **Secret-free, secret-scanned proposals.** `containsSecret()` runs before every queue write; adapters
   redact via `safe()`; `safeSummary` never carries tokens. A leaked proposal cannot itself provision.
6. **Reversible-first ordering (§7).** PR/branch operations precede irreversible provider provisioning, so
   the cheap-to-undo steps happen before the impossible-to-undo ones.

---

## 6. CC ↔ Factory boundary, and the three "how" decisions

**Decision 17C-3 — Factory is invoked as a local module/CLI from the Node executor, NOT a network service.**
- *Should CC call the Factory CLI locally?* **Yes.** In-process / local CLI within the Node execution host.
- *Should the Factory run as a separate service?* **No** (for now). A network service adds an attack surface,
  an auth boundary, and a deployment to secure — all for zero benefit while this is a single-operator system.
  Revisit only if/when execution must run unattended in CI at scale.
- *Should agent creation happen through GitHub PRs?* **Yes — that is exactly 18A**, and it is the safety
  mechanism, not a nicety: scaffold into a branch → open PR → Hart reviews real code → merge. Provider
  provisioning (18B) stays gated and happens *after* code review, never as a side effect of scaffolding.

Ownership stays clean (no fork): **Factory owns** AgentConfig resolution + scaffold generation;
**CC owns** the cockpit, proposals, gate ladder, provisioning engine, ledger, launch orchestration.

---

## 7. Rollback — honest reversibility matrix (from `rollback.ts`)

**Decision 17C-4 — rollback is recorded per step and is honest about irreversibility.** The ledger marks
`rollbackAvailable`; `buildRollbackPlan()` emits newest-first reversal instructions. Today instructions are
**manual** (adapters return instructions, no auto-delete) — 17C keeps that default because several actions
have **no clean automated rollback**:

| Step | Reversible? | Rollback |
|---|---|---|
| `github:set_remote` | ✅ easy | `git remote remove origin` |
| `github:initial_push` | ⚠️ partial | revert HEAD / delete branch (history may persist) |
| `github:create_repo` | ❌ destructive-only | **manual** repo delete — *irreversible*, confirm first |
| `supabase:apply_migrations` | ⚠️ partial | write + apply reverting migrations |
| `supabase:create_project` | ❌ destructive-only | **manual** project delete — data loss |
| `cloudflare:deploy_worker` | ✅ | `wrangler rollback` / redeploy previous |
| `cloudflare:set_secret` | ✅ | `wrangler secret delete <name>` |
| `telegram:register_webhook` | ✅ | re-register previous webhook |
| `trigger:register_task` | ✅ | disable task in dashboard |
| `openai:verify_model`, `run_smoke` | n/a | read-only, nothing to undo |

**Design consequence:** order steps **reversible-first**; gate the irreversible ones (`create_repo`,
`create_project`) hardest; prefer PR mode (18A) so that for most iterations *no irreversible step runs at all*.

---

## 8. Spec storage — answering "how do we store generated specs?"

**Decision 17C-5.**
- The **cockpit proposal** stores only the *plan-level* draft + answers (secret-scanned, plan-level) and a
  stable **spec id** — never the resolved `AgentConfig`, never secrets.
- The **resolved `AgentConfig`** is materialized only in the Node host workdir at execution time, and is
  **committed into the new agent's own repo** at scaffold time (its natural home), not stored back in CC.
- The **ledger** (per-agent, Node-side) is the durable audit record of what was applied + rollback status.

This keeps CC free of Factory artifacts (no drift), keeps secrets out of every persisted cockpit record, and
puts each agent's spec where it belongs — in that agent's repo.

---

## 9. The decided end-to-end flow (target for 17D → 18B)

```
Cockpit: "Create a tax agent"
  → planAgentCreation → agent_creation_plan proposal (executable:false, secret-scanned)   [17A ✅]
  → Hart approves plan ........................................ proposal: approved_for_execution  [17C lifecycle]
  → Hart runs the Node executor on his host (holds secrets, gates default closed):
       (A) Factory resolves exact AgentConfig from the approved draft
       (B) Factory scaffolds real files into a workdir ......... 17D: local-only artifacts (no push)
       (C) Engine compiles ProvisionPlan; runProvisionEngine with gates CLOSED → dry-run report
  → Hart reviews artifacts/report ............................. second approval point
  → 18A: scaffold → branch → open PR → Hart reviews real code → merge   (still no provider mutation)
  → 18B: open provider gates one at a time (ALLOW_*); each step: dry-run → apply → ledger → smoke → rollback-ready
  → NEVER auto-deploy; production needs CONFIRM_PRODUCTION_DEPLOY + per-provider + per-action gates
```

---

## 10. What 17C decides vs. explicitly does NOT build

**Decides (this doc):** the Worker-plans/Node-executes boundary (17C-1); the two-key approval model + new
lifecycle states (17C-2); local-CLI Factory invocation, not a service (17C-3); honest reversibility matrix +
reversible-first ordering (17C-4); spec storage location (17C-5); the end-to-end gated flow (§9).

**Does NOT build (enforced):**
- ❌ No new execution code, no lifecycle code, no scaffold/provision invocation — 17C is a design gate.
- ❌ No gate is opened. `ALLOW_AUTO_PROVISION` and all per-provider/per-action gates stay closed.
- ❌ `executeProposal()` stays a hard-capped throw; the Worker remains `executable:false`.
- ❌ No Factory `AgentConfig`/scaffold fork into CC.

## 11. Open questions for Hart (decide before 17D)
1. **Executor host for v1:** local CLI on your machine only, or also a CI runner? (Recommendation: local-only
   first; CI later behind the same two-key model.)
2. **Spec id scheme:** reuse the proposal id, or a separate durable spec id that survives proposal expiry?
3. **`approved_for_execution` expiry:** should execution authorization time-box (e.g. 24h) like other proposal
   states, forcing re-approval if stale?
4. **PR mode default (18A):** always PR, or allow a local-commit-only mode for throwaway/experimental agents?

---

## Next
- **17D** — Local scaffold dry-run from an approved plan (artifacts only; no repo/project/deploy/push).
- **18A** — Controlled execution / PR mode (branch + PR; still no provider mutation).
- **18B** — Provider provisioning gates (open `ALLOW_*` per provider; dry-run → apply → ledger → smoke → rollback).

*Generated as the Phase 17C design-gate deliverable. No code paths were added or changed.*
