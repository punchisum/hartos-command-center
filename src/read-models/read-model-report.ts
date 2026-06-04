/**
 * src/read-models/read-model-report.ts
 *
 * Builds the whole-registry read-model summary and writes safe reports under
 * read-model-reports/. A live Supabase read happens ONLY when a read model is
 * both enabled AND its env is present; otherwise summaries are disabled/missing
 * and no network call occurs. A client factory may be injected for tests.
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  ReadModelConfig,
  ReadModelRegistrySummary,
  ReadModelSummary,
} from "./read-model-types.js";
import {
  isReadModelLive,
  loadReadModelRegistry,
  resolveAvailability,
} from "./read-model-registry.js";
import { SupabaseReadClient } from "./supabase-read-client.js";
import { buildOpsReadModelSummary } from "./ops-read-model.js";
import { buildFitnessReadModelSummary } from "./fitness-read-model.js";
import { containsSecret } from "../llm/redaction.js";
import { isServiceRoleKey } from "../cockpit/sources/secret-guard.js";

export const DEFAULT_READ_MODEL_REPORTS_DIR = "read-model-reports";

type Env = Record<string, string | undefined>;
export type ClientFactory = (config: ReadModelConfig, env: Env) => SupabaseReadClient | undefined;

function defaultClientFactory(config: ReadModelConfig, env: Env): SupabaseReadClient | undefined {
  const url = env[config.supabaseUrlEnv];
  const key = env[config.supabaseKeyEnv];
  if (!url || !key) return undefined;
  // Phase 13 — refuse service-role keys for the read-only cockpit boundary.
  if (isServiceRoleKey(key)) return undefined;
  return new SupabaseReadClient({
    url,
    key,
    allowedTables: config.allowedTables,
    allowedRpcs: config.allowedRpcs,
  });
}

/** Exposed for tests — verifies the service-role guard rejects unsafe keys. */
export const defaultClientFactoryForTest = defaultClientFactory;

export interface ReadModelRegistryOptions {
  cwd?: string;
  env?: Env;
  /** Inject a client factory (tests). Defaults to a real read-only client. */
  clientFactory?: ClientFactory;
}

export async function buildReadModelRegistrySummary(
  options: ReadModelRegistryOptions = {}
): Promise<ReadModelRegistrySummary> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  const now = new Date();

  const registry = await loadReadModelRegistry(cwd);
  const availability = registry.readModels.map((c) => resolveAvailability(c, env));
  const summaries: ReadModelSummary[] = [];

  for (let i = 0; i < registry.readModels.length; i += 1) {
    const config = registry.readModels[i]!;
    const avail = availability[i]!;
    const live = isReadModelLive(avail);
    const client = live ? clientFactory(config, env) : undefined;
    if (config.type === "fitness") {
      // Phase 13.6 — resolve read-only RPC arg ids by env NAME (never logged).
      const userIdEnv = config.rpcUserIdEnv ?? "HARTOS_USER_ID";
      const agentIdEnv = config.rpcAgentIdEnv ?? "HARTOS_AGENT_ID";
      const rpcArgs = { userId: env[userIdEnv], agentId: env[agentIdEnv], userIdEnv, agentIdEnv };
      summaries.push(await buildFitnessReadModelSummary(config, avail, client, rpcArgs));
    } else {
      summaries.push(await buildOpsReadModelSummary(config, avail, client));
    }
  }

  const enabledReadModels = registry.readModels.filter((c) => c.enabled).length;
  const missingEnv = [...new Set(availability.flatMap((a) => (a.enabled ? a.missingEnv : [])))];
  const nextRecommendedCommand = !registry.configPresent
    ? "configure read-models.local.json (see read-models.example.json)"
    : "npm run read-models:status";

  return {
    generatedAt: now.toISOString(),
    configPresent: registry.configPresent,
    configPath: registry.configPath ? "read-models.local.json" : null,
    configuredReadModels: registry.readModels.length,
    enabledReadModels,
    availability,
    summaries,
    missingEnv,
    nextRecommendedCommand,
  };
}

export function renderReadModelReportMarkdown(summary: ReadModelRegistrySummary): string {
  const lines: string[] = [
    "# Read Model Status",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- config present: ${summary.configPresent}`,
    `- config path: ${summary.configPath ?? "(none — unconfigured)"}`,
    `- configured read models: ${summary.configuredReadModels}`,
    `- enabled read models: ${summary.enabledReadModels}`,
    `- next recommended command: ${summary.nextRecommendedCommand}`,
    "",
    "## Availability",
    "",
  ];
  if (summary.availability.length === 0) {
    lines.push("_No read models configured. See read-models.example.json._", "");
  }
  for (const a of summary.availability) {
    lines.push(
      `### ${a.id} (${a.type})`,
      `- enabled: ${a.enabled}`,
      `- env present: ${a.envPresent}${a.missingEnv.length ? ` (missing: ${a.missingEnv.join(", ")})` : ""}`,
      `- allowed tables: ${a.allowedTables.join(", ") || "none"}`,
      `- allowed rpcs: ${a.allowedRpcs.join(", ") || "none"}`,
      `- forbidden operations: ${a.forbiddenOperations.join(", ")}`,
      ""
    );
  }
  lines.push("## Summaries", "");
  for (const s of summary.summaries) {
    lines.push(`### ${s.id} (${s.type}) — ${s.status}`);
    for (const l of s.lines) lines.push(`- ${l}`);
    if (s.dataFreshness) lines.push(`- data freshness: ${s.dataFreshness}`);
    lines.push("");
  }
  lines.push("_Read-only Supabase boundary. The read client exposes no insert/update/delete/upsert and no mutation RPC._", "");
  return lines.join("\n");
}

export async function writeReadModelReport(
  reportsDir: string,
  summary: ReadModelRegistrySummary
): Promise<{ mdPath: string; jsonPath: string }> {
  const md = renderReadModelReportMarkdown(summary);
  const json = JSON.stringify(summary, null, 2);
  if (containsSecret(md) || containsSecret(json)) {
    throw new Error("Refusing to write read-model report: secret-looking content detected.");
  }
  await mkdir(reportsDir, { recursive: true });
  const stamp = summary.generatedAt.replace(/[:.]/g, "-");
  const mdPath = path.join(reportsDir, `read-model-status-${stamp}.md`);
  const jsonPath = path.join(reportsDir, `read-model-status-${stamp}.json`);
  await writeFile(mdPath, md, "utf8");
  await writeFile(jsonPath, json, "utf8");
  return { mdPath, jsonPath };
}
