/**
 * tests/self-mod-deploy-health.test.ts — P6 §6: post-deploy health + deployed-SHA check (fake fetch).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkDeployedSha, type FetchLike } from "../src/execution/self-mod-deploy-health.js";

function fakeFetch(status: number, body: unknown, opts: { throws?: boolean } = {}): FetchLike {
  return async () => {
    if (opts.throws) throw new Error("network down");
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

describe("checkDeployedSha", () => {
  it("ok when health is ok AND version matches the expected SHA", async () => {
    const r = await checkDeployedSha("https://cockpit.example.com", "abc123", fakeFetch(200, { ok: true, version: "abc123" }));
    assert.equal(r.ok, true);
    assert.equal(r.servingSha, "abc123");
  });

  it("FAILS on a SHA mismatch even when health is ok (the core contract)", async () => {
    const r = await checkDeployedSha("https://cockpit.example.com", "newSHA", fakeFetch(200, { ok: true, version: "oldSHA" }));
    assert.equal(r.ok, false);
    assert.equal(r.servingSha, "oldSHA");
    assert.match(r.detail, /SHA/i);
  });

  it("fails when health reports not-ok", async () => {
    const r = await checkDeployedSha("https://x.com", "abc", fakeFetch(200, { ok: false, version: "abc" }));
    assert.equal(r.ok, false);
    assert.match(r.detail, /not-?ok|health/i);
  });

  it("fails on a non-2xx /health response", async () => {
    const r = await checkDeployedSha("https://x.com", "abc", fakeFetch(503, {}));
    assert.equal(r.ok, false);
    assert.match(r.detail, /503|HTTP/i);
  });

  it("fails (never throws) when the fetch throws", async () => {
    const r = await checkDeployedSha("https://x.com", "abc", fakeFetch(200, {}, { throws: true }));
    assert.equal(r.ok, false);
    assert.match(r.detail, /fetch failed|network/i);
  });

  it("trims a trailing slash on the base url", async () => {
    let calledUrl = "";
    const f: FetchLike = async (u: string) => { calledUrl = u; return { ok: true, status: 200, json: async () => ({ ok: true, version: "s" }) }; };
    await checkDeployedSha("https://x.com/", "s", f);
    assert.equal(calledUrl, "https://x.com/health");
  });
});
