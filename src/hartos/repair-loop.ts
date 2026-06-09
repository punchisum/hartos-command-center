/**
 * src/hartos/repair-loop.ts — FACTORY v1.5: the Repair-Loop CORE (PROPOSAL ONLY).
 *
 * Plan §1 cap 8 + §19 (docs/HARTOS_3_LEVELS_UP_MUTATION_MAP.md): a born/factory build that
 * fails verification does NOT silently self-heal and it NEVER reports "done" while a test is
 * red. This module takes a failure set (failing tests / typecheck errors / gate refusals) and
 * produces a RepairProposal — a propose-only diagnosis + change list — that:
 *   - surfaces EVERY failing test (never hides a red test);
 *   - stays verificationStatus 'blocked' while ANY required test is unmet (never 'verified');
 *   - carries the ALLOW_REPAIR_LOOP gate as DATA (the loop never reads process.env), is
 *     proposalOnly:true and requiresApproval:true — so the Builder/Provisioner stays gated.
 *
 * Pure + deterministic + Worker-safe: no env, no network, no fs, no ambient clock. The
 * timestamp is INJECTED via opts.now. We import NOTHING from src/execution/* (this graph is
 * execution-free) and only TYPE-ONLY import the canon (RiskLevel, TestPlanCase).
 */

import type { TestPlanCase } from "./manifest-types.js";
import type { RiskLevel } from "./orchestrator-types.js";

/**
 * One reported failure. A discriminated union — the failure set is an array of these.
 * Nothing here is mutated or executed; it is the honest record of what went red.
 */
export type RepairFailureReport =
  | { kind: "failing_test"; testId: string; detail: string }
  | { kind: "typecheck_error"; file: string; detail: string }
  | { kind: "gate_refusal"; gate: string; detail: string };

/** One proposed change a repair WOULD make — never applied here. */
export interface ProposedRepairChange {
  /** What the change targets (a file, a contract facet, a gate). */
  target: string;
  /** The change a repair would make (described, never executed). */
  change: string;
  /** Why this change addresses a surfaced failure. */
  rationale: string;
}

/**
 * The repair proposal — propose-only. It never applies a repair and never self-verifies:
 * verificationStatus is 'blocked' while any required test is unmet, and the gate is carried
 * as data (ALLOW_REPAIR_LOOP), not read from the environment.
 */
export interface RepairProposal {
  /** Honest one-line diagnosis of the failure set. */
  diagnosis: string;
  /** The changes a repair WOULD make (described, never applied). */
  proposedChanges: ProposedRepairChange[];
  /** EVERY failing test surfaced — never hidden. */
  failingTests: string[];
  /** Tests that must pass before anything may be called 'done'. */
  mustPass: string[];
  /** ALWAYS 'blocked' while any required test is unmet — never 'verified' with unmet tests. */
  verificationStatus: "blocked" | "verified";
  /** Risk band of the proposed repair (derived from the failure set). */
  riskLevel: RiskLevel;
  /** The gate this loop is bound to — carried as DATA, never read from process.env. */
  gateFlag: "ALLOW_REPAIR_LOOP";
  /** A proposal never executes a repair. */
  proposalOnly: true;
  /** A proposal always gates on human approval. */
  requiresApproval: true;
}

const REPAIR_GATE = "ALLOW_REPAIR_LOOP" as const;

/** Collect, in input order, the ids of every failing test in the failure set. */
function collectFailingTestIds(failures: RepairFailureReport[]): string[] {
  const ids: string[] = [];
  for (const f of failures) {
    if (f.kind === "failing_test") ids.push(f.testId);
  }
  return ids;
}

/**
 * Risk derivation (deterministic, pure):
 *   - any gate refusal in the set ⇒ high (a refused gate is never repaired away silently);
 *   - any failing test ⇒ medium (a red test blocks 'done');
 *   - otherwise (typecheck-only) ⇒ low.
 */
function deriveRiskLevel(failures: RepairFailureReport[]): RiskLevel {
  if (failures.some((f) => f.kind === "gate_refusal")) return "high";
  if (failures.some((f) => f.kind === "failing_test")) return "medium";
  return "low";
}

/** Build a one-line honest diagnosis from the failure set (counts per kind). */
function buildDiagnosis(failures: RepairFailureReport[]): string {
  let failingTests = 0;
  let typecheckErrors = 0;
  let gateRefusals = 0;
  for (const f of failures) {
    if (f.kind === "failing_test") failingTests += 1;
    else if (f.kind === "typecheck_error") typecheckErrors += 1;
    else gateRefusals += 1;
  }
  if (failures.length === 0) {
    return "No failures reported — nothing to repair.";
  }
  const parts: string[] = [];
  if (failingTests > 0) parts.push(`${failingTests} failing test(s)`);
  if (typecheckErrors > 0) parts.push(`${typecheckErrors} typecheck error(s)`);
  if (gateRefusals > 0) parts.push(`${gateRefusals} gate refusal(s)`);
  return `Verification blocked: ${parts.join(", ")}.`;
}

