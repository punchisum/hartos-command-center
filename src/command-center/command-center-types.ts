/**
 * src/command-center/command-center-types.ts
 *
 * Types for the HartOS Command Center data contract (Phase 11G).
 *
 * Architectural rule:
 *   Orchestrator = brain (decides)
 *   Command Center = control surface (reads + routes, never decides, never mutates)
 *
 * This layer is local, deterministic, and report-driven. It defines WHAT a
 * future cockpit UI may show and WHICH actions are safe. It NEVER executes
 * provider/Supabase/pack mutations, NEVER calls the network, and NEVER prints
 * secrets. Phase 11G defines the contract only — no UI is built.
 */

// ─── Card groups ───────────────────────────────────────────────────────────────

export type CardGroup =
  | "orchestrator"
  | "factory"
  | "beezulbub"
  | "agents"
  | "human_control";

export const CARD_GROUPS: CardGroup[] = [
  "orchestrator",
  "factory",
  "beezulbub",
  "agents",
  "human_control",
];

// ─── Data sources ────────────────────────────────────────────────────────────

/** How a card's data is sourced. All sources are LOCAL files/dirs only. */
export type SourceType =
  | "report_dir" // a directory of generated *.md/*.json reports
  | "json_file" // a single local JSON file (e.g. capability registry)
  | "doc_file" // a single local markdown doc
  | "glob" // a glob over local files (e.g. packs/* /pack.manifest.json)
  | "derived" // computed locally from other cards' read models
  | "none"; // no offline source yet — always degrades to a recommendation

export type FreshnessPolicy =
  | "latest_report" // use the most recent report in the dir
  | "always_regenerate" // re-run the local report command before reading
  | "static" // contract/registry file rarely changes
  | "on_demand"; // generated only when explicitly requested

export type RiskLevel = "low" | "medium" | "high" | "critical";

// ─── Action contract ───────────────────────────────────────────────────────────

/** Every state a Command Center action can be in. No state executes anything. */
export type ActionState =
  | "read_only"
  | "local_report_generation"
  | "approval_required"
  | "manual_required"
  | "forbidden"
  | "future";

export type ActionId =
  | "view_report"
  | "generate_report"
  | "open_handover"
  | "review_pack"
  | "run_orchestrator"
  | "run_strategy_review"
  | "run_cto_review"
  | "run_build_plan"
  | "run_launch_verify"
  | "run_bootstrap_verify"
  | "approve_manual_required"
  | "execute_provider_mutation"
  | "promote_pack"
  | "deploy_agent";

// ─── Approval contract ──────────────────────────────────────────────────────────

export type ApprovalCategory =
  | "none"
  | "human_review"
  | "human_approval"
  | "admin_approval"
  | "forbidden";

export type ApprovalReason =
  | "provider_mutation"
  | "supabase_mutation"
  | "pack_promotion"
  | "production_deploy"
  | "secret_boundary"
  | "third_party_code"
  | "data_privacy"
  | "business_critical";

export interface ApprovalRule {
  action: ActionId;
  category: ApprovalCategory;
  reasons: ApprovalReason[];
  note: string;
}

// ─── Card definition ─────────────────────────────────────────────────────────

export interface CardDefinition {
  id: string;
  group: CardGroup;
  title: string;
  description: string;
  sourceType: SourceType;
  /** Local paths only (relative to the agent repo root). Never URLs. */
  sourcePaths: string[];
  freshnessPolicy: FreshnessPolicy;
  riskLevel: RiskLevel;
  allowedActions: ActionId[];
  blockedActions: ActionId[];
  requiresApproval: boolean;
}

// ─── Read model ────────────────────────────────────────────────────────────────

export type ReadStatus = "ok" | "missing" | "empty" | "error";
export type Confidence = "high" | "medium" | "low";

export interface CardReadModel {
  cardId: string;
  group: CardGroup;
  status: ReadStatus;
  confidence: Confidence;
  /** Source paths that were found locally. */
  presentSources: string[];
  /** Source paths that were absent (degrade safely). */
  missingSources: string[];
  summary: string;
  /** Always a safe, local command to run — never a mutation. */
  safeRecommendation: string;
}

// ─── Data contract (assembled) ──────────────────────────────────────────────────

export interface DataContract {
  generatedAt: string;
  cardCount: number;
  groups: CardGroup[];
  allowedSourceRoots: string[];
  cards: CardDefinition[];
}

// ─── Cockpit plan ────────────────────────────────────────────────────────────

export interface CockpitPhase {
  id: string;
  title: string;
  description: string;
  status: "planned" | "future";
}

export interface CockpitPlan {
  generatedAt: string;
  nextRecommendedCommand: string;
  readOnlyActions: ActionId[];
  approvalRequiredActions: ActionId[];
  manualRequiredActions: ActionId[];
  forbiddenActions: ActionId[];
  missingSources: string[];
  futurePhases: CockpitPhase[];
}
