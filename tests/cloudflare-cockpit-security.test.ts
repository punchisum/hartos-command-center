/**
 * tests/cloudflare-cockpit-security.test.ts — Phase 11J.
 * Security policy: action execution disabled, no mutation endpoints, method
 * allowlist, default-denied CORS, body size limit, security headers.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ACTION_EXECUTION,
  MUTATION_ENDPOINTS,
  ALLOWED_METHODS,
  MAX_REQUEST_BODY_BYTES,
  SECURITY_HEADERS,
  SECURITY_CHECKLIST,
  corsHeaders,
} from "../src/runtime/cloudflare-security.js";
import { handleCockpitRequest, createCockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";

describe("cloudflare cockpit security policy", () => {
  it("disables action execution and exposes no mutation endpoints", () => {
    assert.equal(ACTION_EXECUTION, "disabled");
    assert.equal(MUTATION_ENDPOINTS, "none");
  });

  it("allowlists only safe methods", () => {
    assert.deepEqual([...ALLOWED_METHODS], ["GET", "POST", "OPTIONS"]);
  });

  it("limits body size", () => {
    assert.ok(MAX_REQUEST_BODY_BYTES > 0 && MAX_REQUEST_BODY_BYTES <= 256 * 1024);
  });

  it("has a security checklist mentioning Cloudflare Access", () => {
    assert.ok(SECURITY_CHECKLIST.some((c) => c.includes("Cloudflare Access")));
  });

  it("default-denies CORS unless an allowed origin is configured and matches", () => {
    assert.deepEqual(corsHeaders({}, "https://evil.example"), {});
    assert.deepEqual(corsHeaders({ CLOUDFLARE_COCKPIT_ALLOWED_ORIGIN: "https://ok.example" }, "https://evil.example"), {});
    const ok = corsHeaders({ CLOUDFLARE_COCKPIT_ALLOWED_ORIGIN: "https://ok.example" }, "https://ok.example");
    assert.equal(ok["access-control-allow-origin"], "https://ok.example");
  });

  it("applies conservative security headers on responses", () => {
    assert.equal(SECURITY_HEADERS["x-content-type-options"], "nosniff");
    assert.equal(SECURITY_HEADERS["x-frame-options"], "DENY");
  });
});

describe("cloudflare cockpit security at the handler", () => {
  let dir: string;
  let ctx: CockpitWorkerContext;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cf-sec-")); ctx = await createCockpitWorkerContext({ cwd: dir }); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("sends security headers and no CORS by default", async () => {
    const res = await handleCockpitRequest(new Request("https://cockpit.local/health"), {}, ctx);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  it("denies OPTIONS preflight by default (no configured origin)", async () => {
    const res = await handleCockpitRequest(
      new Request("https://cockpit.local/api/state", { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
      {},
      ctx
    );
    assert.equal(res.status, 403);
  });
});
