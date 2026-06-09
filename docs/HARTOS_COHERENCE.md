# HartOS — How It All Fits (2026-06-09)

One page. The day's work was seven patches, but it is **one system**: a closed executive loop that
observes, reasons, remembers, and surfaces — with a human approval floor and an honesty floor under
everything. This doc exists so the parts make sense as a whole.

```
            ┌────────────────────────── THE EXECUTIVE LOOP ──────────────────────────┐
            │                                                                          │
  Read models ─▶ DEPTH ─▶ AWARENESS ─▶ BRIEF ─▶ COCKPIT V2 ─▶ Hart decides ─▶ Approvals
  (ops/fitness)  (agent     (strategic   (exec      (sees it in        │         (gated,
                  reasoning)  scan)        brief)     <10s)             │          audited)
            ▲                   ▲                                       │
            │                   │                                       ▼
            └─── MEMORY ◀────────┴──────────── snapshot (daily heartbeat) ◀─ capture
                 (patterns/trends/lessons feed back as historical context)
```

## The layers, in order, and what each earns

| Layer | Sprint | What it produces | Honesty floor |
|---|---|---|---|
| **Housekeeping** | #1 | Clean repo, gitignore, no secret risk | — |
| **Optimization** | #2 | Routing that understands natural asks; tighter layout; sharper ops/fitness | — |
| **System Quality** | #3 | Proposals you can actually decide on (why-approve/why-reject, hygiene); auth canary; recovery messages | — |
| **Agent Depth** | #4 | Each agent a specialist voice — **Coach / Operator / CTO** — with explicit **Risk + Opportunity** | risk/opp `null` when ungrounded |
| **Strategic Awareness** | #5 | The proactive scan: **Risks · Opportunities · Drift · Blind Spots + Recommended Focus** | `INSUFFICIENT_EVIDENCE` (UNKNOWN) |
| **Executive Memory** | #6 | **Recurring patterns · trends · lessons · decisions** over history | `INSUFFICIENT_HISTORY` |
| **Cockpit V2** | #7 | The Executive Operating System — surfaces all of the above in <10s, navy/sleek | "Awareness pending" / "None above threshold" |
| **Memory Persister** | #7.1 (this) | Closes the loop: brief → daily snapshot → memory → historical context back on the brief | flag-gated, default OFF; only `ok` briefs remembered |

## Why each layer needed the one before it
- **Depth** had to exist before **Awareness** could aggregate real risk/opportunity (Awareness reuses the cores' `risk`/`opportunity`, it doesn't reinvent them).
- **Awareness** had to exist before **Memory** had anything worth snapshotting (a snapshot is a compact projection of a brief).
- **Memory** had to exist before the **Brief** could carry historical context ("ops stale — 4× in 60d").
- **Cockpit V2** had to exist because the brain had outrun the dashboard: Awareness + Memory were computed but invisible. V2's whole reason for being is to *show what HartOS already knows*.
- The **Persister** had to exist because Memory was inert without a writer — the section showed `INSUFFICIENT_HISTORY` forever. Now the loop turns.

## The two floors that hold under everything
1. **Honesty floor** — every layer returns an explicit UNKNOWN / INSUFFICIENT_* state rather than
   fabricating. Nothing is invented: no fake risk, opportunity, trend, lesson, or green status.
2. **Governance floor** — the human stays in the loop. Propose-don't-act everywhere: the cockpit
   reads and recommends; Approve/Reject route through the gated, audited transition; execution
   stays disabled; the Worker holds no DB key and never mutates. The Persister is read-shaped,
   flag-gated, default-OFF.

## How the loop literally runs (data path)
1. `resolveHostedCockpitState` builds a snapshot (read models → panels with Depth's coach/triage fields).
2. `strategicAwareness(panels, freshness, proposals, perception/forecast/synthesis, history?)` → the Brief.
3. `renderHostedCockpitPage(state)` shows the Brief as the Executive Brief hero + Awareness + Memory + Fleet + Approvals + Health.
4. A Node host (flag `HARTOS_MEMORY_CAPTURE=true`) calls `captureSnapshot({ brief, store, now })` on a daily cadence → `snapshotFromBrief` → `recordSnapshot` (dedupe-by-day, prune 60d, cap 120) → store.
5. Next state resolution loads the store into `state.memorySnapshots` → step 2 now has `history` → live risks gain historical context, the Memory section fills, recurring patterns/lessons emerge.

That is the whole machine: **History → Patterns → Awareness → Recommendations → Decision**, on a
read-only floor, with a human at the gate.

## What's still inert (honest)
- The persister is **built, tested, and wired but OFF** (`HARTOS_MEMORY_CAPTURE` unset). Arm it on a
  Node host with a durable `MemoryStore` impl (local JSON or Supabase) and a daily trigger to make
  the Memory section show real history.
- Nothing is **pushed/deployed** — 11 commits sit on `feat/agent-runtime-provision-18d` awaiting an
  explicit go-live pass. The loop runs locally today; production is a separate, gated decision.

## Where to plug the future in (no corner painted)
- `MemoryStore` port → a Supabase/Obsidian/KV backend, no engine change.
- `MemorySnapshot` is plain serializable data → research systems / cross-agent learning consume it directly.
- `strategicAwareness` already accepts `perception/forecast/synthesis` → richer cross-system corroboration plugs in without a rewrite.
