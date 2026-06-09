/**
 * src/agents/agent-types.ts
 *
 * Types for read-only real-agent integration (Phase 11I). The cockpit can SEE
 * configured agents (Ops, Fitness) through read-only adapters that read local
 * repo/report paths only. No external calls, no mutation, no execution.
 */

export type AgentType = "ops" | "fitness" | "research" | "other";

/** Read-model status for an integrated agent. */
export type AgentStatus = "ok" | "degraded" | "missing" | "unconfigured" | "error";

export type AgentConfidence = "low" | "medium" | "high";

/** One agent entry from agent-integrations.local.json. */
export interface AgentIntegrationConfig {
  id: string;
  name: string;
  type: AgentType;
  enabled: boolean;
  repoPath?: string;
  reportsPath?: string;
  handoverPath?: string;
  readModel?: { mode: "local_files" };
}

export interface AgentIntegrationsFile {
  agents: AgentIntegrationConfig[];
}

/** A standard card emitted by every adapter. */
export interface AgentStatusCard {
  agentId: string;
  agentName: string;
  agentType: AgentType;
  status: AgentStatus;
  confidence: AgentConfidence;
  /** Local paths the card was derived from (relative where possible). */
  sourcePaths: string[];
  summary: string;
  metrics: Record<string, string | number>;
  missingSources: string[];
  /** Always read-only in Phase 11I — these are surfaced, never executed. */
  blockedActions: string[];
  approvalRequiredActions: string[];
  nextRecommendedCommand: string;
  latestReportPaths: string[];
}

/** Per-agent read-model result: configuration + derived cards. */
export interface AgentReadModel {
  agentId: string;
  agentName: string;
  agentType: AgentType;
  configured: boolean;
  enabled: boolean;
  status: AgentStatus;
  cards: AgentStatusCard[];
}

/** Whole-registry read-model summary. */
export interface AgentIntegrationSummary {
  generatedAt: string;
  configPresent: boolean;
  configPath: string | null;
  configuredAgents: number;
  detectedAgents: number;
  agents: AgentReadModel[];
  missingSources: string[];
  nextRecommendedCommand: string;
}
