/**
 * tests/self-mod-executor.test.ts — P6: the self-mod orchestration gauntlet (injected ports).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeSelfMod, type SelfModPorts } from "../src/execution/self-mod-executor.js";
import { type ExecBaseline } from "../src/execution/claude-exec-baseline.js";
import { type PreVerifyResult } from "../src/execution/self-mod-pre-verify.js";
import { type PostVerifyResult } from "../src/execution/self-mod-post-verify.js";
import { type RollbackResult } from "../src/execution/self-mod-rollback.js";

const BASE: ExecBaseline = { headSha: "sha-1", preexistingDirty: [] };
const OK_ROLLBACK: RollbackResult = { ok: true, attemptedRestore: [], attemptedRemove: [], errors: [] };

interface Over {
  armed?: boolean;
  pre?: PreVerifyResult;
  hand?: { ok: boolean; detail: string };
  changed?: string[];
  tests?: { ok: boolean; detail: string };
  post?: PostVerifyResult;
  rollback?: RollbackResult;
}

function makePorts(over: Over = {}) {
  const calls: string[] = [];
  const ports: SelfModPorts = {
    isArmed: () => { calls.push("isArmed"); return over.armed ?? true; },
    preVerify: () => { calls.push("preVerify"); return over.pre ?? { ok: true, baseline: BASE, reason: "clean" }; },
    runHand: async () => { calls.push("runHand"); return over.hand ?? { ok: true, detail: "applied" }; },
    changedFiles: () => { calls.push("changedFiles"); return over.changed ?? ["src/a.ts"]; },
    diffText: () => { calls.push("diffText"); return "+ x"; },
    runTests: () => { calls.push("runTests"); return over.tests ?? { ok: true, detail: "2800 pass" }; },
    postVerify: () => { calls.push("postVerify"); return over.post ?? { ok: true, violations: [] }; },
    rollback: () => { calls.push("rollback"); return over.rollback ?? OK_ROLLBACK; },
  };
  return { ports, calls };
}

describe("executeSelfMod", () => {
  it("not armed → skipped at the gate, never touches the tree", async () => {
    const { ports, calls } = makePorts({ armed: false });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "skipped");
    assert.equal(r.stage, "amendment-gate");
    assert.deepEqual(calls, ["isArmed"]);
  });

  it("dirty/unverifiable pre-verify → skipped, hand never runs", async () => {
    const { ports, calls } = makePorts({ pre: { ok: false, reason: "working tree not clean" } });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "skipped");
    assert.equal(r.stage, "pre-verify");
    assert.ok(!calls.includes("runHand"));
  });

  it("happy path → kept, no rollback", async () => {
    const { ports, calls } = makePorts({ changed: ["src/a.ts", "src/b.ts"] });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "kept");
    assert.equal(r.stage, "verified");
    assert.deepEqual(r.changedFiles, ["src/a.ts", "src/b.ts"]);
    assert.ok(!calls.includes("rollback"));
  });

  it("hand fails → rolls back partial edits, does not proceed to verify", async () => {
    const { ports, calls } = makePorts({ hand: { ok: false, detail: "claude errored" } });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rolled-back");
    assert.equal(r.stage, "hand");
    assert.match(r.reason, /hand failed/);
    assert.ok(calls.includes("rollback"));
    assert.ok(!calls.includes("runTests"));
  });

  it("tests fail → rolls back", async () => {
    const { ports } = makePorts({ tests: { ok: false, detail: "3 failing" } });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rolled-back");
    assert.equal(r.stage, "verify");
    assert.match(r.reason, /tests failed/);
  });

  it("post-verify fails (out of scope) → rolls back", async () => {
    const { ports } = makePorts({ post: { ok: false, violations: [{ kind: "out-of-scope", detail: "src/doctrine/x.ts: denied" }] } });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rolled-back");
    assert.equal(r.stage, "verify");
    assert.match(r.reason, /post-verify/);
    assert.match(r.reason, /out-of-scope/);
  });

  it("reports BOTH failures (tests + post-verify) before rolling back", async () => {
    const { ports } = makePorts({
      tests: { ok: false, detail: "t" },
      post: { ok: false, violations: [{ kind: "secret-leak", detail: "token" }] },
    });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rolled-back");
    assert.match(r.reason, /tests failed/);
    assert.match(r.reason, /secret-leak/);
  });

  it("verify fails AND rollback fails → rollback-failed with errors surfaced", async () => {
    const { ports } = makePorts({
      tests: { ok: false, detail: "x" },
      rollback: { ok: false, attemptedRestore: ["src/a.ts"], attemptedRemove: [], errors: ["restore failed: boom"] },
    });
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rollback-failed");
    assert.ok(r.errors.some((e) => /restore failed/.test(e)));
  });

  // A port THROWING (rejecting subprocess hand, failing git diff, un-spawnable test runner) must NOT
  // leave a dirty tree un-rolled-back or escape as an exception — it must roll back + return a verdict.
  it("hand REJECTS → recomputes the changed set, rolls back, never escapes", async () => {
    const { ports, calls } = makePorts({ changed: ["src/partial.ts"] });
    ports.runHand = async () => { throw new Error("subprocess died"); };
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rolled-back");
    assert.match(r.reason, /port threw/);
    assert.ok(calls.includes("rollback"), "must roll back partial edits");
    assert.deepEqual(r.changedFiles, ["src/partial.ts"], "recomputes the changed set to know what to revert");
  });

  it("runTests THROWS → rolls back, never escapes as an exception", async () => {
    const { ports, calls } = makePorts();
    ports.runTests = () => { throw new Error("ENOENT: npm not found"); };
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rolled-back");
    assert.match(r.reason, /port threw/);
    assert.ok(calls.includes("rollback"));
  });

  it("a THROWING rollback port → rollback-failed (still no escape)", async () => {
    const { ports } = makePorts({ tests: { ok: false, detail: "x" } });
    ports.rollback = () => { throw new Error("git restore exploded"); };
    const r = await executeSelfMod(ports);
    assert.equal(r.outcome, "rollback-failed");
    assert.ok(r.errors.some((e) => /rollback threw/.test(e)));
  });
});
