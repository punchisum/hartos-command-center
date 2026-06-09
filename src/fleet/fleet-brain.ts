/**
 * src/fleet/fleet-brain.ts — 3-levels-up master plan Level 3 / §2 / §13 / §19.
 *
 * The Fleet Brain is a PURE, deterministic, RULE-FIRST synthesizer. It folds the live
 * fleet AgentSignals, the pending proposal queue, and the NEW StateDeltaSignals into a
 * single prioritized briefing: what matters · why (evidence-backed) · owner agent ·
 * proposed action · risk if ignored · confidence/freshness · exact blocker.
 *
 * NO LLM, NO live action, NO persistence, NO network, NO ambient clock — the timestamp is
 * INJECTED (`now`). It NEVER fabricates evidence and NEVER launders confidence: an item's
 * confidence is CLAMPED to the weakest contributing input band, and degraded one band when
 * the freshest contributing evidence is stale/dead (§19: output confidence ≤ min(inputs)).
 *
 * `assembleBriefing` does a full pass; `applyDeltas` updates INCREMENTALLY — it re-ranks
 * ONLY the items a delta touches (by domain / affectedAgents / auditId) and leaves every
 * other item byte-identical (plan §13: a delta is a projection of the audit-after row, not
 * a reason to re-digest the whole fleet).
 *
 * A StateDeltaSignal carries freshness but NO confidence (see state-delta.ts), so a delta is
 * FRESHNESS-ONLY evidence: it can never UPGRADE an item's confidence band, only confirm or
 * (when stale/dead) degrade it.
 */

import {
  type FleetSignal,
  type AgentSignalConfidence,
  type AgentSignalFreshness,
} from "../read-models/agent-signal.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { StateDeltaSignal } from "../execution/state-delta.js";
import { FLEET_REGISTRY, type AgentRegistration } from "./fleet-os.js";

/** One prioritized line in the briefing — evidence-backed, never fabricated. */
export interface BriefingItem {
  /** Stable id (signal id / proposal id) — the ranking tiebreak + the delta match key. */
  id: string;
  /** Where this item originates — drives delta matching + owner resolution. */
  domain: string;
  /** Headline: what matters about this subject right now. */
  subject: string;
  /** Why it matters — built ONLY from real signal/proposal/delta evidence. */
  why: string;
  /** Resolved owner agent (via FLEET_REGISTRY); honest "(no registered agent)" when none. */
  ownerAgent: string;
  /** The pending ActionProposal's intent, or null when there is no proposed action. */
  proposedAction: string | null;
  /** What happens if ignored — proposal riskLevel or the signal's entailment. */
  riskIfIgnored: string;
  /** Clamped to the weakest contributing input band; degraded one band on stale/dead evidence. */
  confidence: AgentSignalConfidence;
  /** The worst (least fresh) contributing freshness across signal + touching deltas. */
  freshness: AgentSignalFreshness;
  /** The single exact thing blocking progress (blockedReason / pending_approval / silent / stale). */
  exactBlocker: string;
  /** auditIds of the deltas that touched this item (empty on a pure full pass). */
  auditIds: string[];
}

export interface FleetBriefing {
  /** Ranked: severity/risk desc, then freshness penalty, then stable id tiebreak. */
  items: BriefingItem[];
  /** When this briefing was synthesized (the injected `now`, as ISO). Honest, not invented. */
  generatedAt: string;
}

export interface FleetBrainInput {
  signals: FleetSignal[];
  proposals?: ProposalQueueItem[];
  deltas?: StateDeltaSignal[];
  now: Date;
  /** Prior briefing — supplied for an INCREMENTAL pass (see applyDeltas). */
  prior?: FleetBriefing;
}

// ─── Confidence + freshness band math (the no-laundering core, §19) ─────────────

const CONFIDENCE_RANK: Record<AgentSignalConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};
const CONFIDENCE_BY_RANK: AgentSignalConfidence[] = ["unknown", "low", "medium", "high"];

