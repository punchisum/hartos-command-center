import type { CouncilGoal, CouncilNode, CouncilProposalPayload, SpecialistFinding } from "./council-types.js";
import { synthesize } from "./council-synthesis.js";

export interface CouncilPorts {
  isArmed(): boolean;
  selectPanel(goal: CouncilGoal): string[];
  runSpecialist(id: string, goal: CouncilGoal): Promise<SpecialistFinding>;
  caps: { maxPanel: number; maxLlmCalls: number };
}

export interface CouncilRunResult {
  skipped: boolean;
  reason: string;
  payload?: CouncilProposalPayload;
}

/** Single-level council: select → fan out (bounded, concurrent) → synthesize → payload. Disarmed ⇒ skip.
 *  Propose-only: returns a payload; NEVER executes. A specialist never throws (it self-degrades). */
export async function runCouncil(goal: CouncilGoal, ports: CouncilPorts): Promise<CouncilRunResult> {
  if (!ports.isArmed()) return { skipped: true, reason: "council disarmed (HARTOS_ALLOW_COUNCIL / kill-switch)" };

  const selected = ports.selectPanel(goal);
  const panel = selected.slice(0, Math.max(0, ports.caps.maxPanel));
  const allowed = Math.min(panel.length, Math.max(0, ports.caps.maxLlmCalls));
  const convened = panel.slice(0, allowed);
  // Truncation is measured against the SELECTED panel so a 0/negative cap that drops would-be
  // panelists is flagged too (no silent caps). Negative caps floor to 0, never a reverse slice.
  const truncated = convened.length < selected.length;

  const findings = await Promise.all(convened.map((id) => ports.runSpecialist(id, goal)));
  const synthesis = synthesize(findings, { truncated });

  const tree: CouncilNode = { goal, panel: convened, findings, synthesis, children: [], depth: 1 };
  const payload: CouncilProposalPayload = {
    rootGoal: goal.goal,
    recommendation: synthesis.recommendation,
    confidence: synthesis.confidence,
    tree,
    llmCallsUsed: convened.length,
  };
  return { skipped: false, reason: "council synthesized", payload };
}
