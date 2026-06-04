/**
 * tests/cloudflare-live-read-models.test.ts — Phase 16D.
 *
 * The Hosted Live Read-Model Runtime resolves Fitness + Ops read-models live at
 * Worker request time, fs-free, with graceful per-domain degradation. These
 * tests inject a fetch-stubbed client factory — NO real network call occurs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveHostedCockpitState,
  hostedReadModelsConfigured,
  buildHostedReadModelRegistry,
  HOSTED_READ_MODEL_ENV,
  OPS_ALLOWED_RPCS,
  FITNESS_ALLOWED_RPCS,
} from "../src/runtime/cloudflare-live-read-models.js";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";
import { SupabaseReadClient, type FetchLike } from "../src/read-models/supabase-read-client.js";
import type { ClientFactory } from "../src/read-models/read-model-report.js";
import type { ReadModelConfig } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-04T10:00:00Z";
const ANON_KEY = "anon-readonly-key-DO-NOT-LEAK";

const OPS_BODIES: Record<string, unknown> = {
  get_ops_overview: {
    active_card_count: 12, blocked_card_count: 2, waiting_card_count: 3, urgent_card_count: 1,
    stale_card_count: 4, no_next_action_count: 5, latest_update_at: "2026-06-04T09:00:00Z",
    data_freshness: "2026-06-04T09:00:00Z", stale_threshold_days: 14, source: "ops-agent-v2:supabase",
    data_quality_flags: ["priority_derived_from_status_and_risk"],
  },
  get_ops_attention_cards: [
    { card_id: "CU-1", title: "Urgent supplier issue", status: "URGENT", reason_flag: "urgent", reason_flags: ["urgent"], source: "ops-agent-v2:supabase" },
  ],
  get_ops_recent_updates: [
    { update_id: "u1", card_id: "CU-9", card_title: "Logistics", update_text: "Driver confirmed.", update_summary: "Driver confirmed.", updated_by: "Kelson", updated_at: "2026-06-03T08:30:00Z", source: "ops-agent-v2:supabase" },
  ],
  get_ops_status_counts: { by_status: { ACTIVE: 7, BLOCKED: 2, WAITING: 3 }, by_project: { GECAN: 12 }, by_owner: { Francis: 4 }, total: 12, source: "ops-agent-v2:supabase", updated_at: "2026-06-04T09:00:00Z" },
  get_ops_risk_flags: [
    { flag: "blocked_cards", severity: "high", card_count: 2, sample_card_ids: ["CU-1"], derived: true, source: "ops-agent-v2:supabase" },
  ],
};

const FITNESS_BODIES: Record<string, unknown> = {
  get_fitness_today_state: [{ recovery_status: "green", hrv_ms: 58, resting_hr: 48, sleep_hours: 7.5, training_day_type: "Lower", workout_completed: false, health_updated_at: "2026-06-04T05:00:00Z" }],
  get_fitness_today_nutrition: [{ logged_active_totals: { calories_consumed: 1800, protein_g: 120 }, target: { calories: 2400, protein_g: 180 } }],
  get_fitness_recent_workouts: [{ workout_type: "Run", workout_date: "2026-06-03" }],
  get_fitness_weekly_summary: [{ total_workouts: 4, training_minutes: 320, steps: 58000, average_hrv_ms: 55 }],
};

/** A client factory that dispatches RPCs to canned bodies — never hits network. */
function stubClientFactory(): ClientFactory {
  return (config: ReadModelConfig) => {
    const bodies = config.type === "ops" ? OPS_BODIES : FITNESS_BODIES;
    const fetch: FetchLike = async (url) => {
      const name = config.allowedRpcs.find((n) => url.includes(`/rpc/${n}`)) ?? "";
      return { ok: true, status: 200, json: async () => bodies[name] ?? [] };
    };
    return new SupabaseReadClient(
      { url: "https://stub", key: config.supabaseKeyEnv, allowedTables: [], allowedRpcs: config.allowedRpcs },
      fetch
    );
  };
}

function fullEnv(): Record<string, string> {
  return {
    [HOSTED_READ_MODEL_ENV.opsUrl]: "https://ops.example.supabase.co",
    [HOSTED_READ_MODEL_ENV.opsKey]: ANON_KEY,
    [HOSTED_READ_MODEL_ENV.fitnessUrl]: "https://fit.example.supabase.co",
    [HOSTED_READ_MODEL_ENV.fitnessKey]: ANON_KEY,
    [HOSTED_READ_MODEL_ENV.fitnessUserId]: "00000000-0000-0000-0000-000000000001",
    [HOSTED_READ_MODEL_ENV.fitnessAgentId]: "00000000-0000-0000-0000-000000000002",
  };
}

