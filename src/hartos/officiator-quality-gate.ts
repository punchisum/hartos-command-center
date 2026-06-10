/**
 * src/hartos/officiator-quality-gate.ts — the Officiator QUALITY GATE.
 *
 * Officiation (agents/officiation.ts) proves the CONTRACT is well-formed + doctrine-bound.
 * validateManifest (manifest-compiler.ts) proves the manifest is STRUCTURALLY valid. This gate
 * composes those with the QUALITY criteria that decide whether a born agent is admissible to the
 * live fleet — tests, observability, an enforced boundary, a real definition of done, an honest
 * failure mode, risk/approval posture, and NON-DUPLICATION vs the existing fleet — into one
 * verdict: ADMIT / REVISE / REJECT, with a per-facet scorecard.
 *
 * Doctrine parallel to Wolverine: automatic SCORING; admitting the agent to the live fleet is
 * still Hart-approved (the factory-officiator emits a gated persist proposal, never a live write).
 * Pure + deterministic; the officiation result is injected so this is testable without fixtures.
 */

import type { AgentContract } from "../agents/agent-contract.js";
import type { AgentManifest } from "./manifest-types.js";

export type QualityRating = "ADMIT" | "REVISE" | "REJECT";

export interface QualityFacet {
  facet: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface AgentQualityVerdict {
  rating: QualityRating;
  /** 0–100 (pass=1, warn=0.5, fail=0, averaged). */
  score: number;
  /** True iff rating === "ADMIT". */
  admit: boolean;
  facets: QualityFacet[];
  summary: string;
}

const FACET_SCORE: Record<QualityFacet["status"], number> = { pass: 1, warn: 0.5, fail: 0 };

/** The officiation outcome the caller computed (officiateAgent), injected for testability. */
export interface OfficiationInput {
  officiated: boolean;
  violations: string[];
}

export function assessAgentQuality(
  manifest: AgentManifest,
  officiation: OfficiationInput,
  existingFleet: AgentContract[] = [],
): AgentQualityVerdict {
  const f: QualityFacet[] = [];

  // 1. Officiation — the contract must be officiable (identity, propose-only vocab, doctrine binding).
  f.push(
    officiation.officiated
      ? { facet: "officiation", status: "pass", detail: "contract officiable (identity, propose-only vocab, doctrine binding)" }
      : { facet: "officiation", status: "fail", detail: `contract not officiable: ${officiation.violations.join("; ") || "violations present"}` },
  );

  // 2. Tests — a born agent must ship a hermetic test surface covering its acceptance criteria.
  const cases = manifest.testPlan?.cases ?? [];
  const nonHermetic = cases.filter((c) => !c.hermetic).length;
  if (cases.length === 0) f.push({ facet: "tests", status: "fail", detail: "no test cases — a born agent must ship a test surface" });
  else if (nonHermetic > 0) f.push({ facet: "tests", status: "warn", detail: `${nonHermetic} non-hermetic test case(s) — born tests must be hermetic` });
  else f.push({ facet: "tests", status: "pass", detail: `${cases.length} hermetic test case(s)` });

  // 3. Observability — a read-model so the agent is monitorable (the monitoring archetype).
  f.push(
    manifest.readModel?.type
      ? { facet: "observability", status: "pass", detail: `read-model '${manifest.readModel.type}' — agent is monitorable` }
      : { facet: "observability", status: "fail", detail: "no read-model — the agent would be unobservable" },
  );

  // 4. Boundary — no enforced boundary means no job (per the spec contract).
  const boundary = manifest.jobLifecycle?.boundary as unknown;
  const hasBoundary = !!boundary && typeof boundary === "object" && Object.keys(boundary as object).length > 0;
  f.push(
    hasBoundary
      ? { facet: "boundary", status: "pass", detail: "job boundary declared + enforced" }
      : { facet: "boundary", status: "fail", detail: "no job boundary — no boundaries = no job" },
  );

  // 5. Acceptance criteria — a real definition of done.
  const ac = manifest.spec?.acceptanceCriteria ?? [];
  f.push(
    ac.length > 0
      ? { facet: "acceptance", status: "pass", detail: `${ac.length} acceptance criterion(s)` }
      : { facet: "acceptance", status: "fail", detail: "no acceptance criteria — no definition of done" },
  );

  // 6. Failure mode — honesty floor: how it fails must be declared.
  f.push(
    manifest.spec?.failureMode?.trim()
      ? { facet: "failure_mode", status: "pass", detail: "honest failure mode declared" }
      : { facet: "failure_mode", status: "warn", detail: "no failure mode declared (honesty floor)" },
  );

  // 7. Doctrine binding present.
  f.push(
    (manifest.doctrine?.clauses?.length ?? 0) > 0
      ? { facet: "doctrine", status: "pass", detail: `bound to ${manifest.doctrine.clauses.length} doctrine clause(s)` }
      : { facet: "doctrine", status: "warn", detail: "no doctrine clauses bound" },
  );

  // 8. Risk/approval posture — a high-risk agent must gate on approval.
  f.push(
    manifest.spec?.riskLevel === "high" && !manifest.spec?.approvalRequired
      ? { facet: "risk_gate", status: "warn", detail: "high-risk agent without approvalRequired — should gate on human approval" }
      : { facet: "risk_gate", status: "pass", detail: "risk/approval posture consistent" },
  );

  // 9. Uniqueness — not a duplicate of an existing fleet agent.
  const dupType = existingFleet.some((c) => c.type === manifest.contract.type);
  const dupReadModel = !dupType && existingFleet.some((c) => c.readModelId && c.readModelId === manifest.contract.readModelId);
  if (dupType) f.push({ facet: "uniqueness", status: "fail", detail: `an agent of type '${manifest.contract.type}' already exists (duplicate)` });
  else if (dupReadModel) f.push({ facet: "uniqueness", status: "warn", detail: `read-model '${manifest.contract.readModelId}' overlaps an existing agent` });
  else f.push({ facet: "uniqueness", status: "pass", detail: "no duplicate type / read-model in the fleet" });

  const score = Math.round((f.reduce((s, x) => s + FACET_SCORE[x.status], 0) / f.length) * 100);
  const fails = f.filter((x) => x.status === "fail").length;
  const warns = f.filter((x) => x.status === "warn").length;
  const rating: QualityRating = fails > 0 ? "REJECT" : warns > 0 ? "REVISE" : "ADMIT";
  const summary =
    rating === "ADMIT"
      ? `ADMIT — all ${f.length} quality facets pass (score ${score}).`
      : rating === "REVISE"
        ? `REVISE — ${warns} warning(s), no hard failures (score ${score}). Address before admitting.`
        : `REJECT — ${fails} hard failure(s) (score ${score}). Not admissible until fixed.`;

  return { rating, score, admit: rating === "ADMIT", facets: f, summary };
}
