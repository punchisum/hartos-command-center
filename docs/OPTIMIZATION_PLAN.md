# HartOS Optimization Plan — 2026-06-09

Sprint type: optimization, not architecture. No new agents, no new abstraction layers, no gateway changes.

---

## Current Bottlenecks

| Area | Bottleneck | Impact |
|------|-----------|--------|
| Intent routing | "morning", "what should I do?", "today's plan" fell through to `unknown` | High — most natural openers produced no answer |
| Fitness answer | `training_readiness` (full/controlled/easy/rest) computed but never surfaced in Ask | High — highest-value fitness verdict was invisible |
| Ops attention | `attentionSummary` omitted card's `nextAction` field | Medium — every flagged card lacked explicit next step |
| Cockpit grid3 | 15 boxes always rendered; factory-jobs showed "0 jobs" even when empty | Medium — visual noise, below-the-fold clutter |
| Grid3 order | Proposal queue was 3rd; trust box was 2nd | Low-medium — proposals are the primary call-to-action |

---

## What Was Implemented

### 1. Intent routing: natural daily-brief queries (cockpit-intent-router.ts)

**Before:** "morning", "what should I do?", "good morning", "where do I start?", "what's my priority?" → `unknown` intent.

**After:** Routes to `daily_brief` which produces the full grounded morning roll-up (overall verdict, main action, top 3 attention items, per-area status).

Added to `daily_brief` early block (runs before freshness/ops/fitness to avoid being overridden):
- "good morning", "morning check", "start of day", "morning"
- "what should I do today", "what do I do today"
- "where do I start today", "what's today's priority", "todays priority"
- "what's the plan today"

Added to late-fallback block (after all domain routing, so "fix stale ops" still wins freshness):
- "what should I do", "what do I do", "what do I do next"
- "where do I start", "where should I start"
- "what's my priority", "what's my priority"

**Before/after example:**
```
Before: "Morning, what's going on?" → intent: unknown → "I didn't understand that"
After:  "Morning, what's going on?" → intent: daily_brief → full command brief
```

### 2. Fitness answer: surface training_readiness (cockpit-intent-router.ts)

**Before:** `answerFitness()` read recovery, training_plan, calories, protein, adjustment. The derived `training_readiness` field (full/controlled/easy/rest) was computed in `fitness-panel.ts` but never read.

**After:** `training_readiness` is read and shown as the lead line when available:
```
Training readiness: controlled (medium confidence).
Recovery: Amber — HRV 12% below baseline.
Today's plan: Zone 2 run 45min; completed: no.
...
```

**Why this matters:** "full / controlled / easy / rest" is the single most actionable fitness output. It translates recovery band × training plan into a direct instruction.

### 3. Ops attentionSummary: append nextAction (ops-agent-v2/src/digest/card-ranking.ts)

**Before:** Summary: "Blocked · 3d overdue · high business weight"
**After:** Summary: "Blocked · 3d overdue · high business weight → Next: Chase supplier for invoice approval"

When `card.nextAction` is defined and non-empty, it's appended as `→ Next: <action>`. This surfaces in:
- Telegram digest messages
- Proactive alerts
- Cockpit agent signal `reason` field
- All proposal summaries referencing the card

### 4. Cockpit grid3: priority reorder + factory-jobs conditional

**Before order:** suggestions → trust → proposals → mutation center → mutation dispatch → fleet brain → fleet synthesis → autonomy → factory jobs → fresh → perception → orchestration → forecast → audit → activity

**After order:**
- **Tier 1 (action + decisions):** suggestions → proposals → mutation center → fleet brain
- **Tier 2 (signal health):** fresh box → trust box → fleet synthesis
- **Tier 3 (execution + autonomy):** autonomy (only when total>0) → mutation dispatch
- **Tier 4 (history):** audit → activity
- **Tier 5 (intelligence):** perception → orchestration → forecast
- **Suppressed:** factory-jobs hidden when `total === 0`

Proposals promoted to 2nd slot (from 3rd) — they're the primary call-to-action. Freshness moved before trust. Factory jobs suppressed when empty (until first agent is born via go-live wiring). Autonomy preview hidden when no would-queue proposals exist.

