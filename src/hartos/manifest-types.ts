/**
 * src/hartos/manifest-types.ts — LEVEL 1 (Factory Agent v1): the MANIFEST type spine.
 *
 * Plan §1 cap 3 + §6 (docs/HARTOS_3_LEVELS_UP_MUTATION_MAP.md): Factory v1 is a MANIFEST
 * COMPILER, not a raw autonomous coder. It interrogates → locks an `AgentSpec` → compiles
 * it into an `AgentManifest` of KNOWN RUNTIME PATTERNS (configuration, not code). The
 * runtime patterns are the EXISTING cockpit canon — AgentContract, ReadModelConfig,
 * AgentSignal (via the contract), CockpitRegistration, JobLifecycleConfig, DoctrineConfig,
 * TestPlan, ProvisioningPlan — so a born agent is "compiled," never "invented."
 *
 * This module is TYPE-ONLY: it COMPOSES the canon, never redeclares it. Pure + Worker-safe
 * (no node:fs / pg / network in this graph). The compiler (./manifest-compiler.ts) owns the
 * behavior; both files agree because they ship together.
 *
 * Canonical types are IMPORTED, never redeclared:
 *   - ReadModelType / ReadModelConfig / ForbiddenOperation ← ../read-models/read-model-types.js
 *   - AgentContract                                        ← ../agents/agent-contract.js
 *   - AgentJobType / BoundaryDefinition / OutputArtifact   ← ../research/agent-job-types.js
 *   - DOCTRINE_VERSION / DoctrineClause                    ← ../doctrine/doctrine.js
 *   - ProvisionStep / ProviderName                         ← ../provisioning/types.js (TYPE-ONLY)
 *   - Domain / RiskLevel                                   ← ./orchestrator-types.js
 */

import type { ReadModelType, ReadModelConfig } from "../read-models/read-model-types.js";
import type { AgentContract } from "../agents/agent-contract.js";
import type { AgentJobType, BoundaryDefinition, OutputArtifact } from "../research/agent-job-types.js";
import type { DOCTRINE_VERSION, DoctrineClause } from "../doctrine/doctrine.js";
import type { ProvisionStep, ProviderName } from "../provisioning/types.js";
import type { Domain, RiskLevel } from "./orchestrator-types.js";

/**
 * The APPROVED agent spec — the locked output of the Spec Interrogator. Hart approves this
 * (and the compiled manifest) BEFORE any build. It is the compiler's sole input.
 */
export interface AgentSpec {
  /** Stable spec id (deterministic — never LLM free text used as a key). */
  specId: string;
  /** Kebab-case agent name (e.g. "invoices-agent"). */
  agentName: string;
  /** Classified domain (drives risk + routing). */
  domain: Domain;
  /** The read-model type the born agent surfaces (its fleet-card + detail seam). */
  targetReadModelType: ReadModelType;
  /** One-line statement of why this agent exists. */
  purpose: string;
  /** Read-only data sources the agent draws on (Supabase tables / RPC names — never secrets). */
  dataSources: string[];
  /** The capabilities / commands the agent handles. */
  capabilities: string[];
  /** Cockpit display name (fleet card). */
  label: string;
  /** Cockpit display icon (fleet card). */
  icon: string;
  /** The propose-only proposal action types it may emit (vocabulary only). */
  proposalTypes: string[];
  /** Declared output artifacts the (gated) job lifecycle will produce. */
  outputs: OutputArtifact[];
  /** What kind of work the agent's job is — drives lifecycle + interrogation. */
  jobType: AgentJobType;
  /** The job's enforced boundaries (no boundaries = no job). */
  boundary: BoundaryDefinition;
  /** Acceptance criteria the agent must meet to be considered "real" (drives the TestPlan). */
  acceptanceCriteria: string[];
  /** Risk band — high-risk domains force approval. */
  riskLevel: RiskLevel;
  /** Prerequisites that must hold before a build (e.g. "Supabase project exists"). */
  prereqs: string[];
  /** Whether approval is required before the agent's proposals act (cockpit-gated). */
  cockpitDone: boolean;
  /** Whether the agent's proposals gate on human approval. */
  approvalRequired: boolean;
  /** How the agent would/did fail (honest failure mode, never hidden). */
  failureMode: string;
}

