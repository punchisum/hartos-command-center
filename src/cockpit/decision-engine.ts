/**
 * src/cockpit/decision-engine.ts — the HUMAN-OS DECISION ENGINE (Human OS Doctrine §5/§6).
 *
 * Pure, deterministic, Worker-safe. Given a natural-language request it produces a single
 * CONCIERGE DECISION: a terminal (one of the seven — Doctrine §4 "no dead ends"), an autonomy
 * tier (Tier 0..4 — Doctrine §6), and the concierge sections (what matters / next action /
 * risks / opportunities / capability gaps). It WRAPS the existing `routeCockpitCommand`
 * (agent selection + read-only-vs-action posture) and adds the AUTONOMY axis on top.
 *
 * Two safety properties, by construction:
 *   - DETERMINISTIC FLOOR (Doctrine §6): external I/O, money, irreversible ops, deploys, and
 *     legal/fiduciary acts are pinned to a high tier by hard-coded rules the model cannot
 *     reason past. The floor can only ever RAISE a tier, never lower it.
 *   - DEFAULT-UP ON UNCERTAINTY (Doctrine §6): an ambiguous non-read request is bumped to a
 *     human gate rather than auto-run. Over-gating costs a click; under-gating costs an
 *     unauthorized action.
 *
 * This module NEVER executes anything and NEVER mutates. It only CLASSIFIES and DESCRIBES.
 * The autonomy tier here is a DISTINCT axis from `ProposalTier` (T0..T4 in proposal-tiering.ts),
 * which is about payload completeness; an action must independently satisfy BOTH.
 *
 * No fs/network/clock/env. Fully unit-testable offline.
 */

import { routeCockpitCommand, type RoutingDecision } from "./command-router.js";
import {
  resolveMetaAgentRegistry,
  type MetaAgentRegistry,
} from "../agents/meta-agent-registry.js";
import type { ProposalDomain, ProposalTier } from "./proposals/proposal-types.js";
import { AUTOHEAL_CLASS_FLAG } from "../doctrine/autoheal-invariant.js";

// ─── Autonomy axis (Doctrine §6) — DISTINCT from ProposalTier ────────────────────

/**
 * The five autonomy tiers, named so they never collide with the payload-completeness
 * `ProposalTier` (T0..T4). Mapping to the doctrine's "Tier 0..4":
 *   auto       = Tier 0 — read-only / generative, auto-run, report after
 *   trusted    = Tier 1 — internal reversible mutation, auto-run + notify (needs the amendment)
 *   one_click  = Tier 2 — meaningful internal commitment, single-click approval
 *   explicit   = Tier 3 — external / irreversible / financial, deliberate approval
 *   human_only = Tier 4 — legal / fiduciary / regulatory, HartOS may assist, never decide
 */
export type AutonomyTier = "auto" | "trusted" | "one_click" | "explicit" | "human_only";

/** Tier → its doctrine number (0..4). */
export const AUTONOMY_TIER_NUMBER: Readonly<Record<AutonomyTier, 0 | 1 | 2 | 3 | 4>> = {
  auto: 0,
  trusted: 1,
  one_click: 2,
  explicit: 3,
  human_only: 4,
};

/** number → tier, for "raise to the higher of two tiers" maths. */
const TIER_BY_NUMBER: readonly AutonomyTier[] = ["auto", "trusted", "one_click", "explicit", "human_only"];

/**
 * The bridge to the OTHER axis — `ProposalTier` (T0..T4) in proposal-tiering.ts, which scales the
 * proposal PAYLOAD with risk. "One gate, not two": an autonomy tier maps 1:1 (risk-ordered) onto a
 * payload tier, so a typed mutation declares both consistently. Autonomy = how much approval;
 * payload tier = what before/after/idempotency/dry-run fields the (future) mutation must carry.
 */
export const PROPOSAL_TIER_BY_AUTONOMY: Readonly<Record<AutonomyTier, ProposalTier>> = {
  auto: "T0",
  trusted: "T1",
  one_click: "T2",
  explicit: "T3",
  human_only: "T4",
};

