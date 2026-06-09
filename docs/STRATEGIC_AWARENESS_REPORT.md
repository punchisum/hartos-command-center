# Strategic Awareness Report — 2026-06-09

Sprint type: awareness / executive-intelligence, not architecture, not new agents.
Goal: move HartOS from "answers when asked" → "notices and surfaces before Hart asks".
No autonomy, no gate/security/execution changes.

```
Before:  Hart asks → HartOS answers
After:   HartOS observes → notices → surfaces → Hart decides
```

---

## Current Awareness Gaps (before this patch)

The intelligence layer was already rich — perception (staleness/drift/fleet health/blind
spots), forecast (data-rot, capability gaps, stalled decisions, compounding), fleet synthesis
(correlated top risks), fleet brain (ranked briefing). The Agent Depth patch added per-agent
`risk`/`opportunity`. But:

1. Per-agent risk/opportunity was computed and then **never aggregated** into one view.
2. There was **no opportunity layer** at the strategic level — only risks got synthesized.
3. **Drift** (data/project/confidence/backlog) was not a first-class concept.
4. Blind spots were collected by perception/forecast but **never unified** into "questions Hart isn't asking".
5. No **Strategic Brief** — no single "what should I be aware of?" surface.
6. No **recommended focus** — the one thing to look at across all signals.
7. **Project drift** (blocked AND stale = dying initiative) wasn't named as drift.
8. **Confidence drift** (panels degrading to low/unknown) wasn't tracked.
9. **Backlog drift** (proposals aging) lived only inside forecast, not in an awareness brief.
10. No **honesty floor** for awareness — nothing returned UNKNOWN when evidence was thin.

---

## What Was Built

