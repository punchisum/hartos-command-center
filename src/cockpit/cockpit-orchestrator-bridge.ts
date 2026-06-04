/**
 * src/cockpit/cockpit-orchestrator-bridge.ts
 *
 * Routes an "Ask HartOS" message into the existing LOCAL Orchestrator and
 * returns a structured cockpit response. It calls Orchestrator source functions
 * directly (no blind shelling out), validates input, and persists local thread
 * + report files.
 *
 * Hard boundaries: no network, no provider/Supabase/pack mutation, no deploys.
 * The cockpit recommends; it NEVER executes a dangerous action.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type {
  CockpitMessageInput,
  CockpitOrchestratorResponse,
  CockpitThread,
  CockpitThreadEntry,
} from "./cockpit-types.js";
import type { OrchestratorResult } from "../hartos/orchestrator-types.js";
import { runOrchestrator, DEFAULT_REPORTS_DIR } from "../hartos/orchestrator.js";
import { ACTION_STATES } from "../command-center/action-contract.js";
import { LlmGateway } from "../llm/llm-gateway.js";
import { buildCockpitState } from "./cockpit-read-model.js";
import { routeCockpitIntent, parseProposalRef } from "./cockpit-intent-router.js";
import {
  saveProposal,
  expireStaleProposals,
  rejectProposal,
  dryRunProposalInQueue,
  rejectAllDraftProposals,
  expireDuplicateProposals,
  resolveRef,
  listProposals,
} from "./proposals/index.js";
import {
  validateRequest,
  createRequestId,
  createThreadId,
  DEFAULT_MODE,
} from "./cockpit-state.js";
import {
  DEFAULT_COCKPIT_REPORTS_DIR,
  DEFAULT_COCKPIT_THREADS_DIR,
  writeThreadReport,
  writeThreadFile,
  writeMessageFile,
} from "./cockpit-report.js";
import type { ActionId } from "../command-center/command-center-types.js";

export interface BridgeOptions {
  cwd?: string;
  /** Default true. When false, no files are written (tests). */
  write?: boolean;
  threadId?: string;
}

export class CockpitRequestError extends Error {}

function actionsInState(state: string): ActionId[] {
  return (Object.keys(ACTION_STATES) as ActionId[]).filter((a) => ACTION_STATES[a] === state).sort();
}

function summarizeStrategy(result: OrchestratorResult): string | null {
  if (!result.strategy) return null;
  return `${result.strategy.verdict} — ${result.strategy.reason}`;
}

function summarizeCto(result: OrchestratorResult): string | null {
  if (!result.cto) return null;
  return `${result.cto.technicalVerdict} (missing: ${result.cto.missingCapabilities.join(", ") || "none"})`;
}

function summarizeGaps(result: OrchestratorResult): string {
  if (!result.gap) return "no capabilities tracked for this request";
  const usable = result.gap.usableCapabilities.length;
  const missing = result.gap.missingCapabilities.length;
  const planning = result.gap.planningOnlyCapabilities.length;
  return `${usable} usable, ${planning} planning-only, ${missing} missing`;
}

function summarizeBuildPlan(result: OrchestratorResult): string {
  if (!result.buildPlan) return "no build plan (request did not require one)";
  const phases = result.buildPlan.phaseBreakdown.length;
  return `${phases} phase(s); do-not-build: ${result.buildPlan.doNotBuild.length} item(s)`;
}

function deriveNextCommand(result: OrchestratorResult): string {
  if (result.gap && result.gap.missingCapabilities.length > 0) {
    return "npm run beezulbub:capability-list";
  }
  if (result.buildPlan) {
    return "npm run hartos:handover";
  }
  return 'npm run hartos:orchestrate -- --request="<your request>"';
}

