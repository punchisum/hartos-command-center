/**
 * tests/council-proposal.test.ts
 *
 * Task 2.2 — TDD tests for createCouncilProposal adapter.
 * Pure builder tests — no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCouncilProposal, type CouncilProposalStore } from "../src/council/council-proposal.js";
import type { CouncilProposalPayload } from "../src/council/council-types.js";

function makePayload(over: Partial<CouncilProposalPayload> = {}): CouncilProposalPayload {
  return {
    rootGoal: "build a SaaS CRM",
    recommendation: "Feasible with medium confidence — proceed to prototype",
    confidence: "medium",
    tree: {
      goal: { goal: "build a SaaS CRM" },
      panel: ["cto", "financial"],
      findings: [
        { specialistId: "cto", lens: "cto", summary: "architecture ok", confidence: "high", risks: [], degraded: false },
        { specialistId: "financial", lens: "financial", summary: "burn ok", confidence: "medium", risks: [], degraded: false },
      ],
      synthesis: {
        recommendation: "Feasible with medium confidence — proceed to prototype",
        confidence: "medium",
        consensus: ["cto: architecture ok", "financial: burn ok"],
        dissent: [],
        truncated: false,
        notes: [],
      },
      children: [],
      depth: 1,
    },
    llmCallsUsed: 2,
    ...over,
  };
}

/** Fake store that captures the upserted item. */
function fakeStore(): { store: CouncilProposalStore; items: unknown[] } {
  const items: unknown[] = [];
  return {
    store: { upsert: async (item) => { items.push(item); } },
    items,
  };
}

describe("createCouncilProposal (Task 2.2)", () => {
  it("returns a deterministic proposal id", async () => {
    const { store, items } = fakeStore();
    const now = new Date("2026-06-14T10:00:00.000Z");
    const id = await createCouncilProposal(store, makePayload(), now);
    assert.ok(id.startsWith("prop-council-"), `id should start with prop-council-, got: ${id}`);
    assert.equal(items.length, 1, "should upsert exactly one item");
  });

  it("same now → same id (deterministic)", async () => {
    const { store } = fakeStore();
    const now = new Date("2026-06-14T10:00:00.000Z");
    const id1 = await createCouncilProposal(store, makePayload(), now);
    const { store: store2 } = fakeStore();
    const id2 = await createCouncilProposal(store2, makePayload(), now);
    assert.equal(id1, id2);
  });

  it("different now → different id", async () => {
    const { store } = fakeStore();
    const id1 = await createCouncilProposal(store, makePayload(), new Date("2026-06-14T10:00:00.000Z"));
    const { store: store2 } = fakeStore();
    const id2 = await createCouncilProposal(store2, makePayload(), new Date("2026-06-14T11:00:00.000Z"));
    assert.notEqual(id1, id2);
  });

  it("upserted item has domain=council, actionType=council_plan", async () => {
    const { store, items } = fakeStore();
    await createCouncilProposal(store, makePayload(), new Date());
    const item = items[0] as Record<string, unknown>;
    assert.equal(item["domain"], "council");
    assert.equal(item["actionType"], "council_plan");
  });

  it("upserted item has status=pending_approval and executable=false", async () => {
    const { store, items } = fakeStore();
    await createCouncilProposal(store, makePayload(), new Date());
    const item = items[0] as Record<string, unknown>;
    assert.equal(item["status"], "pending_approval");
    assert.equal(item["executable"], false);
  });

  it("upserted item has tier=T3", async () => {
    const { store, items } = fakeStore();
    await createCouncilProposal(store, makePayload(), new Date());
    const item = items[0] as Record<string, unknown>;
    assert.equal(item["tier"], "T3");
  });

  it("title contains the recommendation (truncated to ≤120 chars)", async () => {
    const { store, items } = fakeStore();
    const longRec = "A".repeat(200);
    await createCouncilProposal(store, makePayload({ recommendation: longRec }), new Date());
    const item = items[0] as Record<string, unknown>;
    const title = item["title"] as string;
    assert.ok(title.length <= 200, "title is bounded");
    assert.ok(title.includes("Council:"), "title starts with Council:");
  });

  it("proposedPayload carries the full council tree", async () => {
    const { store, items } = fakeStore();
    const payload = makePayload();
    await createCouncilProposal(store, payload, new Date());
    const item = items[0] as Record<string, unknown>;
    const proposed = item["proposedPayload"] as Record<string, unknown>;
    assert.ok(proposed, "proposedPayload must exist");
    assert.deepEqual(proposed["tree"], payload.tree);
    assert.equal(proposed["rootGoal"], payload.rootGoal);
    assert.equal(proposed["confidence"], payload.confidence);
  });

  it("requiredApproval is Hart", async () => {
    const { store, items } = fakeStore();
    await createCouncilProposal(store, makePayload(), new Date());
    const item = items[0] as Record<string, unknown>;
    assert.equal(item["requiredApproval"], "Hart");
  });

  it("id contains no colons or dots (DB/filename safe)", async () => {
    const { store, items } = fakeStore();
    await createCouncilProposal(store, makePayload(), new Date("2026-06-14T10:00:00.123Z"));
    const item = items[0] as Record<string, unknown>;
    const id = item["id"] as string;
    assert.ok(!id.includes(":") && !id.includes("."), `id must be colon/dot free: ${id}`);
  });

  it("auditEvents contains a 'created' event", async () => {
    const { store, items } = fakeStore();
    await createCouncilProposal(store, makePayload(), new Date());
    const item = items[0] as Record<string, unknown>;
    const events = item["auditEvents"] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(events) && events.length >= 1, "auditEvents must be non-empty");
    assert.equal(events[0]?.["event"], "created");
  });
});
