/**
 * src/runtime/views/fleet-brain-view.ts
 *
 * Read-only cockpit view-builder for the Fleet Brain (3-levels-up master plan Level 3 / §2).
 * It turns a pre-built CockpitState snapshot into the prioritized Fleet Brain briefing so the
 * Worker API + hosted page can surface "what matters · why · owner · proposed action · risk if
 * ignored · confidence/freshness · exact blocker" — derived purely from the already-resolved
 * snapshot, with no bespoke re-derivation.
 *
 * It REUSES the canon, never reimplementing it:
 *   - `fleetView(state, now).agents` is the FleetSignal[] input (the same unified signals the
 *     fleet panel already renders) — no second derivation of the fleet.
 *   - `assembleBriefing` (src/fleet/fleet-brain.ts) does the rule-first synthesis + ranking.
 *
 * Everything here is read-only and deterministic: it derives a view from the snapshot and the
 * INJECTED `now` request-time string. No filesystem, no network, no env, no service-role key,
 * no mutation, no execution. `now` is parsed with the SAME NaN-guard `fleetView` uses; the
 * briefing's `generatedAt` echoes that parsed time (never the ambient system clock).
 */

import type { CockpitState } from "../../cockpit/cockpit-types.js";
import { fleetView } from "../cloudflare-cockpit-views.js";
import { assembleBriefing, type FleetBriefing } from "../../fleet/fleet-brain.js";

/**
 * The read-only Fleet Brain view-model. When the snapshot has resolved read-model summaries the
 * view is `available: true` and carries the full `FleetBriefing` (items ranked + honest
 * `generatedAt`). When there are no summaries to reason over it is an honest `available: false`
 * with a note — mirroring the `available:false` branch of `fleetView`/`proposalsView`. Never
 * fabricated: an empty fleet yields an honest unavailable view, not an invented briefing.
 */
export type FleetBrainView =
  | ({ available: true } & FleetBriefing)
  | { available: false; note: string };

/**
 * Build the read-only Fleet Brain briefing view from a cockpit snapshot.
 *
 * Reuses `fleetView(state, now).agents` as the signals input and `state.proposalQueue` as the
 * proposals; OMITS deltas (no Worker producer — `assembleBriefing` defaults deltas to []). The
 * `now` string is parsed with the SAME NaN-guard `fleetView` uses; an unparseable/empty `now`
 * falls back to the deterministic epoch (never the ambient clock), so the view stays pure and
 * reproducible. Pure: no I/O, no mutation, no execution.
 */
export function fleetBriefingView(state: CockpitState | undefined, now: string): FleetBrainView {
  const fleet = fleetView(state, now);
  // No live read-model summaries resolved → nothing to synthesize. Mirror the views' honest
  // `available:false` branch instead of fabricating an empty briefing.
  if (!fleet.available) {
    return {
      available: false,
      note: "Fleet Brain is unavailable (no live read-model summaries resolved). Configure the Fitness/Ops read-model env on the Worker, then re-bake the snapshot.",
    };
  }
  // Honest "now": parse only a valid timestamp; an empty/invalid snapshot time falls back to the
  // deterministic epoch (Date(0)) — the same NaN-guard shape `fleetView` uses, never the clock.
  const parsed = now ? new Date(now) : null;
  const at = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);
  return {
    available: true,
    ...assembleBriefing({
      signals: fleet.agents,
      proposals: state?.proposalQueue ?? [],
      now: at,
    }),
  };
}
