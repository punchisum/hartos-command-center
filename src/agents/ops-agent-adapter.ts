/**
 * src/agents/ops-agent-adapter.ts
 *
 * READ-ONLY adapter for the GECAN Ops agent. Reads only the local paths in the
 * agent-integrations config (repo, reports dir, handover doc). It NEVER calls
 * ClickUp, NEVER mutates Supabase, NEVER calls Telegram, NEVER executes actions.
 * Degrades safely when paths are missing.
 */

import type { AgentIntegrationConfig, AgentReadModel, AgentStatus, AgentStatusCard } from "./agent-types.js";
import { detectRepo, listAgentReports, recentActivity, summarizeHandover } from "./agent-registry.js";

const NEXT_COMMAND = "npm run agents:status";

function baseCard(config: AgentIntegrationConfig, status: AgentStatus): Omit<AgentStatusCard, "summary" | "metrics"> {
  return {
    agentId: config.id,
    agentName: config.name,
    agentType: "ops",
    status,
    confidence: status === "ok" ? "medium" : "low",
    sourcePaths: [config.repoPath, config.reportsPath, config.handoverPath].filter((p): p is string => !!p),
    missingSources: [],
    blockedActions: ["mutate_clickup", "mutate_supabase", "call_telegram"],
    approvalRequiredActions: [],
    nextRecommendedCommand: NEXT_COMMAND,
    latestReportPaths: [],
  };
}

export async function buildOpsAgentReadModel(
  config: AgentIntegrationConfig,
  cwd: string = process.cwd()
): Promise<AgentReadModel> {
  if (!config.enabled) {
    return {
      agentId: config.id,
      agentName: config.name,
      agentType: "ops",
      configured: true,
      enabled: false,
      status: "unconfigured",
      cards: [
        {
          ...baseCard(config, "unconfigured"),
          summary: "Ops agent is configured but disabled. Set enabled=true to surface read-only status.",
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

  // Each claim-bearing card now links the evidence behind it (was: only the
  // Reports/Handover card carried links → 3 of 4 cards were dead ends). The Known-Gaps
  // card intentionally carries no report links — its evidence is the missingSources it
  // already lists, not a report.
  const cards: AgentStatusCard[] = [
    {
      ...baseCard(config, status),
      missingSources,
      latestReportPaths: repoDetected ? reports.slice(0, 1) : [],
      summary: repoDetected
        ? `Ops agent repo detected at ${config.repoPath}.`
        : "Ops agent repo not found at the configured path.",
      metrics: { repoDetected: String(repoDetected), reportCount: reports.length },
    },
    {
      ...baseCard(config, status),
      missingSources,
      latestReportPaths: reports,
      summary: handover ? `Handover: ${handover}` : "No handover summary available.",
      metrics: { reportCount: reports.length },
    },
    {
      ...baseCard(config, status),
      missingSources,
      summary: missingSources.length > 0 ? `Known gaps: missing ${missingSources.join(", ")}.` : "No missing local sources detected.",
      metrics: { missingSources: missingSources.length },
    },
    {
      ...baseCard(config, status),
      latestReportPaths: reports.slice(0, 3),
      summary: lastActivity ? `Most recent local activity: ${lastActivity}.` : "No recent local activity detected.",
      metrics: lastActivity ? { lastActivity } : {},
    },
  ];

  // Title hints surfaced via summary; ids stay stable for the cockpit.
  cards[0]!.metrics["card"] = "Ops Agent — System Status";
  cards[1]!.metrics["card"] = "Ops Agent — Reports / Handover";
  cards[2]!.metrics["card"] = "Ops Agent — Known Gaps";
  cards[3]!.metrics["card"] = "Ops Agent — Recent Activity";

  return {
    agentId: config.id,
    agentName: config.name,
    agentType: "ops",
    configured: true,
    enabled: true,
    status,
    cards,
  };
}
