/**
 * tests/council-route.test.ts — Task 3.3 tests for GET /api/council.
 *
 * Asserts:
 *   1. SUPPORTED_ROUTES includes "GET /api/council"
 *   2. GET /api/council returns 200 with { ok, proposals } shape
 *   3. Returns empty proposals when no live state is wired
 *   4. Returns only council-domain proposals from the queue
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleCockpitRequest, createCockpitWorkerContext, SUPPORTED_ROUTES } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const BASE = "https://cockpit.local";
const NOW = "2026-06-14T10:00:00.000Z";

function makeCouncilProposal(id: string): ProposalQueueItem {
  return {
    id,
    domain: "council",
    actionType: "council_plan",
    title: `Council Run ${id}`,
    description: "Council deliberation.",
    sourceIntent: "Council run",
    proposedPayload: {
      rootGoal: "Evaluate CRM",
      recommendation: "Build it.",
      confidence: "high",
      llmCallsUsed: 3,
      tree: {
        goal: { goal: "Evaluate CRM" },
        panel: ["cto"],
        findings: [],
        synthesis: { recommendation: "Build it.", confidence: "high", consensus: [], dissent: [], truncated: false, notes: [] },
        children: [],
        depth: 1,
      },
    },
    expectedEffect: "Council surfaced.",
    riskLevel: "medium",
    requiredApproval: "Hart",
    status: "pending_approval",
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "Action execution disabled.",
    dryRunResult: null,
    executable: false,
    auditEvents: [],
  };
}

describe("GET /api/council route", () => {
  let dir: string;
  let ctx: CockpitWorkerContext;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cf-council-"));
    ctx = await createCockpitWorkerContext({ cwd: dir });
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it('SUPPORTED_ROUTES includes "GET /api/council"', () => {
    assert.ok(SUPPORTED_ROUTES.includes("GET /api/council"));
  });

  it("returns 200 with { ok: true, proposals: [] } when no state is wired", async () => {
    const res = await handleCockpitRequest(
      new Request(`${BASE}/api/council`),
      {},
      ctx, // base ctx has no proposalQueue → safe empty
    );
    assert.equal(res.status, 200);
    const data = await res.json() as { ok: boolean; proposals: unknown[] };
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.proposals));
  });

  it("returns only council-domain proposals from the queue", async () => {
    const councilP = makeCouncilProposal("cp-1");
    const fitnessP: ProposalQueueItem = {
      ...makeCouncilProposal("fp-1"),
      domain: "fitness",
      actionType: "fitness_adjustment_plan",
    };

    const stateCtx: CockpitWorkerContext = {
      ...ctx,
      state: {
        ...ctx.state!,
        proposalQueue: [councilP, fitnessP],
      },
    };

    const res = await handleCockpitRequest(
      new Request(`${BASE}/api/council`),
      {},
      stateCtx,
    );
    assert.equal(res.status, 200);
    const data = await res.json() as { ok: boolean; proposals: Array<{ id: string; domain: string }> };
    assert.equal(data.ok, true);
    assert.equal(data.proposals.length, 1);
    assert.equal(data.proposals[0]!.id, "cp-1");
    assert.equal(data.proposals[0]!.domain, "council");
  });

  it("returns all council proposals when multiple are queued", async () => {
    const stateCtx: CockpitWorkerContext = {
      ...ctx,
      state: {
        ...ctx.state!,
        proposalQueue: [
          makeCouncilProposal("cp-1"),
          makeCouncilProposal("cp-2"),
          makeCouncilProposal("cp-3"),
        ],
      },
    };
    const res = await handleCockpitRequest(
      new Request(`${BASE}/api/council`),
      {},
      stateCtx,
    );
    const data = await res.json() as { ok: boolean; proposals: unknown[] };
    assert.equal(data.ok, true);
    assert.equal(data.proposals.length, 3);
  });
});
