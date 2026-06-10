/**
 * src/wolverine/detectors/doctrine-drift.ts
 *
 * Wolverine detector — doctrine drift. Pure (operates on env). v2 checks the one crisp,
 * machine-checkable doctrine rule on the execution floor: "arm only the one action you're
 * firing, disarm after." More than one ALLOW_EXEC_* armed at once is drift from that rule —
 * a wider blast radius than intended, and exactly the kind of slow erosion Wolverine exists
 * to catch. (unsafe-flags reports each armed flag; this reports the DOCTRINE breach of having
 * several armed together.)
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";

export const DOCTRINE_DRIFT_DETECTOR = "doctrine-drift";

const EXEC_FLAGS = [
  "ALLOW_EXEC_CLICKUP_COMMENT",
  "ALLOW_EXEC_CLICKUP_MOVE",
  "ALLOW_EXEC_REFRESH_SYNC",
  "ALLOW_EXEC_REJECT_DRAFTS",
  "ALLOW_EXEC_ARCHIVE_REJECTED",
  "ALLOW_EXEC_MARK_REVIEWED",
];

function armed(v: string | undefined): boolean {
  return String(v ?? "").trim().toLowerCase() === "true";
}

export function detectDoctrineDrift(inputs: WolverineInputs): WolverineFinding[] {
  const env = inputs.env ?? {};
  const on = EXEC_FLAGS.filter((f) => armed(env[f]));
  if (on.length < 2) return [];
  return [
    {
      id: "doctrine-drift:multiple-exec-flags",
      category: "doctrine_drift",
      severity: "high",
      title: `${on.length} execution flags armed at once`,
      evidence: `Doctrine: arm only the one action you're firing, disarm after. ${on.length} are armed simultaneously: ${on.join(", ")}.`,
      ownerAgent: "HartOS execution floor",
      recommendedFix: "Disarm all but the single action you're actively firing (set the rest =false).",
      blastRadius: "Config-only — widens which gated actions could fire; no data change to disarm.",
      rollbackPath: "Re-arm individually as needed.",
      approvalRequired: false,
      confidence: "high",
      freshness: "env, as of run",
      source: DOCTRINE_DRIFT_DETECTOR,
    },
  ];
}
