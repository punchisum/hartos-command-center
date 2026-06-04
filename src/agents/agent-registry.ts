/**
 * src/agents/agent-registry.ts
 *
 * Config-first agent registry. Reads agent-integrations.local.json (gitignored,
 * local-only) if present. If missing/invalid, the cockpit still works and every
 * agent renders as "unconfigured". No external calls, no mutation.
 */

import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import type {
  AgentIntegrationConfig,
  AgentIntegrationsFile,
  AgentType,
} from "./agent-types.js";

export const LOCAL_CONFIG_FILE = "agent-integrations.local.json";
export const EXAMPLE_CONFIG_FILE = "agent-integrations.example.json";

const VALID_TYPES: AgentType[] = ["ops", "fitness", "other"];

function coerceAgent(raw: unknown): AgentIntegrationConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || typeof r["name"] !== "string") return null;
  const type = (VALID_TYPES as string[]).includes(r["type"] as string) ? (r["type"] as AgentType) : "other";
  const config: AgentIntegrationConfig = {
    id: r["id"],
    name: r["name"],
    type,
    enabled: r["enabled"] === true,
  };
  if (typeof r["repoPath"] === "string") config.repoPath = r["repoPath"];
  if (typeof r["reportsPath"] === "string") config.reportsPath = r["reportsPath"];
  if (typeof r["handoverPath"] === "string") config.handoverPath = r["handoverPath"];
  config.readModel = { mode: "local_files" };
  return config;
}

export interface LoadedAgentRegistry {
  configPresent: boolean;
  configPath: string | null;
  agents: AgentIntegrationConfig[];
}

/** Load the local agent registry. Never throws; degrades to empty. */
export async function loadAgentRegistry(cwd: string = process.cwd()): Promise<LoadedAgentRegistry> {
  const configPath = path.join(cwd, LOCAL_CONFIG_FILE);
  if (!existsSync(configPath)) {
    return { configPresent: false, configPath: null, agents: [] };
  }
  try {
    const text = await readFile(configPath, "utf8");
    const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // tolerate UTF-8 BOM
    const parsed = JSON.parse(raw) as Partial<AgentIntegrationsFile>;
    const list = Array.isArray(parsed.agents) ? parsed.agents : [];
    const agents = list.map(coerceAgent).filter((a): a is AgentIntegrationConfig => a !== null);
    return { configPresent: true, configPath, agents };
  } catch {
    // Present but invalid → treat as present-but-empty (safe degrade).
    return { configPresent: true, configPath, agents: [] };
  }
}

// ─── Read-only local-file helpers (shared by adapters) ──────────────────────
// All helpers READ local paths only. They never call out and never mutate.

function resolveUnder(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(cwd, p);
}

/** True when the configured repoPath looks like a real directory. */
export function detectRepo(cwd: string, repoPath?: string): boolean {
  if (!repoPath) return false;
  try {
    return statSync(resolveUnder(cwd, repoPath)).isDirectory();
  } catch {
    return false;
  }
}

/** Read the first non-empty lines of a handover doc, if present. Read-only. */
export async function summarizeHandover(cwd: string, handoverPath?: string, maxLines = 5): Promise<string | null> {
  if (!handoverPath) return null;
  const full = resolveUnder(cwd, handoverPath);
  if (!existsSync(full)) return null;
  try {
    const text = await readFile(full, "utf8");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, maxLines);
    return lines.join(" ").slice(0, 500);
  } catch {
    return null;
  }
}

/** List recent report files (relative to cwd) under a reports dir. Read-only. */
export async function listAgentReports(cwd: string, reportsPath?: string, limit = 10): Promise<string[]> {
  if (!reportsPath) return [];
  const full = resolveUnder(cwd, reportsPath);
  if (!existsSync(full)) return [];
  try {
    const entries = await readdir(full);
    return entries
      .filter((f) => f.endsWith(".md") || f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => path.relative(cwd, path.join(full, f)));
  } catch {
    return [];
  }
}

/** Most recent modified ISO timestamp across configured paths, if available. */
export async function recentActivity(cwd: string, paths: Array<string | undefined>): Promise<string | null> {
  let newest = 0;
  for (const p of paths) {
    if (!p) continue;
    const full = resolveUnder(cwd, p);
    if (!existsSync(full)) continue;
    try {
      const s = await stat(full);
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch {
      /* ignore */
    }
  }
  return newest > 0 ? new Date(newest).toISOString() : null;
}
