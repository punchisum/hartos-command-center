# Executive Memory Report — 2026-06-09

Sprint type: executive memory — history, recurring patterns, decision quality, trends.
Not Obsidian, not RAG, not a knowledge base. Remember what matters, not everything.

```
Before:  State → Signals → Awareness → Recommendations
After:   History → Patterns → Awareness → Recommendations
```

---

## Current Memory Gaps (before this patch)

1. No notion of **history** — every Strategic Brief was computed from one snapshot; nothing accumulated.
2. No **recurring-pattern** detection (same risk/drift repeating).
3. No **trend** intelligence over time.
4. No **decision memory** (what was decided, when, evidence, outcome).
5. No **lessons** layer.
6. No **historical context** on live findings ("ops stale — 4× in 60 days").
7. No **memory quality scoring / ranking**.
8. No **pruning** (window/age caps).
9. No **honesty floor** for thin history.
10. No **future-ready contract** for persistence to plug into.

---

## What Was Built

### Pure memory layer — `src/awareness/executive-memory.ts`
`executiveMemory(history: MemorySnapshot[], opts) → ExecutiveMemoryReport`. Pure, deterministic,
Worker-safe (types only; no DB/clock/fs). Operates over a SUPPLIED list of compact snapshots —
HartOS doesn't persist history yet, so this is the **contract + reasoning**; a future host feeds
the list (Part L) and nothing here changes.

**Memory unit** — `MemorySnapshot`: a compact projection of a brief (finding *subjects* +
numeric *metrics* + optional *decisions*), never raw chatter. `snapshotFromBrief()` extracts it.

**Patterns discovered (Part C)** — `detectPatterns`: a subject recurring ≥ `minOccurrences` (2)
in the window becomes a `RecurringPattern` with occurrences, first/last seen, evidence
("Occurred 4× in the last 60 days"), and a `qualityScore` (recurrence × recency weight). Single
occurrences are explicitly **not** memories.

**Trend improvements (Part D)** — `detectTrends`: per-metric series (≥3 points) compared
earlier-half vs recent-half → `rising | falling | stable`, with a 15% threshold. Metrics with
<3 points yield **no** trend (no invented direction).

**Lesson framework (Part E)** — `deriveLessons`: only from patterns recurring ≥3×. Causal
phrasing ("coincides with the decision …") only when a recorded decision shares a term; otherwise
a descriptive lesson ("a reliable recurring risk — treat it as a standing condition"). Every
lesson carries `basis` + `sourceSubjects` so it's explainable, never free-floating.

**Decision memory (Part B)** — `DecisionRecord` (decision/domain/date/evidence/outcome) carried
on snapshots; `rankDecisions` dedupes and orders most-recent-first.

**Memory controls (Parts G/J)** — `pruneSnapshots` drops out-of-window/unparseable snapshots;
`qualityScore` ranks patterns; per-list caps (patterns 5, trends 5, lessons 3, decisions 5).
Prefers a few valuable memories over many useless ones.

**Honesty floor (Part H)** — < `minHistory` (3) in-window snapshots ⇒
`status: "insufficient_history"`, empty lists, honest note. No synthetic wisdom.

### Strategic Brief evolution (Part F) — `strategic-awareness.ts`
`StrategicAwarenessInput` gained an optional `history`. When supplied + sufficient, the brief is
enriched: live risks gain `historicalContext` ("ops stale: 4× in 60d"), and the brief carries
`recurringPatterns`, `lessons`, `trendSummary`, `memoryStatus`. When `history` is omitted the
brief is **byte-identical** to before (backward compatible; existing tests unchanged).

