/**
 * src/cockpit/council-view.ts
 *
 * P7 Plan 3 — Pure view-model for CouncilProposalPayload.
 * READ-ONLY. Never throws. Tolerates malformed/partial input.
 * No execution; no network; no mutation.
 */

import type { CouncilProposalPayload, CouncilNode, SpecialistFinding } from "../council/council-types.js";
import { isConfidence } from "../council/council-types.js";

/** One specialist's rendered row (dissent-safe, degraded-safe). */
export interface CouncilFindingRow {
  specialistId: string;
  lens: string;
  summary: string;
  confidence: string;
  degraded: boolean;
}

/** A sub-council node summarised for nesting (depth > 1). */
export interface SubCouncilSummary {
  goal: string;
  recommendation: string;
  confidence: string;
  findingCount: number;
  depth: number;
}

/** The fully rendered view of a single CouncilProposalPayload. */
export interface CouncilViewModel {
  rootGoal: string;
  recommendation: string;
  confidence: string;
  findingRows: CouncilFindingRow[];
  consensus: string[];
  dissent: string[];
  /** Non-empty dissent strings surfaced prominently (same as dissent, aliased for callers). */
  prominentDissent: string[];
  truncated: boolean;
  notes: string[];
  llmCallsUsed: number;
  subCouncils: SubCouncilSummary[];
  /** True when the payload was absent or severely malformed. */
  degraded: boolean;
}

/** Safe string extraction — never throws, returns "" on anything non-string. */
function safeStr(v: unknown): string {
  if (typeof v === "string") return v;
  return "";
}

/** Safe boolean extraction. */
function safeBool(v: unknown): boolean {
  return v === true;
}

/** Safe array extraction. */
function safeArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Safe number extraction. */
function safeNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Render one finding row, tolerating missing fields. */
function renderFindingRow(f: unknown): CouncilFindingRow {
  const obj = (f !== null && typeof f === "object" ? f : {}) as Record<string, unknown>;
  const confidence = safeStr(obj["confidence"]);
  return {
    specialistId: safeStr(obj["specialistId"]) || "unknown",
    lens: safeStr(obj["lens"]) || "unknown",
    summary: safeStr(obj["summary"]) || "(no summary)",
    confidence: isConfidence(confidence) ? confidence : "low",
    degraded: safeBool(obj["degraded"]),
  };
}

/** Recursively collect sub-council summaries from children. */
function collectSubCouncils(children: unknown[]): SubCouncilSummary[] {
  const result: SubCouncilSummary[] = [];
  for (const child of children) {
    const c = (child !== null && typeof child === "object" ? child : {}) as Record<string, unknown>;
    const goalObj = (c["goal"] !== null && typeof c["goal"] === "object" ? c["goal"] : {}) as Record<string, unknown>;
    const synObj = (c["synthesis"] !== null && typeof c["synthesis"] === "object" ? c["synthesis"] : {}) as Record<string, unknown>;
    const childGoal = safeStr(goalObj["goal"]) || safeStr(c["goal"]) || "(no sub-goal)";
    const confidence = safeStr(synObj["confidence"]);
    result.push({
      goal: childGoal,
      recommendation: safeStr(synObj["recommendation"]) || "(no recommendation)",
      confidence: isConfidence(confidence) ? confidence : "low",
      findingCount: safeArr(c["findings"]).length,
      depth: safeNum(c["depth"], 2),
    });
    // Recurse — council trees may nest arbitrarily (though slice 1 emits depth-1 trees).
    const grandchildren = safeArr(c["children"]);
    if (grandchildren.length > 0) {
      result.push(...collectSubCouncils(grandchildren));
    }
  }
  return result;
}

/**
 * Build a render-ready view from a CouncilProposalPayload.
 * PURE. NEVER throws — malformed payloads produce a safe degraded view.
 */
export function councilViewModel(payload: unknown): CouncilViewModel {
  const EMPTY: CouncilViewModel = {
    rootGoal: "",
    recommendation: "(no recommendation)",
    confidence: "low",
    findingRows: [],
    consensus: [],
    dissent: [],
    prominentDissent: [],
    truncated: false,
    notes: ["Payload was absent or malformed — no council data available."],
    llmCallsUsed: 0,
    subCouncils: [],
    degraded: true,
  };

  if (payload === null || payload === undefined) return EMPTY;
  if (typeof payload !== "object") return EMPTY;

  const p = payload as Record<string, unknown>;

  try {
    const rootGoal = safeStr(p["rootGoal"]) || safeStr((p["tree"] as Record<string, unknown> | undefined)?.["goal"]);
    const recommendation = safeStr(p["recommendation"]) || "(no recommendation)";
    const rawConf = safeStr(p["confidence"]);
    const confidence = isConfidence(rawConf) ? rawConf : "low";
    const llmCallsUsed = safeNum(p["llmCallsUsed"], 0);

    const tree = (p["tree"] !== null && typeof p["tree"] === "object" ? p["tree"] : {}) as Record<string, unknown>;
    const findings = safeArr(tree["findings"]);
    const synthesis = (tree["synthesis"] !== null && typeof tree["synthesis"] === "object" ? tree["synthesis"] : {}) as Record<string, unknown>;
    const children = safeArr(tree["children"]);

    const findingRows = findings.map(renderFindingRow);
    const consensus = safeArr(synthesis["consensus"]).map(safeStr).filter(Boolean);
    const dissent = safeArr(synthesis["dissent"]).map(safeStr).filter(Boolean);
    const truncated = safeBool(synthesis["truncated"]);
    const rawNotes = safeArr(synthesis["notes"]).map(safeStr).filter(Boolean);
    const subCouncils = collectSubCouncils(children);

    // Surface all note text, including any truncation note.
    const notes = [...rawNotes];
    if (truncated && !notes.some((n) => /truncat/i.test(n))) {
      notes.push("Council results were truncated — some specialists may not have been heard.");
    }

    return {
      rootGoal,
      recommendation,
      confidence,
      findingRows,
      consensus,
      dissent,
      prominentDissent: dissent, // aliased: callers that want dissent surface it here
      truncated,
      notes,
      llmCallsUsed,
      subCouncils,
      degraded: false,
    };
  } catch {
    // Never let a rendering error propagate — return the safe empty view.
    return { ...EMPTY, notes: ["Error rendering council view — raw payload may be malformed."] };
  }
}

/**
 * Build a short one-line summary of the council view (for panel headers / list rows).
 * Pure, never throws.
 */
export function councilViewSummary(view: CouncilViewModel): string {
  if (view.degraded) return "Council proposal: no data available.";
  const dissentNote = view.dissent.length > 0 ? ` (${view.dissent.length} dissent)` : "";
  return `Council: ${view.recommendation} [${view.confidence}]${dissentNote}`;
}

// Re-export the payload type so callers import from one place.
export type { CouncilProposalPayload } from "../council/council-types.js";
