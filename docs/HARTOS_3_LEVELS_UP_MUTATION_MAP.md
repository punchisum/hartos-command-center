# HARTOS — 3 LEVELS UP + MUTATION MAP (master build plan)

**Status:** approved aggressive scope, 2026-06-08. **Supersedes** `HARTOS_PLAN_3_LEVELS_UP.md`.
**Extends** `HARTOS_IMPLEMENTATION_PLAN_TO_80.md` (Phases 0–3 deployed; Phase 3 canary fired+proven)
and `HARTOS_BLUEPRINT_V2.md`. Doctrine source of truth: `DOCTRINE.md` + `HARTOS_SHARED_DOCTRINE.md`.

This is the real map, not a roadmap. It is written to be executed.

---

## 0. What HartOS is (one sentence)
HartOS is one loop with a hard floor: **command → reason → propose → approve → mutate → audit →
refresh state → learn the new state** — where the cockpit is a **read/control plane only** and every
mutation runs **off-Worker through a typed, gated, audited adapter**.

HartOS is **not a vending machine that instantly builds generic agents.** It is a **CTO/operator that
interrogates Hart, sharpens the spec, scouts what already exists, builds only after approval, verifies
reality, and refuses weak or vague requests.**

```
Hart speaks or clicks
  ↓
HartOS reads live context        (read models, anon, Worker)
  ↓
HartOS reasons                   (LLM behind a gate, honest fallback)
  ↓
HartOS proposes TYPED actions    (TypedActionProposal / AgentJob, executable:false)
  ↓
Hart reviews DRY-RUN             (before-state + predicted after-state)
  ↓
Hart approves                    (deliberate click — never voice, never LLM)
  ↓
HartOS executes via gated adapter (Node host / capability-token Edge Function — never the Worker)
  ↓
HartOS writes audit              (append-only, before + after)
  ↓
HartOS refreshes read state      (the new truth)
  ↓
Fleet intelligence updates       (the loop closes)
```

---

## 1. Non-negotiable doctrine (the floor — law, not preference)
- **No approval = no mutation.**
- **No dry-run = no mutation.**
- **No audit = no mutation.** (audit-before AND audit-after)
- **No clear target = refusal.** (vague intent is rejected, not guessed)
- **No secret in prompts.** (redaction before any LLM/external call)
- **No service-role key in the Worker.** Worker is read/control-plane only.
- **Mutation only through typed adapters.** No freeform/natural-language execution.
- **Voice can ask; voice cannot approve or execute.**
- **LLM can reason and propose; LLM cannot execute or approve.**
- **Every external mutation is read-before-write**, with **target confirmation**, an **idempotency
  key**, **audit-before + audit-after**, and a **rollback/correction note**.
- **Every live deploy / migration / irreversible external action needs an explicit final gate**
  unless Hart approved that exact action in-session.
- **Writing an artifact to a folder/store IS a mutation** — same gate, same approval, same audit.

Encoded today for the internal path: `src/doctrine/doctrine.ts` (9 clauses + CI conformance test) and
`src/doctrine/execution-gate.ts` (fail-closed precondition). This plan extends the **same** gate to
every new adapter. No adapter gets its own bespoke gate.

---

## 2. The HartOS topology (the map this plan builds toward)
```
Hart
  ↓
Command Cockpit                 (read/control plane; Mutation Center; Ask; voice)
  ↓
Fleet Brain                     (fleet synthesizer — priority briefing)
  ↓
Specialist Agents
  • Ops Agent
  • Fitness Agent
  • Factory Agent               ── Spec Interrogator
  │                                Beezulbub Capability Scout
  │                                Builder
  │                                Verifier
  │                                Officiator
  • Research Agent
  • Future Agents
  ↓
Agent Job Lifecycle             (Request→Interrogate→Scope→Propose→Approve→Execute→
  ↓                              Artifacts→Summary→Follow-up→Audit→Archive)
Mutation Spine                  (TypedActionProposal + the one gate)
  ↓
Execution Adapters              (internal / ops-mirror / ClickUp / storage)
  ↓
External Systems / Artifact Stores  (cockpit_proposals, ClickUp, local/Obsidian/GitHub/Supabase Storage)
```
Every specialist agent is a HartOS **agent with a job lifecycle**, not a script. The Factory Agent is
the agent that **builds other agents** under doctrine; Beezulbub is a **capability inside the Factory
Agent**, not a side tool.

