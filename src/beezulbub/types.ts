/**
 * src/beezulbub/types.ts
 *
 * Beezulbub: HartOS Open-Source Capability Absorption Engine
 *
 * Doctrine: Absorb ability. Reject poison. Standardise to HartOS. Evolve pack later.
 *
 * Phase 11A: Analysis and planning only.
 * No pack generation. No third-party code copied automatically.
 */

// Canonical license risk band lives in license-check.ts; imported so it can be
// used below and re-exported from this type barrel (single source of truth).
import type { LicenseRisk } from "./license-check.js";

// ─── Verdicts ─────────────────────────────────────────────────────────────────

export type BeezulbubVerdict =
  | "DEVOUR"          // High value, clean, safe to absorb
  | "PARTIAL_DEVOUR"  // Valuable capabilities exist but some must be rejected
  | "REFERENCE_ONLY"  // Study but do not copy code
  | "REJECT_POISON"   // Security/safety issues outweigh value
  | "REJECT_LICENSE"  // License incompatible or too risky
  | "REJECT_STALE"    // Unmaintained/abandoned
  | "REJECT_LOW_VALUE"; // Not worth the effort

// ─── Scoring ──────────────────────────────────────────────────────────────────

export type BeezulbubScore = {
  capabilityValue: number;       // 0-10: how useful are the capabilities?
  licenseSafety: number;         // 0-10: how safe is the license?
  maintenanceHealth: number;     // 0-10: how well-maintained?
  securityRisk: number;          // 0-10: higher = worse (inverted for overall)
  dependencyRisk: number;        // 0-10: higher = worse (inverted for overall)
  hartosCompatibility: number;   // 0-10: how compatible with HartOS patterns?
  extractionDifficulty: number;  // 0-10: higher = harder to extract
  overall: number;               // 0-10: weighted composite
};

// ─── Poison flags ────────────────────────────────────────────────────────────

export type PoisonSeverity = "low" | "medium" | "high" | "critical";

export type PoisonFlag = {
  type: string;
  severity: PoisonSeverity;
  description: string;
  location?: string;
  recommendation: string;
};

// ─── Capabilities ─────────────────────────────────────────────────────────────

export type ExtractableCapability = {
  id: string;
  name: string;
  description: string;
  files?: string[];
  absorb: string[];
  reject: string[];
  hartosPackTarget: string;
  requiredTests: string[];
  requiredEnvVars: string[];
  requiredProviderAdapters: string[];
  requiredDbChanges: string[];
  securityNotes: string[];
  estimatedEffort: "low" | "medium" | "high";
};

// ─── Adaptation plan ─────────────────────────────────────────────────────────

export type HartOSAdaptationPlan = {
  absorb: string[];
  reject: string[];
  adaptSteps: string[];
  targetPack: string;
  requiredTests: string[];
  requiredEnvVars: string[];
  requiredProviderAdapters: string[];
  requiredDbChanges: string[];
  requiredSmokeChecks: string[];
  securityNotes: string[];
};

// ─── Repo digest ──────────────────────────────────────────────────────────────

export type RepoDigest = {
  repoName: string;
  sourceUrl?: string;
  localPath?: string;
  digestedAt: string;
  detectedStack: string[];
  license?: string;
  licenseRisk: "safe" | "review" | "risky" | "unknown";
  packageManagers: string[];
  frameworks: string[];
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
  testPresence: "none" | "minimal" | "present";
  envHandling: "none" | "basic" | "safe" | "unsafe";
  authModel?: string;
  deploymentModel?: string;
  usefulCapabilities: ExtractableCapability[];
  poisonFlags: PoisonFlag[];
  score: BeezulbubScore;
  recommendedVerdict: BeezulbubVerdict;
  hartosAdaptationPlan: HartOSAdaptationPlan;
  summary: string;
};

// ─── Scout ────────────────────────────────────────────────────────────────────

export type ScoutCandidate = {
  name: string;
  sourceUrl?: string;
  localPath?: string;
  targetCapability: string;
  reason: string;
  estimatedValue: number; // 0-10
  licenseGuess?: string;
  staleRisk: "low" | "medium" | "high";
  notes: string;
};

