/**
 * src/wolverine/detectors/agent-liveness.ts
 *
 * Wolverine detector — agent liveness (Sentinel's verdicts as immune-system findings).
 *
 * Sentinel computes per-agent up/stale/down/unknown from real evidence; this detector turns
 * the non-up verdicts into ranked findings so a silent agent surfaces in the audit + repair
 * queue automatically. ADVISORY ONLY (no fixRoute): restarting/redeploying an agent is an
 * EXTERNAL action, and by the autoheal invariant no external adapter may ever auto-execute —
 * the fix is proposed to Hart, never applied. Automatic eyes; gated hands.
 *
 * Pure: operates only on the supplied inputs.fleetLiveness; absent ⇒ not assessed (no noise).
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";

export const AGENT_LIVENESS_DETECTOR = "agent-liveness";

export function detectAgentLiveness(inputs: WolverineInputs): WolverineFinding[] {
  const fleet = inputs.fleetLiveness;
  if (!fleet) return [];
  const findings: WolverineFinding[] = [];

  for (const v of fleet.verdicts) {
    if (v.state === "up") continue;
    // Unknown agents that the catalog does not claim are running carry no risk signal.
    if (v.state === "unknown" && v.catalogStatus !== "live" && v.catalogStatus !== "partial") continue;

    const severity = v.state === "down" ? "high" : v.state === "stale" ? "medium" : "low";
    findings.push({
      id: `agent-liveness:${v.agentId}:${v.state}`,
      category: v.state === "down" ? "broken_wiring" : "stale_data",
      severity,
      title:
        v.state === "down"
          ? `${v.displayName} is DOWN (no evidence ${v.ageHours}h)`
          : v.state === "stale"
            ? `${v.displayName} is stale (last evidence ${v.ageHours}h ago)`
            : `${v.displayName} liveness is unknown (catalog says ${v.catalogStatus})`,
      evidence: v.reason,
      ownerAgent: v.displayName,
      recommendedFix:
        v.state === "down"
          ? "Re-run the agent's runner/cadence (or fix its trigger) so fresh evidence lands; verify its env/flags first."
          : v.state === "stale"
            ? "Run the agent's normal cadence (its npm runner or upstream sync) so fresh evidence lands."
            : "Wire a heartbeat/evidence source for this agent so Sentinel can assess it.",
      blastRadius: "None from detection; the proposed re-run touches only that agent's own pipeline.",
      rollbackPath: "n/a — re-running a producer only adds fresher evidence.",
      approvalRequired: true,
      confidence: v.state === "unknown" ? "low" : "high",
      freshness: `sentinel assessment at ${fleet.generatedAt}`,
      source: AGENT_LIVENESS_DETECTOR,
    });
  }
  return findings;
}
