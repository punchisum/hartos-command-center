/**
 * src/cockpit/cockpit-read-model.ts
 *
 * Builds the full cockpit render state from the existing Command Center
 * contract + read model (Phase 11G), plus a local listing of available reports
 * and the latest persisted Orchestrator response. LOCAL reads only; degrades
 * safely when nothing exists.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import type {
  ActionId,
  CardGroup,
} from "../command-center/command-center-types.js";
import { CARD_GROUPS } from "../command-center/command-center-types.js";
import { buildCommandCenterSnapshot } from "../command-center/command-center.js";
import { ACTION_STATES } from "../command-center/action-contract.js";
import { getApprovalCategory } from "../command-center/approval-contract.js";
import { buildAgentIntegrationSummary } from "../agents/agent-read-model.js";
import { buildReadModelRegistrySummary } from "../read-models/read-model-report.js";
import { buildDomainPanels, gatherPanelInputs } from "./panels/index.js";
import { buildSourceDiagnostics, type SourceDiagnosticsReport } from "./sources/index.js";
import { listProposals, type ProposalQueueItem } from "./proposals/index.js";
import type {
  CockpitActionView,
  CockpitCardGroupView,
  CockpitCardView,
  CockpitOrchestratorResponse,
  CockpitReportRef,
  CockpitState,
} from "./cockpit-types.js";

export interface CockpitReadModelOptions {
  cwd?: string;
}

const GROUP_TITLES: Record<CardGroup, string> = {
  orchestrator: "Orchestrator",
  factory: "Factory",
  beezulbub: "Beezulbub",
  agents: "Agents",
  human_control: "Human Control",
};

/** Local report directories the cockpit lists (read-only). */
export const REPORT_DIRS = [
  "command-center-reports",
  "hartos-reports",
  "beezulbub-reports",
  "launch-reports",
  "production-reports",
  "bootstrap-reports",
  "cockpit-reports",
];

function actionLabel(action: ActionId): string {
  return action.replace(/_/g, " ");
}

function toActionView(action: ActionId): CockpitActionView {
  const state = ACTION_STATES[action];
  const approval = getApprovalCategory(action);
  const blocked = state === "forbidden";
  const requiresApproval = state === "approval_required" || state === "manual_required";
  return {
    action,
    state,
    approval,
    // Phase 11H NEVER executes anything from the cockpit.
    executable: false,
    blocked,
    requiresApproval,
    label: actionLabel(action),
  };
}

function actionsInState(state: string): ActionId[] {
  return (Object.keys(ACTION_STATES) as ActionId[]).filter((a) => ACTION_STATES[a] === state).sort();
}

async function listReports(cwd: string): Promise<CockpitReportRef[]> {
  const out: CockpitReportRef[] = [];
  for (const dir of REPORT_DIRS) {
    const full = path.join(cwd, dir);
    if (!existsSync(full)) continue;
    let entries: string[];
    try {
      entries = await readdir(full);
    } catch {
      continue;
    }
    for (const file of entries.filter((f) => f.endsWith(".md") || f.endsWith(".json")).sort().reverse()) {
      out.push({ dir, file, relativePath: `${dir}/${file}` });
    }
  }
  return out;
}

/** Load the most recent persisted cockpit Orchestrator response, if any. */
async function loadLatestResponse(cwd: string): Promise<CockpitOrchestratorResponse | null> {
  const threadsDir = path.join(cwd, "cockpit-threads");
  if (!existsSync(threadsDir)) return null;
  let files: string[];
  try {
    files = await readdir(threadsDir);
  } catch {
    return null;
  }
  const messages = files.filter((f) => f.startsWith("message-") && f.endsWith(".json")).sort().reverse();
  if (messages.length === 0) return null;
  try {
    return JSON.parse(await readFile(path.join(threadsDir, messages[0]!), "utf8")) as CockpitOrchestratorResponse;
  } catch {
    return null;
  }
}

