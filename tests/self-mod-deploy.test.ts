/**
 * tests/self-mod-deploy.test.ts — P6 §6: auto-deploy + post-deploy net (injected ports).
 * Invariant under test: a bad deploy is NEVER left live — always revert + disarm + alert.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deployAndVerifySelfMod, type DeployPorts } from "../src/execution/self-mod-deploy.js";

const LAST_GOOD = "good-sha-000";

interface Over {
  commitPush?: { ok: boolean; sha: string; detail: string };
  deploy?: { ok: boolean; detail: string };
  verify?: { ok: boolean; detail: string };
  revert?: { ok: boolean; detail: string };
  throwOn?: "commitPush" | "deploy" | "verify" | "revert";
  throwOnDisarm?: boolean;
}

function makePorts(over: Over = {}) {
  const calls: string[] = [];
  const notes: string[] = [];
  const ports: DeployPorts = {
    commitPush: () => { calls.push("commitPush"); if (over.throwOn === "commitPush") throw new Error("push boom"); return over.commitPush ?? { ok: true, sha: "new-sha-111", detail: "" }; },
    deploy: () => { calls.push("deploy"); if (over.throwOn === "deploy") throw new Error("deploy boom"); return over.deploy ?? { ok: true, detail: "" }; },
    verify: () => { calls.push("verify"); if (over.throwOn === "verify") throw new Error("verify boom"); return over.verify ?? { ok: true, detail: "" }; },
    revert: () => { calls.push("revert"); if (over.throwOn === "revert") throw new Error("revert boom"); return over.revert ?? { ok: true, detail: "" }; },
    disarm: (reason: string) => { calls.push("disarm"); if (over.throwOnDisarm) throw new Error("disarm marker write failed"); notes.push("disarm:" + reason); },
    notify: (m: string) => { calls.push("notify"); notes.push(m); },
  };
  return { ports, calls, notes };
}

describe("deployAndVerifySelfMod", () => {
  it("happy path: push → deploy → verify → deployed (no revert/disarm)", async () => {
    const { ports, calls } = makePorts();
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "deployed");
    assert.equal(r.deployedSha, "new-sha-111");
    assert.ok(!calls.includes("revert"));
    assert.ok(!calls.includes("disarm"));
    assert.ok(calls.includes("notify"));
  });

  it("commit/push fails → disarm + alert, NO revert (nothing landed)", async () => {
    const { ports, calls } = makePorts({ commitPush: { ok: false, sha: "", detail: "no changes" } });
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "deploy-failed");
    assert.ok(calls.includes("disarm"));
    assert.ok(!calls.includes("revert"), "nothing landed → no revert");
    assert.ok(!calls.includes("deploy"));
  });

  it("deploy fails → revert + disarm + alert", async () => {
    const { ports, calls } = makePorts({ deploy: { ok: false, detail: "wrangler error" } });
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "reverted");
    assert.ok(calls.includes("revert"));
    assert.ok(calls.includes("disarm"));
  });

  it("post-deploy verify fails → revert + disarm + alert (the core safety net)", async () => {
    const { ports, calls, notes } = makePorts({ verify: { ok: false, detail: "smoke failed" } });
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "reverted");
    assert.ok(calls.includes("revert"));
    assert.ok(calls.includes("disarm"));
    assert.ok(notes.some((n) => /DISARMED|reverted/i.test(n)));
  });

  it("verify fails AND revert fails → revert-failed, loud alert, still disarmed", async () => {
    const { ports, calls, notes } = makePorts({ verify: { ok: false, detail: "x" }, revert: { ok: false, detail: "git reset failed" } });
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "revert-failed");
    assert.ok(calls.includes("disarm"), "disarm must still run");
    assert.ok(notes.some((n) => /manual recovery|REVERT FAILED/i.test(n)), "must loudly flag manual recovery");
  });

  it("a port THROWS after push → revert + disarm, never escapes", async () => {
    const { ports, calls } = makePorts({ throwOn: "deploy" });
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "reverted");
    assert.ok(calls.includes("revert"));
    assert.ok(calls.includes("disarm"));
  });

  it("a port throws BEFORE push (commitPush throws) → disarm, no revert, never escapes", async () => {
    const { ports, calls } = makePorts({ throwOn: "commitPush" });
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "deploy-failed");
    assert.ok(calls.includes("disarm"));
    assert.ok(!calls.includes("revert"));
  });

  it("a thrown DISARM (failed circuit breaker) is surfaced loudly, not swallowed", async () => {
    // verify fails → revert ok, but the disarm marker write throws. A breaker that didn't trip is
    // as dangerous as a failed revert → manual-recovery outcome + alert + error.
    const { ports, notes } = makePorts({ verify: { ok: false, detail: "smoke failed" }, throwOnDisarm: true });
    const r = await deployAndVerifySelfMod(LAST_GOOD, ports);
    assert.equal(r.outcome, "revert-failed", "a failed disarm escalates to the manual-recovery outcome");
    assert.ok(r.errors.some((e) => /disarm failed/i.test(e)), "the disarm failure is in errors");
    assert.ok(notes.some((n) => /manual recovery|DISARM FAILED/i.test(n)), "must loudly alert");
  });
});
