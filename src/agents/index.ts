/**
 * src/agents/index.ts
 *
 * Public surface for read-only real-agent integration (Phase 11I).
 */

export * from "./agent-types.js";
export {
  loadAgentRegistry,
  detectRepo,
  summarizeHandover,
  listAgentReports,
  recentActivity,
  LOCAL_CONFIG_FILE,
  EXAMPLE_CONFIG_FILE,
  type LoadedAgentRegistry,
} from "./agent-registry.js";
export { buildOpsAgentReadModel } from "./ops-agent-adapter.js";
export { buildFitnessAgentReadModel } from "./fitness-agent-adapter.js";
export { buildAgentIntegrationSummary, type AgentReadModelOptions } from "./agent-read-model.js";
export {
  writeAgentReport,
  renderAgentReportMarkdown,
  DEFAULT_AGENT_REPORTS_DIR,
} from "./agent-report.js";
