/**
 * src/cockpit/panels/index.ts
 *
 * Phase 12A — domain panel aggregator. Gathers the read-only inputs and builds
 * the Fitness, Ops, and Factory panels. All inputs come from existing
 * boundaries; nothing here mutates, executes, or calls the network beyond the
 * already-governed read-only read-models.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { loadRegistry } from "../../beezulbub/capability-registry.js";
import { buildAgentIntegrationSummary } from "../../agents/agent-read-model.js";
import { buildReadModelRegistrySummary } from "../../read-models/read-model-report.js";
import { loadAgentRegistry } from "../../agents/agent-registry.js";
import { resolveSources } from "../sources/index.js";
import type { AgentIntegrationSummary } from "../../agents/agent-types.js";
import type { ReadModelRegistrySummary } from "../../read-models/read-model-types.js";
import type { CockpitReportRef } from "../cockpit-types.js";
import type { CapabilityInfo, ModuleInfo, PanelInputs } from "./panel-inputs.js";
import type { DomainPanel } from "./panel-types.js";
import { buildFitnessPanel } from "./fitness-panel.js";
import { buildOpsPanel } from "./ops-panel.js";
import { buildFactoryPanel } from "./factory-panel.js";

export * from "./panel-types.js";
export type { PanelInputs, CapabilityInfo, ModuleInfo } from "./panel-inputs.js";
export { buildFitnessPanel } from "./fitness-panel.js";
export { buildOpsPanel } from "./ops-panel.js";
export { buildFactoryPanel, BUILD_AGENT_EXAMPLES } from "./factory-panel.js";

/**
 * Core factory modules. They ship inside this runtime — if this code executes,
 * the modules are present — so they default to present=true (no fs probing of a
 * data cwd). Tests may override `modules` to simulate a missing module.
 */
export const DEFAULT_MODULES: ModuleInfo[] = [
  { id: "orchestrator", label: "Orchestrator", present: true },
  { id: "cto", label: "CTO Review", present: true },
  { id: "strategy", label: "Strategy (Prophet)", present: true },
  { id: "beezulbub", label: "Beezulbub", present: true },
  { id: "command_center", label: "Command Center contract", present: true },
  { id: "cockpit", label: "Cockpit", present: true },
  { id: "llm", label: "LLM Gateway", present: true },
  { id: "agents", label: "Agent Integrations", present: true },
  { id: "read_models", label: "Read Models", present: true },
];

const REGISTRY_REL_PATH = "capabilities/capability-registry.json";

async function loadCapabilityInfo(cwd: string): Promise<CapabilityInfo> {
  const registryPath = path.join(cwd, REGISTRY_REL_PATH);
  if (!existsSync(registryPath)) {
    return { present: false, count: 0, byStatus: {}, names: [] };
  }
  const registry = await loadRegistry(registryPath);
  const entries = Object.values(registry.capabilities);
  const byStatus: Record<string, number> = {};
  const names: string[] = [];
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    if (e.name) names.push(e.name);
  }
  return { present: true, count: entries.length, byStatus, names };
}

export interface GatherPanelInputsOptions {
  cwd?: string;
  /** Reuse already-built summaries (cockpit-read-model already has them). */
  agentIntegration?: AgentIntegrationSummary;
  readModels?: ReadModelRegistrySummary;
  reports?: CockpitReportRef[];
  modules?: ModuleInfo[];
  now?: string;
}

/** Gather the read-only inputs needed to build domain panels. */
export async function gatherPanelInputs(options: GatherPanelInputsOptions = {}): Promise<PanelInputs> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date().toISOString();
  const agentIntegration = options.agentIntegration ?? (await buildAgentIntegrationSummary({ cwd }));
  const readModels = options.readModels ?? (await buildReadModelRegistrySummary({ cwd }));
  const reports = options.reports ?? [];
  const capability = await loadCapabilityInfo(cwd);

  // Phase 13 — resolve read-only sources (live read-model → report → handover).
  // Needs raw agent configs for report/handover paths; degrades safely.
  let sources;
  try {
    const registry = await loadAgentRegistry(cwd);
    sources = await resolveSources({ cwd, now, readModels, agentConfigs: registry.agents });
  } catch {
    sources = undefined;
  }

  return {
    agentIntegration,
    readModels,
    reports,
    capability,
    modules: options.modules ?? DEFAULT_MODULES,
    now,
    ...(sources ? { sources } : {}),
  };
}

/** Build all three domain panels from gathered inputs. Deterministic, pure. */
export function buildDomainPanels(inputs: PanelInputs): DomainPanel[] {
  return [buildFitnessPanel(inputs), buildOpsPanel(inputs), buildFactoryPanel(inputs)];
}

/** Convenience: gather inputs from cwd and build the panels. */
export async function buildDomainPanelsFromCwd(options: GatherPanelInputsOptions = {}): Promise<DomainPanel[]> {
  const inputs = await gatherPanelInputs(options);
  return buildDomainPanels(inputs);
}
