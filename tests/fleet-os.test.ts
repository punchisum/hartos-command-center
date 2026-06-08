/**
 * tests/fleet-os.test.ts — Phase F3.
 *
 * Lean Fleet OS: the registry + a deterministic health pass that matches each
 * declared agent to its live signal, classifies online/stale/silent/advisory, and
 * — crucially — catches a REGISTERED-BUT-SILENT agent (one the signal-only view
 * can't surface). Honest: no fabricated health.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessFleet, FLEET_REGISTRY } from "../src/fleet/fleet-os.js";
import type { FleetSignal } from "../src/read-models/agent-signal.js";

function sig(type: string, freshness: string, confidence = "high"): FleetSignal {
  return { id: type, type, signal: { verdict: "ok", confidence, freshness, facts: [], reason: "r", nextAction: null, approvalNeeded: false } } as unknown as FleetSignal;
}

describe("fleet os (Phase F3)", () => {
  it("marks fresh agents online + the planner advisory; verdict healthy", () => {
    const r = assessFleet([sig("fitness", "live"), sig("ops", "fresh")]);
    assert.equal(r.agents.find((a) => a.id === "fitness")!.health, "online");
    assert.equal(r.agents.find((a) => a.id === "ops")!.health, "online");
    assert.equal(r.agents.find((a) => a.id === "research")!.health, "advisory");
    assert.equal(r.online, 2);
    assert.equal(r.verdict, "healthy");
  });

  it("flags a stale signal → degraded", () => {
    const r = assessFleet([sig("fitness", "live"), sig("ops", "stale")]);
    assert.equal(r.agents.find((a) => a.id === "ops")!.health, "stale");
    assert.equal(r.stale, 1);
    assert.equal(r.verdict, "degraded");
  });

  it("catches a registered-but-silent agent (no signal) → attention", () => {
    const r = assessFleet([sig("ops", "fresh")]); // fitness registered but absent
    const fit = r.agents.find((a) => a.id === "fitness")!;
    assert.equal(fit.health, "silent");
    assert.match(fit.detail, /reporting no signal/);
    assert.equal(r.silent, 1);
    assert.equal(r.verdict, "attention");
  });

  it("treats unknown freshness as silent (can't vouch for it)", () => {
    const r = assessFleet([sig("fitness", "unknown"), sig("ops", "fresh")]);
    assert.equal(r.agents.find((a) => a.id === "fitness")!.health, "silent");
  });

  it("covers every registered agent and is deterministic", () => {
    const sigs = [sig("fitness", "live"), sig("ops", "fresh")];
    const r = assessFleet(sigs);
    assert.equal(r.agents.length, FLEET_REGISTRY.length);
    assert.deepEqual(assessFleet(sigs), assessFleet(sigs));
  });
});
