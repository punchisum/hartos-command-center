/**
 * src/cockpit/proposals/proposal-generator.ts
 *
 * Phase 14A.2 — generate non-executable ACTION PROPOSAL DRAFTS from a routed
 * Command HartOS intent + panel context. Pure. Every proposal is a draft (or
 * pending_approval when the proposals gate is on), is simulated (dry-run), and
 * is marked non-executable. Nothing here writes, calls a provider, or executes.
 */

import type { DomainPanel } from "../panels/index.js";
import type { CockpitIntent } from "../cockpit-intent-router.js";
import type { ActionProposal, ProposalActionType, ProposalDomain, ProposalRisk } from "./proposal-types.js";
import { simulateProposal } from "./proposal-simulator.js";
import { proposalsAllowed, executionDisabledReason, type GateEnv } from "./gates.js";
import { planAgentCreation } from "../agent-planner/index.js";

export interface ProposalOrchestratorContext {
  classification: string;
  domain: string;
  buildPlanSummary: string;
  capabilityGaps: string;
}

export interface ProposalContext {
  request: string;
  intent: CockpitIntent;
  panels: DomainPanel[];
  now: string;
  env?: GateEnv;
  orchestrator?: ProposalOrchestratorContext;
}

const SAFETY_NOTES = [
  "Non-executable draft — DRY-RUN ONLY.",
  "No provider / Supabase / ClickUp / Drive / Health / Telegram writes.",
  "Requires Hart approval before any future execution is even considered.",
];

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function panelById(panels: DomainPanel[], id: DomainPanel["id"]): DomainPanel | undefined {
  return panels.find((p) => p.id === id);
}

/**
 * Phase 13.6B — proposal spam guard. Read/status intents must NOT create a
 * proposal just because they mention a domain. A proposal is only created for a
 * status intent when the request uses EXPLICIT action/proposal language. Action
 * intents (build/improve/strategy) always create one regardless of this check.
 */
const EXPLICIT_PROPOSAL_RE =
  /\b(propose|proposal|action plan|make (a|an) plan|make an action plan|draft (a|an) plan|create (a|an) plan|plan draft|adjustment plan|follow[- ]?up plan|what should i do(?: next)?|what do i do next)\b/i;

export function requestsExplicitProposal(request: string): boolean {
  return EXPLICIT_PROPOSAL_RE.test(request);
}

/**
 * Phase 15C — explicit refresh / sync-repair planning language. A plain freshness
 * STATUS question ("is my data fresh?", "why is ops stale?") must NOT match; only
 * a request to PLAN/FIX/REFRESH should.
 */
const REFRESH_PLAN_RE =
  /\b(refresh|sync|repair)\b[\w\s]*\b(plan|proposal)\b|\b(create|draft|make|prepare|build)\b[\w\s]*\b(refresh|sync|repair)\b|\bfix stale\b|\bwhat should i do\b[\w\s]*\b(stale|fix|refresh|sync)\b/i;

export function requestsRefreshPlan(request: string): boolean {
  return REFRESH_PLAN_RE.test(request);
}

function addHours(iso: string, hours: number): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + hours * 3600_000).toISOString();
}

interface DraftSpec {
  domain: ProposalDomain;
  actionType: ProposalActionType;
  title: string;
  description: string;
  expectedEffect: string;
  riskLevel: ProposalRisk;
  proposedPayload: Record<string, unknown>;
  expiresAt?: string | null;
}

function build(ctx: ProposalContext, spec: DraftSpec): ActionProposal {
  const status = proposalsAllowed(ctx.env) ? "pending_approval" : "draft";
  const proposal: ActionProposal = {
    id: `prop-${slug(spec.title)}-${ctx.now}`,
    domain: spec.domain,
    actionType: spec.actionType,
    title: spec.title,
    description: spec.description,
    sourceIntent: `${ctx.intent}: ${ctx.request}`,
    proposedPayload: spec.proposedPayload,
    expectedEffect: spec.expectedEffect,
    riskLevel: spec.riskLevel,
    requiredApproval: "Hart",
    status,
    createdAt: ctx.now,
    expiresAt: spec.expiresAt ?? null,
    safetyNotes: SAFETY_NOTES,
    blockedReason: executionDisabledReason(ctx.env),
    dryRunResult: null,
    executable: false,
  };
  proposal.dryRunResult = simulateProposal(proposal, ctx.env);
  return proposal;
}

