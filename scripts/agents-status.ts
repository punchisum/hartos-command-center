/**
 * scripts/agents-status.ts
 *
 * agents:status — build the read-only agent integration summary and write a
 * report under agent-integration-reports/. Reads agent-integrations.local.json
 * if present; otherwise shows a safe unconfigured state. No external calls, no
 * mutation, no execution.
 *
 * Usage:
 *   npm run agents:status
 */

import path from "node:path";
import { buildAgentIntegrationSummary, writeAgentReport, DEFAULT_AGENT_REPORTS_DIR } from "../src/agents/index.js";

const cwd = process.cwd();
const summary = await buildAgentIntegrationSummary({ cwd });
const reportsDir = path.join(cwd, DEFAULT_AGENT_REPORTS_DIR);
const { mdPath, jsonPath } = await writeAgentReport(reportsDir, summary);

console.log("\nHartOS Agent Integration — Status: test-agent");
console.log(`Config present: ${summary.configPresent} (${summary.configPath ?? "unconfigured"})`);
console.log(`Configured agents: ${summary.configuredAgents} | Detected: ${summary.detectedAgents}`);
for (const agent of summary.agents) {
  console.log(`  - ${agent.agentName} (${agent.agentType}): ${agent.status}`);
}
if (!summary.configPresent) {
  console.log("\nNo agent-integrations.local.json found. Copy agent-integrations.example.json to get started.");
}
console.log(`Report: ${path.relative(cwd, mdPath)}`);
console.log(`Sidecar: ${path.relative(cwd, jsonPath)}`);
console.log("");
