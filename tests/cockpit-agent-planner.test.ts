/**
 * tests/cockpit-agent-planner.test.ts — Phase 17A.
 *
 * The Agent Creation Planner is PURE and DRY-RUN ONLY: it turns a "create a <X>
 * agent" request into a structured, non-executable plan (spec draft + clarifying
 * questions + skills + scaffold outline + provider plan) and surfaces it as a
 * non-executable proposal. These tests assert the planning shape, the
 * requirements/clarifying-question flow, and that nothing is executable or
 * created. No filesystem, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planAgentCreation,
  buildAgentDraft,
  deriveAgentName,
  recommendSkills,
  planScaffold,
  planProviders,
} from "../src/cockpit/agent-planner/index.js";
import { generateProposals } from "../src/cockpit/proposals/index.js";
import { routeCockpitIntent, type IntentRouterContext } from "../src/cockpit/cockpit-intent-router.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary } from "../src/read-models/read-model-types.js";
import type { CockpitSystemSummary } from "../src/cockpit/cockpit-types.js";

const NOW = "2026-06-04T12:00:00.000Z";

describe("agent planner — draft + clarifying questions", () => {
  it("derives a kebab agent name from the request", () => {
    assert.equal(deriveAgentName("Create a tax agent", "finance"), "tax-agent");
    assert.equal(deriveAgentName("build an invoice agent", "finance"), "invoice-agent");
    assert.equal(deriveAgentName("make a trade ops agent", "ops"), "trade-ops-agent");
    assert.equal(deriveAgentName("something vague", "ops"), "ops-agent");
  });

  it("flags missing requirements as clarifying questions", () => {
    const d = buildAgentDraft("Create a tax agent");
    assert.deepEqual(d.missingFields, ["commands", "dataSources", "interfaces"]);
    assert.equal(d.clarifyingQuestions.length, 3);
    assert.equal(d.name, "tax-agent");
  });

  it("clears missing fields once answers are supplied", () => {
    const d = buildAgentDraft("Create a tax agent", {
      commands: ["log expense", "export to accountant"],
      dataSources: ["receipts table"],
      interfaces: ["telegram"],
    });
    assert.deepEqual(d.missingFields, []);
    assert.equal(d.clarifyingQuestions.length, 0);
  });
});

describe("agent planner — skill + provider selection", () => {
  it("recommends catalog skills and adds context-specific ones", () => {
    const d = buildAgentDraft("Create a tax agent", { interfaces: ["telegram"], dataSources: ["supabase receipts"] });
    const skills = recommendSkills(d);
    for (const base of ["agent-factory", "system-architect", "verification-loop", "security-review", "handover-writer", "credential-manager"]) {
      assert.ok(skills.includes(base), `expected base skill ${base}`);
    }
    assert.ok(skills.includes("telegram-command-builder"));
    assert.ok(skills.includes("supabase-rpc-builder"));
  });

  it("provider plan lists gates and never marks a read as mutation", () => {
    const d = buildAgentDraft("Create a tax agent", { interfaces: ["telegram"] });
    const providers = planProviders(d);
    const names = providers.map((p) => p.provider);
    assert.ok(names.includes("github") && names.includes("supabase") && names.includes("cloudflare"));
    assert.ok(names.includes("telegram"), "telegram interface should add the telegram provider");
    for (const p of providers) assert.ok(p.gate.length > 0, `${p.provider} must name a gate`);
    assert.equal(providers.find((p) => p.provider === "openai")!.mutation, false);
  });

  it("scaffold plan is plan-level only — nothing is created", () => {
    const d = buildAgentDraft("Create a tax agent");
    const items = planScaffold(d, ["agent-factory"]);
    assert.ok(items.length > 0);
    for (const i of items) assert.match(i.note, /not created/i);
    assert.ok(items.some((i) => i.path.endsWith("agent.yaml")));
  });
});

describe("agent planner — full plan", () => {
  it("produces a complete dry-run plan for a tax agent (high-risk domain)", () => {
    const plan = planAgentCreation("Create a tax agent");
    assert.equal(plan.draft.name, "tax-agent");
    assert.equal(plan.classification.classification, "new_agent_build");
    assert.ok(plan.requiredCapabilities.length > 0, "tax_specialist has required capabilities");
    assert.ok(plan.recommendedSkills.includes("security-review"));
    assert.equal(plan.readyToPlanScaffold, false);
    assert.ok(plan.draft.clarifyingQuestions.length > 0);
    assert.ok(plan.approvalGates.some((g) => /ALLOW_AUTO_PROVISION/.test(g)));
    assert.ok(plan.approvalGates.some((g) => /Hart approval/i.test(g)));
    assert.ok(plan.risks.some((r) => /financial|tax/i.test(r)), "financial/tax risk must be flagged");
    assert.match(plan.summary, /dry-run|planned only/i);
  });

  it("becomes ready once requirements are answered", () => {
    const plan = planAgentCreation("Create a tax agent", {
      answers: { commands: ["log expense"], dataSources: ["receipts"], interfaces: ["telegram"] },
    });
    assert.equal(plan.readyToPlanScaffold, true);
    assert.equal(plan.draft.clarifyingQuestions.length, 0);
  });

  it("never invents/stores a secret in planner-generated content", () => {
    // The request itself echoes back (it is the user's own text) — that is not a
    // leak, and the proposal queue secret-scans on write. What must be clean is
    // everything the planner GENERATES (skills, scaffold, providers, gates).
    const plan = planAgentCreation("Create a tax agent with my key sk-deadbeefdeadbeefdeadbeef");
    const generated = JSON.stringify({
      name: plan.draft.name,
      recommendedSkills: plan.recommendedSkills,
      requiredCapabilities: plan.requiredCapabilities,
      scaffoldPlan: plan.scaffoldPlan,
      providerPlan: plan.providerPlan,
      approvalGates: plan.approvalGates,
    });
    assert.equal(/sk-[A-Za-z0-9]{20}/.test(generated), false);
  });
});

// ── Proposal + router integration ────────────────────────────────────────────

function minimalPanels() {
  const agentIntegration: AgentIntegrationSummary = {
    generatedAt: NOW, configPresent: false, configPath: null, configuredAgents: 0,
    detectedAgents: 0, agents: [], missingSources: [], nextRecommendedCommand: "x",
  };
  const readModels: ReadModelRegistrySummary = {
    generatedAt: NOW, configPresent: false, configPath: null, configuredReadModels: 0,
    enabledReadModels: 0, availability: [], summaries: [], missingEnv: [], nextRecommendedCommand: "x",
  };
  const inputs: PanelInputs = {
    agentIntegration, readModels, reports: [],
    capability: { present: false, count: 0, byStatus: {}, names: [] },
    modules: DEFAULT_MODULES, now: NOW,
  };
  return buildDomainPanels(inputs);
}

const SYSTEM: CockpitSystemSummary = {
  cardCount: 0, groups: [], missingSourceCount: 0, readOnlyActionCount: 0,
  approvalRequiredActionCount: 0, manualRequiredActionCount: 0, forbiddenActionCount: 0,
  reportCount: 0, latestRequest: null, latestStrategyVerdict: null, latestCtoVerdict: null,
  nextRecommendedCommand: "x",
};

describe("agent planner — proposal integration", () => {
  it("emits a non-executable agent_creation_plan proposal for an explicit create", () => {
    const proposals = generateProposals({
      request: "Create a tax agent",
      intent: "build_agent",
      panels: minimalPanels(),
      now: NOW,
      env: {},
    });
    assert.equal(proposals.length, 1);
    const p = proposals[0]!;
    assert.equal(p.actionType, "agent_creation_plan");
    assert.equal(p.executable, false);
    assert.ok(p.dryRunResult && p.dryRunResult.executed === false);
    assert.equal(p.requiredApproval, "Hart");
    assert.equal((p.proposedPayload as { agentName?: string }).agentName, "tax-agent");
    assert.ok(Array.isArray((p.proposedPayload as { clarifyingQuestions?: string[] }).clarifyingQuestions));
  });

  it("keeps the ranked path unchanged for 'what should I build next'", () => {
    const proposals = generateProposals({
      request: "What should I build next?",
      intent: "build_agent",
      panels: minimalPanels(),
      now: NOW,
      env: {},
    });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]!.actionType, "ranked_build_plan");
  });
});

describe("agent planner — router surfacing", () => {
  function ctx(request: string): IntentRouterContext {
    return { request, panels: minimalPanels(), systemSummary: SYSTEM, now: NOW, env: {} };
  }

  it("routes an explicit create to build_agent with a clarifying question", () => {
    const r = routeCockpitIntent(ctx("Create a tax agent"));
    assert.equal(r.intent, "build_agent");
    assert.ok(r.clarifyingQuestion, "should ask for a missing requirement");
    assert.match(r.summary, /dry-run|planned only/i);
    assert.equal(r.proposals.length, 1);
    assert.equal(r.proposals[0]!.actionType, "agent_creation_plan");
    assert.equal(r.proposals[0]!.executable, false);
  });

  it("does not ask a clarifying question for the ranked build path", () => {
    const r = routeCockpitIntent(ctx("What should I build next?"));
    assert.equal(r.intent, "build_agent");
    assert.equal(r.clarifyingQuestion, null);
  });
});
