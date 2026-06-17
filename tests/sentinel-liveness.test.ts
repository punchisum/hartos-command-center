/**
 * tests/sentinel-liveness.test.ts — Sentinel pure core.
 * Verdict thresholds, honest unknowns, upstream-stale carry-through, ordering, rollup.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";
import {
  assessFleetLiveness,
  describeFleetLiveness,
  DEFAULT_DOWN_HOURS,
  DEFAULT_STALE_HOURS,
  type AgentHeartbeat,
} from "../src/sentinel/sentinel-liveness.js";

const NOW = "2026-06-11T12:00:00.000Z";
const REG = resolveMetaAgentRegistry({ now: NOW });

function hoursAgo(h: number): string {
  return new Date(Date.parse(NOW) - h * 36e5).toISOString();
}

function verdictFor(agentId: string, heartbeats: AgentHeartbeat[]) {
  const fleet = assessFleetLiveness(REG, heartbeats, NOW);
  const v = fleet.verdicts.find((x) => x.agentId === agentId);
  assert.ok(v, `verdict for ${agentId} missing`);
  return { fleet, v };
}

describe("assessFleetLiveness", () => {
  it("fresh evidence ⇒ up; old ⇒ stale; very old ⇒ down (default thresholds)", () => {
    assert.equal(verdictFor("research", [{ agentId: "research", lastEvidenceAt: hoursAgo(2), evidenceSource: "t" }]).v.state, "up");
    assert.equal(
      verdictFor("research", [{ agentId: "research", lastEvidenceAt: hoursAgo(DEFAULT_STALE_HOURS + 1), evidenceSource: "t" }]).v.state,
      "stale",
    );
    assert.equal(
      verdictFor("research", [{ agentId: "research", lastEvidenceAt: hoursAgo(DEFAULT_DOWN_HOURS + 1), evidenceSource: "t" }]).v.state,
      "down",
    );
  });

  it("no heartbeat ⇒ unknown, never assumed up — and the reason says so", () => {
    const { v } = verdictFor("beezulbub", []);
    assert.equal(v.state, "unknown");
    assert.match(v.reason, /unknown is honest/i);
  });

  it("an empty evidence source (null timestamp) is unknown with the source named", () => {
    const { v } = verdictFor("research", [{ agentId: "research", lastEvidenceAt: null, evidenceSource: "research-reports/" }]);
    assert.equal(v.state, "unknown");
    assert.match(v.reason, /research-reports/);
  });

  it("upstreamStale carries the diagnostics verdict through as stale (no fabricated timestamp)", () => {
    const { v } = verdictFor("fitness", [
      { agentId: "fitness", lastEvidenceAt: null, evidenceSource: "fitness read-model diagnostics", upstreamStale: true },
    ]);
    assert.equal(v.state, "stale");
    assert.match(v.reason, /carried through/);
  });

  it("unparseable timestamps refuse to guess", () => {
    const { v } = verdictFor("research", [{ agentId: "research", lastEvidenceAt: "not-a-date", evidenceSource: "t" }]);
    assert.equal(v.state, "unknown");
    assert.match(v.reason, /refusing to guess/i);
  });

  it("never assesses Hart or Sentinel itself", () => {
    const fleet = assessFleetLiveness(REG, [], NOW);
    assert.ok(!fleet.verdicts.some((v) => v.agentId === "hart" || v.agentId === "sentinel"));
  });

  it("rollup: any down ⇒ RED; stale/unknown ⇒ AMBER; all up ⇒ GREEN — and ordering is worst-first", () => {
    const allUp = REG.agents
      .filter((a) => a.category !== "human" && a.id !== "sentinel")
      .map((a): AgentHeartbeat => ({ agentId: a.id, lastEvidenceAt: hoursAgo(1), evidenceSource: "t" }));
    assert.equal(assessFleetLiveness(REG, allUp, NOW).overall, "GREEN");

    const oneStale = allUp.map((h) => (h.agentId === "ops" ? { ...h, lastEvidenceAt: hoursAgo(30) } : h));
    assert.equal(assessFleetLiveness(REG, oneStale, NOW).overall, "AMBER");

    const oneDown = allUp.map((h) => (h.agentId === "ops" ? { ...h, lastEvidenceAt: hoursAgo(100) } : h));
    const red = assessFleetLiveness(REG, oneDown, NOW);
    assert.equal(red.overall, "RED");
    assert.equal(red.verdicts[0]!.agentId, "ops"); // down sorts first
    assert.equal(red.counts.down, 1);
  });

  it("deterministic: same inputs ⇒ deep-equal output", () => {
    const hb: AgentHeartbeat[] = [{ agentId: "research", lastEvidenceAt: hoursAgo(2), evidenceSource: "t" }];
    assert.deepEqual(assessFleetLiveness(REG, hb, NOW), assessFleetLiveness(REG, hb, NOW));
  });

  it("describeFleetLiveness prints the rollup + one line per agent", () => {
    const text = describeFleetLiveness(assessFleetLiveness(REG, [], NOW));
    assert.match(text, /Sentinel — fleet liveness AMBER/);
    assert.match(text, /\[UNKNOWN\]/);
  });

  it("host-offline: all host-bound evidence stale ⇒ those silences flagged offlineExpected + one note", () => {
    const fleet = assessFleetLiveness(
      REG,
      [
        { agentId: "research", lastEvidenceAt: hoursAgo(40), evidenceSource: "research-reports/", hostBound: true },
        { agentId: "beezulbub", lastEvidenceAt: hoursAgo(50), evidenceSource: "beezulbub-reports/", hostBound: true },
      ],
      NOW,
    );
    const research = fleet.verdicts.find((v) => v.agentId === "research")!;
    const beezulbub = fleet.verdicts.find((v) => v.agentId === "beezulbub")!;
    assert.equal(research.offlineExpected, true);
    assert.equal(beezulbub.offlineExpected, true);
    assert.ok(fleet.hostOffline, "hostOffline note populated");
    assert.equal(fleet.hostOffline!.since, hoursAgo(40)); // freshest host-bound evidence
    assert.ok(fleet.hostOffline!.agents.includes("Research Agent"));
    assert.match(fleet.hostOffline!.reason, /offline/i);
  });

  it("host-offline with only null-timestamp host-bound evidence ⇒ note with null since + honest reason", () => {
    const fleet = assessFleetLiveness(
      REG,
      [
        {
          agentId: "fitness",
          lastEvidenceAt: null,
          evidenceSource: "fitness read-model diagnostics",
          upstreamStale: true,
          hostBound: true,
        },
      ],
      NOW,
    );
    assert.ok(fleet.hostOffline, "note still fires (the agent is stale, just with no timestamp)");
    assert.equal(fleet.hostOffline!.since, null);
    assert.equal(fleet.hostOffline!.ageHours, null);
    assert.ok(fleet.hostOffline!.agents.includes("Fitness Agent"));
    assert.match(fleet.hostOffline!.reason, /no host-bound agent has produced any evidence/i);
  });

  it("host-on: one host-bound agent fresh ⇒ no host-offline gate; a separate stale agent stays organic", () => {
    const fleet = assessFleetLiveness(
      REG,
      [
        { agentId: "research", lastEvidenceAt: hoursAgo(1), evidenceSource: "research-reports/", hostBound: true },
        { agentId: "beezulbub", lastEvidenceAt: hoursAgo(40), evidenceSource: "beezulbub-reports/", hostBound: true },
      ],
      NOW,
    );
    assert.equal(fleet.hostOffline, null);
    const beezulbub = fleet.verdicts.find((v) => v.agentId === "beezulbub")!;
    assert.equal(beezulbub.state, "stale");
    assert.ok(!beezulbub.offlineExpected, "stale-while-host-on is organic, not offlineExpected");
  });

  it("cloud-only heartbeats (no hostBound) never trigger the host-offline gate", () => {
    const fleet = assessFleetLiveness(
      REG,
      [{ agentId: "ops", lastEvidenceAt: hoursAgo(100), evidenceSource: "ops read-model" }],
      NOW,
    );
    assert.equal(fleet.hostOffline, null);
    assert.ok(!fleet.verdicts.find((v) => v.agentId === "ops")!.offlineExpected);
  });

  it("describeFleetLiveness prints a calm host-offline line when the host was off", () => {
    const fleet = assessFleetLiveness(
      REG,
      [{ agentId: "research", lastEvidenceAt: hoursAgo(40), evidenceSource: "research-reports/", hostBound: true }],
      NOW,
    );
    assert.match(describeFleetLiveness(fleet), /Host appears OFFLINE/i);
  });
});
