/**
 * src/agents/known-agent-registry.ts — Factory v1.5: Officiator backport (plan §1 cap 7).
 *
 * Makes "which agents exist" COMPOSABLE. The static AGENT_CONTRACTS literal is the
 * authoritative-but-incomplete officiation registry; once the Factory officiates a newly
 * CREATED agent, its AgentContract must be supplied alongside the static ones so seams
 * like the Inbox's already_solved gate (agent-inbox.ts classifyBuildRequest, which already
 * accepts opts.contracts) stop reporting a freshly-built agent's domain as not-yet-covered.
 *
 * This composes that combined view WITHOUT a store and WITHOUT mutating AGENT_CONTRACTS:
 * it spreads the static literal read-only and appends only created contracts that pass the
 * single officiation validator (validateAgentContract). Malformed created contracts are
 * dropped; the static literal always wins on a `.type` conflict (the registry is never
 * silently overridden by a created agent claiming an existing domain).
 *
 * Doctrine (matches agent-inbox.ts / agent-contract.ts):
 *   - PURE + deterministic. No node:fs, no pg, no network, no Supabase, no clock.
 *     Same inputs ⇒ deep-equal output.
 *   - NEVER mutates AGENT_CONTRACTS (spread read-only; no reassign/fork).
 *   - REFUSE FIRST: a created contract earns inclusion only by passing validation; a
 *     malformed one is dropped, never laundered into the registry.
 */

import {
  AGENT_CONTRACTS,
  validateAgentContract,
  type AgentContract,
} from "./agent-contract.js";

/** The composed officiation registry: the static contracts plus any officiated created ones. */
export type KnownAgents = AgentContract[];

/**
 * Resolve the full set of known (officiated) agents = the static AGENT_CONTRACTS plus the
 * supplied `created` contracts that pass validateAgentContract, DEDUPED by `.type` with the
 * static literal winning every conflict.
 *
 * Pure: AGENT_CONTRACTS is read via spread only — never mutated, reassigned, or forked.
 */
export function resolveKnownAgents(created: AgentContract[] = []): KnownAgents {
  const known: KnownAgents = [...AGENT_CONTRACTS];
  const seen = new Set<string>(known.map((c) => c.type));
  for (const candidate of created) {
    // Static wins on conflict — a created agent may not override an existing domain.
    if (seen.has(candidate.type)) continue;
    // Drop malformed created contracts — only validly-officiable agents join the registry.
    if (validateAgentContract(candidate).length > 0) continue;
    known.push(candidate);
    seen.add(candidate.type);
  }
  return known;
}