/** Short human label for a tier (cockpit display). */
export function autonomyTierLabel(t: AutonomyTier): string {
  switch (t) {
    case "auto": return "Tier 0 · Automatic";
    case "trusted": return "Tier 1 · Trusted (auto + notify)";
    case "one_click": return "Tier 2 · One-click approval";
    case "explicit": return "Tier 3 · Explicit approval";
    case "human_only": return "Tier 4 · Human only";
  }
}

/** The higher (more cautious) of two tiers — the floor can only raise. */
function maxTier(a: AutonomyTier, b: AutonomyTier): AutonomyTier {
  return AUTONOMY_TIER_NUMBER[a] >= AUTONOMY_TIER_NUMBER[b] ? a : b;
}

// ─── The seven terminals (Doctrine §4 — no dead ends) ────────────────────────────

export type ConciergeTerminal =
  | "direct_answer"
  | "action_executed"
  | "action_proposed"
  | "research_proposed"
  | "build_proposed"
  | "clarification"
  | "safe_refusal";

// ─── Deterministic floor detectors (Doctrine §6) ─────────────────────────────────
// These match the ACTION the operator is asking for. They are applied ONLY when the
// request is an action (never to a read-only question — reading ABOUT money or a
// contract is Tier 0). Each returns the MINIMUM tier its match forces.

/** Legal / fiduciary / regulatory — Tier 4, human only. */
const HUMAN_ONLY_RE = /\b(sign|execute|enter\s+into)\b[^.?!]*\b(contract|agreement|nda|lease|loan|term\s+sheet)\b|\bcontractual\b|\bfiduciar|\bregulatory\s+(filing|declaration|submission)\b|\b(file|submit)\b[^.?!]*\b(tax\s+return|taxes|regulatory)\b|\bpower\s+of\s+attorney\b|\bboard\s+resolution\b|\bcap\s+table\b|\blegally\s+(bind|commit)\b/i;

/** Money movement — Tier 3, explicit. */
const MONEY_RE = /\b(pay|payment|spend|purchase|buy|wire|payout|disburse|refund|charge\s+(the\s+)?card|withdraw|send\s+money|transfer\s+(money|funds|\$|cash))\b|\b(bank|banking)\b|\$\s?\d/i;

/** External / outward-facing comms — Tier 3, explicit. */
const EXTERNAL_RE = /\b(send|email|e-mail|reply|forward|dm|text)\b[^.?!]*\b(client|customer|vendor|supplier|prospect|lead|investor|partner|candidate|applicant)\b|\bsend\s+(an?\s+|the\s+)?(email|invoice|quote|proposal|contract|statement)\b|\b(post|publish|tweet|broadcast)\b/i;

/** Irreversible / destructive / production — Tier 3, explicit. */
const IRREVERSIBLE_RE = /\b(delete|drop\s+(table|database|schema)|destroy|wipe|purge|terminate|revoke\s+access|rotate\s+(the\s+)?(key|secret|credential)|deploy|ship\s+to\s+prod|go\s+live|release\s+to\s+production|production\s+(deploy|release|push)|cancel\s+(the\s+)?(subscription|account))\b/i;

/** A read-only imperative that HartOS can simply DO now (Tier 0) and report. */
const READ_IMPERATIVE_RE = /^(summari[sz]e|analy[sz]e|classify|draft|compare|explain|brief\s+me|recap|catch\s+me\s+up)\b/i;

/** Does the text look like a question (→ clarification rather than refusal on unknown)? */
const QUESTION_RE = /^(what|who|when|where|how|why|which|is|are|do|does|can|should|could|would)\b/i;

/**
 * Self-improvement signals (Doctrine §7). An UNKNOWN request that is nonetheless a clear,
 * actionable ask must NOT dead-end in a refusal — it becomes a research or build PROPOSAL to
 * acquire the missing capability. These detect "go find / discover X" (→ research mission) and
 * "build / automate X" (→ Factory build) when no standing agent matched.
 */
