/**
 * tests/cockpit-panels-render.test.ts
 *
 * Phase 12 — the cockpit UI shows the three custom domain panels and the routed
 * intent (grounded answer). Read-only: no executable buttons are added.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCockpitState } from "../src/cockpit/cockpit-read-model.js";
import { renderCockpitHtml } from "../src/cockpit/cockpit-renderer.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";

describe("cockpit renders domain panels", () => {
  let state: CockpitState;
  let html: string;

  before(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-panels-"));
    state = await buildCockpitState({ cwd: dir });
    html = renderCockpitHtml(state, { serverMode: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("builds three panels into state", () => {
    assert.equal(state.panels?.length, 3);
    assert.deepEqual(state.panels?.map((p) => p.id), ["fitness", "ops", "factory"]);
  });

  it("renders all three panels with status + next action", () => {
    assert.ok(html.includes('id="domain-panels"'));
    for (const id of ["fitness", "ops", "factory"]) {
      assert.ok(html.includes(`id="panel-${id}"`), `missing panel ${id}`);
    }
    assert.ok(html.includes("Configured / detected"));
    assert.ok(html.includes("Next action:"));
    assert.ok(html.includes("Domain Panels"));
  });

  it("shows degraded placeholders + exact setup steps (never fake data)", () => {
    // With an empty temp cwd nothing is configured, so panels degrade.
    assert.ok(html.includes("not configured") || html.includes("no data found") || html.includes("unknown"));
    assert.ok(html.includes("read-models.local.json") || html.includes("agent-integrations.local.json"));
  });

  it("adds no executable buttons (panels are read-only)", () => {
    const buttons = html.match(/<button class="act/g) ?? [];
    const disabled = html.match(/<button class="act[^>]*disabled/g) ?? [];
    assert.equal(buttons.length, disabled.length, "all action buttons remain disabled");
  });
});

const SAMPLE_INTENT_RESPONSE = {
  requestId: "req-1", threadId: "thread-1", createdAt: "2026-06-04T00:00:00.000Z",
  request: "How is my fitness agent today?",
  classification: { classification: "fitness_request", domain: "fitness", riskLevel: "low", buildTarget: "generic", recommendedSpecialist: "fitness_agent" },
  strategyReview: null, ctoReview: null, capabilityGaps: "n/a", buildPlanSummary: "n/a",
  handoverPath: null, reportPaths: [], nextRecommendedCommand: "npm run agents:status",
  blockedActions: [], approvalRequiredActions: [],
  intent: "fitness_status", intentTitle: "Fitness status",
  intentSummary: "Recovery: 66.\nToday's plan: unknown.",
  intentHighlights: ["Recovery: 66."], intentGaps: ["calories: not configured"],
  intentNextSteps: ["Enable a fitness read-model"], intentSuggestedCommands: [], intentClarifyingQuestion: null,
  proposals: [{
    id: "prop-1", domain: "fitness", actionType: "fitness_adjustment_plan", title: "Fitness adjustment plan draft",
    description: "Draft a training/nutrition adjustment.", sourceIntent: "fitness_status: How is my fitness agent today?",
    proposedPayload: {}, expectedEffect: "A suggested adjustment note.", riskLevel: "low", requiredApproval: "Hart",
    status: "draft", createdAt: "2026-06-04T00:00:00.000Z", expiresAt: null,
    safetyNotes: ["Non-executable draft."], blockedReason: "Execution is disabled and fails closed.",
    dryRunResult: { wouldHappen: "Would propose an adjustment.", dataWouldTouch: ["read-only rows"], approvalRequired: "Hart approval", executionDisabledReason: "Execution disabled.", futureSetupRequired: ["a coaching boundary"], executed: false },
    executable: false,
  }],
};

describe("cockpit renders the routed intent (grounded answer)", () => {
  let html: string;
  before(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-intent-"));
    const state = await buildCockpitState({ cwd: dir });
    const withResp: CockpitState = { ...state, latestResponse: { ...SAMPLE_INTENT_RESPONSE } as CockpitState["latestResponse"] };
    html = renderCockpitHtml(withResp, { serverMode: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("shows the HartOS answer block with intent + grounded summary", () => {
    assert.ok(html.includes("HartOS answer"));
    assert.ok(html.includes("fitness_status"));
    assert.ok(html.includes("Recovery: 66."));
    assert.ok(html.includes("Next steps"));
  });

  it("ships the client-side intent renderer for live updates", () => {
    assert.ok(html.includes("function renderIntent"));
    assert.ok(html.includes("renderIntent(r)"));
  });

  it("renders the Action Proposals section as non-executable / dry-run only", () => {
    assert.ok(html.includes('id="action-proposals"'));
    assert.ok(html.includes("Action Proposals"));
    assert.ok(html.includes("NON-EXECUTABLE"));
    assert.ok(html.includes("DRY-RUN"));
    assert.ok(html.includes("Fitness adjustment plan draft"));
    // The proposal's only button must be disabled (no execution).
    assert.ok(html.includes('<button class="act blocked" disabled'));
  });

  it("keeps every button disabled (panels + proposals are read-only)", () => {
    const buttons = html.match(/<button/g) ?? [];
    const disabled = html.match(/<button[^>]*disabled/g) ?? [];
    // Only the Ask HartOS submit button is enabled in server mode.
    assert.equal(buttons.length - disabled.length, 1, "only the Ask submit button may be enabled");
  });
});

describe("cockpit renders the proposal queue + read-model diagnostics", () => {
  it("shows queue items (non-executable) + diagnostics, all buttons disabled", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-queue-"));
    const state = await buildCockpitState({ cwd: dir });
    const withQueue: CockpitState = {
      ...state,
      proposalQueue: [{
        id: "prop-build-1", domain: "factory", actionType: "build_agent_plan", title: "Build draft",
        description: "d", sourceIntent: "i", proposedPayload: {}, expectedEffect: "e", riskLevel: "high",
        requiredApproval: "Hart", status: "pending_approval", createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z", expiresAt: null, safetyNotes: [], blockedReason: "Execution disabled.",
        dryRunResult: null, executable: false, auditEvents: [{ at: "t", event: "created" }],
      }] as CockpitState["proposalQueue"],
    };
    const html = renderCockpitHtml(withQueue, { serverMode: true });
    assert.ok(html.includes('id="proposal-queue"'));
    assert.ok(html.includes("Build draft"));
    assert.ok(html.includes("REAL EXECUTION DISABLED"));
    assert.ok(html.includes('id="read-model-diagnostics"'));
    // No proposal/queue button is enabled.
    const buttons = html.match(/<button/g) ?? [];
    const disabled = html.match(/<button[^>]*disabled/g) ?? [];
    assert.equal(buttons.length - disabled.length, 1, "only the Ask submit button may be enabled");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("cockpit renders per-field freshness", () => {
  it("shows a freshness badge for live fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-fresh-"));
    const state = await buildCockpitState({ cwd: dir });
    // Inject a panel field with fresh data to assert the badge renders.
    const panels = (state.panels ?? []).map((p) => p.id === "fitness"
      ? { ...p, fields: [...p.fields, { key: "x", label: "Live metric", value: "42", status: "ok" as const, freshness: "fresh" as const, lastUpdated: "2026-06-04T00:00:00.000Z", confidence: "high" as const }] }
      : p);
    const html = renderCockpitHtml({ ...state, panels }, { serverMode: true });
    assert.ok(html.includes('class="fr fresh"'));
    await rm(dir, { recursive: true, force: true });
  });
});
