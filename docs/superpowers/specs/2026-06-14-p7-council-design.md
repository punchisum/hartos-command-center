# P7 — Multi-Level Agent Orchestration ("the Council") — Design

**Date:** 2026-06-14
**Status:** Approved design (interviewed with Hart). Next: implementation plan.
**Scope:** The governance + architecture design for HartOS Phase 7 — a recursive multi-agent **Council** that turns a goal into one synthesized, Hart-approvable proposal. This document is the *contract*; the build is made to it. Strictly **propose-only** — it adds no new execution surface and rides the P1–P6 fence.

---

## 1. Goal

Let Hart state a goal ("I want to build a SaaS CRM") and have HartOS **convene a council** of specialist agents (and recursive sub-coordinators), gather their findings, and **synthesize one proposal** — with consensus and dissent surfaced — for Hart to approve. Multi-LEVEL = a coordinator that fans out to specialists *and* to sub-coordinators that recurse. The dangerous capability (execution) is never added: the Council only ever produces a **proposal**.

## 2. Why this is safe (it rides the existing fence)

HartOS has two execution paths (see the P6 design): path (a) the public Worker, permanently execution-disabled; path (b) the trusted local daemon, which runs gated/approved mutations. **The Council adds neither.** It is a propose-only orchestration job: it reasons and writes a `CouncilProposal` into the existing proposal spine, which then flows through Hart's existing approval gate exactly like every other proposal. No new mutation adapters, no new execution authority. A Council compromise yields, at worst, a bad *proposal* that Hart can reject.

## 3. The recursive council node (the core mechanic)

Every node — root coordinator or sub-coordinator — runs the **same 6-step cycle**:

1. **Spec** — if the (sub-)goal needs sharpening, route it through the existing **Factory spec-interrogator** (`src/hartos/spec-interrogator.ts`, reused) to grill for specs. A sub-node receives a scoped sub-goal + parent context instead.
2. **Convene** — select the panel: a **deterministic registry shortlist** (capability-match against `src/agents/meta-agent-registry.ts`) → an **LLM coordinator refines/justifies** the panel (hybrid selection). Each panelist is tagged *leaf specialist* or *sub-coordinator*.
3. **Fan out** — dispatch panelists **concurrently**, bounded (`MAX_PANEL` per node). A leaf specialist produces a finding; a sub-coordinator recurses (capped at `MAX_DEPTH`).
4. **Gather** — collect findings; on a specialist failure/timeout, **degrade gracefully** (synthesize from what returned) and record the gap honestly.
5. **Synthesize** — an LLM **CTO-voice** coordinator fuses the findings into one node recommendation + **consensus/dissent** + a confidence band, applying the no-laundering clamp (doctrine §19; reuse the `fleet-synthesis`/`decision-synthesis` patterns).
6. **Bubble up** — a sub-coordinator returns its synthesis as a **single finding** to its parent; the root emits the `CouncilProposal`.

## 4. Specialists are hybrid

A "specialist" is the reasoning unit a node convenes — a **peer panelist** that produces one finding. The **Council Coordinator** is a *separate* synthesis role that fuses panelist findings (it is not itself a panelist). Two kinds of specialist, behind one `Specialist` interface:

- **Reused deterministic brains** where they map: deep research → **Research agent** (`src/research/`), forecast → **Prophet** (`src/prophet/forecast.ts`), perception → **Rinnegan** (`src/rinnegan/perception.ts`). Already live, deterministic, synthesizable.
- **LLM-reasoning specialists** for the new domains: each is a **specialist prompt-contract** (role + output shape) + **grounded facts**, run through the live `ask-llm` gateway seam (`src/llm/ask-llm.ts`, `src/llm/prompt-contracts.ts`). LLM-off → deterministic fallback (an honest placeholder finding, mirroring the existing ask-llm honest-fallback).

### 4.1 Initial specialist roster (decided with Hart)

| Specialist | Lens (the question it answers) | Kind |
|---|---|---|
| **Research** | What's known / prior art / market & domain facts | Reused brain (Research agent) |
| **CTO** | Can we build it? Architecture, effort, technical risk/feasibility | LLM specialist |
| **Financial** | What does it cost / return? Burn, runway, cost-vs-benefit | LLM specialist |
| **M&A** | Build vs. buy vs. partner; acquisition/integration angle | LLM specialist |
| **Legal** | Compliance, liability, regulatory & contractual surface | LLM specialist |

**Prophet** (forecast) and **Rinnegan** (perception) remain available brains the coordinator can convene when forecast/perception is relevant to a goal — they are not in the default panel but are selectable. New specialists are added as **meta-agent registry** entries (so selection can find them) + a specialist prompt-contract.

## 5. Panel selection is hybrid

1. **Deterministic base** — capability-match the goal against the registry to produce a candidate shortlist (auditable, always available).
2. **LLM refine** — the coordinator LLM justifies / trims / reorders the panel for the specific goal. LLM-off → the deterministic shortlist *is* the panel. This keeps selection grounded but adaptive, and never blocks on the LLM.

## 6. The gauntlet (safety + bounds)