const RESEARCH_INTENT_RE = /\b(find|identify|discover|look\s+for|search\s+for|scout|source|hunt\s+for|surface|map|investigate|research|track\s+down)\b[^.?!]*\b(compan|business|businesses|lead|prospect|opportunit|market|competitor|vendor|supplier|candidate|target|deal|acquisition|trend|signal|niche|industry|sector)/i;
const BUILD_INTENT_RE = /\b(build|create|make|set\s+up|automate|generate|spin\s+up|stand\s+up)\b[^.?!]*\b(agent|workflow|automation|pipeline|tool|system|tracker|dashboard|bot|report|monitor|integration)\b/i;

/** The minimum tier the request's CONTENT forces, or null when nothing pins it. */
function floorTierFor(lower: string): AutonomyTier | null {
  if (HUMAN_ONLY_RE.test(lower)) return "human_only";
  if (MONEY_RE.test(lower) || EXTERNAL_RE.test(lower) || IRREVERSIBLE_RE.test(lower)) return "explicit";
  return null;
}

// ─── Base tier from the routing posture ──────────────────────────────────────────

/** The tier implied by WHICH agent/mode handled it and whether it is read-only vs action. */
function baseTierFor(routing: RoutingDecision): AutonomyTier {
  switch (routing.intentClass) {
    case "organisation":
    case "read_only_intelligence":
      return "auto";
    case "meta_agent_invocation": {
      if (!routing.needsProposal) return "auto"; // read-only intelligence from an agent
      // An action through an agent. Factory/research/report are meaningful commitments;
      // ops/fitness internal adjustments are reversible internal mutations.
      const id = routing.selectedAgentId;
      if (id === "factory") return "one_click";
      if (id === "research" || id === "beezulbub") return "one_click";
      if (routing.selectedMode === "report") return "one_click";
      return "trusted";
    }
    case "mutation_action":
      return "trusted"; // a bare internal mutation verb; the floor raises external ones
    case "unknown":
    default:
      return "one_click"; // defensive — an unrecognised request never auto-runs
  }
}

/** Is this routing an ACTION (so the deterministic floor applies)? */
function isActionRouting(routing: RoutingDecision, lower: string): boolean {
  if (routing.needsProposal) return true;
  if (routing.intentClass === "mutation_action") return true;
  if (routing.intentClass === "unknown" && !QUESTION_RE.test(lower) && !lower.endsWith("?")) return true;
  return false;
}

// ─── The classification result ───────────────────────────────────────────────────

export interface AutonomyClassification {
  tier: AutonomyTier;
  tierNumber: 0 | 1 | 2 | 3 | 4;
  /** Why this tier — every contributing rule, for honesty + the audit trail. */
  rationale: string[];
  /** The deterministic floor raised the tier above its base. */
  floorApplied: boolean;
  /** Uncertainty bumped the tier up (Doctrine §6 default-up). */
  defaultedUp: boolean;
}

/**
 * PURE. Classify the autonomy tier of a request given its routing decision.
 * Floor can only RAISE; uncertainty can only RAISE. Read-only intents are never
 * floored by topic keywords (reading about money/contracts is Tier 0).
 */
