/**
 * tests/suggestion-to-mutation.test.ts
 *
 * The PURE mapping that closes command→propose→(approve)→mutate: a `SuggestedAction`
 * becomes either a FIREABLE typed mutation proposal (tier-complete, names its dispatcher
 * adapter, non-executable) or `null` (advisory — the honest default). These tests are
 * hermetic: pure inputs, no I/O, an injected `now`, and the real `assertTierPayloadComplete`
 * + `makeIdempotencyKey` so the produced proposals are checked against the actual gates.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  suggestionToMutationProposal,
  readMutationRoute,
  ADAPTER_ROUTE_KEY,
} from "../src/cockpit/suggestions/suggestion-to-mutation.js";
import type { SuggestedAction } from "../src/cockpit/suggestions/suggest-actions.js";
import { assertTierPayloadComplete } from "../src/cockpit/proposals/proposal-tiering.js";

const NOW = "2026-06-09T12:00:00.000Z";

/** A reject-drafts-shaped internal queue cleanup suggestion. */
const REJECT_DRAFTS: SuggestedAction = {
  id: "sg-perception-reject-the-aging-draft-proposals",
  domain: "system",
  actionType: "sync_repair_plan",
  title: "Reject the aging draft proposals to keep the queue honest",
  rationale: "12 draft proposals have aged past review and are cluttering the queue.",
  source: "perception",
  priority: "high",
};

/** An archive-rejected-shaped internal queue cleanup suggestion. */
const ARCHIVE_REJECTED: SuggestedAction = {
  id: "sg-perception-archive-the-rejected-proposals",
  domain: "system",
  actionType: "sync_repair_plan",
  title: "Archive the rejected proposals out of the active queue",
  rationale: "Rejected proposals remain in the active view and obscure the live work.",
  source: "perception",
  priority: "medium",
};

/** An advisory-only suggestion: build an agent — no runnable dispatcher adapter. */
const ADVISORY_BUILD: SuggestedAction = {
  id: "sg-orchestrator-build-an-agent-for-repair-work",
  domain: "system",
  actionType: "build_agent_plan",
  title: 'Build an agent for "repair" work',
  rationale: "A capability gap was deferred by the fleet orchestrator.",
  source: "orchestrator",
  priority: "high",
};

/** An ops ClickUp-shaped suggestion (needs a confirmed target to become runnable). */
const CLICKUP_COMMENT: SuggestedAction = {
  id: "sg-triage-comment-on-the-blocked-clickup-card",
  domain: "ops",
  actionType: "ops_followup_plan",
  title: "Comment on the blocked ClickUp card to unblock it",
  rationale: "The card has been blocked for 6 days with no update.",
  source: "triage",
  priority: "high",
};

const CLICKUP_TARGET = {
  cardId: "abc123",
  cardName: "Ship the Q3 report",
  currentStatus: "blocked",
  commentText: "Following up — what is blocking this? Please post an update.",
};

describe("suggestionToMutationProposal — runnable internal cleanups → tier-complete T0", () => {
  it("maps a reject-drafts suggestion to a tier-complete, non-executable T0 proposal naming reject-drafts", () => {
    const proposal = suggestionToMutationProposal(REJECT_DRAFTS, { now: NOW });
    assert.ok(proposal, "should produce a proposal");

    // Passes the real tier-payload gate for its declared tier.
    const gate = assertTierPayloadComplete(proposal);
    assert.equal(gate.allowed, true, gate.denials.join("; "));
    assert.equal(proposal.tier, "T0");

    // Names the right dispatcher adapter, read back type-safely.
    const route = readMutationRoute(proposal);
    assert.ok(route, "carries a mutation route");
    assert.equal(route.adapterId, "reject-drafts");
    assert.equal(route.tier, "T0");

    // Doctrine: non-executable + approval floor.
    assert.equal(proposal.executable, false);
    assert.equal(proposal.requiredApproval, "Hart");
    assert.equal(proposal.status, "draft");
    assert.equal(proposal.createdAt, NOW);
  });

  it("maps an archive-rejected suggestion to a tier-complete T0 proposal naming archive-rejected", () => {
    const proposal = suggestionToMutationProposal(ARCHIVE_REJECTED, { now: NOW });
    assert.ok(proposal);
    assert.equal(assertTierPayloadComplete(proposal).allowed, true);
    assert.equal(proposal.tier, "T0");
    assert.equal(readMutationRoute(proposal)?.adapterId, "archive-rejected");
    assert.equal(proposal.executable, false);
    assert.equal(proposal.requiredApproval, "Hart");
  });
});

