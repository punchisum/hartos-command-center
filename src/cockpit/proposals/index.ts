/**
 * src/cockpit/proposals/index.ts
 *
 * Phase 14A — Safe Action Proposal layer entry point. Proposal + approval +
 * simulation only. There is NO real execution anywhere in this module.
 */

export * from "./proposal-types.js";
export {
  PROPOSALS_GATE,
  EXECUTION_GATE,
  proposalsAllowed,
  executionAllowed,
  executeProposal,
  executionDisabledReason,
  ActionExecutionDisabledError,
  type GateEnv,
} from "./gates.js";
export { simulateProposal } from "./proposal-simulator.js";
export { generateProposals, requestsExplicitProposal, requestsRefreshPlan } from "./proposal-generator.js";
export type { ProposalContext, ProposalOrchestratorContext } from "./proposal-generator.js";
export {
  DEFAULT_PROPOSAL_QUEUE_DIR,
  toQueueItem,
  saveProposal,
  listProposals,
  readProposal,
  resolveRef,
  rejectProposal,
  markSimulatedApproved,
  approveForExecution,
  markExecuted,
  revokeExecutionApproval,
  executionAuthorizationAgeMs,
  assertCockpitSettableStatus,
  deriveSpecId,
  appendAudit,
  expireStaleProposals,
  dryRunProposalInQueue,
  rejectAllDraftProposals,
  expireDuplicateProposals,
  proposalHistory,
  type ProposalRef,
  type BulkRejectResult,
  type ExpireDuplicatesResult,
  type ProposalHistory,
} from "./proposal-queue.js";
