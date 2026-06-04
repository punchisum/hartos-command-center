/**
 * src/cockpit/proposals/proposal-simulator.ts
 *
 * Phase 14A.4 — dry-run / simulation helpers ONLY. Simulation never performs a
 * real action, never writes, never calls a provider. It returns a description
 * of what WOULD happen plus why real execution is disabled.
 */

import type { ActionProposal, DryRunResult } from "./proposal-types.js";
import { executionDisabledReason, type GateEnv } from "./gates.js";

/** Per-action-type description of what a real run would (eventually) touch. */
function effectFor(proposal: ActionProposal): { wouldHappen: string; dataWouldTouch: string[]; futureSetup: string[] } {
  switch (proposal.actionType) {
    case "build_agent_plan":
      return {
        wouldHappen: "Would scaffold a new agent project from the Factory templates and write a build plan report.",
        dataWouldTouch: ["a new local agent directory (not created)", "hartos-reports/ (build plan)"],
        futureSetup: ["A Factory build-execution gate", "Confirmed strategy + CTO review", "Hart approval of the scaffold target"],
      };
    case "agent_creation_plan":
      return {
        wouldHappen:
          "Would generate the agent spec (Factory AgentConfig), scaffold the repo from Factory templates, and run the provider provisioning plan. NOTHING is created here — this is a plan only.",
        dataWouldTouch: [
          "a new agent repo directory (not created)",
          "the chosen Factory skills/templates (read-only)",
          "a provider provisioning plan (dry-run; no GitHub/Supabase/Cloudflare/Telegram writes)",
        ],
        futureSetup: [
          "Hart approval of the spec + scaffold target",
          "A Factory build-execution gate (does not exist yet)",
          "Per-provider provisioning gates (ALLOW_AUTO_PROVISION + CONFIRM_* — stay closed)",
        ],
      };
    case "improve_agent_plan":
      return {
        wouldHappen: "Would open a change plan against the target agent's files/modules and prepare a test plan.",
        dataWouldTouch: ["target agent source files (read-only here)", "a draft change plan (not written)"],
        futureSetup: ["A code-change execution gate", "A passing test plan", "Hart approval of the diff"],
      };
    case "ops_followup_plan":
      return {
        wouldHappen: "Would prepare a follow-up plan for the urgent/blocked ops items (read-only summary, no ClickUp write).",
        dataWouldTouch: ["read-only ops read-model rows", "a local follow-up note (not written)"],
        futureSetup: ["A ClickUp write boundary (explicitly out of scope)", "Hart approval per card"],
      };
    case "fitness_adjustment_plan":
      return {
        wouldHappen: "Would propose a training/nutrition adjustment based on read-only recovery/load data.",
        dataWouldTouch: ["read-only fitness read-model rows"],
        futureSetup: ["A coaching action boundary", "Hart approval of the adjustment"],
      };
    case "ranked_build_plan":
      return {
        wouldHappen: "Would produce a ranked list of candidate builds with rationale.",
        dataWouldTouch: ["capability registry (read-only)", "panel gap analysis (read-only)"],
        futureSetup: ["Hart selection of one ranked item to plan in detail"],
      };
    case "sync_repair_plan":
      return {
        wouldHappen:
          "Would draft a manual checklist to refresh stale data (e.g. re-run the ClickUp import) and re-verify freshness. NO import is triggered and no provider is called.",
        dataWouldTouch: ["read-only freshness/diagnostics (read-only)", "a local refresh checklist (not written)"],
        futureSetup: ["A ClickUp import trigger boundary (explicitly out of scope)", "Hart runs the import manually"],
      };
    case "review_plan":
    default:
      return {
        wouldHappen: "Would compile a strategy/CTO review note from read-only context.",
        dataWouldTouch: ["panel context (read-only)", "orchestrator review output (read-only)"],
        futureSetup: ["Hart decision on the recommendation"],
      };
  }
}

/** Produce a dry-run result for a proposal. Pure, read-only, never executes. */
export function simulateProposal(proposal: ActionProposal, env: GateEnv = process.env): DryRunResult {
  const { wouldHappen, dataWouldTouch, futureSetup } = effectFor(proposal);
  return {
    wouldHappen,
    dataWouldTouch,
    approvalRequired: `${proposal.requiredApproval} approval (risk: ${proposal.riskLevel}).`,
    executionDisabledReason: executionDisabledReason(env),
    futureSetupRequired: futureSetup,
    executed: false,
  };
}