---

## 3. Architecture stress-test (ruthless: what's real, thin, or redundant)
Read before building. It changes the sequence and kills several "build from scratch" assumptions.

1. **The mutation spine is NOT greenfield — it is the generalization of the proven refresh-sync path.**
   `execution-adapter.ts` (`runExecutionAdapter`: audit-attempt → gate → execute → audit),
   `adapters/refresh-sync.ts`, `run-refresh-sync.ts/-db.ts` already ARE the spine for one action. Work
   = **promote `ExecutionAdapter` to a typed-action contract** + adapters + a UI. Don't rebuild the engine.

2. **Mutation Tiers 0–1 already ship — surface, don't rebuild.** The Edge Function
   `persist-cockpit-proposal` does conditional `approve`/`reject`/`refresh_sync` with append-only audit;
   `proposal-queue.ts` owns the full two-key lifecycle.

3. **Beezulbub is the MOST-built, LEAST-wired engine in HartOS — promote + wire, do NOT rebuild.**
   ~33 modules under `src/beezulbub/` already cover Scout (`scout.ts`, `live-scout.ts`,
   `github-search.ts`), Evaluate (`score.ts` 7-dimension, `license-check.ts`, `poison-filter.ts`),
   Extract (`capability-extractor.ts`, `digest.ts`), Reject (`poison-filter.ts`, `license-check.ts`),
   Propose (`adaptation-plan.ts`), plus `capability-registry.ts` + `provenance-ledger.ts` (audit) and
   the whole pack lifecycle. **The gap is wiring, not capability:** no unified `BeezulbubCapabilityReport`
   type (data is scattered across RepoDigest / AdaptationPlan / PackManifest); scout is **manual CLI**,
   not triggered by spec-lock; no feedback into the Factory build plan. See §5.

4. **The Factory has the build pieces; it lacks the AGENT brain.** `resolve-agent-spec.ts`, scaffold,
   `provisioning/*` + `launch/*` adapters, `open-agent-pr.ts`, officiation all exist;
   `src/cockpit/agent-planner/agent-planner.ts` is a **partial** interrogator (classifies + asks
   clarifying Qs). **Genuinely missing:** an Inbox wired into the cockpit intent router, a Spec
   Interrogator **with an approval gate before spec-lock**, and an **active Repair Loop** (today only
   manual rollback-plan generation exists). See §4 LEVEL 1.

5. **Research-planner exists but has no job lifecycle.** `src/research/research-planner.ts` decomposes a
   question into a `ResearchPlan` (subQuestions + requiredInputs + unknowns, never fabricates).
   **Missing:** interrogation-before-plan, scope-lock, the `AgentJob` per-job state machine, and the
   planner→gather→synthesize→report wiring. See §6/§7.

6. **Artifact writes today are freeform = the anti-pattern.** ~800 JSON report files across gitignored
   `*-reports/` dirs (cockpit-reports, read-model-reports, llm-reports, …) written directly to disk —
   **none typed, gated, or audited.** This is the filesystem-as-DB sprawl the audit flagged. §8 makes
   artifact-writing a typed, gated, audited mutation via a StorageAdapter family.

7. **External (ClickUp) + LLM tokens cannot live in the Worker.** Adapters run Node/Edge with a
   capability token — the split the canary proved. Worker stays key-free.

8. **Reconcile, don't fork.** `COMMAND_CENTER_ACTION_CONTRACT.md` + `src/command-center/action-contract.ts`
   define an action contract; the `TypedActionProposal` (§11) and `AgentJob` (§6) **extend** it.
   `HARTOS_SHARED_DOCTRINE.md` exists and the Factory injects it (410210e) — pillar = a **conformance
   gate**, not new prose.

**Net effect:** the new pillars are mostly **wiring + interrogation + repair + a unified report/job
contract** over heavily-built machinery — NOT greenfield. Sequence accordingly (§16).

