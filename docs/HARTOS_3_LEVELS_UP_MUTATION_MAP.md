# HARTOS — 3 LEVELS UP + MUTATION MAP (master build plan)

**Status:** approved aggressive scope, 2026-06-08 (v3 — Gemini/ChatGPT audit folded in). **Supersedes**
`HARTOS_PLAN_3_LEVELS_UP.md`. **Extends** `HARTOS_IMPLEMENTATION_PLAN_TO_80.md` (Phases 0–3 deployed;
Phase 3 canary fired+proven) and `HARTOS_BLUEPRINT_V2.md`. Doctrine: `DOCTRINE.md` +
`HARTOS_SHARED_DOCTRINE.md`. This is the real map, written to be executed.

---

## 0. What HartOS is (one sentence + the right mental model)
HartOS is one loop with a hard floor: **command → reason → propose → approve → mutate → audit →
emit state-delta → learn the new state.**

**Model it as an industrial control system, not a normal app:** a **read/control plane** (the cockpit,
read-only, key-free) is physically separated from a **mutation plane** (typed adapters, off-Worker,
gated). **LLMs are treated as dangerous non-deterministic inputs that must be contained** — they may
reason and propose, never execute or approve. HartOS is **not a vending machine that builds generic
agents**; it is a **CTO/operator that interrogates Hart, scouts what already exists, sharpens the spec,
builds only after approval, verifies reality, and refuses weak or vague requests.**

The difference between a cool AI dashboard and a real operating system: **HartOS has agents with jobs,
boundaries, artifacts, mutations, audits, and state-deltas** — not just cards.

```
Hart speaks/clicks → reads live context → reasons (LLM, contained) → proposes TYPED action/job
  → Hart reviews dry-run → Hart approves (click; never voice/LLM) → executes via gated adapter
  → audit (before+after) → StateDeltaSignal → Fleet Brain updates incrementally
```

---

## 1. Non-negotiable doctrine (the floor — law)
No approval = no mutation · No dry-run = no mutation · No audit = no mutation (before AND after) ·
No clear target = refusal · No secret in prompts · No service-role key in the Worker · Mutation only
through typed adapters · Voice can ask, not approve/execute · LLM can reason/propose, not
execute/approve · Every external mutation is read-before-write with target confirmation + idempotency
key + audit-before/after + rollback note · Every live deploy/migration/irreversible action needs an
explicit final gate unless approved in-session · **Writing an artifact to a store IS a mutation** ·
**Every job declares boundaries; the gate enforces them** · **Every mutation emits a StateDeltaSignal.**
Encoded today: `src/doctrine/doctrine.ts` + `src/doctrine/execution-gate.ts`. The plan extends the
**same** gate to every new adapter — no bespoke gates.

---

## 2. The HartOS topology (sharper map)
```
Hart
  ↓
Command Cockpit            (read/control plane; Mutation Center; Ask; voice)
  ↓
Fleet Brain                (fleet synthesizer — priority briefing; updates from StateDeltaSignals)
  ↓
Specialist Agents
  • Factory Agent          ── Spec Interrogator · Manifest Compiler · Build Planner ·
  │                           Builder/Executor (raw-code-escalation) · Verifier · Officiator
  │                           └─ CALLS → Beezulbub
  • Beezulbub Agent        ── Scout · Evaluate · Reject · Recommend patterns   (SEPARATE agent)
  • Research Agent         ── Job lifecycle · Reports · Source packs
  • Ops Agent · Fitness Agent · Future Agents
  ↓
AgentJob Lifecycle         (Request→Interrogate→Scope+Boundaries→Propose→Approve→Execute→
  ↓                         Artifacts→Summary→Follow-up→Audit→Archive)
Mutation Spine             (Tiered TypedActionProposal + the one gate)
  ↓
Typed Adapters             (internal / ops-mirror / ClickUp / storage)
  ↓
External Systems / Artifact Stores
  ↓
StateDeltaSignals  ───────────────────────────────────────────────►  back to Fleet Brain
```
**Beezulbub = hunter. Factory Agent = builder. Do not merge the personalities.** Factory stays clean +
deterministic; Beezulbub handles messy external repos, licenses, unknown code quality, high-token
scouting — and is *invoked by* Factory during build planning.

---

