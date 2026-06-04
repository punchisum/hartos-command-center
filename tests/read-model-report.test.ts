/**
 * tests/read-model-report.test.ts — Phase 11I.
 * Read model reports are generated safely; registry summary degrades with no
 * config and never calls the network for disabled models.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildReadModelRegistrySummary,
  renderReadModelReportMarkdown,
  writeReadModelReport,
} from "../src/read-models/read-model-report.js";
import { LOCAL_CONFIG_FILE } from "../src/read-models/read-model-registry.js";

describe("read model report", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "read-model-report-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("builds an unconfigured summary with no config", async () => {
    const summary = await buildReadModelRegistrySummary({ cwd: dir, env: {} });
    assert.equal(summary.configPresent, false);
    assert.equal(summary.configuredReadModels, 0);
    const md = renderReadModelReportMarkdown(summary);
    assert.ok(md.includes("Read Model Status"));
    assert.ok(md.includes("no insert/update/delete/upsert"));
  });

  it("never calls the network for disabled read models", async () => {
    await writeFile(
      path.join(dir, LOCAL_CONFIG_FILE),
      JSON.stringify({ readModels: [{ id: "ops_supabase_read", type: "ops", enabled: false, mode: "supabase_readonly", supabaseUrlEnv: "URL", supabaseKeyEnv: "KEY", allowedTables: ["clickup_cards"] }] }),
      "utf8"
    );
    let called = false;
    const summary = await buildReadModelRegistrySummary({
      cwd: dir,
      env: { URL: "https://x", KEY: "k" },
      clientFactory: () => {
        called = true;
        return undefined;
      },
    });
    assert.equal(called, false, "client factory must not run for disabled models");
    assert.equal(summary.summaries[0]!.status, "disabled");
  });

  it("writes md + json reports under the reports dir", async () => {
    const summary = await buildReadModelRegistrySummary({ cwd: dir, env: {} });
    const { mdPath, jsonPath } = await writeReadModelReport(path.join(dir, "read-model-reports"), summary);
    assert.ok(mdPath.endsWith(".md"));
    const files = await readdir(path.join(dir, "read-model-reports"));
    assert.ok(files.some((f) => f.startsWith("read-model-status-")));
    const json = await readFile(jsonPath, "utf8");
    assert.ok(json.includes("forbiddenOperations") || json.includes("configuredReadModels"));
  });
});
