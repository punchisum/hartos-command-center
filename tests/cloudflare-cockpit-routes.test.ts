/**
 * tests/cloudflare-cockpit-routes.test.ts — Phase 11J.
 * Every supported route responds; unknown routes 404; debug/status is safe.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleCockpitRequest, createCockpitWorkerContext, SUPPORTED_ROUTES } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";

const base = "https://cockpit.local";

describe("cloudflare cockpit routes", () => {
  let dir: string;
  let ctx: CockpitWorkerContext;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cf-routes-")); ctx = await createCockpitWorkerContext({ cwd: dir }); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("declares the expected supported routes", () => {
    assert.ok(SUPPORTED_ROUTES.includes("GET /health"));
    assert.ok(SUPPORTED_ROUTES.includes("GET /api/state"));
    assert.ok(SUPPORTED_ROUTES.includes("POST /api/orchestrator/message"));
  });

  it("serves GET /api/reports and /api/threads as arrays", async () => {
    const reports = await (await handleCockpitRequest(new Request(`${base}/api/reports`), {}, ctx)).json() as { reports: unknown[] };
    assert.ok(Array.isArray(reports.reports));
    const threads = await (await handleCockpitRequest(new Request(`${base}/api/threads`), {}, ctx)).json() as { threads: unknown[] };
    assert.ok(Array.isArray(threads.threads));
  });

  it("debug/status lists routes, disabled action execution, no mutation endpoints", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/debug/status`), {}, ctx);
    const data = await res.json() as { routes: string[]; actionExecution: string; mutationEndpoints: string };
    assert.ok(data.routes.includes("GET /health"));
    assert.equal(data.actionExecution, "disabled");
    assert.equal(data.mutationEndpoints, "none");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/unknown`), {}, ctx);
    assert.equal(res.status, 404);
  });
});
