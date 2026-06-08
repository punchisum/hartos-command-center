/**
 * tests/cockpit-suggestions-persist.test.ts
 *
 * POST /api/suggestions/persist — the gated "queue these for approval" route. It
 * synthesizes the cross-system suggestions and writes them to the spine as DRAFTS,
 * but STATUS-SAFELY: any suggestion whose stable id already exists in the queue (any
 * status) is skipped, so it can never overwrite a proposal Hart already decided.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";
import { stableProposalId } from "../src/cockpit/proposals/cockpit-proposal-spine.js";
import type { ActionProposal } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-08T12:00:00.000Z";
const env = {};

// A read-model summary 7+ days old → "dead" age → the agent reads stale → a perception
// warning → exactly one suggestion: "Refresh the Ops agent's data."
function staleOpsState(proposalQueue: unknown[] = []): unknown {
  return {
    generatedAt: NOW,
    readModels: {
      configPresent: true, configuredReadModels: 1, enabledReadModels: 1,
      summaries: [{ id: "ops", type: "ops", status: "ok", confidence: "high", lines: [], metrics: {}, recommendation: "read-only", dataFreshness: "2026-06-01", degradedSources: [] }],
    },
    proposalQueue,
  };
}
async function persist(state: unknown, provider?: (p: ActionProposal[], i: string) => Promise<{ attempted: boolean; persisted: number; failed: number; reason: string }>) {
  const ctx: Record<string, unknown> = { runtimeMode: "hosted", now: NOW, state };
  if (provider) ctx.proposalWriteProvider = provider;
  const res = await handleCockpitRequest(new Request("https://c/api/suggestions/persist", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), env, ctx);
  return { res, body: (await res.json()) as { ok: boolean; candidates: number; queued: number; alreadyQueued: number; attempted: boolean } };
}

describe("POST /api/suggestions/persist (status-safe)", () => {
  it("persists fresh suggestions as drafts via the gated writer", async () => {
    const captured: ActionProposal[] = [];
    const { res, body } = await persist(staleOpsState([]), async (proposals) => { captured.push(...proposals); return { attempted: true, persisted: proposals.length, failed: 0, reason: "ok" }; });
    assert.equal(res.status, 200);
    assert.ok(body.candidates >= 1, "synthesized at least one suggestion");
    assert.ok(body.queued >= 1, "queued the fresh draft(s)");
    assert.ok(captured.length >= 1, "the writer was called with proposal drafts");
    assert.ok(captured.every((p) => p.status === "draft" && p.executable === false), "drafts only, never executable");
  });

  it("never re-queues / clobbers proposals already decided in the queue", async () => {
    // Round-trip: capture what a first pass would queue, put those in the queue as
    // REJECTED, then persist again. The guarantee: nothing re-queued, writer never
    // called — so a decided proposal's status can never be overwritten.
    const captured: ActionProposal[] = [];
    await persist(staleOpsState([]), async (proposals) => { captured.push(...proposals); return { attempted: true, persisted: proposals.length, failed: 0, reason: "ok" }; });
    assert.ok(captured.length >= 1, "first pass produced drafts");
    const queue = captured.map((p) => ({ id: stableProposalId(p.domain, p.actionType, p.title), status: "rejected", title: p.title, domain: p.domain, actionType: p.actionType }));
    let called = false;
    const { body } = await persist(staleOpsState(queue), async (proposals) => { called = true; return { attempted: true, persisted: proposals.length, failed: 0, reason: "ok" }; });
    assert.equal(body.queued, 0, "nothing re-queued");
    assert.equal(called, false, "the writer is NOT called for already-decided suggestions — no status clobber");
  });

  it("is honest when the write endpoint isn't configured (advisory-only)", async () => {
    const { res, body } = await persist(staleOpsState([])); // no provider
    assert.equal(res.status, 200);
    assert.equal(body.queued, 0);
    assert.equal(body.attempted, false);
  });
});
