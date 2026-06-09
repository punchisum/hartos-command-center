/**
 * src/hartos/manifest-compiler.ts — LEVEL 1 (Factory Agent v1): the MANIFEST COMPILER.
 *
 * Plan §1 cap 3 + §6: turn an APPROVED `AgentSpec` into an `AgentManifest` of KNOWN
 * RUNTIME PATTERNS — CONFIGURATION, NOT CODE. No raw codegen lives here. The compiler is
 * pure + deterministic + Worker-safe: no node:fs, no pg, no network, no Supabase, no
 * apply(). The ProvisioningPlan it emits is PLANNING-ONLY intent (requiresApproval:true).
 *
 * The runtime patterns are the existing cockpit canon, COMPOSED not duplicated:
 *   - readModel:           a read-only (enabled:false, FORBIDDEN_OPERATIONS) ReadModelConfig.
 *   - contract:            an AgentContract that MUST pass validateAgentContract — the SINGLE
 *                          officiation vocabulary (src/agents/agent-contract.ts).
 *   - cockpitRegistration: DERIVED FROM the contract (never a second card vocabulary).
 *   - jobLifecycle:        jobType + the spec's enforced BoundaryDefinition + the §7 stages.
 *   - doctrine:            the live DOCTRINE clauses at DOCTRINE_VERSION (refuses drift).
 *   - testPlan:            cases derived from the spec's acceptance criteria.
 *   - provisioning:        planning-only ProvisionStep intent, requiresApproval:true, no apply.
 *
 * `validateManifest` is the gate Hart's approval relies on: it re-checks the invariants and
 * REFUSES (ManifestViolation) a read-write born agent, a non-officiable contract, a doctrine
 * drift, or a job lifecycle with an empty BoundaryDefinition.
 */

import {
  FORBIDDEN_OPERATIONS,
  type ReadModelConfig,
} from "../read-models/read-model-types.js";
import {
  validateAgentContract,
  type AgentContract,
} from "../agents/agent-contract.js";
import type { AgentDetailSpec, DetailRpcSpec } from "../read-models/agent-detail-registry.js";
import type { BoundaryDefinition } from "../research/agent-job-types.js";
import { DOCTRINE, DOCTRINE_VERSION } from "../doctrine/doctrine.js";
import type { ProvisionStep, ProviderName } from "../provisioning/types.js";
import type {
  AgentSpec,
  AgentManifest,
  CockpitRegistration,
  JobLifecycleConfig,
  JobLifecycleStage,
  DoctrineConfig,
  TestPlan,
  TestPlanCase,
  ProvisioningPlan,
  ManifestViolation,
} from "./manifest-types.js";

// ─── small pure helpers ────────────────────────────────────────────────────────

