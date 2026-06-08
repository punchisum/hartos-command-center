/**
 * src/cockpit/hosted-cto-context.ts
 *
 * Phase E — the hosted "CTO input brain".
 *
 * The hosted cockpit is read-only and filesystem-free, so it cannot run the full
 * local Orchestrator (capability-gap + CTO review read the capability registry
 * off disk). But the two highest-value pipeline stages — classifyRequest and
 * reviewStrategy — are PURE, deterministic functions of the request string. This
 * module runs them and packages a deterministic IntentOrchestratorContext so the
 * intent router's build / improve / strategy answers return a REAL risk-rated
 * verdict ("BUILD_LATER because… leverage low, risk high; next: …") instead of a
 * "go run it locally" chat reply.
 *
 * It is attached ONLY for build/strategy-flavoured requests (needsStrategyReview
 * or needsCtoReview). Pure status/fitness/ops/freshness questions get no context,
 * so their answers — and the "status questions create zero proposals" guarantee —
 * are completely unchanged. No filesystem, no network, no mutation.
 */

import { classifyRequest, requiredCapabilitiesFor } from "../hartos/request-classifier.js";
import { reviewStrategy } from "../hartos/strategy-review.js";
import type { IntentOrchestratorContext } from "./cockpit-intent-router.js";

/** Capability requirements the hosted cockpit can name (pure) but not verify (no registry). */
function capabilityRequirementLine(caps: string[]): string {
  return caps.length
    ? `${caps.length} capability requirement(s): ${caps.join(", ")} — verify in the local registry (the hosted cockpit has none).`
    : "No specific capability requirements identified for this target.";
}

/**
 * Build a deterministic orchestrator context for a build/strategy request, or
 * undefined when the request is not a build/strategy decision (status queries,
 * domain check-ins, etc.) — leaving every other answer untouched.
 */
export function buildHostedOrchestratorContext(request: string): IntentOrchestratorContext | undefined {
  const c = classifyRequest(request);
  if (!c.needsStrategyReview && !c.needsCtoReview) return undefined;

  // reviewStrategy is pure; foundations are conservatively assumed missing in
  // hosted mode (no registry), which the strategy module already handles.
  const strategy = c.needsStrategyReview ? reviewStrategy(request, { missingFoundationCapabilities: [] }) : null;
  const requiredCaps = requiredCapabilitiesFor(c.buildTarget);

  const strategyReview = strategy
    ? `${strategy.verdict} — ${strategy.reason} (leverage ${strategy.expectedLeverage}, cost/risk ${strategy.risk}, maintenance ${strategy.maintenanceBurden}). Recommended: ${strategy.recommendedNextAction}`
    : null;

  const ctoReview = c.needsCtoReview
    ? `${capabilityRequirementLine(requiredCaps)} Run \`npm run hartos:cto-review\` locally for the capability verdict.`
    : null;

  const buildPlanSummary = strategy
    ? (strategy.simplerAlternative ?? strategy.recommendedNextAction)
    : `${c.classification} in ${c.domain} (risk ${c.riskLevel}); run the local build plan for full sequencing.`;

  const capabilityGaps = capabilityRequirementLine(requiredCaps);

  const nextRecommendedCommand =
    strategy?.recommendedNextAction ??
    `npm run hartos:orchestrate -- --request="${request.replace(/"/g, "'").slice(0, 120)}"`;

  return {
    classification: c.classification,
    domain: c.domain,
    strategyReview,
    ctoReview,
    buildPlanSummary,
    capabilityGaps,
    nextRecommendedCommand,
  };
}
