/**
 * tests/cockpit-daily-brief.test.ts
 *
 * Phase 16 — the hosted Daily Command Brief intent. Covers detection, the
 * grounded brief structure (verdict / main action / attention / per-area /
 * freshness / gaps), honest stale-ops handling, and that it creates ZERO
 * proposals even with a timestamp.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectCockpitIntent,
  routeCockpitIntent,
  extractOpsSignals,
  type IntentRouterContext,
} from "../src/cockpit/cockpit-intent-router.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary, ReadModelSummary } from "../src/read-models/read-model-types.js";
import type { CockpitSystemSummary } from "../src/cockpit/cockpit-types.js";

const NOW = "2026-06-04T12:00:00.000Z";
const FRESH = "2026-06-04T06:00:00.000Z";
const STALE = "2026-06-02T00:00:00.000Z";

const SYSTEM: CockpitSystemSummary = {
  cardCount: 10, groups: ["orchestrator"], missingSourceCount: 1,
  readOnlyActionCount: 1, approvalRequiredActionCount: 0, manualRequiredActionCount: 0, forbiddenActionCount: 1,
  reportCount: 1, latestRequest: null, latestStrategyVerdict: null, latestCtoVerdict: null,
  nextRecommendedCommand: "npm run hartos:handover",
};

function rm(type: "fitness" | "ops", metrics: Record<string, string | number>, dataFreshness: string | null): ReadModelSummary {
  return { id: type, type, status: "ok", confidence: "high", lines: ["line."], metrics, recommendation: "r", dataFreshness, degradedSources: [] };
}

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

describe("Phase 16 — daily brief intent detection", () => {
  const cases = [
    "What needs my attention today?",
    "Daily command brief",
    "Command brief",
    "What should I focus on today?",
    "brief me",
    "what matters today",
  ];
  for (const req of cases) {
    it(`"${req}" → daily_brief`, () => {
      assert.equal(detectCockpitIntent(req).intent, "daily_brief");
    });
  }

  it("does not steal plain status/freshness/ops questions", () => {
    assert.equal(detectCockpitIntent("Is my data fresh?").intent, "freshness_status");
    assert.equal(detectCockpitIntent("Show system status").intent, "system_status");
    assert.equal(detectCockpitIntent("Anything urgent in ops?").intent, "ops_status");
  });
});

describe("Phase 16 — extractOpsSignals (pure)", () => {
  it("reads only resolved fields and flags stale clickup", () => {
    const p = panels({ ops: { metrics: { activeCards: 9, urgent: 2, blocked: 1, waitingCards: 3 }, freshness: STALE } });
    const ops = p.find((x) => x.id === "ops");
    const s = extractOpsSignals(ops);
    assert.equal(s.active, 9);
    assert.equal(s.urgent, 2);
    assert.equal(s.blocked, 1);
    assert.equal(s.waiting, 3);
    assert.equal(s.clickupStale, true);
  });
});

describe("Phase 16 — daily brief answer", () => {
  it("amber when ops is stale: structured brief, honest stale warning", () => {
    const p = panels({ fitness: { metrics: { recovery: "66" }, freshness: FRESH }, ops: { metrics: { activeCards: 9, waitingCards: 2 }, freshness: STALE } });
    const r = routeCockpitIntent(ctx("What needs my attention today?", p));
    assert.equal(r.intent, "daily_brief");
    assert.ok(/^Command Brief: Amber\./m.test(r.summary), `expected amber brief, got: ${r.summary}`);
    assert.ok(/Main action:/.test(r.summary));
    assert.ok(/Top attention items:/.test(r.summary));
    assert.ok(/Fitness:/.test(r.summary));
    assert.ok(/Ops:/.test(r.summary));
    assert.ok(/Freshness:/.test(r.summary));
    assert.ok(/read-only/i.test(r.summary), "must state it is read-only / cannot execute");
    assert.ok(/stale/i.test(r.summary), "must mention stale ops");
  });

  it("red when ops has urgent/blocked cards", () => {
    const p = panels({ fitness: { metrics: { recovery: "70" }, freshness: FRESH }, ops: { metrics: { activeCards: 5, urgent: 1, blocked: 2 }, freshness: FRESH } });
    const r = routeCockpitIntent(ctx("Daily command brief", p));
    assert.ok(/^Command Brief: Red\./m.test(r.summary), `expected red brief, got: ${r.summary}`);
    assert.ok(/blocked/i.test(r.summary));
  });

  it("creates ZERO proposals even with a timestamp", () => {
    const p = panels({ fitness: { metrics: { recovery: "66" }, freshness: FRESH }, ops: { metrics: { activeCards: 9 }, freshness: STALE } });
    const r = routeCockpitIntent(ctx("What needs my attention today?", p, true));
    assert.equal(r.proposals.length, 0);
  });
});
