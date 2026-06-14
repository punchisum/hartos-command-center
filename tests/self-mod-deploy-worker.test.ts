/**
 * tests/self-mod-deploy-worker.test.ts — P6 §6: the wrangler deploy primitive (injected runner).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deployCloudflareWorker, type WranglerRunner } from "../src/execution/self-mod-deploy-worker.js";

function recordingRunner(code: number) {
  const calls: { args: string[] }[] = [];
  const run: WranglerRunner = (args) => { calls.push({ args }); return { code, detail: code === 0 ? "" : "wrangler exploded" }; };
  return { run, calls };
}

const ARMED = { ALLOW_CLOUDFLARE_DEPLOY: "true" };

describe("deployCloudflareWorker", () => {
  it("gated off by default — never runs wrangler", () => {
    const { run, calls } = recordingRunner(0);
    const r = deployCloudflareWorker("sha1", {}, "2026-06-14T00:00:00Z", run);
    assert.equal(r.ok, false);
    assert.match(r.detail, /gated|ALLOW_CLOUDFLARE_DEPLOY/i);
    assert.equal(calls.length, 0, "must not spawn wrangler when gated off");
  });

  it("armed + runner exits 0 → ok, injects BUILD_SHA + env staging by default", () => {
    const { run, calls } = recordingRunner(0);
    const r = deployCloudflareWorker("sha-abc", ARMED, "2026-06-14T00:00:00Z", run);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(0, 4), ["deploy", "--env", "staging", "--var"]);
    assert.ok(calls[0].args.includes("BUILD_SHA:sha-abc"));
  });

  it("APP_ENV=production → deploys the production env", () => {
    const { run, calls } = recordingRunner(0);
    deployCloudflareWorker("sha", { ...ARMED, APP_ENV: "production" }, "t", run);
    assert.ok(calls[0].args.includes("production"));
  });

  it("runner non-zero exit → ok:false with the failure detail", () => {
    const { run } = recordingRunner(1);
    const r = deployCloudflareWorker("sha", ARMED, "t", run);
    assert.equal(r.ok, false);
    assert.match(r.detail, /failed|exploded/i);
  });
});