---

## 4. The levels (collapsed + re-sequenced)

### LEVEL 0 — Safety foundation (mostly done; finish hardening FIRST)
**Done:** deployed cockpit, doctrine-as-code, approval spine, proposal lifecycle, audit table,
fail-closed gate, refresh-sync canary fired+proven.
**Remaining hardening (before broadening mutation):** strict TLS for the DB executor (Supabase CA) ·
**server-side live proposal-status verification before execution** (gate must re-read the live row;
single most important gap) · global kill-switch + per-action allowlist verification tests ·
`audit:tail` confirmation tooling · branch/main consolidation.
> Files: `run-refresh-sync-db.ts`, `doctrine/execution-gate.ts`, new `scripts/audit-tail.ts`.
> Tests: gate denies on stale/expired/mismatched live status; kill-switch + allowlist bite.
> Verify: `npm run canary:refresh-sync` shows `tls: strict`; a tampered status is refused.
> Fails-if: the gate allows on an asserted-but-not-live status.

### LEVEL 1 — Factory Agent v1: a functioning Software Factory Agent
**The Agent Factory is not tooling. It is a HartOS agent — the Factory Agent (Software Factory Agent).**
It receives a build request from the cockpit, interrogates Hart, produces a sharp spec, scouts existing
solutions (Beezulbub, §5), creates the build plan, builds/patches/scaffolds, verifies, provisions/deploys
through gates, officiates the created agent, verifies it is live, and proposes repairs if it fails.

**One born agent is the proof. The real product is the Factory Agent that can repeatedly birth agents
under doctrine.**

The Factory Agent has nine capabilities:

1. **Inbox** — receives build requests from the cockpit; classifies each as **buildable / too-vague /
   unsafe / already-solved**. *(Exists partial: `agent-planner.ts` + request-classifier; gap: wire into
   `cockpit-intent-router.ts` as the FIRST step.)*
2. **Spec Interrogator** — grills Hart before building: refuses vague generic requests, asks
   domain-specific questions, detects contradictions, forces measurable outputs, defines what "done"
   means in the cockpit. *(Gap: an approval checkpoint + risk/cost/prereq validation BEFORE spec-lock.)*
3. **Spec Lock** — produces the exact `AgentSpec`: purpose · domain · data source · read model · output
   contract · proposal types · mutation rights · cockpit UI · freshness rules · failure modes ·
   do-not-do list · acceptance tests. **Hart must approve the spec before any build.**
4. **Build Planner** — converts the approved spec (+ Beezulbub report) into an implementation plan:
   files touched · migrations · tests · provisioning · deploy gates · rollback. **Hart must approve the
   build plan before repo mutation.**
5. **Builder / Executor** — scaffolds or patches the repo; creates a branch or local-branch/PR; runs
   typecheck / tests / secret scan / doctrine scan. **No auto-merge. No deploy without deploy approval.**
6. **Provisioner** — prepares a **gated** infra plan (Supabase / Cloudflare / Trigger / GitHub /
   read-model config). **Cost-bearing or irreversible steps require explicit Hart approval.**
7. **Officiator** — registers the created agent into the cockpit: loads agent contract + agent signal +
   read-model config; shows card + detail page; **verifies the agent is visible, reading data, and
   emitting a proposal.**
8. **Repair Loop** — on build/test/deploy/officiation failure, diagnoses the failure, proposes an exact
   repair patch, **does not hide failing tests, does not mark the agent complete until live verification
   passes.** *(Gap: today only manual rollback-plan generation exists — make it active, gated by
   `ALLOW_REPAIR_LOOP`.)*
9. **Audit Trail** — every build action, gate, deploy, test, failure, repair, and final verification is
   recorded.

**Factory Agent doctrine (law):**
- Cannot build from vague intent. Must interrogate before spec.
- Must produce measurable acceptance criteria; must define read source, output, proposal type, cockpit
  UI, and failure mode.
- Must ask Hart to approve the **spec** before build, the **build** before repo mutation, the
  **deploy/provision** before live resources.