- **Arming (fail-closed):** own flag `HARTOS_ALLOW_COUNCIL=true` (default OFF) **AND** the shared kill-switch off (`HARTOS_EXECUTION_KILL_SWITCH≠on`). Default ⇒ disarmed (a council request becomes a no-op skip, honestly reported).
- **Propose-only:** the Council never executes. Its only output is a `CouncilProposal` in the proposal spine. (Conformance test pins this: no council code path reaches a mutation adapter or `executeProposal`.)
- **Hard caps (stop + degrade, never run away):** `COUNCIL_MAX_DEPTH` (default 3), `COUNCIL_MAX_PANEL` per node (default 5), `COUNCIL_MAX_LLM_CALLS` total (default 30), and a **token budget**. Exceeding any cap → stop fanning out, synthesize from what's gathered, and flag the truncation in the proposal. No silent caps.
- **Determinism floor:** with the LLM disarmed, the Council still produces a proposal from the deterministic brains + deterministic selection — just without LLM refinement.
- **Redaction:** every LLM call is redacted (`src/llm/redaction.ts`) — no secret reaches a provider.
- **No-laundering confidence (§19):** synthesized confidence never exceeds the weakest corroborating source; dissent is surfaced, not averaged away.

## 7. Output — the CouncilProposal

A single proposal carrying both the answer and its provenance:

- **New `ProposalDomain`:** `council`. **New `ProposalActionType`:** `council_plan`. (Added to `src/cockpit/proposals/proposal-types.ts`, mirroring how P6 added `self-mod`/`self_mod_plan`.)
- **Payload (the council tree):** the synthesized recommendation + the full tree — who was convened at each node, each specialist's finding, the consensus/dissent, per-node + overall confidence, and any truncation/degradation notes.
- **Lifecycle:** the existing proposal lifecycle (`draft → pending_approval → approved_simulated/rejected/expired`). **Execution stays N/A** — a council proposal is a recommendation, not a mutation.
- **Tiering:** T3 (planning artifact), executable false — same posture as the P6 `self_mod_plan`.

## 8. Integration — reuse the live seams

**Reused (no change to their contracts):** Factory spec-interrogator; meta-agent registry; the brains (Prophet/Rinnegan/Research); the `ask-llm` gateway + providers (gemini→openai→deterministic); the proposal spine + cockpit approval; the live-runner gated-job loop; redaction; executive-memory (capture).

**New pieces (each its own reviewed increment):**
- `src/council/council-coordinator.ts` — the recursive node kernel (the 6-step cycle over injectable ports, like `executeSelfMod`).
- `src/council/specialist.ts` — the `Specialist` interface + the LLM-specialist runner + brain-adapter wrappers.
- `src/council/panel-selection.ts` — registry shortlist + LLM refine.
- `src/council/council-synthesis.ts` — fuse findings + consensus/dissent + confidence clamp.
- `src/llm/prompt-contracts.ts` — new specialist + coordinator + synthesis prompt roles/output shapes.
- `src/cockpit/proposals/proposal-types.ts` — `council` domain + `council_plan` actionType + council-tree payload types.
- `src/jobs/agent-job.ts` + `src/jobs/live-runner.ts` — new `council.orchestrate` job kind (disarmed) + bounded-concurrency fan-out.
- `src/cockpit/panels/council-panel.ts` + a `/api` route — view the council tree + approve.

## 9. Loop-ready for P8

Every council run + Hart's approve/reject decision is captured via the existing executive-memory spine. P8 (reflexive learning) can then recalibrate **which panels/specialists** produce proposals Hart approves — closing the learning loop on the Council itself.

## 10. Build order (incremental, disarmed until the end)

1. Contracts — `council` domain + `council_plan` actionType + council-tree payload types.
2. One LLM specialist end-to-end (specialist prompt-contract + grounded-facts runner).
3. Panel selection (registry shortlist → LLM refine).
4. Single-level coordinator: fan out → gather → synthesize → CouncilProposal (bounded, propose-only, **disarmed**).
5. Consensus/dissent + no-laundering confidence.
6. Recursion (sub-coordinator as a panelist; depth cap).
7. `council.orchestrate` job kind + live-runner wiring (disarmed).
8. Reuse existing brains (Prophet/Rinnegan/Research) as specialist organs.
9. Council cockpit panel (view tree + approve).
10. Memory capture → P8-ready. Arm last (`HARTOS_ALLOW_COUNCIL`) — Hart's gate.

## 11. Tunables / open items (decide during implementation)

- Caps: `MAX_DEPTH=3`, `MAX_PANEL=5`/node, `MAX_LLM_CALLS=30`, token budget — starting values; tune from real runs.
- ~~Initial specialist roster~~ — **decided** (§4.1): Research (reused brain) + CTO, Financial, M&A, Legal (LLM specialists); Prophet/Rinnegan selectable.
- Concurrency mechanism on the daemon (bounded `Promise.all` pool) + per-specialist timeout.
- Whether sub-coordinator selection is LLM-decided per node or capped by a structural rule.
- Exact consensus/dissent metric (agreement count + corroboration score).

## 12. Safety invariants (must always hold)

- **Propose-only:** no council path ever executes; output is only a proposal. The public Worker stays execution-disabled; path (b) gains no new mutation authority.
- **Disarmed by default:** armed only by `HARTOS_ALLOW_COUNCIL` AND ¬kill-switch; the kill-switch overrides everything.
- **Bounded:** depth, panel size, total LLM calls, and tokens are all hard-capped; truncation is reported, never silent.
- **Grounded + honest:** deterministic registry base for selection; LLM-off still yields a proposal; redaction on every call; no-laundering confidence; dissent surfaced.

---

🤖 Drafted with [Claude Code](https://claude.com/claude-code)
