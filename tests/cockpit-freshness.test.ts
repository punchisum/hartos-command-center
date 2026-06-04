/**
 * tests/cockpit-freshness.test.ts
 *
 * Phase 15C — Freshness + Sync Control Surface. Covers the pure freshness
 * verdict, the freshness report (ClickUp sync health + stale reason), the
 * Ask HartOS freshness intent, and the safe (non-executable) refresh proposal.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFreshnessReport,
  computeFreshnessVerdict,
  type DomainFreshness,
} from "../src/cockpit/freshness-surface.js";
import { detectCockpitIntent, routeCockpitIntent, type IntentRouterContext } from "../src/cockpit/cockpit-intent-router.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary, ReadModelSummary } from "../src/read-models/read-model-types.js";
import type { CockpitSystemSummary } from "../src/cockpit/cockpit-types.js";

const NOW = "2026-06-04T12:00:00.000Z";
const FRESH = "2026-06-04T06:00:00.000Z"; // < 24h before NOW
const STALE = "2026-06-02T00:00:00.000Z"; // > 24h before NOW

const SYSTEM: CockpitSystemSummary = {
  cardCount: 10, groups: ["orchestrator"], missingSourceCount: 1,
  readOnlyActionCount: 1, approvalRequiredActionCount: 0, manualRequiredActionCount: 0, forbiddenActionCount: 1,
  reportCount: 1, latestRequest: null, latestStrategyVerdict: null, latestCtoVerdict: null,
  nextRecommendedCommand: "npm run hartos:handover",
};

function rm(type: "fitness" | "ops", metrics: Record<string, string | number>, dataFreshness: string | null): ReadModelSummary {
  return { id: type, type, status: "ok", confidence: "high", lines: ["line."], metrics, recommendation: "r", dataFreshness, degradedSources: [] };
}

/** Build panels with controllable per-domain freshness. Omit a summary to drop it. */
function panels(opts: { ops?: { metrics: Record<string, string | number>; freshness: string | null }; fitness?: { metrics: Record<string, string | number>; freshness: string | null } }) {
  const summaries: ReadModelSummary[] = [];
  if (opts.fitness) summaries.push(rm("fitness", opts.fitness.metrics, opts.fitness.freshness));
  if (opts.ops) summaries.push(rm("ops", opts.ops.metrics, opts.ops.freshness));
  const agentIntegration: AgentIntegrationSummary = { generatedAt: NOW, configPresent: true, configPath: "x", configuredAgents: 1, detectedAgents: 1, agents: [], missingSources: [], nextRecommendedCommand: "npm run agents:status" };
  const readModels: ReadModelRegistrySummary = { generatedAt: NOW, configPresent: true, configPath: "x", configuredReadModels: summaries.length, enabledReadModels: summaries.length, availability: [], summaries, missingEnv: [], nextRecommendedCommand: "npm run read-models:status" };
  const inputs: PanelInputs = { agentIntegration, readModels, reports: [], capability: { present: false, count: 0, byStatus: {}, names: [] }, modules: DEFAULT_MODULES, now: NOW };
  return buildDomainPanels(inputs);
}

function ctx(request: string, p: ReturnType<typeof buildDomainPanels>, withNow = false): IntentRouterContext {
  return {
    request,
    panels: p,
    systemSummary: SYSTEM,
    integration: { configPresent: true, agentsConfigured: 1, agentsDetected: 1, readModelsEnabled: 2 },
    llm: { provider: "deterministic", mode: "fallback" },
    ...(withNow ? { now: NOW, env: {} } : {}),
  };
}

const D = (domain: DomainFreshness["domain"], state: DomainFreshness["state"], freshness: DomainFreshness["freshness"] = "fresh"): DomainFreshness => ({
  domain, state, freshness, lastUpdated: null, resolvedFields: state === "unavailable" ? 0 : 5, reason: "", safeNextStep: null,
});

describe("Phase 15C — computeFreshnessVerdict (pure)", () => {
  it("GREEN when all domains fresh", () => {
    const r = computeFreshnessVerdict([D("fitness", "fresh"), D("ops", "fresh"), D("factory", "fresh")]);
    assert.equal(r.verdict, "green");
  });

  it("AMBER when one domain is stale", () => {
    const r = computeFreshnessVerdict([D("fitness", "stale", "stale"), D("ops", "fresh"), D("factory", "fresh")]);
    assert.equal(r.verdict, "amber");
    assert.ok(/fitness/i.test(r.verdictReason));
  });

  it("RED when the critical ops read-model is unavailable", () => {
    const r = computeFreshnessVerdict([D("fitness", "fresh"), D("ops", "unavailable"), D("factory", "fresh")]);
    assert.equal(r.verdict, "red");
  });

  it("RED when ops freshness is missing entirely", () => {
    const r = computeFreshnessVerdict([D("fitness", "fresh"), D("factory", "fresh")]);
    assert.equal(r.verdict, "red");
  });
});