export function classifyAutonomyTier(routing: RoutingDecision, request: string): AutonomyClassification {
  const lower = (request ?? "").toLowerCase();
  const rationale: string[] = [];

  const base = baseTierFor(routing);
  rationale.push(`base ${autonomyTierLabel(base)} from intent "${routing.intentClass}"${routing.needsProposal ? " (action)" : " (read-only)"}`);

  let tier = base;
  let floorApplied = false;
  const action = isActionRouting(routing, lower);

  if (action) {
    const floor = floorTierFor(lower);
    if (floor && AUTONOMY_TIER_NUMBER[floor] > AUTONOMY_TIER_NUMBER[tier]) {
      rationale.push(`deterministic floor raised to ${autonomyTierLabel(floor)} (external / financial / irreversible / legal signal)`);
      tier = maxTier(tier, floor);
      floorApplied = true;
    }
  } else {
    rationale.push("read-only intent — the action floor does not apply (reading is Tier 0)");
  }

  // Default-up on uncertainty: an ambiguous, non-read request never sits at Tier 0.
  let defaultedUp = false;
  const isRead = routing.intentClass === "read_only_intelligence" || routing.intentClass === "organisation" || (routing.intentClass === "meta_agent_invocation" && !routing.needsProposal);
  if (routing.confidence === "low" && AUTONOMY_TIER_NUMBER[tier] === 0 && !isRead) {
    rationale.push("low-confidence non-read request — default-up to a human gate (Tier 2)");
    tier = maxTier(tier, "one_click");
    defaultedUp = true;
  }

  return { tier, tierNumber: AUTONOMY_TIER_NUMBER[tier], rationale, floorApplied, defaultedUp };
}

// ─── Domain mapping (light) ──────────────────────────────────────────────────────

function domainFor(routing: RoutingDecision): ProposalDomain | "fleet" | "governance" | "finance" {
  switch (routing.selectedAgentId) {
    case "fitness": return "fitness";
    case "ops": return "ops";
    case "factory": return "factory";
    case "research":
    case "beezulbub": return "research";
    case "execution-engine": return "system";
    default: return "system";
  }
}

// ─── The concierge decision ──────────────────────────────────────────────────────

export interface ConciergeProposalDescriptor {
  /** The autonomy tier this proposal sits at. */
  autonomyTier: AutonomyTier;
  /** True when a single click is enough (Tier 2); false → deliberate/explicit (Tier 3+). */
  oneClick: boolean;
  requiredApproval: "Hart";
  /** Honest: would this auto-run today if approved, or does it need a local runner? */
  requiresLocalRunner: boolean;
  summary: string;
}

export interface ConciergeDecision {
  request: string;
  /** One of the seven terminals — there is ALWAYS exactly one (Doctrine §4). */
  terminal: ConciergeTerminal;
  /** One-line, human restatement of how HartOS understood the request. */
  interpretation: string;

  intentClass: RoutingDecision["intentClass"];
  domain: ProposalDomain | "fleet" | "governance" | "finance";
  selectedAgentId: string | null;
  selectedAgentName: string | null;

  autonomy: AutonomyClassification;
  /** The bridge to the payload axis (proposal-tiering.ts). Risk-ordered 1:1 with the autonomy tier. */
  proposalTier: ProposalTier;
  /**
   * True when this action is the kind the autoheal-gate governs (internal + reversible, Tier 1).
   * Such actions are the ONLY ones that may ever auto-execute unattended (when the class is armed);
   * everything else is structurally barred from autonomous execution.
   */
  autohealGoverned: boolean;
  /** HartOS can do this now, read-only, with no side effects (Tier 0). */
  autoExecutableNow: boolean;
  /** Needs a human gate before anything happens (Tier 2+, or Tier 1 until the amendment). */
  requiresHumanApproval: boolean;
  /**
   * Honest: this is an internal reversible mutation that the doctrine says SHOULD auto-run
   * (Tier 1), but auto-execution is still disabled by the code constitution — so today it is
   * surfaced as a one-click proposal. Flips to auto once the constitution is amended (§8/§12).
   */
  wouldAutoRunWhenTier1Enabled: boolean;

  // ── Concierge sections (Doctrine §10) — deterministic + honest ──
  whatMatters: string;
  recommendedNextAction: string;
  risks: string[];
  opportunities: string[];
  capabilityGaps: string[];
  proposal: ConciergeProposalDescriptor | null;

  reason: string;
  confidence: RoutingDecision["confidence"];
}

