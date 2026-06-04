/**
 * src/hartos/build-plan.ts
 *
 * Build plan generator. Composes classification + strategy + CTO + gap
 * into a structured, deterministic build plan with:
 *   - phase breakdown / build sequence
 *   - domain placement
 *   - approval gates
 *   - risks
 *   - do-not-build list
 *   - next prompt skeleton
 *
 * Read-only. No mutation. No provider calls.
 */

import path from "node:path";
import type {
  BuildPlanResult,
  BuildPlanPhase,
  ClassifiedRequest,
  StrategyReviewResult,
  CtoReviewResult,
  CapabilityGapResult,
} from "./orchestrator-types.js";
import { classifyRequest } from "./request-classifier.js";
import { reviewStrategy } from "./strategy-review.js";
import { reviewCto } from "./cto-review.js";
import { detectCapabilityGaps } from "./capability-gap.js";

export interface BuildPlanOptions {
  registryPath?: string;
  ledgerPath?: string;
  packsDir?: string;
  cwd?: string;
  classification?: ClassifiedRequest;
  strategy?: StrategyReviewResult | null;
  cto?: CtoReviewResult | null;
  gap?: CapabilityGapResult;
}

function domainPlacementFor(classification: ClassifiedRequest): string {
  switch (classification.domain) {
    case "tax": return "Finance domain → tax sub-module (depends on document ingestion).";
    case "finance": return "Finance domain (expenses, invoices, documents).";
    case "fitness": return "Fitness domain (training/workout tracking).";
    case "ops": return "Ops domain (deployment, monitoring, incidents).";
    case "command_center": return "Command Center domain — defer UI until Phase 11G data contract.";
    case "engineering": return "Engineering domain (Factory-built agent/feature).";
    case "research": return "Research domain (investigation, comparison).";
    case "personal_os": return "Personal OS domain.";
    case "unknown": return "Domain unresolved — requires Hart decision.";
  }
}

function phaseBreakdownFor(
  classification: ClassifiedRequest,
  gap: CapabilityGapResult
): BuildPlanPhase[] {
  const phases: BuildPlanPhase[] = [];

  if (classification.buildTarget === "tax_specialist") {
    phases.push({ order: 1, title: "Receipt / Finance Document Agent", description: "Document ingestion + receipt OCR with confidence scoring and an evidence trail." });
    phases.push({ order: 2, title: "Expense Classification", description: "Classify ingested documents into expense categories with human approval on low confidence." });
    phases.push({ order: 3, title: "Accountant Export", description: "Export reviewed, approved records in an accountant-friendly format." });
    phases.push({ order: 4, title: "Tax Specialist Agent", description: "Layer tax rules on top of the verified document + classification foundation." });
    return phases;
  }

  if (classification.buildTarget === "dashboard_cockpit") {
    phases.push({ order: 1, title: "Data Contract (Phase 11G)", description: "Define the read-only data contract the cockpit will render before building any UI." });
    phases.push({ order: 2, title: "Single Value View", description: "Build one high-value view (approval queue OR report viewer) against the contract." });
    phases.push({ order: 3, title: "Status + Manual-Required Panels", description: "Add agent status cards and manual_required panel once the contract is proven." });
    phases.push({ order: 4, title: "Full Cockpit Assembly", description: "Assemble remaining panels only after individual views deliver value." });
    return phases;
  }

  // Generic: order by capability acquisition then integration.
  let order = 1;
  if (gap.missingCapabilities.length > 0) {
    phases.push({ order: order++, title: "Acquire Missing Capabilities", description: `Beezulbub scout/digest/pack for: ${gap.missingCapabilities.join(", ")}.` });
  }
  if (gap.planningOnlyCapabilities.length > 0) {
    phases.push({ order: order++, title: "Verify Implementation Drafts", description: `Verify + promote: ${gap.planningOnlyCapabilities.join(", ")}.` });
  }
  phases.push({ order: order++, title: "Integrate Under Approval Gates", description: "Wire usable capabilities into the agent behind HartOS approval gates." });
  phases.push({ order: order++, title: "Verify + Smoke", description: "Run verify and smoke:local before any deployment consideration." });
  return phases;
}

