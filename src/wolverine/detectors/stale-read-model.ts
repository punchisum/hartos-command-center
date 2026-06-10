/**
 * src/wolverine/detectors/stale-read-model.ts
 *
 * Wolverine detector — stale read-models. Pure (operates on the cockpit's OWN freshness
 * assessment: sourceDiagnostics.staleSources, supplied by the host). This is the detector that
 * would have auto-surfaced the "HRV stale since 6/8 / ops data old" class we hunted by hand —
 * Wolverine flagging it before Hart has to look.
 *
 * Advisory in v2: it DETECTS + recommends the fix but carries no fixRoute (an ops re-sync maps to
 * refresh-sync, but that adapter isn't wired into the approved-executor yet; a device re-sync is
 * upstream). Detection is the value; auto-routing the fix can follow.
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";

export const STALE_READ_MODEL_DETECTOR = "stale-read-model";

export function detectStaleReadModel(inputs: WolverineInputs): WolverineFinding[] {
  const stale = inputs.staleSources ?? [];
  if (stale.length === 0) return [];
  return stale.map((domain): WolverineFinding => {
    const isOps = /ops/i.test(domain);
    return {
      id: `stale-read-model:${domain}`,
      category: "stale_data",
      severity: "medium",
      title: `${domain} read-model is stale`,
      evidence: `The ${domain} read-model's latest rows are older than its freshness window — the cockpit and any Ask are reasoning on stale ${domain} data.`,
      ownerAgent: `${domain} agent`,
      recommendedFix: isOps
        ? "Refresh the ops sync (re-pull ClickUp) via the refresh-sync adapter."
        : `Re-sync the ${domain} source so fresh rows land (often device-side, e.g. re-run the Apple Health export).`,
      blastRadius: isOps
        ? "Internal: re-pulls the ops read-model; no external write."
        : `Upstream ${domain} ingestion (frequently device-side, not a code change).`,
      rollbackPath: "n/a — a re-sync only adds fresher rows.",
      approvalRequired: false,
      confidence: "high",
      freshness: "source-diagnostics, as of run",
      source: STALE_READ_MODEL_DETECTOR,
    };
  });
}
