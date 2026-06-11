/**
 * tests/wolverine-agent-liveness.test.ts — the agent-liveness detector (Sentinel → Wolverine).
 * down ⇒ high/broken_wiring; stale ⇒ medium/stale_data; unknown-but-claimed-live ⇒ low advisory;
 * unknown-and-not-claimed ⇒ silent; absent fleetLiveness ⇒ not assessed; NEVER a fixRoute
 * (restarts are external — the autoheal invariant forbids auto-executing them).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectAgentLiveness } from "../src/wolverine/detectors/agent-liveness.js";
import { DEFAULT_DETECTORS, wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";
import { assessFleetLiveness, type AgentHeartbeat } from "../src/sentinel/sentinel-liveness.js";

const NOW = "2026-06-11T12:00:00.000Z";
const REG = resolveMetaAgentRegistry({ now: NOW });

function hoursAgo(h: number): string {
  return new Date(Date.parse(NOW) - h * 36e5).toISOString();
}

function fleetWith(heartbeats: AgentHeartbeat[]) {
  return assessFleetLiveness(REG, heartbeats, NOW);
}

describe("detectAgentLiveness", () => {
  it("absent fleetLiveness ⇒ not assessed (no findings, no noise)", () => {
    assert.deepEqual(detectAgentLiveness({ now: NOW }), []);
  });

  it("a down agent ⇒ high-severity broken_wiring finding; stale ⇒ medium stale_data", () => {
    const fleet = fleetWith([
      { agentId: "ops", lastEvidenceAt: hoursAgo(100), evidenceSource: "t" },
      { agentId: "fitness", lastEvidenceAt: hoursAgo(30), evidenceSource: "t" },
    ]);
    const findings = detectAgentLiveness({ now: NOW, fleetLiveness: fleet });
    const down = findings.find((f) => f.id === "agent-liveness:ops:down");
    const stale = findings.find((f) => f.id === "agent-liveness:fitness:stale");
    assert.ok(down && stale);
    assert.equal(down.severity, "high");
    assert.equal(down.category, "broken_wiring");
    assert.equal(stale.severity, "medium");
    assert.equal(stale.category, "stale_data");
  });

  it("unknown agents only surface when the catalog claims they run (live/partial)", () => {
    const fleet = fleetWith([]); // everything unknown
    const findings = detectAgentLiveness({ now: NOW, fleetLiveness: fleet });
    for (const f of findings) {
      const agent = REG.agents.find((a) => f.id === `agent-liveness:${a.id}:unknown`);
      assert.ok(agent, `finding ${f.id} maps to a catalog agent`);
      assert.ok(
        agent.status === "live" || agent.status === "partial",
        `${agent.id} surfaced while catalog says ${agent.status}`,
      );
      assert.equal(f.severity, "low");
    }
  });

  it("NEVER carries a fixRoute — repairs are advisory, per the autoheal invariant", () => {
    const fleet = fleetWith([{ agentId: "ops", lastEvidenceAt: hoursAgo(100), evidenceSource: "t" }]);
    for (const f of detectAgentLiveness({ now: NOW, fleetLiveness: fleet })) {
      assert.equal(f.fixRoute, undefined);
      assert.equal(f.approvalRequired, true);
    }
  });

  it("is registered in DEFAULT_DETECTORS and a down agent turns the audit AMBER/RED", () => {
    assert.ok(DEFAULT_DETECTORS.includes(detectAgentLiveness));
    const fleet = fleetWith([{ agentId: "ops", lastEvidenceAt: hoursAgo(100), evidenceSource: "t" }]);
    const report = wolverineAudit({ now: NOW, fleetLiveness: fleet }, { detectors: [detectAgentLiveness] });
    assert.notEqual(report.verdict, "GREEN");
    assert.ok(report.repairQueue.some((f) => f.id === "agent-liveness:ops:down"));
  });
});