const FRESHNESS_RANK: Record<AgentSignalFreshness, number> = {
  // Worst (least useful) → best. "unknown" is treated as worse than "stale": we cannot
  // vouch for evidence whose age we can't establish, but it is not as bad as "dead".
  dead: 0,
  unknown: 1,
  stale: 2,
  fresh: 3,
  live: 4,
};

/** Stale/dead/unknown freshness is "not fresh enough to vouch for" → triggers a 1-band degrade. */
function isStaleEvidence(freshness: AgentSignalFreshness): boolean {
  return freshness === "stale" || freshness === "dead" || freshness === "unknown";
}

/** The weaker (lower-rank) of two freshness bands — used to take the WORST contributing freshness. */
function worseFreshness(a: AgentSignalFreshness, b: AgentSignalFreshness): AgentSignalFreshness {
  return FRESHNESS_RANK[a] <= FRESHNESS_RANK[b] ? a : b;
}

/**
 * Clamp confidence to the WEAKEST contributing band, then degrade ONE band when the freshest
 * contributing evidence is stale/dead/unknown (§19, no laundering). With no bands it is "unknown".
 * `bands` are the confidence inputs; `freshestContributing` is the BEST freshness across the
 * contributing evidence — if even the freshest is stale, the whole item's confidence is degraded.
 */
export function clampConfidence(
  bands: AgentSignalConfidence[],
  freshestContributing: AgentSignalFreshness,
): AgentSignalConfidence {
  if (bands.length === 0) return "unknown";
  let rank = Math.min(...bands.map((b) => CONFIDENCE_RANK[b]));
  if (isStaleEvidence(freshestContributing)) rank = Math.max(0, rank - 1);
  return CONFIDENCE_BY_RANK[rank]!;
}

// ─── Owner resolution (honest about unregistered domains) ───────────────────────

/**
 * Resolve a domain/signal-type to its owning agent name via FLEET_REGISTRY. A domain with no
 * registered agent is SURFACED honestly (never dropped, never invented): "<domain> (no
 * registered agent)". Matches on registry id OR signalType so ops/fitness resolve by either.
 */
export function resolveOwnerAgent(domain: string, registry: AgentRegistration[] = FLEET_REGISTRY): string {
  const reg = registry.find((r) => r.id === domain || r.signalType === domain);
  return reg ? reg.name : `${domain} (no registered agent)`;
}

// ─── Severity / risk ranking ────────────────────────────────────────────────────

/** A pending proposal awaiting Hart's approval — the queue states that gate on a human. */
const PENDING_APPROVAL_STATUSES = new Set<ProposalQueueItem["status"]>([
  "pending_approval",
  "approved_for_execution",
]);

function isPendingProposal(p: ProposalQueueItem): boolean {
  return PENDING_APPROVAL_STATUSES.has(p.status);
}

/** Risk weight: a pending proposal's declared risk, escalating the briefing rank. */
const RISK_RANK: Record<"low" | "medium" | "high", number> = { low: 1, medium: 2, high: 3 };

/**
 * A fleet signal's intrinsic severity — derived from its OWN verdict words (never invented).
 * Mirrors the agent verdict vocabulary in agent-signal.ts (recovery red/amber/green; ops
 * urgent/waiting/stale/clear) plus the read-health words for an unspeakable agent.
 */
const SIGNAL_SEVERITY: Record<string, number> = {
  // Unspeakable read-health (highest — we are blind to the agent).
  error: 3,
  missing: 3,
  // Ops escalations.
  urgent: 3,
  // Recovery / attention.
  red: 2,
  waiting: 2,
  stale: 2,
  amber: 1,
  // Calm.
  green: 0,
  clear: 0,
};

/** Freshness penalty: stale/unknown/dead evidence lowers an item's rank (we trust it less). */
function freshnessPenalty(freshness: AgentSignalFreshness): number {
  // 0 for live/fresh, 1 for stale/unknown, 2 for dead — subtracted from severity in ranking.
  if (freshness === "live" || freshness === "fresh") return 0;
  if (freshness === "dead") return 2;
  return 1;
}