- Must **refuse** if the requested agent would be thin, unsafe, unmeasurable, or generic.
- Must never weaken shared doctrine. Must never self-approve. Must never auto-merge.
- Must never call an agent "done" until it appears **live in cockpit and emits a real signal/proposal.**

> Files (cmd-center): `cockpit/agent-planner/agent-planner.ts`, `cockpit-intent-router.ts`,
> `hartos/{request-classifier,build-plan,capability-gap,orchestrator,handover}.ts`, `agents/officiation.ts`,
> `agents/agent-contract.ts`, `read-models/agent-signal.ts`, new `cockpit_agents` table + Edge read,
> `scripts/agent-{scaffold,runtime-provision,data-provision,approve-execution}*.ts`.
> (factory): `resolve-agent-spec.ts`, `create-agent-project.ts`, `archetype-monitoring.ts`,
> `open-agent-pr.ts`, `templates/runtime/src/{provisioning,launch,bootstrap}/*`.
> Tests: classifier routes the 4 verdicts; interrogator refuses a vague spec; spec-lock requires
> approval; officiation contract-loader; repair loop diagnoses a forced failure.
> Deploy/migration: `cockpit_agents` table; Worker redeploy. **Gates:** spec, build, provision/deploy
> all Hart-fired. Rollback: drop registry row; un-deploy; adapter.rollback() for reversible steps.
> Verify: a real born read-only agent appears live, reads data, emits a proposal.
> Fails-if: an agent ships without interrogation, or is called "done" while not live.

**Honest limit:** a born agent is a **read-only monitor** — it proposes; it does not get its own
mutation adapters on day one. "0→100" runs the pipeline end-to-end with the irreversible steps gated.

### LEVEL 2 — HartOS talks back (LLM Ask + voice)
**2A — LLM Ask HartOS:** wire the gateway (`LLM_GATEWAY.md`, `llm-*`) into the Ask path: provider
selection · prompt **redaction** · output validation · usage logging · **rule-based fallback** when LLM
off · **risk-rated answer that cites freshness/gaps** · can propose, cannot execute. Inference runs
behind a capability-token Edge Function / Node (Worker stays key-free).
> Fails-if: any secret appears in a prompt, or an answer can trigger execution.

**2B — Voice seed:** cockpit mic → speech-to-text → Ask → spoken answer; browser-STT privacy caveat
shown; **voice cannot approve, voice cannot execute.**
> Fails-if: any mutation route is reachable from the voice path.

### LEVEL 3 — Fleet intelligence
Fleet synthesizer brain: AgentSignals + proposals + audit + freshness → one **prioritized briefing**
(what matters · why · owner agent · proposed action · risk if ignored · confidence/freshness · exact
blocker). Rule-first; LLM-enhanced only behind the gate; carries confidence forward (no laundering).
> Fails-if: the briefing inflates confidence above any input's confidence.

### LEVEL 4 — Cockpit mutation spine (first-class pillar)
Hart mutates from the cockpit safely — internal first, external last, always typed + gated + audited.
Detailed in §10–§13.

---

## 5. Beezulbub — Capability Scout + Cannibalisation Engine
**Definition:** Beezulbub asks **"has someone already built 70% of this?"** before HartOS builds from
scratch. It is a **first-class capability inside the Factory Agent**, not a side note.

**Purpose:** before the Factory Agent builds a new agent, Beezulbub scouts external open-source repos,
examples, frameworks, docs, templates, and prior HartOS code to identify patterns worth adopting or
cannibalising. **It must not blindly copy code — it evaluates, ranks, and proposes what to extract.**

**Reality (grounding):** Beezulbub is the most-built, least-wired engine in HartOS (~33 modules under
`src/beezulbub/`). The work is **wiring it into the Factory build flow after spec-lock + emitting a
unified report**, not building it.

**Flow (Beezulbub sits AFTER spec draft, BEFORE build approval):**
```
Hart requests new agent → Factory Agent interrogates → Spec drafted
   → Beezulbub scouts existing solutions
   → Beezulbub produces capability acquisition report
   → Factory Agent incorporates approved patterns into the build plan
   → Hart approves build → Factory Agent builds
```

