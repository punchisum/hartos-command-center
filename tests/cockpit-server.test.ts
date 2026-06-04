/**
 * tests/cockpit-server.test.ts
 *
 * Phase 11H — local server route tests. No sockets, no network, no mutation.
 * Tests call routeRequest directly.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeRequest } from "../src/cockpit/cockpit-server.js";
import { MAX_REQUEST_LENGTH } from "../src/cockpit/cockpit-state.js";

async function setupAgentDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cockpit-server-"));
  const caps = path.join(dir, "capabilities");
  await mkdir(caps, { recursive: true });
  await writeFile(path.join(caps, "capability-registry.json"), JSON.stringify({ capabilities: {}, updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  await writeFile(path.join(caps, "provenance-ledger.json"), JSON.stringify({ entries: [], updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  return dir;
}

describe("cockpit server routes", () => {
  let dir: string;
  before(async () => { dir = await setupAgentDir(); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("GET / returns cockpit HTML", async () => {
    const res = await routeRequest("GET", "/", null, { cwd: dir });
    assert.equal(res.status, 200);
    assert.ok(res.contentType.includes("text/html"));
    assert.ok(res.body.includes("HartOS Command Center"));
    assert.ok(res.body.includes("Ask HartOS"));
  });

  it("GET /api/state returns JSON state with 22 cards", async () => {
    const res = await routeRequest("GET", "/api/state", null, { cwd: dir });
    assert.equal(res.status, 200);
    assert.ok(res.contentType.includes("application/json"));
    const state = JSON.parse(res.body) as { cards: unknown[]; mode: string };
    assert.equal(state.cards.length, 22);
    assert.equal(state.mode, "local");
  });

  it("GET /api/reports returns a reports array", async () => {
    const res = await routeRequest("GET", "/api/reports", null, { cwd: dir });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body) as { reports: unknown[] };
    assert.ok(Array.isArray(data.reports));
  });

  it("GET /api/threads returns a threads array", async () => {
    const res = await routeRequest("GET", "/api/threads", null, { cwd: dir });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body) as { threads: unknown[] };
    assert.ok(Array.isArray(data.threads));
  });

  it("POST /api/orchestrator/message runs the local Orchestrator", async () => {
    const res = await routeRequest("POST", "/api/orchestrator/message", JSON.stringify({ request: "Build me a tax specialist agent" }), { cwd: dir });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body) as { classification: { classification: string }; blockedActions: string[] };
    assert.ok(data.classification.classification);
    assert.ok(data.blockedActions.includes("execute_provider_mutation"));
  });

  it("POST rejects an empty request", async () => {
    const res = await routeRequest("POST", "/api/orchestrator/message", JSON.stringify({ request: "" }), { cwd: dir });
    assert.equal(res.status, 400);
    assert.ok((JSON.parse(res.body) as { error: string }).error);
  });

  it("POST rejects an oversized request", async () => {
    const big = "a".repeat(MAX_REQUEST_LENGTH + 1);
    const res = await routeRequest("POST", "/api/orchestrator/message", JSON.stringify({ request: big }), { cwd: dir });
    assert.equal(res.status, 400);
  });

  it("POST rejects a secret-looking request", async () => {
    const secret = "token sk-" + "a".repeat(32);
    const res = await routeRequest("POST", "/api/orchestrator/message", JSON.stringify({ request: secret }), { cwd: dir });
    assert.equal(res.status, 400);
  });

  it("POST rejects invalid JSON", async () => {
    const res = await routeRequest("POST", "/api/orchestrator/message", "{not json", { cwd: dir });
    assert.equal(res.status, 400);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await routeRequest("GET", "/nope", null, { cwd: dir });
    assert.equal(res.status, 404);
  });
});
