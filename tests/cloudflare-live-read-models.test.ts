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
  resolveCockpitProposals,
  resolveCockpitThreads,
  persistCockpitProposals,
  hostedReadModelsConfigured,
  buildHostedReadModelRegistry,
  HOSTED_READ_MODEL_ENV,
  ASK_WRITE_ENV,
  OPS_ALLOWED_RPCS,
  FITNESS_ALLOWED_RPCS,
  type WriteFetch,
} from "../src/runtime/cloudflare-live-read-models.js";
import type { ActionProposal } from "../src/cockpit/proposals/proposal-types.js";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";
import { proposalsView } from "../src/runtime/cloudflare-cockpit-views.js";
import { mapRowToProposalQueueItem } from "../src/cockpit/proposals/cockpit-proposal-spine.js";
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

describe("hosted fleet view — unified cross-agent render surfaced in the live route", () => {
  const env = {}; // open auth (no token, not production)

  /** A worker context whose live provider serves a real, fs-free hosted state. */
  async function liveCtx() {
    const state = await resolveHostedCockpitState(fullEnv(), { now: NOW, clientFactory: stubClientFactory() });
    assert.ok(state, "live state should resolve");
    return { runtimeMode: "hosted", liveStateProvider: async () => state ?? undefined };
  }

  it("GET /api/fleet returns a unified AgentSignal for BOTH agents (no per-agent glue)", async () => {
    const res = await handleCockpitRequest(new Request("https://c/api/fleet"), env, await liveCtx());
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      available: boolean;
      agents: { id: string; type: string; signal: { verdict: string; confidence: string; freshness: string; approvalNeeded: boolean } }[];
      rendered: string;
    };
    assert.equal(body.available, true);
    assert.deepEqual(body.agents.map((a) => a.type).sort(), ["fitness", "ops"]);

    const fit = body.agents.find((a) => a.type === "fitness")!;
    const ops = body.agents.find((a) => a.type === "ops")!;
    // Derived from each agent's own read-model data — never fabricated.
    assert.equal(fit.signal.verdict, "green");
    assert.equal(fit.signal.approvalNeeded, false, "fitness is advisory");
    assert.equal(ops.signal.verdict, "urgent");
    assert.equal(ops.signal.approvalNeeded, true, "ops proposals need approval");

    // The unified text render covers both agents.
    assert.match(body.rendered, /HartOS Fleet/);
    assert.match(body.rendered, /fitness \(fitness\)/);
    assert.match(body.rendered, /ops \(ops\)/);
  });

  it("GET / (hosted HTML) renders a fleet card per agent (Style 5), with verdict + approval gating", async () => {
    const res = await handleCockpitRequest(new Request("https://c/"), env, await liveCtx());
    assert.equal(res.status, 200);
    const html = await res.text();
    // Style 5 — each agent is a real card linking to its full dashboard (works w/o JS).
    assert.match(html, /Fleet · click any agent to expand/);
    assert.match(html, /class="card" href="\/agent\/fitness\/ui"/);
    assert.match(html, /class="card" href="\/agent\/ops\/ui"/);
    // Verdicts are surfaced from each agent's own data (uppercased in the pill).
    assert.match(html, /GREEN/, "fitness verdict");
    assert.match(html, /URGENT/, "ops verdict");
    // Ops needs human approval → its card is approval-gated; fitness is advisory.
    assert.match(html, /approval-gated/, "ops requires approval");
  });

  it("the fleet route never leaks the read-only key", async () => {
    const res = await handleCockpitRequest(new Request("https://c/api/fleet"), env, await liveCtx());
    const raw = await res.text();
    assert.equal(raw.includes(ANON_KEY), false, "key value must not appear in the fleet response");
  });

  it("degrades honestly — fleet still lists both agents when a domain is unconfigured", async () => {
    const opsOnlyEnv = {
      [HOSTED_READ_MODEL_ENV.opsUrl]: "https://ops.example.supabase.co",
      [HOSTED_READ_MODEL_ENV.opsKey]: ANON_KEY,
      // fitness env intentionally absent
    };
    const state = await resolveHostedCockpitState(opsOnlyEnv, { now: NOW, clientFactory: stubClientFactory() });
    const res = await handleCockpitRequest(
      new Request("https://c/api/fleet"),
      env,
      { runtimeMode: "hosted", liveStateProvider: async () => state ?? undefined }
    );
    const body = (await res.json()) as { agents: { type: string; signal: { verdict: string; confidence: string } }[] };
    assert.deepEqual(body.agents.map((a) => a.type).sort(), ["fitness", "ops"]);
    const fit = body.agents.find((a) => a.type === "fitness")!;
    assert.equal(fit.signal.verdict, "missing", "unconfigured fitness maps to its read status");
    assert.equal(fit.signal.confidence, "unknown", "confidence is never faked for a missing read");
  });
});

