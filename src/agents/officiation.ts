/**
 * src/agents/officiation.ts — Phase 4.2: officiate a created agent into the cockpit.
 *
 * "Officiation" is the gate the Factory runs before a newly-created agent goes live: it
 * validates the agent's declared AgentContract (Phase 1.1) against the 7-point officiation
 * contract — a banded signal from a representative read, a fleet-card identity, a
 * /agent/<type>/ui detail route, a propose-only proposal vocabulary, and the doctrine
 * binding (executable:false unless an approved adapter). An agent is officiated ONLY when
 * it earns all of that with zero violations; otherwise it is refused with the reasons.
 * Pure; no I/O — the Factory composes this with the registries.
 */

import { type AgentContract, assertOfficiable, type ContractViolation, AGENT_CONTRACTS } from "./agent-contract.js";
import type { ReadModelSummary } from "../read-models/read-model-types.js";

export interface OfficiationResult {
  officiated: boolean;
  type: string;
  /** The fleet-card identity this agent earns (renders the moment it's officiated). */
  card: { label: string; icon: string };
  /** The detail page route it gets — bespoke or generic, no new UI code either way. */
  detailRoute: string;
  /** The propose-only proposal vocabulary it may emit. */
  proposalTypes: string[];
  /** Whether its proposals require human approval. */
  approvalRequired: boolean;
  /** Empty iff officiated; every reason it was refused otherwise. */
  violations: ContractViolation[];
}

/**
 * Officiate one agent against a representative HEALTHY summary. Returns the cockpit-facing
 * identity it earns + any violations. `officiated` is true only when there are none.
 */
export function officiateAgent(
  contract: AgentContract,
  healthySummary: ReadModelSummary,
  opts: { now?: Date } = {},
): OfficiationResult {
  const violations = assertOfficiable(contract, healthySummary, opts);
  return {
    officiated: violations.length === 0,
    type: contract.type,
    card: { label: contract.label, icon: contract.icon },
    detailRoute: `/agent/${contract.type}/ui`,
    proposalTypes: contract.proposalTypes,
    approvalRequired: contract.approvalRequired,
    violations,
  };
}

/** Officiate every registered contract for which a representative summary is supplied. */
export function officiateRegistered(
  samples: Record<string, ReadModelSummary>,
  opts: { now?: Date } = {},
): OfficiationResult[] {
  return AGENT_CONTRACTS.filter((c) => samples[c.type]).map((c) => officiateAgent(c, samples[c.type]!, opts));
}