## 3. Architecture stress-test (ruthless: real / thin / redundant)
1. **Mutation spine = generalize the proven refresh-sync path**, not greenfield (`execution-adapter.ts`,
   `run-refresh-sync*.ts`; canary proved it in prod).
2. **Tiers 0–1 already ship** (Edge Function `approve`/`reject`/`refresh_sync` + `proposal-queue.ts`
   lifecycle) — surface, don't rebuild.
3. **Beezulbub is the most-built, least-wired engine** — ~33 modules under `src/beezulbub/` (Scout
   `scout.ts`/`live-scout.ts`/`github-search.ts`; Evaluate `score.ts` 7-dim/`license-check.ts`/
   `poison-filter.ts`; Extract `capability-extractor.ts`/`digest.ts`; Propose `adaptation-plan.ts`;
   audit `provenance-ledger.ts`/`capability-registry.ts`; pack lifecycle). **Promote + wire as a separate
   agent**, don't rebuild (§5).
4. **Manifest-driven Factory is already seeded** — `archetype-monitoring.ts` emits config-not-code
   (AgentIntegrationConfig + ReadModelConfig); `generate-agent-yaml.ts` emits manifests; templates are
   config-driven scaffolds. So "Manifest Compiler first" = **promote what exists**; raw codegen is the
   escalation, not the default (§6).
5. **Factory has the build pieces, lacks the agent brain** — scaffold/provision/launch/officiation
   exist; `agent-planner.ts` is a partial interrogator. Missing: Inbox in `cockpit-intent-router.ts`, a
   spec-approval gate before lock, an **active repair loop** (today only manual rollback-plan).
6. **Research-planner exists, no job lifecycle** — `src/research/research-planner.ts` decomposes but
   skips interrogation/scope-lock/boundaries (§7/§8).
7. **Artifact writes are freeform = anti-pattern** (~800 JSON report files, gitignored `*-reports/`,
   none typed/gated/audited). Fix = StorageAdapter family (§9).
8. **StateDeltaSignal is a projection of the audit-after row** the adapters already produce — NOT a new
   store. Reuse before/after; fan to affected agents (§13).
9. **External/LLM tokens run Node/Edge, never the Worker.** Reconcile with
   `COMMAND_CENTER_ACTION_CONTRACT.md`; shared doctrine = a conformance gate, not new prose.

---

## 4. The levels

### LEVEL 0 — Safety foundation (finish hardening FIRST)
Done: cockpit, doctrine-as-code, approval spine, lifecycle, audit table, fail-closed gate, canary.
Remaining: strict TLS (Supabase CA) · **server-side live status verification before execution** (single
biggest gap) · kill-switch + allowlist verification tests · `audit:tail` tooling · branch/main
consolidation.

### LEVEL 1 — Factory Agent v1: a functioning, MANIFEST-DRIVEN Software Factory Agent
The Agent Factory is a **HartOS agent**, not tooling — and a **center of gravity** (the compounding
engine: if you wait, you hand-build HartOS forever). But **v1 is a manifest compiler, not a raw
autonomous coder.** Capabilities:
1. **Inbox** — receive build requests; classify buildable / too-vague / unsafe / already-solved (wire
   into `cockpit-intent-router.ts` as step 1).
2. **Spec Interrogator** — grill Hart before building; refuse vague/generic; ask domain Qs; detect
   contradictions; force measurable outputs; define cockpit "done"; validate risk/cost/prereqs **before**
   spec-lock.
3. **Manifest Compiler (Spec Lock)** — compile the approved spec into **known runtime patterns** (§6):
   AgentSpec, AgentManifest, ReadModelConfig, AgentContract, AgentSignal, CockpitRegistration,
   JobLifecycleConfig, DoctrineConfig, TestPlan, ProvisioningPlan. **Hart approves the spec/manifest
   before any build.**
4. **Build Planner** — manifest (+ Beezulbub report) → implementation plan: files · migrations · tests ·
   provisioning · deploy gates · rollback. **Hart approves before repo mutation.**
5. **Builder / Executor** — apply the manifest; scaffold/patch; branch or local-branch/PR; typecheck /
   tests / secret scan / doctrine scan. **Raw application code only under the Escalation Policy (§6).**
   No auto-merge; no deploy without approval.
6. **Provisioner** — gated infra plan (Supabase / Cloudflare / Trigger / GitHub / read-model). Cost/
   irreversible → explicit Hart approval (Tier 4).