describe("hosted proposal spine — live read (Phase D)", () => {
  function fitnessEnv(): Record<string, string> {
    return {
      [HOSTED_READ_MODEL_ENV.fitnessUrl]: "https://fit.example.supabase.co",
      [HOSTED_READ_MODEL_ENV.fitnessKey]: ANON_KEY,
    };
  }

  /** A fetch that returns the spine rows only for the proposals RPC. */
  function proposalFetch(rows: unknown): FetchLike {
    return async (url) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes("/rpc/get_cockpit_proposals") ? rows : []),
    });
  }

  const ROW = {
    id: "p1", domain: "ops", action_type: "ops_followup_plan", title: "Chase supplier",
    risk_level: "high", status: "pending_approval", source_intent: "ops urgent",
    spec_id: null, created_at: NOW, updated_at: NOW, expires_at: null,
  };

  it("resolveCockpitProposals maps spine rows to ProposalQueueItems", async () => {
    const items = await resolveCockpitProposals(fitnessEnv(), { fetchImpl: proposalFetch([ROW]) });
    assert.ok(items, "rows should resolve");
    assert.equal(items!.length, 1);
    assert.equal(items![0]!.title, "Chase supplier");
    assert.equal(items![0]!.riskLevel, "high");
    assert.equal(items![0]!.executable, false);
  });

  it("returns null when a service-role key is presented (never reads)", async () => {
    const env = {
      [HOSTED_READ_MODEL_ENV.fitnessUrl]: "https://fit.example.supabase.co",
      [HOSTED_READ_MODEL_ENV.fitnessKey]: "service_role_secret_key",
    };
    const items = await resolveCockpitProposals(env, { fetchImpl: proposalFetch([ROW]) });
    assert.equal(items, null);
  });

  it("returns null when fitness env is absent", async () => {
    const items = await resolveCockpitProposals({}, { fetchImpl: proposalFetch([ROW]) });
    assert.equal(items, null);
  });

  it("never leaks the anon key into the resolved items", async () => {
    const items = await resolveCockpitProposals(fitnessEnv(), { fetchImpl: proposalFetch([ROW]) });
    assert.equal(JSON.stringify(items).includes(ANON_KEY), false);
  });

  it("resolveHostedCockpitState surfaces spine proposals via the injected provider → proposalsView available", async () => {
    const provider = async () => [
      mapRowToProposalQueueItem({
        id: "p9", domain: "system", action_type: "review_plan", title: "Review the spine",
        risk_level: "low", status: "draft", source_intent: "", spec_id: null,
        created_at: NOW, updated_at: NOW, expires_at: null,
      }),
    ];
    const state = await resolveHostedCockpitState(fullEnv(), {
      now: NOW,
      clientFactory: stubClientFactory(),
      proposalsProvider: provider,
    });
    const view = proposalsView(state!);
    assert.equal(view.available, true);
    assert.equal(view.total, 1);
    assert.equal(view.proposals[0]!.title, "Review the spine");
  });

  it("a stubbed read-model context with NO provider makes no proposal read (honest local-only fallback)", async () => {
    const state = await resolveHostedCockpitState(fullEnv(), { now: NOW, clientFactory: stubClientFactory() });
    const view = proposalsView(state!);
    assert.equal(view.available, false, "queue omitted → proposalsView reports local-only, no network call");
  });
});

