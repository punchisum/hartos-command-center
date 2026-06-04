/**
 * src/cockpit/sources/index.ts
 *
 * Phase 13 — read-only source layer entry point. Resolves the fitness, ops, and
 * factory sources from the best available read-only boundary. All I/O is here
 * (and in the per-source resolvers); the panel builders stay pure.
 */

import type { AgentIntegrationConfig } from "../../agents/agent-types.js";
import type { ReadModelRegistrySummary } from "../../read-models/read-model-types.js";
import type { SourceResult } from "./source-types.js";
import { resolveFitnessSource } from "./fitness-source.js";
import { resolveOpsSource } from "./ops-source.js";
import { resolveFactorySource } from "./factory-source.js";

export * from "./source-types.js";
export * from "./freshness.js";
export { isServiceRoleKey, SERVICE_ROLE_REJECTION } from "./secret-guard.js";
export { findLatestReport, parseKeyValues, pick } from "./local-report-source.js";
export { readHandover } from "./handover-source.js";
export { supabaseSourceResult } from "./supabase-source.js";
export { deriveFitnessSource, resolveFitnessSource, FITNESS_FIELD_KEYS } from "./fitness-source.js";
export { deriveOpsSource, resolveOpsSource, OPS_FIELD_KEYS } from "./ops-source.js";
export { deriveFactorySource, resolveFactorySource, FACTORY_FIELD_KEYS } from "./factory-source.js";
export { buildSourceDiagnostics } from "./source-diagnostics.js";
export type { SourceDiagnosticsReport, DomainSourceDiag, DiagStatus } from "./source-diagnostics.js";

export interface ResolvedSources {
  fitness: SourceResult;
  ops: SourceResult;
  factory: SourceResult;
}

export interface ResolveSourcesOptions {
  cwd: string;
  now: string;
  readModels: ReadModelRegistrySummary;
  agentConfigs?: AgentIntegrationConfig[];
}

export async function resolveSources(options: ResolveSourcesOptions): Promise<ResolvedSources> {
  const fitnessRm = options.readModels.summaries.find((s) => s.type === "fitness");
  const opsRm = options.readModels.summaries.find((s) => s.type === "ops");
  const fitnessCfg = options.agentConfigs?.find((a) => a.type === "fitness");
  const opsCfg = options.agentConfigs?.find((a) => a.type === "ops");

  const [fitness, ops, factory] = await Promise.all([
    resolveFitnessSource({ cwd: options.cwd, now: options.now, rm: fitnessRm, agentConfig: fitnessCfg }),
    resolveOpsSource({ cwd: options.cwd, now: options.now, rm: opsRm, agentConfig: opsCfg }),
    resolveFactorySource({ cwd: options.cwd, now: options.now }),
  ]);
  return { fitness, ops, factory };
}
