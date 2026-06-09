import { officiateAgent, type OfficiationResult } from "../agents/officiation.js";
import { resolveKnownAgents } from "../agents/known-agent-registry.js";
import type { AgentManifest } from "./manifest-types.js";
import type { AgentContract } from "../agents/agent-contract.js";
import type { ReadModelSummary } from "../read-models/read-model-types.js";
import type { TypedActionProposal } from "../cockpit/proposals/proposal-types.js";

export interface OfficiationOutcome {
  officiated: boolean;
  agentType: string;
  contract: AgentContract;
  result: OfficiationResult;
  /** A planning-only proposal to persist this contract to cockpit_agents (never executed here). */
  persistProposal: TypedActionProposal;
  /** All known agents AFTER this one is folded in (deduped, static wins). */
  expandedRegistry: AgentContract[];
  violations: string[];
}

function stubContract(): AgentContract {
  return {
    type: "other",
    label: "",
    icon: "",
    readModelId: "",
    proposalTypes: [],
    approvalRequired: false,
    detail: { kind: "bespoke" },
  };
}

function stubResult(agentType: string): OfficiationResult {
  return {
    officiated: false,
    type: agentType,
    card: { label: "", icon: "" },
    detailRoute: `/agent/${agentType}/ui`,
    proposalTypes: [],
    approvalRequired: false,
    violations: [],
  };
}

function stubProposal(agentType: string): TypedActionProposal {
  return {
    id: `persist-agent-${agentType}`,
    domain: "system",
    // "persist_agent_contract" is not in ProposalActionType union but is the canonical
    // semantic for this lifecycle event; cast is intentional and isolated here.
    actionType: "build_agent_plan",
    title: `Register agent: ${agentType}`,
    description: `Persist born agent contract for ${agentType} to cockpit_agents so it survives restarts.`,
    sourceIntent: "factory-officiator",
    proposedPayload: { agentType, dryRun: true },
    expectedEffect: `Agent ${agentType} appears in cockpit fleet card after approval.`,
    riskLevel: "low",
    requiredApproval: "Hart",
    status: "draft",
    createdAt: "",
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "dryRun=true; actual write to cockpit_agents requires go-live authorization.",
    dryRunResult: null,
    executable: false,
    tier: "T1",
  } as unknown as TypedActionProposal;
}

function buildPersistProposal(contract: AgentContract, now: string): TypedActionProposal {
  return {
    id: `persist-agent-${contract.type}`,
    domain: "system",
    actionType: "build_agent_plan",
    title: `Register agent: ${contract.type}`,
    description: `Persist born agent contract for ${contract.type} to cockpit_agents so it survives restarts.`,
    sourceIntent: "factory-officiator",
    proposedPayload: { agentType: contract.type, label: contract.label, dryRun: true },
    expectedEffect: `Agent ${contract.type} appears in cockpit fleet card after approval.`,
    riskLevel: "low",
    requiredApproval: "Hart",
    status: "draft",
    createdAt: now,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "dryRun=true; actual write to cockpit_agents requires go-live authorization.",
    dryRunResult: null,
    executable: false,
    tier: "T1",
  } as unknown as TypedActionProposal;
}

export function officiateFromManifest(
  manifest: AgentManifest,
  healthySummary: ReadModelSummary,
  opts?: { now?: string },
): OfficiationOutcome {
  const now = opts?.now ?? "";

  const contract: AgentContract | undefined = manifest.contract;
  if (!contract) {
    const stub = stubContract();
    return {
      officiated: false,
      agentType: "",
      contract: stub,
      result: stubResult(""),
      persistProposal: stubProposal(""),
      expandedRegistry: resolveKnownAgents([]),
      violations: ["no contract in manifest"],
    };
  }

  const result = officiateAgent(contract, healthySummary);
  const expandedRegistry = resolveKnownAgents([contract]);
  const persistProposal = buildPersistProposal(contract, now);
  const violations = result.violations.map((v) => `${v.facet}: ${v.detail}`);

  return {
    officiated: result.officiated,
    agentType: contract.type,
    contract,
    result,
    persistProposal,
    expandedRegistry,
    violations,
  };
}