/**
 * The cockpit registration DERIVED from the AgentContract — there is ONE officiation
 * vocabulary (agent-contract.ts), and this is its cockpit-facing projection. Never a
 * second card/proposal vocabulary; every field is read off the contract.
 */
export interface CockpitRegistration {
  /** Fleet-card / route segment key — the contract's read-model type. */
  type: ReadModelType;
  /** Fleet-card display name (from the contract). */
  label: string;
  /** Fleet-card icon (from the contract). */
  icon: string;
  /** The /agent/<type>/ui detail route the agent earns. */
  detailRoute: string;
  /** The propose-only proposal vocabulary it may emit (from the contract). */
  proposalTypes: string[];
  /** Whether its proposals require human approval (from the contract). */
  approvalRequired: boolean;
}

/** One stage of the born agent's job lifecycle (config, not behavior). */
export interface JobLifecycleStage {
  /** Stage id (mirrors the AgentJobStatus vocabulary, e.g. "interrogating"). */
  id: string;
  /** What happens at this stage. */
  description: string;
  /** Whether Hart's approval gates this stage. */
  approvalGated: boolean;
}

/** The job lifecycle config — jobType + enforced boundary + the declarative stages. */
export interface JobLifecycleConfig {
  jobType: AgentJobType;
  boundary: BoundaryDefinition;
  stages: JobLifecycleStage[];
}

/** The doctrine binding the born agent inherits — version + the clauses, as data. */
export interface DoctrineConfig {
  /** Must equal the live DOCTRINE_VERSION; the compiler refuses any drift. */
  version: typeof DOCTRINE_VERSION;
  clauses: DoctrineClause[];
}

/** One planned test case derived from an acceptance criterion. */
export interface TestPlanCase {
  /** Stable case id. */
  id: string;
  /** What the case proves. */
  description: string;
  /** The acceptance criterion this case maps to. */
  criterion: string;
  /** Whether the case is HERMETIC (no env/network/fs/clock) — born tests must be. */
  hermetic: boolean;
}

/** The planned test surface for the born agent (cases + the criteria they cover). */
export interface TestPlan {
  cases: TestPlanCase[];
  acceptanceCriteria: string[];
}

/**
 * PLANNING-ONLY provisioning intent — DISTINCT from the executable ProvisionPlan in
 * ../provisioning/types.js. It carries the steps a build WOULD run (type-only) plus the
 * providers involved, and ALWAYS requires approval. There is no apply() here: the Factory
 * v1 manifest is configuration, never live mutation.
 */
export interface ProvisioningPlan {
  /** The steps a build would run — TYPE-ONLY references, never executed here. */
  steps: ProvisionStep[];
  /** The providers the build would touch. */
  providers: ProviderName[];
  /** Always true — a manifest never self-approves provisioning. */
  requiresApproval: true;
}

/**
 * The compiled manifest — the known-runtime-pattern bundle for one born agent. Every
 * member is EXISTING canon (composed, not redeclared). The compiler guarantees the
 * invariants (read-only born, officiable contract, doctrine version, non-empty boundary).
 */
export interface AgentManifest {
  spec: AgentSpec;
  contract: AgentContract;
  readModel: ReadModelConfig;
  cockpitRegistration: CockpitRegistration;
  jobLifecycle: JobLifecycleConfig;
  doctrine: DoctrineConfig;
  testPlan: TestPlan;
  provisioning: ProvisioningPlan;
}

/** One reason a manifest fails compilation/validation (parallels ContractViolation). */
export interface ManifestViolation {
  /** Which manifest facet failed (e.g. "read-model", "contract", "job-lifecycle"). */
  facet: string;
  detail: string;
}