async function loadThread(threadsDir: string, threadId: string): Promise<CockpitThread | null> {
  const filePath = path.join(threadsDir, `${threadId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as CockpitThread;
  } catch {
    return null;
  }
}

/**
 * Run one local Orchestrator request and return a structured cockpit response.
 * Throws CockpitRequestError on invalid input (empty/oversized/secret-looking).
 */
export async function askOrchestrator(
  input: CockpitMessageInput,
  options: BridgeOptions = {}
): Promise<CockpitOrchestratorResponse> {
  const validation = validateRequest(input.request);
  if (!validation.ok || !validation.value) {
    throw new CockpitRequestError(validation.error ?? "Invalid request.");
  }
  const request = validation.value;

  const cwd = options.cwd ?? process.cwd();
  const shouldWrite = options.write !== false;
  const now = new Date();
  const requestId = createRequestId(now);
  const threadId = options.threadId ?? input.threadId ?? createThreadId(now);

  const hartosReportsDir = path.join(cwd, DEFAULT_REPORTS_DIR);

  // Call the existing local Orchestrator directly. It writes its own report
  // (recommendations only) and never mutates anything.
  const result = await runOrchestrator(request, {
    cwd,
    reportsDir: hartosReportsDir,
    writeReport: shouldWrite,
  });

  const reportPaths: string[] = [];
  if (result.reportPath) reportPaths.push(path.relative(cwd, result.reportPath));

  const response: CockpitOrchestratorResponse = {
    requestId,
    threadId,
    createdAt: now.toISOString(),
    request,
    classification: {
      classification: result.classification.classification,
      domain: result.classification.domain,
      riskLevel: result.classification.riskLevel,
      buildTarget: result.classification.buildTarget,
      recommendedSpecialist: result.classification.recommendedSpecialist,
    },
    strategyReview: summarizeStrategy(result),
    ctoReview: summarizeCto(result),
    capabilityGaps: summarizeGaps(result),
    buildPlanSummary: summarizeBuildPlan(result),
    handoverPath: null,
    reportPaths,
    nextRecommendedCommand: deriveNextCommand(result),
    blockedActions: actionsInState("forbidden"),
    approvalRequiredActions: actionsInState("approval_required"),
    llmSummary: null,
    llmProvider: null,
    llmMode: null,
  };

  // Optional LLM contextualization (Phase 11I). Goes through the governed
  // gateway — deterministic fallback when no provider is configured. It only
  // SUMMARIZES the deterministic facts; it never mutates or executes anything.
  try {
    const gateway = new LlmGateway({ cwd });
    const llm = await gateway.classifyAndContextualize(request, {
      classification: result.classification.classification,
      domain: result.classification.domain,
      riskLevel: result.classification.riskLevel,
      recommendedSpecialist: result.classification.recommendedSpecialist,
      capabilityGaps: response.capabilityGaps,
    });
    response.llmSummary = llm.output.summary;
    response.llmProvider = llm.provider;
    response.llmMode = llm.mode;
  } catch {
    // LLM is strictly optional; never let it break a local read-only run.
  }

  // Phase 12B — deterministic cockpit intent routing, grounded in the domain
  // panels + the orchestrator's own deterministic facts. Additive: a failure
  // here never breaks the read-only orchestrator run.
  try {
    // Expire stale queued proposals before reading/answering (local-only).
    if (shouldWrite) {
      try { await expireStaleProposals(cwd, response.createdAt); } catch { /* degrade */ }
    }
    const state = await buildCockpitState({ cwd });
    const intentResult = routeCockpitIntent({
      request,
      panels: state.panels ?? [],
      systemSummary: state.summary,
      integration: {
        configPresent: state.agentIntegration?.configPresent ?? false,
        agentsConfigured: state.agentIntegration?.configuredAgents ?? 0,
        agentsDetected: state.agentIntegration?.detectedAgents ?? 0,
        readModelsEnabled: state.readModels?.enabledReadModels ?? 0,
      },
      llm: { provider: response.llmProvider ?? null, mode: response.llmMode ?? null },
      now: response.createdAt,
      env: process.env,
      ...(state.sourceDiagnostics ? { diagnostics: state.sourceDiagnostics } : {}),
      proposalQueue: state.proposalQueue ?? [],
      orchestrator: {
        classification: result.classification.classification,
        domain: result.classification.domain,
        strategyReview: response.strategyReview,
        ctoReview: response.ctoReview,
        buildPlanSummary: response.buildPlanSummary,
        capabilityGaps: response.capabilityGaps,
        nextRecommendedCommand: response.nextRecommendedCommand,
      },
    });
    response.intent = intentResult.intent;
    response.intentTitle = intentResult.title;
    response.intentSummary = intentResult.summary;
    response.intentHighlights = intentResult.highlights;
    response.intentGaps = intentResult.gaps;
    response.intentNextSteps = intentResult.nextSteps;
    response.intentSuggestedCommands = intentResult.suggestedCommands;
    response.intentClarifyingQuestion = intentResult.clarifyingQuestion;
    response.panels = state.panels;
    response.proposals = intentResult.proposals;

    // Phase 14B — persist newly generated proposals + run queue commands.
    if (shouldWrite) {
      // Save generated drafts to the local queue (degrades if storage absent).
      for (const proposal of intentResult.proposals) {
        try { await saveProposal(cwd, proposal, response.createdAt); } catch { /* keep response-only */ }
      }
      // Local queue mutations for reject / dry-run commands (never executes).
      if (intentResult.intent === "proposal_reject" || intentResult.intent === "proposal_dryrun") {
        const ref = parseProposalRef(request);
        try {
          const target = await resolveRef(cwd, ref);
          if (!target) {
            response.intentSummary = `No matching proposal for "${ref.id ?? ref.number ?? "(unspecified)"}". Use "Show pending proposals" to see valid numbers/ids.`;
          } else if (intentResult.intent === "proposal_reject") {
            const updated = await rejectProposal(cwd, ref, response.createdAt);
            response.intentSummary = `Rejected proposal ${target.id} (${target.title}). Local queue updated; no execution. Status: ${updated?.status ?? "rejected"}.`;
          } else {
            const updated = await dryRunProposalInQueue(cwd, ref, response.createdAt, process.env);
            const dr = updated?.dryRunResult;
            response.intentSummary = `Dry-run for proposal ${target.id} (${target.title}): ${dr?.wouldHappen ?? "simulated"}. ${dr?.executionDisabledReason ?? "Execution disabled."}`;
          }
        } catch {
          response.intentSummary = "Proposal command could not be applied to the local queue.";
        }
      }
      // Phase 14B cleanup — bulk local-only queue hygiene (never executes).
      else if (intentResult.intent === "proposal_reject_all_fitness") {
        try {
          const res = await rejectAllDraftProposals(cwd, response.createdAt, "fitness");
          response.intentSummary = `Rejected ${res.count} draft/pending fitness proposal(s) in the local queue. No execution.`;
        } catch {
          response.intentSummary = "Could not reject draft fitness proposals (local queue).";
        }
      } else if (intentResult.intent === "proposal_expire_duplicates") {
        try {
          const res = await expireDuplicateProposals(cwd, response.createdAt);
          response.intentSummary = `Expired ${res.count} duplicate proposal(s) (kept the newest of each title/domain/action). Local queue only; no execution.`;
        } catch {
          response.intentSummary = "Could not expire duplicate proposals (local queue).";
        }
      }
      // Refresh the persisted queue snapshot onto the response.
      try { response.proposalQueue = await listProposals(cwd); } catch { /* ignore */ }
    }
  } catch {
    // Intent routing is additive; never let it break a local read-only run.
  }

  if (shouldWrite) {
    const threadsDir = path.join(cwd, DEFAULT_COCKPIT_THREADS_DIR);
    const reportsDir = path.join(cwd, DEFAULT_COCKPIT_REPORTS_DIR);

    const existing = await loadThread(threadsDir, threadId);
    const entry: CockpitThreadEntry = { requestId, request, createdAt: response.createdAt, response };
    const thread: CockpitThread = existing
      ? { ...existing, updatedAt: response.createdAt, entries: [...existing.entries, entry] }
      : { threadId, createdAt: response.createdAt, updatedAt: response.createdAt, entries: [entry] };

    await writeThreadFile(threadsDir, thread);
    await writeMessageFile(threadsDir, response);
    const { mdPath } = await writeThreadReport(reportsDir, response, now);
    response.reportPaths.push(path.relative(cwd, mdPath));
  }

  return response;
}

/** Build a CockpitMessageInput from a raw request string. */
export function makeMessageInput(request: string, threadId?: string, now: Date = new Date()): CockpitMessageInput {
  return {
    request,
    source: "cockpit",
    createdAt: now.toISOString(),
    mode: DEFAULT_MODE,
    ...(threadId ? { threadId } : {}),
  };
}