---

## Quick Wins (Done)

- [x] Intent routing: 12 natural daily-brief phrases added
- [x] Fitness training_readiness surfaced in Ask answers
- [x] Ops attentionSummary appends nextAction
- [x] Grid3: proposals promoted to slot 2
- [x] Grid3: factory-jobs hidden when empty
- [x] Grid3: autonomy hidden when no proposals

---

## Medium Improvements (Not-Now)

These are real improvements but require more careful changes or more data:

**M1: Ops top-card in Ask answer**
Currently `answerOps()` says "2 urgent cards need attention" but doesn't name the top card.
The top card title + attentionSummary could be appended.
*Blocked by:* the ops panel fields don't currently surface individual card titles — only counts. Would require a new panel field or a separate RPC.

**M2: Fitness data-gap directive**
When `dataQuality` contains "hrv_missing" or "sleep_hours_missing", the readiness answer should say "Action: Open Apple Health and sync" rather than just "unknown".
*Blocked by:* the `training_readiness` field in the panel doesn't yet carry dataQuality reasons. The fitness panel would need a separate `data_gaps` field.

**M3: Proposal queue: merge duplicate domain proposals**
If 3 ops-status proposals exist, they should collapse to 1. The `expireDuplicateProposals()` function handles this but only runs on explicit command.
*Not done:* auto-expiry on queue read would require a write operation in the Worker — violates read-only contract.

**M4: Cockpit chips update**
The ask-bar chips ("What needs my attention today?", "Is my data fresh?", "Anything urgent in ops?", "Show pending proposals", "Research if CoachOS is worth building") are good but "Good morning" would now be the most natural opener.
*Not done:* cosmetic; low priority.

**M5: Freshness staleness threshold tuning**
Currently amber at >2h, red at >6h. For ops data refreshed daily, amber at >12h would reduce noise.
*Not done:* would need review of actual refresh cadence before changing.

---

## Not-Now List

| Item | Why not now |
|------|-------------|
| Dashboard visual redesign | No screenshots provided; analyze-first rule |
| New agents | Hard constraint |
| LLM-backed routing | Adds latency and hallucination risk; keyword routing is honest |
| Obsidian integration | Hard constraint |
| Production deployment of this patch | Requires explicit Hart approval |
| Proposal auto-execution | Hard constraint |
| Freshness thresholds | Need actual data before changing |
| Voice input improvements | Out of scope for this sprint |

---

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Natural daily-brief queries route correctly | "morning" / "what should I do?" / "where do I start?" → `daily_brief` |
| Fitness readiness visible in Ask | `training_readiness` field surfaced when panel available |
| Ops attention summaries actionable | Summary ends with `→ Next: <action>` when card has nextAction |
| Proposal queue is slot 2 in grid3 | Confirmed by test + visual inspection |
| Factory jobs hidden when empty | Confirmed by test |
| All tests green | 2101 pass / 0 fail |
| TypeScript build clean | 0 errors |

---

## Verification Summary

| Check | Result |
|-------|--------|
| TypeScript build (command-center) | ✅ Clean |
| TypeScript build (ops-agent-v2) | ✅ Clean |
| Tests (command-center) | ✅ 2101 pass / 0 fail |
| Tests (ops-agent-v2) | ✅ All pass |
| Security gates touched | ❌ None |
| Approval flows changed | ❌ None |
| Production mutations | ❌ None |

---

## Files Changed

**hartos-command-center:**
- `src/cockpit/cockpit-intent-router.ts` — daily_brief routing expanded; training_readiness field added to answerFitness
- `src/runtime/cloudflare-cockpit-page.ts` — grid3 reorder; factory-jobs + autonomy conditional
- `tests/cockpit-hosted-page.test.ts` — updated for new panel behavior

**ops-agent-v2:**
- `src/digest/card-ranking.ts` — attentionSummary appends nextAction

---

*Optimization sprint completed 2026-06-09. Next: push both repos (requires Hart authorization).*
