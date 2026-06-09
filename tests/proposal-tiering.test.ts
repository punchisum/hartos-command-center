/**
 * tests/proposal-tiering.test.ts
 *
 * Mutation Tiering foundation (master plan §10 + §11). The tier-payload check is
 * assertion-only: each tier accepts a complete payload, denies an incomplete one with
 * the missing fields NAMED, and never opens an execution path. Doctrine stays intact —
 * `executeProposal()` still throws and the single execution gate is untouched.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_PAYLOAD_BY_TIER,
  assertTierPayloadComplete,
} from "../src/cockpit/proposals/proposal-tiering.js";
import type { ProposalTier, TypedActionProposal } from "../src/cockpit/proposals/proposal-types.js";
import { executeProposal, ActionExecutionDisabledError } from "../src/cockpit/proposals/index.js";
import { makeIdempotencyKey } from "../src/lib/idempotency-key.js";

const ALL_TIERS: ProposalTier[] = ["T0", "T1", "T2", "T3", "T4"];

const DRY_RUN: TypedActionProposal["dryRunResult"] = {
  wouldHappen: "would archive proposal prop_1",
  dataWouldTouch: ["cockpit_proposals/prop_1"],
  approvalRequired: "Hart",
  executionDisabledReason: "execution path disabled by doctrine",
  futureSetupRequired: ["capability token", "audit entry"],
  executed: false,
};

/** A proposal carrying EVERY tiering field — a superset complete for all tiers. */
function fullProposal(tier: ProposalTier): TypedActionProposal {
  return {
    id: "prop_1",
    domain: "system",
    actionType: "sync_repair_plan",
    title: "Tiered mutation",
    description: "test",
    sourceIntent: "test",
    proposedPayload: {},
    expectedEffect: "test",
    riskLevel: "low",
    requiredApproval: "Hart",
    status: "draft",
    createdAt: "2026-06-09T00:00:00.000Z",
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "execution disabled",
    dryRunResult: DRY_RUN,
    executable: false,
    tier,
    targetId: "target_42",
    targetName: "Proposal prop_1",
    beforeState: { status: "rejected" },
    afterState: { status: "archived" },
    idempotencyKey: makeIdempotencyKey(["archive", "prop_1", "2026-06-09"]),
    rollbackOrCorrectionNote: "restore status to rejected",
  };
}

describe("REQUIRED_PAYLOAD_BY_TIER — table shape (master plan §10)", () => {
  it("declares a required-field list for every tier T0..T4", () => {
    for (const tier of ALL_TIERS) {
      assert.ok(Array.isArray(REQUIRED_PAYLOAD_BY_TIER[tier]), `${tier} must have a list`);
    }
  });

  it("requires the approval floor (requiredApproval) on EVERY tier — doctrine never optional", () => {
    for (const tier of ALL_TIERS) {
      assert.ok(
        REQUIRED_PAYLOAD_BY_TIER[tier].includes("requiredApproval"),
        `${tier} must require the approval floor`
      );
    }
  });

  it("T4 alone requires an explicit human gate", () => {
    assert.ok(REQUIRED_PAYLOAD_BY_TIER.T4.includes("explicitHumanGate"));
    for (const tier of ["T0", "T1", "T2", "T3"] as ProposalTier[]) {
      assert.ok(!REQUIRED_PAYLOAD_BY_TIER[tier].includes("explicitHumanGate"), `${tier} must NOT require explicitHumanGate`);
    }
  });

  it("T3/T4 require the full external payload (before+after+idempotency+dryRun+correction note)", () => {
    for (const tier of ["T3", "T4"] as ProposalTier[]) {
      for (const field of ["beforeState", "afterState", "idempotencyKey", "dryRunResult", "rollbackOrCorrectionNote"]) {
        assert.ok(REQUIRED_PAYLOAD_BY_TIER[tier].includes(field), `${tier} must require ${field}`);
      }
    }
  });

  it("T2 requires read-before-write (beforeState)", () => {
    assert.ok(REQUIRED_PAYLOAD_BY_TIER.T2.includes("beforeState"));
  });
});