7. **Officiator** — register into cockpit (contract + signal + read-model config); show card + detail;
   **verify visible, reading data, emitting a proposal.**
8. **Repair Loop** — on failure: diagnose, propose an exact repair, **never hide failing tests**, never
   call "done" until live verification passes (gated by `ALLOW_REPAIR_LOOP`).
9. **Audit Trail** — every build action, gate, deploy, test, failure, repair, verification recorded.

**Factory doctrine:** cannot build from vague intent; must interrogate before spec; must produce
measurable acceptance criteria + define read source/output/proposal-type/cockpit-UI/failure-mode; must
get Hart approval for spec→build→deploy in that order; must refuse thin/unsafe/unmeasurable/generic
agents; never weaken shared doctrine; never self-approve; never auto-merge; never call an agent "done"
until live in cockpit emitting a real signal/proposal. **Factory Agent CALLS Beezulbub (§5) during build
planning — it does not contain it.**

### LEVEL 2 — HartOS talks back
**2A LLM Ask:** gateway into the Ask path (provider-select · redaction · output-validate · usage-log ·
rule-based fallback · risk-rated answer citing freshness/gaps · propose-not-execute), inference behind a
capability-token Edge/Node (Worker key-free). **2B Voice seed:** mic → STT → Ask → spoken answer;
privacy caveat; voice can ask, not approve/execute.

### LEVEL 3 — Fleet intelligence
Fleet synthesizer: AgentSignals + proposals + audit + **StateDeltaSignals** → prioritized briefing (what
matters · why · owner agent · proposed action · risk if ignored · confidence/freshness · exact blocker).
**Updates incrementally from deltas, not by re-digesting the world.** Rule-first; LLM behind the gate;
no confidence laundering.

### LEVEL 4 — Cockpit mutation spine (first-class)
Hart mutates from the cockpit — tiered, typed, gated, audited (§10–§15).

---

## 5. Beezulbub — separate Capability Scout Agent (invoked by Factory)
**Definition:** Beezulbub asks **"has someone already built 70% of this?"** before HartOS builds from
scratch. **It is a SEPARATE specialist agent** with its own (riskier) personality — messy external repos,
licenses, unknown code quality, high-token scouting — **invoked by the Factory Agent during build
planning.** It evaluates, ranks, and proposes; **it never blindly copies.**

**Flow:** `Factory interrogates / locks spec → Beezulbub scouts → Beezulbub returns capability report →
Factory incorporates approved patterns → Hart approves build → Factory builds.`

**Responsibilities (each grounded in an existing module):** **Scout** (`scout.ts`/`live-scout.ts`/
`github-search.ts`) · **Evaluate** (`score.ts` 7-dim, `license-check.ts`, `poison-filter.ts`: license,
maintenance, dependency risk, security, complexity-vs-usefulness, coverage, architecture fit,
solves-vs-impressive) · **Extract** (`capability-extractor.ts`, `digest.ts`: architecture/modules/schema/
UI/adapter/testing/deploy/prompt patterns) · **Reject** (bloat, abandoned, unclear license, insecure,
over-engineered, doctrine-weakening, secret-exposing, autonomy-encouraging) · **Recommend/Propose**
(`adaptation-plan.ts`, `provenance-ledger.ts`): what to reuse/adapt/reject, cite source, exact files to
study, why it fits the spec, risks + required mods; **never auto-import without Hart approval.**

**`BeezulbubCapabilityReport` (the unifying type to build):** reportId · agentSpecId · searchScope ·
candidateSources · acceptedPatterns · rejectedPatterns · licenseNotes · securityNotes · dependencyRisks ·
doctrineRisks · recommendedAdaptations · doNotUseList · confidence · unknowns · proposedBuildPlanChanges ·
sourceLinks · auditTrail.

**Beezulbub doctrine:** may scout/recommend; may not blindly copy, import unreviewed deps, bypass
license/security review, weaken doctrine, expose Hart's private code/secrets to external tools, or turn
"cool repo found" into "build this" unless it fits the AgentSpec; **must prefer small inspectable patterns
over giant frameworks.**

