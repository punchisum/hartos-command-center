/**
 * tests/cockpit-source-diagnostics.test.ts
 *
 * Phase 13.5A — read-model source diagnostics. Covers configured/enabled/
 * disabled/missing/stale states + service-role rejection, with no secrets.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSourceDiagnostics, type ResolvedSources, type SourceResult } from "../src/cockpit/sources/index.js";

const NOW = "2026-06-04T12:00:00.000Z";

function emptySource(name: string, freshness: SourceResult["freshness"] = "unknown", fields = 0): SourceResult {
  const values: SourceResult["values"] = {};
  for (let i = 0; i < fields; i += 1) values[`f${i}`] = { value: "x", source: "s", sourceType: "supabase_readonly", lastUpdated: NOW, freshness, confidence: "high" };
  return { name, sourceType: fields > 0 ? "supabase_readonly" : "none", status: fields > 0 ? "available" : "unavailable", lastUpdated: fields > 0 ? NOW : null, freshness, confidence: "low", missingReason: null, setupStep: null, diagnostics: { checked: [], notes: [] }, values };
}

function sources(over: Partial<ResolvedSources> = {}): ResolvedSources {
  return { fitness: emptySource("fitness"), ops: emptySource("ops"), factory: emptySource("factory"), ...over };
}

function jwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ role })}.sig`;
}

async function writeConfig(dir: string, entries: object[]): Promise<void> {
  await writeFile(path.join(dir, "read-models.local.json"), JSON.stringify({ readModels: entries }), "utf8");
}

const fitnessCfg = { id: "fitness", type: "fitness", enabled: true, mode: "supabase_readonly", supabaseUrlEnv: "FU", supabaseKeyEnv: "FK", allowedTables: ["derived_latest_state"], allowedRpcs: [], forbiddenOperations: [] };

describe("source diagnostics", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "diag-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("no config → not_configured + setup steps, no secrets", async () => {
    const d = await buildSourceDiagnostics({ cwd: dir, now: NOW, sources: sources(), env: {} });
    assert.equal(d.configPresent, false);
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.status, "not_configured");
    assert.ok(fitness.setupStep);
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\./.test(JSON.stringify(d)));
  });

  it("configured + disabled → disabled", async () => {
    await writeConfig(dir, [{ ...fitnessCfg, enabled: false }]);
    const d = await buildSourceDiagnostics({ cwd: dir, now: NOW, sources: sources(), env: { FU: "https://x", FK: jwt("anon") } });
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.status, "disabled");
    assert.ok(d.disabledSources.includes("fitness"));
  });

  it("enabled + missing env → missing_env", async () => {
    await writeConfig(dir, [fitnessCfg]);
    const d = await buildSourceDiagnostics({ cwd: dir, now: NOW, sources: sources(), env: {} });
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.status, "missing_env");
    assert.ok(d.missingSources.includes("fitness"));
  });

  it("service-role key → rejected_unsafe (no secret leaked)", async () => {
    await writeConfig(dir, [fitnessCfg]);
    const d = await buildSourceDiagnostics({ cwd: dir, now: NOW, sources: sources(), env: { FU: "https://x", FK: jwt("service_role") } });
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.status, "rejected_unsafe");
    assert.ok(d.rejectedSources.includes("fitness"));
    assert.ok(!JSON.stringify(d).includes(jwt("service_role")), "must not echo the key");
  });

  it("enabled + env present + live fresh data → live", async () => {
    await writeConfig(dir, [fitnessCfg]);
    const d = await buildSourceDiagnostics({ cwd: dir, now: NOW, sources: sources({ fitness: emptySource("fitness", "fresh", 3) }), env: { FU: "https://x", FK: jwt("anon") } });
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.status, "live");
    assert.ok(d.enabledSources.includes("fitness"));
  });

  it("enabled + stale data → stale, shown as stale", async () => {
    await writeConfig(dir, [fitnessCfg]);
    const d = await buildSourceDiagnostics({ cwd: dir, now: NOW, sources: sources({ fitness: emptySource("fitness", "stale", 2) }), env: { FU: "https://x", FK: jwt("anon") } });
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.status, "stale");
    assert.ok(d.staleSources.includes("fitness"));
  });

  // ── Phase 13.6 — RPC-backed fitness overlay ──
  const RPCS = ["get_fitness_today_state", "get_fitness_today_nutrition", "get_fitness_recent_workouts", "get_fitness_weekly_summary"];
  const rpcCfg = { ...fitnessCfg, allowedRpcs: RPCS };
  function fitnessSummary(rpcStatus: string, recommendation: string): any {
    return { id: "fitness", type: "fitness", status: rpcStatus === "rpc_live" ? "ok" : "missing", confidence: "low", lines: [], metrics: {}, recommendation, dataFreshness: null, degradedSources: [], rpcStatus };
  }

  it("RPC-backed + no rows → transport=rpc, rpc_no_rows, precise setup step", async () => {
    await writeConfig(dir, [rpcCfg]);
    const d = await buildSourceDiagnostics({
      cwd: dir, now: NOW, sources: sources(), env: { FU: "https://x", FK: jwt("anon") },
      readModelSummaries: [fitnessSummary("rpc_no_rows", "RPCs are reachable but returned no rows — confirm the configured fitness user/agent id has data.")],
    });
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.transport, "rpc");
    assert.equal(fitness.rpcStatus, "rpc_no_rows");
    assert.equal(fitness.status, "unavailable");
    assert.ok(fitness.setupStep && fitness.setupStep.includes("no rows"));
    assert.ok(!JSON.stringify(d).includes("eyJ"));
  });

  it("RPC-backed + live data → live, rpc_live", async () => {
    await writeConfig(dir, [rpcCfg]);
    const d = await buildSourceDiagnostics({
      cwd: dir, now: NOW, sources: sources({ fitness: emptySource("fitness", "fresh", 4) }), env: { FU: "https://x", FK: jwt("anon") },
      readModelSummaries: [fitnessSummary("rpc_live", "Read-only; review in the cockpit.")],
    });
    const fitness = d.domains.find((x) => x.domain === "fitness")!;
    assert.equal(fitness.transport, "rpc");
    assert.equal(fitness.rpcStatus, "rpc_live");
    assert.equal(fitness.status, "live");
    assert.equal(fitness.setupStep, null);
  });
});
