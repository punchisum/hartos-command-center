/**
 * tests/fitness-read-model.test.ts — Phase 11I.
 * Fitness read model summarizes mocked rows; disabled/missing degrade safely.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFitnessReadModelSummary } from "../src/read-models/fitness-read-model.js";
import { SupabaseReadClient, type FetchLike } from "../src/read-models/supabase-read-client.js";
import { resolveAvailability } from "../src/read-models/read-model-registry.js";
import type { ReadModelConfig } from "../src/read-models/read-model-types.js";

const config: ReadModelConfig = {
  id: "fitness_supabase_read",
  type: "fitness",
  enabled: true,
  mode: "supabase_readonly",
  supabaseUrlEnv: "URL",
  supabaseKeyEnv: "KEY",
  allowedTables: ["derived_latest_state", "derived_daily_state", "canonical_workouts", "canonical_health"],
  allowedRpcs: [],
  forbiddenOperations: ["insert", "update", "delete", "upsert", "rpc_mutation"],
};

function clientFor(byTable: Record<string, unknown[]>): SupabaseReadClient {
  const fetch: FetchLike = async (url) => {
    const table = Object.keys(byTable).find((t) => url.includes(`/rest/v1/${t}`)) ?? "";
    return { ok: true, status: 200, json: async () => byTable[table] ?? [] };
  };
  return new SupabaseReadClient({ url: "https://x", key: "k", allowedTables: config.allowedTables, allowedRpcs: [] }, fetch);
}

describe("fitness read model", () => {
  it("returns disabled when not enabled", async () => {
    const avail = resolveAvailability({ ...config, enabled: false }, {});
    const s = await buildFitnessReadModelSummary({ ...config, enabled: false }, avail);
    assert.equal(s.status, "disabled");
  });

  it("summarizes mocked rows when live", async () => {
    const avail = resolveAvailability(config, { URL: "https://x", KEY: "k" });
    const client = clientFor({
      derived_latest_state: [{ recovery: 72, updated_at: "2026-06-03T06:00:00Z" }],
      derived_daily_state: [{ summary: "balanced", date: "2026-06-03" }],
      canonical_workouts: [{ type: "run", date: "2026-06-02" }],
      canonical_health: [{ date: "2026-06-03" }],
    });
    const s = await buildFitnessReadModelSummary(config, avail, client);
    assert.equal(s.status, "ok");
    assert.equal(s.metrics["recovery"], "72");
    assert.equal(s.metrics["latestWorkout"], "run");
    assert.equal(s.dataFreshness, "2026-06-03T06:00:00Z");
  });
});

// ── Phase 13.6 — RPC-backed fitness read-model ──
const ALL_RPCS = [
  "get_fitness_today_state",
  "get_fitness_today_nutrition",
  "get_fitness_recent_workouts",
  "get_fitness_weekly_summary",
];
const RPC_ARGS = { userId: "u1", agentId: "a1", userIdEnv: "HARTOS_USER_ID", agentIdEnv: "HARTOS_AGENT_ID" };

interface RpcSpec { status?: number; body?: unknown }
function rpcClient(byRpc: Record<string, RpcSpec>, allowedRpcs: string[]): SupabaseReadClient {
  const fetch: FetchLike = async (url) => {
    const name = allowedRpcs.find((n) => url.includes(`/rpc/${n}`)) ?? "";
    const spec = byRpc[name];
    if (!spec) return { ok: true, status: 200, json: async () => [] };
    if (spec.status && spec.status >= 400) return { ok: false, status: spec.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => spec.body ?? [] };
  };
  return new SupabaseReadClient({ url: "https://x", key: "k", allowedTables: [], allowedRpcs }, fetch);
}

const FULL_BODIES: Record<string, RpcSpec> = {
  get_fitness_today_state: { body: [{ recovery_status: "green", hrv_ms: 58, resting_hr: 48, sleep_hours: 7.5, training_day_type: "Lower", workout_completed: false, health_updated_at: "2026-06-04T05:00:00Z" }] },
  get_fitness_today_nutrition: { body: [{ logged_active_totals: { calories_consumed: 1800, protein_g: 120 }, target: { calories: 2400, protein_g: 180 } }] },
  get_fitness_recent_workouts: { body: [{ workout_type: "Run", workout_date: "2026-06-03" }] },
  get_fitness_weekly_summary: { body: [{ total_workouts: 4, training_minutes: 320, steps: 58000, average_hrv_ms: 55 }] },
};

describe("fitness read model (RPC)", () => {
  const rpcConfig: ReadModelConfig = { ...config, allowedRpcs: ALL_RPCS };

  it("uses allowlisted RPCs and maps panel fields when live", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const s = await buildFitnessReadModelSummary(rpcConfig, avail, rpcClient(FULL_BODIES, ALL_RPCS), RPC_ARGS);
    assert.equal(s.status, "ok");
    assert.equal(s.rpcStatus, "rpc_live");
    assert.equal(s.metrics["recovery"], "green");
    assert.equal(s.metrics["healthVitals"], "HRV 58ms, RHR 48 bpm, sleep 7.5h");
    assert.equal(s.metrics["trainingPlan"], "Lower");
    assert.equal(s.metrics["trainingCompleted"], "no");
    assert.equal(s.metrics["caloriesToday"], 1800);
    assert.equal(s.metrics["caloriesTarget"], 2400);
    assert.equal(s.metrics["proteinToday"], 120);
    assert.equal(s.metrics["proteinTarget"], 180);
    assert.equal(s.metrics["latestWorkout"], "Run (2026-06-03)");
    assert.equal(s.metrics["weeklyLoad"], "4 workouts, 320 min, 58000 steps");
    assert.equal(s.dataFreshness, "2026-06-04T05:00:00Z");
  });

  it("derives nutrition target from consumed + remaining when target absent", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const bodies: Record<string, RpcSpec> = {
      get_fitness_today_nutrition: { body: [{ calories_consumed: 1800, protein_g: 120, remaining: { calories: 600, protein_g: 60 } }] },
    };
    const s = await buildFitnessReadModelSummary(rpcConfig, avail, rpcClient(bodies, ALL_RPCS), RPC_ARGS);
    assert.equal(s.metrics["caloriesTarget"], 2400);
    assert.equal(s.metrics["proteinTarget"], 180);
  });

  it("a non-allowlisted RPC fails closed at the client", async () => {
    const client = rpcClient(FULL_BODIES, ["get_fitness_today_nutrition"]);
    await assert.rejects(() => client.readRpc("get_fitness_today_state", {}), /not allowlisted/i);
  });

  it("partial config (only nutrition allowlisted) yields partial fields + degraded sources", async () => {
    const partialCfg: ReadModelConfig = { ...config, allowedRpcs: ["get_fitness_today_nutrition"] };
    const avail = resolveAvailability(partialCfg, { URL: "https://x", KEY: "k" });
    const s = await buildFitnessReadModelSummary(partialCfg, avail, rpcClient(FULL_BODIES, partialCfg.allowedRpcs), RPC_ARGS);
    assert.equal(s.status, "degraded");
    assert.equal(s.rpcStatus, "rpc_live");
    assert.equal(s.metrics["caloriesToday"], 1800);
    assert.equal(s.metrics["recovery"], undefined);
    assert.ok(s.degradedSources.includes("get_fitness_today_state"));
    assert.ok(s.degradedSources.includes("get_fitness_recent_workouts"));
  });

  it("missing RPC arg ids degrade safely with the exact env to set", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const s = await buildFitnessReadModelSummary(rpcConfig, avail, rpcClient(FULL_BODIES, ALL_RPCS), { userIdEnv: "HARTOS_USER_ID", agentIdEnv: "HARTOS_AGENT_ID" });
    assert.equal(s.status, "missing");
    assert.equal(s.rpcStatus, "rpc_missing_env");
    assert.ok(s.recommendation.includes("HARTOS_USER_ID"));
    assert.equal(Object.keys(s.metrics).length, 0);
  });

  it("missing env/client reports rpc_missing_env in RPC mode", async () => {
    const avail = resolveAvailability(rpcConfig, {});
    const s = await buildFitnessReadModelSummary(rpcConfig, avail, undefined, RPC_ARGS);
    assert.equal(s.status, "missing");
    assert.equal(s.rpcStatus, "rpc_missing_env");
  });

  it("forbidden RPCs map to rpc_forbidden and never leak the key/url", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const forbidden: Record<string, RpcSpec> = Object.fromEntries(ALL_RPCS.map((n) => [n, { status: 403 }]));
    const s = await buildFitnessReadModelSummary(rpcConfig, avail, rpcClient(forbidden, ALL_RPCS), RPC_ARGS);
    assert.equal(s.status, "error");
    assert.equal(s.rpcStatus, "rpc_forbidden");
    const blob = JSON.stringify(s);
    assert.ok(!blob.includes("https://x"));
    assert.ok(!/"k"|key|apikey|Bearer/.test(s.lines.join(" ")));
  });

  it("missing-function RPCs map to rpc_unavailable", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const notFound: Record<string, RpcSpec> = Object.fromEntries(ALL_RPCS.map((n) => [n, { status: 404 }]));
    const s = await buildFitnessReadModelSummary(rpcConfig, avail, rpcClient(notFound, ALL_RPCS), RPC_ARGS);
    assert.equal(s.status, "error");
    assert.equal(s.rpcStatus, "rpc_unavailable");
  });

  it("reachable-but-empty RPCs map to rpc_no_rows", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const empty: Record<string, RpcSpec> = Object.fromEntries(ALL_RPCS.map((n) => [n, { body: [] }]));
    const s = await buildFitnessReadModelSummary(rpcConfig, avail, rpcClient(empty, ALL_RPCS), RPC_ARGS);
    assert.equal(s.status, "missing");
    assert.equal(s.rpcStatus, "rpc_no_rows");
  });

  it("table mode is preserved when no RPCs are allowlisted", async () => {
    const avail = resolveAvailability(config, { URL: "https://x", KEY: "k" });
    const fetch: FetchLike = async (url) => ({ ok: true, status: 200, json: async () => (url.includes("canonical_workouts") ? [{ type: "run", date: "2026-06-02" }] : []) });
    const client = new SupabaseReadClient({ url: "https://x", key: "k", allowedTables: config.allowedTables, allowedRpcs: [] }, fetch);
    const s = await buildFitnessReadModelSummary(config, avail, client);
    assert.equal(s.rpcStatus, undefined);
    assert.equal(s.metrics["latestWorkout"], "run");
  });
});

