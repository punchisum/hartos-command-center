/**
 * src/wolverine/wolverine-types.ts
 *
 * Wolverine — the HartOS immune system (v1: read-only auditor + FixProposal generator).
 *
 * Doctrine (HARTOS_VISION §Wolverine clause): "Automatic eyes; gated hands." Wolverine may
 * inspect, detect, score, and PROPOSE fixes automatically — but every repair is approval-gated
 * (proposal → approval → execution gate → audit → rollback). Wolverine NEVER mutates anything.
 *
 * This module is the pure CONTRACT + shared types. Detectors are pure functions over a supplied
 * `WolverineInputs` bundle (the host gathers env / git / live state); the aggregator ranks the
 * findings and computes an honest GREEN/AMBER/RED verdict. No I/O, no clock, no env read here.
 */

export type WolverineSeverity = "critical" | "high" | "medium" | "low";

export type WolverineCategory =
  | "unsafe_flag"
  | "git_hygiene"
  | "stale_data"
  | "broken_wiring"
  | "missing_test"
  | "doctrine_drift"
  | "proposal_bug"
  | "failed_deploy"
  | "suspicious_confidence"
  | "duplicate_capability"
  | "improvement";

export type SystemVerdict = "GREEN" | "AMBER" | "RED";
export type WolverineConfidence = "high" | "medium" | "low";

// Imported as TYPES only (no runtime dependency) so a finding can declare that its repair
// routes to an EXISTING, already-proven gated mutation adapter — Wolverine adds no new
// mutation primitive; it reuses the Step-1b approve→execute→audit spine.
import type { MutationAdapterId } from "../execution/execution-dispatch.js";
import type { ProposalTier } from "../cockpit/proposals/proposal-types.js";

/**
 * How a finding's repair would be executed: the gated adapter it routes to, that adapter's
 * tier, and any payload the adapter needs. Present ONLY on findings whose fix maps cleanly to
 * an existing gated adapter; advisory-only findings leave it undefined. This is what lets a
 * FixProposal flow through the proven proposal → approval → execution-gate → audit → rollback
 * path with NO new authority.
 */
export interface WolverineFixRoute {
  adapterId: MutationAdapterId;
  tier: ProposalTier;
  /** Adapter-specific payload (e.g. cardId/cardName). Bulk-by-status adapters need none. */
  payload?: Record<string, unknown>;
}

/**
 * One audit finding = a (gated) FixProposal. Carries everything Hart needs to triage:
 * what + why (evidence) + the recommended fix + blast radius + rollback + whether it needs
 * approval, with honest confidence + freshness + the detector that produced it.
 */
export interface WolverineFinding {
  /** Stable id (detector-scoped) so the same issue dedupes across runs. */
  id: string;
  category: WolverineCategory;
  severity: WolverineSeverity;
  /** What is wrong (one line). */
  title: string;
  /** Why — grounded, evidence-backed. Never a guess. */
  evidence: string;
  /** Which agent/area owns it (optional). */
  ownerAgent?: string;
  /** The proposed repair (Wolverine proposes; it never applies). */
  recommendedFix: string;
  /** What a fix would touch (blast radius). */
  blastRadius: string;
  /** How the fix would be undone. */
  rollbackPath: string;
  /** Repairs are approval-gated by doctrine; true unless the fix is a pure no-op. */
  approvalRequired: boolean;
  confidence: WolverineConfidence;
  /** Source freshness / as-of (honest staleness). */
  freshness: string;
  /** The detector id that produced this finding. */
  source: string;
  /**
   * Present when this finding's repair maps to an existing gated adapter — the finding can then
   * be turned into a gated FixProposal (see wolverine-fix-proposal.ts). Undefined ⇒ advisory
   * only (Hart fixes it manually). Wolverine NEVER executes; the FixProposal still requires
   * Hart's approval + the per-action flag before any mutation.
   */
  fixRoute?: WolverineFixRoute;
}

/** The inputs a host gathers and hands to the (pure) detectors. Extensible per increment. */
export interface WolverineInputs {
  /** Injected ISO now (never an ambient clock). */
  now: string;
  /** Env for flag inspection (names + values surfaced; this is config, not secrets). */
  env?: Record<string, string | undefined>;
  /** Git facts gathered by the host (null fields when unavailable). */
  git?: GitFacts;
  /** Proposal-queue stats gathered by the host (from the spine). Absent ⇒ not assessed. */
  proposalStats?: ProposalStats;
  /** Domains the cockpit flagged stale (from sourceDiagnostics.staleSources). Absent ⇒ not assessed. */
  staleSources?: string[];
}

export interface ProposalStats {
  /** Draft/pending proposals older than the aging threshold (backlog drift). */
  agingDraftCount?: number | null;
  /** Rejected proposals eligible to be archived (housekeeping). */
  rejectedCount?: number | null;
  /** The aging threshold used (hours), surfaced for honest evidence. */
  agingHours?: number | null;
}

export interface GitFacts {
  branch?: string | null;
  /** Modified/staged files (excludes untracked). */
  uncommitted?: number | null;
  /** Untracked files. */
  untracked?: number | null;
  /** Commits ahead of the upstream/remote (unpushed). */
  ahead?: number | null;
  /** Whether an upstream/remote ref was resolvable (so ahead is meaningful). */
  hasUpstream?: boolean | null;
}

export interface WolverineReport {
  generatedAt: string;
  verdict: SystemVerdict;
  /** One-line, deterministic reason for the verdict (clamped to the worst real finding). */
  verdictReason: string;
  findingCount: number;
  bySeverity: Record<WolverineSeverity, number>;
  /** Up to 5 highest-severity findings — "what should Hart look at first". */
  topRisks: WolverineFinding[];
  /** All findings, ranked worst-first — the repair queue. */
  repairQueue: WolverineFinding[];
  note: string;
}

/** A pure detector: supplied the inputs, returns zero or more findings. Never throws on data. */
export type WolverineDetector = (inputs: WolverineInputs) => WolverineFinding[];

export const SEVERITY_RANK: Record<WolverineSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
