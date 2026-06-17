/**
 * tests/sentinel-heartbeat.test.ts — the cron heartbeat alert policy + Worker-safe heartbeat builder.
 * Alert only on down/stale (never on honest "unknown"); fact-only payload; read-model → heartbeats.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";
import {
  assessFleetLiveness,
  heartbeatsFromReadModels,
  type AgentHeartbeat,
} from "../src/sentinel/sentinel-liveness.js";
import {
  heartbeatShouldAlert,
  buildHeartbeatAlert,
  heartbeatLogLine,
} from "../src/sentinel/sentinel-heartbeat.js";

const NOW = "2026-06-11T12:00:00.000Z";
const REG = resolveMetaAgentRegistry({ now: NOW });
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 36e5).toISOString();

function fleet(hb: AgentHeartbeat[]) {
  return assessFleetLiveness(REG, hb, NOW);
}

describe("heartbeatsFromReadModels", () => {
  it("always includes a fresh cockpit heartbeat (the answering Worker)", () => {
    const hb = heartbeatsFromReadModels({ staleSources: [], enabledSources: [] }, NOW, null);
    const cockpit = hb.find((h) => h.agentId === "cockpit");
    assert.ok(cockpit);
    assert.equal(cockpit.lastEvidenceAt, NOW);
  });

  it("marks an enabled read-model fresh, a stale one upstreamStale", () => {
    const hb = heartbeatsFromReadModels({ staleSources: ["ops"], enabledSources: ["fitness", "ops"] }, NOW, NOW);
    assert.equal(hb.find((h) => h.agentId === "fitness")?.upstreamStale, undefined);
    assert.equal(hb.find((h) => h.agentId === "ops")?.upstreamStale, true);
  });

  it("a read-model that is neither enabled nor stale is omitted (⇒ unknown by the core)", () => {
    const hb = heartbeatsFromReadModels({ staleSources: [], enabledSources: [] }, NOW, null);
    assert.ok(!hb.some((h) => h.agentId === "fitness" || h.agentId === "ops"));
  });

  it("never marks cloud evidence host-bound (Worker self-beat + read-models)", () => {
    const hb = heartbeatsFromReadModels({ staleSources: ["ops"], enabledSources: ["fitness", "ops"] }, NOW, NOW);
    for (const h of hb) {
      assert.notEqual(h.hostBound, true, `${h.agentId} is cloud, not host-bound`);
    }
  });
});

describe("heartbeat alert policy", () => {
  it("does NOT alert when everything is up or merely unknown", () => {
    // All-unknown fleet (no heartbeats) ⇒ AMBER, but unknown must not page.
    assert.equal(heartbeatShouldAlert(fleet([])), false);
    const allUp = REG.agents
      .filter((a) => a.category !== "human" && a.id !== "sentinel")
      .map((a): AgentHeartbeat => ({ agentId: a.id, lastEvidenceAt: hoursAgo(1), evidenceSource: "t" }));
    assert.equal(heartbeatShouldAlert(fleet(allUp)), false);
  });

  it("alerts on a stale or down agent", () => {
    assert.equal(heartbeatShouldAlert(fleet([{ agentId: "ops", lastEvidenceAt: hoursAgo(30), evidenceSource: "t" }])), true);
    assert.equal(heartbeatShouldAlert(fleet([{ agentId: "ops", lastEvidenceAt: hoursAgo(100), evidenceSource: "t" }])), true);
  });

  it("buildHeartbeatAlert lists only the flagged agents, fact-only", () => {
    const f = fleet([
      { agentId: "ops", lastEvidenceAt: hoursAgo(100), evidenceSource: "t" },
      { agentId: "fitness", lastEvidenceAt: hoursAgo(1), evidenceSource: "t" },
    ]);
    const alert = buildHeartbeatAlert(f);
    assert.equal(alert.down, 1);
    assert.match(alert.text, /Sentinel heartbeat/);
    assert.ok(alert.agents.some((a) => /Ops Agent \(down/.test(a)));
    assert.ok(!alert.agents.some((a) => /Fitness/.test(a)), "fresh agents are not in the alert");
    assert.equal(alert.at, NOW);
  });

  it("heartbeatLogLine is a single structured observability line", () => {
    assert.match(heartbeatLogLine(fleet([])), /^\[sentinel-heartbeat\] (GREEN|AMBER|RED) — up \d+ stale \d+ down \d+ unknown \d+/);
  });
});
