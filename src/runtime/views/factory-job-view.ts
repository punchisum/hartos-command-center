/**
 * src/runtime/views/factory-job-view.ts
 *
 * Read-only cockpit panel that surfaces what the Factory Agent is doing —
 * pending factory jobs, interrogation status, compiled manifests awaiting
 * approval. Honest available/unavailable.
 *
 * Worker-safe: no node:fs, no pg, no crypto. Import-type-only for CockpitState.
 * `executable` is ALWAYS "disabled" — the Factory UI never executes anything.
 * The jobs list is currently empty (go-live wiring lands separately); this view
 * is the honest read-only surface for when that wiring arrives.
 */

import type { CockpitState } from "../../cockpit/cockpit-types.js";

// ─── View types ───────────────────────────────────────────────────────────────

export type FactoryJobViewEntry = {
  jobId: string;
  status: string;        // human-readable status label
  domain?: string;
  requestSummary: string; // first 80 chars of the request
  readiness?: string;    // e.g. "5 questions pending" | "manifest ready" | "planned"
  proposedAt?: string;
};

export type FactoryJobView =
  | { available: true; mode: "live"; total: number; jobs: FactoryJobViewEntry[]; executable: "disabled"; note: string }
  | { available: false; mode: "unavailable"; total: 0; jobs: []; executable: "disabled"; note: string };

// ─── View builder ─────────────────────────────────────────────────────────────

/**
 * Build the read-only Factory Job view from a cockpit snapshot.
 *
 * When no state is provided, the view is an honest `available: false` — the
 * Factory jobs cannot be displayed without a cockpit snapshot. When a snapshot
 * is present, the view is `available: true` with an honest empty jobs list:
 * the CockpitState does not yet carry factory jobs (that wiring lands at
 * go-live). No fabrication: an empty jobs list is the correct representation
 * of the current state.
 *
 * Pure + Worker-safe: no I/O, no mutation, no execution. `now` is accepted for
 * interface parity with other view-builders (e.g. `fleetBriefingView`) but is
 * not currently used; it will be used for freshness calculations once factory
 * jobs are wired into the snapshot.
 */
export function factoryJobView(state?: CockpitState, _now?: string): FactoryJobView {
  if (!state) {
    return {
      available: false,
      mode: "unavailable",
      total: 0,
      jobs: [],
      executable: "disabled",
      note: "Cockpit snapshot unavailable. Factory jobs cannot be displayed. Hart approves all factory actions.",
    };
  }

  // CockpitState does not yet carry factory jobs — go-live wiring lands
  // separately. Return an honest empty list rather than fabricating entries.
  return {
    available: true,
    mode: "live",
    total: 0,
    jobs: [],
    executable: "disabled",
    note: "Factory Agent ready. Submit a build request to start a job. Hart approves all spec locks and manifest compilations.",
  };
}