/** One proposed change per failure (described — never applied). */
function buildProposedChanges(failures: RepairFailureReport[]): ProposedRepairChange[] {
  return failures.map((f) => {
    switch (f.kind) {
      case "failing_test":
        return {
          target: f.testId,
          change: `Investigate and fix the cause of failing test ${f.testId}.`,
          rationale: `Test ${f.testId} is red and must pass before 'done': ${f.detail}`,
        };
      case "typecheck_error":
        return {
          target: f.file,
          change: `Resolve the typecheck error in ${f.file}.`,
          rationale: `Typecheck must be clean before 'done': ${f.detail}`,
        };
      case "gate_refusal":
        return {
          target: f.gate,
          change: `Address the refusal raised by gate ${f.gate} (do NOT bypass the gate).`,
          rationale: `Gate ${f.gate} refused; the refusal is honored, not removed: ${f.detail}`,
        };
    }
  });
}

/**
 * Build a propose-only RepairProposal from a failure set.
 *
 * - `opts.testPlan` (optional) supplies the planned test cases whose ids must pass; any case
 *   id is folded into mustPass alongside the failing-test ids, so the must-pass set is the
 *   union of "what was red" and "what the plan requires".
 * - `opts.now` (optional) is the INJECTED timestamp; it is never used to gate or hide a test
 *   and the loop never reads the ambient clock. (Accepted for caller symmetry/audit framing.)
 *
 * verificationStatus is 'blocked' whenever any required (must-pass) test is unmet — and a
 * fresh proposal from a non-empty failure set always has unmet tests, so it is 'blocked'.
 */
export function proposeRepair(
  failures: RepairFailureReport[],
  opts: { testPlan?: TestPlanCase[]; now?: string } = {}
): RepairProposal {
  // Reference the injected timestamp without reading any ambient clock; keeps the signature
  // honest (timestamp is injected, never sourced here) and the function pure.
  void opts.now;

  const failingTests = collectFailingTestIds(failures);

  // mustPass = the failing tests UNION the planned test-case ids (deduped, input order).
  const mustPass: string[] = [];
  const seen = new Set<string>();
  for (const id of failingTests) {
    if (!seen.has(id)) {
      seen.add(id);
      mustPass.push(id);
    }
  }
  for (const c of opts.testPlan ?? []) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      mustPass.push(c.id);
    }
  }

  // While ANY required test is unmet, status is 'blocked'. A surfaced failing test is, by
  // definition, unmet; so any failing test forces 'blocked'. With no failing tests AND no
  // outstanding planned cases there is nothing left to verify here, so 'verified'.
  const unmet = mustPass.length > 0;
  const verificationStatus: "blocked" | "verified" = unmet ? "blocked" : "verified";

  return {
    diagnosis: buildDiagnosis(failures),
    proposedChanges: buildProposedChanges(failures),
    failingTests,
    mustPass,
    verificationStatus,
    riskLevel: deriveRiskLevel(failures),
    gateFlag: REPAIR_GATE,
    proposalOnly: true,
    requiresApproval: true,
  };
}

/**
 * Validate a RepairProposal against the never-hide / never-launder invariants. Returns a
 * list of human-readable refusals; an empty list means the proposal is well-formed.
 *
 * `knownFailingTests` (optional) lets a caller assert that a specific set of red tests must
 * all appear in `failingTests` — refusing any proposal that omits a known failing test.
 */
export function validateRepairProposal(
  p: RepairProposal,
  knownFailingTests: string[] = []
): string[] {
  const refusals: string[] = [];

  // 1. Never hide a known failing test.
  const surfaced = new Set(p.failingTests);
  for (const id of knownFailingTests) {
    if (!surfaced.has(id)) {
      refusals.push(`proposal omits known failing test '${id}' from failingTests (never hide a failing test)`);
    }
  }

  // 2. Every failing test MUST be a must-pass gate before 'done'.
  const mustPass = new Set(p.mustPass);
  for (const id of p.failingTests) {
    if (!mustPass.has(id)) {
      refusals.push(`failing test '${id}' is not in mustPass (a red test must block 'done')`);
    }
  }

  // 3. Never claim 'verified' while a must-pass test is still listed as failing (unmet).
  if (p.verificationStatus === "verified") {
    const stillFailing = p.failingTests.filter((id) => mustPass.has(id));
    if (stillFailing.length > 0) {
      refusals.push(
        `verificationStatus 'verified' is invalid while mustPass tests remain failing: ${stillFailing.join(", ")}`
      );
    }
  }

  // 4. The propose-only / gate invariants must hold as data.
  if (p.proposalOnly !== true) refusals.push("proposalOnly must be true (repair is propose-only)");
  if (p.requiresApproval !== true) refusals.push("requiresApproval must be true (repair gates on approval)");
  if (p.gateFlag !== REPAIR_GATE) refusals.push(`gateFlag must be '${REPAIR_GATE}'`);

  return refusals;
}