export async function buildCockpitState(options: CockpitReadModelOptions = {}): Promise<CockpitState> {
  const cwd = options.cwd ?? process.cwd();
  const now = new Date();

  const snapshot = await buildCommandCenterSnapshot({ cwd });
  const readModelById = new Map(snapshot.readModels.map((rm) => [rm.cardId, rm]));

  const cards: CockpitCardView[] = snapshot.contract.cards.map((card) => {
    const rm = readModelById.get(card.id);
    return {
      id: card.id,
      group: card.group,
      title: card.title,
      description: card.description,
      sourceType: card.sourceType,
      sourcePaths: card.sourcePaths,
      riskLevel: card.riskLevel,
      status: rm?.status ?? "missing",
      confidence: rm?.confidence ?? "low",
      presentSources: rm?.presentSources ?? [],
      missingSources: rm?.missingSources ?? card.sourcePaths,
      summary: rm?.summary ?? "No data.",
      safeRecommendation: rm?.safeRecommendation ?? "Run the relevant local report command.",
      actions: card.allowedActions.map(toActionView),
    };
  });

  const groups: CockpitCardGroupView[] = CARD_GROUPS.map((group) => ({
    group,
    title: GROUP_TITLES[group],
    cards: cards.filter((c) => c.group === group),
  }));

  const reports = await listReports(cwd);
  const latestResponse = await loadLatestResponse(cwd);
  // Phase 11I — read-only real integrations. Both degrade safely (unconfigured)
  // and never call the network for disabled/unconfigured sources.
  const agentIntegration = await buildAgentIntegrationSummary({ cwd });
  const readModels = await buildReadModelRegistrySummary({ cwd });

  // Phase 12A — custom domain panels built from the same read-only inputs.
  const panelInputs = await gatherPanelInputs({
    cwd,
    agentIntegration,
    readModels,
    reports,
    now: now.toISOString(),
  });
  const panels = buildDomainPanels(panelInputs);

  // Phase 13.5A — read-model diagnostics (per-domain status, never secrets).
  let sourceDiagnostics: SourceDiagnosticsReport | undefined;
  try {
    if (panelInputs.sources) {
      sourceDiagnostics = await buildSourceDiagnostics({ cwd, now: now.toISOString(), sources: panelInputs.sources, readModelSummaries: readModels.summaries });
    }
  } catch {
    sourceDiagnostics = undefined;
  }

  // Phase 14B — persisted proposal queue (local, gitignored, read-only here).
  let proposalQueue: ProposalQueueItem[];
  try {
    proposalQueue = await listProposals(cwd);
  } catch {
    proposalQueue = [];
  }

  const readOnlyActions = actionsInState("read_only");
  const localReportActions = actionsInState("local_report_generation");
  const approvalRequiredActions = actionsInState("approval_required");
  const manualRequiredActions = actionsInState("manual_required");
  const forbiddenActions = actionsInState("forbidden");

  return {
    generatedAt: now.toISOString(),
    mode: "local",
    title: "HartOS Command Center",
    summary: {
      cardCount: cards.length,
      groups: [...CARD_GROUPS],
      missingSourceCount: snapshot.plan.missingSources.length,
      readOnlyActionCount: readOnlyActions.length,
      approvalRequiredActionCount: approvalRequiredActions.length,
      manualRequiredActionCount: manualRequiredActions.length,
      forbiddenActionCount: forbiddenActions.length,
      reportCount: reports.length,
      latestRequest: latestResponse?.request ?? null,
      latestStrategyVerdict: latestResponse?.strategyReview ?? null,
      latestCtoVerdict: latestResponse?.ctoReview ?? null,
      nextRecommendedCommand: latestResponse?.nextRecommendedCommand ?? snapshot.plan.nextRecommendedCommand,
    },
    groups,
    cards,
    missingSources: snapshot.plan.missingSources,
    readOnlyActions,
    localReportActions,
    approvalRequiredActions,
    manualRequiredActions,
    forbiddenActions,
    reports,
    latestResponse,
    agentIntegration,
    readModels,
    panels,
    sourceDiagnostics,
    proposalQueue,
  };
}
