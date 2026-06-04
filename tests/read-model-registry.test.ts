/**
 * tests/read-model-registry.test.ts — Phase 11I.
 * Registry degrades safely with no config; read models are disabled by default;
 * availability resolves env presence without exposing values.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadReadModelRegistry,
  resolveAvailability,
  isReadModelLive,
  LOCAL_CONFIG_FILE,
} from "../src/read-models/read-model-registry.js";
import type { ReadModelConfig } from "../src/read-models/read-model-types.js";

const opsConfig: ReadModelConfig = {
  id: "ops_supabase_read",
  type: "ops",
  enabled: true,
  mode: "supabase_readonly",
  supabaseUrlEnv: "HARTOS_OPS_SUPABASE_URL",
  supabaseKeyEnv: "HARTOS_OPS_SUPABASE_READONLY_KEY",
  allowedTables: ["clickup_cards"],
  allowedRpcs: [],
  forbiddenOperations: ["insert", "update", "delete", "upsert", "rpc_mutation"],
};

describe("read model registry", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "read-model-registry-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("degrades to empty with no config", async () => {
    const reg = await loadReadModelRegistry(dir);
    assert.equal(reg.configPresent, false);
    assert.deepEqual(reg.readModels, []);
  });

  it("loads a local config and read models are disabled by default", async () => {
    await writeFile(
      path.join(dir, LOCAL_CONFIG_FILE),
      JSON.stringify({ readModels: [{ id: "ops_supabase_read", type: "ops", mode: "supabase_readonly", supabaseUrlEnv: "X", supabaseKeyEnv: "Y", allowedTables: ["clickup_cards"] }] }),
      "utf8"
    );
    const reg = await loadReadModelRegistry(dir);
    assert.equal(reg.readModels.length, 1);
    assert.equal(reg.readModels[0]!.enabled, false, "disabled unless explicitly enabled");
    assert.deepEqual(reg.readModels[0]!.forbiddenOperations, ["insert", "update", "delete", "upsert", "rpc_mutation"]);
  });

  it("resolves availability without exposing env values", () => {
    const avail = resolveAvailability(opsConfig, { HARTOS_OPS_SUPABASE_URL: "https://x", HARTOS_OPS_SUPABASE_READONLY_KEY: "secret-key" });
    assert.equal(avail.envPresent, true);
    assert.equal(isReadModelLive(avail), true);
    assert.equal(JSON.stringify(avail).includes("secret-key"), false);
  });

  it("reports missing env names only when env is absent", () => {
    const avail = resolveAvailability(opsConfig, {});
    assert.equal(avail.envPresent, false);
    assert.equal(isReadModelLive(avail), false);
    assert.deepEqual(avail.missingEnv.sort(), ["HARTOS_OPS_SUPABASE_READONLY_KEY", "HARTOS_OPS_SUPABASE_URL"]);
  });

  it("is not live when disabled even with env present", () => {
    const avail = resolveAvailability({ ...opsConfig, enabled: false }, { HARTOS_OPS_SUPABASE_URL: "u", HARTOS_OPS_SUPABASE_READONLY_KEY: "k" });
    assert.equal(isReadModelLive(avail), false);
  });
});
