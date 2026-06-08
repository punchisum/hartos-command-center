/**
 * src/agents/agent-contract.ts — Phase 1.1: the Agent Contract (officiation interface).
 *
 * The cockpit already "officiates" an agent through SEPARATE seams: the read-model
 * registry (data), agent-signal (the banded fleet-card verdict), agent-detail-registry
 * (the declarative /agent/<domain>/ui spec), and the proposal generator (typed,
 * propose-only proposals). This module UNIFIES those into ONE declarative contract plus
 * a conformance harness, so "officiated in the cockpit" becomes a single, testable
 * interface — the exact spec the Factory (Phase 4) instantiates for a newly-created
 * agent, and the gate that proves the agent is real before it shows up.
 *
 * It adds NO rendering/routing/data code; it composes the existing seams and asserts the
 * officiation invariants. Pure + read-only (doctrine §1/§2). See
 * docs/HARTOS_IMPLEMENTATION_PLAN_TO_80.md → "Officiation Contract (7 points)".
 */

import type { ReadModelSummary, ReadModelType } from "../read-models/read-model-types.js";
import { summaryToAgentSignal, type AgentSignal } from "../read-models/agent-signal.js";
import type { AgentDetailSpec } from "../read-models/agent-detail-registry.js";

/**
 * The unified declaration an agent must provide to be officiated. Each field maps to one
 * of the 7 officiation facets:
 *   1/2 read-model + banded signal → `readModelId` (resolves a ReadModelSummary →
 *       summaryToAgentSignal → a tone-legible verdict),
 *   3   honest freshness/confidence → enforced by the conformance harness,
 *   4   fleet card + detail page → `label`/`icon` + `detail`,
 *   5   typed propose-only proposals → `proposalTypes`,
 *   6   doctrine binding (executable:false) → enforced (no executor lives here),
 *   7   approval intent → `approvalRequired`.
 */
export interface AgentContract {
  /** Stable domain key — also the read-model type and the /agent/<type>/ui route segment. */
  type: ReadModelType;
  /** Fleet-card display name + icon (facet 4: it renders as a card). */
  label: string;
  icon: string;
  /** Facet 1/2: the read-model registry id whose summary drives this agent's signal. */
  readModelId: string;
  /** Facet 5: the propose-only proposal action types this agent may emit (vocabulary only). */
  proposalTypes: string[];
  /** Facet 7: advisory agents (fitness) don't gate; actionable agents (ops) need approval. */
  approvalRequired: boolean;
  /**
   * Facet 4 (detail): EITHER a generic declarative spec (a new agent — zero UI code) OR
   * `{ kind: "bespoke" }` for the rich hand-built fitness/ops detail pages.
   */
  detail: AgentDetailSpec | { kind: "bespoke" };
}

// ── Verdict vocabulary ────────────────────────────────────────────────────────
// The recognized fleet-card verdict words the cockpit tone() colors. A verdict outside
// this set is a RAW passthrough (the Phase 0 "66 → idle" bug). Kept in sync with
// cloudflare-cockpit-page tone() + agent-signal recovery banding.
const VERDICT_RED = ["red", "urgent", "error", "fail", "missing", "low", "poor", "bad", "under", "fatigued", "tired", "strain"];
const VERDICT_GREEN = ["green", "clear", "ok", "good", "fresh", "live", "healthy", "high", "ready", "optimal", "recovered", "great"];
const VERDICT_AMBER = ["amber", "warn", "waiting", "stale", "degraded", "partial", "blocked", "moderate", "yellow", "medium", "fair", "maintain"];
const VERDICT_IDLE = ["unknown", "idle", "disabled", "unconfigured", "none", "no-data"];

export type VerdictClass = "green" | "amber" | "red" | "idle" | "unrecognized";

/**
 * Classify a verdict the way the cockpit will color it — or flag it as a raw passthrough.
 * Order mirrors tone(): red first (an outright-red verdict shows red regardless), then
 * green, amber, explicit-idle; anything else is "unrecognized" (the bug class).
 */
export function classifyVerdict(verdict: string): VerdictClass {
  const v = (verdict || "").toLowerCase();
  if (VERDICT_RED.some((w) => v.includes(w))) return "red";
  if (VERDICT_GREEN.some((w) => v.includes(w))) return "green";
  if (VERDICT_AMBER.some((w) => v.includes(w))) return "amber";
  if (VERDICT_IDLE.some((w) => v.includes(w))) return "idle";
  return "unrecognized";
}

