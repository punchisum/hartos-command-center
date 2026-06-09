/**
 * src/beezulbub/capability-report.ts
 *
 * Build and serialize the unified BeezulbubCapabilityReport (plan §5).
 *
 * This module is a PURE transform: it composes the existing Beezulbub module
 * types into one report and renders a stable JSON string. It performs NO fs
 * writes and NO network calls in this slice — callers persist later, through
 * the existing secret-scanned reportsDir pattern (see report.ts).
 *
 * Doctrine:
 *   - Confidence is clamped to <= min(input confidences) (plan §19). Beezulbub
 *     never launders confidence upward.
 *   - Before returning the serialized string, the output is secret-scanned with
 *     the SAME helper used everywhere else (assertNoSecretsInBeezulbubReport).
 *     No secret-looking value ever leaves Beezulbub in a report.
 *   - The report is advisory only: proposedBuildPlanChanges always require
 *     Hart's approval (enforced at the type level via requiresApproval: true).
 */

import type {
  BeezulbubCapabilityReport,
  BeezulbubScore,
  DependencyRisk,
  DoctrineRisk,
  ExtractableCapability,
  HartOSAdaptationPlan,
  LicenseNote,
  ProposedBuildPlanChange,
  RejectedPattern,
  ReportAuditStep,
  ScoutCandidate,
  SecurityNote,
  SourceLink,
} from "./types.js";
import { assertNoSecretsInBeezulbubReport } from "./report.js";

/** Inputs to build a unified capability report. All arrays default to empty. */
export interface CapabilityReportInputs {
  agentSpecId: string;
  searchScope: BeezulbubCapabilityReport["searchScope"];
  candidateSources?: ScoutCandidate[];
  acceptedPatterns?: ExtractableCapability[];
  rejectedPatterns?: RejectedPattern[];
  licenseNotes?: LicenseNote[];
  securityNotes?: SecurityNote[];
  dependencyRisks?: DependencyRisk[];
  doctrineRisks?: DoctrineRisk[];
  recommendedAdaptations?: HartOSAdaptationPlan[];
  doNotUseList?: string[];
  unknowns?: string[];
  proposedBuildPlanChanges?: ProposedBuildPlanChange[];
  sourceLinks?: SourceLink[];
  auditTrail?: ReportAuditStep[];
  overallScore?: BeezulbubScore;
  /**
   * The confidences this report aggregates over (each 0-1). The report's
   * confidence is clamped to <= min of these (plan §19). If omitted/empty,
   * `baseConfidence` is used as-is (no upstream inputs to bound it).
   */
  inputConfidences?: number[];
  /** Beezulbub's own confidence before bounding (0-1). Defaults to 0.5. */
  baseConfidence?: number;
  /** Override report id; otherwise derived from agentSpecId + timestamp. */
  reportId?: string;
  /** Override generation timestamp (ISO). Defaults to now. */
  generatedAt?: string;
}

/** Clamp a value into [0, 1]. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Resolve the report confidence under the §19 invariant:
 *   confidence <= min(input confidences)
 * The base confidence is also bounded to [0,1]. With no inputs, the bound is
 * just the base confidence (clamped).
 */
export function resolveConfidence(
  baseConfidence: number,
  inputConfidences: number[] | undefined
): number {
  const base = clamp01(baseConfidence);
  if (!inputConfidences || inputConfidences.length === 0) return base;
  const minInput = inputConfidences.reduce(
    (acc, c) => Math.min(acc, clamp01(c)),
    1
  );
  return Math.min(base, minInput);
}

/**
 * Build a unified BeezulbubCapabilityReport from composed inputs.
 *
 * Pure: no I/O. The returned object references the composed input arrays
 * (defensively defaulting missing ones to empty). Confidence is bounded by
 * the §19 rule. An audit step for the build is appended (non-mutating).
 */
