/**
 * src/hartos/manifest-build-planner.ts — FACTORY v1.5: the BUILD PLANNER.
 *
 * Plan §1 cap 4 + §18 DoD step 5: project a compiled `AgentManifest` (and, optionally, a
 * Beezulbub capability report) into a typed `ImplementationPlan` — the structured, ordered
 * intent a (later, gated) Builder/Provisioner WOULD execute. This module is PLANNING ONLY:
 * it composes the canon and emits intent. It NEVER builds a scaffold, applies provisioning,
 * mutates a repo, opens a PR, deploys, or folds Beezulbub patterns into a store. There is no
 * apply() anywhere in this graph.
 *
 * Composed canon (imported, never redeclared):
 *   - AgentManifest / ProvisioningPlan / TestPlanCase  ← ./manifest-types.js
 *   - validateManifest                                  ← ./manifest-compiler.js (fail-closed gate)
 *   - generateBuildPlan / BuildPlanResult               ← ./build-plan.js (BLACK BOX, request narrative)
 *   - ProvisionStep / RollbackStep                      ← ../provisioning/types.js
 *   - BeezulbubCapabilityReport / ProposedBuildPlanChange ← ../beezulbub/types.js (advisory, approval-gated)
 *   - ManifestViolation                                 ← ./manifest-types.js
 *
 * Confidence (plan §19 — NO laundering): when a Beezulbub report is supplied, the plan's
 * confidence is min(intrinsic, report.confidence). An aggregate is never more certain than
 * its least-certain input. The fold-in of report.proposedBuildPlanChanges is ADVISORY and
 * APPROVAL-GATED — carried verbatim, never auto-applied.
 *
 * Pure + deterministic + Worker-safe: no node:fs, no pg, no network, no Supabase, no clock.
 * The timestamp is INJECTED via opts.now; nothing reads the ambient clock or process.env.
 */

import type {
  AgentManifest,
  TestPlanCase,
  ManifestViolation,
} from "./manifest-types.js";
import { validateManifest } from "./manifest-compiler.js";
import type { ProvisionStep, RollbackStep } from "../provisioning/types.js";
import type {
  BeezulbubCapabilityReport,
  ProposedBuildPlanChange,
} from "../beezulbub/types.js";

// ─── plan-facet helper types ────────────────────────────────────────────────────

/** A file the (gated) build WOULD create — declared as intent, never written here. */
export interface PlannedFile {
  /** Repo-relative path the build would create. */
  path: string;
  /** What kind of artifact this is (config/test/read-model/contract/etc.). */
  kind: "contract" | "read-model" | "detail-spec" | "config" | "test" | "doc";
  /** Why this file is planned (traced back to a manifest facet). */
  reason: string;
}

/** A migration the (gated) build WOULD run against the agent's read-only data layer. */
export interface PlannedMigration {
  /** Stable migration id. */
  id: string;
  /** What the migration provisions (read-only RPCs / tables — never a mutation seam). */
  description: string;
  /** The provider step this migration derives from. */
  derivedFromStep: string;
  /** Always read-only: a born data layer never gains a write path. */
  readOnly: true;
}

/** A test the (gated) build WOULD scaffold — mirrors a manifest TestPlanCase. */
export interface PlannedTest {
  /** Case id (mirrors TestPlanCase.id). */
  id: string;
  /** What the case proves. */
  description: string;
  /** The acceptance criterion (or "officiable") it maps to. */
  criterion: string;
  /** Born tests are HERMETIC — no env/network/fs/clock. */
  hermetic: boolean;
  /** Where the test came from: the manifest, or a Beezulbub-required test. */
  source: "manifest" | "beezulbub";
}

/**
 * The typed implementation plan — the ordered, structured intent a (later, GATED)
 * Builder/Provisioner would execute. Every member is projected from the manifest (and,
 * advisorily, a Beezulbub report). `requiresApproval` is ALWAYS true: a plan never
 * self-applies, and provisioning intent stays un-applied.
 */
