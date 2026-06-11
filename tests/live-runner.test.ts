/**
 * tests/live-runner.test.ts — the event-triggered live-runner control loop (pure).
 * Interval resolution/clamp, activity detection, loop iteration + stop, quiet-when-idle,
 * continue-on-cycle-error.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePollMs,
  cycleDidWork,
  runLiveRunnerLoop,
  DEFAULT_POLL_SEC,
  MIN_POLL_SEC,
  MAX_POLL_SEC,
  type LiveRunnerControl,
} from "../src/jobs/live-runner.js";

describe("resolvePollMs", () => {
  it("defaults when unset/invalid", () => {
    assert.equal(resolvePollMs({}), DEFAULT_POLL_SEC * 1000);
    assert.equal(resolvePollMs({ HARTOS_RUNNER_POLL_SEC: "abc" }), DEFAULT_POLL_SEC * 1000);
    assert.equal(resolvePollMs({ HARTOS_RUNNER_POLL_SEC: "0" }), DEFAULT_POLL_SEC * 1000);
  });
  it("honors a valid value and clamps to the band", () => {
    assert.equal(resolvePollMs({ HARTOS_RUNNER_POLL_SEC: "10" }), 10_000);
    assert.equal(resolvePollMs({ HARTOS_RUNNER_POLL_SEC: "1" }), MIN_POLL_SEC * 1000);
    assert.equal(resolvePollMs({ HARTOS_RUNNER_POLL_SEC: "99999" }), MAX_POLL_SEC * 1000);
  });
});

describe("cycleDidWork", () => {
  it("true when a job reached a terminal outcome; false when idle/unconfigured", () => {
    assert.equal(cycleDidWork(["1 Hart-approved agent job(s):", "  • x [research.brief] → executed: ok"]), true);
    assert.equal(cycleDidWork(["  • y [report] → skipped: gate disarmed"]), true);
    assert.equal(cycleDidWork(["No Hart-approved agent jobs in the spine — nothing to run."]), false);
    assert.equal(cycleDidWork(["Proposal spine not configured (set HARTOS_SUPABASE_DB_URL) — no jobs to run."]), false);
  });
});

function harness(cycleResults: Array<string[] | Error>, stopAfter: number) {
  const logs: string[] = [];
  let sleeps = 0;
  let i = 0;
  const ctrl: LiveRunnerControl = {
    runCycle: async () => {
      const r = cycleResults[Math.min(i, cycleResults.length - 1)];
      i += 1;
      if (r instanceof Error) throw r;
      return r;
    },
    sleep: async () => {
      sleeps += 1;
    },
    now: () => "2026-06-11T00:00:00.000Z",
    log: (l) => logs.push(l),
    shouldStop: () => i >= stopAfter,
  };
  return { ctrl, logs: () => logs, sleeps: () => sleeps };
}

describe("runLiveRunnerLoop", () => {
  it("runs cycles until shouldStop and reports counts", async () => {
    const h = harness([["  • a → executed: ok"]], 3);
    const s = await runLiveRunnerLoop(h.ctrl, 5000);
    assert.equal(s.cycles, 3);
    assert.equal(s.activeCycles, 3); // every cycle did work in this harness
  });

  it("stays quiet on idle cycles, logs only active ones", async () => {
    const h = harness([["No Hart-approved agent jobs in the spine — nothing to run."]], 2);
    const s = await runLiveRunnerLoop(h.ctrl, 5000);
    assert.equal(s.activeCycles, 0);
    assert.equal(h.logs().length, 0, "idle cycles must not log");
  });

  it("logs the work lines on an active cycle", async () => {
    const h = harness([["1 Hart-approved agent job(s):", "  • z [research.brief] → executed: done"]], 1);
    await runLiveRunnerLoop(h.ctrl, 5000);
    assert.ok(h.logs().some((l) => /research\.brief.*executed/.test(l)));
  });

  it("a thrown cycle is logged and the loop continues (daemon resilience)", async () => {
    const h = harness([new Error("db blip"), ["  • a → executed: ok"]], 2);
    const s = await runLiveRunnerLoop(h.ctrl, 5000);
    assert.equal(s.cycles, 2);
    assert.ok(h.logs().some((l) => /cycle error.*db blip/i.test(l)));
  });

  it("sleeps between cycles but not after the final (stop) one", async () => {
    const h = harness([["  • a → executed: ok"]], 3);
    await runLiveRunnerLoop(h.ctrl, 5000);
    // 3 cycles; the 3rd sees shouldStop()==true right after running, so it breaks before sleeping.
    assert.equal(h.sleeps(), 2);
  });
});
