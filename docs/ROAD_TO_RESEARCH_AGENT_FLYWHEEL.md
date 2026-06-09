# Road to the Research-Agent Flywheel (2026-06-10)

The long-term end-state loop:

```
Research Agent → ResearchBrief → Beezulbub scouts → CapabilityReport
→ Factory Agent → AgentManifest → Build/scaffold → Officiator validates
→ Cockpit registers → Fleet intelligence monitors → HartOS governs + improves
```

This is the **research → capability → software → agent → fleet** flywheel — HartOS building HartOS.

## Is this the right end-state architecture?
**Yes.** It is the correct compounding engine and it matches the doctrine (propose-don't-act, gated,
audited, boundaried jobs). It is the only path that lets HartOS grow without Hart hand-building every
agent. Keep it. **But do not build it tomorrow** — it is strictly downstream of a proven execution
floor and a useful cockpit. A flywheel that spins into an unproven mutation spine and an empty cockpit
compounds risk, not value.

## Object contracts — exist vs missing

| Contract | Status | Where |
|----------|--------|-------|
| `ResearchPlan` | ✅ exists | `src/research/research-planner.ts` |
| `AgentJob` + `BoundaryDefinition` + `InterrogationItem` + `OutputArtifact` + `JobScope` | ✅ exists | `src/research/agent-job-types.ts`, `research-job.ts` |
| Boundary gate (fail-closed) | ✅ exists | `src/research/boundary-gate.ts` |
| `StorageAdapter` + `StorageTarget` (local-folder + obsidian, gated) | ✅ exists | `src/research/storage/*` |
| `BeezulbubCapabilityReport` | ✅ exists | `src/beezulbub/capability-report.ts`, `types.ts` |
| `AgentManifest` + compiler + validator | ✅ exists | `src/hartos/manifest-compiler.ts` |
| `ImplementationPlan` (manifest → plan, folds CapabilityReport §19) | ✅ exists | `src/hartos/manifest-build-planner.ts` |
| `AgentContract` / officiation outcome | ✅ exists | `src/hartos/factory-officiator.ts`, `src/agents/agent-contract.ts` |
| **`ResearchBrief`** (findings artifact from a *run* job) | ❌ **missing** | — (only the *plan*/*proposal* exist; nothing runs the job) |
| **`ResearchExecutor`** (runs an approved job → findings → artifacts) | ❌ **missing** | — |
| **findings → `CapabilityReport` bridge** | ❌ **missing** | Beezulbub takes a target, not a ResearchBrief |
| **officiation → cockpit persistence** (`cockpit_agents` write + CockpitState factory-job) | ❌ **missing** | the L1 live-wiring gap |
| `ObsidianNoteProposal` (meaning layer) | ◐ partial | obsidian-storage adapter exists; no proposal contract yet |

## What already works (proven in tests, not live)
- "research X" in the cockpit → a deterministic plan + a **non-executable** AgentJob proposal (§7 gate:
  broad→requested, thin→interrogating, ready→proposed). Boundaries fail-closed. Storage adapters gated +
  idempotent + secret-safe.

## What is missing (the real gaps)
1. **No ResearchExecutor** — jobs are planned + proposed but never *run*; no findings, no artifacts.
2. **No findings→capability bridge** — Beezulbub scouts a target string, not a ResearchBrief; nothing
   converts research output into a CapabilityReport.
3. **No officiation→cockpit live wiring** — a compiled/officiated manifest never reaches `cockpit_agents`
   or the fleet (the same L1 gap that blocks "birth one agent").

## What to build first (when the flywheel becomes the track — NOT tomorrow)
1. **The officiation→cockpit live wiring** (also the L1 graduation): `CockpitState.factoryJobs` +
   `cockpit_agents` persist behind a go-live gate → a born agent appears in the fleet reading data +
   emitting a signal. *This is the highest-leverage first step because it unblocks "birth one agent"
   independent of research, and proves the back half of the flywheel.*
2. **The `ResearchExecutor`** (`src/research/research-executor.ts`): runs an approved AgentJob within its
   boundary → produces a `ResearchBrief` (findings + sources + unknowns) → writes artifacts via the
   gated StorageAdapter. Hermetic-testable; execution gated like every other adapter.
3. **The ResearchBrief → CapabilityReport bridge** + a single end-to-end test: research question →
   approved job → brief → (Beezulbub) capability report → Factory manifest → officiate → cockpit card.

## What to defer
- Full flywheel automation, autonomous research, multi-agent orchestration of births, Obsidian
  narrative sync. All wait until (a) the mutation floor is proven live and (b) one agent has been born
  live into a proven cockpit.

## The honest sequencing
```
[done]      build the contracts + engines
[TOMORROW]  prove the floor (mutation canary) + useful cockpit (data + memory)  ← NOT this flywheel
[next]      officiation→cockpit wiring → birth ONE agent live  (L1 graduation; back half of flywheel)
[after]     ResearchExecutor → ResearchBrief → CapabilityReport bridge (front half of flywheel)
[later]     close the loop end-to-end + automate cautiously
```

The flywheel is the right destination. The fastest way to reach it is to **resist building it now** and
first prove the foundation it must spin on.
