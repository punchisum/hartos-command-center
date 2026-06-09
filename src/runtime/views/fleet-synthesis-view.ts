/**
 * src/runtime/views/fleet-synthesis-view.ts
 *
 * Read-only cockpit view-builder for the Fleet SYNTHESIS rollup (3-levels-up master plan
 * Level 3 — the "fleet intelligence" brain). It turns a pre-built CockpitState snapshot into
 * the ONE cross-agent rollup of top CORRELATED risks across the fleet, so the Worker API +
 * hosted page can surface "topRisks · coverage · confidence" — derived purely from the
 * already-resolved snapshot, composing the same pure brains the cockpit already runs.
 *
 * It REUSES the canon, never reimplementing it:
 *   - `fleetView(state, now).agents` is the FleetSignal[] input (the same unified signals the
 *     fleet panel already renders), and `assembleBriefing` builds the RAW FleetBriefing — the
 *     SAME way `fleetBriefingView` does (it calls `assembleBriefing`, NOT the view).
 *   - `perceive` + `forecast` are assembled the SAME way the hosted page does (perception from
 *     freshness/missing-sources/fleet-signals, then the orchestrator plan, then the forecast).
 *   - `synthesizeFleet` composes the three into the rollup — reused VERBATIM, so the §19
 *     honesty contract (a synthesized risk's confidence is CLAMPED to the weakest contributing
 *     band; combining sources never upgrades confidence) is preserved exactly, never re-derived.
 *
 * Everything here is read-only and deterministic: it derives a view from the snapshot and the
 * INJECTED `now` request-time string. No filesystem, no network, no env, no service-role key,
 * no mutation, no execution. The briefing's time is parsed with the SAME NaN-guard
 * `fleetView`/`fleetBriefingView` use (epoch fallback, never the ambient system clock);
 * `perceive`/`forecast` receive the raw `now` string exactly as the page passes it.
 */

import type { CockpitState } from "../../cockpit/cockpit-types.js";
import { fleetView, freshnessView, readModelStatusView } from "../cloudflare-cockpit-views.js";
import { assembleBriefing } from "../../fleet/fleet-brain.js";
import { perceive } from "../../rinnegan/perception.js";
import { collectFleetTasks } from "../../fleet/fleet-work.js";
import { orchestrateFleet } from "../../fleet/orchestrator.js";
import { forecast } from "../../prophet/forecast.js";
import { synthesizeFleet, type FleetSynthesis } from "../../fleet/fleet-synthesis.js";

/**
 * The read-only Fleet Synthesis view-model. When the snapshot has resolved read-model summaries
 * the view is `available: true`, declares it is a read-only snapshot whose rollup is
 * non-executable, and carries the full `FleetSynthesis` rollup (`topRisks` + `coverage` +
 * `confidence` + an honest `note`). When there are no summaries to reason over it is an honest
 * `available: false` with a note — mirroring the `available:false` branch of
 * `fleetBriefingView`/`fleetView`. Never fabricated: an empty fleet yields an honest unavailable
 * view, not an invented rollup.
 */
export type FleetSynthesisView =
  | ({
      available: true;
      mode: "read_only_snapshot";
      executable: "disabled";
    } & FleetSynthesis)
  | { available: false; mode: "read_only_snapshot"; executable: "disabled"; note: string };

/**
 * Build the read-only Fleet Synthesis rollup view from a cockpit snapshot.
 *
 * (1) Derives the fleet signals + the RAW FleetBriefing the SAME way `fleetBriefingView` does —
 *     `fleetView(state, now).agents` as signals, `state.proposalQueue` as proposals, deltas
 *     omitted (no Worker producer; `assembleBriefing` defaults them to []) — by calling
 *     `assembleBriefing`, never the view.
 * (2) Assembles `perception` + `forecast` the SAME way the hosted page does: perception from
 *     freshness / missing-sources / fleet-signals; the orchestrator plan from the perception's
 *     fleet work; then the forecast from perception + plan + proposals.
 * (3) Calls `synthesizeFleet({ briefing, perception, forecast })` — composed verbatim, so §19's
 *     confidence clamp is preserved (no re-implementation, no laundering).
 * (4) Returns an honest view: `available:false` + a note when state/signals are absent (mirroring
 *     `fleetBriefingView`), else `available:true` + the rollup, marked non-executable.
 *
 * Pure: no I/O, no mutation, no execution. The `now` string is parsed with the SAME NaN-guard
 * `fleetView` uses for the briefing's injected time; an unparseable/empty `now` falls back to the
 * deterministic epoch (never the ambient clock). `perceive`/`forecast` get the raw `now` string,
 * exactly as the hosted page passes it, so this view agrees with the page byte-for-byte.
 */
export function fleetSynthesisView(state: CockpitState | undefined, now: string): FleetSynthesisView {
  const fleet = fleetView(state, now);
  // No live read-model summaries resolved → nothing to synthesize. Mirror the views' honest
  // `available:false` branch instead of fabricating an empty rollup.
  if (!fleet.available) {
    return {
      available: false,
      mode: "read_only_snapshot",
      executable: "disabled",
      note: "Fleet synthesis is unavailable (no live read-model summaries resolved). Configure the Fitness/Ops read-model env on the Worker, then re-bake the snapshot.",
    };
  }

  // Honest "now" for the briefing: parse only a valid timestamp; an empty/invalid snapshot time
  // falls back to the deterministic epoch (Date(0)) — the same NaN-guard shape `fleetView` uses,
  // never the clock. The raw `now` string is what perceive/forecast take (matching the page).
  const parsed = now ? new Date(now) : null;
  const at = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);

  // (1) RAW FleetBriefing — the SAME inputs `fleetBriefingView` feeds `assembleBriefing`.
  const briefing = assembleBriefing({
    signals: fleet.agents,
    proposals: state?.proposalQueue ?? [],
    now: at,
  });

  // (2) perception + forecast — assembled EXACTLY as the hosted page / cockpitSuggestions do.
  const fr = freshnessView(state, now);
  const rms = readModelStatusView(state);
  const perception = perceive({
    now,
    freshness: fr,
    proposals: state?.proposalQueue ?? [],
    missingSources: rms.missingSources,
    fleetSignals: fleet.agents,
  });
  const plan = orchestrateFleet(collectFleetTasks({ perception }));
  const fleetForecast = forecast({
    now,
    perception,
    plan,
    proposals: state?.proposalQueue ?? [],
  });

  // (3) Compose the rollup VERBATIM — synthesizeFleet owns the §19 clamp; we never re-derive it.
  const synthesis = synthesizeFleet({ briefing, perception, forecast: fleetForecast });

  // (4) Honest, non-executable read-only view carrying the full rollup.
  return {
    available: true,
    mode: "read_only_snapshot",
    executable: "disabled",
    ...synthesis,
  };
}
