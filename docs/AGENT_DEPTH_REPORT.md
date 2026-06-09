# Agent Depth Report — 2026-06-09

Sprint type: intelligence & decision-quality, not architecture. Goal: turn agents from
"good assistants" into specialized operators with distinct voices and sharper judgment.
No new agents, no gate/security/execution changes.

---

## Current Weaknesses (before this patch)

The reasoning cores were already deep (verdict, drivers, confidence, honest unknowns) — but:

1. **Fitness** never named an injury/overtraining/under-fuel **risk** as a distinct dimension.
2. **Fitness** surfaced no **opportunity** (when to push, the cheap recovery win).
3. **Fitness** answer was flat prose, not a coach's structured call.
4. **Ops** reported counts + verdict but no **business-impact** framing (halted vs busy work).
5. **Ops** never surfaced a **quick win** (cheap unblocks that free others' work).
6. **Ops** didn't name **stall risk** (blocked+stale) or import-failure risk distinctly.
7. The full triage queue / coaching drivers were computed then flattened away by the panel.
8. **Factory** proceeded with builds without **challenging weak plans** in a CTO voice.
9. **Command Center** answers didn't consistently separate facts / interpretation / confidence.
10. **Voice** — fitness/ops/factory all read like the same generic assistant.

---

## Improvements Made

### A. Fitness Agent → **Coach** voice (`src/fitness/coaching-core.ts`, `answerFitness`)
- Added two deterministic reasoning fields to `CoachingAdvice`: **`risk`** and **`opportunity`**.
  - `risk` names the concrete downside: hard-session-on-low-recovery (injury/overtraining),
    under-fuelling (bodyweight falling + low recovery), or blind-flying (planned session, no
    recovery reading). Null when nothing concrete is at risk — never generic "be careful".
  - `opportunity` names the upside: unused capacity (high recovery on a light day), green-light
    quality day, or the cheapest recovery win (protein well behind target). Null when none.
- `answerFitness` now emits the **Coach contract**: `Verdict · Reasoning · Key metrics · Risk ·
  Opportunity · Notes · Recommended action`. Title is "Fitness — Coach".

### B. Ops Agent → **Operator** voice (`src/ops/triage-core.ts`, `answerOps`)
- Added three reasoning fields to `OpsTriage`: **`impact`**, **`risks[]`**, **`opportunity`**.
  - `impact` = COO framing of what the situation means (N threads halted, M time-critical, trust erodes).
  - `risks` = named operational risks: **stall risk** (blocked AND stale = dead project),
    missing-follow-up risk (adrift cards), import-failure risk (stale sync = wrong board).
  - `opportunity` = the cheap high-leverage win (parked decisions/approvals unblock others; adrift cards just need a next action).
- `answerOps` now emits the **Operator contract**: `Situation · Impact · Risk · Opportunity ·
  Recommended action · Confidence · sync status`. All grounded counts preserved.

### C. Factory Agent → **CTO** voice (`answerBuild` + `buildCtoChallenge`)
- `answerBuild` now appends a **CTO challenge** for buildable/too-vague requests — the Factory
  does NOT auto-agree. It states **Feasibility** (PUSH BACK on DO_NOT_BUILD / MERGE / incomplete
  reqs), names concrete **Failure modes** (from the planner's risks), offers the **Cheaper path**
  (simpler alternative when one exists), and ends with a challenge **Verdict** ("DON'T build this
  as specified" when the plan is weak).
- Reads only the deterministic plan the agent-planner already produces — no new plumbing.

### E. Distinct voices
Each answer now reads as its specialist: Coach (fitness), Operator (ops), CTO (factory).
Titles and contract shapes differ; the generic assistant register is gone.

### Confidence (carried from the prior sprint)
Ops states an honest confidence + named source; fitness carries the coach's confidence tag.

---

## Before / After

### Fitness (low recovery, hard session planned, protein behind)
**Before:**
```
Recovery: 28.
Today's plan: hard interval session; completed: no.
Nutrition — calories: ..., protein: 60.
Next adjustment: Recovery is low and a hard session is planned — swap it for rest or light mobility.
```
**After (Coach contract):**
```
Verdict: Recovery is low and a hard session is planned — swap it for rest or light mobility. (medium confidence)
Reasoning: Low recovery with a hard session planned → recovery comes first today.
Key metrics: recovery 28 · plan hard interval session · today done: no · calories … · protein 60.
Risk: Hard session planned on low recovery — pushing it risks injury and digs the fatigue hole deeper. This is the day to back off.
Opportunity: Protein is ~120g behind target — closing it today is the cheapest available win for recovery and adaptation.
Recommended action: …
```

### Ops (3 blocked, 4 stale, 2 waiting, 1 urgent)
**Before:**
```
Ops is red. 1 urgent card and 3 blocked/at-risk cards need attention now.
Main action: Triage the 3 blocked/at-risk cards first.
Cards: 20 active, 1 urgent, 3 blocked/risk, 2 waiting on Hart, 4 stale, ...
```
**After (Operator contract):**
```
Situation: Ops is red. 1 urgent card and 3 blocked/at-risk cards need attention now. (20 active, 1 urgent, 3 blocked/risk, 2 waiting on Hart, 4 stale, ...)
Impact: 3 threads of work are fully halted (blocked); 1 item is time-critical — every day these sit, downstream work and trust erode.
Risk: Stall risk: 3 blocked AND 4 stale — work that's both stuck and untouched tends to become a dead project no one owns. 2 cards with no next action — these are where follow-ups silently go missing.
Opportunity: 2 items are parked on a single decision/approval from you — clearing them is minutes of work that unblocks flow elsewhere. Quick win.
Recommended action: Triage the 3 blocked/at-risk cards first.
Confidence: HIGH (5/5 core ops fields resolved). Source: ops read-model (ClickUp), current.
```

### Factory ("Create a tax agent")
**Before:** plan summary, then proceeds to interrogation.
**After:** plan summary + **CTO challenge** — Feasibility: NOT YET (incomplete reqs);
Failure modes: tax domain needs audit trail + mandatory human approval, rests on missing
document-ingestion foundations; Verdict: answer the open questions before scaffolding.

---

## Benchmarks (Part F)

`tests/agent-depth-benchmarks.test.ts` — 11 scenarios:
- **Coach**: excellent (low+hard → injury risk + protein win), excellent (high+easy → capacity
  opportunity), mediocre (recovery only → conservative + honest unknowns), failure (no signal →
  insufficient_data, no fabrication), blind-flying (plan, no recovery → sync-the-wearable risk).
- **Operator**: excellent (blocked+stale → stall risk + quick win), excellent (waiting/approvals
  → cheap decision clear), mediocre (stale import → capped confidence + named risk), failure (no
  counts → insufficient_data, no fake all-clear), clear (all zero → capacity free).
Plus contract-shape tests in `cockpit-intent-router.test.ts` (Coach/Operator/CTO).

---

## Remaining Gaps / Future Depth Opportunities

- **Command Center (Part D)** got only the confidence carry-over this sprint — a full
  facts/interpretation/confidence/action split of the daily brief + system status is the next
  highest-ROI step. Deferred as lower-ROI than A/B/C here.
- **Fitness** reasons on single-day signals; multi-day fatigue/momentum/consistency trends
  (HRV trajectory, sleep debt, training monotony) live in the fitness-trigger repo and aren't
  yet threaded into the cockpit coach. Surfacing those would add a real performance-analyst layer.
- **Ops** business-impact is structural (halted/critical), not yet weighted by per-card business
  value (the ops-agent-v2 `businessWeight` exists but isn't surfaced in the cockpit answer).
- **Factory** challenge reads the agent-planner's deterministic risks; deeper architectural-debt
  and hidden-dependency detection would need the structured StrategyReviewResult threaded into
  the router (currently only summary strings arrive via orchestrator context).

---

## Verification Summary

| Check | Result |
|-------|--------|
| TypeScript build | ✅ Clean (0 errors) |
| Tests | ✅ 2120 pass / 0 fail (was 2109; +11 new) |
| Smoke (`smoke:hosted`) | ✅ All checks green |
| Security / gates / execution | ❌ Unchanged |
| New agents / architecture | ❌ None |

### Files Changed
- `src/fitness/coaching-core.ts` — `risk` + `opportunity` reasoning on `CoachingAdvice`
- `src/ops/triage-core.ts` — `impact` + `risks[]` + `opportunity` on `OpsTriage`
- `src/cockpit/panels/fitness-panel.ts` — surface coach risk/opportunity as fields
- `src/cockpit/panels/ops-panel.ts` — surface triage impact/risks/opportunity as fields
- `src/cockpit/cockpit-intent-router.ts` — Coach + Operator contracts; Factory CTO challenge
- `tests/agent-depth-benchmarks.test.ts` — NEW (11 benchmark scenarios)
- `tests/cockpit-intent-router.test.ts` — contract-shape + CTO-challenge tests
- `package.json` — register new test file

### Branch / Commit
- Branch: `feat/agent-runtime-provision-18d`; commit follows `052bc18`.

---

*Agent Depth sprint completed 2026-06-09. Push requires explicit Hart authorization.*