export interface ImplementationPlan {
  /** Back-reference to the manifest this plan was projected from. */
  manifestRef: { specId: string; agentName: string };
  /** Files the build would create (config/test/read-model/contract facets). */
  files: PlannedFile[];
  /** Read-only migrations the build would run. */
  migrations: PlannedMigration[];
  /** Tests the build would scaffold (manifest cases + any Beezulbub-required tests). */
  tests: PlannedTest[];
  /** The provisioning steps the build would run — UN-APPLIED ProvisionStep intent. */
  provisioningIntent: ProvisionStep[];
  /** Gate env-var NAMES that must hold before any provisioning step runs (never values). */
  deployGates: string[];
  /** Rollback steps for each provisioning step that declares one. */
  rollback: RollbackStep[];
  /** Advisory build-plan changes from Beezulbub — APPROVAL-GATED, carried verbatim. */
  proposedFromBeezulbub: ProposedBuildPlanChange[];
  /** Why the plan is refused / suspect — empty for a clean manifest. */
  violations: ManifestViolation[];
  /** Plan confidence, 0-1. <= report.confidence when a report is supplied (§19). */
  confidence: number;
  /** Always true — a plan never self-approves a build. */
  requiresApproval: true;
}

export interface PlanFromManifestOptions {
  /** Optional Beezulbub capability report — advisory, approval-gated fold-in. */
  report?: BeezulbubCapabilityReport;
  /** Injected timestamp (ISO string) — never read the ambient clock. */
  now?: string;
}

// ─── intrinsic confidence (pre-Beezulbub) ───────────────────────────────────────

/**
 * The plan's INTRINSIC confidence, derived ONLY from the manifest's own integrity.
 * A clean manifest plans with full confidence; each violation erodes it. This is never
 * laundered upward — it is the ceiling before a Beezulbub report can only pull it DOWN.
 */
function intrinsicConfidence(violations: ManifestViolation[]): number {
  if (violations.length === 0) return 1;
  // Each violation removes a fixed slice; floor at 0 (never negative, never > intrinsic).
  return Math.max(0, 1 - violations.length * 0.2);
}

// ─── facet projections (config-not-code; pure) ──────────────────────────────────

/** Files the build would create, traced to the manifest facets that justify them. */
function projectFiles(manifest: AgentManifest): PlannedFile[] {
  const agent = manifest.spec.agentName;
  const files: PlannedFile[] = [
    {
      path: `src/agents/${agent}.contract.json`,
      kind: "contract",
      reason: "officiation contract (single officiation vocabulary) — from manifest.contract",
    },
    {
      path: `src/read-models/${agent}.read-model.json`,
      kind: "read-model",
      reason: "read-only ReadModelConfig (enabled:false) — from manifest.readModel",
    },
    {
      path: `src/read-models/${agent}.detail-spec.json`,
      kind: "detail-spec",
      reason: "declarative /agent/<type>/ui detail spec — from manifest.contract.detail",
    },
    {
      path: `src/doctrine/${agent}.doctrine.json`,
      kind: "config",
      reason: `doctrine binding at version ${manifest.doctrine.version} — from manifest.doctrine`,
    },
  ];
  // One test file mirrors the manifest's test plan.
  files.push({
    path: `tests/${agent}.test.json`,
    kind: "test",
    reason: "hermetic test surface — from manifest.testPlan.cases",
  });
  return files;
}

/** Read-only migrations the build would run — derived from the provisioning + read-model facets. */
function projectMigrations(manifest: AgentManifest): PlannedMigration[] {
  const rpcs = manifest.readModel.allowedRpcs;
  return manifest.provisioning.steps
    .filter((s) => s.provider === "supabase")
    .map((s) => ({
      id: `migrate-${s.id}`,
      description:
        rpcs.length > 0
          ? `Provision read-only RPCs (${rpcs.join(", ")}) for ${manifest.spec.agentName}.`
          : `Provision the read-only data layer for ${manifest.spec.agentName}.`,
      derivedFromStep: s.id,
      readOnly: true as const,
    }));
}

