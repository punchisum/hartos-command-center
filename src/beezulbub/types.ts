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