/** Generate proposal drafts for the routed intent. Returns [] for status-only intents. */
export function generateProposals(ctx: ProposalContext): ActionProposal[] {
  const out: ActionProposal[] = [];
  const o = ctx.orchestrator;

  switch (ctx.intent) {
    case "build_agent": {
      const wantsRanked = /what should i build|what to build|build next|what next/i.test(ctx.request);
      if (wantsRanked) {
        out.push(build(ctx, {
          domain: "factory", actionType: "ranked_build_plan",
          title: "Ranked build plan",
          description: "Produce a ranked list of candidate builds from current gaps + capability registry.",
          expectedEffect: "A prioritized build shortlist with rationale (no repo created).",
          riskLevel: "low",
          proposedPayload: { basis: "panel gaps + capability registry", gaps: o?.capabilityGaps ?? "n/a" },
        }));
      } else {
        // Phase 17A — explicit "create a <X> agent" yields a structured, dry-run
        // Agent Creation Plan (spec draft + skills + scaffold outline + provider
        // plan), surfaced as a non-executable proposal. Nothing is created.
        const plan = planAgentCreation(ctx.request);
        out.push(build(ctx, {
          domain: "factory", actionType: "agent_creation_plan",
          title: `Create \`${plan.draft.name}\` — agent creation plan (dry-run)`,
          description:
            `Plan-only proposal to create the ${plan.draft.name} agent: ${ctx.request}. ` +
            `Generates the spec, chooses skills/templates, outlines the repo scaffold and a ` +
            `provider provisioning plan. NO repo is created, NO provider is called, NO code is written.`,
          expectedEffect:
            `A reviewable agent creation plan (spec draft + ${plan.recommendedSkills.length} skills + ` +
            `scaffold outline + provider plan). Nothing is executed.`,
          riskLevel: plan.draft.riskLevel,
          proposedPayload: {
            request: ctx.request,
            agentName: plan.draft.name,
            classification: plan.classification.classification,
            domain: plan.classification.domain,
            strategyVerdict: plan.strategy.verdict,
            readyToPlanScaffold: plan.readyToPlanScaffold,
            clarifyingQuestions: plan.draft.clarifyingQuestions,
            recommendedSkills: plan.recommendedSkills,
            requiredCapabilities: plan.requiredCapabilities,
            scaffoldPlan: plan.scaffoldPlan,
            providerPlan: plan.providerPlan,
            approvalGates: plan.approvalGates,
            risks: plan.risks,
            doNotBuild: plan.doNotBuild,
            summary: plan.summary,
          },
        }));
      }
      break;
    }
    case "improve_agent": {
      const targetAgent = /ops|operation/i.test(ctx.request) ? "ops" : /fitness|training|recovery/i.test(ctx.request) ? "fitness" : "fitness";
      const panel = panelById(ctx.panels, targetAgent as DomainPanel["id"]);
      out.push(build(ctx, {
        domain: targetAgent as ProposalDomain, actionType: "improve_agent_plan",
        title: `Improve the ${targetAgent} agent (plan draft)`,
        description: `Draft an improvement plan for the ${targetAgent} agent. No code is changed.`,
        expectedEffect: "A change plan (target files/modules) + test plan (not executed).",
        riskLevel: "medium",
        proposedPayload: { targetAgent, improvements: panel?.missingSetupSteps ?? [], testPlan: ["typecheck", "unit tests for changed modules", "cockpit dry-run"] },
      }));
      break;
    }
    case "ops_status": {
      // Phase 13.6B — a plain ops status question does not create a proposal.
      if (!requestsExplicitProposal(ctx.request)) break;
      const ops = panelById(ctx.panels, "ops");
      const hasSignal = (ops?.highlights ?? []).some((h) => /urgent|blocked|risk/i.test(h));
      out.push(build(ctx, {
        domain: "ops", actionType: "ops_followup_plan",
        title: hasSignal ? "Prepare ops follow-up plan" : "Review ops items",
        description: hasSignal
          ? "Draft a follow-up plan for urgent/blocked ops items (read-only; no ClickUp write)."
          : "Draft a review note for current ops items (read-only; no ClickUp write).",
        expectedEffect: "A read-only follow-up/review note. No ClickUp/provider write.",
        riskLevel: "medium",
        proposedPayload: { signals: ops?.highlights ?? [], gaps: ops?.gaps?.slice(0, 3) ?? [] },
        expiresAt: addHours(ctx.now, 24),
      }));
      break;
    }
    case "fitness_status": {
      // Phase 13.6B — a plain fitness status question does not create a proposal.
      if (!requestsExplicitProposal(ctx.request)) break;
      const fitness = panelById(ctx.panels, "fitness");
      if (fitness?.detected) {
        out.push(build(ctx, {
          domain: "fitness", actionType: "fitness_adjustment_plan",
          title: "Fitness adjustment plan draft",
          description: "Draft a training/nutrition adjustment from read-only recovery/load data.",
          expectedEffect: "A suggested adjustment note (no coaching action taken).",
          riskLevel: "low",
          proposedPayload: { basis: fitness.highlights, nextAction: fitness.nextAction },
        }));
      }
      break;
    }
    case "freshness_status": {
      // Phase 15C — a plain freshness/sync STATUS question creates no proposal.
      // Only an explicit refresh/sync-repair planning request does.
      if (!requestsExplicitProposal(ctx.request) && !requestsRefreshPlan(ctx.request)) break;
      const ops = panelById(ctx.panels, "ops");
      const staleSignals = (ops?.gaps ?? []).filter((g) => /stale|sync/i.test(g));
      out.push(build(ctx, {
        domain: "ops", actionType: "sync_repair_plan",
        title: "Refresh / sync repair plan (ops)",
        description:
          "Draft a manual plan to re-run the ClickUp import and re-verify ops freshness. No import is triggered; no provider/ClickUp write.",
        expectedEffect: "A read-only checklist to refresh stale data (manual). No execution.",
        riskLevel: "low",
        proposedPayload: {
          staleSignals,
          steps: [
            "Re-run the ClickUp import (manually, outside HartOS).",
            "Re-run `npm run read-models:status` to confirm freshness.",
            "Re-check ops status in the cockpit.",
          ],
        },
        expiresAt: addHours(ctx.now, 24),
      }));
      break;
    }
    case "strategy_review": {
      out.push(build(ctx, {
        domain: "system", actionType: "review_plan",
        title: "Strategy / CTO review note draft",
        description: "Compile a grounded strategy/CTO review from read-only context.",
        expectedEffect: "A review note + recommended next move (no action taken).",
        riskLevel: "low",
        proposedPayload: { basis: "panels + orchestrator review" },
      }));
      break;
    }
    default:
      break; // system_status / unknown → no proposals
  }
  return out;
}
