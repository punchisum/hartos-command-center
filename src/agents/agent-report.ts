/**
 * src/agents/agent-report.ts
 *
 * Writes safe local reports for agent integration status under
 * agent-integration-reports/. Read-only inputs; no secrets are written (the
 * report is refused if anything secret-looking slips in).
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { AgentIntegrationSummary } from "./agent-types.js";
import { containsSecret } from "../llm/redaction.js";

export const DEFAULT_AGENT_REPORTS_DIR = "agent-integration-reports";

export function renderAgentReportMarkdown(summary: AgentIntegrationSummary): string {
  const lines: string[] = [
    "# Agent Integration Status",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- config present: ${summary.configPresent}`,
    `- config path: ${summary.configPath ?? "(none — unconfigured)"}`,
    `- configured agents: ${summary.configuredAgents}`,
    `- detected agents: ${summary.detectedAgents}`,
    `- next recommended command: ${summary.nextRecommendedCommand}`,
    "",
    "## Agents",
    "",
  ];
  if (summary.agents.length === 0) {
    lines.push("_No agents configured. See agent-integrations.example.json._", "");
  }
  for (const agent of summary.agents) {
    lines.push(`### ${agent.agentName} (${agent.agentType}) — ${agent.status}`, "");
    for (const card of agent.cards) {
      const title = String(card.metrics["card"] ?? card.agentName);
      lines.push(`- **${title}**: ${card.summary}`);
      if (card.latestReportPaths.length > 0) lines.push(`  - reports: ${card.latestReportPaths.join(", ")}`);
      if (card.missingSources.length > 0) lines.push(`  - missing: ${card.missingSources.join(", ")}`);
    }
    lines.push("");
  }
  if (summary.missingSources.length > 0) {
    lines.push("## Missing sources", "", ...summary.missingSources.map((m) => `- ${m}`), "");
  }
  lines.push("_Read-only integration. No ClickUp / Apple Health / Google Drive / Telegram / Supabase mutations occur._", "");
  return lines.join("\n");
}

export async function writeAgentReport(
  reportsDir: string,
  summary: AgentIntegrationSummary
): Promise<{ mdPath: string; jsonPath: string }> {
  const md = renderAgentReportMarkdown(summary);
  const json = JSON.stringify(summary, null, 2);
  if (containsSecret(md) || containsSecret(json)) {
    throw new Error("Refusing to write agent integration report: secret-looking content detected.");
  }
  await mkdir(reportsDir, { recursive: true });
  const stamp = summary.generatedAt.replace(/[:.]/g, "-");
  const mdPath = path.join(reportsDir, `agent-integration-status-${stamp}.md`);
  const jsonPath = path.join(reportsDir, `agent-integration-status-${stamp}.json`);
  await writeFile(mdPath, md, "utf8");
  await writeFile(jsonPath, json, "utf8");
  return { mdPath, jsonPath };
}
