/**
 * tests/agent-org-view.test.ts — Live Organism P2: the Agent Organisation panel + status strip,
 * and that the cockpit page renders the Agents view.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderAgentOrgPanel, renderStatusStrip } from "../src/runtime/views/agent-org-view.js";
import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";
import { computeStatusSplit } from "../src/cockpit/status-split.js";
import { renderHostedCockpitPage } from "../src/runtime/cloudflare-cockpit-page.js";

const reg = resolveMetaAgentRegistry({ now: "2026-06-10T12:00:00Z" });

describe("renderAgentOrgPanel", () => {
  const html = renderAgentOrgPanel(reg);
  it("shows the org hierarchy + every key node", () => {
    assert.match(html, /Agent Organisation/);
    for (const name of ["Hart", "Orchestrator", "Rinnegan", "Wolverine", "Prophet", "Beezulbub", "Research Agent", "Agent Factory", "Officiator", "Simulator", "Execution Engine", "Fitness", "Ops"]) {
      assert.match(html, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `org panel missing ${name}`);
    }
  });
  it("shows capability badges (cockpit / CLI-only / runner)", () => {
    assert.match(html, /cockpit/);
    assert.match(html, /CLI-only/);
    assert.match(html, /runner/);
  });
  it("escapes content (no raw unescaped angle brackets injected)", () => {
    assert.ok(!/<script/i.test(html));
  });
});

describe("renderStatusStrip", () => {
  it("renders all six bands", () => {
    const strip = renderStatusStrip(computeStatusSplit({ registry: reg }));
    for (const label of ["Operator Status", "System Health", "Fleet Health", "Data Freshness", "Proposal Hygiene", "Provider Connectivity"]) {
      assert.match(strip, new RegExp(label));
    }
  });
});

describe("renderHostedCockpitPage renders the Agents view", () => {
  it("includes the agents nav/view + the org panel even with no live state", () => {
    const html = renderHostedCockpitPage(undefined, { now: "2026-06-10T12:00:00Z" });
    assert.match(html, /data-view="agents"/);
    assert.match(html, /Agent Organisation/);
    assert.match(html, /Wolverine/);
  });
});
