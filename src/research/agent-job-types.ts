/**
 * src/research/agent-job-types.ts
 *
 * Plan §7 — the universal AgentJob contract + its per-job BoundaryDefinition.
 *
 * A born agent is not a card: every agent receives a JOB, interrogates it, scopes it
 * WITH BOUNDARIES, proposes execution, produces artifacts, summarizes, proposes
 * follow-ups, and audits. This module is the TYPE foundation only — pure contracts,
 * no behavior, no I/O. The lifecycle state machine, the interrogation module, and the
 * concrete Research Agent are deferred (built later, on top of these types).
 *
 * Doctrine baked into the shape:
 *   - no interrogation = no job · no scope = no job · no boundaries = no job ·
 *     no artifact contract = no job · no target-folder approval = no file write ·
 *     no audit = no job completion.
 *   - boundaries are ENFORCED at the gate (see ./boundary-gate.ts) — a job exceeding a
 *     boundary is refused/stopped, never silently run.
 *   - artifacts are written ONLY through a typed/gated StorageAdapter (see
 *     ./storage-adapter.ts); a new write target needs explicit Hart approval first.
 *
 * Canonical types are IMPORTED, never redeclared:
 *   - AgentType         ← ../agents/agent-types.js   (added "research" member there)
 *   - AgentSignal       ← ../read-models/agent-signal.js
 *   - ActionProposal    ← ../cockpit/proposals/proposal-types.js
 */

import type { AgentType } from "../agents/agent-types.js";
import type { AgentSignal } from "../read-models/agent-signal.js";
import type { ActionProposal } from "../cockpit/proposals/proposal-types.js";

/** What kind of work the job is — drives interrogation, scope, and output contract. */
export type AgentJobType =
  | "research"
  | "comparison"
  | "decision_support"
  | "monitoring"
  | "cleanup"
  | "other";

/**
 * AgentJob lifecycle (plan §7):
 *   Request → Interrogate → Scope+Boundaries → Job Proposal → Hart Approval → Execute →
 *   Produce Artifacts → Cockpit Summary → Follow-up Proposals → Audit → Archive/Persist.
 * `refused` and `stopped` are terminal failure paths (e.g. a boundary was exceeded).
 */
export type AgentJobStatus =
  | "requested"
  | "interrogating"
  | "scoped"
  | "proposed"
  | "approved"
  | "executing"
  | "producing_artifacts"
  | "summarized"
  | "completed"
  | "refused"
  | "stopped"
  | "archived";

/** Confidence reuses the fleet word-set (honest "unknown" is allowed). */
export type AgentJobConfidence = AgentSignal["confidence"];

/** Freshness reuses the fleet word-set. */
export type AgentJobFreshness = AgentSignal["freshness"];

/** One interrogation question + (optionally) the answer that scopes the job. */
export interface InterrogationItem {
  /** Stable question id (deterministic — never LLM free text used as a key). */
  id: string;
  question: string;
  /** Why this question matters for scoping/boundaries (honest, not decorative). */
  rationale?: string;
  /** Whether the job may NOT proceed until this is answered. */
  required: boolean;
}

/** A captured answer to one interrogation question. */
export interface InterrogationAnswer {
  questionId: string;
  answer: string;
  answeredBy: string;
  answeredAt: string;
}

/** The locked scope of the job after interrogation (no scope = no job). */
export interface JobScope {
  /** One-line statement of exactly what is in scope. */
  statement: string;
  inScope: string[];
  outOfScope: string[];
  /** The decision/output this job exists to support. */
  decisionSupported: string;
  /** Localization required (e.g. ["SG", "HK", "EU"]) — empty when none. */
  localization: string[];
}

/**
 * BoundaryDefinition (plan §7) — declared per job, ENFORCED at the boundary gate.
 * Without boundaries, agents over-research forever or produce shallow random reports.
 * A job exceeding any boundary is refused/stopped, not silently run.
 *
 * Optional members (`?`) mean "not constrained by this boundary"; the gate treats an
 * undefined numeric ceiling as "no explicit limit" and an undefined permission flag as
 * the SAFE default (deny external network / deny LLM) — see ./boundary-gate.ts.
 */