describe("Ask HartOS → spine WRITE (Phase E / Gap E)", () => {
  const ASK_URL = "https://fn.example.supabase.co/functions/v1/persist-cockpit-proposal";
  const TOKEN = "ask-write-token-DO-NOT-LEAK";
  const writeEnv = { [ASK_WRITE_ENV.url]: ASK_URL, [ASK_WRITE_ENV.token]: TOKEN };

  const proposals: ActionProposal[] = [
    {
      id: `prop-build-a-tax-agent-${NOW}`, domain: "factory", actionType: "agent_creation_plan",
      title: "Build a Tax Agent", description: "", sourceIntent: "create a tax agent",
      proposedPayload: {}, expectedEffect: "", riskLevel: "medium", requiredApproval: "Hart",
      status: "draft", createdAt: NOW, expiresAt: null, safetyNotes: [], blockedReason: "",
      dryRunResult: null, executable: false,
    },
  ];

  it("stays advisory (no network call) when the write env is absent — read-only default", async () => {
    let called = false;
    const fetchImpl: WriteFetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    const r = await persistCockpitProposals({}, proposals, { now: NOW, fetchImpl });
    assert.equal(r.attempted, false);
    assert.equal(called, false, "must NOT call the endpoint when unconfigured");
  });

  it("posts content-stable, non-executable rows with a bearer token and reports the count", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBodyRaw = "";
    const fetchImpl: WriteFetch = async (url, init) => {
      seenUrl = url;
      seenAuth = init.headers.authorization;
      seenBodyRaw = init.body;
      return { ok: true, status: 200, json: async () => ({ persisted: 1, failed: 0 }) };
    };
    const r = await persistCockpitProposals(writeEnv, proposals, { now: NOW, sourceIntent: "create a tax agent", fetchImpl });
    assert.equal(r.attempted, true);
    assert.equal(r.persisted, 1);
    assert.equal(seenUrl, ASK_URL);
    assert.equal(seenAuth, `Bearer ${TOKEN}`);
    const body = JSON.parse(seenBodyRaw) as { proposals: Array<{ id: string; payload: { executable: boolean } }> };
    assert.equal(body.proposals.length, 1);
    assert.equal(body.proposals[0]!.id, "prop-factory-agent_creation_plan-build-a-tax-agent");
    assert.equal(body.proposals[0]!.payload.executable, false);
  });

  it("never leaks the write token, even on a failed write", async () => {
    const fetchImpl: WriteFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const r = await persistCockpitProposals(writeEnv, proposals, { now: NOW, fetchImpl });
    assert.equal(r.attempted, true);
    assert.equal(r.persisted, 0);
    assert.ok(!JSON.stringify(r).includes(TOKEN), "token must never appear in the result");
  });

  it("fails safe (never throws) when the endpoint is unreachable", async () => {
    const fetchImpl: WriteFetch = async () => { throw new Error("network down"); };
    const r = await persistCockpitProposals(writeEnv, proposals, { now: NOW, fetchImpl });
    assert.equal(r.attempted, true);
    assert.equal(r.failed, 1);
    assert.equal(r.reason, "write endpoint unreachable");
  });
});

describe("hosted thread spine — live read (Phase D / Gap D)", () => {
  function fitnessEnv(): Record<string, string> {
    return {
      [HOSTED_READ_MODEL_ENV.fitnessUrl]: "https://fit.example.supabase.co",
      [HOSTED_READ_MODEL_ENV.fitnessKey]: ANON_KEY,
    };
  }
  function threadFetch(rows: unknown): FetchLike {
    return async (url) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes("/rpc/get_cockpit_threads") ? rows : []),
    });
  }
  const ROW = {
    thread_id: "thread-1", created_at: NOW, updated_at: NOW, entry_count: 2,
    latest_request: "Create a tax agent", latest_intent: "build_agent", latest_summary: "Build plan drafted.",
  };

  it("resolveCockpitThreads maps spine rows to summaries", async () => {
    const items = await resolveCockpitThreads(fitnessEnv(), { fetchImpl: threadFetch([ROW]) });
    assert.ok(items, "rows should resolve");
    assert.equal(items!.length, 1);
    assert.equal(items![0]!.threadId, "thread-1");
    assert.equal(items![0]!.entryCount, 2);
    assert.equal(items![0]!.latestIntent, "build_agent");
  });

  it("returns null when a service-role key is presented (never reads)", async () => {
    const env = {
      [HOSTED_READ_MODEL_ENV.fitnessUrl]: "https://fit.example.supabase.co",
      [HOSTED_READ_MODEL_ENV.fitnessKey]: "service_role_secret_key",
    };
    assert.equal(await resolveCockpitThreads(env, { fetchImpl: threadFetch([ROW]) }), null);
  });

  it("never leaks the anon key into the summaries", async () => {
    const items = await resolveCockpitThreads(fitnessEnv(), { fetchImpl: threadFetch([ROW]) });
    assert.equal(JSON.stringify(items).includes(ANON_KEY), false);
  });

  it("GET /api/threads serves the spine via threadsProvider (no longer local-only)", async () => {
    const res = await handleCockpitRequest(new Request("https://c/api/threads"), {}, {
      runtimeMode: "hosted",
      threadsProvider: async () => [
        { threadId: "thread-1", createdAt: NOW, updatedAt: NOW, entryCount: 2, latestRequest: "Create a tax agent", latestIntent: "build_agent", latestSummary: "Build plan drafted." },
      ],
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { threads: Array<{ threadId: string }> };
    assert.equal(body.threads.length, 1);
    assert.equal(body.threads[0]!.threadId, "thread-1");
  });
});