/** Map routing + tier → which of the seven terminals this resolves to. */
function terminalFor(routing: RoutingDecision, lower: string): ConciergeTerminal {
  switch (routing.intentClass) {
    case "organisation":
    case "read_only_intelligence":
      return READ_IMPERATIVE_RE.test(lower) ? "action_executed" : "direct_answer";
    case "meta_agent_invocation": {
      if (!routing.needsProposal) {
        return READ_IMPERATIVE_RE.test(lower) ? "action_executed" : "direct_answer";
      }
      if (routing.selectedAgentId === "factory") return "build_proposed";
      if (routing.selectedAgentId === "research" || routing.selectedAgentId === "beezulbub") return "research_proposed";
      return "action_proposed";
    }
    case "mutation_action":
      return "action_proposed";
    case "unknown":
    default:
      // Doctrine §7 — a clear actionable ask with no matching capability becomes a
      // research/build PROPOSAL (acquire the capability), never a dead-end refusal.
      if (RESEARCH_INTENT_RE.test(lower)) return "research_proposed";
      if (BUILD_INTENT_RE.test(lower)) return "build_proposed";
      if (QUESTION_RE.test(lower) || lower.endsWith("?")) return "clarification";
      return "safe_refusal";
  }
}

/** True when this terminal was reached via the §7 self-improvement path (no standing capability). */
function isSelfImprovement(routing: RoutingDecision, terminal: ConciergeTerminal): boolean {
  return routing.intentClass === "unknown" && (terminal === "research_proposed" || terminal === "build_proposed");
}

/** Tier-derived honest risk lines. */
function risksFor(tier: AutonomyTier, routing: RoutingDecision): string[] {
  const out: string[] = [];
  switch (tier) {
    case "human_only":
      out.push("Legal/fiduciary/regulatory weight — HartOS will assist and prepare, but you decide and act.");
      break;
    case "explicit":
      out.push("External, financial, or irreversible — requires your deliberate approval; nothing happens until then.");
      break;
    case "one_click":
      out.push("A meaningful internal commitment — one click to approve, reversible afterwards.");
      break;
    case "trusted":
      out.push(`Internal + reversible — auto-execution is governed by the autoheal-gate (${AUTOHEAL_CLASS_FLAG}: internal-only class, double-flag + kill-switch). Auto-runs unattended only when that class is armed; otherwise it waits for one click.`);
      break;
    case "auto":
      break;
  }
  if (routing.requiresLocalRunner) {
    out.push("Needs a local runner — the hosted cockpit cannot execute this itself; it creates a gated job.");
  }
  if (routing.capabilityStatus === "unavailable" || routing.capabilityStatus === "stale") {
    out.push(`Capability is ${routing.capabilityStatus} — the answer may be partial.`);
  }
  return out;
}

/**
 * PURE. The single entry point: natural-language request → a complete concierge decision.
 * Always returns exactly one terminal (no dead ends), an autonomy tier, and the concierge
 * sections — even when the request is unknown (→ clarification or safe refusal).
 */