**Responsibilities:**
1. **Scout** — search known repos, GitHub, docs, local HartOS repos, templates, examples; identify
   relevant projects/patterns; compare against the approved `AgentSpec`. *(have: `scout.ts`,
   `live-scout.ts`, `github-search.ts`, `registry.ts`.)*
2. **Evaluate** — license compatibility · maintenance status · dependency risk · security posture ·
   complexity vs usefulness · test coverage · architecture fit · solves-the-actual-problem vs
   looks-impressive. *(have: `score.ts` 7-dimension, `license-check.ts`, `poison-filter.ts`.)*
3. **Extract** — reusable architecture/modules/schema/UI/adapter/testing/deployment/prompt-doctrine
   patterns. *(have: `capability-extractor.ts`, `digest.ts`.)*
4. **Reject** — bloated frameworks · abandoned repos · unclear licenses · insecure patterns ·
   over-engineered abstractions · code that weakens doctrine · repos needing secret/client-data
   exposure · anything encouraging broad autonomous execution. *(have: `poison-filter.ts`,
   `license-check.ts`.)*
5. **Propose** — a **Beezulbub Capability Report**: what to reuse/adapt/reject; cite source repo/docs;
   exact files/patterns to study; why each helps the current `AgentSpec`; risks + required
   modifications; **never auto-import into production without Hart approval.** *(have: `adaptation-plan.ts`,
   `provenance-ledger.ts`; gap: the unified report type below.)*

**`BeezulbubCapabilityReport` (the unifying type to build):**
`reportId` · `agentSpecId` · `searchScope` · `candidateSources` · `acceptedPatterns` ·
`rejectedPatterns` · `licenseNotes` · `securityNotes` · `dependencyRisks` · `doctrineRisks` ·
`recommendedAdaptations` · `doNotUseList` · `confidence` · `unknowns` · `proposedBuildPlanChanges` ·
`sourceLinks` · `auditTrail`.

**Beezulbub doctrine (law):** may scout and recommend; **may not** blindly copy, import unreviewed
dependencies, bypass license/security review, weaken shared doctrine, expose Hart's private code/secrets
to external tools, or turn "cool repo found" into "build this" unless it fits the `AgentSpec`. **Must
prefer small, inspectable patterns over giant frameworks.**

**Warning:** without Beezulbub, HartOS rebuilds commodity pieces from scratch; with **bad** Beezulbub,
HartOS imports bloated/unsafe code. The correct behaviour is **selective cannibalisation, not dependency
addiction.**

> Gaps to wire (from recon): unified `BeezulbubCapabilityReport` type + serializer; spec-lock →
> auto-scout trigger; standardized `beezulbub-reports/` output; build-plan feedback into
> `hartos/build-plan.ts`; explicit `confidence` field; a formal `doctrineRisks` catalog (HartOS
> incompatibilities pre-defined). Network scouting stays behind `BEEZULBUB_ALLOW_NETWORK`.

---

## 6. AgentJob — the universal job lifecycle (every agent, not just the Factory)
A born agent is **not just a card.** Every agent must receive a job, interrogate it, scope it, propose
execution, produce artifacts, summarize results, propose follow-ups, and audit the job.

**`AgentJob` contract (required fields):**
`jobId` · `agentType` · `jobType` · `requestText` · `requester` · `status` · `interrogationQuestions` ·
`answers` · `scope` · `decisionSupported` · `dataSources` · `allowedSources` · `disallowedSources` ·
`outputArtifacts` · `targetFolder` · `cockpitSummary` · `mainFindings` · `localizedImplications` ·
`proposedActions` · `confidence` · `unknowns` · `auditTrail` · `createdAt` · `completedAt` ·
`freshness` · `failureMode` · `rollbackOrCorrectionNote`.

**Lifecycle:**
```
Request → Interrogate → Scope → Job Proposal → Hart Approval → Execute
       → Produce Artifacts → Cockpit Summary → Follow-up Proposals → Audit → Archive / Persist
```

**Rules (law):** No interrogation = no job. No scope = no job. No artifact contract = no job. No target
folder approval = no file write. No audit = no job completion.

