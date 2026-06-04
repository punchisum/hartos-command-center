/**
 * src/read-models/read-model-types.ts
 *
 * Types for read-only real-data integration (Phase 11I). Read models surface
 * real structured data ONLY through explicitly configured, read-only Supabase
 * boundaries. Disabled by default. No mutation methods exist anywhere in this
 * subsystem.
 */

export type ReadModelType = "ops" | "fitness" | "other";
export type ReadModelMode = "supabase_readonly";
export type ReadModelStatus = "ok" | "degraded" | "missing" | "unconfigured" | "disabled" | "error";
export type ReadModelConfidence = "low" | "medium" | "high";

/** Operations that must NEVER be supported by the read client. */
export const FORBIDDEN_OPERATIONS = ["insert", "update", "delete", "upsert", "rpc_mutation"] as const;
export type ForbiddenOperation = (typeof FORBIDDEN_OPERATIONS)[number];

/**
 * Phase 13.6 — precise status for an RPC-backed read-model (Fitness). These map
 * the read-only RPC outcome so the cockpit can show the exact next setup step.
 * Never carries a secret value.
 */
export type FitnessRpcStatus =
  | "rpc_configured"
  | "rpc_live"
  | "rpc_missing_env"
  | "rpc_unavailable"
  | "rpc_forbidden"
  | "rpc_no_rows"
  | "rpc_shape_mismatch";

/** One read-model entry from read-models.local.json. */
export interface ReadModelConfig {
  id: string;
  type: ReadModelType;
  enabled: boolean;
  mode: ReadModelMode;
  supabaseUrlEnv: string;
  supabaseKeyEnv: string;
  allowedTables: string[];
  allowedRpcs: string[];
  forbiddenOperations: ForbiddenOperation[];
  /**
   * Phase 13.6 — optional env var NAMES (never values) holding the user / agent
   * id passed as read-only RPC args (e.g. p_user_id / p_agent_id). Default to
   * HARTOS_USER_ID / HARTOS_AGENT_ID when omitted. These are ids, not secrets,
   * and are still only ever referenced by name here.
   */
  rpcUserIdEnv?: string;
  rpcAgentIdEnv?: string;
}

export interface ReadModelsFile {
  readModels: ReadModelConfig[];
}

/** Non-secret resolved view of a read-model entry's availability. */
export interface ReadModelAvailability {
  id: string;
  type: ReadModelType;
  enabled: boolean;
  /** True when both env vars resolve to non-empty values. */
  envPresent: boolean;
  /** Names of the env vars that are missing (never the values). */
  missingEnv: string[];
  allowedTables: string[];
  allowedRpcs: string[];
  forbiddenOperations: ForbiddenOperation[];
}

export interface ReadModelSummary {
  id: string;
  type: ReadModelType;
  status: ReadModelStatus;
  confidence: ReadModelConfidence;
  /** Human-readable summary lines. Never contains secrets. */
  lines: string[];
  metrics: Record<string, string | number>;
  recommendation: string;
  dataFreshness: string | null;
  degradedSources: string[];
  /**
   * Phase 13.6 — when this summary was produced through read-only RPCs (Fitness),
   * the precise RPC outcome. Undefined for table-backed summaries.
   */
  rpcStatus?: FitnessRpcStatus;
}

export interface ReadModelRegistrySummary {
  generatedAt: string;
  configPresent: boolean;
  configPath: string | null;
  configuredReadModels: number;
  enabledReadModels: number;
  availability: ReadModelAvailability[];
  summaries: ReadModelSummary[];
  missingEnv: string[];
  nextRecommendedCommand: string;
}