export function buildCapabilityReport(
  inputs: CapabilityReportInputs
): BeezulbubCapabilityReport {
  const generatedAt = inputs.generatedAt ?? new Date().toISOString();
  // Derive a deterministic id. Segments are joined with '.' (a char OUTSIDE the
  // secret-scan class [A-Za-z0-9_-]) so no single allowed-char run approaches
  // the scanner's 40-char heuristic — a derived id never false-positives as a
  // secret. Only ':' is normalized (filename-unsafe); the existing '.' in the
  // ISO millis already breaks the run.
  const tsSafe = generatedAt.replace(/:/g, ".");
  const reportId = inputs.reportId ?? `bz-report.${inputs.agentSpecId}.${tsSafe}`;

  const confidence = resolveConfidence(
    inputs.baseConfidence ?? 0.5,
    inputs.inputConfidences
  );

  const auditTrail: ReportAuditStep[] = [
    ...(inputs.auditTrail ?? []),
    {
      at: generatedAt,
      stage: "recommend",
      detail: `Assembled capability report for spec ${inputs.agentSpecId} (confidence ${confidence.toFixed(
        2
      )}, ${(inputs.candidateSources ?? []).length} candidate source(s)).`,
    },
  ];

  return {
    reportId,
    agentSpecId: inputs.agentSpecId,
    searchScope: inputs.searchScope,
    candidateSources: inputs.candidateSources ?? [],
    acceptedPatterns: inputs.acceptedPatterns ?? [],
    rejectedPatterns: inputs.rejectedPatterns ?? [],
    licenseNotes: inputs.licenseNotes ?? [],
    securityNotes: inputs.securityNotes ?? [],
    dependencyRisks: inputs.dependencyRisks ?? [],
    doctrineRisks: inputs.doctrineRisks ?? [],
    recommendedAdaptations: inputs.recommendedAdaptations ?? [],
    doNotUseList: inputs.doNotUseList ?? [],
    confidence,
    unknowns: inputs.unknowns ?? [],
    proposedBuildPlanChanges: inputs.proposedBuildPlanChanges ?? [],
    sourceLinks: inputs.sourceLinks ?? [],
    auditTrail,
    ...(inputs.overallScore ? { overallScore: inputs.overallScore } : {}),
    generatedAt,
  };
}

/**
 * Serialize a capability report to a stable JSON string.
 *
 * Stable: object keys are emitted in a fixed order so byte output is
 * deterministic across runs (useful for diffing / idempotency).
 *
 * Safety: the rendered string is secret-scanned with
 * assertNoSecretsInBeezulbubReport BEFORE it is returned. If a secret-looking
 * value is present anywhere in the report, serialization throws and no string
 * is returned.
 */
export function serializeCapabilityReport(
  report: BeezulbubCapabilityReport
): string {
  // Fixed key order → deterministic output.
  const ordered = {
    reportId: report.reportId,
    agentSpecId: report.agentSpecId,
    searchScope: report.searchScope,
    candidateSources: report.candidateSources,
    acceptedPatterns: report.acceptedPatterns,
    rejectedPatterns: report.rejectedPatterns,
    licenseNotes: report.licenseNotes,
    securityNotes: report.securityNotes,
    dependencyRisks: report.dependencyRisks,
    doctrineRisks: report.doctrineRisks,
    recommendedAdaptations: report.recommendedAdaptations,
    doNotUseList: report.doNotUseList,
    confidence: report.confidence,
    unknowns: report.unknowns,
    proposedBuildPlanChanges: report.proposedBuildPlanChanges,
    sourceLinks: report.sourceLinks,
    auditTrail: report.auditTrail,
    ...(report.overallScore ? { overallScore: report.overallScore } : {}),
    generatedAt: report.generatedAt,
  };

  const json = JSON.stringify(ordered, null, 2) + "\n";

  // Reuse the canonical secret-scan helper — no secrets leave Beezulbub.
  assertNoSecretsInBeezulbubReport(json);

  return json;
}
