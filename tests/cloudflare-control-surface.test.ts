/**
 * tests/cloudflare-control-surface.test.ts
 *
 * Phase 18F — Hosted Live Read-Only Cockpit. Hermetic: no network, no real LLM,
 * no filesystem reads on the request path. Covers the brief's required endpoint
 * tests: sanitized JSON, no secret leak, honest UNKNOWN, no browser mutation,
 * no Node-only execution imports in the hosted/browser surface, live-adapter
 * failure → UNKNOWN (not crash), and LLM-cannot-override-verdict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildControlSurfaceState,
  type ControlSurfaceInputs,
  type ControlSurfaceRender,
  type FactSummarizer,
} from "../src/cockpit/control-surface/index.js";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";
import {
  resolveHostedControlSurface,
  hostedControlSurfaceJson,
  buildHostedControlSurfaceInputs,
} from "../src/runtime/cloudflare-control-surface.js";

const NOW = "2026-06-05T12:00:00.000Z";
const STALE = "2026-06-04T00:00:00.000Z"; // > 24h before NOW
const DEV_ENV = { HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true" };
const base = "https://cockpit.local";

function inputs(over: Partial<ControlSurfaceInputs> = {}): ControlSurfaceInputs {
  return {
    now: NOW,
    tax: null,
    fitness: { live: false, metrics: {}, dataFreshness: null },
    ops: { live: false, metrics: {}, dataFreshness: null },
    factory: null,
    systemHealth: [{ name: "Fitness Supabase", state: "unknown", detail: "unavailable" }],
    proposalQueue: { needsApproval: 0, readyLocal: 0, blocked: 0, completed: 0 },
    recentActivity: [],
    unavailableAgents: [
      { agentId: "tax", name: "Tax Agent", icon: "🧾", purpose: "p", reason: "local-only — not served in hosted read-only mode" },
      { agentId: "factory", name: "Agent Factory", icon: "🏭", purpose: "p", reason: "local-only — not served in hosted read-only mode" },
    ],
    ...over,
  };
}

function provider(state: ControlSurfaceRender | undefined): { fn: () => Promise<ControlSurfaceRender | undefined>; calls: () => number } {
  let n = 0;
  return { fn: async () => { n += 1; return state; }, calls: () => n };
}

async function renderFrom(over: Partial<ControlSurfaceInputs> = {}, summarizer?: FactSummarizer): Promise<ControlSurfaceRender> {
  return buildControlSurfaceState({ inputs: inputs(over), now: NOW, ...(summarizer ? { summarizer } : {}) });
}

describe("18F — GET /api/control-surface returns sanitized JSON", () => {
  it("serves 200 with systemVerdict + agents, action execution disabled", async () => {
    const state = await renderFrom({ ops: { live: true, metrics: { activeCards: 3, blockedCards: 0 }, dataFreshness: STALE } });
    const ctx: CockpitWorkerContext = { controlSurfaceProvider: provider(state).fn };
    const res = await handleCockpitRequest(new Request(`${base}/api/control-surface`), DEV_ENV, ctx);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("content-type") ?? "").includes("application/json"));
    const data = (await res.json()) as { systemVerdict: string; agents: unknown[]; actionExecution: string; mutationEndpoints: string };
    assert.ok(Array.isArray(data.agents));
    assert.equal(data.actionExecution, "disabled");
    assert.equal(data.mutationEndpoints, "none");
    assert.equal(data.systemVerdict, "AMBER"); // ops stale
  });

  it("POST /api/control-surface is not a route (no mutation): 404", async () => {
    const ctx: CockpitWorkerContext = { controlSurfaceProvider: provider(await renderFrom()).fn };
    const res = await handleCockpitRequest(new Request(`${base}/api/control-surface`, { method: "POST", body: "{}" }), DEV_ENV, ctx);
    assert.equal(res.status, 404);
  });
});

describe("18F — no secret-looking values in the response", () => {
  it("a normal payload contains no secret patterns", async () => {
    const state = await renderFrom({ ops: { live: true, metrics: { activeCards: 2 }, dataFreshness: NOW } });
    const json = JSON.stringify(hostedControlSurfaceJson(state));
    assert.doesNotMatch(json, /sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{16,}/);
  });

  it("hostedControlSurfaceJson THROWS if a bundle smuggled a token (assertNoSecrets gate)", async () => {
    const token = "sk-" + "a".repeat(32);
    const state = await renderFrom();
    // Force a secret into a rendered bundle summary AFTER the per-bundle check.
    state.bundles[0]!.summary.text = `leak ${token}`;
    assert.throws(() => hostedControlSurfaceJson(state), /secret-looking/i);
  });

  it("a configured read-only key value never appears in the resolved JSON", async () => {
    const ANON = "eyJ" + "a".repeat(40) + "." + "b".repeat(40) + "." + "c".repeat(20);
    const env = {
      HARTOS_FITNESS_SUPABASE_URL: "https://fit.example.supabase.co",
      HARTOS_FITNESS_SUPABASE_READONLY_KEY: ANON,
      // client factory refuses → fitness stays UNKNOWN, but the key must never leak
      HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true",
    };
    const state = await resolveHostedControlSurface(env, { now: NOW, clientFactory: () => undefined });
    const json = JSON.stringify(hostedControlSurfaceJson(state));
    assert.equal(json.includes(ANON), false, "the read-only key value must not appear anywhere in the JSON");
  });
});

describe("18F — unknown data renders honestly", () => {
  it("no read-model env → every domain UNKNOWN, system UNKNOWN", async () => {
    const state = await resolveHostedControlSurface({}, { now: NOW });
    assert.equal(state.systemVerdict, "UNKNOWN");
    assert.ok(state.bundles.every((b) => b.verdict === "UNKNOWN"));
    const fit = state.bundles.find((b) => b.agentId === "fitness")!;
    assert.match(fit.summary.text, /can't assess/i);
  });

  it("provider declines → /api/control-surface returns available:false, UNKNOWN", async () => {
    const ctx: CockpitWorkerContext = { controlSurfaceProvider: provider(undefined).fn };
    const res = await handleCockpitRequest(new Request(`${base}/api/control-surface`), DEV_ENV, ctx);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { available: boolean; systemVerdict: string };
    assert.equal(data.available, false);
    assert.equal(data.systemVerdict, "UNKNOWN");
  });

  it("GET /control renders the honest unavailable card", async () => {
    const ctx: CockpitWorkerContext = { controlSurfaceProvider: provider(await resolveHostedControlSurface({}, { now: NOW })).fn };
    const res = await handleCockpitRequest(new Request(`${base}/control`), DEV_ENV, ctx);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /unknown · data unavailable/);
    assert.match(html, /can't assess/i);
  });
});

describe("18F — the browser bundle cannot execute provider mutations", () => {
  it("/control HTML has only non-execute actions and a GET-only refresh", async () => {
    const state = await renderFrom({ ops: { live: true, metrics: { activeCards: 3, blockedCards: 1 }, dataFreshness: STALE } });
    const ctx: CockpitWorkerContext = { controlSurfaceProvider: provider(state).fn };
    const res = await handleCockpitRequest(new Request(`${base}/control`), DEV_ENV, ctx);
    const html = await res.text();
    // Static markup: only the three allowed action kinds.
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
    for (const m of markup.matchAll(/data-action="([^"]+)"/g)) {
      assert.ok(["copy_cli", "open_proposal", "open_link"].includes(m[1]!), `unexpected action: ${m[1]}`);
    }
    assert.doesNotMatch(html, /data-action="execute"/);
    // The refresh script fetches GET only — no POST/PUT/DELETE mutation anywhere.
    assert.match(html, /method:'GET'/);
    assert.doesNotMatch(html, /method:\s*['"]POST['"]|method:\s*['"]PUT['"]|method:\s*['"]DELETE['"]/);
  });
});

describe("18F — no Node-only execution modules reach the Worker/browser surface", () => {
  const hostedSrc = readFileSync(path.join(process.cwd(), "src/runtime/cloudflare-control-surface.ts"), "utf8");

  it("the hosted control-surface module imports no fs/child_process and never the disk loader", () => {
    assert.doesNotMatch(hostedSrc, /from\s+["']node:fs["']|from\s+["']node:fs\/promises["']/);
    assert.doesNotMatch(hostedSrc, /child_process|node:child_process/);
    assert.doesNotMatch(hostedSrc, /loadControlSurfaceInputs/, "the request path must never reach the disk loader");
  });

  it("the rendered hosted HTML contains no Node imports / process access in client JS", async () => {
    const state = await renderFrom();
    const ctx: CockpitWorkerContext = { controlSurfaceProvider: provider(state).fn };
    const html = await (await handleCockpitRequest(new Request(`${base}/control`), DEV_ENV, ctx)).text();
    assert.doesNotMatch(html, /require\(|node:|process\.env|module\.exports/);
  });
});

describe("18F — live adapter failure degrades to UNKNOWN, not a crash", () => {
  it("a client factory that throws still resolves an all-UNKNOWN surface", async () => {
    const env = {
      HARTOS_OPS_SUPABASE_URL: "https://ops.example.supabase.co",
      HARTOS_OPS_SUPABASE_READONLY_KEY: "eyJ" + "x".repeat(40) + "." + "y".repeat(40),
    };
    const state = await resolveHostedControlSurface(env, {
      now: NOW,
      clientFactory: () => {
        throw new Error("adapter exploded");
      },
    });
    assert.ok(state, "must resolve, not throw");
    const ops = state.bundles.find((b) => b.agentId === "ops")!;
    assert.equal(ops.verdict, "UNKNOWN");
    assert.equal(state.systemVerdict, "UNKNOWN");
  });

  it("buildHostedControlSurfaceInputs always yields the local-only UNKNOWN agents", async () => {
    const built = await buildHostedControlSurfaceInputs({}, NOW);
    const ids = (built.unavailableAgents ?? []).map((a) => a.agentId);
    assert.deepEqual(ids.sort(), ["factory", "tax"]);
  });
});

describe("18F — the LLM cannot override the deterministic verdict (hosted path)", () => {
  it("a sneaky summarizer returning RED cannot change a computed AMBER", async () => {
    const sneaky = (() => ({
      verdict: "RED",
      confidence: "LOW",
      selectedFactKeys: [],
      summaryText: "fine",
      citedFactKeys: [],
      whyVerdict: "explained",
      fixProse: [],
    })) as unknown as FactSummarizer;
    const state = await renderFrom({ ops: { live: true, metrics: { activeCards: 3 }, dataFreshness: STALE } }, sneaky);
    const json = hostedControlSurfaceJson(state);
    const ops = json.agents.find((a) => a.id === "ops")!;
    assert.equal(ops.verdict, "AMBER", "computed verdict must win over the model's RED");
  });
});

describe("18F — auth gate protects the control surface", () => {
  it("unauthenticated production request → 401 and the provider is NOT called", async () => {
    const spy = provider(await renderFrom());
    const prodEnv = { APP_ENV: "production", HARTOS_COCKPIT_ACCESS_TOKEN: "secret-token" };
    const res = await handleCockpitRequest(new Request(`${base}/api/control-surface`), prodEnv, { controlSurfaceProvider: spy.fn });
    assert.equal(res.status, 401);
    assert.equal(spy.calls(), 0, "no live read before auth");
  });

  it("GET /health never calls the control-surface provider", async () => {
    const spy = provider(await renderFrom());
    const res = await handleCockpitRequest(new Request(`${base}/health`), DEV_ENV, { controlSurfaceProvider: spy.fn });
    assert.equal(res.status, 200);
    assert.equal(spy.calls(), 0);
  });

  it("unauthenticated GET /control serves the login page (HTML), not a 401 JSON", async () => {
    const spy = provider(await renderFrom());
    const prodEnv = { APP_ENV: "production", HARTOS_COCKPIT_ACCESS_TOKEN: "secret-token" };
    const res = await handleCockpitRequest(new Request(`${base}/control`), prodEnv, { controlSurfaceProvider: spy.fn });
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("content-type") ?? "").includes("text/html"));
    const html = await res.text();
    assert.match(html, /Access token/i, "login form should be shown");
    assert.match(html, /location\.href="\/control"/, "successful login should land back on /control");
    assert.equal(spy.calls(), 0, "no live read before auth");
  });

  it("unauthenticated GET /api/control-surface stays a 401 JSON (it is an API, not a page)", async () => {
    const prodEnv = { APP_ENV: "production", HARTOS_COCKPIT_ACCESS_TOKEN: "secret-token" };
    const res = await handleCockpitRequest(new Request(`${base}/api/control-surface`), prodEnv, { controlSurfaceProvider: provider(await renderFrom()).fn });
    assert.equal(res.status, 401);
    assert.ok((res.headers.get("content-type") ?? "").includes("application/json"));
  });
});
