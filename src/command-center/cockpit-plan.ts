/**
 * src/command-center/cockpit-plan.ts
 *
 * Produces the next-step cockpit plan: which actions are read-only vs gated vs
 * forbidden, what local command Hart should run next, and the FUTURE cockpit
 * phases. Phase 11G builds NO UI — this is the planning layer the future UI will
 * be built against.
 */

import type {
  ActionId,
  CockpitPhase,
  CockpitPlan,
  CardReadModel,
} from "./command-center-types.js";
import { ACTION_STATES } from "./action-contract.js";
import { collectMissingSources } from "./read-model.js";

/** The roadmap from contract (11G) to a real cockpit. Documented, not built. */
export const FUTURE_COCKPIT_PHASES: CockpitPhase[] = [
  {
    id: "11H_read_only_cockpit",
    title: "Read-only cockpit",
    description: "Render cards from the data contract + read model. View reports only. No actions.",
    status: "future",
  },
  {
    id: "11I_local_action_surface",
    title: "Local action surface",
    description: "Wire read_only + local_report_generation actions to existing npm commands. Still no mutation.",
    status: "future",
  },
  {
    id: "11J_approval_workflow",
    title: "Approval workflow",
    description: "Surface approval_required / manual_required queues with explicit human gates. No auto-approve.",
    status: "future",
  },
  {
    id: "11K_controlled_mutation",
    title: "Controlled mutation (gated)",
    description: "Only after dedicated safety phases: provider/Supabase/pack actions behind admin approval + audit.",
    status: "future",
  },
];

function actionsInState(state: string): ActionId[] {
  return (Object.keys(ACTION_STATES) as ActionId[])
    .filter((a) => ACTION_STATES[a] === state)
    .sort();
}

/**
 * Determine the single safe next command from the read model. Always returns a
 * safe, local command — never a mutation. Defaults to running the orchestrator.
 */
export function nextRecommendedCommand(readModels: CardReadModel[]): string {
  const missingOrchestrator = readModels.some(
    (rm) => rm.group === "orchestrator" && rm.status === "missing"
  );
  if (missingOrchestrator) {
    return 'npm run hartos:orchestrate -- --request="<your request>"';
  }
  const missingBeezulbub = readModels.some(
    (rm) => rm.group === "beezulbub" && rm.status === "missing"
  );
  if (missingBeezulbub) {
    return "npm run beezulbub:capability-list";
  }
  return "npm run hartos:handover";
}

export function buildCockpitPlan(
  readModels: CardReadModel[],
  now: Date = new Date()
): CockpitPlan {
  return {
    generatedAt: now.toISOString(),
    nextRecommendedCommand: nextRecommendedCommand(readModels),
    readOnlyActions: actionsInState("read_only"),
    approvalRequiredActions: actionsInState("approval_required"),
    manualRequiredActions: actionsInState("manual_required"),
    forbiddenActions: actionsInState("forbidden"),
    missingSources: collectMissingSources(readModels),
    futurePhases: FUTURE_COCKPIT_PHASES.map((p) => ({ ...p })),
  };
}
