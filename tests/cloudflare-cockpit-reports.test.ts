/**
 * tests/cloudflare-cockpit-reports.test.ts — Phase 11J.
 * Reports are written under cloudflare-cockpit-reports/, contain no secrets, and
 * include the safe metadata (routes, gate status, security checklist).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDeployPlan, writeCloudflareCockpitReport } from "../src/runtime/cloudflare-deploy-bridge.js";

describe("cloudflare cockpit reports", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cf-reports-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("writes md + json with safe metadata and no secrets", async () => {
    // Even if a secret-like value is in env, the report only records PRESENCE.
    const env = { CLOUDFLARE_API_TOKEN: "tok-abc-not-leaked", ALLOW_AUTO_PROVISION: "false" };
    const plan = buildDeployPlan(env, "deploy-plan");
    const { mdPath, jsonPath } = await writeCloudflareCockpitReport(dir, plan);
    const md = await readFile(mdPath, "utf8");
    const json = await readFile(jsonPath, "utf8");
    assert.ok(md.includes("Cloudflare Hosted Cockpit"));
    assert.ok(md.includes("blocked_missing_gate"));
    assert.ok(md.includes("Cloudflare Access"));
    assert.ok(!md.includes("tok-abc-not-leaked"), "report must not contain env values");
    assert.ok(!json.includes("tok-abc-not-leaked"));
    const files = await readdir(dir);
    assert.ok(files.some((f) => f.startsWith("cloudflare-cockpit-deploy-plan-")));
  });

  it("refuses to write a report containing secret-looking content", async () => {
    const plan = buildDeployPlan({}, "check");
    // Inject a token-like string into a rendered field to prove the guard fires.
    (plan.notes as string[]).push("leak sk-" + "a".repeat(40));
    await assert.rejects(() => writeCloudflareCockpitReport(dir, plan));
  });
});
