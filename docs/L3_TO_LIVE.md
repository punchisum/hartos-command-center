# L3 → LIVE — the finish line (2026-06-09 EOD)

The whole L3 master plan (Levels 0–4) is **code-complete, tested (2191 green), local, unpushed**.
By the plan's own rule — *"if a slice can't be proven live, it isn't done"* — what remains is not
architecture, it's **proving it live**. This is the tracked finish line.

Branch: `feat/agent-runtime-provision-18d` · 16 commits unpushed.

---

## Tomorrow's three headline goals (Hart, 2026-06-09)
1. **Full wire** — close every "built but not connected" seam (below).
2. **HartOS LLM reasoning** — Level 2A live: real LLM inference behind the capability-token
   Node/Edge in the Ask path (propose-not-execute, honest uncertainty, rule-based fallback).
3. **Build a full agent in the cockpit** — birth one small agent end-to-end, live (the DoD graduation).

---

## The 2 GATES (yours — creds/flag/go; nothing live until these)
- [ ] **G1 — Push/deploy.** Push the branch, deploy Cockpit V2 + the awareness/memory/mutation stack.
      *Done when:* hosted cockpit serves V2 and `/health` is green.
- [ ] **G2 — Fire the mutation canary.** Arm `ALLOW_EXEC_CLICKUP_MOVE=true` + `CLICKUP_API_TOKEN`,
      dry-run one card, approve, fire, verify, disarm (`docs/MUTATION_GO_LIVE.md`).
      *Done when:* one real ClickUp card moved through an approved transition, audited, reversible.

## The 5 BUILDS (mine — code, tested, inside the floor)

### B1 — Finish "approve → it moves" host glue  *(tomorrow: full wire)*
- [ ] `npm run execute:approved` entrypoint: read approved proposals from the spine → build the
      ClickUp store from `CLICKUP_API_TOKEN` → `executeApprovedProposals` → advance proposal to `executed`.
- [ ] Persist the mutate rehearsal as an **approvable** queue item (so "put it on hold" → approve → moves).
- *Done when:* approving a move proposal in the cockpit causes the host executor to move the card
  (flag on), with the proposal advanced to `executed` + a StateDelta emitted. Engine
  (`approved-executor.ts`) is built + tested; this is the glue + status bookkeeping.

### B2 — Archetype-loads-live  *(makes a born agent LIVE)*
- [ ] Command-center loads a created agent's archetype JSON (contract + read-model config) at runtime
      and auto-officiates it: fleet card + detail + a real signal — no hand-coding.
- *Done when:* dropping an officiated archetype makes the agent appear in the fleet, reading its
  read-model and emitting a signal.

### B3 — Depth-by-default archetype  *(makes a born agent SMART)*
- [ ] Scaffold template ships a deterministic reasoning core (verdict + **risk** + **opportunity**,
      Coach/Operator/CTO shape) + Awareness/Memory hooks.
- *Done when:* a freshly-scaffolded agent emits a banded verdict with risk/opportunity and feeds the
  Strategic Brief + Executive Memory — smart by construction, not retrofitted.

### B4 — Typed-task spine  *(makes a born agent USABLE)*
- [ ] Wire AgentJob so a born agent receives a domain job → boundaried interrogation → approved
      artifact + follow-up proposal + `StateDeltaSignal`.
- *Done when:* the agent takes a job, stays inside its boundary, and drops an approved artifact +
  a cockpit proposal + an audited delta.

### B5 — HartOS LLM reasoning live (Level 2A)  *(tomorrow: LLM reasoning)*
- [ ] Real LLM inference behind the capability-token Node/Edge in the Ask path: provider-select ·
      redaction · output-validate · usage-log · **rule-based fallback** · risk-rated answer citing
      freshness/gaps · **propose-not-execute**. Worker stays key-free.
- *Done when:* Ask HartOS reasons with an LLM (honest uncertainty, cites freshness/gaps) and falls
  back to the deterministic path cleanly; no key in the Worker; voice can ask, never execute.

---

## The graduation run (ties B2+B3+B4 together)
- [ ] **Birth one narrow agent end-to-end, live** — e.g. the *tax/invoice monitor*:
      vague request → Interrogator → locked spec/manifest → Beezulbub scout → build plan (approved) →
      scaffold + gated provision → **officiate LIVE** → it reads data and drops a proposal in the
      cockpit → its proposal flows into the mutation spine (approve → executor → ClickUp).
- *Done when:* every step in the plan's §18 Definition of Done passes **with live cockpit verification.**

---

## Invariants that never move (carry into all of the above)
Propose-don't-act · human approval gate on every consequential action · read-only Worker, no DB/ClickUp
key · execution flags default-OFF + kill-switch · honesty floor (UNKNOWN / INSUFFICIENT_* over
fabrication) · output confidence ≤ min(input) · no self-approve · no voice-execute · no raw codegen
outside the Escalation Policy · no money mutation · no deploy/spend without Hart.

---

*Order tomorrow: B1 → G2 (prove the act-loop on one card) · then B5 (LLM reasoning) in parallel ·
then B2+B3+B4 → the graduation run (birth one agent). G1 (push/deploy) whenever you're ready to go
hosted. The machine is built; tomorrow we prove it live.*