function doNotBuildFor(classification: ClassifiedRequest): string[] {
  const base = [
    "Command Center frontend UI before the Phase 11G data contract is defined.",
    "Autonomous execution / self-healing / worker swarm.",
    "Any provider mutation (Supabase / Cloudflare / Telegram / GitHub) without explicit CONFIRM gates.",
    "Treating skeleton or implementation_draft packs as production-ready.",
  ];
  if (classification.buildTarget === "tax_specialist") {
    base.unshift("Tax Specialist Agent before the document-ingestion foundation exists.");
  }
  if (classification.buildTarget === "dashboard_cockpit") {
    base.unshift("Full cockpit UI before one value-bearing view is proven against the data contract.");
  }
  return base;
}

function buildNextPromptSkeleton(
  classification: ClassifiedRequest,
  strategy: StrategyReviewResult | null,
  cto: CtoReviewResult | null,
  gap: CapabilityGapResult
): string {
  const lines = [
    "## Next prompt skeleton (paste into next session)",
    "",
    `Request: ${classification.request}`,
    `Classification: ${classification.classification} (domain: ${classification.domain}, risk: ${classification.riskLevel})`,
    `Strategy verdict: ${strategy ? strategy.verdict : "n/a"}`,
    `CTO verdict: ${cto ? cto.technicalVerdict : "n/a"}`,
    `Usable capabilities: ${gap.usableCapabilities.join(", ") || "none"}`,
    `Missing capabilities: ${gap.missingCapabilities.join(", ") || "none"}`,
    "",
    "Goal for next session:",
    "- [ ] Address the first phase of the build plan below",
    "- [ ] Respect all approval gates (no provider mutation)",
    "- [ ] Do not treat skeleton/implementation_draft packs as production-ready",
    "",
    "Constraints:",
    "- Local, deterministic, report-driven only",
    "- No deploys, no Supabase mutation, no live GitHub",
  ];
  return lines.join("\n");
}

export async function generateBuildPlan(
  request: string,
  options: BuildPlanOptions = {}
): Promise<BuildPlanResult> {
  const cwd = options.cwd ?? process.cwd();

  const classification = options.classification ?? classifyRequest(request);

  const gap =
    options.gap ??
    (await detectCapabilityGaps(request, {
      registryPath: options.registryPath,
      ledgerPath: options.ledgerPath,
      cwd,
    }));

  const strategy =
    options.strategy !== undefined
      ? options.strategy
      : classification.needsStrategyReview
        ? reviewStrategy(request, { missingFoundationCapabilities: gap.missingCapabilities })
        : null;

  const cto =
    options.cto !== undefined
      ? options.cto
      : classification.needsCtoReview
        ? await reviewCto(request, {
            registryPath: options.registryPath,
            ledgerPath: options.ledgerPath,
            packsDir: options.packsDir,
            cwd,
          })
        : null;

  const phaseBreakdown = phaseBreakdownFor(classification, gap);
  const domainPlacement = domainPlacementFor(classification);
  const doNotBuild = doNotBuildFor(classification);

  const recommendedBeezulbubActions = cto ? [...cto.recommendedBeezulbubActions] : [];
  const recommendedFactoryActions = cto ? [...cto.recommendedFactoryActions] : [];

  const approvalGates = [
    "Strategy approval (Hart) before committing build effort.",
    "BEEZULBUB_ALLOW_PACK_IMPLEMENT + --approve-implementation before implementing any pack.",
    "BEEZULBUB_ALLOW_PACK_PROMOTE + --approve-promote before promoting any pack.",
    "CONFIRM_PRODUCTION_DEPLOY (and provider gates) before any deployment.",
  ];

  const risks: string[] = [];
  if (cto) risks.push(...cto.risks);
  if (strategy && strategy.risk === "high") {
    risks.push(`Strategy flags high risk: ${strategy.reason}`);
  }
  if (gap.planningOnlyCapabilities.length > 0) {
    risks.push(`Planning-only capabilities must not ship to production: ${gap.planningOnlyCapabilities.join(", ")}.`);
  }
  if (risks.length === 0) risks.push("No blocking risks detected at planning stage.");

  const nextPromptSkeleton = buildNextPromptSkeleton(classification, strategy, cto, gap);

  return {
    request,
    classification,
    strategy,
    cto,
    gap,
    existingCapabilities: gap.usableCapabilities,
    missingCapabilities: gap.missingCapabilities,
    recommendedBeezulbubActions,
    recommendedFactoryActions,
    phaseBreakdown,
    domainPlacement,
    approvalGates,
    risks,
    doNotBuild,
    nextPromptSkeleton,
  };
}