describe("suggestionToMutationProposal — advisory suggestions → null", () => {
  it("returns null for an advisory build-agent suggestion (no runnable adapter)", () => {
    assert.equal(suggestionToMutationProposal(ADVISORY_BUILD, { now: NOW }), null);
  });

  it("returns null for a ClickUp action when NO confirmed card target is supplied (conservative)", () => {
    assert.equal(suggestionToMutationProposal(CLICKUP_COMMENT, { now: NOW }), null);
  });

  it("returns null for a system suggestion that is not a recognized queue cleanup", () => {
    const refreshOps: SuggestedAction = {
      id: "sg-forecast-refresh-ops",
      domain: "ops",
      actionType: "sync_repair_plan",
      title: "Refresh ops before acting on its numbers",
      rationale: "Ops data is stale.",
      source: "forecast",
      priority: "high",
    };
    assert.equal(suggestionToMutationProposal(refreshOps, { now: NOW }), null);
  });
});

describe("suggestionToMutationProposal — idempotency key is built from trusted fields", () => {
  it("does not throw (trusted ids/enums only — never free text) and is stable across calls", () => {
    // If free text (the title/rationale) had been fed to makeIdempotencyKey it would throw on
    // the natural-language pattern; producing a proposal at all proves trusted parts were used.
    const a = suggestionToMutationProposal(REJECT_DRAFTS, { now: NOW });
    const b = suggestionToMutationProposal(REJECT_DRAFTS, { now: NOW });
    assert.ok(a && b);
    assert.ok(a.idempotencyKey && a.idempotencyKey.length > 0);
    assert.equal(a.idempotencyKey, b.idempotencyKey, "stable across two calls with the same input");
    // The key must not contain the free-text title.
    assert.ok(!a.idempotencyKey.includes("aging"), "key carries no free-text title fragment");
  });

  it("the same-day idempotency key is independent of the suggestion's free-text rationale", () => {
    const sameButDifferentText: SuggestedAction = { ...REJECT_DRAFTS, rationale: "totally different prose here" };
    const a = suggestionToMutationProposal(REJECT_DRAFTS, { now: NOW })!;
    const b = suggestionToMutationProposal(sameButDifferentText, { now: NOW })!;
    assert.equal(a.idempotencyKey, b.idempotencyKey, "key derives from trusted id/enum/date only");
  });
});

describe("suggestionToMutationProposal — deterministic", () => {
  it("same suggestion + same opts → deep-equal proposal", () => {
    const a = suggestionToMutationProposal(REJECT_DRAFTS, { now: NOW });
    const b = suggestionToMutationProposal(REJECT_DRAFTS, { now: NOW });
    assert.deepEqual(a, b);
  });
});

describe("suggestionToMutationProposal — T3 ClickUp mapping with a confirmed target", () => {
  it("maps an ops ClickUp suggestion + confirmed card → a full T3 proposal", () => {
    const proposal = suggestionToMutationProposal(CLICKUP_COMMENT, { now: NOW, clickUpTarget: CLICKUP_TARGET });
    assert.ok(proposal, "should produce a proposal");

    // Passes the real T3 gate: before+after+idempotency+dryRun+approval+correction note.
    const gate = assertTierPayloadComplete(proposal);
    assert.equal(gate.allowed, true, gate.denials.join("; "));
    assert.equal(proposal.tier, "T3");

    // Full T3 payload present.
    assert.equal(proposal.targetId, CLICKUP_TARGET.cardId);
    assert.equal(proposal.targetName, CLICKUP_TARGET.cardName);
    assert.ok(proposal.beforeState && Object.keys(proposal.beforeState).length > 0, "before state");
    assert.ok(proposal.afterState && Object.keys(proposal.afterState).length > 0, "after state");
    assert.ok(proposal.idempotencyKey && proposal.idempotencyKey.length > 0, "idempotency key");
    assert.ok(proposal.dryRunResult && proposal.dryRunResult.executed === false, "dry-run, nothing executed");
    assert.ok(proposal.rollbackOrCorrectionNote && proposal.rollbackOrCorrectionNote.length > 0, "correction note");

    // Names the clickup-comment adapter; carries the comment text as payload (not in the key).
    const route = readMutationRoute(proposal);
    assert.equal(route?.adapterId, "clickup-comment");
    assert.equal(route?.tier, "T3");
    assert.equal(proposal.proposedPayload.commentText, CLICKUP_TARGET.commentText);
    assert.ok(!proposal.idempotencyKey.includes("Following up"), "comment text is NOT in the idempotency key");

    // Doctrine: non-executable.
    assert.equal(proposal.executable, false);
    assert.equal(proposal.requiredApproval, "Hart");
  });

  it("the T3 mapping is deterministic with a confirmed target", () => {
    const opts = { now: NOW, clickUpTarget: CLICKUP_TARGET };
    assert.deepEqual(
      suggestionToMutationProposal(CLICKUP_COMMENT, opts),
      suggestionToMutationProposal(CLICKUP_COMMENT, opts),
    );
  });
});

describe("suggestionToMutationProposal — route key contract", () => {
  it("carries the adapter id under the documented proposedPayload route key", () => {
    const proposal = suggestionToMutationProposal(REJECT_DRAFTS, { now: NOW })!;
    assert.ok(proposal.proposedPayload[ADAPTER_ROUTE_KEY], "route metadata is on proposedPayload");
  });
});
