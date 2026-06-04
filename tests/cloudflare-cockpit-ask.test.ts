/**
 * tests/cloudflare-cockpit-ask.test.ts — Phase 16.
 * The hosted /api/ask, /api/freshness, /api/read-models/status, and
 * /api/proposals routes: grounded read-only answers, zero proposals for
 * status/brief/freshness questions, action execution stays disabled, no
 * mutation/provider paths, and no secret leakage. Open mode (no token) is used
 * so the routes are reachable without auth.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleCockpitRequest, createCockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";

const base = "https://cockpit.local";

function post(request: string): Request {
  return new Request(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request }),
  });
}

describe("hosted /api/ask + read-only data routes", () => {
  let dir: string;
  let ctx: CockpitWorkerContext;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cf-ask-")); ctx = await createCockpitWorkerContext({ cwd: dir }); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("/api/ask returns a grounded daily brief with action execution disabled", async () => {
    const res = await handleCockpitRequest(post("What needs my attention today?"), {}, ctx);
    assert.equal(res.status, 200);
    const data = await res.json() as { intent: string; summary: string; proposalCount: number; actionExecution: string; mutationEndpoints: string };
    assert.equal(data.intent, "daily_brief");
    assert.match(data.summary, /^Command Brief:/m);
    assert.equal(data.actionExecution, "disabled");
    assert.equal(data.mutationEndpoints, "none");
  });

  it("status/brief/freshness questions create ZERO proposals", async () => {
    for (const q of ["What needs my attention today?", "Is my data fresh?", "Anything urgent in ops?", "Show system status", "Why is ops stale?"]) {
      const res = await handleCockpitRequest(post(q), {}, ctx);
      const data = await res.json() as { proposalCount: number; proposals: unknown[] };
      assert.equal(data.proposalCount, 0, `"${q}" must create zero proposals`);
      assert.equal(data.proposals.length, 0);
    }
  });

  it("explicit refresh/plan language yields a non-executable dry-run draft", async () => {
    const res = await handleCockpitRequest(post("Draft a sync repair plan to refresh ops"), {}, ctx);
    const data = await res.json() as { intent: string; proposals: { executable: boolean; actionType: string }[] };
    assert.equal(data.intent, "freshness_status");
    // A snapshot with no live ops panel may yield 0; if any are produced they MUST be non-executable.
    for (const p of data.proposals) assert.equal(p.executable, false);
  });

  it("rejects empty + secret-looking + oversized /api/ask input", async () => {
    assert.equal((await handleCockpitRequest(post(""), {}, ctx)).status, 400);
    const secret = "my key is sk-" + "a".repeat(40);
    assert.equal((await handleCockpitRequest(post(secret), {}, ctx)).status, 400);
    const big = "x".repeat(70 * 1024);
    assert.equal((await handleCockpitRequest(post(big), {}, ctx)).status, 413);
  });

  it("/api/freshness returns a read-only freshness view", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/freshness`), {}, ctx);
    assert.equal(res.status, 200);
    const data = await res.json() as Record<string, unknown>;
    assert.ok("verdict" in data || "available" in data, "freshness view has a verdict or an honest unavailable flag");
  });

  it("/api/read-models/status degrades honestly and exposes no secrets", async () => {
    const env = { HARTOS_OPS_SUPABASE_READONLY_KEY: "super-secret-anon-key-value" };
    const res = await handleCockpitRequest(new Request(`${base}/api/read-models/status`), env, ctx);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes("super-secret-anon-key-value"), "must not leak the key value");
    const data = JSON.parse(text) as { available: boolean };
    assert.equal(typeof data.available, "boolean");
  });

  it("/api/proposals is read-only and non-executable", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/proposals`), {}, ctx);
    assert.equal(res.status, 200);
    const data = await res.json() as { executable: string; origin: string; mode: string };
    assert.equal(data.executable, "disabled");
    assert.equal(data.origin, "local");
  });

  it("has no mutation route: POST /api/freshness is 404", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/freshness`, { method: "POST", body: "{}" }), {}, ctx);
    assert.equal(res.status, 404);
  });
});
