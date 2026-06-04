/**
 * tests/cockpit-proposals.test.ts
 *
 * Phase 14A — safe action proposal layer. Proposals are non-executable drafts;
 * execution fails closed; simulation never executes; gates behave correctly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateProposals,
  simulateProposal,
  executeProposal,
  executionAllowed,
  proposalsAllowed,
  ActionExecutionDisabledError,
  type ProposalContext,
} from "../src/cockpit/proposals/index.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary, ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-04T12:00:00.000Z";

function panels(): ReturnType<typeof buildDomainPanels> {
  const agentIntegration: AgentIntegrationSummary = { generatedAt: "t", configPresent: true, configPath: "x", configuredAgents: 2, detectedAgents: 2, agents: [], missingSources: [], nextRecommendedCommand: "x" };
  const fitnessRm: ReadModelSummary = { id: "fitness", type: "fitness", status: "ok", confidence: "high", lines: [], metrics: { recovery: "66" }, recommendation: "r", dataFreshness: NOW, degradedSources: [] };
  const opsRm: ReadModelSummary = { id: "ops", type: "ops", status: "ok", confidence: "high", lines: ["Active cards: 12."], metrics: { activeCards: "12", urgentCards: "3", blockedCards: "1" }, recommendation: "r", dataFreshness: NOW, degradedSources: [] };
  const readModels: ReadModelRegistrySummary = { generatedAt: "t", configPresent: true, configPath: "x", configuredReadModels: 2, enabledReadModels: 2, availability: [], summaries: [fitnessRm, opsRm], missingEnv: [], nextRecommendedCommand: "x" };
  const inputs: PanelInputs = { agentIntegration, readModels, reports: [], capability: { present: true, count: 1, byStatus: { promoted: 1 }, names: ["x"] }, modules: DEFAULT_MODULES, now: NOW };
  return buildDomainPanels(inputs);
}

function ctx(intent: ProposalContext["intent"], request: string, env: Record<string, string | undefined> = {}): ProposalContext {
  return { request, intent, panels: panels(), now: NOW, env };
}

describe("proposal generation — drafts only", () => {
  it("build_agent produces one non-executable draft, simulated", () => {
    const props = generateProposals(ctx("build_agent", "Create a tax agent"));
    assert.equal(props.length, 1);
    const p = props[0]!;
    assert.equal(p.executable, false);
    assert.equal(p.status, "draft"); // no gate
    assert.equal(p.requiredApproval, "Hart");
    assert.equal(p.riskLevel, "high"); // tax
    assert.ok(p.blockedReason.length > 0);
    assert.ok(p.dryRunResult && p.dryRunResult.executed === false);
  });

  it("proposals gate advances drafts to pending_approval", () => {
    const props = generateProposals(ctx("build_agent", "Create an invoice agent", { ALLOW_COCKPIT_ACTION_PROPOSALS: "true" }));
    assert.equal(props[0]!.status, "pending_approval");
    assert.equal(props[0]!.executable, false); // still never executable
  });

  it("improve_agent includes a test plan, no execution", () => {
    const props = generateProposals(ctx("improve_agent", "Improve the fitness agent"));
    assert.equal(props[0]!.actionType, "improve_agent_plan");
    assert.ok(Array.isArray((props[0]!.proposedPayload as { testPlan?: unknown }).testPlan));
  });

  it("explicit ops proposal request creates a read-only follow-up (no ClickUp write)", () => {
    const props = generateProposals(ctx("ops_status", "Draft a follow-up plan for urgent ops"));
    assert.equal(props[0]!.domain, "ops");
    assert.ok(/no ClickUp/i.test(props[0]!.expectedEffect));
  });

  it("system_status produces no proposals", () => {
    assert.equal(generateProposals(ctx("system_status", "What's my system status?")).length, 0);
  });

  it("ranked build plan for 'what should I build next?'", () => {
    const props = generateProposals(ctx("build_agent", "What should I build next?"));
    assert.equal(props[0]!.actionType, "ranked_build_plan");
  });
});

// ── Phase 13.6B — proposal spam guard: status questions create nothing ──
describe("proposal spam guard", () => {
  it("a plain fitness status question creates no proposal", () => {
    assert.equal(generateProposals(ctx("fitness_status", "How is my fitness agent today?")).length, 0);
  });
  it("a plain ops status question creates no proposal", () => {
    assert.equal(generateProposals(ctx("ops_status", "Anything urgent in ops?")).length, 0);
  });
  it("system_status / read_model_status create no proposal", () => {
    assert.equal(generateProposals(ctx("system_status", "What's my system status?")).length, 0);
    assert.equal(generateProposals(ctx("read_model_status", "Show read model status")).length, 0);
  });
  it("explicit 'propose' language on a fitness question DOES create a proposal", () => {
    const props = generateProposals(ctx("fitness_status", "Propose a fitness adjustment plan"));
    assert.equal(props.length, 1);
    assert.equal(props[0]!.domain, "fitness");
    assert.equal(props[0]!.executable, false);
  });
  it("build_agent and improve_agent still create proposals", () => {
    assert.equal(generateProposals(ctx("build_agent", "Create a tax agent")).length, 1);
    assert.equal(generateProposals(ctx("improve_agent", "Improve the fitness agent")).length, 1);
  });
  it("strategy_review still creates a proposal", () => {
    assert.equal(generateProposals(ctx("strategy_review", "Give me a CTO review")).length, 1);
  });
});

describe("execution fails closed", () => {
  it("executionAllowed is always false, even with the env set", () => {
    assert.equal(executionAllowed({ ALLOW_COCKPIT_ACTION_EXECUTION: "true" }), false);
  });
  it("executeProposal throws ActionExecutionDisabledError", () => {
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });
  it("proposalsAllowed reads its gate", () => {
    assert.equal(proposalsAllowed({ ALLOW_COCKPIT_ACTION_PROPOSALS: "true" }), true);
    assert.equal(proposalsAllowed({}), false);
  });
});

describe("simulation is read-only", () => {
  it("simulateProposal never executes and explains why", () => {
    const p = generateProposals(ctx("build_agent", "Create a tax agent"))[0]!;
    const dry = simulateProposal(p, { ALLOW_COCKPIT_ACTION_EXECUTION: "true" });
    assert.equal(dry.executed, false);
    assert.ok(dry.executionDisabledReason.length > 0);
    assert.ok(dry.futureSetupRequired.length > 0);
  });
  it("no secret-looking values appear in proposal output", () => {
    const blob = JSON.stringify(generateProposals(ctx("improve_agent", "Improve the ops agent")));
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(blob));
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(blob));
  });
});