describe("hosted live read-models — registry + config gate", () => {
  it("declines (null) when no read-model env is configured", async () => {
    assert.equal(hostedReadModelsConfigured({}), false);
    const state = await resolveHostedCockpitState({}, { now: NOW });
    assert.equal(state, null);
  });

  it("considers a single configured domain as configured", () => {
    assert.equal(
      hostedReadModelsConfigured({ [HOSTED_READ_MODEL_ENV.opsUrl]: "u", [HOSTED_READ_MODEL_ENV.opsKey]: "k" }),
      true
    );
  });

  it("registry uses the real deployed RPC names and never tables", () => {
    const reg = buildHostedReadModelRegistry();
    const ops = reg.readModels.find((r) => r.type === "ops")!;
    const fit = reg.readModels.find((r) => r.type === "fitness")!;
    assert.deepEqual(ops.allowedRpcs, OPS_ALLOWED_RPCS);
    assert.deepEqual(fit.allowedRpcs, FITNESS_ALLOWED_RPCS);
    assert.deepEqual(ops.allowedTables, []);
    assert.deepEqual(fit.allowedTables, []);
  });
});

describe("hosted live read-models — live resolution", () => {
  it("resolves a live hosted state with both panels", async () => {
    const state = await resolveHostedCockpitState(fullEnv(), { now: NOW, clientFactory: stubClientFactory() });
    assert.ok(state, "state should not be null");
    assert.equal(state!.mode, "hosted");
    assert.equal(state!.generatedAt, NOW);
    assert.equal(state!.panels?.length, 3);

    const ops = state!.readModels?.summaries.find((s) => s.type === "ops");
    const fit = state!.readModels?.summaries.find((s) => s.type === "fitness");
    assert.equal(ops?.status, "ok");
    assert.equal(fit?.status, "ok");
    assert.equal(ops?.metrics["activeCards"], 12);
    assert.ok(state!.sourceDiagnostics, "diagnostics present");
  });

  it("NEVER leaks the read-only key into the serialized state", async () => {
    const state = await resolveHostedCockpitState(fullEnv(), { now: NOW, clientFactory: stubClientFactory() });
    const json = JSON.stringify(state);
    assert.equal(json.includes(ANON_KEY), false, "key value must not appear anywhere in the state");
  });

  it("degrades one domain independently — ops live, fitness unconfigured", async () => {
    const env = {
      [HOSTED_READ_MODEL_ENV.opsUrl]: "https://ops.example.supabase.co",
      [HOSTED_READ_MODEL_ENV.opsKey]: ANON_KEY,
      // fitness env intentionally absent
    };
    const state = await resolveHostedCockpitState(env, { now: NOW, clientFactory: stubClientFactory() });
    assert.ok(state);
    const ops = state!.readModels?.summaries.find((s) => s.type === "ops");
    const fit = state!.readModels?.summaries.find((s) => s.type === "fitness");
    assert.equal(ops?.status, "ok");
    assert.equal(fit?.status, "missing");
    assert.equal(state!.panels?.length, 3); // all panels still render
  });

  it("rejects a service-role key via the default factory (no network, domain not live)", async () => {
    const env = {
      [HOSTED_READ_MODEL_ENV.opsUrl]: "https://ops.example.supabase.co",
      [HOSTED_READ_MODEL_ENV.opsKey]: "service_role_secret_key", // triggers the guard, no client built
    };
    // No clientFactory → uses the real defaultClientFactory, which refuses
    // service-role keys (returns undefined) so no SupabaseReadClient and no fetch.
    const state = await resolveHostedCockpitState(env, { now: NOW });
    assert.ok(state);
    const ops = state!.readModels?.summaries.find((s) => s.type === "ops");
    assert.notEqual(ops?.status, "ok");
    assert.equal(JSON.stringify(state).includes("service_role_secret_key"), false);
  });
});

describe("hosted live read-models — worker wiring (lazy, post-auth, data-routes only)", () => {
  const env = {}; // open auth (no token, not production)

  function providerSpy(state: unknown) {
    let calls = 0;
    const provider = async () => {
      calls += 1;
      return state as undefined;
    };
    return { provider, calls: () => calls };
  }

  it("does NOT call the live provider for /health", async () => {
    const spy = providerSpy({ generatedAt: NOW });
    const res = await handleCockpitRequest(
      new Request("https://c/health"),
      env,
      { runtimeMode: "hosted", liveStateProvider: spy.provider }
    );
    assert.equal(res.status, 200);
    assert.equal(spy.calls(), 0);
  });

  it("calls the live provider once for /api/state and serves the live state", async () => {
    const liveState = await resolveHostedCockpitState(fullEnv(), { now: NOW, clientFactory: stubClientFactory() });
    const spy = providerSpy(liveState ?? undefined);
    const res = await handleCockpitRequest(
      new Request("https://c/api/state"),
      env,
      { runtimeMode: "hosted", liveStateProvider: spy.provider }
    );
    assert.equal(res.status, 200);
    assert.equal(spy.calls(), 1);
    const body = (await res.json()) as { mode?: string };
    assert.equal(body.mode, "hosted");
  });

  it("does NOT call the live provider for an unauthenticated request", async () => {
    const spy = providerSpy({ generatedAt: NOW });
    const prodEnv = { APP_ENV: "production", HARTOS_COCKPIT_ACCESS_TOKEN: "secret-token" };
    const res = await handleCockpitRequest(
      new Request("https://c/api/state"),
      prodEnv,
      { runtimeMode: "hosted", liveStateProvider: spy.provider }
    );
    assert.equal(res.status, 401);
    assert.equal(spy.calls(), 0);
  });
});
