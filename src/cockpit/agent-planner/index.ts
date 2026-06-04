/**
 * src/cockpit/agent-planner/index.ts
 *
 * Phase 17A — Agent Creation Planner entry point. Pure, dry-run-only planning;
 * no filesystem, no network, no provider calls, no mutation, no execution.
 */

export {
  planAgentCreation,
  buildAgentDraft,
  recommendSkills,
  planScaffold,
  planProviders,
  deriveAgentName,
  FACTORY_SKILL_CATALOG,
} from "./agent-planner.js";
export type {
  AgentCreationPlan,
  AgentCreationDraft,
  AgentDraftAnswers,
  AgentDraftField,
  ScaffoldPlanItem,
  ProviderPlanItem,
  PlanAgentCreationOptions,
} from "./agent-planner.js";
