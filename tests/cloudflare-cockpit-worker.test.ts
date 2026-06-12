/**
 * tests/cloudflare-cockpit-worker.test.ts — Phase 11J.
 * The hosted Worker serves read-only routes, validates POST, rejects unsupported
 * methods / oversized / secret-looking input, and never exposes env values.
 * Mocked Request/Env only — no network, no deploy.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleCockpitRequest, createCockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";

const base = "https://cockpit.local";

describe("cloudflare cockpit worker", () => {
  let dir: string;
  let ctx: CockpitWorkerContext;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cf-worker-"));
    ctx = await createCockpitWorkerContext({ cwd: dir });
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("serves GET / as HTML", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/`), {}, ctx);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("content-type") ?? "").includes("text/html"));
    const body = await res.text();
    assert.ok(body.includes("<!doctype html>"));
  });

  it("serves GET /health", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/health`), {}, ctx);
    assert.equal(res.status, 200);
    const data = await res.json() as { ok: boolean; actionExecution: string };
    assert.equal(data.ok, true);
    assert.equal(data.actionExecution, "disabled");
  });

  it("serves GET /api/state as read-only JSON", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/state`), {}, ctx);
    assert.equal(res.status, 200);
    const data = await res.json() as { cards?: unknown[] };
    assert.ok(Array.isArray(data.cards));
  });

  it("rejects unsupported methods with 405", async () => {
    for (const method of ["DELETE", "PUT", "PATCH"]) {
      const res = await handleCockpitRequest(new Request(`${base}/`, { method }), {}, ctx);
      assert.equal(res.status, 405, `${method} must be 405`);
    }
  });

  it("has no mutation route: POST to /api/state is not found", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/state`, { method: "POST", body: "{}" }), {}, ctx);
    assert.equal(res.status, 404);
  });

  it("validates POST /api/orchestrator/message and returns deterministic, read-only output", async () => {
    const req = new Request(`${base}/api/orchestrator/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "What is the status of my Ops Agent?" }),
    });
    const res = await handleCockpitRequest(req, {}, ctx);
    assert.equal(res.status, 200);
    const data = await res.json() as { ok: boolean; mode: string; actionExecution: string };
    assert.equal(data.ok, true);
    assert.equal(data.mode, "deterministic");
    assert.equal(data.actionExecution, "disabled");
  });

  it("rejects empty/invalid request body", async () => {
    const res = await handleCockpitRequest(
      new Request(`${base}/api/orchestrator/message`, { method: "POST", body: JSON.stringify({ request: "" }) }),
      {},
      ctx
    );
    assert.equal(res.status, 400);
  });

  it("rejects secret-looking request input", async () => {
    const secret = "my key is sk-" + "a".repeat(40);
    const res = await handleCockpitRequest(
      new Request(`${base}/api/orchestrator/message`, { method: "POST", body: JSON.stringify({ request: secret }) }),
      {},
      ctx
    );
    assert.equal(res.status, 400);
  });

  it("rejects oversized request bodies with 413", async () => {
    const big = "x".repeat(70 * 1024);
    const res = await handleCockpitRequest(
      new Request(`${base}/api/orchestrator/message`, { method: "POST", body: JSON.stringify({ request: big }) }),
      {},
      ctx
    );
    assert.equal(res.status, 413);
  });

  it("never exposes env VALUES — debug/status reports presence only", async () => {
    const env = { GEMINI_API_KEY: "tok-present-value-xyz", OPENAI_API_KEY: "acct-123" };
    const res = await handleCockpitRequest(new Request(`${base}/api/debug/status`), env, ctx);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes("tok-present-value-xyz"), "must not leak the token value");
    assert.ok(!text.includes("acct-123"), "must not leak the second secret value");
    const data = JSON.parse(text) as { envPresence: { name: string; present: boolean }[]; actionExecution: string };
    const tokenEntry = data.envPresence.find((e) => e.name === "GEMINI_API_KEY");
    assert.equal(tokenEntry?.present, true);
    assert.equal(data.actionExecution, "disabled");
  });
});
