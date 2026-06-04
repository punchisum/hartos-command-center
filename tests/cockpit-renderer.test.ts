/**
 * tests/cockpit-renderer.test.ts
 *
 * Phase 11H — cockpit renderer tests. Deterministic HTML, no browser.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCockpitState } from "../src/cockpit/cockpit-read-model.js";
import { renderCockpitHtml, escapeHtml } from "../src/cockpit/cockpit-renderer.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";

const REQUIRED_CARDS = [
  "orchestrator_latest_request", "orchestrator_strategy_review", "orchestrator_cto_review",
  "orchestrator_build_plan", "orchestrator_handover", "factory_provider_status",
  "factory_launch_status", "factory_bootstrap_status", "factory_production_promotion_status",
  "beezulbub_capability_registry", "beezulbub_pack_status", "beezulbub_provenance_health",
  "beezulbub_conflict_report", "beezulbub_implementation_drafts", "agents_inventory",
  "agents_runtime_status", "agents_debug_events", "agents_approval_queue",
  "human_manual_required", "human_pending_approvals", "human_blocked_actions",
  "human_next_recommended_command",
];

describe("cockpit renderer", () => {
  let state: CockpitState;
  let html: string;
  let serverHtml: string;

  before(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-render-"));
    state = await buildCockpitState({ cwd: dir });
    html = renderCockpitHtml(state, { serverMode: false });
    serverHtml = renderCockpitHtml(state, { serverMode: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("renders a full HTML document", () => {
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("HartOS Command Center"));
    assert.ok(html.includes("local mode"));
  });

  it("includes all 22 cards", () => {
    for (const id of REQUIRED_CARDS) {
      assert.ok(html.includes(`id="card-${id}"`), `HTML missing card ${id}`);
    }
  });

  it("includes the Ask HartOS message box", () => {
    assert.ok(html.includes("Ask HartOS"));
    assert.ok(html.includes('id="ask-form"'));
    assert.ok(html.includes('id="ask-input"'));
  });

  it("renders every action button as disabled (no execution in 11H)", () => {
    // Count action buttons vs disabled buttons — all action buttons are disabled.
    const buttons = html.match(/<button class="act/g) ?? [];
    const disabled = html.match(/<button class="act[^>]*disabled/g) ?? [];
    assert.ok(buttons.length > 0);
    assert.equal(buttons.length, disabled.length, "all action buttons must be disabled");
  });

  it("renders forbidden actions as blocked", () => {
    assert.ok(html.includes('data-action="execute_provider_mutation"'));
    assert.ok(html.includes("FORBIDDEN"));
    assert.ok(html.includes("act blocked"));
  });

  it("renders approval-required actions with a non-executable gate label", () => {
    assert.ok(html.includes("APPROVAL REQUIRED") || html.includes("MANUAL REQUIRED"));
    assert.ok(html.includes("act gated"));
  });

  it("disables the send button in static snapshot mode and enables it in server mode", () => {
    assert.ok(html.includes("Send to Orchestrator</button>"));
    assert.ok(html.includes('<button type="submit" disabled>'));
    assert.ok(serverMode_enabled(serverHtml));
  });

  it("escapes HTML to avoid injection", () => {
    assert.equal(escapeHtml('<script>"x"&\'y\''), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
  });

  it("shows the empty-state in the detail panel when there is no response", () => {
    assert.ok(html.includes('id="latest-response-detail"'));
    assert.ok(html.includes("No Orchestrator response yet"));
  });

  it("ships the live client-side detail updater (Part 0 fix)", () => {
    // The client JS must rewrite the detail panel in place after a POST.
    assert.ok(serverHtml.includes("latest-response-detail"));
    assert.ok(serverHtml.includes("function renderDetail"));
    assert.ok(serverHtml.includes("detail.innerHTML = renderDetail(data)"));
  });
});

const SAMPLE_RESPONSE = {
  requestId: "req-123",
  threadId: "thread-abc",
  createdAt: "2026-06-04T00:00:00.000Z",
  request: "Build me a tax specialist agent",
  classification: {
    classification: "new_agent_build",
    domain: "finance",
    riskLevel: "medium",
    buildTarget: "specialist_agent",
    recommendedSpecialist: "finance_agent",
  },
  strategyReview: "approve — fits the roadmap",
  ctoReview: "buildable (missing: none)",
  capabilityGaps: "3 usable, 1 planning-only, 2 missing",
  buildPlanSummary: "4 phase(s); do-not-build: 1 item(s)",
  handoverPath: "hartos-reports/handover-x.md",
  reportPaths: ["hartos-reports/orchestrator-x.md", "cockpit-reports/thread-x.md"],
  nextRecommendedCommand: "npm run beezulbub:capability-list",
  blockedActions: ["execute_provider_mutation"],
  approvalRequiredActions: ["promote_pack"],
};

describe("cockpit renderer — latest response detail (Part 0)", () => {
  let html: string;

  before(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-render-resp-"));
    const state = await buildCockpitState({ cwd: dir });
    const withResponse: CockpitState = {
      ...state,
      latestResponse: { ...SAMPLE_RESPONSE } as CockpitState["latestResponse"],
    };
    html = renderCockpitHtml(withResponse, { serverMode: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("renders the structured detail when a response exists", () => {
    assert.ok(html.includes("Build me a tax specialist agent"));
    assert.ok(html.includes("new_agent_build"));
    assert.ok(html.includes("finance"));
    assert.ok(html.includes("approve — fits the roadmap"));
    assert.ok(html.includes("buildable (missing: none)"));
    assert.ok(html.includes("3 usable, 1 planning-only, 2 missing"));
    assert.ok(html.includes("npm run beezulbub:capability-list"));
    assert.ok(html.includes("hartos-reports/handover-x.md"));
    assert.ok(html.includes("execute_provider_mutation"));
    assert.ok(html.includes("promote_pack"));
    assert.ok(html.includes("thread-abc"));
    assert.ok(html.includes("req-123"));
  });

  it("does NOT show the empty-state when a response exists", () => {
    const detailStart = html.indexOf('id="latest-response-detail"');
    assert.ok(detailStart >= 0);
    const detailSection = html.slice(detailStart, detailStart + 2000);
    assert.ok(!detailSection.includes("No Orchestrator response yet"));
  });
});

function serverMode_enabled(serverHtml: string): boolean {
  // In server mode the submit button is not disabled.
  return serverHtml.includes('<button type="submit">Send to Orchestrator</button>');
}
