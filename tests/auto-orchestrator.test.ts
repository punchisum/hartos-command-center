/**
 * tests/auto-orchestrator.test.ts — the async multi-agent orchestration runtime.
 * Disarmed = dry plan (no agent invoked). Armed = each step receives the PRIOR step's artifact
 * (the handoff). A failing step degrades to a skip without crashing the pipeline.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runAutoOrchestration,
  autoOrchestrateArmed,
  AUTO_ORCHESTRATE_FLAG,
  type OrchestrationSteps,
  type StepResult,
} from "../src/hartos/auto-orchestrator.js";

const now = "2026-06-11T08:00:00Z";

/** Steps that record what they received, so we can assert the artifact handoff. */
function recordingSteps(overrides: Partial<OrchestrationSteps> = {}) {
  const seen: { scoutGotResearch?: unknown; planGotResearch?: unknown; planGotScout?: unknown } = {};
  const steps: OrchestrationSteps = {
    async research(): Promise<StepResult> {
      return { step: "research", ok: true, summary: "researched", artifact: { tag: "R" } };
    },
    async scout(_req, research): Promise<StepResult> {
      seen.scoutGotResearch = research;
      return { step: "scout", ok: true, summary: "scouted", artifact: { tag: "S" } };
    },
    async plan(_req, research, scout): Promise<StepResult> {
      seen.planGotResearch = research;
      seen.planGotScout = scout;
      return { step: "plan", ok: true, summary: "planned", artifact: { tag: "P" } };
    },
    ...overrides,
  };
  return { steps, seen };
}

describe("auto-orchestration runtime", () => {
  it("disarmed by default — dry plan, no agent invoked", async () => {
    let called = false;
    const { steps } = recordingSteps({
      async research() {
        called = true;
        return { step: "research", ok: true, summary: "x", artifact: null };
      },
    });
    const res = await runAutoOrchestration({ request: "a markdown editor", env: {}, now, steps });
    assert.equal(res.armed, false);
    assert.equal(res.ran, false);
    assert.equal(called, false, "no agent runs while disarmed");
    assert.match(res.lines[0], /DISARMED/);
    assert.equal(autoOrchestrateArmed({}), false);
  });

  it("empty request never runs", async () => {
    const { steps } = recordingSteps();
    const res = await runAutoOrchestration({ request: "   ", env: { [AUTO_ORCHESTRATE_FLAG]: "true" }, now, steps });
    assert.equal(res.ran, false);
  });

  it("armed: each step receives the PRIOR step's artifact (the handoff)", async () => {
    const { steps, seen } = recordingSteps();
    const res = await runAutoOrchestration({ request: "a markdown editor", env: { [AUTO_ORCHESTRATE_FLAG]: "true" }, now, steps });
    assert.equal(res.ran, true);
    assert.deepEqual(seen.scoutGotResearch, { tag: "R" }, "scout sees the research artifact");
    assert.deepEqual(seen.planGotResearch, { tag: "R" }, "plan sees the research artifact");
    assert.deepEqual(seen.planGotScout, { tag: "S" }, "plan sees the scout artifact");
    assert.equal(res.steps.length, 3);
  });

  it("a failing step degrades to a skip — the pipeline continues with a null artifact", async () => {
    const { steps, seen } = recordingSteps({
      async research(): Promise<StepResult> {
        throw new Error("gather refused");
      },
    });
    const res = await runAutoOrchestration({ request: "x", env: { [AUTO_ORCHESTRATE_FLAG]: "true" }, now, steps });
    assert.equal(res.ran, true, "pipeline still completes");
    assert.equal(res.steps[0]?.ok, false);
    assert.match(res.steps[0]?.summary ?? "", /failed: gather refused/);
    assert.equal(seen.scoutGotResearch, null, "scout receives a null research artifact, not a crash");
    assert.equal(res.steps[2]?.ok, true, "the build-plan step still ran");
  });
});
