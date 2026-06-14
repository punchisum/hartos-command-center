import { test } from "node:test";
import assert from "node:assert/strict";
import { jobDisposition } from "../scripts/hartos-runner.js";

// Regression guard for the 2026-06-14 runaway-skip bug: a structurally-unrunnable job
// (wolverine.audit / rinnegan.sync) was reverted to simulated_approved on every poll and
// re-selected forever (~17k audit rows). A terminal refusal must move the row OUT of the
// re-runnable set so the job-runner stops picking it up.

test("successful job advances the spine to executed", () => {
  assert.deepEqual(jobDisposition({ ok: true }), { newStatus: "executed", event: "executed" });
});

test("transient skip (disarmed-but-armable gate) stays re-runnable at simulated_approved", () => {
  assert.deepEqual(jobDisposition({ ok: false }), { newStatus: "simulated_approved", event: "skipped" });
});

test("structural refusal terminalizes to failed — never re-runnable (no skip loop)", () => {
  assert.deepEqual(jobDisposition({ ok: false, terminal: true }), { newStatus: "failed", event: "failed" });
  // The killer property: the terminal status is NOT the one the runner re-selects on.
  assert.notEqual(jobDisposition({ ok: false, terminal: true }).newStatus, "simulated_approved");
});