export type BeezulbubScoutResult = {
  target: string;
  candidates: ScoutCandidate[];
  timestamp: string;
  mode: "fixture" | "live" | "manual";
  recommendation: string;
};

// ─── Options ──────────────────────────────────────────────────────────────────

export type DigestOptions = {
  localPath: string;
  targetCapability?: string;
  fetchImpl?: typeof fetch; // for future live URL digestion
};

export type ScoutOptions = {
  target: string;
  candidatesPath?: string; // JSON file of candidates
  localOnly?: boolean;
  live?: boolean;          // Phase 11B: use live GitHub search
  limit?: number;          // Phase 11B: max live candidates
  githubToken?: string;    // Phase 11B: GitHub API token (never logged)
  fetchImpl?: typeof fetch; // Phase 11B: injectable for testing
};

// ─── Phase 11B: GitHub metadata ───────────────────────────────────────────────

export type GitHubRepoMetadata = {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  pushedAt: string;
  language: string | null;
  license: string | null;
  topics: string[];
  relevanceScore: number; // 0-10
};

// ─── Phase 11B: Batch digest ─────────────────────────────────────────────────

export type BatchRepo = {
  name: string;
  localPath?: string;
  sourceUrl?: string;
};

export type BatchConfig = {
  target: string;
  repos: BatchRepo[];
};

export type BatchDigestResultEntry = {
  repo: BatchRepo;
  digest?: RepoDigest;
  error?: string;
  status: "digested" | "failed" | "skipped";
};

export type BatchDigestResult = {
  target: string;
  timestamp: string;
  status: "completed" | "partial" | "failed";
  results: BatchDigestResultEntry[];
  ranking: Array<{ name: string; verdict: BeezulbubVerdict; overall: number }>;
  topCandidate: string | null;
  recommendation: string;
};

// ─── Phase 11B: Comparison ────────────────────────────────────────────────────

export type ComparisonReport = {
  timestamp: string;
  source: string;
  candidates: Array<{
    name: string;
    verdict: BeezulbubVerdict;
    overall: number;
    licenseSafety: number;
    securityRisk: number;
    hartosCompatibility: number;
    capabilityValue: number;
    poisonCount: number;
  }>;
  topCandidate: string | null;
  bestCapabilityMatch: string | null;
  cleanestLicense: string | null;
  lowestPoison: string | null;
  bestHartosCompat: string | null;
  recommendedVerdict: string;
  nextAction: string;
  summary: string;
};

// ─── Unified Capability Report (plan §5) ──────────────────────────────────────
//
// The single unifying artifact Beezulbub returns to the Factory Agent. It
// COMPOSES the existing module types (it does NOT redefine their shapes):
//   - candidateSources       → ScoutCandidate[]      (scout.ts/live-scout.ts/github-search.ts)
//   - acceptedPatterns        → ExtractableCapability[] (capability-extractor.ts)
//   - rejectedPatterns        → RejectedPattern[]     (poison-filter.ts + license-check.ts)
//   - recommendedAdaptations  → HartOSAdaptationPlan[] (adaptation-plan.ts)
//   - overallScore            → BeezulbubScore        (score.ts, 7-dim)
//
// Doctrine: Beezulbub evaluates, ranks, and proposes; it NEVER blindly copies.
// Every report is advisory only — folding patterns into a build plan requires
// Hart's approval. The serializer (capability-report.ts) MUST secret-scan the
// rendered output before returning it (no secrets ever leave Beezulbub).

/** A doctrine-risk catalog entry — why a candidate/pattern weakens HartOS doctrine. */
export type DoctrineRisk = {
  /** Stable risk code, e.g. "AUTONOMY_ENCOURAGING", "CONFIDENCE_LAUNDERING". */
  code: string;
  severity: PoisonSeverity;
  description: string;
  /** Which candidate/capability/source this risk attaches to. */
  relatedTo?: string;
  recommendation: string;
};

/** A dependency the candidate pulls in, with an absorption risk note. */
export type DependencyRisk = {
  name: string;
  /** Where it came from, e.g. repo name or "transitive". */
  source?: string;
  risk: "low" | "medium" | "high" | "unknown";
  reason: string;
};

