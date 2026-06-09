/**
 * src/execution/state-delta.ts — 3-levels-up master plan §13.
 *
 * `StateDeltaSignal` is a PURE projection of the audit-after row the execution adapters
 * already produce (`ExecutionOutcome.before`/`after`) — NOT a new store, NOT I/O, and NOT
 * wired into the live executor path. After a mutation runs, instead of forcing every agent
 * to re-read the world, the executor can fan a small delta to the affected agents so the
 * Fleet Brain updates incrementally (plan §8/§13).
 *
 * This module is deliberately side-effect-free: it reads an `AdapterRunResult` the executor
 * already holds and maps it to a delta. It NEVER executes, persists, fetches, or re-reads the
 * audit table — the executor (a separate, gated path) decides whether to call this and where
 * to send the result. Doctrine §1/§2: pure + read-only.
 *
 * `now` is injected (never the ambient clock) so the projection is deterministic.
 */

import type { AdapterRunResult } from "./execution-adapter.js";
import { freshnessFromAge, type AgentSignalFreshness } from "../read-models/agent-signal.js";
import type { ProposalDomain, ProposalActionType } from "../cockpit/proposals/proposal-types.js";
import { findAgentContract } from "../agents/agent-contract.js";

/**
 * §13 delta — a projection of the audit-after row a mutation already produced. The Fleet
 * Brain consumes these to update incrementally rather than re-digesting the whole fleet.
 *
 * fields (EXACTLY §13): source · domain · changedEntity · before · after · actionType ·
 * auditId · affectedAgents · freshness.
 */
export interface StateDeltaSignal {
  /** Who produced the delta (e.g. the adapter id). */
  source: string;
  /** The mutated agent's domain. */
  domain: ProposalDomain;
  /** Human-readable entity that changed (e.g. a ClickUp card title, a proposal id). */
  changedEntity: string;
  /** The audited BEFORE snapshot — passed through verbatim from the outcome. */
  before: Record<string, unknown>;
  /** The audited AFTER snapshot — passed through verbatim from the outcome. */
  after: Record<string, unknown>;
  /** The typed action that produced the change. */
  actionType: ProposalActionType;
  /** Stable key of the audit row this delta projects (the proposal id; see ctx.proposalId). */
  auditId: string;
  /** Agents that should react — the domain's agent label (when officiated) plus the Fleet Brain. */
  affectedAgents: string[];
  /** Honest freshness of the delta — 'live' for a just-emitted delta (now == asOf). */
  freshness: AgentSignalFreshness;
}

/**
 * Local, static domain → display-label map (plan §13). Kept local on purpose: this is the
 * fan-out vocabulary, not a registry. Where an officiated AgentContract exists, its label is
 * preferred; otherwise this static label is used. 'Fleet Brain' is ALWAYS appended.
 */
const DOMAIN_AGENT_LABEL: Record<ProposalDomain, string> = {
  fitness: "Fitness Agent",
  ops: "Ops Agent",
  factory: "Factory Agent",
  system: "System",
  research: "Research Agent",
};

const FLEET_BRAIN_LABEL = "Fleet Brain";

/** The affected-agents fan-out for a domain: the domain's agent label, then the Fleet Brain. */
function affectedAgentsFor(domain: ProposalDomain): string[] {
  // An officiated agent's contract may exist (only fitness/ops today); its label is reused as
  // the canonical name. Contracts use the read-model type as the key, which equals the domain
  // for fitness/ops. The static map remains the source of truth for the surfaced fan-out name,
  // so domains without a contract (factory/system/research) still resolve.
  const contract = findAgentContract(domain);
  const label = contract?.label ?? DOMAIN_AGENT_LABEL[domain];
  // Prefer the static fan-out label when a contract exists but its short label is a strict
  // prefix of the richer fan-out name (e.g. contract "Ops" vs fan-out "Ops Agent").
  const fanLabel = DOMAIN_AGENT_LABEL[domain];
  const name = fanLabel.startsWith(label) ? fanLabel : label;
  return [name, FLEET_BRAIN_LABEL];
}

/**
 * Project an executed mutation's `AdapterRunResult` into a `StateDeltaSignal`, or `null` when
 * nothing actually executed (a noop or a refusal emits no delta).
 *
 * Pure: maps `outcome.before`/`after` verbatim, derives the fan-out from the domain, and stamps
 * freshness from the injected `now` (no ambient clock read). The executor owns whether/where to
 * fan the result; this function never persists or sends anything.
 */
export function toStateDeltaSignal(
  result: AdapterRunResult,
  ctx: {
    source?: string;
    domain: ProposalDomain;
    actionType: ProposalActionType;
    proposalId: string;
    changedEntity: string;
    now?: Date;
  },
): StateDeltaSignal | null {
  // A noop or a refusal produced no audit-after row to project.
  if (result.outcome == null || result.outcome.ran === false) return null;

  const now = ctx.now ?? new Date();
  const nowIso = now.toISOString();

  return {
    source: ctx.source ?? result.adapterId,
    domain: ctx.domain,
    changedEntity: ctx.changedEntity,
    before: result.outcome.before,
    after: result.outcome.after,
    actionType: ctx.actionType,
    // The executor holds no surfaced audit-row id; the proposal id is the audit row's stable key.
    auditId: ctx.proposalId,
    affectedAgents: affectedAgentsFor(ctx.domain),
    // Fresh age (now == asOf) ⇒ 'live'. freshnessFromAge(asOf, now): pass now's ISO as asOf.
    freshness: freshnessFromAge(nowIso, now),
  };
}