**Warning:** no Beezulbub → rebuild commodity from scratch; bad Beezulbub → import bloat/unsafe code.
Correct behaviour = **selective cannibalisation, not dependency addiction.**
> Gaps: unified report type + serializer; spec-lock→auto-scout trigger; standardized `beezulbub-reports/`;
> build-plan feedback into `hartos/build-plan.ts`; explicit confidence; formal doctrineRisks catalog.
> Network scouting behind `BEEZULBUB_ALLOW_NETWORK`.

---

## 6. Manifest-Driven Factory Agent + Raw-Code Escalation Policy
**V1 generates configuration, not arbitrary code.** It compiles a spec into known runtime patterns:
`AgentSpec · AgentManifest · ReadModelConfig · AgentContract · AgentSignal · CockpitRegistration ·
JobLifecycleConfig · DoctrineConfig · TestPlan · ProvisioningPlan`. It **patches code only when needed.**
Behave like *"compile spec into known runtime patterns,"* not *"invent a new app every time."* This is
safer, repeatable, and scales without chaos. (Grounding: `archetype-monitoring.ts` + `generate-agent-yaml.ts`
already do config-not-code — promote them into the Manifest Compiler.)

**Raw-Code Escalation Policy (the leash):** the Factory Agent may write custom application logic ONLY if
— the manifest/config approach is insufficient · Hart approves **code-generation mode** · tests are
generated first or alongside · the doctrine scan passes · **no auto-merge.** Otherwise it stays
manifest-only.

---

## 7. AgentJob — universal job lifecycle + boundaries (every agent)
A born agent is not a card. Every agent receives a job, interrogates it, scopes it **with boundaries**,
proposes execution, produces artifacts, summarizes, proposes follow-ups, audits.

**`AgentJob` contract:** jobId · agentType · jobType · requestText · requester · status ·
interrogationQuestions · answers · scope · **boundaryDefinition** · decisionSupported · dataSources ·
allowedSources · disallowedSources · outputArtifacts · targetFolder · cockpitSummary · mainFindings ·
localizedImplications · proposedActions · confidence · unknowns · auditTrail · createdAt · completedAt ·
freshness · failureMode · rollbackOrCorrectionNote.

**`BoundaryDefinition` (declared per job, ENFORCED at the gate):** maxTime · maxCost · maxSearchDepth ·
allowedSources · disallowedSources · maxFilesWritten · targetFolder · externalNetworkAllowed? ·
llmAllowed? · humanLocalizationNeeded? · stopConditions. *Without boundaries, agents over-research forever
or produce random shallow reports.* A job exceeding a boundary is **refused/stopped**, not silently run.

**Lifecycle:** `Request → Interrogate → Scope+Boundaries → Job Proposal → Hart Approval → Execute →
Produce Artifacts → Cockpit Summary → Follow-up Proposals → Audit → Archive/Persist.`
**Rules:** no interrogation = no job · no scope = no job · no boundaries = no job · no artifact contract =
no job · no target-folder approval = no file write · no audit = no job completion.
> Grounding: `research-planner.ts` + cockpit `ActionProposal` are seeds; gaps = interrogation module,
> scope-lock state, the boundary definition, enriched proposal fields, per-jobId state machine.

---

## 8. Research Agent — worked example (with boundaries)
Hart: *"Research virtual card issuer options for media buying."* The agent **interrogates first** (what
decision? which geography? which user group? localize SG/HK/EU? depth: brief/matrix/full report? which
sources? web allowed? internal docs allowed? consider legal/integration/cost/approval-rate/API/bank
optics? where to save? what follow-ups allowed?). It sets **boundaries** (e.g. *depth: full report · web
allowed · max 20 sources · SG/HK localized · save to approved folder only*). It emits a **Research Job
Proposal** (topic · decision supported · scope · outputs: cockpit exec summary, main findings, localized
implications, full report to approved folder, source list, risk table, unknowns, next actions, follow-up
proposals). **Hart approves before the job runs; Hart approves again before writing to a new folder.**
Output = cockpit summary · main findings · localized implications · full report (approved folder) ·
source pack · confidence · unresolved questions · recommended actions · follow-up proposals · audit entry.

---

## 9. Artifact storage = mutation
**Writing a report to a folder is a mutation.** Target must be approved; **agents cannot write files
everywhere** (the ~800 freeform report files are the anti-pattern to kill). Every write goes through a
**StorageAdapter** (typed/gated/audited; same gate, dry-run, audit-before/after, idempotency key).
Approved targets: local folder · Obsidian vault · GitHub repo · Supabase Storage · Google Drive (later) —
each a typed adapter; a **new** target needs explicit Hart approval before first write.

