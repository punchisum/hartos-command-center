/**
 * src/hartos/request-classifier.ts
 *
 * Deterministic, keyword-based request classifier for the Orchestrator.
 * No network. No mutation. Pure function of the request string.
 *
 * Also the single source of truth for:
 *   - build-target detection (detectBuildTarget)
 *   - required-capability mapping (requiredCapabilitiesFor)
 * shared by strategy-review, cto-review, and capability-gap.
 */

import type {
  ClassifiedRequest,
  RequestClassification,
  Domain,
  RiskLevel,
  RecommendedSpecialist,
  BuildTarget,
} from "./orchestrator-types.js";

// ─── Required capabilities per build target ──────────────────────────────────

const CAPABILITY_REQUIREMENTS: Record<BuildTarget, string[]> = {
  tax_specialist: [
    "receipt_ocr",
    "document_ingest",
    "expense_classification",
    "accountant_export",
    "approval_queue",
    "tax_rules_reference",
  ],
  dashboard_cockpit: [
    "dashboard_layout",
    "agent_status_card",
    "manual_required_panel",
    "report_viewer",
    "debug_timeline",
    "approval_panel",
  ],
  receipt_agent: [
    "receipt_ocr",
    "file_upload",
    "expense_classification",
    "confidence_scoring",
    "approval_draft",
    "export_csv",
  ],
  generic: [],
};

export function requiredCapabilitiesFor(target: BuildTarget): string[] {
  return [...CAPABILITY_REQUIREMENTS[target]];
}

// ─── Keyword helpers ──────────────────────────────────────────────────────────

