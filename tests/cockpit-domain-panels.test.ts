/**
 * tests/cockpit-domain-panels.test.ts
 *
 * Phase 12A — domain panel builders. Pure functions; cover three states for
 * each panel: missing data, partial data, and available local data. Builders
 * must NEVER fabricate values — unavailable fields show unknown/not configured/
 * no data found with an exact next setup step.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFitnessPanel,
  buildOpsPanel,
  buildFactoryPanel,
  DEFAULT_MODULES,
  type PanelInputs,
} from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary, AgentReadModel } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary, ReadModelSummary } from "../src/read-models/read-model-types.js";

function emptyAgents(): AgentIntegrationSummary {
  return { generatedAt: "t", configPresent: false, configPath: null, configuredAgents: 0, detectedAgents: 0, agents: [], missingSources: [], nextRecommendedCommand: "configure" };
}
function emptyReadModels(): ReadModelRegistrySummary {
  return { generatedAt: "t", configPresent: false, configPath: null, configuredReadModels: 0, enabledReadModels: 0, availability: [], summaries: [], missingEnv: [], nextRecommendedCommand: "configure" };
}
function baseInputs(over: Partial<PanelInputs> = {}): PanelInputs {
  return {
    agentIntegration: emptyAgents(),
    readModels: emptyReadModels(),
    reports: [],
    capability: { present: false, count: 0, byStatus: {}, names: [] },
    modules: DEFAULT_MODULES,
    now: "2026-06-04T00:00:00.000Z",
    ...over,
  };
}

function fitnessAgent(status: AgentReadModel["status"]): AgentReadModel {
  return {
    agentId: "fitness", agentName: "Fitness", agentType: "fitness", configured: true, enabled: true, status,
    cards: [{ agentId: "fitness", agentName: "Fitness", agentType: "fitness", status, confidence: "medium", sourcePaths: [], summary: "ok", metrics: {}, missingSources: [], blockedActions: [], approvalRequiredActions: [], nextRecommendedCommand: "npm run agents:status", latestReportPaths: ["fitness-reports/brief.md"] }],
  };
}
function opsAgent(status: AgentReadModel["status"]): AgentReadModel {
  return {
    agentId: "ops", agentName: "Ops", agentType: "ops", configured: true, enabled: true, status,
    cards: [{ agentId: "ops", agentName: "Ops", agentType: "ops", status, confidence: "medium", sourcePaths: [], summary: "Most recent local activity: today.", metrics: { card: "Ops Agent — Recent Activity" }, missingSources: [], blockedActions: [], approvalRequiredActions: [], nextRecommendedCommand: "npm run agents:status", latestReportPaths: ["ops-reports/dd-acme.md"] }],
  };
}
function rmSummary(type: "fitness" | "ops", metrics: Record<string, string | number>, lines: string[] = []): ReadModelSummary {
  return { id: type, type, status: "ok", confidence: "high", lines, metrics, recommendation: "read-only", dataFreshness: "2026-06-04", degradedSources: [] };
}

const FITNESS_FIELDS = ["status", "calories", "protein", "training_plan", "training_completed", "recovery", "health_freshness", "weekly_load", "latest_workout", "adjustment"];
const OPS_FIELDS = ["status", "urgent", "latest_updates", "blocked", "clickup_sync", "pending_approvals", "dd_reports", "recent_reports", "next_action"];

describe("fitness panel", () => {
  it("missing data → unconfigured, no fabricated values, exact setup steps", () => {
    const p = buildFitnessPanel(baseInputs());
    assert.equal(p.id, "fitness");
    assert.equal(p.status, "unconfigured");
    assert.equal(p.detected, false);
    for (const k of FITNESS_FIELDS) assert.ok(p.fields.find((f) => f.key === k), `missing field ${k}`);
    const cal = p.fields.find((f) => f.key === "calories")!;
    assert.notEqual(cal.status, "ok");
    assert.ok(["unknown", "not configured", "no data found"].includes(cal.value));
    assert.ok(cal.setupStep && cal.setupStep.length > 0, "must give a setup step");
    assert.ok(p.missingSetupSteps.length > 0);
    assert.ok(/agent-integrations\.local\.json/.test(p.nextAction));
  });

  it("partial data → agent detected but no read-model", () => {
    const ai: AgentIntegrationSummary = { ...emptyAgents(), configPresent: true, configuredAgents: 1, detectedAgents: 1, agents: [fitnessAgent("ok")] };
    const p = buildFitnessPanel(baseInputs({ agentIntegration: ai }));
    assert.equal(p.status, "detected");
    assert.equal(p.detected, true);
    const recovery = p.fields.find((f) => f.key === "recovery")!;
    assert.notEqual(recovery.status, "ok"); // no read-model → no recovery value
    assert.ok(recovery.setupStep);
  });

  it("available data → real recovery / calories / workout, no fabrication", () => {
    const rm: ReadModelRegistrySummary = { ...emptyReadModels(), configPresent: true, configuredReadModels: 1, enabledReadModels: 1, summaries: [rmSummary("fitness", { recovery: "66", latestWorkout: "easy run", caloriesToday: "1800", caloriesTarget: "2200", proteinToday: "120" })] };
    const p = buildFitnessPanel(baseInputs({ readModels: rm }));
    assert.equal(p.detected, true);
    assert.equal(p.fields.find((f) => f.key === "recovery")!.value, "66");
    assert.equal(p.fields.find((f) => f.key === "recovery")!.status, "ok");
    assert.equal(p.fields.find((f) => f.key === "calories")!.value, "1800 / 2200");
    assert.equal(p.fields.find((f) => f.key === "latest_workout")!.value, "easy run");
    assert.ok(p.highlights.some((h) => h.includes("Recovery: 66")));
  });

  // ── Phase 13.6B — RPC-aware setup hints ──
  it("RPC-backed fitness → missing fields use RPC-specific hints, never table hints", () => {
    const fitnessRm: ReadModelSummary = {
      id: "fitness", type: "fitness", status: "ok", confidence: "high", lines: [],
      metrics: { recovery: "green", caloriesToday: "1800" }, recommendation: "read-only",
      dataFreshness: "2026-06-04", degradedSources: [], rpcStatus: "rpc_live",
    };
    const rm: ReadModelRegistrySummary = { ...emptyReadModels(), configPresent: true, configuredReadModels: 1, enabledReadModels: 1, summaries: [fitnessRm] };
    const p = buildFitnessPanel(baseInputs({ readModels: rm }));
    assert.equal(p.detected, true);
    assert.equal(p.fields.find((f) => f.key === "recovery")!.status, "ok");

    const weekly = p.fields.find((f) => f.key === "weekly_load")!;
    assert.notEqual(weekly.status, "ok");
    assert.ok(/get_fitness_weekly_summary/.test(weekly.setupStep!), "weekly_load hint must reference the RPC");

    const proRem = p.fields.find((f) => f.key === "protein_remaining")!;
    assert.ok(/get_fitness_today_nutrition/.test(proRem.setupStep!));

    const plan = p.fields.find((f) => f.key === "training_plan")!;
    assert.notEqual(plan.status, "ok");
    assert.ok(/get_fitness_today_state/.test(plan.setupStep!));

    // No stale table/read-model setup steps anywhere when RPC-backed.
    for (const s of p.missingSetupSteps) {
      assert.ok(!/allowedTables|canonical_health|derived_daily_state|Enable a fitness read-model/.test(s), `stale table hint leaked: ${s}`);
    }
  });

  it("not-configured fitness keeps config-level (non-RPC) setup hints", () => {
    const p = buildFitnessPanel(baseInputs());
    const weekly = p.fields.find((f) => f.key === "weekly_load")!;
    assert.ok(!/get_fitness_weekly_summary/.test(weekly.setupStep!), "no RPC hint when unconfigured");
    assert.ok(/agent-integrations\.local\.json/.test(p.nextAction));
  });
});

describe("ops panel", () => {
  it("missing data → unconfigured with setup steps", () => {
    const p = buildOpsPanel(baseInputs());
    assert.equal(p.id, "ops");
    assert.equal(p.status, "unconfigured");
    for (const k of OPS_FIELDS) assert.ok(p.fields.find((f) => f.key === k), `missing field ${k}`);
    const urgent = p.fields.find((f) => f.key === "urgent")!;
    assert.notEqual(urgent.status, "ok");
    assert.ok(urgent.setupStep);
  });

  it("partial data → agent detected, reports surfaced", () => {
    const ai: AgentIntegrationSummary = { ...emptyAgents(), configPresent: true, configuredAgents: 1, detectedAgents: 1, agents: [opsAgent("ok")] };
    const p = buildOpsPanel(baseInputs({ agentIntegration: ai }));
    assert.equal(p.status, "detected");
    assert.equal(p.fields.find((f) => f.key === "dd_reports")!.status, "ok"); // dd-acme.md matched
  });

  it("available data → real urgent/blocked card counts", () => {
    const rm: ReadModelRegistrySummary = { ...emptyReadModels(), configPresent: true, configuredReadModels: 1, enabledReadModels: 1, summaries: [rmSummary("ops", { activeCards: "12", urgentCards: "3", blockedCards: "1" }, ["Active cards: 12 (open:9, blocked:1).", "Latest sync: ok at 2026-06-04."])] };
    const p = buildOpsPanel(baseInputs({ readModels: rm }));
    assert.equal(p.fields.find((f) => f.key === "urgent")!.value, "3");
    assert.equal(p.fields.find((f) => f.key === "blocked")!.value, "1");
    assert.ok(p.highlights.some((h) => h.includes("3 urgent")));
    assert.ok(/Triage 1 blocked/.test(p.fields.find((f) => f.key === "next_action")!.value));
  });
});

describe("factory panel", () => {
  it("always available; degrades capabilities when registry absent", () => {
    const p = buildFactoryPanel(baseInputs());
    assert.equal(p.id, "factory");
    assert.equal(p.status, "available");
    assert.ok(p.fields.find((f) => f.key === "modules")!.value.includes("Orchestrator"));
    assert.notEqual(p.fields.find((f) => f.key === "capabilities")!.status, "ok");
    assert.ok(p.fields.find((f) => f.key === "entry_prompts")!.value.includes("Create a tax agent"));
    assert.ok(/agent-integrations\.local\.json/.test(p.fields.find((f) => f.key === "suggested_build")!.value));
  });

  it("surfaces registered capabilities when present", () => {
    const p = buildFactoryPanel(baseInputs({ capability: { present: true, count: 2, byStatus: { promoted: 2 }, names: ["receipt_ocr", "expense_classification"] } }));
    assert.equal(p.fields.find((f) => f.key === "capabilities")!.status, "ok");
    assert.ok(p.fields.find((f) => f.key === "capabilities")!.value.includes("2"));
    assert.ok(p.highlights.some((h) => h.includes("2 registered")));
  });

  it("flags a missing core module", () => {
    const modules = DEFAULT_MODULES.map((m) => (m.id === "beezulbub" ? { ...m, present: false } : m));
    const p = buildFactoryPanel(baseInputs({ modules }));
    assert.notEqual(p.fields.find((f) => f.key === "beezulbub")!.status, "ok");
    assert.ok(p.gaps.some((g) => /Beezulbub/.test(g)));
  });
});