---

## 10. Mutation Tiering Model (payload scales with risk; doctrine never optional)
Not every action needs the full nuclear payload — but every action needs doctrine (typed + audit +
approval-floor).
| Tier | Example | Required payload |
|---|---|---|
| **T0 internal low-risk cleanup** | archive rejected proposal | idempotency + audit + confirmed target |
| **T1 internal lifecycle** | approve_for_execution | full gate + audit + **live status verification** |
| **T2 ops mirror** | mark ops item reviewed | read-before-write + audit |
| **T3 external** | ClickUp comment / move card | **full payload**: before/after + idempotency + dry-run + approval + correction note |
| **T4 irreversible / cost-bearing** | deploy infra, create resources | **explicit human gate every time** (never session-blanket) |

Each `TypedActionProposal` declares its `tier`; the gate requires that tier's payload subset and refuses
if any required field is missing.

---

## 11. `TypedActionProposal` contract + state machine
Aligned with `COMMAND_CENTER_ACTION_CONTRACT.md`. `Intent → TypedActionProposal → DryRunPreview → Hart
approval → ExecutionGate → Adapter execution → Audit row → StateDeltaSignal → Cockpit result.`
**Fields:** actionType · **tier** · domain · targetId · targetName · beforeState · afterState · riskLevel ·
reason · dryRunResult · approvalStatus · executionFlag · idempotencyKey · auditId · rollbackOrCorrectionNote.
Gate (`checkExecutionPrecondition`) unchanged and shared by all adapters.

---

## 12. The Mutation Center (cockpit UI)
Shows: pending executable actions · dry-run previews · risk/tier · target (id+name) · required approval ·
**Execute Once** · audit result · refused actions (reasons) · rollback/correction note. **Vague mutation
rejected by construction** — ❌ "clean ops"; ✅ "reject 8 draft fitness proposals" / "move card XYZ
Waiting→In Progress". One button = one `TypedActionProposal` with a confirmed target. No "apply to all".

---

## 13. `StateDeltaSignal` (mutation → incremental fleet update)
After a mutation, HartOS does **not** force every agent to re-read everything. Each adapter's `execute()`
emits a small delta — **a projection of the audit-after row it already produces** (no new store):
**fields:** source · domain · changedEntity · before · after · actionType · auditId · affectedAgents ·
freshness.
> Example: *ClickUp card "Virtual Card API Clarification" moved Waiting-on-Hart → In Progress;
> audit=audit_123; affected: Ops Agent, Fleet Brain.*
The Fleet Brain consumes deltas to update **incrementally**, so the cockpit doesn't get slow or confused
re-digesting the world.

---

## 14. Safe mutation adapters
**Internal (T0/T1):** `reject-drafts`, `archive-rejected`. **Ops mirror (T2):** `resurface-waiting`,
`mark-reviewed`, `create-internal-followup`. **External (T3, last):** `clickup-comment` then
`clickup-move-status` (read-before-write, idempotency, audit before+after, correction note; Node/Edge
token, never Worker). **Storage (artifact writes):** `local-folder`, `obsidian`, `github-repo`,
`supabase-storage`. Each: own allowlist flag (default OFF) + kill-switch · dry-run no-writes · gate refuses
unarmed · idempotent re-run · target mismatch → refusal · emits a StateDeltaSignal.

---

## 15. Shared doctrine for every agent (verify + enforce — ~80% exists)
`HARTOS_SHARED_DOCTRINE.md` exists; the Factory injects it (410210e). Base: propose-before-acting · honest
uncertainty · freshness/source visible · no secret exposure · read-before-write · typed actions only ·
approval floor · audit trail · idempotency · fail-closed · no confidence laundering · no cross-agent hidden
mutation — **plus** the AgentJob rules (interrogate, scope, boundaries, artifact contract, approved target,
audit) and the Factory/Beezulbub doctrine. **Build = a conformance gate**, not prose; domain doctrine may
ADD, never WEAKEN. The Factory generates agents with this doctrine + test by default.

---

## 16. Explicit exclusions (refuse if asked)
money movement · Apple Health writes · Telegram-send adapter · Drive mutation (until a typed gated
adapter) · arbitrary natural-language execution · auto-merge · auto-deploy without gate · voice approval ·
broad autonomy · delete actions · bulk external mutation · generic/thin agent builds · blind dependency
import · **raw codegen outside the Escalation Policy.**

