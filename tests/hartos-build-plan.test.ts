/**
 * tests/hartos-build-plan.test.ts
 *
 * Phase 11F — build plan generation tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateBuildPlan } from "../src/hartos/build-plan.js";

describe("hartos build-plan", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-buildplan-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("produces a non-empty build sequence", async () => {
    const plan = await generateBuildPlan("build a dashboard cockpit", { cwd: tmpDir });
    assert.ok(plan.phaseBreakdown.length > 0);
    assert.ok(plan.phaseBreakdown[0]!.order === 1);
  });

  it("tax agent build sequence is foundation-first", async () => {
    const plan = await generateBuildPlan("build a tax specialist agent", { cwd: tmpDir });
    const titles = plan.phaseBreakdown.map((p) => p.title.toLowerCase());
    // First phase should be the document/receipt foundation, not the tax agent.
    assert.ok(/receipt|document/.test(titles[0]!), `first phase was: ${titles[0]}`);
    assert.ok(titles.some((t) => t.includes("tax")), "tax agent should appear later in sequence");
  });

  it("includes approval gates", async () => {
    const plan = await generateBuildPlan("build a dashboard cockpit", { cwd: tmpDir });
    assert.ok(plan.approvalGates.length > 0);
    assert.ok(plan.approvalGates.some((g) => /approve/i.test(g)));
  });

  it("includes a do-not-build list", async () => {
    const plan = await generateBuildPlan("build a tax specialist agent", { cwd: tmpDir });
    assert.ok(plan.doNotBuild.length > 0);
    assert.ok(plan.doNotBuild.some((d) => /tax/i.test(d)), "tax plan should warn against building tax agent first");
  });

  it("includes a suggested next prompt skeleton", async () => {
    const plan = await generateBuildPlan("build a dashboard cockpit", { cwd: tmpDir });
    assert.ok(typeof plan.nextPromptSkeleton === "string");
    assert.ok(plan.nextPromptSkeleton.includes("Next prompt skeleton"));
    assert.ok(plan.nextPromptSkeleton.includes("Classification:"));
  });

  it("includes domain placement and risks", async () => {
    const plan = await generateBuildPlan("build a tax specialist agent", { cwd: tmpDir });
    assert.ok(typeof plan.domainPlacement === "string");
    assert.ok(plan.domainPlacement.length > 0);
    assert.ok(plan.risks.length > 0);
  });
});
