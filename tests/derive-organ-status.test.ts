import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOrganStatus } from "../src/organs/derive-organ-status.js";
import type { OrganEvidence } from "../src/organs/organ-contract.js";

const base: OrganEvidence = {
  heartbeatAgeSec: 30,
  stalenessThresholdSec: 900,
  lastRun: { ok: true, trigger: "scheduled", disarmed: false, outputRef: "ref-1" },
  readbackOk: true,
  lifecycleRetired: false,
};

test("all four present => LIVE", () => assert.equal(deriveOrganStatus(base), "LIVE"));
test("retired => RETIRED", () => assert.equal(deriveOrganStatus({ ...base, lifecycleRetired: true }), "RETIRED"));
test("last run failed => FAILED", () =>
  assert.equal(deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, ok: false } }), "FAILED"));
test("stale heartbeat => FAILED", () => assert.equal(deriveOrganStatus({ ...base, heartbeatAgeSec: 5000 }), "FAILED"));
test("no output_ref => not LIVE (PARTIAL)", () =>
  assert.equal(deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, outputRef: null } }), "PARTIAL"));
test("no readback => not LIVE (PARTIAL)", () => assert.equal(deriveOrganStatus({ ...base, readbackOk: false }), "PARTIAL"));
test("disarmed run => not LIVE (PARTIAL)", () =>
  assert.equal(deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, disarmed: true } }), "PARTIAL"));
test("no run, no heartbeat => REGISTERED", () =>
  assert.equal(deriveOrganStatus({ ...base, heartbeatAgeSec: null, lastRun: null }), "REGISTERED"));