/** A rejected pattern with the reason it was rejected (poison or license). */
export type RejectedPattern = {
  /** Capability id or pattern name being rejected. */
  id: string;
  name: string;
  reason: "poison" | "license" | "stale" | "doctrine" | "low_value" | "over_engineered";
  detail: string;
  /** Source poison flags, if rejection was poison-driven. */
  poisonFlags?: PoisonFlag[];
  /** License classification, if rejection was license-driven. */
  licenseRisk?: LicenseRisk;
};

/** Operational license risk band — re-exported from the canonical license-check.ts definition. */
export type { LicenseRisk };

/** A license observation for a candidate source. */
export type LicenseNote = {
  source: string;
  license: string | null;
  risk: LicenseRisk;
  canDevour: boolean;
  notes: string;
};

/** A security observation, grounded in poison-filter findings. */
export type SecurityNote = {
  source: string;
  severity: PoisonSeverity;
  description: string;
  recommendation: string;
};

/** A proposed change to the Factory build plan (advisory — needs Hart approval). */
export type ProposedBuildPlanChange = {
  /** What kind of change: a pattern to add, a step to insert, a dep to vet, etc. */
  kind: "add_pattern" | "insert_step" | "vet_dependency" | "add_test" | "add_adapter" | "note";
  description: string;
  /** Capability/source this change derives from. */
  derivedFrom?: string;
  /** Always requires explicit approval — never auto-applied. */
  requiresApproval: true;
};

/** A cited external source studied during scouting. */
export type SourceLink = {
  label: string;
  url: string | null;
  /** Exact files worth studying (never auto-imported). */
  files?: string[];
};

/** An append-only audit step recording how the report was produced. */
export type ReportAuditStep = {
  at: string;
  stage:
    | "scout"
    | "evaluate"
    | "extract"
    | "reject"
    | "recommend"
    | "license_check"
    | "security_scan"
    | "serialize";
  detail: string;
};

/**
 * BeezulbubCapabilityReport — the unifying capability-scout artifact (plan §5).
 *
 * Confidence semantics (plan §19): the report's `confidence` MUST be
 * <= min(input confidences). Beezulbub may never launder confidence upward —
 * an aggregate is never more certain than its least-certain input. The
 * serializer enforces this via clamping; the field is documented here as the
 * authoritative contract.
 */
export type BeezulbubCapabilityReport = {
  /** Stable id for this report (e.g. `bz-report-<agentSpecId>-<ts>`). */
  reportId: string;
  /** The AgentSpec this scout run serves (string id, matches Factory specId). */
  agentSpecId: string;
  /** What was searched: target capability + mode + any scope notes. */
  searchScope: {
    target: string;
    mode: "fixture" | "live" | "manual";
    notes?: string;
  };
  /** Candidate repos found by the scout (composed, not redefined). */
  candidateSources: ScoutCandidate[];
  /** Patterns accepted for study/adaptation (composed ExtractableCapability). */
  acceptedPatterns: ExtractableCapability[];
  /** Patterns explicitly rejected, with the reason. */
  rejectedPatterns: RejectedPattern[];
  /** License observations per source. */
  licenseNotes: LicenseNote[];
  /** Security observations, grounded in poison-filter findings. */
  securityNotes: SecurityNote[];
  /** Dependency-absorption risks. */
  dependencyRisks: DependencyRisk[];
  /** Doctrine-weakening risks (formal catalog). */
  doctrineRisks: DoctrineRisk[];
  /** Recommended HartOS adaptation plans (composed, not redefined). */
  recommendedAdaptations: HartOSAdaptationPlan[];
  /** Hard "do not use" list — sources/patterns Beezulbub forbids. */
  doNotUseList: string[];
  /**
   * Overall confidence in this report, 0-1.
   * INVARIANT (plan §19): <= min of every input confidence. Never laundered up.
   */
  confidence: number;
  /** Honest unknowns / unresolved questions. */
  unknowns: string[];
  /** Advisory build-plan changes — each requires Hart approval. */
  proposedBuildPlanChanges: ProposedBuildPlanChange[];
  /** Cited source links + exact files to study. */
  sourceLinks: SourceLink[];
  /** Append-only audit trail of how the report was produced. */
  auditTrail: ReportAuditStep[];
  /** Optional overall 7-dim score for the recommended top candidate. */
  overallScore?: BeezulbubScore;
  /** When the report was assembled. */
  generatedAt: string;
};