describe("Phase 15C — buildFreshnessReport", () => {
  it("ops stale: stale reason includes the ClickUp timestamp + sync health", () => {
    const p = panels({ fitness: { metrics: { recovery: "66" }, freshness: FRESH }, ops: { metrics: { activeCards: 9 }, freshness: STALE } });
    const r = buildFreshnessReport({ panels: p, now: NOW });
    assert.equal(r.verdict, "amber");
    assert.ok(r.staleDomains.includes("ops"));
    assert.ok(r.staleReason, "must have a stale reason");
    assert.ok(r.staleReason!.includes(STALE), `stale reason must cite the ClickUp timestamp: ${r.staleReason}`);
    assert.equal(r.clickup.stale, true);
    assert.equal(r.clickup.lastImportAt, STALE);
    assert.equal(r.clickup.cardsImported, "9");
    assert.ok(/re-run the clickup import/i.test(r.safeNextStep));
  });

  it("ops unavailable (no read-model) → RED", () => {
    const p = panels({ fitness: { metrics: { recovery: "66" }, freshness: FRESH } });
    const r = buildFreshnessReport({ panels: p, now: NOW });
    assert.equal(r.verdict, "red");
    assert.ok(r.unavailableDomains.includes("ops"));
  });

  it("never fabricates an updates-imported count", () => {
    const p = panels({ ops: { metrics: { activeCards: 9 }, freshness: STALE } });
    const r = buildFreshnessReport({ panels: p, now: NOW });
    assert.equal(r.clickup.updatesImported, null);
  });
});

describe("Phase 15C — freshness intent routing", () => {
  const cases: Array<[string, string]> = [
    ["Is my data fresh?", "freshness_status"],
    ["What needs refreshing?", "freshness_status"],
    ["Why is ops stale?", "freshness_status"],
    ["Show sync health", "freshness_status"],
    ["What should I do next to fix stale ops?", "freshness_status"],
    ["Create a proposal to refresh ops", "freshness_status"],
    ["Draft a sync repair plan", "freshness_status"],
  ];
  for (const [req, expected] of cases) {
    it(`"${req}" → ${expected}`, () => {
      assert.equal(detectCockpitIntent(req).intent, expected);
    });
  }

  it("still routes read-model + system status correctly", () => {
    assert.equal(detectCockpitIntent("Show read model status").intent, "read_model_status");
    assert.equal(detectCockpitIntent("Show system status").intent, "system_status");
    assert.equal(detectCockpitIntent("What data is stale?").intent, "read_model_status");
  });

  it("freshness answer is operator-style with verdict + non-executable note", () => {
    const p = panels({ fitness: { metrics: { recovery: "66" }, freshness: FRESH }, ops: { metrics: { activeCards: 9 }, freshness: STALE } });
    const r = routeCockpitIntent(ctx("Is my data fresh?", p));
    assert.equal(r.intent, "freshness_status");
    assert.ok(/^System freshness: AMBER\./.test(r.summary), `expected amber verdict, got: ${r.summary}`);
    assert.ok(r.summary.includes(STALE), "ops stale reason cites the ClickUp timestamp");
    assert.ok(/Not executable:/i.test(r.summary), "must state nothing is executable");
    assert.ok(/Safe to do manually:/i.test(r.summary));
  });

  it("why-is-ops-stale cites the timestamp and warns against deciding on stale data", () => {
    const p = panels({ fitness: { metrics: { recovery: "66" }, freshness: FRESH }, ops: { metrics: { activeCards: 9 }, freshness: STALE } });
    const r = routeCockpitIntent(ctx("Why is ops stale?", p));
    assert.equal(r.intent, "freshness_status");
    assert.ok(r.summary.includes(STALE));
    assert.ok(/do not make important operational decisions/i.test(r.summary));
  });
});

describe("Phase 15C — proposal generation (safe, explicit-only)", () => {
  const opsStalePanels = () => panels({ fitness: { metrics: { recovery: "66" }, freshness: FRESH }, ops: { metrics: { activeCards: 9 }, freshness: STALE } });

  for (const q of ["Is my data fresh?", "What needs refreshing?", "Why is ops stale?"]) {
    it(`status question creates zero proposals: "${q}"`, () => {
      const r = routeCockpitIntent(ctx(q, opsStalePanels(), true));
      assert.equal(r.proposals.length, 0);
    });
  }

  for (const q of ["Create a proposal to refresh ops", "Draft a sync repair plan", "What should I do next to fix stale ops?"]) {
    it(`explicit refresh request creates one safe proposal: "${q}"`, () => {
      const r = routeCockpitIntent(ctx(q, opsStalePanels(), true));
      assert.equal(r.intent, "freshness_status");
      assert.equal(r.proposals.length, 1);
      const proposal = r.proposals[0]!;
      assert.equal(proposal.actionType, "sync_repair_plan");
      assert.equal(proposal.domain, "ops");
      // No execution is possible — proven by the contract.
      assert.equal(proposal.executable, false);
      assert.equal(proposal.dryRunResult?.executed, false);
      assert.ok(/no import is triggered/i.test(proposal.dryRunResult!.wouldHappen));
    });
  }

  it("without `now`, freshness routing stays pure (no proposals)", () => {
    const r = routeCockpitIntent(ctx("Create a proposal to refresh ops", opsStalePanels()));
    assert.equal(r.proposals.length, 0);
  });
});