> Grounding: `src/research/research-planner.ts` (ResearchPlan) + the cockpit `ActionProposal` are the
> seeds. Gaps: an interrogation module, a scope-lock state, an **enriched proposal** carrying
> `interrogationQuestions/answers/scope/mainFindings/proposedActions/confidence/unknowns`, and a
> per-`jobId` state machine (today state lives per-proposal, not per-job).

---

## 7. Research Agent — worked example of an AgentJob
Hart: *"Research virtual card issuer options for media buying."*
The Research Agent must **not** immediately answer generically. It **interrogates first:**
- What decision is this research supporting? · Which geography matters? · Which human/client/user group?
- Localize for Singapore / Hong Kong / EU / other? · Output depth: quick brief, comparison matrix, or
  full report? · Which sources are allowed? · Web sources allowed? · Internal documents allowed? ·
  Consider legal/compliance, technical integration, cost, approval rate, API quality, or bank optics?
- Where should the full report be saved? · What follow-up actions may it propose?

Then it emits a **Research Job Proposal** (example): *Topic:* virtual card issuer options for media
buying · *Decision supported:* pursue provider A/B/C or pivot · *Scope:* SG/HK/EU providers · *Outputs:*
cockpit executive summary, main findings, localized implications, full report to approved folder, source
list, risk table, unknowns, recommended next actions, follow-up proposals. **Hart approval required
before the full research job starts; Hart approval required before writing the report to the target
folder if the folder is new.**

After execution it produces: cockpit proposal/summary · main findings · localized implications · full
report in the specific folder · source pack · confidence level · unresolved questions · recommended
actions · follow-up proposals · audit entry.

---