// ─── Briefing-item builders (one per evidence kind) ─────────────────────────────

function itemFromSignal(fleetSig: FleetSignal): BriefingItem {
  const s = fleetSig.signal;
  const freshness = s.freshness;
  // Signal confidence is the only band; freshness can degrade it (§19, no laundering).
  const confidence = clampConfidence([s.confidence], freshness);
  const exactBlocker =
    freshness === "stale" || freshness === "dead"
      ? `stale data (freshness ${freshness}) — re-read before relying on this`
      : freshness === "unknown"
        ? "freshness unknown — cannot vouch for the data's age"
        : s.approvalNeeded
          ? "pending_approval — this agent's actions gate on Hart"
          : "none";
  return {
    id: fleetSig.id,
    domain: fleetSig.type,
    subject: `${fleetSig.type}: ${s.verdict}`,
    why: s.reason,
    ownerAgent: resolveOwnerAgent(fleetSig.type),
    proposedAction: s.nextAction,
    riskIfIgnored: riskFromVerdict(fleetSig.type, s.verdict),
    confidence,
    freshness,
    exactBlocker,
    auditIds: [],
  };
}

/** Honest, evidence-backed entailment of a verdict — no fabricated stakes. */
function riskFromVerdict(type: string, verdict: string): string {
  if (verdict === "urgent") return "urgent ops items left unattended";
  if (verdict === "waiting") return "ops items waiting on Hart will stall";
  if (verdict === "stale") return "data goes stale; the agent's read drifts from reality";
  if (verdict === "red") return "low recovery ignored risks overtraining";
  if (verdict === "error" || verdict === "missing") return `${type} agent is unreadable — blind spot`;
  if (verdict === "amber") return "watch — borderline, may degrade";
  return "low — no action entailed by the current verdict";
}

function itemFromProposal(p: ProposalQueueItem): BriefingItem {
  const pending = isPendingProposal(p);
  const exactBlocker = p.blockedReason
    ? p.blockedReason
    : pending
      ? "pending_approval — awaiting Hart's approval"
      : `status ${p.status} — not actionable`;
  return {
    id: p.id,
    domain: p.domain,
    subject: `${p.domain}: ${p.title}`,
    why: p.description,
    ownerAgent: resolveOwnerAgent(p.domain),
    // A pending proposal IS the proposed action; a non-pending one has nothing to propose.
    proposedAction: pending ? p.sourceIntent || p.title : null,
    riskIfIgnored: `risk ${p.riskLevel}${p.expectedEffect ? ` — ${p.expectedEffect}` : ""}`,
    // A proposal carries no data freshness band of its own; its evidence is the proposal record.
    confidence: "unknown",
    freshness: "unknown",
    exactBlocker,
    auditIds: [],
  };
}

// ─── Ranking ────────────────────────────────────────────────────────────────────

function severityOf(item: BriefingItem, proposalsById: Map<string, ProposalQueueItem>): number {
  // A proposal-backed item ranks by its declared risk; a signal-backed item by its verdict word
  // (encoded after the "<domain>: " prefix in the subject). Both are real evidence, not invented.
  const proposal = proposalsById.get(item.id);
  if (proposal) return RISK_RANK[proposal.riskLevel];
  const verdict = item.subject.includes(": ") ? item.subject.slice(item.subject.indexOf(": ") + 2) : "";
  return SIGNAL_SEVERITY[verdict] ?? 1; // unknown verdict → mild attention, never silent
}

/**
 * Deterministic ranking key: severity/risk (desc), then freshness penalty (less-fresh sinks),
 * then a STABLE id tiebreak. Same input → same order, always.
 */
function rankItems(items: BriefingItem[], proposalsById: Map<string, ProposalQueueItem>): BriefingItem[] {
  return [...items].sort((a, b) => {
    const sevA = severityOf(a, proposalsById) - freshnessPenalty(a.freshness);
    const sevB = severityOf(b, proposalsById) - freshnessPenalty(b.freshness);
    if (sevA !== sevB) return sevB - sevA; // higher effective severity first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // stable id tiebreak
  });
}

