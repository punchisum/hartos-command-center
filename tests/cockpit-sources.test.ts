/**
 * tests/cockpit-sources.test.ts
 *
 * Phase 13 — read-only source contracts + freshness model. Covers: freshness
 * verdicts, stale-shown-as-stale, partial data, service-role rejection, and the
 * absence of secret values in diagnostics.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  computeFreshness,
  confidenceFor,
  isServiceRoleKey,
  supabaseSourceResult,
  deriveFitnessSource,
  deriveOpsSource,
  resolveFitnessSource,
  resolveFactorySource,
} from "../src/cockpit/sources/index.js";
import { defaultClientFactoryForTest } from "../src/read-models/read-model-report.js";
import type { ReadModelConfig, ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-04T12:00:00.000Z";

function fitnessRm(metrics: Record<string, string | number>, dataFreshness: string | null): ReadModelSummary {
  return { id: "fitness", type: "fitness", status: "ok", confidence: "high", lines: [], metrics, recommendation: "r", dataFreshness, degradedSources: [] };
}

describe("freshness model", () => {
  it("fresh within window, stale beyond, unknown without timestamp", () => {
    assert.equal(computeFreshness("2026-06-04T06:00:00.000Z", NOW), "fresh");
    assert.equal(computeFreshness("2026-05-01T00:00:00.000Z", NOW), "stale");
    assert.equal(computeFreshness(null, NOW), "unknown");
    assert.equal(computeFreshness("not-a-date", NOW), "unknown");
  });
  it("confidence reflects source + freshness", () => {
    assert.equal(confidenceFor("supabase_readonly", "fresh"), "high");
    assert.equal(confidenceFor("supabase_readonly", "stale"), "medium");
    assert.equal(confidenceFor("handover", "fresh"), "low");
  });
});

describe("service-role key rejection", () => {
  function jwt(payload: object): string {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
  }
  it("flags service_role JWTs and markers, not anon keys", () => {
    assert.equal(isServiceRoleKey(jwt({ role: "service_role" })), true);
    assert.equal(isServiceRoleKey("a_service_role_secret"), true);
    assert.equal(isServiceRoleKey(jwt({ role: "anon" })), false);
    assert.equal(isServiceRoleKey(undefined), false);
  });
  it("read-model client factory refuses a service-role key", () => {
    const config: ReadModelConfig = { id: "ops", type: "ops", enabled: true, mode: "supabase_readonly", supabaseUrlEnv: "U", supabaseKeyEnv: "K", allowedTables: ["clickup_cards"], allowedRpcs: [], forbiddenOperations: [] };
    const svc = jwt({ role: "service_role" });
    const anon = jwt({ role: "anon" });
    assert.equal(defaultClientFactoryForTest(config, { U: "https://x", K: svc }), undefined, "service_role must be rejected");
    assert.notEqual(defaultClientFactoryForTest(config, { U: "https://x", K: anon }), undefined, "anon must be accepted");
  });
});

describe("fitness source (derived, no I/O)", () => {
  it("resolves recovery/calories with freshness; stale shown stale", () => {
    const src = deriveFitnessSource(fitnessRm({ recovery: "66", caloriesToday: "1800", caloriesTarget: "2200", latestWorkout: "run" }, "2026-05-01T00:00:00.000Z"), NOW);
    assert.equal(src.values["recovery"]!.value, "66");
    assert.equal(src.values["calories"]!.value, "1800 / 2200");
    assert.equal(src.values["calories_remaining"]!.value, "400 kcal remaining");
    assert.equal(src.values["recovery"]!.freshness, "stale");
    assert.equal(src.freshness, "stale");
    assert.equal(src.status, "partial");
  });
  it("unavailable with no read-model → setup step, no fabrication", () => {
    const src = deriveFitnessSource(undefined, NOW);
    assert.equal(src.status, "unavailable");
    assert.equal(Object.keys(src.values).length, 0);
    assert.ok(src.setupStep && src.setupStep.length > 0);
    assert.ok(src.missingReason);
  });
});

describe("ops source (derived)", () => {
  it("resolves urgent/blocked counts", () => {
    const rm: ReadModelSummary = { id: "ops", type: "ops", status: "ok", confidence: "high", lines: ["Active cards: 12.", "Latest sync: ok at 2026-06-04."], metrics: { activeCards: "12", urgentCards: "3", blockedCards: "1" }, recommendation: "r", dataFreshness: "2026-06-04T11:00:00.000Z", degradedSources: [] };
    const src = deriveOpsSource(rm, NOW);
    assert.equal(src.values["urgent"]!.value, "3");
    assert.equal(src.values["blocked"]!.value, "1");
    assert.equal(src.values["urgent"]!.freshness, "fresh");
  });
});

describe("supabase source contract", () => {
  it("maps a summary into a SourceResult and never emits secrets", () => {
    const src = supabaseSourceResult("fitness", fitnessRm({ recovery: "70" }, "2026-06-04T11:00:00.000Z"), NOW);
    assert.equal(src.sourceType, "supabase_readonly");
    assert.equal(src.status, "available");
    const blob = JSON.stringify(src);
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(blob));
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(blob));
  });
});

describe("local report enrichment (I/O)", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cockpit-src-"));
    await mkdir(path.join(dir, "fitness-reports"), { recursive: true });
    await writeFile(path.join(dir, "fitness-reports", "fitness-brief.md"), "# Brief\n- recovery: 72\n- weekly load: 45km\n", "utf8");
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads recovery from a local report when no read-model exists (partial)", async () => {
    const src = await resolveFitnessSource({ cwd: dir, now: new Date().toISOString(), agentConfig: { id: "f", name: "F", type: "fitness", enabled: true, reportsPath: "fitness-reports" } });
    assert.equal(src.values["recovery"]!.value, "72");
    assert.equal(src.values["recovery"]!.sourceType, "local_report");
    assert.equal(src.values["recovery"]!.freshness, "fresh");
    assert.equal(src.status, "partial");
  });

  it("factory source degrades safely with no reports", async () => {
    const src = await resolveFactorySource({ cwd: dir, now: NOW });
    assert.equal(src.status, "unavailable");
    assert.ok(src.setupStep);
  });
});
