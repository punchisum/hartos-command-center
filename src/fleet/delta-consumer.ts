/**
 * src/fleet/delta-consumer.ts — 3-levels-up master plan §13 (the "refresh→learn" glue).
 *
 * When a mutation executes, the dispatcher (`dispatchMutation` in execution-dispatch.ts) projects a
 * `StateDeltaSignal` onto its `DispatchResult.delta` — non-null ONLY when a write actually executed
 * (a noop, a refusal, or a dry-run yields a null delta). The Fleet Brain
 * (`applyDeltas` in fleet-brain.ts) already knows how to fold deltas into a prior briefing
 * INCREMENTALLY, re-ranking only the items a delta touches and preserving §19 (a freshness-only
 * delta can never UPGRADE confidence). Those two halves existed but were not connected.
 *
 * This module is the thin, PURE glue that closes the loop's "refresh→learn" step: it pulls the
 * non-null deltas out of a batch of `DispatchResult`s and feeds them to the Brain's own
 * `applyDeltas`. It is deliberately NOT a parallel store and NOT a re-digest — it reimplements
 * NOTHING about the merge or the §19 confidence rule; it composes the Brain's existing function so
 * those semantics are reused verbatim.
 *
 * PURE: no fs / network / clock / env. The timestamp is INJECTED (`now`), never read from the
 * ambient clock, so the same inputs always produce a deep-equal output. Keep it free of any
 * Node-only import so an execution host can import it without dragging in the Worker bundle.
 */

import type { DispatchResult } from "../execution/execution-dispatch.js";
import type { StateDeltaSignal } from "../execution/state-delta.js";
import { applyDeltas, type FleetBriefing } from "./fleet-brain.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";

/**
 * Extract the executed-mutation deltas from a batch of `DispatchResult`s, in input order.
 *
 * A `DispatchResult.delta` is null for any noop / refusal / dry-run (nothing executed), so those
 * contribute nothing and are dropped here. The remaining order matches the order the dispatcher
 * returned the results — the well-defined application order the consumer below relies on.
 */
export function collectDeltas(dispatchResults: readonly DispatchResult[]): StateDeltaSignal[] {
  const deltas: StateDeltaSignal[] = [];
  for (const r of dispatchResults) {
    if (r.delta !== null) deltas.push(r.delta);
  }
  return deltas;
}

/**
 * Fold the executed-mutation deltas from `dispatchResults` into a prior Fleet Brain `briefing`,
 * via the Brain's own incremental `applyDeltas`. This is pure orchestration — the merge, the
 * delta→item matching, and the §19 "freshness-only evidence can never upgrade confidence" rule
 * all live in `applyDeltas` and are reused verbatim here.
 *
 * Application order: deltas are applied in `dispatchResults` order (nulls dropped). `applyDeltas`
 * folds them into each touched item left-to-right, so for a single item the LAST contributing
 * delta's freshness participates in the worst-freshness fold — order is well-defined and stable.
 *
 * Honest empty handling: when no mutation actually executed (an empty batch, or one that is all
 * noops / refusals / dry-runs), there are no deltas to apply and the SAME `briefing` reference is
 * returned unchanged — matching the Brain's incremental guarantee that untouched state is not
 * re-synthesized. `now` is then never consulted (no spurious `generatedAt` bump).
 *
 * Deterministic: same inputs → deep-equal output. `now` is injected; this never reads a clock.
 */
export function applyDispatchDeltas(
  briefing: FleetBriefing,
  dispatchResults: readonly DispatchResult[],
  now: Date,
  opts: { proposals?: ProposalQueueItem[] } = {},
): FleetBriefing {
  const deltas = collectDeltas(dispatchResults);
  // Nothing executed ⇒ nothing to learn from. Return the prior briefing by reference, unchanged —
  // do not re-rank and do not stamp a new generatedAt for a no-op refresh.
  if (deltas.length === 0) return briefing;
  return applyDeltas(briefing, deltas, now, opts);
}