### Surface + seam (Parts I/L) — `cockpit-intent-router.ts`
- New `executive_memory` Ask intent + `answerExecutiveMemory` ("what's recurring?", "lessons
  learned", "trend over time", "what keeps happening?") — verified distinct from
  `strategic_brief` / `daily_brief` / `strategy_review`. Creates zero proposals.
- A `ctx.memorySnapshots` seam (plain data, Worker-safe — mirrors `createdAgentContracts`). The
  stateless Ask path supplies none, so the intent honestly returns INSUFFICIENT_HISTORY today; a
  future persister populates it and the SAME code surfaces real patterns/trends/lessons.
- The strategic brief threads `ctx.memorySnapshots` through as `history` for historical context.

---

## Before / After

**Before** — "What's recurring?" → `unknown` (no concept of history).

**After (no history wired — honest)**:
```
Status: INSUFFICIENT_HISTORY.
INSUFFICIENT_HISTORY — 0 in-window snapshot(s); need ≥ 3 before patterns/trends/lessons can be earned. No synthetic wisdom.
Executive memory is earned from a history of snapshots; none are wired into this (stateless) path yet, so HartOS will not invent patterns, trends, or lessons.
```

**After (snapshot seam populated — e.g. ops stale seen 3×)**:
```
Recurring patterns:
- ops stale (risk) — Occurred 3× in the last 60 days (last seen 2026-06-06). [score 4.85]

Lessons learned:
- "ops stale" is a reliable recurring risk (3× in 60d) — treat it as a standing condition, not a one-off. (medium)

3 recurring pattern(s), … from 3 snapshot(s) over 60 days.
```

**Strategic brief with history** — a live risk now reads:
`- Decisions are running on stale data (high) — … Evidence: … [History: Occurred 4× in the last 60 days …] → Re-run the ClickUp import.`

---

## Tests (Part K)

`tests/executive-memory.test.ts` — 13 scenarios: honesty floor (insufficient + weak-no-repeat),
recurring-pattern detection (excellent 4× + ranking recent>old), trend detection (rising +
sparse→none), lessons (≥3× descriptive + 2×→none), decision ranking/dedup, pruning (90d dropped),
`snapshotFromBrief` extraction, and strategic-brief integration (history adds patterns +
historicalContext; no-history is unchanged). Plus 3 router tests (detection distinctness,
INSUFFICIENT_HISTORY honesty, populated-seam surfacing).

---

## Remaining Limitations / Future Opportunities

- **No persistence yet** — by design (Part L). The `MemorySnapshot` contract + `ctx.memorySnapshots`
  seam are the plug points; a Node persister, Obsidian export, or research store can supply history
  without touching this code.
- **No causal certainty** — lessons stay descriptive unless a recorded decision shares a term;
  true causal inference ("deload → recovery") needs richer decision logging.
- **Trend math is coarse** (half-vs-half average) — no seasonality/velocity; adequate for direction,
  not forecasting.
- **Snapshots aren't auto-captured** — a host must call `snapshotFromBrief` on a cadence and persist
  the result; the cadence/storage is the future host's job.

---

## Verification Summary

| Check | Result |
|-------|--------|
| TypeScript build | ✅ Clean (0 errors) |
| Tests | ✅ 2149 pass / 0 fail (was 2133; +16 new) |
| Smoke (`smoke:hosted`) | ✅ All checks green |
| Security / gates / execution | ❌ Unchanged |
| New agents / persistence / Obsidian | ❌ None (contracts only) |
| Backward compatibility | ✅ Brief unchanged when no history supplied |

### Files Changed
- `src/awareness/executive-memory.ts` — NEW pure memory layer (contracts + detectors + quality/ranking/pruning + honesty floor)
- `src/awareness/strategic-awareness.ts` — optional `history` → brief enrichment (recurringPatterns/lessons/trendSummary/historicalContext)
- `src/cockpit/cockpit-intent-router.ts` — `executive_memory` intent + answer + `ctx.memorySnapshots` seam + brief threading
- `tests/executive-memory.test.ts` — NEW (13 benchmark scenarios)
- `tests/cockpit-intent-router.test.ts` — +3 tests (detection, INSUFFICIENT_HISTORY, populated seam)
- `package.json` — register new test file

### Branch / Commit
- Branch: `feat/agent-runtime-provision-18d`; commit follows `664726b`.

---

*Executive Memory sprint completed 2026-06-09. Push requires explicit Hart authorization.*
