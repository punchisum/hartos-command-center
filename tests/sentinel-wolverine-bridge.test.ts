import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sentinelWolverineProposals } from "../src/wolverine/sentinel-wolverine-bridge.js";
import type { FleetLiveness, LivenessVerdict } from "../src/sentinel/sentinel-liveness.js";

const v = (over: Partial<LivenessVerdict>): LivenessVerdict => ({
  agentId: "x",
  displayName: "X",
  state: "up",
  lastEvidenceAt: "2026-06-14T00:00:00.000Z",
  ageHours: 0,
  evidenceSource: "cockpit",
  reason: "fresh",
  catalogStatus: "live",
  ...over,
});

const fleet = (verdicts: LivenessVerdict[]): FleetLiveness => ({
  generatedAt: "2026-06-14T10:00:00.000Z",
  verdicts,
  counts: { up: 0, stale: 0, down: 0, unknown: 0, assessed: verdicts.length },
  overall: "AMBER",
  overallReason: "fixture",
});

const NOW = "2026-06-14T10:00:00.000Z";

describe("sentinelWolverineProposals", () => {
  it("raises an advisory propose-only proposal for a down expected-live agent", () => {
    const out = sentinelWolverineProposals(fleet([v({ agentId: "research", displayName: "Research", state: "down", catalogStatus: "live", reason: "no evidence" })]), NOW);
    assert.equal(out.length, 1);
    const p = out[0]!;
    assert.equal(p.domain, "system");
    assert.equal(p.executable, false);
    assert.equal(p.requiredApproval, "Hart");
    assert.equal(p.status, "pending_approval");
    assert.equal(p.riskLevel, "high"); // down → high
    assert.equal(p.targetId, "research");
    assert.ok(p.title.includes("Research") && /down/.test(p.title));
  });

  it("stale → medium risk", () => {
    const out = sentinelWolverineProposals(fleet([v({ agentId: "ops", state: "stale", catalogStatus: "live" })]), NOW);
    assert.equal(out[0]!.riskLevel, "medium");
  });

  it("ignores up + unknown, and agents not expected-live (catalog unavailable)", () => {
    const out = sentinelWolverineProposals(fleet([
      v({ agentId: "a", state: "up" }),
      v({ agentId: "b", state: "unknown" }),
      v({ agentId: "c", state: "down", catalogStatus: "unavailable" }),
    ]), NOW);
    assert.equal(out.length, 0);
  });

  it("id is stable per (agent, state) — idempotent upsert, no duplicate spam", () => {
    const a = sentinelWolverineProposals(fleet([v({ agentId: "research", state: "down" })]), NOW);
    const b = sentinelWolverineProposals(fleet([v({ agentId: "research", state: "down" })]), "2026-06-14T23:59:00.000Z");
    assert.equal(a[0]!.id, b[0]!.id);
    assert.equal(a[0]!.id, "wolverine-liveness-research-down");
  });

  it("host-offline: emits ZERO per-agent cards and ONE calm acknowledgement card", () => {
    const f: FleetLiveness = {
      ...fleet([
        v({ agentId: "research", displayName: "Research Agent", state: "down", offlineExpected: true }),
        v({ agentId: "beezulbub", displayName: "Beezulbub", state: "stale", offlineExpected: true }),
      ]),
      hostOffline: {
        since: "2026-06-13T00:00:00.000Z",
        ageHours: 58,
        agents: ["Research Agent", "Beezulbub"],
        reason: "the host appears to have been offline",
      },
    };
    const out = sentinelWolverineProposals(f, NOW);
    assert.equal(out.length, 1);
    const card = out[0]!;
    assert.equal(card.id, "wolverine-host-offline");
    assert.equal(card.riskLevel, "low");
    assert.equal(card.status, "pending_approval");
    assert.equal(card.executable, false);
    assert.ok(card.expiresAt, "ack card auto-expires");
    assert.ok(/offline/i.test(card.title));
  });

  it("host-offline ack card id is stable (idempotent upsert)", () => {
    const f: FleetLiveness = {
      ...fleet([v({ agentId: "research", state: "down", offlineExpected: true })]),
      hostOffline: { since: null, ageHours: null, agents: ["Research Agent"], reason: "offline" },
    };
    const a = sentinelWolverineProposals(f, NOW)[0]!;
    const b = sentinelWolverineProposals(f, "2026-06-15T00:00:00.000Z")[0]!;
    assert.equal(a.id, b.id);
    assert.equal(a.id, "wolverine-host-offline");
  });

  it("a down agent flagged offlineExpected is NOT raised as a per-agent investigation", () => {
    // hostOffline unset here ⇒ only the per-agent path runs; the offlineExpected verdict is skipped.
    const out = sentinelWolverineProposals(
      fleet([v({ agentId: "research", state: "down", offlineExpected: true })]),
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it("never throws on a malformed fleet", () => {
    // @ts-expect-error malformed
    assert.doesNotThrow(() => sentinelWolverineProposals({}, NOW));
    // @ts-expect-error malformed
    assert.deepEqual(sentinelWolverineProposals({ verdicts: null }, NOW), []);
  });
});
