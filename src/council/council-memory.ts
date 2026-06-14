/**
 * src/council/council-memory.ts
 *
 * P7 Plan 3 / P8-ready — Pure adapter that turns a completed council run into
 * a structured memory entry suitable for the executive-memory spine.
 *
 * councilRunMemoryEntry(payload, decision) → CouncilMemoryEntry
 *
 * The entry carries enough signal for P8 to learn which panels (specialist
 * combinations) and which confidence levels tend to produce approved proposals
 * vs rejected ones, so the council can self-calibrate over time.
 *
 * PURE. No IO. No network. No mutation. Never throws.
 */

import type { CouncilProposalPayload, SpecialistFinding } from "./council-types.js";
import { isConfidence } from "./council-types.js";

/** Hart's decision about the council proposal. */
export type CouncilDecision = "approved" | "rejected" | "pending";

/** A compact, evidenced memory record of a single council run. P8-consumable. */
export interface CouncilMemoryEntry {
  /** ISO timestamp (caller-supplied — pure, no clock). */
  at: string;
  /** The root goal the council was convened around. */
  goal: string;
  /** The ordered list of specialist ids that formed the panel. */
  panel: string[];
  /** The council's top recommendation. */
  recommendation: string;
  /** The confidence band of the synthesis. */
  confidence: string;
  /** Number of specialists who filed a finding (non-degraded). */
  activeFindingCount: number;
  /** Number of specialists whose finding was marked degraded (signal for P8 reliability scoring). */
  degradedCount: number;
  /** Number of dissent items from the synthesis. */
  dissentCount: number;
  /** Whether the synthesis was truncated (cap hit). */
  truncated: boolean;
  /** LLM calls consumed by this council run. */
  llmCallsUsed: number;
  /** Hart's decision: approved, rejected, or pending (not yet decided). */
  hartDecision: CouncilDecision;
  /**
   * P8 learning signal: the panel + confidence + decision triple, ready to be
   * correlated across many runs to surface "which specialist combinations are
   * most reliably approved".
   */
  learningSignal: {
    panelKey: string;       // sorted specialist ids joined by "+"
    confidence: string;
    dissentCount: number;
    hartDecision: CouncilDecision;
  };
  /**
   * Executive-memory compatible fields (see executive-memory.ts MemorySnapshot):
   * riskSubjects carries the synthesised dissent items so recurring dissent topics
   * surface as recurring patterns over time.
   */
  memoryHints: {
    riskSubjects: string[];
    opportunitySubjects: string[];
  };
}

/** Safe string extractor — never throws. */
function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Safe boolean extractor. */
function safeBool(v: unknown): boolean {
  return v === true;
}

/** Safe number extractor. */
function safeNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Safe array extractor. */
function safeArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Build a structured, P8-ready memory entry from a council run's payload and
 * Hart's decision.
 *
 * @param payload  - The CouncilProposalPayload emitted by the coordinator.
 *                   Typed as `unknown` so callers can pass it without narrowing
 *                   (matches the council-view "never throw" contract).
 * @param decision - Hart's decision: "approved" | "rejected" | "pending".
 * @param at       - ISO timestamp for the entry (caller-supplied; pure, no clock).
 */
export function councilRunMemoryEntry(
  payload: unknown,
  decision: CouncilDecision,
  at: string
): CouncilMemoryEntry {
  // Safe extraction — treat any structural defect as empty/default.
  const p = (payload !== null && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  const rootGoal = safeStr(p["rootGoal"]) || "(unknown goal)";
  const recommendation = safeStr(p["recommendation"]) || "(no recommendation)";
  const rawConf = safeStr(p["confidence"]);
  const confidence = isConfidence(rawConf) ? rawConf : "low";
  const llmCallsUsed = safeNum(p["llmCallsUsed"], 0);

  // Extract tree fields.
  const tree = (p["tree"] !== null && typeof p["tree"] === "object" ? p["tree"] : {}) as Record<string, unknown>;
  const panel = safeArr(tree["panel"]).map(safeStr).filter(Boolean);
  const findings: SpecialistFinding[] = safeArr(tree["findings"]).map((f) => {
    const fObj = (f !== null && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const fc = safeStr(fObj["confidence"]);
    return {
      specialistId: safeStr(fObj["specialistId"]),
      lens: safeStr(fObj["lens"]),
      summary: safeStr(fObj["summary"]),
      confidence: isConfidence(fc) ? fc : "low",
      risks: safeArr(fObj["risks"]).map(safeStr).filter(Boolean),
      degraded: safeBool(fObj["degraded"]),
    };
  });

  const synthesis = (tree["synthesis"] !== null && typeof tree["synthesis"] === "object" ? tree["synthesis"] : {}) as Record<string, unknown>;
  const dissent = safeArr(synthesis["dissent"]).map(safeStr).filter(Boolean);
  const consensus = safeArr(synthesis["consensus"]).map(safeStr).filter(Boolean);
  const truncated = safeBool(synthesis["truncated"]);

  const activeFindingCount = findings.filter((f) => !f.degraded).length;
  const degradedCount = findings.filter((f) => f.degraded).length;

  // Learning signal — the core triple for P8.
  const panelKey = [...panel].sort().join("+") || "(empty)";

  return {
    at,
    goal: rootGoal,
    panel,
    recommendation,
    confidence,
    activeFindingCount,
    degradedCount,
    dissentCount: dissent.length,
    truncated,
    llmCallsUsed,
    hartDecision: decision,
    learningSignal: {
      panelKey,
      confidence,
      dissentCount: dissent.length,
      hartDecision: decision,
    },
    memoryHints: {
      // Dissent items surface as risk subjects — recurring dissent topics will be
      // picked up by detectPatterns in executive-memory as recurring risks.
      riskSubjects: dissent,
      // Consensus items surface as opportunity subjects.
      opportunitySubjects: consensus,
    },
  };
}