describe("assertTierPayloadComplete — accepts a complete payload per tier", () => {
  for (const tier of ALL_TIERS) {
    it(`${tier} accepts a complete payload`, () => {
      const result = assertTierPayloadComplete(fullProposal(tier));
      assert.equal(result.allowed, true, `denials: ${result.denials.join("; ")}`);
      assert.equal(result.denials.length, 0);
    });
  }
});

describe("assertTierPayloadComplete — denies with named missing fields", () => {
  it("denies a proposal with no tier at all", () => {
    const { tier, ...noTier } = fullProposal("T0");
    void tier;
    const result = assertTierPayloadComplete(noTier as Partial<TypedActionProposal>);
    assert.equal(result.allowed, false);
    assert.ok(result.denials.some((d) => /no tier/i.test(d)));
  });

  it("T0 denies a missing idempotencyKey and names it", () => {
    const p = fullProposal("T0");
    delete (p as Partial<TypedActionProposal>).idempotencyKey;
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, false);
    assert.ok(result.denials.some((d) => /idempotencyKey/.test(d)), result.denials.join("; "));
  });

  it("T0 denies a missing confirmed target (targetId) — no apply-to-all", () => {
    const p = fullProposal("T0");
    delete (p as Partial<TypedActionProposal>).targetId;
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, false);
    assert.ok(result.denials.some((d) => /targetId/.test(d)));
  });

  it("T1 denies a missing dry-run (live status verification) and names it", () => {
    const p = fullProposal("T1");
    p.dryRunResult = null;
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, false);
    assert.ok(result.denials.some((d) => /dryRunResult/.test(d)));
  });

  it("T2 denies a missing read-before-write snapshot (beforeState)", () => {
    const p = fullProposal("T2");
    delete (p as Partial<TypedActionProposal>).beforeState;
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, false);
    assert.ok(result.denials.some((d) => /beforeState/.test(d)));
  });

  it("T3 names EVERY missing field when the external payload is bare", () => {
    const p = fullProposal("T3");
    delete (p as Partial<TypedActionProposal>).beforeState;
    delete (p as Partial<TypedActionProposal>).afterState;
    delete (p as Partial<TypedActionProposal>).idempotencyKey;
    delete (p as Partial<TypedActionProposal>).rollbackOrCorrectionNote;
    p.dryRunResult = null;
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, false);
    for (const field of ["beforeState", "afterState", "idempotencyKey", "dryRunResult", "rollbackOrCorrectionNote"]) {
      assert.ok(result.denials.some((d) => d.includes(field)), `expected a denial naming ${field}; got ${result.denials.join("; ")}`);
    }
  });

  it("an empty beforeState object does not count as present", () => {
    const p = fullProposal("T2");
    p.beforeState = {};
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, false);
    assert.ok(result.denials.some((d) => /beforeState/.test(d)));
  });
});

describe("T4 explicit human gate (master plan §10 — never session-blanket)", () => {
  it("T4 accepts when requiredApproval is Hart AND a dry-run was shown", () => {
    const result = assertTierPayloadComplete(fullProposal("T4"));
    assert.equal(result.allowed, true, result.denials.join("; "));
  });

  it("T4 denies the explicit human gate when the dry-run is absent", () => {
    const p = fullProposal("T4");
    p.dryRunResult = null;
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, false);
    // both the dry-run field and the human-gate pseudo-field should fail
    assert.ok(result.denials.some((d) => /human gate/i.test(d)), result.denials.join("; "));
  });
});

describe("doctrine stays intact — this is assertion-only", () => {
  it("executeProposal() still throws (no execution path opened)", () => {
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });

  it("a passing tier check carries no executed/true and no execution side-effect", () => {
    const p = fullProposal("T4");
    const result = assertTierPayloadComplete(p);
    assert.equal(result.allowed, true);
    // the proposal remains non-executable and its dry-run proves nothing ran
    assert.equal(p.executable, false);
    assert.equal(p.dryRunResult?.executed, false);
  });
});