export interface BoundaryDefinition {
  /** Max wall-clock the job may run, in milliseconds. */
  maxTime?: number;
  /** Max spend the job may incur (cost units, e.g. USD). */
  maxCost?: number;
  /** Max search/recursion depth a gathering step may reach. */
  maxSearchDepth?: number;
  /** Sources the job MAY use (allowlist). Empty/undefined ⇒ no positive allowlist declared. */
  allowedSources?: string[];
  /** Sources the job may NOT use (denylist) — always wins over the allowlist. */
  disallowedSources?: string[];
  /** Max number of artifact files the job may write. */
  maxFilesWritten?: number;
  /** The single approved target folder; a write outside it is refused. */
  targetFolder?: string;
  /** Whether the job may reach the external network at all. Default (undefined) ⇒ NO. */
  externalNetworkAllowed?: boolean;
  /** Whether the job may call an LLM at all. Default (undefined) ⇒ NO. */
  llmAllowed?: boolean;
  /** Whether a human must localize findings before they are trusted/acted on. */
  humanLocalizationNeeded?: boolean;
  /** Human-readable stop conditions (e.g. "stop when 20 sources gathered"). */
  stopConditions: string[];
}

/** A declared output artifact the job will (gated) produce. */
export interface OutputArtifact {
  /** Stable artifact id. */
  id: string;
  /** What this artifact is (e.g. "cockpit exec summary", "full report"). */
  kind: string;
  /** Where it WOULD be written — must match an approved StorageTarget before any write. */
  targetFolder: string;
  description: string;
}

/** A source the job actually drew on, with freshness for honesty. */
export interface JobDataSource {
  name: string;
  /** Where it came from (url id, repo path, RPC name) — never a secret/token. */
  reference: string;
  asOf: string | null;
  freshness: AgentJobFreshness;
}

/** One immutable audit entry on the job's trail (audit = job-completion requirement). */
export interface JobAuditEntry {
  at: string;
  event: string;
  detail?: string;
}

/**
 * The universal AgentJob contract (plan §7). Every field the plan names is present.
 * This is a DATA contract — methods/behavior live elsewhere (deferred). Findings are
 * never fabricated: what is not yet known lives in `unknowns`.
 */
export interface AgentJob {
  jobId: string;
  agentType: AgentType;
  jobType: AgentJobType;
  /** The raw request as Hart phrased it. */
  requestText: string;
  requester: string;
  status: AgentJobStatus;

  /** Interrogation (no interrogation = no job). */
  interrogationQuestions: InterrogationItem[];
  answers: InterrogationAnswer[];

  /** Locked scope (no scope = no job). */
  scope: JobScope;
  /** Declared boundaries (no boundaries = no job), enforced at the gate. */
  boundaryDefinition: BoundaryDefinition;
  /** The decision this job supports (mirrors scope.decisionSupported for top-level access). */
  decisionSupported: string;

  /** Sources actually used, plus the declared allow/deny lists for this job. */
  dataSources: JobDataSource[];
  allowedSources: string[];
  disallowedSources: string[];

  /** Output contract (no artifact contract = no job). */
  outputArtifacts: OutputArtifact[];
  /** The single approved target folder for this job's writes. */
  targetFolder: string;

  /** Cockpit-facing results. */
  cockpitSummary: string;
  mainFindings: string[];
  localizedImplications: string[];
  /** Follow-up actions proposed (never executed) — canonical ActionProposal shape. */
  proposedActions: ActionProposal[];

  confidence: AgentJobConfidence;
  /** Honest unknowns — answers are never fabricated to fill these. */
  unknowns: string[];

  /** Audit trail (no audit = no job completion). */
  auditTrail: JobAuditEntry[];

  createdAt: string;
  completedAt: string | null;
  freshness: AgentJobFreshness;

  /** How the job would/did fail (e.g. "boundary_exceeded", "source_disallowed"). */
  failureMode: string | null;
  /** What to do if this job's output turns out wrong (correction/rollback note). */
  rollbackOrCorrectionNote: string | null;
}
