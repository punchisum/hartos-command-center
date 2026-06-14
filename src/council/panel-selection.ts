/** P7 Council — panel selection (deterministic roster + guarded LLM refine). PURE. Never throws. */

import { COUNCIL_CAPS } from "./council-arming.js";
import type { CouncilGoal } from "./council-types.js";

export const DEFAULT_ROSTER = ["research", "beezulbub", "cto", "financial", "ma", "legal"] as const;

/** Set used for fast O(1) membership checks when filtering refiner output. */
const ROSTER_SET = new Set<string>(DEFAULT_ROSTER);

export interface PanelOpts {
  /** Optional LLM-backed refiner; may trim/reorder but cannot introduce unknown specialists. */
  refine?: (goal: CouncilGoal, candidates: string[]) => string[];
  /** Override the default `COUNCIL_CAPS.maxPanel` cap. */
  maxPanel?: number;
}

/**
 * Select the specialist panel for a council session.
 *
 * Logic (in order):
 * 1. Start with a mutable copy of `DEFAULT_ROSTER`.
 * 2. If a `refine` function is provided, call it inside a try/catch.
 *    - On throw → fall back to the base roster.
 *    - Filter out any id not in `DEFAULT_ROSTER` (unknowns are silently dropped).
 *    - If the filtered result is empty → fall back to the base roster.
 * 3. Cap the result at `opts?.maxPanel ?? COUNCIL_CAPS.maxPanel`.
 */
export function selectPanel(goal: CouncilGoal, opts?: PanelOpts): string[] {
  const base = [...DEFAULT_ROSTER] as string[];
  const cap = opts?.maxPanel ?? COUNCIL_CAPS.maxPanel;

  let result = base;

  if (opts?.refine !== undefined) {
    try {
      const refined = opts.refine(goal, base);
      // Filter out any specialist not in the known roster.
      const filtered = refined.filter((id) => ROSTER_SET.has(id));
      // Empty result → fall back to the base roster (never return an empty panel).
      result = filtered.length > 0 ? filtered : base;
    } catch {
      // Refiner threw → deterministic roster.
      result = base;
    }
  }

  // Apply the panel cap last.
  return result.slice(0, cap);
}
