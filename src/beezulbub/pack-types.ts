/**
 * src/beezulbub/pack-types.ts
 *
 * Types for Beezulbub Adaptive Pack Skeleton Generation (Phase 11C).
 *
 * Doctrine: Generate skeleton. Do not copy architecture. Do not copy code blindly.
 * Packs are HartOS-shaped stubs — not third-party code transplants.
 */

// ─── Pack status (Phase 11D extended lifecycle) ───────────────────────────────

export type PackStatus =
  | "candidate"          // Identified as a candidate
  | "planned"            // Pack plan created
  | "skeleton"           // Generated stub — needs implementation
  | "reference_only"     // For study only — not implementation-ready
  | "implementation_draft" // Phase 11E: stubs/contracts generated
  | "verified"           // Local verification passed
  | "available"          // Safe for CTO/Orchestrator to compose
  | "deprecated"         // Do not use for new builds
  | "rejected"           // Blocked due to poison/license/low value
  | "blocked";           // Generation was blocked

// ─── Pack manifest ────────────────────────────────────────────────────────────

export interface PackManifest {
  packName: string;
  packVersion: string;
  status: PackStatus;
  source: {
    digestId?: string;
    repoName: string;
    sourceUrl: string | null;
    verdict: string;
    scoreOverall: number;
    license: string | null;
  };
  capabilities: string[];
  hartosCompatibility: {
    requiresSupabase: boolean;
    requiresTrigger: boolean;
    requiresCloudflare: boolean;
    requiresTelegram: boolean;
    requiresApprovalGate: boolean;
  };
  absorb: string[];
  reject: string[];
  requiredTests: string[];
  createdAt: string;
}

// ─── Pack generation options ──────────────────────────────────────────────────

export interface PackGenerateOptions {
  capability?: string;
  digestPath?: string;
  fromLatest?: boolean;
  approveDevour?: boolean;
  force?: boolean;
  allowPackGenerate?: boolean;  // from env BEEZULBUB_ALLOW_PACK_GENERATE
  referencePack?: boolean;      // for REFERENCE_ONLY verdict
  packOutputDir?: string;       // default: "packs"
}

// ─── Pack generation result ───────────────────────────────────────────────────

export type PackGenerateStatus =
  | "generated"
  | "blocked_missing_approval"
  | "blocked_bad_verdict"
  | "blocked_existing_pack"
  | "failed";

export interface PackGenerateResult {
  status: PackGenerateStatus;
  packPath?: string;
  packName?: string;
  message: string;
  manifest?: PackManifest;
}

// ─── Pack plan ────────────────────────────────────────────────────────────────

export interface PackPlanResult {
  packName: string;
  capability: string;
  sourceRepo: string;
  verdict: string;
  score: number;
  license: string | null;
  absorb: string[];
  reject: string[];
  risks: string[];
  structurePreview: string[];
  testsToGenerate: string[];
  nextCommand: string;
  reportPath?: string;
}

// ─── Pack list ────────────────────────────────────────────────────────────────

export interface PackListEntry {
  packName: string;
  version: string;
  status: PackStatus;
  capabilities: string[];
  verdict: string;
  score: number;
  createdAt: string;
  packPath: string;
}

// ─── Score JSON (from Phase 11B batch/digest) ────────────────────────────────

export interface ScoreJson {
  repoName?: string;
  digestedAt?: string;
  verdict?: string;
  score?: {
    overall?: number;
    licenseSafety?: number;
    capabilityValue?: number;
    hartosCompatibility?: number;
  };
  licenseRisk?: string;
  license?: string;
  poisonFlagCount?: number;
  capabilityCount?: number;
  capabilities?: string[];
  targetPack?: string;
  summary?: string;
  // from batch
  topCandidate?: string;
  ranking?: Array<{ name: string; verdict: string; overall: number }>;
}