/** Tests the build would scaffold — manifest cases plus any Beezulbub-required tests. */
function projectTests(
  cases: TestPlanCase[],
  report?: BeezulbubCapabilityReport,
): PlannedTest[] {
  const tests: PlannedTest[] = cases.map((c) => ({
    id: c.id,
    description: c.description,
    criterion: c.criterion,
    hermetic: c.hermetic,
    source: "manifest" as const,
  }));
  if (report) {
    // Beezulbub adaptation plans declare requiredTests — fold them in as ADVISORY intent.
    let i = 0;
    for (const plan of report.recommendedAdaptations) {
      for (const t of plan.requiredTests) {
        tests.push({
          id: `bz-${++i}`,
          description: t,
          criterion: "beezulbub-required",
          hermetic: true,
          source: "beezulbub",
        });
      }
    }
  }
  return tests;
}

/** Deploy gates the provisioning intent requires — gate NAMES only, deduped + ordered. */
function projectDeployGates(steps: ProvisionStep[]): string[] {
  const gates: string[] = [];
  for (const s of steps) {
    if (typeof s.requiredGate === "string" && s.requiredGate && !gates.includes(s.requiredGate)) {
      gates.push(s.requiredGate);
    }
    if (s.productionGateRequired === true && !gates.includes("CONFIRM_PRODUCTION_DEPLOY")) {
      gates.push("CONFIRM_PRODUCTION_DEPLOY");
    }
  }
  return gates;
}

/** Rollback steps for each provisioning step that declares one. */
function projectRollback(steps: ProvisionStep[]): RollbackStep[] {
  const rollback: RollbackStep[] = [];
  for (const s of steps) {
    if (s.rollback) rollback.push(s.rollback);
  }
  return rollback;
}

// ─── the planner ─────────────────────────────────────────────────────────────────

/**
 * Project a compiled `AgentManifest` into a typed `ImplementationPlan` (PLANNING ONLY).
 *
 * FAIL-CLOSED: validateManifest(manifest) runs FIRST and its violations are carried on the
 * plan. An invalid manifest still RETURNS a plan, but with non-empty `violations`, an eroded
 * `confidence`, and `requiresApproval:true` — it never throws and never self-applies.
 *
 * Beezulbub fold-in is ADVISORY + APPROVAL-GATED: `proposedFromBeezulbub` is carried verbatim
 * from `report.proposedBuildPlanChanges`, and `confidence` is clamped to <= report.confidence
 * (plan §19 — no laundering). The provisioning intent stays UN-APPLIED.
 *
 * Pure + deterministic: same manifest (+ report) ⇒ deep-equal plan. The timestamp is injected
 * via opts.now and only ever recorded — it never gates logic.
 */
export function planFromManifest(
  manifest: AgentManifest,
  opts: PlanFromManifestOptions = {},
): ImplementationPlan {
  // 1. Fail-closed gate FIRST — carry violations, never throw.
  const violations = validateManifest(manifest);

  // 2. Project the manifest facets into typed intent.
  const provisioningIntent = manifest.provisioning.steps; // un-applied ProvisionStep[]
  const files = projectFiles(manifest);
  const migrations = projectMigrations(manifest);
  const tests = projectTests(manifest.testPlan.cases, opts.report);
  const deployGates = projectDeployGates(provisioningIntent);
  const rollback = projectRollback(provisioningIntent);

  // 3. Beezulbub fold-in is advisory + approval-gated (carried verbatim, never auto-applied).
  const proposedFromBeezulbub: ProposedBuildPlanChange[] = opts.report
    ? opts.report.proposedBuildPlanChanges
    : [];

  // 4. Confidence (§19 — no laundering): intrinsic ceiling, clamped DOWN by the report.
  const intrinsic = intrinsicConfidence(violations);
  const confidence = opts.report ? Math.min(intrinsic, opts.report.confidence) : intrinsic;

  return {
    manifestRef: { specId: manifest.spec.specId, agentName: manifest.spec.agentName },
    files,
    migrations,
    tests,
    provisioningIntent,
    deployGates,
    rollback,
    proposedFromBeezulbub,
    violations,
    confidence,
    requiresApproval: true,
  };
}
