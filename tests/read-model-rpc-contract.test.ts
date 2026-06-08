/**
 * tests/read-model-rpc-contract.test.ts — Phase 1.3 (cockpit-side RPC hardening).
 *
 * Locks the contract that the live agent RPCs must satisfy for the cockpit to produce
 * an OFFICIABLE (tone-legible) verdict — end to end: documented RPC shape → read-model
 * extraction → AgentSignal → agent-contract.assertOfficiable. If the RPC shape drifts
 * (e.g. the fitness today_state stops returning recovery_status — the original cause of
 * the "UNKNOWN on fresh data" bug), these assertions fail loudly in CI instead of the
 * cockpit silently going idle, and the read-model marks the read degraded with the
 * reason. Pure + read-only — mocked clients, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFitnessReadModelSummary } from "../src/read-models/fitness-read-model.js";
import { buildOpsReadModelSummary } from "../src/read-models/ops-read-model.js";
import { resolveAvailability } from "../src/read-models/read-model-registry.js";
import { SupabaseReadClient, type FetchLike } from "../src/read-models/supabase-read-client.js";
import { assertOfficiable, FITNESS_CONTRACT, OPS_CONTRACT } from "../src/agents/agent-contract.js";
import type { ReadModelConfig } from "../src/read-models/read-model-types.js";

const now = new Date("2026-06-08T08:00:00Z");
const base: Omit<ReadModelConfig, "type" | "allowedRpcs"> = {
  id: "rm", enabled: true, mode: "supabase_readonly",
  supabaseUrlEnv: "URL", supabaseKeyEnv: "KEY", allowedTables: [],
  forbiddenOperations: ["insert", "update", "delete", "upsert", "rpc_mutation"],
};
const RPC_ARGS = { userId: "u1", agentId: "a1", userIdEnv: "HARTOS_USER_ID", agentIdEnv: "HARTOS_AGENT_ID" };

function rpcClient(byRpc: Record<string, unknown>, allowedRpcs: string[]): SupabaseReadClient {
  const fetch: FetchLike = async (url) => {
    const name = allowedRpcs.find((n) => url.includes(`/rpc/${n}`)) ?? "";
    return { ok: true, status: 200, json: async () => byRpc[name] ?? [] };
  };
  return new SupabaseReadClient({ url: "https://x", key: "k", allowedTables: [], allowedRpcs }, fetch);
}

const FITNESS_RPCS = ["get_fitness_today_state", "get_fitness_today_nutrition", "get_fitness_recent_workouts", "get_fitness_weekly_summary"];
const fitCfg: ReadModelConfig = { ...base, type: "fitness", allowedRpcs: FITNESS_RPCS };

async function fitnessSummary(todayState: Record<string, unknown>) {
  const avail = resolveAvailability(fitCfg, { URL: "https://x", KEY: "k" });
  const bodies = {
    get_fitness_today_state: [todayState],
    get_fitness_today_nutrition: [{ calories_consumed: 1800, protein_g: 120, target: { calories: 2400, protein_g: 180 } }],
    get_fitness_recent_workouts: [{ workout_type: "Run", workout_date: "2026-06-07" }],
    get_fitness_weekly_summary: [{ total_workouts: 4, training_minutes: 320, steps: 58000 }],
  };
  return buildFitnessReadModelSummary(fitCfg, avail, rpcClient(bodies, FITNESS_RPCS), RPC_ARGS);
}

describe("RPC contract — fitness today_state → officiable recovery verdict", () => {
  it("recovery_status label (green) bands to an officiable verdict", async () => {
    const s = await fitnessSummary({ recovery_status: "green", hrv_ms: 58, resting_hr: 48, sleep_hours: 7.5, health_updated_at: "2026-06-08T05:00:00Z" });
    assert.equal(s.metrics["recovery"], "green");
    assert.deepEqual(assertOfficiable(FITNESS_CONTRACT, s, { now }), []);
  });

  it("numeric recovery_score (no label) still bands to an officiable verdict", async () => {
    const s = await fitnessSummary({ recovery_score: 66, hrv_ms: 58, resting_hr: 48, sleep_hours: 7.5, health_updated_at: "2026-06-08T05:00:00Z" });
    assert.equal(s.metrics["recovery"], "66"); // numeric field stringified by the read-model
    assert.deepEqual(assertOfficiable(FITNESS_CONTRACT, s, { now }), []); // 66 → amber
  });

  it("SHAPE DRIFT: today_state with no recovery key fails loudly (degraded + not officiable)", async () => {
    const s = await fitnessSummary({ hrv_ms: 58, resting_hr: 48, sleep_hours: 7.5, health_updated_at: "2026-06-08T05:00:00Z" });
    assert.equal(s.metrics["recovery"], undefined);
    assert.ok(
      s.degradedSources.some((d) => d.includes("recovery")),
      "read-model must mark the recovery shape drift, not blank silently",
    );
    const violations = assertOfficiable(FITNESS_CONTRACT, s, { now });
    assert.ok(violations.some((v) => v.facet === "signal"), "a recovery-less read must not be officiable");
  });
});

describe("RPC contract — ops overview → officiable triage verdict", () => {
  it("get_ops_overview counts produce an officiable (urgent) verdict", async () => {
    const opsRpcs = ["get_ops_overview", "get_ops_attention_cards", "get_ops_recent_updates", "get_ops_status_counts", "get_ops_risk_flags"];
    const opsCfg: ReadModelConfig = { ...base, type: "ops", allowedRpcs: opsRpcs };
    const avail = resolveAvailability(opsCfg, { URL: "https://x", KEY: "k" });
    const bodies = {
      get_ops_overview: { active_card_count: 8, urgent_card_count: 2, blocked_card_count: 0, waiting_card_count: 1, stale_card_count: 0, no_next_action_count: 0, data_freshness: "2026-06-08T06:00:00Z" },
    };
    const s = await buildOpsReadModelSummary(opsCfg, avail, rpcClient(bodies, opsRpcs));
    assert.equal(s.metrics["urgentCards"], 2);
    assert.deepEqual(assertOfficiable(OPS_CONTRACT, s, { now }), []);
  });
});
