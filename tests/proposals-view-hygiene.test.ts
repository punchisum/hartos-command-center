/**
 * tests/proposals-view-hygiene.test.ts
 *
 * "Make HartOS Better" sprint — the read-only proposal-queue view now derives:
 *   - decision reasoning (effect / whyApprove / whyReject) per pending proposal
 *   - view-only hygiene flags (duplicate, staleExpired) mirroring the explicit-command
 *     dedup/expiry rules WITHOUT writing (the Worker holds no DB key).
 *
 * Hermetic: hand-built CockpitState, literal `now`, no env/network/fs/clock. Proves the
 * view surfaces reasoning, flags duplicates (keeps newest) and past-expiry proposals, and
 * counts them — without mutating the queue.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proposalsView } from "../src/runtime/cloudflare-cockpit-views.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-09T12:00:00.000Z";

function item(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  const base: ProposalQueueItem = {
    id: "p1",
    domain: "ops",
    actionType: "review_plan",
    title: "Refresh the ClickUp import",
    description: "Draft a refresh plan for stale ops data.",
    sourceIntent: "freshness",
    proposedPayload: {},
    expectedEffect: "Ops data would be refreshed from the latest ClickUp import.",
    riskLevel: "low",
    requiredApproval: "Hart",
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "execution is gated off-Worker",
    dryRunResult: null,
    executable: false,
    createdAt: NOW,
    status: "pending_approval",
    updatedAt: NOW,
    auditEvents: [],
  };
  return { ...base, ...over };
}

function stateWith(proposalQueue: ProposalQueueItem[] | undefined): CockpitState | undefined {
  if (proposalQueue === undefined) return undefined;
  return { generatedAt: NOW, proposalQueue } as unknown as CockpitState;
}

describe("proposalsView — decision reasoning", () => {
  it("surfaces effect + whyApprove + whyReject for a pending proposal", () => {
    const view = proposalsView(stateWith([item()]), NOW);
    assert.equal(view.available, true);
    assert.equal(view.total, 1);
    assert.equal(view.pending, 1);
    const p = view.proposals[0]!;
    assert.match(p.effect, /refreshed from the latest ClickUp import/i);
    assert.match(p.whyApprove, /Dry-run only/i);
    assert.match(p.whyApprove, /nothing executes now/i);
    assert.match(p.whyReject, /Reject if/i);
  });

  it("high-risk proposals carry a confirm-target reject reason", () => {
    const view = proposalsView(stateWith([item({ riskLevel: "high" })]), NOW);
    assert.match(view.proposals[0]!.whyReject, /high risk/i);
  });
});

describe("proposalsView — view-only hygiene (no write)", () => {
  it("flags duplicates (same domain|actionType|title), keeps newest, counts the rest", () => {
    // Queue is newest-first; the first occurrence is kept, later ones flagged duplicate.
    const newest = item({ id: "p-new", createdAt: "2026-06-09T11:00:00.000Z" });
    const older = item({ id: "p-old", createdAt: "2026-06-08T11:00:00.000Z" });
    const view = proposalsView(stateWith([newest, older]), NOW);
    assert.equal(view.duplicates, 1);
    const byId = new Map(view.proposals.map((p) => [p.id, p]));
    assert.equal(byId.get("p-new")!.duplicate, false, "newest is kept");
    assert.equal(byId.get("p-old")!.duplicate, true, "older duplicate flagged");
  });

  it("flags past-expiry pending proposals and counts them", () => {
    const expired = item({ id: "p-exp", expiresAt: "2026-06-08T00:00:00.000Z" });
    const live = item({ id: "p-live", title: "A different proposal", expiresAt: "2026-06-10T00:00:00.000Z" });
    const view = proposalsView(stateWith([expired, live]), NOW);
    assert.equal(view.staleExpired, 1);
    const byId = new Map(view.proposals.map((p) => [p.id, p]));
    assert.equal(byId.get("p-exp")!.staleExpired, true);
    assert.equal(byId.get("p-live")!.staleExpired, false);
  });

  it("does NOT flag resolved (rejected/expired) proposals as duplicates", () => {
    // Only active (draft/pending) proposals participate in dedup — a rejected twin is ignored.
    const active = item({ id: "p-a" });
    const rejectedTwin = item({ id: "p-r", status: "rejected" });
    const view = proposalsView(stateWith([active, rejectedTwin]), NOW);
    assert.equal(view.duplicates, 0);
  });

  it("absent queue → available:false, zero counts, honest note", () => {
    const view = proposalsView(undefined, NOW);
    assert.equal(view.available, false);
    assert.equal(view.duplicates, 0);
    assert.equal(view.staleExpired, 0);
    assert.match(view.note, /local-only/i);
  });
});
