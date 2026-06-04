/**
 * tests/ops-read-model.test.ts — Phase 11I.
 * Ops read model summarizes mocked rows; disabled/missing degrade safely.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOpsReadModelSummary } from "../src/read-models/ops-read-model.js";
import { SupabaseReadClient, type FetchLike } from "../src/read-models/supabase-read-client.js";
import { resolveAvailability } from "../src/read-models/read-model-registry.js";
import type { ReadModelConfig } from "../src/read-models/read-model-types.js";

const config: ReadModelConfig = {
  id: "ops_supabase_read",
  type: "ops",
  enabled: true,
  mode: "supabase_readonly",
  supabaseUrlEnv: "URL",
  supabaseKeyEnv: "KEY",
  allowedTables: ["clickup_cards", "sync_runs", "agent_logs"],
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

describe("ops read model", () => {
  it("returns disabled when not enabled", async () => {
    const avail = resolveAvailability({ ...config, enabled: false }, {});
    const s = await buildOpsReadModelSummary({ ...config, enabled: false }, avail);
    assert.equal(s.status, "disabled");
  });

  it("returns missing when enabled but no env/client", async () => {
    const avail = resolveAvailability(config, {});
    const s = await buildOpsReadModelSummary(config, avail);
    assert.equal(s.status, "missing");
  });

  it("summarizes mocked rows when live", async () => {
    const avail = resolveAvailability(config, { URL: "https://x", KEY: "k" });
    const client = clientFor({
      clickup_cards: [{ status: "open" }, { status: "open" }, { status: "done" }],
      sync_runs: [{ status: "success", created_at: "2026-06-03T10:00:00Z" }],
      agent_logs: [{ severity: "warn" }],
    });
    const s = await buildOpsReadModelSummary(config, avail, client);
    assert.equal(s.status, "ok");
    assert.equal(s.metrics["activeCards"], 3);
    assert.ok(s.lines.some((l) => l.includes("open:2")));
    assert.equal(s.dataFreshness, "2026-06-03T10:00:00Z");
  });
});

// ── Ops Read-Model Surface Upgrade — RPC-backed ops read-model ──
const OPS_ALL_RPCS = [
  "get_ops_overview",
  "get_ops_attention_cards",
  "get_ops_recent_updates",
  "get_ops_status_counts",
  "get_ops_risk_flags",
];

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

const OPS_FULL_BODIES: Record<string, RpcSpec> = {
  get_ops_overview: {
    body: {
      active_card_count: 12,
      blocked_card_count: 2,
      waiting_card_count: 3,
      urgent_card_count: 1,
      stale_card_count: 4,
      no_next_action_count: 5,
      latest_update_at: "2026-06-04T09:00:00Z",
      data_freshness: "2026-06-04T09:00:00Z",
      stale_threshold_days: 14,
      source: "ops-agent-v2:supabase",
      data_quality_flags: ["priority_derived_from_status_and_risk"],
    },
  },
  get_ops_attention_cards: {
    body: [
      { card_id: "CU-1", title: "Urgent supplier issue", status: "URGENT", reason_flag: "urgent", reason_flags: ["urgent"], source: "ops-agent-v2:supabase" },
      { card_id: "CU-2", title: "Blocked contract", status: "BLOCKED", reason_flag: "blocked", reason_flags: ["blocked", "stale"], source: "ops-agent-v2:supabase" },
    ],
  },
  get_ops_recent_updates: {
    body: [
      { update_id: "u1", card_id: "CU-9", card_title: "Logistics", update_text: "Driver confirmed.", update_summary: "Driver confirmed.", updated_by: "Kelson", updated_at: "2026-06-03T08:30:00Z", source: "ops-agent-v2:supabase" },
    ],
  },
  get_ops_status_counts: {
    body: { by_status: { ACTIVE: 7, BLOCKED: 2, WAITING: 3 }, by_project: { GECAN: 12 }, by_owner: { Francis: 4 }, total: 12, source: "ops-agent-v2:supabase", updated_at: "2026-06-04T09:00:00Z" },
  },
  get_ops_risk_flags: {
    body: [
      { flag: "blocked_cards", severity: "high", card_count: 2, sample_card_ids: ["CU-2"], derived: true, source: "ops-agent-v2:supabase" },
      { flag: "stale_cards", severity: "medium", card_count: 4, sample_card_ids: ["CU-2"], derived: true, source: "ops-agent-v2:supabase" },
    ],
  },
};

describe("ops read model (RPC)", () => {
  const rpcConfig: ReadModelConfig = { ...config, allowedRpcs: OPS_ALL_RPCS };

  it("uses allowlisted RPCs and maps operator-level metrics when live", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const s = await buildOpsReadModelSummary(rpcConfig, avail, rpcClient(OPS_FULL_BODIES, OPS_ALL_RPCS));
    assert.equal(s.status, "ok");
    assert.equal(s.rpcStatus, "rpc_live");
    assert.equal(s.metrics["activeCards"], 12);
    assert.equal(s.metrics["blockedCards"], 2);
    assert.equal(s.metrics["waitingCards"], 3);
    assert.equal(s.metrics["urgentCards"], 1);
    assert.equal(s.metrics["staleCards"], 4);
    assert.equal(s.metrics["noNextActionCards"], 5);
    assert.equal(s.metrics["attentionCards"], 2);
    assert.equal(s.metrics["recentUpdateCount"], 1);
    assert.ok(String(s.metrics["latestUpdate"]).includes("Logistics"));
    assert.ok(String(s.metrics["statusCounts"]).includes("BLOCKED:2"));
    assert.ok(String(s.metrics["riskFlags"]).includes("blocked_cards:2 (high)"));
    assert.equal(s.dataFreshness, "2026-06-04T09:00:00Z");
  });

  it("a non-allowlisted RPC fails closed at the client", async () => {
    const client = rpcClient(OPS_FULL_BODIES, ["get_ops_overview"]);
    await assert.rejects(() => client.readRpc("get_ops_attention_cards", {}), /not allowlisted/i);
  });

  it("partial config (only overview allowlisted) yields data + degraded sources", async () => {
    const partialCfg: ReadModelConfig = { ...config, allowedRpcs: ["get_ops_overview"] };
    const avail = resolveAvailability(partialCfg, { URL: "https://x", KEY: "k" });
    const s = await buildOpsReadModelSummary(partialCfg, avail, rpcClient(OPS_FULL_BODIES, partialCfg.allowedRpcs));
    assert.equal(s.status, "degraded");
    assert.equal(s.rpcStatus, "rpc_live");
    assert.equal(s.metrics["activeCards"], 12);
    assert.ok(s.degradedSources.includes("get_ops_attention_cards"));
    assert.ok(s.degradedSources.includes("get_ops_risk_flags"));
  });

  it("forbidden RPCs map to rpc_forbidden and never leak the key/url", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const forbidden: Record<string, RpcSpec> = Object.fromEntries(OPS_ALL_RPCS.map((n) => [n, { status: 403 }]));
    const s = await buildOpsReadModelSummary(rpcConfig, avail, rpcClient(forbidden, OPS_ALL_RPCS));
    assert.equal(s.status, "error");
    assert.equal(s.rpcStatus, "rpc_forbidden");
    const blob = JSON.stringify(s);
    assert.ok(!blob.includes("https://x"));
    assert.ok(!/Bearer|apikey/.test(s.lines.join(" ")));
  });

  it("missing-function RPCs map to rpc_unavailable", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const notFound: Record<string, RpcSpec> = Object.fromEntries(OPS_ALL_RPCS.map((n) => [n, { status: 404 }]));
    const s = await buildOpsReadModelSummary(rpcConfig, avail, rpcClient(notFound, OPS_ALL_RPCS));
    assert.equal(s.status, "error");
    assert.equal(s.rpcStatus, "rpc_unavailable");
  });

  it("empty DB is a grounded zero-state, not a failure", async () => {
    const avail = resolveAvailability(rpcConfig, { URL: "https://x", KEY: "k" });
    const empty: Record<string, RpcSpec> = {
      get_ops_overview: {
        body: {
          active_card_count: 0, blocked_card_count: 0, waiting_card_count: 0, urgent_card_count: 0,
          stale_card_count: 0, no_next_action_count: 0, latest_update_at: null, data_freshness: null,
          stale_threshold_days: 14, source: "ops-agent-v2:supabase", data_quality_flags: [],
        },
      },
      get_ops_attention_cards: { body: [] },
      get_ops_recent_updates: { body: [] },
      get_ops_status_counts: { body: { by_status: {}, by_project: {}, by_owner: {}, total: 0, source: "ops-agent-v2:supabase", updated_at: null } },
      get_ops_risk_flags: { body: [] },
    };
    const s = await buildOpsReadModelSummary(rpcConfig, avail, rpcClient(empty, OPS_ALL_RPCS));
    assert.equal(s.status, "ok");
    assert.equal(s.rpcStatus, "rpc_live");
    assert.equal(s.metrics["activeCards"], 0);
    assert.equal(s.metrics["urgentCards"], 0);
    assert.equal(s.metrics["attentionCards"], 0);
    assert.equal(s.metrics["riskFlagCount"], 0);
  });

  it("a body with no usable records maps to rpc_no_rows", async () => {
    const overviewOnly: ReadModelConfig = { ...config, allowedRpcs: ["get_ops_overview"] };
    const avail = resolveAvailability(overviewOnly, { URL: "https://x", KEY: "k" });
    // overview returns an empty array (no object) → nothing usable to extract.
    const s = await buildOpsReadModelSummary(overviewOnly, avail, rpcClient({ get_ops_overview: { body: [] } }, overviewOnly.allowedRpcs));
    assert.equal(s.rpcStatus, "rpc_no_rows");
  });

  it("table mode is preserved when no RPCs are allowlisted", async () => {
    const avail = resolveAvailability(config, { URL: "https://x", KEY: "k" });
    const client = clientFor({ clickup_cards: [{ status: "open" }], sync_runs: [], agent_logs: [] });
    const s = await buildOpsReadModelSummary(config, avail, client);
    assert.equal(s.rpcStatus, undefined);
    assert.equal(s.metrics["activeCards"], 1);
  });

  it("missing env/client reports rpc_missing_env in RPC mode", async () => {
    const avail = resolveAvailability(rpcConfig, {});
    const s = await buildOpsReadModelSummary(rpcConfig, avail, undefined);
    assert.equal(s.status, "missing");
    assert.equal(s.rpcStatus, "rpc_missing_env");
  });
});
