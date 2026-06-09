/**
 * tests/cockpit-intent-router.test.ts
 *
 * Phase 12B — deterministic Command HartOS router. Covers every required
 * command from the spec and asserts grounded (panel-driven) answers, not bare
 * classifications.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectCockpitIntent,
  routeCockpitIntent,
  parseProposalRef,
  computeOpsVerdict,
  type IntentRouterContext,
  type IntentOrchestratorContext,
} from "../src/cockpit/cockpit-intent-router.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary, ReadModelSummary } from "../src/read-models/read-model-types.js";
import type { CockpitSystemSummary } from "../src/cockpit/cockpit-types.js";

function rmSummary(type: "fitness" | "ops", metrics: Record<string, string | number>, lines: string[] = []): ReadModelSummary {
  return { id: type, type, status: "ok", confidence: "high", lines, metrics, recommendation: "read-only", dataFreshness: "2026-06-04", degradedSources: [] };
}

function panelsWithData(): ReturnType<typeof buildDomainPanels> {
  const agentIntegration: AgentIntegrationSummary = { generatedAt: "t", configPresent: true, configPath: "x", configuredAgents: 2, detectedAgents: 2, agents: [], missingSources: [], nextRecommendedCommand: "npm run agents:status" };
  const readModels: ReadModelRegistrySummary = { generatedAt: "t", configPresent: true, configPath: "x", configuredReadModels: 2, enabledReadModels: 2, availability: [], summaries: [rmSummary("fitness", { recovery: "66", latestWorkout: "easy run" }), rmSummary("ops", { activeCards: "12", urgentCards: "3", blockedCards: "1" }, ["Active cards: 12."])], missingEnv: [], nextRecommendedCommand: "npm run read-models:status" };
  const inputs: PanelInputs = { agentIntegration, readModels, reports: [], capability: { present: true, count: 2, byStatus: { promoted: 2 }, names: ["receipt_ocr"] }, modules: DEFAULT_MODULES, now: "t" };
  return buildDomainPanels(inputs);
}

const SYSTEM: CockpitSystemSummary = {
  cardCount: 22, groups: ["orchestrator", "factory", "agents"], missingSourceCount: 3,
  readOnlyActionCount: 5, approvalRequiredActionCount: 1, manualRequiredActionCount: 0, forbiddenActionCount: 2,
  reportCount: 4, latestRequest: null, latestStrategyVerdict: null, latestCtoVerdict: null,
  nextRecommendedCommand: "npm run hartos:handover",
};

const ORCH: IntentOrchestratorContext = {
  classification: "new_agent_build", domain: "finance",
  strategyReview: "BUILD_LATER — fits the roadmap", ctoReview: "buildable (missing: none)",
  buildPlanSummary: "4 phase(s); do-not-build: 1 item(s)", capabilityGaps: "3 usable, 2 missing",
  nextRecommendedCommand: "npm run beezulbub:capability-list",
};

function ctx(request: string, withOrch = true): IntentRouterContext {
  return {
    request,
    panels: panelsWithData(),
    systemSummary: SYSTEM,
    integration: { configPresent: true, agentsConfigured: 2, agentsDetected: 2, readModelsEnabled: 2 },
    llm: { provider: "deterministic", mode: "fallback" },
    ...(withOrch ? { orchestrator: ORCH } : {}),
  };
}

describe("intent detection — required commands", () => {
  const cases: Array<[string, string]> = [
    ["What's my system status?", "system_status"],
    ["Show system status", "system_status"],
    ["How is HartOS?", "system_status"],
    ["How is my fitness agent today?", "fitness_status"],
    ["What's my training today?", "fitness_status"],
    ["How's recovery?", "fitness_status"],
    ["How many calories/protein left?", "fitness_status"],
    ["Anything urgent in ops?", "ops_status"],
    ["What changed in ops?", "ops_status"],
    ["Show latest ops updates", "ops_status"],
    ["Any blocked cards?", "ops_status"],
    ["What should I build next?", "build_agent"],
    ["Create a tax agent", "build_agent"],
    ["Create an invoice agent", "build_agent"],
    ["Improve the fitness agent", "improve_agent"],
    ["Improve the ops agent", "improve_agent"],
    ["What is the highest leverage next move?", "strategy_review"],
    ["What am I missing?", "strategy_review"],
    ["Give me a CTO review", "strategy_review"],
  ];
  for (const [req, expected] of cases) {
    it(`"${req}" → ${expected}`, () => {
      assert.equal(detectCockpitIntent(req).intent, expected);
    });
  }
  it("unrecognized → unknown", () => {
    assert.equal(detectCockpitIntent("zxcv qwer asdf").intent, "unknown");
  });
});

describe("grounded answers", () => {
  it("system_status summarizes cockpit/factory/ops/fitness/LLM, not just a label", () => {
    const r = routeCockpitIntent(ctx("What's my system status?"));
    assert.equal(r.intent, "system_status");
    assert.equal(r.usesOrchestrator, false);
    for (const token of ["Cockpit:", "Factory:", "Ops Agent:", "Fitness Agent:", "LLM gateway:"]) {
      assert.ok(r.summary.includes(token), `summary missing ${token}`);
    }
  });

  it("fitness_status uses the panel summary (recovery surfaced)", () => {
    const r = routeCockpitIntent(ctx("How is my fitness agent today?"));
    assert.equal(r.intent, "fitness_status");
    assert.ok(r.summary.includes("Recovery: 66"), "must surface real recovery value");
    assert.ok(r.nextSteps.length > 0);
  });

  it("ops_status leads with a verdict and grounds urgent/blocked counts", () => {
    const r = routeCockpitIntent(ctx("Anything urgent in ops?"));
    assert.equal(r.intent, "ops_status");
    // urgentCards:3 / blockedCards:1 → red verdict.
    assert.ok(/^Ops is red\./.test(r.summary), "must open with a red verdict");
    assert.ok(r.summary.includes("Main action:"), "must give a single main action");
    assert.ok(r.summary.includes("3 urgent"), "grounds urgent count");
    assert.ok(r.summary.includes("1 blocked/risk"), "grounds blocked count");
  });

  it("build_agent produces a plan using orchestrator context", () => {
    const r = routeCockpitIntent(ctx("Create a tax agent"));
    assert.equal(r.intent, "build_agent");
    assert.equal(r.usesOrchestrator, true);
    assert.ok(r.summary.includes("new_agent_build"));
    assert.ok(r.nextSteps.some((s) => s.includes("beezulbub:capability-list")));
  });

  it("build_agent Inbox triage refuses an unsafe build request", () => {
    const r = routeCockpitIntent(ctx("Create an agent that moves money between my bank accounts"));
    assert.equal(r.intent, "build_agent");
    assert.ok(/REFUSED \(unsafe\)/i.test(r.summary));
    assert.ok(!r.clarifyingQuestion);
  });

  it("build_agent Inbox triage flags an already-solved request", () => {
    const r = routeCockpitIntent(ctx("Build a fitness tracker agent"));
    assert.equal(r.intent, "build_agent");
    assert.ok(/already solved/i.test(r.summary));
  });

  it("improve_agent targets the named agent with concrete steps", () => {
    const r = routeCockpitIntent(ctx("Improve the fitness agent"));
    assert.equal(r.intent, "improve_agent");
    assert.ok(r.summary.includes("Fitness Agent"));
    assert.ok(r.nextSteps.length > 0);
  });

  it("strategy_review grounds in strategy/CTO + leverage", () => {
    const r = routeCockpitIntent(ctx("What is the highest leverage next move?"));
    assert.equal(r.intent, "strategy_review");
    assert.equal(r.usesOrchestrator, true);
    assert.ok(r.summary.includes("BUILD_LATER"));
    assert.ok(r.summary.toLowerCase().includes("leverage"));
  });

  it("unknown asks a clarifying question + suggests commands", () => {
    const r = routeCockpitIntent(ctx("zxcv qwer", false));
    assert.equal(r.intent, "unknown");
    assert.ok(r.clarifyingQuestion && r.clarifyingQuestion.length > 0);
    assert.ok(r.suggestedCommands.length > 0);
  });

  it("works without orchestrator context (deterministic fallback)", () => {
    const r = routeCockpitIntent(ctx("Create a tax agent", false));
    assert.equal(r.intent, "build_agent");
    assert.ok(r.summary.length > 0);
  });
});

describe("Phase 14A — proposal awareness", () => {
  function withNow(request: string): IntentRouterContext {
    return { ...ctx(request), now: "2026-06-04T12:00:00.000Z", env: {} };
  }
  it("build/improve intents attach non-executable proposal drafts", () => {
    const build = routeCockpitIntent(withNow("Create a tax agent"));
    assert.ok(build.proposals.length >= 1);
    assert.equal(build.proposals[0]!.executable, false);
    const improve = routeCockpitIntent(withNow("Improve the fitness agent"));
    assert.ok(improve.proposals.length >= 1);
  });
  it("status-only intents attach no proposals", () => {
    assert.equal(routeCockpitIntent(withNow("What's my system status?")).proposals.length, 0);
  });
  it("without `now`, no proposals are generated (pure routing)", () => {
    assert.equal(routeCockpitIntent(ctx("Create a tax agent")).proposals.length, 0);
  });
});

describe("Phase 13.5E + 14B — diagnostics + queue intents", () => {
  const diagCases: Array<[string, string]> = [
    ["Show read model status", "read_model_status"],
    ["What sources are connected?", "read_model_status"],
    ["What data is stale?", "read_model_status"],
    ["Why is my fitness panel missing data?", "read_model_status"],
    ["Why is my ops panel missing data?", "read_model_status"],
    ["Show pending proposals", "proposal_list"],
    ["Reject proposal 1", "proposal_reject"],
    ["Dry run proposal 2", "proposal_dryrun"],
    ["Reject all draft fitness proposals", "proposal_reject_all_fitness"],
    ["Expire duplicate proposals", "proposal_expire_duplicates"],
    ["Show proposal history", "proposal_history"],
  ];
  for (const [req, expected] of diagCases) {
    it(`"${req}" → ${expected}`, () => {
      assert.equal(detectCockpitIntent(req).intent, expected);
    });
  }

  it("parseProposalRef extracts number or id", () => {
    assert.deepEqual(parseProposalRef("Reject proposal 3"), { number: 3 });
    assert.deepEqual(parseProposalRef("Dry run proposal prop-build-x"), { id: "prop-build-x" });
    assert.deepEqual(parseProposalRef("Show proposals"), {});
  });

  it("read_model_status answers from diagnostics (no secrets)", () => {
    const diagnostics = {
      generatedAt: "t", configPresent: true, configPath: "read-models.local.json",
      domains: [{ domain: "fitness" as const, configured: true, enabled: true, status: "stale" as const, freshness: "stale" as const, resolvedFields: 2, missingEnv: [], rejectedUnsafe: false, setupStep: "refresh", note: "stale" }],
      configuredSources: ["fitness"], enabledSources: ["fitness"], disabledSources: [], missingSources: [], staleSources: ["fitness"], rejectedSources: [],
    };
    const r = routeCockpitIntent({ ...ctx("Show read model status"), diagnostics });
    assert.equal(r.intent, "read_model_status");
    assert.ok(r.summary.includes("Configured: fitness"));
    assert.ok(r.summary.includes("Stale: fitness"));
  });

  it("proposal_list answers from the queue", () => {
    const proposalQueue = [{
      id: "prop-x", domain: "factory" as const, actionType: "build_agent_plan" as const, title: "Build draft",
      description: "d", sourceIntent: "i", proposedPayload: {}, expectedEffect: "e", riskLevel: "high" as const,
      requiredApproval: "Hart" as const, status: "draft" as const, createdAt: "t", updatedAt: "t", expiresAt: null,
      safetyNotes: [], blockedReason: "disabled", dryRunResult: null, executable: false as const, auditEvents: [],
    }];
    const r = routeCockpitIntent({ ...ctx("Show pending proposals"), proposalQueue });
    assert.equal(r.intent, "proposal_list");
    assert.ok(r.summary.includes("Build draft"));
    assert.ok(r.summary.includes("prop-x"));
  });

  it("proposal_history rolls up status counts (read-only)", () => {
    const item = (status: string, id: string) => ({
      id, domain: "fitness" as const, actionType: "fitness_adjustment_plan" as const, title: id,
      description: "d", sourceIntent: "i", proposedPayload: {}, expectedEffect: "e", riskLevel: "low" as const,
      requiredApproval: "Hart" as const, status, createdAt: "t", updatedAt: "t", expiresAt: null,
      safetyNotes: [], blockedReason: "disabled", dryRunResult: null, executable: false as const, auditEvents: [],
    });
    const proposalQueue = [item("draft", "a"), item("rejected", "b"), item("expired", "c")] as never;
    const r = routeCockpitIntent({ ...ctx("Show proposal history"), proposalQueue });
    assert.equal(r.intent, "proposal_history");
    assert.ok(r.summary.includes("3 total"));
    assert.ok(/Pending: 1/.test(r.summary));
    assert.ok(/Rejected: 1/.test(r.summary));
    assert.ok(/Expired: 1/.test(r.summary));
  });
});

// ── Phase 13.6B — status questions attach NO proposals; action intents do ──
describe("proposal spam guard at the router", () => {
  const withNow = (request: string) => routeCockpitIntent({ ...ctx(request), now: "2026-06-04T12:00:00.000Z", env: {} });

  for (const q of ["How is my fitness agent today?", "Anything urgent in ops?", "What's my system status?", "Show read model status"]) {
    it(`status question creates no proposal: "${q}"`, () => {
      assert.equal(withNow(q).proposals.length, 0);
    });
  }

  it("build/improve requests still attach a proposal", () => {
    assert.equal(withNow("Create a tax agent").proposals.length, 1);
    assert.equal(withNow("Improve the fitness agent").proposals.length, 1);
  });

  it("explicit 'propose' on a fitness question attaches a proposal", () => {
    const r = withNow("Propose a fitness adjustment plan");
    assert.equal(r.proposals.length, 1);
    assert.equal(r.proposals[0]!.domain, "fitness");
    assert.equal(r.proposals[0]!.executable, false);
  });
});

// ── Phase 15B — operator-style ops answer (verdict + executive summary) ──
describe("Phase 15B — ops operator answer", () => {
  const NOW = "2026-06-04T12:00:00.000Z";
  const FRESH = "2026-06-04T06:00:00.000Z"; // < 24h before NOW
  const STALE = "2026-06-02T00:00:00.000Z"; // > 24h before NOW

  function opsRm(metrics: Record<string, string | number>, dataFreshness: string | null): ReadModelSummary {
    return { id: "ops", type: "ops", status: "ok", confidence: "high", lines: ["Active cards."], metrics, recommendation: "r", dataFreshness, degradedSources: [] };
  }

  function opsCtx(
    metrics: Record<string, string | number>,
    opts: { now?: string; dataFreshness?: string | null; withNow?: boolean } = {}
  ): IntentRouterContext {
    const now = opts.now ?? NOW;
    const dataFreshness = opts.dataFreshness === undefined ? FRESH : opts.dataFreshness;
    const agentIntegration: AgentIntegrationSummary = { generatedAt: now, configPresent: true, configPath: "x", configuredAgents: 1, detectedAgents: 1, agents: [], missingSources: [], nextRecommendedCommand: "npm run agents:status" };
    const readModels: ReadModelRegistrySummary = { generatedAt: now, configPresent: true, configPath: "x", configuredReadModels: 1, enabledReadModels: 1, availability: [], summaries: [opsRm(metrics, dataFreshness)], missingEnv: [], nextRecommendedCommand: "npm run read-models:status" };
    const inputs: PanelInputs = { agentIntegration, readModels, reports: [], capability: { present: false, count: 0, byStatus: {}, names: [] }, modules: DEFAULT_MODULES, now };
    const panels = buildDomainPanels(inputs);
    return {
      request: "Show ops status",
      panels,
      systemSummary: SYSTEM,
      integration: { configPresent: true, agentsConfigured: 1, agentsDetected: 1, readModelsEnabled: 1 },
      llm: { provider: "deterministic", mode: "fallback" },
      ...(opts.withNow ? { now, env: {} } : {}),
    };
  }

  it("computeOpsVerdict: red beats amber beats green", () => {
    assert.equal(computeOpsVerdict({ urgent: 1, blocked: 0, waiting: 5, stale: 5, noNextAction: 5, clickupStale: true }), "red");
    assert.equal(computeOpsVerdict({ urgent: 0, blocked: 2, waiting: 0, stale: 0, noNextAction: 0, clickupStale: false }), "red");
    assert.equal(computeOpsVerdict({ urgent: 0, blocked: 0, waiting: 2, stale: 0, noNextAction: 0, clickupStale: false }), "amber");
    assert.equal(computeOpsVerdict({ urgent: 0, blocked: 0, waiting: 0, stale: 0, noNextAction: 0, clickupStale: true }), "amber");
    assert.equal(computeOpsVerdict({ urgent: 0, blocked: 0, waiting: 0, stale: 0, noNextAction: 0, clickupStale: false }), "green");
  });

  it("ops AMBER when waiting_on_hart > 0 (no urgent/blocked, fresh sync)", () => {
    const r = routeCockpitIntent(opsCtx({ activeCards: 9, waitingCards: 2 }));
    assert.ok(/^Ops is amber\./.test(r.summary), `expected amber, got: ${r.summary}`);
    assert.ok(/waiting on Hart/i.test(r.summary), "must name the waiting-on-Hart signal");
    assert.ok(/Main action: Unblock the 2 cards waiting on Hart\./.test(r.summary), "main action unblocks waiting cards");
    assert.ok(r.highlights.some((h) => h === "Verdict: AMBER."), "verdict highlight present");
  });

  it("ops RED when urgent > 0", () => {
    const r = routeCockpitIntent(opsCtx({ activeCards: 9, urgentCards: 3 }));
    assert.ok(/^Ops is red\./.test(r.summary), `expected red, got: ${r.summary}`);
    assert.ok(r.summary.includes("3 urgent"));
    assert.ok(/Main action: Action the 3 urgent cards\./.test(r.summary));
  });

  it("ops RED when blocked/risk > 0 (triage first)", () => {
    const r = routeCockpitIntent(opsCtx({ activeCards: 9, blockedCards: 1 }));
    assert.ok(/^Ops is red\./.test(r.summary), `expected red, got: ${r.summary}`);
    assert.ok(/Main action: Triage the 1 blocked\/at-risk card first\./.test(r.summary));
  });

  it("ops GREEN when no attention flags and sync is fresh", () => {
    const r = routeCockpitIntent(opsCtx({ activeCards: 5 }));
    assert.ok(/^Ops is green\./.test(r.summary), `expected green, got: ${r.summary}`);
    assert.ok(/Nothing needs your attention/i.test(r.summary));
  });

  it("stale freshness is surfaced as a ClickUp sync warning (amber)", () => {
    const r = routeCockpitIntent(opsCtx({ activeCards: 9 }, { dataFreshness: STALE }));
    assert.ok(/^Ops is amber\./.test(r.summary), `expected amber from staleness, got: ${r.summary}`);
    assert.ok(/ClickUp sync appears stale/i.test(r.summary), "amber reason names stale sync");
    assert.ok(/STALE/.test(r.summary), "explicit STALE warning line");
    assert.ok(r.gaps.some((g) => /ClickUp sync stale/i.test(g)), "stale is an honest gap");
  });

  it("status check creates NO proposal", () => {
    const r = routeCockpitIntent(opsCtx({ activeCards: 9, waitingCards: 2 }, { withNow: true }));
    assert.equal(r.proposals.length, 0);
  });

  it("pending approvals gap stays honest (not invented)", () => {
    const r = routeCockpitIntent(opsCtx({ activeCards: 9, waitingCards: 2 }));
    assert.ok(r.gaps.some((g) => /Pending approvals source is not wired yet/i.test(g)), "pending approvals gap surfaced");
    // never fabricates a pending-approvals number in the summary
    assert.ok(!/pending approvals: \d/i.test(r.summary), "no fake pending-approvals count");
  });
});
