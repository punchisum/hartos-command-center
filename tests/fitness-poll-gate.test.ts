/**
 * tests/fitness-poll-gate.test.ts — P5: the live-runner fitness-poll gate (pure).
 *
 * Polling the fitness side only enqueues pending_approval proposals (it never executes), but it
 * must NOT poll a not-yet-existing RPC. So the live-runner runs the fitness poll ONLY when it is
 * explicitly enabled (HARTOS_FITNESS_POLL=on) AND the fitness identity is configured. Default OFF
 * ⇒ a pure no-op, no DB touched. Distinct from HARTOS_ALLOW_FITNESS_ADJUST (which gates the WRITE).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fitnessPollGate } from "../src/fitness/fitness-poll-gate.js";

describe("fitnessPollGate", () => {
  it("is disabled by default (no env) — a pure no-op", () => {
    const g = fitnessPollGate({});
    assert.equal(g.enabled, false);
    assert.match(g.reason, /HARTOS_FITNESS_POLL/);
  });

  it("is disabled when the flag is on but the fitness identity is missing", () => {
    const g = fitnessPollGate({ HARTOS_FITNESS_POLL: "on" });
    assert.equal(g.enabled, false);
    assert.match(g.reason, /user|agent|identity/i);
  });

  it("is disabled when the identity is set but the flag is off", () => {
    const g = fitnessPollGate({ HARTOS_FITNESS_USER_ID: "u", HARTOS_FITNESS_AGENT_ID: "a" });
    assert.equal(g.enabled, false);
  });

  it("is ENABLED only when the flag is on AND both ids are present, surfacing the context", () => {
    const g = fitnessPollGate({ HARTOS_FITNESS_POLL: "on", HARTOS_FITNESS_USER_ID: "u-1", HARTOS_FITNESS_AGENT_ID: "a-1" });
    assert.equal(g.enabled, true);
    assert.deepEqual(g.ctx, { userId: "u-1", agentId: "a-1" });
  });

  it("treats a non-'on' flag value as OFF (exact match, like the ALLOW_EXEC flags)", () => {
    assert.equal(fitnessPollGate({ HARTOS_FITNESS_POLL: "true", HARTOS_FITNESS_USER_ID: "u", HARTOS_FITNESS_AGENT_ID: "a" }).enabled, false);
  });
});