function slug(text: string): string {
  return (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Env-var NAME form (never a value) — UPPER_SNAKE, suffixed. */
function envName(agentName: string, suffix: string): string {
  return `${(agentName || "agent").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_${suffix}`;
}

/**
 * True when the BoundaryDefinition is "empty" — it declares no real constraint at all.
 * A born job with no boundaries = no job (plan §7): the compiler refuses it. stopConditions
 * is the one always-present member; an otherwise-empty boundary with no stop conditions is
 * the degenerate case we reject.
 */
function isEmptyBoundary(b: BoundaryDefinition): boolean {
  const hasStop = Array.isArray(b.stopConditions) && b.stopConditions.length > 0;
  const hasAnyConstraint =
    typeof b.maxTime === "number" ||
    typeof b.maxCost === "number" ||
    typeof b.maxSearchDepth === "number" ||
    typeof b.maxFilesWritten === "number" ||
    (Array.isArray(b.allowedSources) && b.allowedSources.length > 0) ||
    (Array.isArray(b.disallowedSources) && b.disallowedSources.length > 0) ||
    (typeof b.targetFolder === "string" && b.targetFolder.length > 0) ||
    typeof b.externalNetworkAllowed === "boolean" ||
    typeof b.llmAllowed === "boolean" ||
    typeof b.humanLocalizationNeeded === "boolean";
  return !hasStop && !hasAnyConstraint;
}

// ─── pattern builders (config-not-code) ─────────────────────────────────────────

/**
 * The born agent's generic detail spec — its read-only RPCs declared as DATA. Every born
 * agent surfaces a full /agent/<domain>/ui via a spec (no UI code). Derived from the spec's
 * dataSources (treated as read RPC names); a column per source keeps it render-ready.
 */
function buildDetailSpec(spec: AgentSpec): AgentDetailSpec {
  const domain = spec.targetReadModelType;
  const sources = spec.dataSources.length > 0 ? spec.dataSources : [`${slug(spec.agentName)}_overview`];
  const rpcs: DetailRpcSpec[] = sources.map((src, i) => ({
    rpc: slug(src).replace(/-/g, "_") || `read_${i}`,
    section: src,
    render: i === 0 ? "kv" : "table",
    columns: [{ header: src, field: slug(src).replace(/-/g, "_") || `field_${i}` }],
  }));
  return {
    domain,
    label: spec.label,
    urlEnv: envName(spec.agentName, "SUPABASE_URL"),
    keyEnv: envName(spec.agentName, "SUPABASE_ANON_KEY"),
    rpcs,
  };
}

/** A read-only born ReadModelConfig: enabled:false + the canonical FORBIDDEN_OPERATIONS. */
function buildReadModel(spec: AgentSpec, detail: AgentDetailSpec): ReadModelConfig {
  return {
    id: spec.targetReadModelType,
    type: spec.targetReadModelType,
    enabled: false, // born read-only + disabled-by-default (doctrine read-only-first / fail-closed)
    mode: "supabase_readonly",
    supabaseUrlEnv: detail.urlEnv,
    supabaseKeyEnv: detail.keyEnv,
    allowedTables: [],
    allowedRpcs: detail.rpcs.map((r) => r.rpc),
    forbiddenOperations: [...FORBIDDEN_OPERATIONS], // deep-equals the canonical denylist
  };
}

/** The AgentContract — the SINGLE officiation card/proposal vocabulary, built from the spec. */
function buildContract(spec: AgentSpec, detail: AgentDetailSpec): AgentContract {
  return {
    type: spec.targetReadModelType,
    label: spec.label,
    icon: spec.icon,
    readModelId: spec.targetReadModelType,
    proposalTypes: [...spec.proposalTypes],
    approvalRequired: spec.approvalRequired,
    detail,
  };
}

/** Cockpit registration DERIVED from the contract — no independent vocabulary. */
function deriveCockpitRegistration(contract: AgentContract): CockpitRegistration {
  return {
    type: contract.type,
    label: contract.label,
    icon: contract.icon,
    detailRoute: `/agent/${contract.type}/ui`,
    proposalTypes: [...contract.proposalTypes],
    approvalRequired: contract.approvalRequired,
  };
}

/** The §7 job lifecycle as config — jobType + the spec's enforced boundary + declared stages. */
function buildJobLifecycle(spec: AgentSpec): JobLifecycleConfig {
  const stages: JobLifecycleStage[] = [
    { id: "requested", description: "Job received from the cockpit.", approvalGated: false },
    { id: "interrogating", description: "Interrogate the request into a scoped job.", approvalGated: false },
    { id: "scoped", description: "Lock scope + enforced boundaries.", approvalGated: false },
    { id: "proposed", description: "Emit a non-executable job proposal.", approvalGated: false },
    { id: "approved", description: "Hart approves the job.", approvalGated: true },
    { id: "executing", description: "Run within the boundary gate.", approvalGated: false },
    { id: "summarized", description: "Surface the cockpit summary + follow-up proposals.", approvalGated: false },
    { id: "completed", description: "Audit + archive the job.", approvalGated: false },
  ];
  return { jobType: spec.jobType, boundary: spec.boundary, stages };
}

/** The doctrine binding — the live clauses at the live version (compiler refuses drift). */
function buildDoctrineConfig(): DoctrineConfig {
  return { version: DOCTRINE_VERSION, clauses: [...DOCTRINE] };
}

/** A TestPlan: one HERMETIC case per acceptance criterion (+ the officiation proof case). */
function buildTestPlan(spec: AgentSpec): TestPlan {
  const cases: TestPlanCase[] = spec.acceptanceCriteria.map((criterion, i) => ({
    id: `ac-${i + 1}`,
    description: `Proves: ${criterion}`,
    criterion,
    hermetic: true,
  }));
  // Every born agent ships an officiation proof — its contract must officiate cleanly.
  cases.push({
    id: "officiation",
    description: "manifest.contract officiates against a representative HEALTHY summary with zero violations.",
    criterion: "officiable",
    hermetic: true,
  });
  return { cases, acceptanceCriteria: [...spec.acceptanceCriteria] };
}

/**
 * PLANNING-ONLY provisioning intent — the steps a build WOULD run, as TYPE-ONLY
 * ProvisionStep data (no apply, no engine import). requiresApproval is always true.
 */
function buildProvisioningPlan(spec: AgentSpec): ProvisioningPlan {
  const providers: ProviderName[] = ["github", "supabase", "cloudflare"];
  const steps: ProvisionStep[] = [
    {
      id: "create-repo",
      provider: "github",
      action: "create_repo",
      environment: "staging",
      mutation: true,
      requiredGate: "ALLOW_GITHUB_PROVISION",
      description: `Create the ${spec.agentName} repository.`,
      safeSummary: `repo for ${spec.agentName} (planning-only intent — not executed)`,
    },
    {
      id: "create-project",
      provider: "supabase",
      action: "create_project",
      environment: "staging",
      mutation: true,
      requiredGate: "ALLOW_SUPABASE_PROVISION",
      description: `Provision the ${spec.agentName} Supabase project + read-only RPCs.`,
      safeSummary: `read-only data layer for ${spec.agentName} (planning-only intent — not executed)`,
    },
    {
      id: "deploy-cockpit",
      provider: "cloudflare",
      action: "deploy_worker",
      environment: "staging",
      mutation: true,
      requiredGate: "ALLOW_CLOUDFLARE_COCKPIT_DEPLOY",
      productionGateRequired: true,
      description: `Deploy the hosted read-only cockpit Worker for ${spec.agentName}.`,
      safeSummary: `hosted read-only cockpit for ${spec.agentName} (planning-only intent — not executed)`,
    },
  ];
  return { steps, providers, requiresApproval: true };
}

// ─── the compiler + validator ───────────────────────────────────────────────────

/**
 * Compile an APPROVED AgentSpec into the AgentManifest of known runtime patterns.
 * Pure + deterministic: same spec ⇒ deep-equal manifest. Generates CONFIGURATION ONLY.
 */
export function compileSpecToManifest(spec: AgentSpec): AgentManifest {
  const detail = buildDetailSpec(spec);
  const readModel = buildReadModel(spec, detail);
  const contract = buildContract(spec, detail);
  const cockpitRegistration = deriveCockpitRegistration(contract);
  const jobLifecycle = buildJobLifecycle(spec);
  const doctrine = buildDoctrineConfig();
  const testPlan = buildTestPlan(spec);
  const provisioning = buildProvisioningPlan(spec);

  return {
    spec,
    contract,
    readModel,
    cockpitRegistration,
    jobLifecycle,
    doctrine,
    testPlan,
    provisioning,
  };
}

/**
 * Validate a compiled manifest against the Factory v1 invariants. Returns [] when clean;
 * every reason it is refused otherwise. This is the gate Hart's approval relies on.
 */
export function validateManifest(m: AgentManifest): ManifestViolation[] {
  const v: ManifestViolation[] = [];

  // 1. Read-only born: disabled-by-default + the canonical forbidden-operations denylist.
  if (m.readModel.enabled !== false) {
    v.push({ facet: "read-model", detail: "a born read-model must be enabled:false (read-only-first / fail-closed)" });
  }
  if (
    m.readModel.forbiddenOperations.length !== FORBIDDEN_OPERATIONS.length ||
    !FORBIDDEN_OPERATIONS.every((op, i) => m.readModel.forbiddenOperations[i] === op)
  ) {
    v.push({ facet: "read-model", detail: "forbiddenOperations must equal the canonical FORBIDDEN_OPERATIONS denylist" });
  }

  // 2. Officiable contract — the SINGLE officiation vocabulary must pass static validation.
  for (const cv of validateAgentContract(m.contract)) {
    v.push({ facet: "contract", detail: `${cv.facet}: ${cv.detail}` });
  }

  // 3. Cockpit registration is DERIVED from the contract — refuse any divergence.
  if (m.cockpitRegistration.type !== m.contract.type) {
    v.push({ facet: "cockpit-registration", detail: "registration.type must derive from contract.type" });
  }
  if (m.cockpitRegistration.detailRoute !== `/agent/${m.contract.type}/ui`) {
    v.push({ facet: "cockpit-registration", detail: "detailRoute must derive from the contract type" });
  }
  if (m.cockpitRegistration.approvalRequired !== m.contract.approvalRequired) {
    v.push({ facet: "cockpit-registration", detail: "approvalRequired must derive from the contract" });
  }

  // 4. Job lifecycle: no boundaries = no job — refuse an empty BoundaryDefinition.
  if (isEmptyBoundary(m.jobLifecycle.boundary)) {
    v.push({ facet: "job-lifecycle", detail: "BoundaryDefinition is empty — no boundaries = no job (plan §7)" });
  }
  if (m.jobLifecycle.stages.length === 0) {
    v.push({ facet: "job-lifecycle", detail: "job lifecycle has no stages" });
  }

  // 5. Doctrine binding must be at the live version — refuse any drift.
  if (m.doctrine.version !== DOCTRINE_VERSION) {
    v.push({ facet: "doctrine", detail: `doctrine.version "${m.doctrine.version}" != DOCTRINE_VERSION "${DOCTRINE_VERSION}"` });
  }
  if (m.doctrine.clauses.length === 0) {
    v.push({ facet: "doctrine", detail: "doctrine binding carries no clauses" });
  }

  // 6. Test plan must cover the acceptance criteria + carry the officiation proof.
  if (m.testPlan.cases.length === 0) {
    v.push({ facet: "test-plan", detail: "test plan has no cases" });
  }
  if (!m.testPlan.cases.some((c) => c.criterion === "officiable")) {
    v.push({ facet: "test-plan", detail: "test plan must include the officiation proof case" });
  }

  // 7. Provisioning is PLANNING-ONLY intent — it must require approval, never self-apply.
  if (m.provisioning.requiresApproval !== true) {
    v.push({ facet: "provisioning", detail: "provisioning intent must require approval (planning-only)" });
  }

  return v;
}
