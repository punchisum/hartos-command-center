/**
 * src/council/council-coordinator.ts
 *
 * P7 Council coordinator — recursive, depth-capped, propose-only.
 *
 * Plan 1: single-level fan-out (all behaviour is preserved unchanged).
 * Plan 2: adds optional recursion via three new optional CouncilPorts:
 *   - isSubCoordinator?(id): designates a panel member as a sub-coordinator
 *   - runSubCouncil?(goal, depth): recurses into a child council node
 *   - caps.maxDepth: hard cap on tree depth (default COUNCIL_CAPS.maxDepth = 3)
 *
 * A sub-coordinator bubbles its synthesis back as a SpecialistFinding and pushes
 * its CouncilNode into the parent's children array.  Beyond maxDepth it falls back
 * to a normal leaf specialist call — no silent infinite recursion.  Never throws.
 */

import { COUNCIL_CAPS } from "./council-arming.js";
import type { CouncilGoal, CouncilNode, CouncilProposalPayload, SpecialistFinding } from "./council-types.js";
import { synthesize } from "./council-synthesis.js";

export interface CouncilPorts {
  isArmed(): boolean;
  selectPanel(goal: CouncilGoal): string[];
  runSpecialist(id: string, goal: CouncilGoal): Promise<SpecialistFinding>;
  caps: { maxPanel: number; maxLlmCalls: number; maxDepth?: number };
  /**
   * Optional: designate a panel member as a sub-coordinator.
   * When absent (Plan 1 ports), every panelist is treated as a leaf.
   */
  isSubCoordinator?(id: string): boolean;
  /**
   * Optional: run a child council for the given goal at the given depth.
   * Called only when isSubCoordinator returns true AND depth+1 < maxDepth.
   * Must never throw — callers catch, but defence-in-depth is appreciated.
   */
  runSubCouncil?(goal: CouncilGoal, depth: number): Promise<CouncilRunResult>;
}

export interface CouncilRunResult {
  skipped: boolean;
  reason: string;
  payload?: CouncilProposalPayload;
}

/**
 * Fold a sub-council result into a SpecialistFinding for the parent.
 * Degraded when the sub-council was skipped or produced no payload.
 */
function subResultToFinding(id: string, result: CouncilRunResult): SpecialistFinding {
  if (result.skipped || !result.payload) {
    return {
      specialistId: id,
      lens: id,
      summary: `(sub-council skipped: ${result.reason})`,
      confidence: "low",
      risks: [],
      degraded: true,
    };
  }
  return {
    specialistId: id,
    lens: id,
    summary: result.payload.recommendation,
    confidence: result.payload.confidence,
    risks: [],
    degraded: false,
  };
}

/**
 * Run the council for a goal at the given depth.
 *
 * Disarmed ⇒ skip.  Propose-only: returns a CouncilProposalPayload; NEVER executes.
 * Specialists never throw (they self-degrade); the coordinator also never throws.
 *
 * @param goal   The goal handed to this council node.
 * @param ports  Injected seams (select / run / arm / recurse).
 * @param depth  Current recursion depth (0 = root; callers of sub-councils pass depth+1).
 *               Defaults to 0 so Plan 1 call sites need no change.
 */
export async function runCouncil(goal: CouncilGoal, ports: CouncilPorts, depth = 0): Promise<CouncilRunResult> {
  if (!ports.isArmed()) return { skipped: true, reason: "council disarmed (HARTOS_ALLOW_COUNCIL / kill-switch)" };

  const maxDepth = ports.caps.maxDepth ?? COUNCIL_CAPS.maxDepth;

  const selected = ports.selectPanel(goal);
  const panel = selected.slice(0, Math.max(0, ports.caps.maxPanel));
  const allowed = Math.min(panel.length, Math.max(0, ports.caps.maxLlmCalls));
  const convened = panel.slice(0, allowed);
  // Truncation is measured against the SELECTED panel so a 0/negative cap that drops would-be
  // panelists is flagged too (no silent caps).  Negative caps floor to 0, never a reverse slice.
  const truncated = convened.length < selected.length;

  // ── Fan-out: leaf specialists and sub-coordinators concurrently ────────────
  const children: CouncilNode[] = [];
  // leafCalls: slots where runSpecialist was invoked directly (sub-coordinators don't count here;
  // their own llmCallsUsed is captured separately so we don't double-count the slot).
  let leafCalls = 0;
  let subLlmCalls = 0;

  const findings = await Promise.all(
    convened.map(async (id): Promise<SpecialistFinding> => {
      const isSubCoord = ports.isSubCoordinator?.(id) ?? false;
      const canRecurse = isSubCoord && ports.runSubCouncil !== undefined && depth + 1 < maxDepth;

      if (canRecurse && ports.runSubCouncil !== undefined) {
        // Sub-coordinator path: recurse and bubble up.
        let subResult: CouncilRunResult;
        try {
          subResult = await ports.runSubCouncil(goal, depth + 1);
        } catch {
          // runSubCouncil threw — degrade gracefully.
          subResult = { skipped: true, reason: "runSubCouncil threw" };
        }
        // Push the child node into the parent (if the sub-council succeeded).
        if (!subResult.skipped && subResult.payload) {
          children.push(subResult.payload.tree);
          subLlmCalls += subResult.payload.llmCallsUsed;
        }
        return subResultToFinding(id, subResult);
      }

      // Leaf path (also the fallback when beyond maxDepth).
      leafCalls += 1;
      return ports.runSpecialist(id, goal);
    }),
  );

  const synthesis = synthesize(findings, { truncated });

  const tree: CouncilNode = {
    goal,
    panel: convened,
    findings,
    synthesis,
    children,
    depth: depth + 1,
  };
  const payload: CouncilProposalPayload = {
    rootGoal: goal.goal,
    recommendation: synthesis.recommendation,
    confidence: synthesis.confidence,
    tree,
    // leafCalls = direct specialist invocations at this node;
    // subLlmCalls = accumulated from all successful sub-councils.
    llmCallsUsed: leafCalls + subLlmCalls,
  };
  return { skipped: false, reason: "council synthesized", payload };
}
