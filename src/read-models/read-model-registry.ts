/**
 * src/read-models/read-model-registry.ts
 *
 * Config-first read-model registry. Reads read-models.local.json (gitignored,
 * local-only) if present. Read models are DISABLED by default — a read requires
 * both enabled=true AND the configured env vars to resolve. Never exposes env
 * values; only reports presence. No network, no mutation.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type {
  ForbiddenOperation,
  ReadModelAvailability,
  ReadModelConfig,
  ReadModelsFile,
  ReadModelType,
} from "./read-model-types.js";
import { FORBIDDEN_OPERATIONS } from "./read-model-types.js";

export const LOCAL_CONFIG_FILE = "read-models.local.json";
export const EXAMPLE_CONFIG_FILE = "read-models.example.json";

const VALID_TYPES: ReadModelType[] = ["ops", "fitness", "other"];

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function coerce(raw: unknown): ReadModelConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string") return null;
  const type = (VALID_TYPES as string[]).includes(r["type"] as string) ? (r["type"] as ReadModelType) : "other";
  const forbidden = asStringArray(r["forbiddenOperations"]).filter((o): o is ForbiddenOperation =>
    (FORBIDDEN_OPERATIONS as readonly string[]).includes(o)
  );
  return {
    id: r["id"],
    type,
    enabled: r["enabled"] === true,
    mode: "supabase_readonly",
    supabaseUrlEnv: typeof r["supabaseUrlEnv"] === "string" ? r["supabaseUrlEnv"] : "",
    supabaseKeyEnv: typeof r["supabaseKeyEnv"] === "string" ? r["supabaseKeyEnv"] : "",
    allowedTables: asStringArray(r["allowedTables"]),
    allowedRpcs: asStringArray(r["allowedRpcs"]),
    forbiddenOperations: forbidden.length > 0 ? forbidden : [...FORBIDDEN_OPERATIONS],
    // Phase 13.6 — optional RPC arg env var NAMES (never values).
    ...(typeof r["rpcUserIdEnv"] === "string" ? { rpcUserIdEnv: r["rpcUserIdEnv"] } : {}),
    ...(typeof r["rpcAgentIdEnv"] === "string" ? { rpcAgentIdEnv: r["rpcAgentIdEnv"] } : {}),
  };
}

export interface LoadedReadModelRegistry {
  configPresent: boolean;
  configPath: string | null;
  readModels: ReadModelConfig[];
}

/** Load the local read-model registry. Never throws; degrades to empty. */
export async function loadReadModelRegistry(cwd: string = process.cwd()): Promise<LoadedReadModelRegistry> {
  const configPath = path.join(cwd, LOCAL_CONFIG_FILE);
  if (!existsSync(configPath)) {
    return { configPresent: false, configPath: null, readModels: [] };
  }
  try {
    const text = await readFile(configPath, "utf8");
    const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // tolerate UTF-8 BOM
    const parsed = JSON.parse(raw) as Partial<ReadModelsFile>;
    const list = Array.isArray(parsed.readModels) ? parsed.readModels : [];
    const readModels = list.map(coerce).filter((c): c is ReadModelConfig => c !== null);
    return { configPresent: true, configPath, readModels };
  } catch {
    return { configPresent: true, configPath, readModels: [] };
  }
}

/** Resolve availability (enabled + env presence) without exposing secrets. */
export function resolveAvailability(
  config: ReadModelConfig,
  env: Record<string, string | undefined> = process.env
): ReadModelAvailability {
  const missingEnv: string[] = [];
  const urlVal = config.supabaseUrlEnv ? env[config.supabaseUrlEnv] : undefined;
  const keyVal = config.supabaseKeyEnv ? env[config.supabaseKeyEnv] : undefined;
  if (!config.supabaseUrlEnv || !urlVal || urlVal.trim().length === 0) missingEnv.push(config.supabaseUrlEnv || "supabaseUrlEnv");
  if (!config.supabaseKeyEnv || !keyVal || keyVal.trim().length === 0) missingEnv.push(config.supabaseKeyEnv || "supabaseKeyEnv");
  return {
    id: config.id,
    type: config.type,
    enabled: config.enabled,
    envPresent: missingEnv.length === 0,
    missingEnv,
    allowedTables: config.allowedTables,
    allowedRpcs: config.allowedRpcs,
    forbiddenOperations: config.forbiddenOperations,
  };
}

/** A read model is "live" only when enabled AND its env is present. */
export function isReadModelLive(availability: ReadModelAvailability): boolean {
  return availability.enabled && availability.envPresent;
}