### Pure aggregator — `src/awareness/strategic-awareness.ts`
`strategicAwareness(input) → StrategicBrief`. Pure, deterministic, Worker-safe (types only).
Reads already-grounded signals: the domain panels' coach/triage fields (from the Depth patch),
the freshness report, and the proposal queue — plus **optional** perception/forecast/synthesis
when a caller has them (the Ask path doesn't; a dashboard view could). Same inputs → same brief.

The brief: `{ status, risks[], opportunities[], drift[], blindSpots[], recommendedFocus, note }`.

### Risk detection (Part A)
- **Ops operational risk** — stall / missing-follow-up / import-failure (from `triage_risks`).
- **Fitness physiological risk** — injury / under-fuel / blind-flying (from `coach_risk`).
- **Stale-data risk** — from the freshness report's stale domains.
- **Cross-system enrichment** (when supplied) — synthesis correlated risks (severity ≥ 2 only),
  high-severity forecast consequences, perception criticals.
- Each: `{ risk, why, evidence, confidence, suggestedAction }`. Confidence is carried from the
  source field — never invented.

### Opportunity detection (Part B)
- **Ops quick win** — cheap decision/approval clears (from `triage_opportunity`).
- **Fitness opportunity** — unused capacity / cheapest recovery win (from `coach_opportunity`).
- Each: `{ opportunity, why, upside, confidence, suggestedAction }`. Upside is the real signal,
  never a fabricated number.

### Drift detection (Part C) — the genuinely new dimension
- **Data drift** — domains slipping stale/unavailable in the freshness window.
- **Project drift** — work that is BOTH blocked AND stale (an initiative quietly dying).
- **Confidence drift** — a detected panel reporting low confidence (the system trusts itself less).
- **Backlog drift** — proposals aging past the threshold (default 72h) without a decision.
- Each: `{ drift, evidence, impact, suggestedCorrection }`.

### Blind-spot detection (Part D)
- Unavailable domains, missing-source panel gaps, and perception/forecast blind spots — deduped
  into **questions Hart should be asking** (e.g. "Are you flying blind on fitness?").

### Strategic Brief + honesty + noise control (Parts E/F/G)
- **Recommended focus**: the single highest-leverage finding (top high-confidence risk → sharpest
  drift → best opportunity). Always points at a real finding; null when none.
- **Honesty floor**: no detected panel AND no cross-system reports → `status: insufficient_evidence`
  (UNKNOWN), empty lists, honest note. Awareness is earned by data.
- **Noise control**: dedup by normalized text; risks capped at 4, opportunities 3, drift 3, blind
  spots 4; synthesis risks gated to severity ≥ 2; backlog drift only past the aging threshold.

### Agent integration (Part H)
The cores already emit the per-agent signals (Depth patch); this layer **aggregates**, it does not
duplicate. Cross-system perception/forecast/synthesis are reused as optional enrichment, not rewritten.

### Surface — Ask intent (`strategic_brief`)
New intent + `answerStrategicBrief`. Routes "what's drifting?", "strategic brief", "what should I
be aware of?", "what am I not seeing?", "surface risks", etc. — verified distinct from `daily_brief`
("what needs my attention today?") and `strategy_review` ("what am I missing?"). Creates zero proposals.

---

## Before / After

**Before** — "What's drifting?" → routed to `unknown` (no such concept). The only way to learn about
risk was to ask each agent separately; drift, opportunity aggregation, and blind-spot questions didn't exist.

**After** — "What's drifting?" → **Strategic brief — Chief of Staff** (real output, grounded panels):
```
Recommended focus: Operational risk in the ops queue — Triage the 3 blocked cards first.

Top risks:
- Operational risk in the ops queue (high) — … Evidence: Stall risk: 3 blocked AND 4 stale … → Triage the 3 blocked cards first.
- Training/recovery risk today (medium) — … Evidence: Hard session on low recovery — pushing it risks injury. → Swap for easy mobility.
- Decisions are running on stale data (high) — … Evidence: Stale domains: ops. Ops is stale. → Re-run the ClickUp import.

Top opportunities:
- A cheap ops unblock is available (high) — Upside: 2 items parked on a decision from you … Quick win. → Clear the parked decisions/approvals now.

Drift signals:
- Data drift — the dashboard is diverging from reality — stale: ops. Impact: Decisions get made on a picture that no longer matches the board.
- Project drift — blocked work is also going stale — … Impact: Initiatives that are stuck and untouched stop being anyone's responsibility and rot.
- Confidence drift — Ops is operating on thin data — Ops panel confidence is low (missing source: dd_reports). Impact: Low-confidence answers look like answers.

Blind spots (questions to ask):
- Ops: a source is unwired — what would it show if connected?

3 risk(s), 1 opportunity(ies), 3 drift signal(s), 1 blind spot(s) — surfaced from grounded signals only.
```

**Honesty floor** — with no resolved panels: `Status: UNKNOWN. Insufficient evidence for a strategic
brief — no domain panel has resolved live data yet. Configure/refresh the agent sources first.`

---

## Tests (Part I)

`tests/strategic-awareness.test.ts` — 10 benchmark scenarios:
- **Honesty**: failure (no data → UNKNOWN), weak (clean panel → nothing surfaced).
- **Risk**: excellent (ops triage + stale data → two grounded risks), fitness coach_risk carries confidence.
- **Opportunity**: excellent (ops + fitness → upside + action), weak (no fields → none, no fabrication).
- **Drift**: excellent (data+project+confidence+backlog), backlog only past threshold.
- **Blind spots**: unavailable domain + missing source → questions.
- **Noise control**: dedup identical risks, caps hold (3 stale domains → one stale-data risk).
Plus 3 router tests in `cockpit-intent-router.test.ts` (detection distinctness, Chief-of-Staff
contract, UNKNOWN honesty floor).

---

## Remaining Limitations / Future Opportunities

- **No dashboard panel** this sprint — the brief surfaces via Ask only. A `strategicBriefView` +
  conditional panel (passing perception/forecast/synthesis for cross-system corroboration) is the
  next step; the pure core already accepts those inputs, so it's wiring-only.
- **Drift velocity** is not measured (stale-but-holding vs rapidly-sliding) — needs time-series state.
- **Cross-system enrichment** (perception/forecast/synthesis) is supported by the core but not yet
  fed in on the Ask path (the router has panels only). The dashboard view would supply them.
- **Multi-day fitness trends** (HRV trajectory, sleep debt) live in the fitness-trigger repo and
  aren't yet threaded into the cockpit's awareness signals.
- **Per-card business weighting** (ops-agent-v2 `businessWeight`) isn't yet a risk-ranking input.

---

## Verification Summary

| Check | Result |
|-------|--------|
| TypeScript build | ✅ Clean (0 errors) |
| Tests | ✅ 2133 pass / 0 fail (was 2120; +13 new) |
| Smoke (`smoke:hosted`) | ✅ All checks green |
| Security / gates / execution | ❌ Unchanged |
| New agents / architecture | ❌ None |
| Proposals created by the intent | ✅ Zero (awareness is read-only) |

### Files Changed
- `src/awareness/strategic-awareness.ts` — NEW pure aggregator (risks/opportunities/drift/blind-spots, honesty floor, noise control)
- `src/cockpit/cockpit-intent-router.ts` — `strategic_brief` intent + `answerStrategicBrief` + brief renderer
- `tests/strategic-awareness.test.ts` — NEW (10 benchmark scenarios)
- `tests/cockpit-intent-router.test.ts` — +3 tests (detection distinctness, contract, UNKNOWN floor)
- `package.json` — register new test file

### Branch / Commit
- Branch: `feat/agent-runtime-provision-18d`; commit follows `3675f93`.

---

*Strategic Awareness sprint completed 2026-06-09. Push requires explicit Hart authorization.*
