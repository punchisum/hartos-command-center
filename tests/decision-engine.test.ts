/**
 * tests/decision-engine.test.ts — Human OS Doctrine §4/§6.
 *
 * Locks the decision engine's safety properties:
 *   - No dead ends: every input resolves to exactly one of the seven terminals.
 *   - Tier 0 for reads: read-only questions/tasks are "auto" and auto-executable now.
 *   - Deterministic floor: external / financial / irreversible / legal ACTIONS are pinned
 *     to a high tier the classifier cannot lower, and never auto-run.
 *   - The floor does NOT over-gate reads (summarising a contract is still Tier 0).
 *   - Default-up: an ambiguous non-read request never sits at Tier 0.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decide,
  classifyAutonomyTier,
  AUTONOMY_TIER_NUMBER,
  type ConciergeTerminal,
} from "../src/cockpit/decision-engine.js";
import { routeCockpitCommand } from "../src/cockpit/command-router.js";

const TERMINALS: ReadonlySet<ConciergeTerminal> = new Set([
  "direct_answer",
  "action_executed",
  "action_proposed",
  "research_proposed",
  "build_proposed",
  "clarification",
  "safe_refusal",
]);

describe("decision-engine — no dead ends", () => {
  const battery = [
    "what's important today?",
    "show me my agents",
    "summarize the vendor contract",
    "comment on the ops card waiting for updates",
    "create a tax agent",
    "research companies likely to sell their business",
    "delete the production database",
    "wire money to the vendor",
    "send an email to the client about the invoice",
    "sign the contract with the supplier",
    "asdf qwer zxcv",
    "",
  ];

  for (const input of battery) {
    it(`resolves "${input || "(empty)"}" to exactly one terminal`, () => {
      const d = decide(input);
      assert.ok(TERMINALS.has(d.terminal), `terminal ${d.terminal} is one of the seven`);
      assert.equal(typeof d.interpretation, "string");
      assert.ok(d.interpretation.length > 0, "always a human interpretation (never empty)");
      assert.ok(d.recommendedNextAction.length > 0, "always a recommended next action (no dead end)");
    });
  }
});

describe("decision-engine — Tier 0 reads are automatic", () => {
  it("a read-only question is Tier 0 / auto-executable, requires no approval", () => {
    const d = decide("what's degrading in the system?");
    assert.equal(d.autonomy.tier, "auto");
    assert.equal(d.autonomy.tierNumber, 0);
    assert.equal(d.autoExecutableNow, true);
    assert.equal(d.requiresHumanApproval, false);
    assert.ok(d.terminal === "direct_answer" || d.terminal === "action_executed");
  });

  it("a read imperative is done now (action_executed), nothing changed", () => {
    const d = decide("summarize what the ops agent is seeing");
    assert.equal(d.autonomy.tier, "auto");
    assert.equal(d.autoExecutableNow, true);
  });
});

describe("decision-engine — deterministic floor (cannot be lowered, never auto-runs)", () => {
  it("delete production → Tier 3 explicit, human approval, not auto", () => {
    const d = decide("delete the production database now");
    assert.equal(d.autonomy.tier, "explicit");
    assert.equal(d.autonomy.floorApplied, true);
    assert.equal(d.autoExecutableNow, false);
    assert.equal(d.requiresHumanApproval, true);
  });

  it("move money → at least Tier 3 explicit", () => {
    const d = decide("wire money to the vendor");
    assert.ok(AUTONOMY_TIER_NUMBER[d.autonomy.tier] >= AUTONOMY_TIER_NUMBER.explicit);
    assert.equal(d.autoExecutableNow, false);
  });

  it("external client comms → at least Tier 3 explicit", () => {
    const d = decide("send an email to the client about the invoice");
    assert.ok(AUTONOMY_TIER_NUMBER[d.autonomy.tier] >= AUTONOMY_TIER_NUMBER.explicit);
    assert.equal(d.autoExecutableNow, false);
  });

  it("signing a contract → Tier 4 human only", () => {
    const d = decide("sign the contract with the supplier");
    assert.equal(d.autonomy.tier, "human_only");
    assert.equal(d.autonomy.tierNumber, 4);
    assert.equal(d.autoExecutableNow, false);
  });
});

describe("decision-engine — the floor does not over-gate reads", () => {
  it("summarising a contract is still Tier 0 (reading about money/legal is not an action)", () => {
    const d = decide("summarize the vendor contract and our payment terms");
    assert.equal(d.autonomy.tier, "auto");
    assert.equal(d.autonomy.floorApplied, false);
    assert.equal(d.autoExecutableNow, true);
  });
});

describe("decision-engine — Tier 1 internal mutation (would auto-run once enabled)", () => {
  it("commenting/moving an internal ops card is Tier 1 trusted, gated until the amendment", () => {
    const d = decide("comment on the ops card: waiting for updates");
    assert.equal(d.autonomy.tier, "trusted");
    assert.equal(d.wouldAutoRunWhenTier1Enabled, true);
    // Honest today: auto-execution is still disabled, so it waits for one click.
    assert.equal(d.autoExecutableNow, false);
    assert.equal(d.requiresHumanApproval, true);
  });
});

describe("decision-engine — proposals route to the right terminal", () => {
  it("create-agent → build_proposed", () => {
    const d = decide("create a tax agent");
    assert.equal(d.terminal, "build_proposed");
    assert.ok(d.proposal !== null);
  });

  it("research request → research_proposed with a self-improvement opportunity", () => {
    const d = decide("research companies likely to sell their business");
    assert.equal(d.terminal, "research_proposed");
    assert.ok(d.opportunities.length > 0);
  });
});

describe("decision-engine — self-improvement (Doctrine §7) instead of dead-end", () => {
  it("an actionable ask with no capability → research proposal, not a refusal", () => {
    const d = decide("find companies likely to sell their business");
    assert.equal(d.terminal, "research_proposed");
    assert.ok(d.proposal !== null);
    assert.ok(d.capabilityGaps.length > 0, "names the missing capability");
    assert.ok(d.opportunities.some((o) => /Beezulbub|self-improvement/i.test(o)), "offers an acquisition path");
    assert.match(d.recommendedNextAction, /research mission|Beezulbub/i);
  });

  it("an actionable build ask with no matching agent → build proposal", () => {
    const d = decide("automate a workflow that tracks competitor pricing");
    assert.equal(d.terminal, "build_proposed");
    assert.ok(d.proposal !== null);
  });
});

describe("decision-engine — unknown intent stays honest", () => {
  it("gibberish (not a question) → safe refusal with a capability gap + acquisition path", () => {
    const d = decide("asdf qwer zxcv");
    assert.equal(d.terminal, "safe_refusal");
    assert.ok(d.capabilityGaps.length > 0);
    assert.ok(d.opportunities.length > 0);
  });
});

describe("decision-engine — classifyAutonomyTier is pure and floor-raises only", () => {
  it("never lowers below the routing base; floor only raises", () => {
    const routing = routeCockpitCommand("delete the production database");
    const c = classifyAutonomyTier(routing, "delete the production database");
    assert.ok(AUTONOMY_TIER_NUMBER[c.tier] >= AUTONOMY_TIER_NUMBER.explicit);
    assert.ok(c.rationale.length >= 1);
  });
});
