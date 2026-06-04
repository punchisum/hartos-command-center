/**
 * src/hartos/orchestrator-types.ts
 *
 * Types for the HartOS Orchestrator + CTO MVP (Phase 11F).
 *
 * Hierarchy:
 *   Hart → Orchestrator → Specialists/modules
 *   Orchestrator = command router / chief of staff
 *   CTO          = engineering/build specialist
 *   Prophet      = strategy-review module inside Orchestrator
 *
 * This layer is local, deterministic, report-driven.
 * It produces recommendations only — it NEVER mutates packs, registries,
 * providers, or Supabase, and it NEVER executes provider actions.
 */

// ─── Magnitude scales ─────────────────────────────────────────────────────────

export type Magnitude = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";

// ─── Request classification ─────────────────────────────────────────────────

export type RequestClassification =
  | "new_agent_build"
  | "feature_build"
  | "pack_request"
  | "strategy_review"
  | "ops_request"
  | "fitness_request"
  | "finance_request"
  | "research_request"
  | "debug_request"
  | "handover_request"
  | "unknown";

export type Domain =
  | "personal_os"
  | "engineering"
  | "fitness"
  | "ops"
  | "finance"
  | "tax"
  | "command_center"
  | "research"
  | "unknown";

export type RecommendedSpecialist =
  | "cto"
  | "fitness_agent"
  | "ops_agent"
  | "finance_agent"
  | "strategy_review"
  | "beezulbub"
  | "manual_hart_decision";

/** Build target — drives required-capability detection. */
export type BuildTarget =
  | "tax_specialist"
  | "dashboard_cockpit"
  | "receipt_agent"
  | "generic";

export interface ClassifiedRequest {
  request: string;
  classification: RequestClassification;
  domain: Domain;
  riskLevel: RiskLevel;
  recommendedSpecialist: RecommendedSpecialist;
  buildTarget: BuildTarget;
  needsStrategyReview: boolean;
  needsCtoReview: boolean;
  rationale: string[];
}

// ─── Strategy review (Prophet) ───────────────────────────────────────────────

export type StrategyVerdict =
  | "BUILD_NOW"
  | "BUILD_LATER"
  | "DO_NOT_BUILD"
  | "DEVOUR_EXISTING_CAPABILITY"
  | "MERGE_WITH_EXISTING_AGENT"
  | "NEEDS_MORE_EVIDENCE";

export interface StrategyScoreDimensions {
  real_friction_removed: number;
  decision_quality_improved: number;
  repeated_workflow_automated: number;
  blind_spot_exposed: number;
  revenue_or_time_impact: number;
  urgency: number;
  complexity: number;
  maintenance_burden: number;
  dependency_risk: number;
  opportunity_cost: number;
}

export interface StrategyReviewResult {
  request: string;
  verdict: StrategyVerdict;
  reason: string;
  expectedLeverage: Magnitude;
  risk: RiskLevel;
  maintenanceBurden: Magnitude;
  simplerAlternative: string | null;
  requiredProof: string[];
  recommendedNextAction: string;
  scores: StrategyScoreDimensions;
}

// ─── CTO technical review ────────────────────────────────────────────────────

export type TechnicalVerdict =
  | "build_with_existing_capabilities"
  | "build_with_new_capabilities"
  | "needs_beezulbub_acquisition"
  | "blocked_missing_capabilities"
  | "defer_to_strategy"
  | "insufficient_information";

export interface CtoReviewResult {
  request: string;
  technicalVerdict: TechnicalVerdict;
  existingCapabilities: string[];
  missingCapabilities: string[];
  planningOnlyCapabilities: string[];
  recommendedBeezulbubActions: string[];
  recommendedFactoryActions: string[];
  risks: string[];
  dependencies: string[];
  implementationSequence: string[];
  humanApprovalsRequired: string[];
}

// ─── Capability gap detection ────────────────────────────────────────────────

export type CapabilityUsability = "usable" | "planning_only" | "not_usable" | "missing";

export interface CapabilityGapItem {
  capabilityId: string;
  /** Registry status, or "missing" if not present in the registry. */
  registryStatus: string;
  usability: CapabilityUsability;
  hasProvenance: boolean;
  recommendation: string;
  /** Recommended Beezulbub command, or null if the capability is already usable. */
  recommendedBeezulbubAction: string | null;
}

export interface CapabilityGapResult {
  request: string;
  buildTarget: BuildTarget;
  requiredCapabilities: string[];
  items: CapabilityGapItem[];
  usableCapabilities: string[];
  planningOnlyCapabilities: string[];
  missingCapabilities: string[];
}

// ─── Build plan ──────────────────────────────────────────────────────────────

export interface BuildPlanPhase {
  order: number;
  title: string;
  description: string;
}

export interface BuildPlanResult {
  request: string;
  classification: ClassifiedRequest;
  strategy: StrategyReviewResult | null;
  cto: CtoReviewResult | null;
  gap: CapabilityGapResult;
  existingCapabilities: string[];
  missingCapabilities: string[];
  recommendedBeezulbubActions: string[];
  recommendedFactoryActions: string[];
  phaseBreakdown: BuildPlanPhase[];
  domainPlacement: string;
  approvalGates: string[];
  risks: string[];
  doNotBuild: string[];
  nextPromptSkeleton: string;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface OrchestratorResult {
  request: string;
  classification: ClassifiedRequest;
  strategy: StrategyReviewResult | null;
  cto: CtoReviewResult | null;
  gap: CapabilityGapResult | null;
  buildPlan: BuildPlanResult | null;
  generatedAt: string;
  reportPath?: string;
}

// ─── Handover ────────────────────────────────────────────────────────────────

export interface HandoverResult {
  request: string | null;
  classification: string | null;
  strategyVerdict: string | null;
  ctoVerdict: string | null;
  capabilityStatus: string[];
  recommendedNextAction: string;
  commandsToRunNext: string[];
  risks: string[];
  openQuestions: string[];
  /** Source report that this handover was derived from, if any. */
  sourceReport: string | null;
}

/** Safe JSON sidecar written next to orchestrator reports (no secrets). */
export interface OrchestratorReportSidecar {
  request: string;
  generatedAt: string;
  classification: RequestClassification;
  domain: Domain;
  riskLevel: RiskLevel;
  buildTarget: BuildTarget;
  strategyVerdict: StrategyVerdict | null;
  technicalVerdict: TechnicalVerdict | null;
  usableCapabilities: string[];
  missingCapabilities: string[];
  recommendedBeezulbubActions: string[];
  recommendedFactoryActions: string[];
  risks: string[];
  doNotBuild: string[];
  recommendedNextAction: string;
  commandsToRunNext: string[];
}
