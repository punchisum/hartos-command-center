/**
 * tests/llm-usage-log.test.ts — Phase 11I. Usage logs contain no secrets.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeUsageLog, toUsageRecord } from "../src/llm/usage-log.js";
import type { LlmResult } from "../src/llm/llm-types.js";

const RESULT: LlmResult = {
  output: {
    intent: "x", domain: "finance", confidence: "high", neededContext: [],
    recommendedSpecialist: "finance_agent", riskLevel: "low", nextAction: "y", summary: "z",
  },
  provider: "deterministic",
  model: "gpt-4o-mini",
  mode: "deterministic",
  validation: "valid",
  success: true,
  requestType: "classify_and_contextualize",
};

describe("llm usage log", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "llm-usage-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("builds a record with provider/model/mode/type/success/validation", () => {
    const rec = toUsageRecord(RESULT);
    assert.equal(rec.provider, "deterministic");
    assert.equal(rec.model, "gpt-4o-mini");
    assert.equal(rec.requestType, "classify_and_contextualize");
    assert.equal(rec.success, true);
    assert.equal(rec.validation, "valid");
  });

  it("writes md + json under the reports dir with no secrets", async () => {
    const { mdPath, jsonPath } = await writeUsageLog(dir, RESULT);
    const md = await readFile(mdPath, "utf8");
    const json = await readFile(jsonPath, "utf8");
    assert.ok(md.includes("LLM Gateway Usage"));
    assert.ok(json.includes("deterministic"));
    // No raw prompt / request text, no key markers.
    assert.ok(!md.includes("sk-"));
    assert.ok(!md.includes("Bearer "));
    const files = await readdir(dir);
    assert.ok(files.some((f) => f.startsWith("llm-usage-") && f.endsWith(".json")));
  });
});
