/**
 * src/agents/fitness-agent-adapter.ts
 *
 * READ-ONLY adapter for the Fitness agent. Reads only the local paths in the
 * agent-integrations config (repo/source, reports dir, handover doc). It NEVER
 * calls Apple Health, NEVER calls Google Drive, NEVER mutates Supabase, and
 * NEVER executes actions. Degrades safely when paths are missing.
 */

import type { AgentIntegrationConfig, AgentReadModel, AgentStatus, AgentStatusCard } from "./agent-types.js";
import { detectRepo, listAgentReports, recentActivity, summarizeHandover } from "./agent-registry.js";

const NEXT_COMMAND = "npm run agents:status";

function baseCard(config: AgentIntegrationConfig, status: AgentStatus): Omit<AgentStatusCard, "summary" | "metrics"> {
  return {
    agentId: config.id,
    agentName: config.name,
    agentType: "fitness",
    status,
    confidence: status === "ok" ? "medium" : "low",
    sourcePaths: [config.repoPath, config.reportsPath, config.handoverPath].filter((p): p is string => !!p),
    missingSources: [],
    blockedActions: ["mutate_apple_health", "mutate_google_drive", "mutate_supabase"],
    approvalRequiredActions: [],
    nextRecommendedCommand: NEXT_COMMAND,
    latestReportPaths: [],
  };
}

export async function buildFitnessAgentReadModel(
  config: AgentIntegrationConfig,
  cwd: string = process.cwd()
): Promise<AgentReadModel> {
  if (!config.enabled) {
    return {
      agentId: config.id,
      agentName: config.name,
      agentType: "fitness",
      configured: true,
      enabled: false,
      status: "unconfigured",
      cards: [
        {
          ...baseCard(config, "unconfigured"),
          summary: "Fitness agent is configured but disabled. Set enabled=true to surface read-only status.",
          metrics: {},
        },
      ],
    };
  }

  const repoDetected = detectRepo(cwd, config.repoPath);
  const handover = await summarizeHandover(cwd, config.handoverPath);
  const reports = await listAgentReports(cwd, config.reportsPath);
  const lastActivity = await recentActivity(cwd, [config.repoPath, config.reportsPath, config.handoverPath]);

  const missingSources: string[] = [];
  if (config.repoPath && !repoDetected) missingSources.push(config.repoPath);
  if (config.handoverPath && !handover) missingSources.push(config.handoverPath);
  if (config.reportsPath && reports.length === 0) missingSources.push(config.reportsPath);

  const status: AgentStatus = !repoDetected && config.repoPath ? "missing" : missingSources.length > 0 ? "degraded" : "ok";

  const cards: AgentStatusCard[] = [
    {
      ...baseCard(config, status),
      missingSources,
      summary: repoDetected
        ? `Fitness agent source detected at ${config.repoPath}.`
        : "Fitness agent source not found at the configured path.",
      metrics: { repoDetected: String(repoDetected), reportCount: reports.length },
    },
    {
      ...baseCard(config, status),
      missingSources,
      latestReportPaths: reports,
      summary: reports.length > 0 ? `Latest briefing/report: ${reports[0]}.` : "No briefing/report available.",
      metrics: { reportCount: reports.length },
    },
    {
      ...baseCard(config, status),
      summary: handover ? `Recovery / training visibility: ${handover}` : "No recovery/training summary available from local sources.",
      metrics: lastActivity ? { freshness: lastActivity } : {},
    },
    {
      ...baseCard(config, status),
      missingSources,
      summary: missingSources.length > 0 ? `Known gaps: missing ${missingSources.join(", ")}.` : "No missing local sources detected.",
      metrics: { missingSources: missingSources.length },
    },
  ];

  cards[0]!.metrics["card"] = "Fitness Agent — System Status";
  cards[1]!.metrics["card"] = "Fitness Agent — Latest Briefing";
  cards[2]!.metrics["card"] = "Fitness Agent — Recovery / Training Visibility";
  cards[3]!.metrics["card"] = "Fitness Agent — Known Gaps";

  return {
    agentId: config.id,
    agentName: config.name,
    agentType: "fitness",
    configured: true,
    enabled: true,
    status,
    cards,
  };
}