// ─── Delta folding (freshness-only evidence) ────────────────────────────────────

/** A delta touches an item when it shares the item's domain, owner, auditId, or item id. */
function deltaTouchesItem(delta: StateDeltaSignal, item: BriefingItem): boolean {
  if (delta.auditId === item.id) return true;
  if (delta.domain === item.domain) return true;
  // affectedAgents carries display names (e.g. "Ops Agent"); match against the resolved owner.
  if (delta.affectedAgents.includes(item.ownerAgent)) return true;
  return false;
}

/**
 * Fold one delta into an item. A delta is FRESHNESS-ONLY evidence (StateDeltaSignal has no
 * confidence): it takes the WORST freshness across the item and the delta, then RE-CLAMPS the
 * item's confidence against that worse freshness — so a stale/dead delta can only HOLD or
 * DEGRADE confidence, never upgrade it (§19). It also records the touching auditId.
 */
function foldDeltaIntoItem(item: BriefingItem, delta: StateDeltaSignal): BriefingItem {
  const freshness = worseFreshness(item.freshness, delta.freshness);
  // Re-clamp the item's CURRENT confidence band against the (possibly worse) freshness. The delta
  // contributes no confidence band of its own — it can only degrade via freshness, never upgrade.
  const confidence = clampConfidence([item.confidence], freshness);
  const auditIds = item.auditIds.includes(delta.auditId) ? item.auditIds : [...item.auditIds, delta.auditId];
  return { ...item, freshness, confidence, auditIds };
}

// ─── Public API ──────────────────────────────────────────────────────────────────

/**
 * FULL pass: synthesize a fresh prioritized briefing from signals + proposals + deltas.
 * Pure + deterministic; `now` is injected (no ambient clock read).
 */
export function assembleBriefing(input: FleetBrainInput): FleetBriefing {
  const proposals = input.proposals ?? [];
  const deltas = input.deltas ?? [];
  const proposalsById = new Map(proposals.map((p) => [p.id, p]));

  // One item per signal, plus one per pending proposal that has no co-id'd signal item.
  const signalItems = input.signals.map(itemFromSignal);
  const seen = new Set(signalItems.map((i) => i.id));
  const proposalItems = proposals.filter((p) => !seen.has(p.id)).map(itemFromProposal);

  let items = [...signalItems, ...proposalItems];

  // Fold every delta into every item it touches (freshness-only; can't upgrade confidence).
  if (deltas.length > 0) {
    items = items.map((item) => {
      let next = item;
      for (const delta of deltas) {
        if (deltaTouchesItem(delta, next)) next = foldDeltaIntoItem(next, delta);
      }
      return next;
    });
  }

  return {
    items: rankItems(items, proposalsById),
    generatedAt: input.now.toISOString(),
  };
}

/**
 * INCREMENTAL pass: fold new deltas into a PRIOR briefing, touching ONLY the items a delta
 * matches and re-ranking. Items no delta touches are returned byte-identical (same object
 * reference) — the Fleet Brain does not re-digest the world (plan §13).
 *
 * Re-ranking needs proposal risk, which the prior briefing already encoded as item severity;
 * with no proposals passed, ranking falls back to the signal-derived severity in each item.
 */
export function applyDeltas(
  prior: FleetBriefing,
  deltas: StateDeltaSignal[],
  now: Date,
  opts: { proposals?: ProposalQueueItem[] } = {},
): FleetBriefing {
  const proposalsById = new Map((opts.proposals ?? []).map((p) => [p.id, p]));

  const items = prior.items.map((item) => {
    let next = item;
    let touched = false;
    for (const delta of deltas) {
      if (deltaTouchesItem(delta, next)) {
        next = foldDeltaIntoItem(next, delta);
        touched = true;
      }
    }
    // Untouched items are returned by the SAME reference — byte-identical, no re-synthesis.
    return touched ? next : item;
  });

  return {
    items: rankItems(items, proposalsById),
    generatedAt: now.toISOString(),
  };
}