function has(text: string, ...needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

// ─── Build-target detection ───────────────────────────────────────────────────

export function detectBuildTarget(request: string): BuildTarget {
  const t = request.toLowerCase();
  // Tax takes priority — tax depends on receipt/document foundations.
  if (has(t, "tax")) return "tax_specialist";
  if (has(t, "dashboard", "cockpit", "command center", "command centre")) {
    return "dashboard_cockpit";
  }
  if (has(t, "receipt")) return "receipt_agent";
  return "generic";
}

// ─── Domain detection ─────────────────────────────────────────────────────────

function detectDomain(t: string): Domain {
  if (has(t, "tax")) return "tax";
  if (has(t, "finance", "expense", "invoice", "accounting", "receipt", "money", "revenue")) {
    return "finance";
  }
  if (has(t, "fitness", "workout", "gym", "training", "exercise")) return "fitness";
  if (has(t, "ops ", "operations", "deploy", "infra", "monitoring", "monitor", "uptime")) {
    return "ops";
  }
  if (has(t, "research", "investigate", "explore", "compare")) return "research";
  // Build/engineering tasks — including command-center/cockpit builds.
  if (has(t, "command center", "command centre", "cockpit", "dashboard", "agent", "build", "code", "api", "worker", "engineering")) {
    return "engineering";
  }
  if (has(t, "personal", "my life", "daily")) return "personal_os";
  return "unknown";
}

// ─── Classification ───────────────────────────────────────────────────────────

function detectClassification(t: string): RequestClassification {
  // 1. Handover
  if (has(t, "handover", "hand over", "handoff", "hand off")) return "handover_request";

  // 2. Debug / something broken
  if (has(t, "debug", "broken", "is failing", "failing test", "error", "not working", "doesn't work", "does not work", "fix the", "stack trace", "crash")) {
    return "debug_request";
  }

  // 3. New agent build (build/create/make + agent)
  if (has(t, "build", "create", "make", "new", "spin up") && has(t, "agent")) {
    return "new_agent_build";
  }

  // 4. Pack / capability acquisition
  if (has(t, "absorb", "devour", "scout", "open source", "open-source", "github.com", "pack from", "ingest repo")) {
    return "pack_request";
  }

  // 5. Explicit strategy review
  if (has(t, "should i build", "should hart", "is it worth", "worth building", "worth it", "strategy review", "opportunity cost")) {
    return "strategy_review";
  }

  // 6. Feature build (build/add/create/implement + a buildable noun, no agent)
  if (
    has(t, "build", "add", "create", "implement", "ship") &&
    has(t, "feature", "command center", "command centre", "cockpit", "dashboard", "panel", "page", "view", "report", "export", "endpoint", "command")
  ) {
    return "feature_build";
  }

  // 7. Domain-specific operational requests
  if (has(t, "fitness", "workout", "gym", "training", "exercise")) return "fitness_request";
  if (has(t, "finance", "expense", "invoice", "accounting", "tax", "money")) return "finance_request";
  if (has(t, "ops ", "operations", "deploy", "infra", "monitoring", "monitor", "uptime", "incident")) return "ops_request";
  if (has(t, "research", "investigate", "explore", "compare")) return "research_request";

  return "unknown";
}

// ─── Risk ──────────────────────────────────────────────────────────────────────

function detectRisk(classification: RequestClassification, domain: Domain, t: string): RiskLevel {
  if (classification === "new_agent_build") return "high";
  if (domain === "tax" || domain === "finance") return "high";
  if (has(t, "command center", "command centre", "cockpit") && has(t, "build", "create")) return "high";
  if (classification === "feature_build" || classification === "pack_request" || classification === "debug_request" || classification === "ops_request") {
    return "medium";
  }
  if (classification === "fitness_request" || classification === "research_request" || classification === "handover_request" || classification === "strategy_review") {
    return "low";
  }
  return "medium";
}

// ─── Specialist routing ──────────────────────────────────────────────────────

function mapSpecialist(classification: RequestClassification, needsStrategyReview: boolean): RecommendedSpecialist {
  if (needsStrategyReview) return "strategy_review";
  switch (classification) {
    case "debug_request": return "cto";
    case "pack_request": return "beezulbub";
    case "fitness_request": return "fitness_agent";
    case "finance_request": return "finance_agent";
    case "ops_request": return "ops_agent";
    case "research_request": return "strategy_review";
    case "strategy_review": return "strategy_review";
    case "new_agent_build":
    case "feature_build": return "cto";
    case "handover_request": return "manual_hart_decision";
    case "unknown": return "manual_hart_decision";
  }
}

// ─── Main classifier ──────────────────────────────────────────────────────────

export function classifyRequest(request: string): ClassifiedRequest {
  const t = request.toLowerCase().trim();
  const rationale: string[] = [];

  const classification = detectClassification(t);
  const domain = detectDomain(t);
  const buildTarget = detectBuildTarget(request);
  const riskLevel = detectRisk(classification, domain, t);

  const isBuild = classification === "new_agent_build" || classification === "feature_build";
  // Strategy review gates on *build* decisions, not on domain risk alone.
  // (A debug/ops request that merely mentions a high-risk domain must not be
  //  forced through strategy review.)
  const needsStrategyReview = isBuild || classification === "strategy_review";
  const needsCtoReview =
    classification === "new_agent_build" ||
    classification === "feature_build" ||
    classification === "pack_request" ||
    classification === "debug_request";

  const recommendedSpecialist = mapSpecialist(classification, needsStrategyReview);

  rationale.push(`Classified as ${classification} (domain: ${domain}, risk: ${riskLevel}).`);
  if (buildTarget !== "generic") {
    rationale.push(`Detected build target: ${buildTarget}.`);
  }
  if (needsStrategyReview) {
    rationale.push("Strategy review recommended before any build commitment.");
  }
  if (needsCtoReview) {
    rationale.push("CTO technical review applies (engineering/build matter).");
  }
  if (classification === "unknown") {
    rationale.push("Request did not match a known pattern — routing to manual Hart decision.");
  }

  return {
    request,
    classification,
    domain,
    riskLevel,
    recommendedSpecialist,
    buildTarget,
    needsStrategyReview,
    needsCtoReview,
    rationale,
  };
}