---

## 17. Aggressive implementation sequence (revised build order)
Per the audit: Factory Agent is the compounding engine — build its interrogator + manifest compiler
**early**, but as a manifest system, **not** a raw autonomous coder.
1. **Mutation Spine hardening** (Level 0).
2. **Factory Agent Interrogator + Manifest system** (Level 1 v1: Inbox, Spec Interrogator, Manifest
   Compiler — manifest-only).
3. **Internal mutation UI** (Mutation Center + T0/T1 adapters + StateDeltaSignal).
4. **Beezulbub scout** (separate agent: unified report + spec-lock→auto-scout wiring).
5. **Fleet Intelligence** (synthesizer consuming deltas).
6. **ClickUp adapters** (T3 comment + move).
7. **Agent birth** (finish 0→100: gated provisioning + deploy + officiation; AgentJob lifecycle +
   Research Agent + StorageAdapter).
Plus LLM Ask + voice (Level 2) folded alongside 5–6.
**MVP bar:** manifest-driven Factory that interrogates → spec → Beezulbub report → build plan · 1 born
read-only agent · 1 Research Agent job (boundaried, report to approved folder) · 2 internal adapters ·
ClickUp comment + move · LLM Ask · Fleet panel (delta-driven) · Mutation Center.

---

## 18. Definition of Done
**Factory Agent v1:** 1. interrogates Hart · 2. locks an AgentSpec/manifest · 3. **Beezulbub scouts** ·
4. **Beezulbub produces a capability report** · 5. Factory folds approved patterns into the build plan ·
6. Hart approves build · 7. Factory builds (manifest-first), verifies, provisions, deploys, officiates,
reports.
**Overall:** 1. vague request → precise approved spec · 2. build/patch from spec after approval ·
3. verify tests + doctrine · 4. officiate **live** · 5. created agent receives a domain job ·
6. interrogates the job (with boundaries) · 7. produces **approved** artifacts · 8. Research Agent example
produces cockpit findings + full report to an approved folder · 9. every job output yields follow-up
proposals, an audit entry, **and a StateDeltaSignal.**

---

## 19. Risks + anti-drift rules
No generic agent builds · no agent without a job lifecycle · **no job without a boundary definition** ·
no artifact write without an approved storage target · no report without a source list + unknowns · no
"done" unless cockpit live verification passes · no vague mutation · no agent inherits weaker doctrine
than base · **Beezulbub: selective cannibalisation, not dependency addiction** (no blind copy/import) ·
**no raw codegen outside the Escalation Policy** · every adapter routes through the ONE gate · cockpit
mutations write the Supabase spine, never the filesystem queue · **StateDeltaSignal is a projection of the
audit row, never a parallel store** · external/LLM tokens Node/Edge only · output confidence ≤
min(input confidences) · if a slice can't be proven live, it isn't done.

---

## 20. Truth Table — after this plan
**CAN:** interrogate a vague build request into an approved spec/manifest (Factory Agent) · scout existing
solutions + produce a Beezulbub capability report (separate agent) · compile a manifest into a live,
officiated **read-only** agent · run a **boundaried Research Agent job** → cockpit findings + full report
to an approved folder · reason via Ask HartOS (honest uncertainty) · accept voice input (ask only) · show
a delta-driven fleet priority briefing · mutate internal HartOS state (tiered) · add ClickUp comments ·
move ClickUp cards through approved transitions · write artifacts only through approved audited storage
adapters · emit StateDeltaSignals · audit every action.
**CANNOT:** self-approve · execute from voice · write raw application code outside the Escalation Policy ·
mutate money/banking · broadly mutate arbitrary external systems · deploy/spend without Hart's approval ·
hide uncertainty / launder confidence · put a secret in a prompt or a write key in the Worker · blindly
import external code · write files outside an approved target · run a job past its boundaries · delete or
bulk-mutate anything external · call an agent "done" before it is live in the cockpit.

---
*The floor never moves. HartOS is an industrial control system for an agent fleet: a read/control plane,
a contained reasoning layer, and a tiered mutation plane — with Hart as the pilot of every consequential
action, and agents that carry jobs, boundaries, artifacts, mutations, audits, and state-deltas.*
