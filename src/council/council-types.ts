/** P7 Council — shared types (recursion-ready: a CouncilNode may nest sub-councils). PURE. */

export const CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_BANDS)[number];
export function isConfidence(v: unknown): v is Confidence {
  return typeof v === "string" && (CONFIDENCE_BANDS as readonly string[]).includes(v);
}

/** A goal handed to the council (or a scoped sub-goal). */
export interface CouncilGoal { goal: string; context?: string; }

/** One specialist's contribution. `degraded` = the specialist failed/timed-out or ran LLM-off. */
export interface SpecialistFinding {
  specialistId: string;
  lens: string;
  summary: string;
  confidence: Confidence;
  risks: string[];
  degraded: boolean;
}

/** The fused verdict for one council node. */
export interface Synthesis {
  recommendation: string;
  confidence: Confidence;
  consensus: string[];
  dissent: string[];
  truncated: boolean;
  notes: string[];
}

/** A node in the council tree (root or recursive sub-coordinator). Slice 1 emits depth-1 trees. */
export interface CouncilNode {
  goal: CouncilGoal;
  panel: string[];
  findings: SpecialistFinding[];
  synthesis: Synthesis;
  children: CouncilNode[];
  depth: number;
}

/** The proposal payload the coordinator emits (the whole tree + the top recommendation). */
export interface CouncilProposalPayload {
  rootGoal: string;
  recommendation: string;
  confidence: Confidence;
  tree: CouncilNode;
  llmCallsUsed: number;
}
