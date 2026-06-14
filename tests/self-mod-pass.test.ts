/**
 * tests/self-mod-pass.test.ts — P6 §6: the keystone orchestration (injected deps).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSelfModPass, type SelfModPassDeps, type SelfModTask } from "../src/execution/self-mod-pass.js";
import type { SelfModRunResult } from "../src/execution/self-mod-executor.js";
import type { DeployResult } from "../src/execution/self-mod-deploy.js";

const TASK: SelfModTask = { selfModClass: "fix", description: "fix the off-by-one in foo" };
const KEPT: SelfModRunResult = { outcome: "kept", stage: "verified", reason: "verified", changedFiles: ["src/foo.ts"], errors: [] };

function makeDeps(over: Partial<SelfModPassDeps> = {}) {
  const calls: string[] = [];
  const deps: SelfModPassDeps = {
    lastGoodSha: "good-sha", now: 1000,
    runGauntlet: async () => { calls.push("gauntlet"); return KEPT; },
    changedLines: () => 20,
    classify: () => ({ tier: "auto-apply", reason: "fix within cap" }),
    canAutoApply: () => ({ ok: true, reason: "clear" }),
    deploy: async () => { calls.push("deploy"); return { outcome: "deployed", reason: "ok", deployedSha: "new-sha", errors: [] } as DeployResult; },
    recordAutoDeploy: () => { calls.push("recordAutoDeploy"); },
    captureDiff: () => "+ fix",
    propose: async () => { calls.push("propose"); },
    rollback: () => { calls.push("rollback"); },
    ...over,
  };
  return { deps, calls };
}

describe("runSelfModPass", () => {
  it("gauntlet not 'kept' → no action (nothing to route)", async () => {
    const skipped: SelfModRunResult = { outcome: "skipped", stage: "amendment-gate", reason: "not armed", changedFiles: [], errors: [] };
    const { deps, calls } = makeDeps({ runGauntlet: async () => skipped });
    const r = await runSelfModPass(TASK, deps);
    assert.equal(r.action, "none");
    assert.ok(!calls.includes("deploy"));
    assert.ok(!calls.includes("propose"));
  });

  it("kept + Tier-1 + clear breaker → auto-deploys + records the deploy (no propose/rollback)", async () => {
    const { deps, calls } = makeDeps();
    const r = await runSelfModPass(TASK, deps);
    assert.equal(r.action, "deployed");
    assert.ok(calls.includes("deploy"));
    assert.ok(calls.includes("recordAutoDeploy"));
    assert.ok(!calls.includes("propose"));
    assert.ok(!calls.includes("rollback"));
  });

  it("kept + Tier-1 deploy fails → action deploy-failed (deploy net already reverted; no extra propose/rollback)", async () => {
    const { deps, calls } = makeDeps({
      deploy: async () => ({ outcome: "reverted", reason: "smoke failed", errors: ["x"] } as DeployResult),
    });
    const r = await runSelfModPass(TASK, deps);
    assert.equal(r.action, "deploy-failed");
    assert.ok(!calls.includes("propose"));
    assert.ok(!calls.includes("recordAutoDeploy"));
  });

  it("kept + Tier-1 but breaker DISARMED → proposes + rolls back (does NOT auto-apply)", async () => {
    const { deps, calls } = makeDeps({ canAutoApply: () => ({ ok: false, reason: "disarmed" }) });
    const r = await runSelfModPass(TASK, deps);
    assert.equal(r.action, "proposed");
    assert.ok(calls.includes("propose"));
    assert.ok(calls.includes("rollback"));
    assert.ok(!calls.includes("deploy"));
    assert.match(r.detail, /disarm/i);
  });

  it("kept + Tier-2 (extend / over cap) → proposes + rolls back", async () => {
    const { deps, calls } = makeDeps({ classify: () => ({ tier: "propose-only", reason: "extend is propose-only" }) });
    const r = await runSelfModPass({ selfModClass: "extend", description: "add a thing" }, deps);
    assert.equal(r.action, "proposed");
    assert.ok(calls.includes("propose"));
    assert.ok(calls.includes("rollback"));
    assert.ok(!calls.includes("deploy"));
  });
});
