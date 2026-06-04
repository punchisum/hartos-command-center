/**
 * src/agents/agent-read-model.ts
 *
 * Builds the whole-registry read-only agent summary by dispatching each
 * configured agent to its adapter. Degrades safely with no config: every agent
 * (and the registry as a whole) renders as "unconfigured". No external calls.
 */

import type { AgentIntegrationConfig, AgentIntegrationSummary, AgentReadModel } from "./agent-types.js";
import { loadAgentRegistry } from "./agent-registry.js";
import { buildOpsAgentReadModel } from "./ops-agent-adapter.js";
import { buildFitnessAgentReadModel } from "./fitness-agent-adapter.js";

export interface AgentReadModelOptions {
  cwd?: string;
}

async function buildForAgent(config: AgentIntegrationConfig, cwd: string): Promise<AgentReadModel> {
  if (config.type === "ops") return buildOpsAgentReadModel(config, cwd);
  if (config.type === "fitness") return buildFitnessAgentReadModel(config, cwd);
  // Generic/other agents: minimal unconfigured-style card.
  return {
    agentId: config.id,
    agentName: config.name,
    agentType: "other",
    configured: true,
    enabled: config.enabled,
    status: config.enabled ? "degraded" : "unconfigured",
    cards: [
      {
        agentId: config.id,
        agentName: config.name,
        agentType: "other",
        status: config.enabled ? "degraded" : "unconfigured",
        confidence: "low",
        sourcePaths: [config.repoPath, config.reportsPath].filter((p): p is string => !!p),
        summary: "No type-specific adapter; only generic read-only visibility is available.",
        metrics: {},
        missingSources: [],
        blockedActions: [],
        approvalRequiredActions: [],
        nextRecommendedCommand: "npm run agents:status",
        latestReportPaths: [],
      },
    ],
  };
}

export async function buildAgentIntegrationSummary(
  options: AgentReadModelOptions = {}
): Promise<AgentIntegrationSummary> {
  const cwd = options.cwd ?? process.cwd();
  const now = new Date();
  const registry = await loadAgentRegistry(cwd);

  const agents: AgentReadModel[] = [];
  for (const config of registry.agents) {
    agents.push(await buildForAgent(config, cwd));
  }

  const detectedAgents = agents.filter((a) => a.status === "ok" || a.status === "degraded").length;
  const missingSources = [...new Set(agents.flatMap((a) => a.cards.flatMap((c) => c.missingSources)))];

  const nextRecommendedCommand = !registry.configPresent
    ? "configure agent-integrations.local.json (see agent-integrations.example.json)"
    : "npm run agents:status";

  return {
    generatedAt: now.toISOString(),
    configPresent: registry.configPresent,
    configPath: registry.configPath ? "agent-integrations.local.json" : null,
    configuredAgents: registry.agents.length,
    detectedAgents,
    agents,
    missingSources,
    nextRecommendedCommand,
  };
}
