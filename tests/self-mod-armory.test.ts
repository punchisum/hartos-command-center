/**
 * tests/self-mod-armory.test.ts — P6 §6: circuit breaker + rate cap (pure, injected store).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canAutoApply, RATE_LIMIT_MS, type ArmoryStore } from "../src/execution/self-mod-armory.js";

function makeStore(over: { disarmed?: boolean; lastAt?: number | null } = {}): ArmoryStore {
  return {
    isDisarmed: () => over.disarmed ?? false,
    setDisarmed: () => {},
    clearDisarmed: () => {},
    lastAutoDeployAt: () => (over.lastAt === undefined ? null : over.lastAt),
    recordAutoDeploy: () => {},
  };
}

describe("canAutoApply", () => {
  it("clear when not disarmed and no recent deploy", () => {
    assert.equal(canAutoApply(1_000_000, makeStore()).ok, true);
  });

  it("blocked when disarmed (breaker tripped)", () => {
    const r = canAutoApply(1_000_000, makeStore({ disarmed: true }));
    assert.equal(r.ok, false);
    assert.match(r.reason, /disarm/i);
  });

  it("rate-limited when the last auto-deploy is within the window", () => {
    const now = 5_000_000;
    const r = canAutoApply(now, makeStore({ lastAt: now - (RATE_LIMIT_MS - 1) }));
    assert.equal(r.ok, false);
    assert.match(r.reason, /rate/i);
  });

  it("clear when the last auto-deploy is exactly at/older than the window", () => {
    const now = 5_000_000;
    assert.equal(canAutoApply(now, makeStore({ lastAt: now - RATE_LIMIT_MS })).ok, true);
  });

  it("disarm takes precedence over the rate check", () => {
    const now = 5_000_000;
    const r = canAutoApply(now, makeStore({ disarmed: true, lastAt: now - 1000 }));
    assert.equal(r.ok, false);
    assert.match(r.reason, /disarm/i);
  });

  it("RATE_LIMIT_MS is one hour", () => {
    assert.equal(RATE_LIMIT_MS, 60 * 60 * 1000);
  });
});