export interface ContractViolation {
  facet: string;
  detail: string;
}

/** Static validation of a contract's declaration — needs no data. */
export function validateAgentContract(c: AgentContract): ContractViolation[] {
  const v: ContractViolation[] = [];
  if (!c.type) v.push({ facet: "registry", detail: "missing type" });
  if (!c.label) v.push({ facet: "card", detail: "missing label" });
  if (!c.icon) v.push({ facet: "card", detail: "missing icon" });
  if (!c.readModelId) v.push({ facet: "read-model", detail: "missing readModelId" });
  if (!Array.isArray(c.proposalTypes) || c.proposalTypes.length === 0) {
    v.push({ facet: "proposals", detail: "proposalTypes must be a non-empty array" });
  }
  if (!("kind" in c.detail)) {
    const spec = c.detail as AgentDetailSpec;
    if (!spec.rpcs || spec.rpcs.length === 0) v.push({ facet: "detail", detail: "generic detail spec has no rpcs" });
    for (const r of spec.rpcs ?? []) {
      if (!r.columns || r.columns.length === 0) v.push({ facet: "detail", detail: `detail rpc "${r.rpc}" has no columns` });
    }
  } else if (c.detail.kind !== "bespoke") {
    v.push({ facet: "detail", detail: `unknown detail kind "${(c.detail as { kind: string }).kind}"` });
  }
  return v;
}

/**
 * Runtime conformance: given a representative HEALTHY summary for this agent (status ok,
 * fresh, key metric present), assert the officiation invariants hold — the verdict bands
 * to a real color (never the raw "66 → idle" bug), confidence is derived (not unknown),
 * and the signal's approval intent matches the contract. Returns [] when officiable.
 */
export function assertOfficiable(
  c: AgentContract,
  healthySummary: ReadModelSummary,
  opts: { now?: Date } = {},
): ContractViolation[] {
  const v = validateAgentContract(c);
  if (healthySummary.type !== c.type) {
    v.push({ facet: "read-model", detail: `summary.type "${healthySummary.type}" != contract.type "${c.type}"` });
  }
  // Approval intent is contract-driven (Phase 4) — the signal reflects this contract.
  const sig: AgentSignal = summaryToAgentSignal(healthySummary, { ...opts, approvalRequired: c.approvalRequired });
  const cls = classifyVerdict(sig.verdict);
  if (cls === "unrecognized") {
    v.push({ facet: "signal", detail: `verdict "${sig.verdict}" is a raw passthrough, not a tone-legible band (the UNKNOWN-on-data bug)` });
  } else if (cls === "idle") {
    v.push({ facet: "signal", detail: `a healthy summary produced an idle verdict "${sig.verdict}" — it should band to green/amber/red` });
  }
  if (sig.confidence === "unknown") {
    v.push({ facet: "signal", detail: "a healthy summary produced unknown confidence — confidence must be derived from the read" });
  }
  return v;
}

// ── The registry — fitness + ops formally conform; new agents append here ───────

export const FITNESS_CONTRACT: AgentContract = {
  type: "fitness",
  label: "Fitness",
  icon: "🏃",
  readModelId: "fitness",
  proposalTypes: ["fitness_adjustment_plan"],
  approvalRequired: false, // advisory — matches summaryToAgentSignal (approvalNeeded=false)
  detail: { kind: "bespoke" },
};

export const OPS_CONTRACT: AgentContract = {
  type: "ops",
  label: "Ops",
  icon: "📋",
  readModelId: "ops",
  proposalTypes: ["ops_followup_plan", "sync_repair_plan"],
  approvalRequired: true, // ops surfaces actionable proposals — matches the signal
  detail: { kind: "bespoke" },
};

/** Every officiated agent. Phase 4's factory appends a generated agent's contract here. */
export const AGENT_CONTRACTS: AgentContract[] = [FITNESS_CONTRACT, OPS_CONTRACT];

export function findAgentContract(type: string, contracts: AgentContract[] = AGENT_CONTRACTS): AgentContract | undefined {
  return contracts.find((c) => c.type === type);
}

/** The generic detail specs declared by contracts (bespoke agents excluded) — the seam Phase 4 officiation wires. */
export function contractDetailSpecs(contracts: AgentContract[] = AGENT_CONTRACTS): AgentDetailSpec[] {
  return contracts.map((c) => c.detail).filter((d): d is AgentDetailSpec => !("kind" in d));
}
