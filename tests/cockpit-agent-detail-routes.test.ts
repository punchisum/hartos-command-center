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

  it("GET /agent/fitness/ui renders the full fitness dashboard as HTML", async () => {
    const detail: AgentDetail = {
      type: "fitness",
      status: "ok",
      generatedAt: NOW,
      recovery: { status: "green", hrvMs: 55, sleepHours: 8 },
      series: [{ date: "2026-06-06", hrvMs: 55, sleepHours: 8 }],
      bodyweight: [{ date: "2026-06-06", kg: 80 }],
      nutrition: { caloriesTarget: 3100 },
      workouts: [],
      notes: [],
    };
    const res = await handleCockpitRequest(new Request("https://c/agent/fitness/ui"), env, {
      runtimeMode: "hosted",
      agentDetailProvider: async (d) => (d === "fitness" ? detail : null),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const html = await res.text();
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Recovery series/);
    assert.match(html, /Bodyweight/);
    assert.match(html, /GREEN/);
    // Coaching depth surfaced on the live detail (green recovery → train as planned).
    assert.match(html, /Coaching verdict/);
    assert.match(html, /TRAIN AS PLANNED/);
  });

  it("plots SVG trend charts on /agent/fitness/ui when the series has ≥2 points", async () => {
    const detail: AgentDetail = {
      type: "fitness",
      status: "ok",
      generatedAt: NOW,
      recovery: { status: "green", hrvMs: 60 },
      series: [
        { date: "2026-06-04", hrvMs: 55, restingHr: 50, sleepHours: 7 },
        { date: "2026-06-05", hrvMs: 58, restingHr: 49, sleepHours: 8 },
        { date: "2026-06-06", hrvMs: 60, restingHr: 48, sleepHours: 7.5 },
      ],
      bodyweight: [{ date: "2026-06-01", kg: 80 }, { date: "2026-06-04", kg: 79.2 }, { date: "2026-06-06", kg: 78.5 }],
      nutrition: {},
      workouts: [],
      notes: [],
    };
    const res = await handleCockpitRequest(new Request("https://c/agent/fitness/ui"), env, {
      runtimeMode: "hosted",
      agentDetailProvider: async () => detail,
    });
    const html = await res.text();
    assert.match(html, /Trends/);
    assert.match(html, /<svg class="spark"/, "renders an inline SVG chart");
    assert.match(html, /Bodyweight \(kg\)/);
    assert.match(html, /min .* max .* last/, "chart caption with min/max/last");
    // Bodyweight trend (falling 80 → 78.5) is fed to the coach as context.
    assert.match(html, /Bodyweight is falling/);
  });

  it("GET /agent/ops/ui renders the full ops dashboard as HTML", async () => {
    const detail: AgentDetail = {
      type: "ops",
      status: "ok",
      generatedAt: NOW,
      counts: { urgent: 2, waiting: 1 },
      attention: [{ title: "Wire to supplier", reason: "urgent" }],
      updates: [],
      riskFlags: [],
      notes: [],
    };
    const res = await handleCockpitRequest(new Request("https://c/agent/ops/ui"), env, {
      runtimeMode: "hosted",
      agentDetailProvider: async () => detail,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const html = await res.text();
    assert.match(html, /Attention/);
    assert.match(html, /Wire to supplier/);
    // Triage depth surfaced on the live detail (2 urgent → act on them).
    assert.match(html, /Triage verdict/);
    assert.match(html, /Action 2 urgent/);
    // 1.7: the per-front "Next action" column surfaces the non-leading front's action too
    // (the waiting front's action only appears via the new column, not the primary line).
    assert.match(html, /Unblock 1 card\(s\) waiting on Hart/);
  });

  it("GET /agent/fitness/ui renders an honest 'unavailable' page when no detail resolves", async () => {
    const res = await handleCockpitRequest(new Request("https://c/agent/ops/ui"), env, {
      runtimeMode: "hosted",
      agentDetailProvider: async () => null,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const html = await res.text();
    assert.match(html, /unavailable/i);
    assert.match(html, /Nothing is fabricated/i);
  });
});
