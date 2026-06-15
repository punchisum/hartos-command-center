import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOrganStatus } from "../src/organs/derive-organ-status.js";
import type { OrganEvidence } from "../src/organs/organ-contract.js";

const base: OrganEvidence = {
  heartbeatAgeSec: 30,
  stalenessThresholdSec: 900,
  lastRun: { ok: true, trigger: "scheduled", disarmed: false, errored: false, outputRef: "ref-1" },
  readbackOk: true,
  lifecycleRetired: false,
};

test("all four present => LIVE", () => assert.equal(deriveOrganStatus(base), "LIVE"));
test("retired => RETIRED", () => assert.equal(deriveOrganStatus({ ...base, lifecycleRetired: true }), "RETIRED"));
test("errored run => FAILED", () =>
  assert.equal(deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, ok: false, errored: true } }), "FAILED"));
test("stale heartbeat => FAILED", () => assert.equal(deriveOrganStatus({ ...base, heartbeatAgeSec: 5000 }), "FAILED"));

// STANDBY: armed (not disarmed) + ran cleanly (not errored) + produced NO output = ready, no work yet.
test("armed + ran clean + no output => STANDBY (council w/o goal, factory w/o spec)", () =>
  assert.equal(
    deriveOrganStatus({ ...base, lastRun: { ok: false, trigger: "scheduled", disarmed: false, errored: false, outputRef: null } }),
    "STANDBY",
  ));

// DISARMED: gate off — distinct from standby (which is armed-and-ready).
test("disarmed run => DISARMED (gate off), never FAILED/STANDBY", () =>
  assert.equal(
    deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, ok: false, disarmed: true, errored: false, outputRef: null } }),
    "DISARMED",
  ));
test("disarmed but ok:true => still DISARMED (gate off wins over a stale ok)", () =>
  assert.equal(deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, disarmed: true } }), "DISARMED"));

// PARTIAL: ran with SOME evidence (an output) but short of the full LIVE gate — not idle, part-way.
test("ok:false WITH an output (not errored) => PARTIAL (part-way, not standby)", () =>
  assert.equal(deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, ok: false, errored: false } }), "PARTIAL"));
test("ok:true, no output => PARTIAL (part-way)", () =>
  assert.equal(deriveOrganStatus({ ...base, lastRun: { ...base.lastRun!, outputRef: null } }), "PARTIAL"));
test("no readback => PARTIAL", () => assert.equal(deriveOrganStatus({ ...base, readbackOk: false }), "PARTIAL"));

test("no run, no heartbeat => REGISTERED", () =>
  assert.equal(deriveOrganStatus({ ...base, heartbeatAgeSec: null, lastRun: null }), "REGISTERED"));
