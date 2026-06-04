/**
 * src/hartos/strategy-review.ts
 *
 * Strategy review module (the "Prophet").
 * Protects Hart from building beautiful useless infrastructure.
 *
 * Deterministic, keyword + heuristic scored. No network. No mutation.
 *
 * Answers:
 *   - Should Hart build this?
 *   - Should Hart delay this?
 *   - Is this infrastructure cosplay?
 *   - Is there a simpler path?
 *   - What is the opportunity cost?
 *   - What proof is needed before building?
 */

import type {
  StrategyReviewResult,
  StrategyScoreDimensions,
  StrategyVerdict,
  Magnitude,
  RiskLevel,
} from "./orchestrator-types.js";
import { detectBuildTarget } from "./request-classifier.js";

export interface StrategyReviewOptions {
  /**
   * Foundation capabilities that are NOT yet usable.
   * If undefined for a tax build, foundations are assumed missing (conservative).
   */
  missingFoundationCapabilities?: string[];
}

function has(text: string, ...needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/** Clamp a score into the 0–10 range. */
function clamp(n: number): number {
  return Math.max(0, Math.min(10, n));
}

function magnitudeFrom(score: number, lowMax: number, highMin: number): Magnitude {
  if (score >= highMin) return "high";
  if (score <= lowMax) return "low";
  return "medium";
}

function scoreRequest(t: string): StrategyScoreDimensions {
  const repeated = has(t, "automate", "every day", "every week", "recurring", "repeated", "repetitive", "manual", "each time", "always", "routine");
  const friction = has(t, "tedious", "annoying", "slow", "manual", "copy paste", "by hand", "receipt", "invoice", "expense", "document");
  const decision = has(t, "decision", "report", "visibility", "insight", "overview", "status", "approval");
  const blindspot = has(t, "blind spot", "blindspot", "monitor", "alert", "miss", "catch", "detect", "debug timeline");
  const revenue = has(t, "revenue", "money", "client", "invoice", "tax", "save time", "time", "cost", "billing");
  const urgency = has(t, "urgent", "asap", "today", "now", "deadline", "immediately");

  const complex = has(t, "agent", "platform", "system", "command center", "command centre", "cockpit", "orchestrat", "multi", "swarm", "autonomous", "realtime", "real-time");
  const frontend = has(t, "dashboard", "cockpit", "ui", "frontend", "page", "panel", "command center", "command centre");
  const dependency = has(t, "integration", "external", "live", "realtime", "real-time", "provider", "supabase", "cloudflare", "telegram", "depends on", "command center", "command centre");

  const scores: StrategyScoreDimensions = {
    real_friction_removed: clamp(friction ? 7 : 3),
    decision_quality_improved: clamp(decision ? 7 : 3),
    repeated_workflow_automated: clamp(repeated ? 8 : 2),
    blind_spot_exposed: clamp(blindspot ? 7 : 3),
    revenue_or_time_impact: clamp(revenue ? 7 : 3),
    urgency: clamp(urgency ? 7 : 3),
    complexity: clamp(complex ? 7 : 3),
    maintenance_burden: clamp((complex ? 4 : 1) + (frontend ? 3 : 1)),
    dependency_risk: clamp(dependency ? 7 : 2),
    opportunity_cost: 0, // derived below
  };

  // Opportunity cost rises when complexity/maintenance is high but real value is low.
  const valueSignal = scores.real_friction_removed + scores.repeated_workflow_automated + scores.revenue_or_time_impact;
  const costSignal = scores.complexity + scores.maintenance_burden + scores.dependency_risk;
  scores.opportunity_cost = clamp(costSignal > valueSignal ? 7 : 3);

  return scores;
}

export function reviewStrategy(
  request: string,
  options: StrategyReviewOptions = {}
): StrategyReviewResult {
  const t = request.toLowerCase().trim();
  const scores = scoreRequest(t);
  const target = detectBuildTarget(request);

  const leverageScore =
    scores.real_friction_removed +
    scores.decision_quality_improved +
    scores.repeated_workflow_automated +
    scores.blind_spot_exposed +
    scores.revenue_or_time_impact; // 0–50

  const costScore =
    scores.complexity +
    scores.maintenance_burden +
    scores.dependency_risk +
    scores.opportunity_cost; // 0–40

  const expectedLeverage: Magnitude = magnitudeFrom(leverageScore, 18, 30);
  const risk: RiskLevel = magnitudeFrom(costScore, 14, 24);
  const maintenanceBurden: Magnitude = magnitudeFrom(scores.maintenance_burden, 3, 6);

  // ── Cosplay detection: dashboards/cockpits with no value anchor ──
  const isFrontendShell = has(t, "dashboard", "cockpit", "command center", "command centre");
  const tiedToValue = has(t, "approval", "manual_required", "manual required", "report", "reports", "debug timeline", "status");

  let verdict: StrategyVerdict;
  let reason: string;
  let simplerAlternative: string | null = null;
  let recommendedNextAction: string;
  const requiredProof: string[] = [];

  // ── Foundation-first rule for tax builds ──
  const foundationsMissing =
    target === "tax_specialist" &&
    (options.missingFoundationCapabilities
      ? options.missingFoundationCapabilities.some((c) => c === "receipt_ocr" || c === "document_ingest")
      : true);

  if (foundationsMissing) {
    verdict = "BUILD_LATER";
    reason =
      "Tax logic depends on clean document ingestion and an evidence trail. " +
      "Receipt/document capabilities are not yet usable, so building the tax specialist first would rest on missing foundations.";
    simplerAlternative = "Build a Receipt/Finance Document Agent first, then layer expense classification and accountant export, then tax logic.";
    recommendedNextAction = "Build the receipt/document ingestion foundation before the tax specialist.";
    requiredProof.push("A working receipt/document ingestion path with confidence scoring.");
    requiredProof.push("An evidence trail (debug_events) proving extracted data is reliable.");
  } else if (isFrontendShell && !tiedToValue) {
    // Infrastructure cosplay — downgrade.
    verdict = "BUILD_LATER";
    reason =
      "A dashboard/cockpit with no approval, manual_required, or reporting anchor is infrastructure cosplay — " +
      "it looks impressive but removes no real friction yet.";
    simplerAlternative = "Start with a single high-value view (one approval queue or one report) before building a full cockpit.";
    recommendedNextAction = "Define the data contract and one concrete value-bearing view before building UI.";
    requiredProof.push("At least one real workflow that the cockpit would accelerate.");
    requiredProof.push("A data contract the cockpit can render (Phase 11G).");
  } else if (leverageScore >= 30 && costScore < 20) {
    verdict = "BUILD_NOW";
    reason = "High leverage with manageable cost — this removes real, repeated friction.";
    recommendedNextAction = "Proceed to CTO technical review and capability gap detection.";
    requiredProof.push("Confirm the required capabilities exist or can be acquired safely.");
  } else if (leverageScore >= 24) {
    verdict = "BUILD_LATER";
    reason = "Worthwhile leverage but the cost/complexity warrants sequencing it after current priorities.";
    recommendedNextAction = "Queue this build; revisit after foundations and higher-leverage work land.";
    requiredProof.push("A concrete example of the friction this removes.");
  } else if (leverageScore < 15 && costScore >= 24) {
    verdict = "DO_NOT_BUILD";
    reason = "Low real leverage against high complexity and maintenance burden — net negative.";
    simplerAlternative = "Solve the underlying need manually or with a small script before committing to a build.";
    recommendedNextAction = "Do not build. Re-scope to a smaller, higher-leverage slice.";
    requiredProof.push("Evidence that this is a repeated, high-value workflow — currently absent.");
  } else {
    verdict = "NEEDS_MORE_EVIDENCE";
    reason = "Leverage is plausible but unproven; gather evidence before committing build effort.";
    recommendedNextAction = "Collect usage evidence and re-run strategy review.";
    requiredProof.push("Quantify the friction (frequency × time) this would remove.");
  }

  return {
    request,
    verdict,
    reason,
    expectedLeverage,
    risk,
    maintenanceBurden,
    simplerAlternative,
    requiredProof,
    recommendedNextAction,
    scores,
  };
}