export function decide(
  request: string,
  reg: MetaAgentRegistry = resolveMetaAgentRegistry(),
): ConciergeDecision {
  const text = (request ?? "").trim();
  const lower = text.toLowerCase();
  const routing = routeCockpitCommand(text, reg);
  const autonomy = classifyAutonomyTier(routing, text);
  const terminal = terminalFor(routing, lower);
  const domain = domainFor(routing);

  const autoExecutableNow = terminal === "direct_answer" || terminal === "action_executed";
  const wouldAutoRunWhenTier1Enabled = autonomy.tier === "trusted";
  const requiresHumanApproval = !autoExecutableNow; // honest: today, anything past Tier 0 waits
  const selfImprovement = isSelfImprovement(routing, terminal);
  const acquireAgent = terminal === "build_proposed" ? "the Factory" : "Beezulbub";

  // Interpretation — a one-line human restatement.
  const agentLabel = routing.selectedAgentName ? ` via ${routing.selectedAgentName}` : "";
  const interpretation = (() => {
    switch (terminal) {
      case "direct_answer": return `A read-only question${agentLabel} — answering from live state, the vault, and memory.`;
      case "action_executed": return `A read-only task${agentLabel} — done now from live state, nothing changed.`;
      case "action_proposed": return `An action request${agentLabel} — ${autonomyTierLabel(autonomy.tier)}.`;
      case "research_proposed": return selfImprovement
        ? "No standing capability matches this — proposing a research mission (Beezulbub) to acquire it."
        : `A research request${agentLabel} — proposing a research mission.`;
      case "build_proposed": return selfImprovement
        ? "No standing capability matches this — proposing a Factory build to create one."
        : `A build request${agentLabel} — proposing a Factory build.`;
      case "clarification": return "Not sure which capability this maps to — one quick question to route it.";
      case "safe_refusal": return "No capability matches this safely — here's why, and how it could be acquired.";
    }
  })();

  // What matters.
  const whatMatters = selfImprovement
    ? "HartOS has no standing capability for this yet — but it can acquire one rather than dead-end."
    : routing.reason;

  // Recommended next action — self-improvement names the acquisition path; otherwise prefer the
  // router's honest fallback, else a tier default.
  const recommendedNextAction = selfImprovement
    ? `Approve to launch a ${terminal === "build_proposed" ? "Factory build" : "research mission (Beezulbub)"} that acquires this capability.`
    : routing.fallback && routing.fallback.length > 0
      ? routing.fallback
      : terminal === "direct_answer" || terminal === "action_executed"
        ? "Nothing required — ask a follow-up or issue the next command."
        : terminal === "clarification"
          ? "Tell me the agent or the outcome you want (e.g. \"ops\", \"research X\", \"build a Y agent\")."
          : terminal === "safe_refusal"
            ? "Name an agent (Wolverine, Beezulbub, Research, Prophet, Factory) or ask \"what can HartOS do right now?\"."
            : "Review the proposal and approve to proceed.";

  // Opportunities + capability gaps.
  const opportunities: string[] = [];
  const capabilityGaps: string[] = [];
  if (selfImprovement) {
    capabilityGaps.push("No standing agent or capability matches this request today.");
    opportunities.push(`Approving this has ${acquireAgent} acquire the capability, so the same ask succeeds next time (self-improvement, Doctrine §7).`);
  }
  if (terminal === "safe_refusal") {
    capabilityGaps.push("No agent or read-only intent matched this request.");
    opportunities.push("HartOS can propose a research mission (Beezulbub) or a Factory build to acquire this capability.");
  }
  if (routing.capabilityStatus === "unavailable") {
    capabilityGaps.push(`${routing.selectedAgentName ?? "The selected capability"} is currently unavailable.`);
  }
  if (!selfImprovement && (terminal === "research_proposed" || terminal === "build_proposed")) {
    opportunities.push("Approving this extends HartOS's own capability surface (self-improvement, Doctrine §7).");
  }

  // The proposal descriptor (only when a terminal carries one).
  const carriesProposal = terminal === "action_proposed" || terminal === "research_proposed" || terminal === "build_proposed";
  const proposal: ConciergeProposalDescriptor | null = carriesProposal
    ? {
        autonomyTier: autonomy.tier,
        oneClick: autonomy.tier === "one_click" || autonomy.tier === "trusted",
        requiredApproval: "Hart",
        requiresLocalRunner: routing.requiresLocalRunner,
        summary: selfImprovement
          ? `Acquire a missing capability via ${acquireAgent}: "${text}"`
          : routing.reason,
      }
    : null;

  return {
    request: text,
    terminal,
    interpretation,
    intentClass: routing.intentClass,
    domain,
    selectedAgentId: routing.selectedAgentId,
    selectedAgentName: routing.selectedAgentName,
    autonomy,
    proposalTier: PROPOSAL_TIER_BY_AUTONOMY[autonomy.tier],
    autohealGoverned: autonomy.tier === "trusted",
    autoExecutableNow,
    requiresHumanApproval,
    wouldAutoRunWhenTier1Enabled,
    whatMatters,
    recommendedNextAction,
    risks: risksFor(autonomy.tier, routing),
    opportunities,
    capabilityGaps,
    proposal,
    reason: routing.reason,
    confidence: routing.confidence,
  };
}