## 8. Artifact storage = mutation
**Writing a report to a folder is a mutation.** The write target must be approved. **Agents cannot
randomly write files everywhere** (today's ~800 freeform JSON report files are the anti-pattern to kill).

Each artifact write goes through a **StorageAdapter** — a typed, gated, audited adapter family parallel
to the execution adapters (same gate, same `dryRun`/`execute`, same audit-before/after, same idempotency
key). Approved storage targets: **local folder · Obsidian vault · GitHub repo · Supabase Storage ·
Google Drive (later)** — each its own typed adapter; a **new** target folder requires explicit Hart
approval before first write.

> Build: `src/storage/storage-adapter.ts` + `adapters/{local-folder,obsidian,github-repo,supabase-storage}.ts`;
> an `approved_storage_targets` registry. Tests: write refused without an approved target; idempotent
> re-write; secret scan before write. Fails-if: any agent writes outside an approved, audited target.

---

## 9. Agent roster (examples — input · output · mutation · cannot)
| Agent | Input | Output | Mutation | Cannot |
|---|---|---|---|---|
| **Research** | research topic / decision | cockpit summary + full report + source pack + recommended actions | writes report only to an **approved folder/storage adapter** | send email, make a decision, execute external action |
| **Factory** | build request | spec + build plan + repo patch/PR + tests + deploy proposal + officiated agent | repo patch only after **build approval**; deploy only after **deploy approval** | self-approve, auto-merge, hide failing tests |
| **Ops** | ops/card state | triage + exact card actions | add ClickUp comment / move card only after approval | perform vague "clean ops" mutation |
| **Fitness** | training/recovery/nutrition state | daily recommendation + adjustment proposal | internal plan/proposal state only | mutate Apple Health |

---

## 10. Mutation tiers (build strictly in order)
- **Tier 0 — internal cleanup:** reject all draft proposals · expire duplicate proposals · archive
  rejected · mark reviewed · refresh sync · clear stale internal tasks.
- **Tier 1 — proposal lifecycle:** approve · reject · approve_for_execution · expire · dry-run · execute
  approved internal cleanup. *(Mostly shipped in the Edge Function — wrap + surface.)*
- **Tier 2 — ops mirror (internal):** mark ops item reviewed · resurface waiting card · create internal
  follow-up · tag ops item · mark stale issue handled.
- **Tier 3 — ClickUp (external, last):** **`add ClickUp comment` first, then `move card status`.** No
  delete. No bulk.

---

## 11. The typed mutation contract (`TypedActionProposal`) + state machine
Aligned with `COMMAND_CENTER_ACTION_CONTRACT.md`. Every mutation is an instance. No vague mutation, no
freeform execution.
```
Intent → TypedActionProposal → DryRunPreview → Hart approval → ExecutionGate
       → Adapter execution → Audit row → Read-state refresh → Cockpit result
```
**Required fields** (missing any → refused at the gate): `actionType` · `domain` · `targetId` ·
`targetName` · `beforeState` · `afterState` · `riskLevel` · `reason` · `dryRunResult` · `approvalStatus`
· `executionFlag` · `idempotencyKey` · `auditId` · `rollbackOrCorrectionNote`. The gate
(`checkExecutionPrecondition`) is unchanged and shared by all adapters.

---

## 12. The Mutation Center (cockpit UI spec)
Shows: pending executable actions · dry-run previews · risk · target (id + name) · required approval ·
**Execute Once** button · audit result · refused actions (with reasons) · rollback/correction note.
**Vague mutation is rejected by construction** — ❌ "clean ops" / "handle cards" / "fix proposals";
✅ "reject 8 draft fitness proposals" / "add comment to ClickUp card ABC" / "move card XYZ Waiting → In
Progress". Every button = exactly one `TypedActionProposal` with a confirmed target. No multi-target
"apply to all" in v1.

---

## 13. Safe mutation adapters (the new code)
- **Internal (Tier 0/1):** `reject-drafts`, `archive-rejected` (refresh-sync framework; own
  `cockpit_proposals` only; reversible; idempotent).
- **Ops mirror (Tier 2):** `resurface-waiting`, `mark-reviewed`, `create-internal-followup`.
- **External (Tier 3, last):** `clickup-comment` then `clickup-move-status` — read-before-write (confirm
  `targetName` matches `targetId`), idempotency key, audit before+after, rollback note. Runs Node/Edge
  with the ClickUp token — **never the Worker.**
> Per-adapter: own allowlist flag (default OFF) + kill-switch; dry-run no-writes; gate refuses unarmed;
> idempotent re-run; target mismatch → refusal. Fails-if: writes without a confirmed target, double-posts,
> or runs from the Worker.

---

## 14. Shared doctrine for every agent (verify + enforce — ~80% exists)
`HARTOS_SHARED_DOCTRINE.md` exists; the Factory injects it (410210e). Base doctrine every agent inherits:
propose-before-acting · honest uncertainty · freshness visible · source visible · no secret exposure ·
read-before-write · typed actions only · approval floor · audit trail · idempotency · fail-closed · no
confidence laundering · no cross-agent hidden mutation — **plus** the AgentJob rules (interrogate, scope,
artifact contract, approved target, audit) and the Factory/Beezulbub doctrine above.
**Build = a conformance gate, not prose:** every generated agent must pass a doctrine-conformance test;
domain doctrine may ADD but never WEAKEN the base. The Factory generates agents with this doctrine + the
test by default.

---

## 15. Explicit exclusions (do NOT build — refuse if asked)
banking / money movement · Apple Health writes · Telegram-send as an execution adapter · Google Drive
mutation (until a typed gated adapter exists) · arbitrary natural-language execution · auto-merge ·
auto-deploy without gate · voice approval · broad autonomy · delete actions · bulk external mutation ·
generic/thin agent builds · blind dependency import.

---

## 16. Aggressive implementation sequence (honest re-budget — MVP vertical slices)
The complete map is **~3–4 focused days**; each day ships REAL end-to-end slices, not broad machinery.

**DAY 1 — internal mutation + the Mutation Center (highest leverage, lowest risk):** Level-0 hardening →
`TypedActionProposal` contract → `reject-drafts` + `archive-rejected` adapters → Mutation Center UI.
*Target: HartOS cleans its own proposal queue from the cockpit, safely, fully audited.*

**DAY 2 — Factory Agent v1 spine + Beezulbub wiring:** Inbox/classify → Spec Interrogator + spec-lock
approval gate → wire Beezulbub auto-scout after spec-lock + unified `BeezulbubCapabilityReport` →
build-plan feedback → start the 0→100 spine (defer live provisioning to Day 4). *Target: a vague request
is interrogated into an approved spec, scouted, and planned.*

**DAY 3 — reason, talk, see, touch ClickUp:** `clickup-comment` + `clickup-move-status` adapters → LLM
Ask (2A) → voice seed (2B) → fleet synthesizer + panel (L3). *Target: HartOS reasons, shows fleet
priority, mutates ClickUp safely.*

**DAY 4 — birth one real agent + the job lifecycle:** finish 0→100 (gated live provisioning + deploy +
officiation) → `AgentJob` lifecycle + the Research Agent worked example → StorageAdapter (local +
Obsidian). *Target: one born read-only agent live; Research Agent produces cockpit findings + a full
report to an approved folder.*

**Minimum viable aggressive version (the bar):** Factory Agent that interrogates → spec → Beezulbub
report → build plan · 1 born read-only agent · 1 Research Agent job (report to approved folder) · 2
internal mutation adapters · 1 ClickUp comment + 1 ClickUp move adapter · 1 LLM Ask path · 1 Fleet
Intelligence panel · 1 Mutation Center.

---

## 17. Definition of Done

**Factory Agent v1 is not complete until:**
1. It interrogates Hart. 2. It locks an `AgentSpec`. 3. **Beezulbub scouts for reusable patterns.**
4. **Beezulbub produces a capability report.** 5. The Factory Agent incorporates approved patterns into
the build plan. 6. Hart approves the build. 7. The Factory Agent builds, verifies, provisions, deploys,
officiates, and reports.

**The overall plan is not complete until:**
1. Factory Agent interrogates a vague build request into a precise approved spec. 2. It builds/patches/
scaffolds from that spec after approval. 3. It verifies tests and doctrine. 4. It officiates the created
agent **live in cockpit.** 5. The created agent can receive a domain job. 6. It can interrogate the job.
7. It can produce **approved** artifacts. 8. The Research Agent example produces cockpit findings + a full
report to an approved folder. 9. All job outputs produce follow-up proposals and audit entries.

---

## 18. Risks + anti-drift rules
- **No generic agent builds.** **No agent without a job lifecycle.** **No artifact write without an
  approved storage target.** **No report without a source list and unknowns.** **No "done" unless cockpit
  live verification passes.** **No vague mutation.** **No agent inherits weaker doctrine than the base.**
- **Beezulbub: selective cannibalisation, not dependency addiction** — prefer small inspectable patterns;
  no blind copy; no unreviewed import; license/security review mandatory.
- **Adapter sprawl with bespoke gates** → every adapter routes through the ONE `checkExecutionPrecondition`.
- **Split-brain stores** → cockpit mutations write the Supabase spine; never the filesystem queue.
- **External/LLM token leakage** → tokens in Node/Edge only; extend the Worker-bundle scan to catch them.
- **Confidence laundering** → output confidence ≤ min(input confidences); test it.
- **Plan thinness** → if a slice can't be proven live, it isn't done.

---

## 19. Truth Table — what HartOS can and cannot do after this plan
**CAN:** interrogate a vague build request into an approved spec (Factory Agent) · **scout existing
solutions + produce a Beezulbub capability report** · create/officiate **one read-only agent** end-to-end
· run a **Research Agent job** producing cockpit findings + a full report to an approved folder · reason
through Ask HartOS (LLM, honest uncertainty) · accept voice input (ask only) · show a fleet priority
briefing · mutate internal HartOS proposal state · add ClickUp comments · move ClickUp cards through
approved transitions · write artifacts only through approved, audited storage adapters · audit every
action (before + after).

**CANNOT:** self-approve · execute from voice · mutate money/banking · broadly mutate arbitrary external
systems (only ClickUp comment + move, single-target) · deploy or spend without Hart's approval · hide
uncertainty / launder confidence · put a secret in a prompt or a write key in the Worker · blindly import
external code · write files outside an approved target · delete or bulk-mutate anything external · call
an agent "done" before it is live in the cockpit.

---
*The floor never moves. HartOS is a CTO/operator that interrogates, scouts, sharpens, builds only after
approval, mutates only through typed gated audited adapters, and verifies reality — with Hart as the
pilot of every consequential action.*
