/**
 * src/cockpit/cockpit-types.ts
 *
 * Types for the HartOS Local Visible Cockpit (Phase 11H).
 *
 * Architecture:
 *   Orchestrator         = brain (decides)
 *   Command Center contract = nervous system (defines what exists / is safe)
 *   Cockpit              = visible control surface (renders + routes locally)
 *
 * The cockpit is LOCAL-ONLY. It renders the Command Center contract/read model,
 * shows local reports, and routes an "Ask HartOS" message into the existing
 * local Orchestrator. It NEVER mutates providers/Supabase/packs, NEVER deploys,
 * NEVER calls the network, and NEVER executes a dangerous action — dangerous
 * actions render as disabled/blocked only.
 */

import type {
  ActionId,
  ActionState,
  ApprovalCategory,
  CardGroup,
  Confidence,
  ReadStatus,
  RiskLevel,
} from "../command-center/command-center-types.js";
import type { AgentIntegrationSummary } from "../agents/agent-types.js";
import type { ReadModelRegistrySummary } from "../read-models/read-model-types.js";
import type { DomainPanel } from "./panels/index.js";
import type { CockpitIntent } from "./cockpit-intent-router.js";
import type { ActionProposal, ProposalQueueItem } from "./proposals/index.js";
import type { MemorySnapshot } from "../awareness/executive-memory.js";
import type { OpsCardRef } from "./mutation/card-target-resolver.js";
import type { SourceDiagnosticsReport } from "./sources/index.js";

export type CockpitMode = "local" | "hosted";

// ─── Ask HartOS message contract ────────────────────────────────────────────

export interface CockpitMessageInput {
  request: string;
  source: "cockpit";
  createdAt: string;
  mode: CockpitMode;
  threadId?: string;
}

export interface CockpitOrchestratorResponse {
  requestId: string;
  threadId: string;
  createdAt: string;
  request: string;
  classification: {
    classification: string;
    domain: string;
    riskLevel: string;
    buildTarget: string;
    recommendedSpecialist: string;
  };
  strategyReview: string | null;
  ctoReview: string | null;
  capabilityGaps: string;
  buildPlanSummary: string;
  handoverPath: string | null;
  reportPaths: string[];
  nextRecommendedCommand: string;
  blockedActions: ActionId[];
  approvalRequiredActions: ActionId[];
  /** Optional LLM contextualization (Phase 11I). Null/absent when deterministic. */
  llmSummary?: string | null;
  llmProvider?: string | null;
  llmMode?: string | null;
  /** Phase 12B — routed cockpit intent + grounded answer (deterministic). */
  intent?: CockpitIntent;
  intentTitle?: string;
  intentSummary?: string;
  intentHighlights?: string[];
  intentGaps?: string[];
  intentNextSteps?: string[];
  intentSuggestedCommands?: string[];
  intentClarifyingQuestion?: string | null;
  /** Phase 12A — domain panels captured at response time. */
  panels?: DomainPanel[];
  /** Phase 14A — non-executable action proposal drafts (dry-run only). */
  proposals?: ActionProposal[];
  /** Phase 14B — the local proposal queue snapshot after this request. */
  proposalQueue?: ProposalQueueItem[];
}

// ─── Card views (contract + read model merged for rendering) ────────────────

/** A single allowed action, annotated with its safety state for rendering. */
export interface CockpitActionView {
  action: ActionId;
  state: ActionState;
  approval: ApprovalCategory;
  /** Phase 11H NEVER executes anything — always false. */
  executable: boolean;
  /** True when the action is forbidden/blocked outright. */
  blocked: boolean;
  /** True when the action would need a human/admin gate. */
  requiresApproval: boolean;
  label: string;
}

export interface CockpitCardView {
  id: string;
  group: CardGroup;
  title: string;
  description: string;
  sourceType: string;
  sourcePaths: string[];
  riskLevel: RiskLevel;
  status: ReadStatus;
  confidence: Confidence;
  presentSources: string[];
  missingSources: string[];
  summary: string;
  safeRecommendation: string;
  actions: CockpitActionView[];
}

export interface CockpitCardGroupView {
  group: CardGroup;
  title: string;
  cards: CockpitCardView[];
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface CockpitReportRef {
  dir: string;
  file: string;
  /** Relative path from the agent root, e.g. "hartos-reports/orchestrator-...md". */
  relativePath: string;
}

// ─── Thread (persisted Ask HartOS exchanges) ────────────────────────────────

export interface CockpitThreadEntry {
  requestId: string;
  request: string;
  createdAt: string;
  response: CockpitOrchestratorResponse;
}

export interface CockpitThread {
  threadId: string;
  createdAt: string;
  updatedAt: string;
  entries: CockpitThreadEntry[];
}

// ─── Full cockpit state (the render model) ──────────────────────────────────

export interface CockpitSystemSummary {
  cardCount: number;
  groups: CardGroup[];
  missingSourceCount: number;
  readOnlyActionCount: number;
  approvalRequiredActionCount: number;
  manualRequiredActionCount: number;
  forbiddenActionCount: number;
  reportCount: number;
  latestRequest: string | null;
  latestStrategyVerdict: string | null;
  latestCtoVerdict: string | null;
  nextRecommendedCommand: string;
}

export interface CockpitState {
  generatedAt: string;
  mode: CockpitMode;
  title: string;
  summary: CockpitSystemSummary;
  groups: CockpitCardGroupView[];
  cards: CockpitCardView[];
  missingSources: string[];
  readOnlyActions: ActionId[];
  localReportActions: ActionId[];
  approvalRequiredActions: ActionId[];
  manualRequiredActions: ActionId[];
  forbiddenActions: ActionId[];
  reports: CockpitReportRef[];
  latestResponse: CockpitOrchestratorResponse | null;
  /** Phase 11I — read-only real agent integration (degrades to unconfigured). */
  agentIntegration?: AgentIntegrationSummary;
  /** Phase 11I — read-only real data integration (disabled by default). */
  readModels?: ReadModelRegistrySummary;
  /** Phase 12A — custom domain panels (Fitness, Ops, Factory). Read-only. */
  panels?: DomainPanel[];
  /** Phase 14A — action proposal drafts from the latest Ask (non-executable). */
  proposals?: ActionProposal[];
  /** Phase 13.5A — read-model source diagnostics. */
  sourceDiagnostics?: SourceDiagnosticsReport;
  /** Phase 14B — persisted local proposal queue (non-executable). */
  proposalQueue?: ProposalQueueItem[];
  /**
   * Executive Memory (Cockpit V2 close-the-loop) — a supplied history of compact snapshots,
   * populated by the Node state-resolver from the memory store when capture is enabled. Absent
   * by default ⇒ the cockpit's memory section renders the honest INSUFFICIENT_HISTORY line.
   * PLAIN DATA ONLY (Worker-safe); the Worker never reads the store directly.
   */
  memorySnapshots?: MemorySnapshot[];
  /**
   * Mutation target resolution (close-the-loop) — individual ops cards (id · name · status) so a
   * mutation instruction can resolve "this operation" to a real card. Populated by the live ops
   * read-model; absent ⇒ the mutate rehearsal honestly has no cards to resolve against.
   */
  opsCards?: OpsCardRef[];
}

// ─── Request validation ─────────────────────────────────────────────────────

export interface RequestValidation {
  ok: boolean;
  error?: string;
  /** Present only when ok; the trimmed, safe request string. */
  value?: string;
}
