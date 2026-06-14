/**
 * tests/self-mod-deploy-ports.test.ts — P6 §6: the real DeployPorts wiring (injected git/wrangler/fetch/armory).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultDeployPorts, type GitDeployOps } from "../src/execution/self-mod-deploy-ports.js";
import { type WranglerRunner } from "../src/execution/self-mod-deploy-worker.js";
import { type FetchLike } from "../src/execution/self-mod-deploy-health.js";
import { type ArmoryStore } from "../src/execution/self-mod-armory.js";

function fakeArmory() {
  const calls: string[] = [];
  const store: ArmoryStore = {
    isDisarmed: () => false, setDisarmed: (r) => { calls.push("setDisarmed:" + r); }, clearDisarmed: () => {},
    lastAutoDeployAt: () => null, recordAutoDeploy: () => {},
  };
  return { store, calls };
}
const okWrangler: WranglerRunner = () => ({ code: 0, detail: "" });
function fakeFetch(version: string, ok = true): FetchLike {
  return async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ ok: true, version }) });
}
function fakeGit(over: Partial<GitDeployOps> = {}): GitDeployOps {
  return {
    commitAndPush: over.commitAndPush ?? (() => ({ ok: true, sha: "pushed-sha", detail: "" })),
    revertSince: over.revertSince ?? (() => ({ ok: true, sha: "revert-sha", detail: "" })),
  };
}

const ENV = { ALLOW_CLOUDFLARE_DEPLOY: "true" };

describe("defaultDeployPorts", () => {
  it("commitPush delegates to git.commitAndPush", async () => {
    const { store } = fakeArmory();
    const ports = defaultDeployPorts({ cwd: "/r", env: ENV, workerUrl: "https://x", buildTime: "t", notify: async () => {}, armory: store, git: fakeGit(), wrangler: okWrangler, fetchFn: fakeFetch("pushed-sha") });
    const r = await ports.commitPush();
    assert.equal(r.ok, true);
    assert.equal(r.sha, "pushed-sha");
  });

  it("deploy delegates to wrangler; verify checks the deployed SHA", async () => {
    const { store } = fakeArmory();
    const ports = defaultDeployPorts({ cwd: "/r", env: ENV, workerUrl: "https://x", buildTime: "t", notify: async () => {}, armory: store, git: fakeGit(), wrangler: okWrangler, fetchFn: fakeFetch("sha-A") });
    assert.equal((await ports.deploy("sha-A")).ok, true);
    assert.equal((await ports.verify("sha-A")).ok, true, "verify ok when /health serves sha-A");
    assert.equal((await ports.verify("sha-B")).ok, false, "verify fails when /health serves a different sha");
  });

  it("disarm writes the armory marker", async () => {
    const { store, calls } = fakeArmory();
    const ports = defaultDeployPorts({ cwd: "/r", env: ENV, workerUrl: "https://x", buildTime: "t", notify: async () => {}, armory: store, git: fakeGit(), wrangler: okWrangler, fetchFn: fakeFetch("s") });
    await ports.disarm("a failure");
    assert.ok(calls.some((c) => /setDisarmed:a failure/.test(c)));
  });

  it("revert REDEPLOYS and RE-VERIFIES the reverted sha (the safety contract)", async () => {
    const { store } = fakeArmory();
    // git revert returns revert-sha; wrangler ok; /health serves revert-sha → revert ok.
    const ports = defaultDeployPorts({ cwd: "/r", env: ENV, workerUrl: "https://x", buildTime: "t", notify: async () => {}, armory: store, git: fakeGit(), wrangler: okWrangler, fetchFn: fakeFetch("revert-sha") });
    const r = await ports.revert("good-sha");
    assert.equal(r.ok, true);
  });

  it("revert FAILS if the re-verify shows prod is NOT serving the reverted sha", async () => {
    const { store } = fakeArmory();
    // /health serves a stale/other sha → re-verify fails → revert NOT ok (bad build still live!)
    const ports = defaultDeployPorts({ cwd: "/r", env: ENV, workerUrl: "https://x", buildTime: "t", notify: async () => {}, armory: store, git: fakeGit(), wrangler: okWrangler, fetchFn: fakeFetch("STALE-sha") });
    const r = await ports.revert("good-sha");
    assert.equal(r.ok, false);
    assert.match(r.detail, /verif/i);
  });

  it("revert fails if the git revert itself fails", async () => {
    const { store } = fakeArmory();
    const ports = defaultDeployPorts({ cwd: "/r", env: ENV, workerUrl: "https://x", buildTime: "t", notify: async () => {}, armory: store, git: fakeGit({ revertSince: () => ({ ok: false, sha: "", detail: "merge conflict" }) }), wrangler: okWrangler, fetchFn: fakeFetch("s") });
    const r = await ports.revert("good-sha");
    assert.equal(r.ok, false);
    assert.match(r.detail, /revert/i);
  });
});
