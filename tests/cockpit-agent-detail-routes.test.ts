/**
 * tests/cockpit-agent-detail-routes.test.ts — Phase C.
 * GET /agent/fitness and /agent/ops serve the full per-agent detail (read-only),
 * resolved via the injected provider, and degrade to an honest "unavailable"
 * payload when no detail resolves.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { AgentDetail } from "../src/read-models/agent-detail.js";

const NOW = "2026-06-07T08:00:00.000Z";
const env = {}; // open auth (no token configured, not production)

describe("hosted per-agent detail routes (Phase C)", () => {
  it("GET /agent/fitness returns the live fitness detail via the provider", async () => {
    const detail: AgentDetail = {
      type: "fitness",
      status: "ok",
      generatedAt: NOW,
      recovery: { status: "green", hrvMs: 55 },
      series: [{ date: "2026-06-06", hrvMs: 55, sleepHours: 8 }],
      bodyweight: [{ date: "2026-06-06", kg: 80 }],
      nutrition: { caloriesTarget: 3100 },
      workouts: [],
      notes: [],
    };
    const res = await handleCockpitRequest(new Request("https://c/agent/fitness"), env, {
      runtimeMode: "hosted",
      agentDetailProvider: async (d) => (d === "fitness" ? detail : null),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { type: string; recovery: { status: string }; series: unknown[]; bodyweight: Array<{ kg: number }> };
    assert.equal(body.type, "fitness");
    assert.equal(body.recovery.status, "green");
    assert.equal(body.series.length, 1);
    assert.equal(body.bodyweight[0]!.kg, 80);
  });

  it("GET /agent/ops returns the live ops detail", async () => {
    const detail: AgentDetail = {
      type: "ops",
      status: "ok",
      generatedAt: NOW,
      counts: { urgent: 2 },
      attention: [{ title: "Wire to supplier", reason: "urgent" }],
      updates: [],
      riskFlags: [],
      notes: [],
    };
    const res = await handleCockpitRequest(new Request("https://c/agent/ops"), env, {
      runtimeMode: "hosted",
      agentDetailProvider: async () => detail,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { type: string; counts: { urgent: number }; attention: Array<{ title: string }> };
    assert.equal(body.type, "ops");
    assert.equal(body.counts.urgent, 2);
    assert.equal(body.attention[0]!.title, "Wire to supplier");
  });

  it("degrades to an honest 'unavailable' payload when no detail resolves", async () => {
    const res = await handleCockpitRequest(new Request("https://c/agent/fitness"), env, {
      runtimeMode: "hosted",
      agentDetailProvider: async () => null,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { available: boolean; type: string };
    assert.equal(body.available, false);
    assert.equal(body.type, "fitness");
  });
});
