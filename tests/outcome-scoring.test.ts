/**
 * tests/outcome-scoring.test.ts — the closed learning loop's measuring half.
 * resolved (target gone) vs persisted (still present) vs unknown (no subject); efficacy roll-up.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExecutedOutcomes,
  efficacyByActionType,
  subjectStillPresent,
  summarizeEfficacy,
  type ExecutedTarget,
} from "../src/learning/outcome-scoring.js";

describe("outcome scoring", () => {
  it("subjectStillPresent matches loosely (exact + substring either way), empty never matches", () => {
    assert.equal(subjectStillPresent("ops stale", ["OPS STALE", "x"]), true);
    assert.equal(subjectStillPresent("stale-read-model:ops", ["stale-read-model:ops read-model is stale"]), true);
    assert.equal(subjectStillPresent("gone", ["something else"]), false);
    assert.equal(subjectStillPresent("", ["anything"]), false);
  });

  it("classifies executed proposals: present ⇒ persisted, absent ⇒ resolved, no subject ⇒ unknown", () => {
    const executed: ExecutedTarget[] = [
      { proposalId: "p1", actionType: "sync_repair_plan", subject: "aging-drafts" },
      { proposalId: "p2", actionType: "sync_repair_plan", subject: "old-rejected" },
      { proposalId: "p3", actionType: "review_plan", subject: "" },
    ];
    const scored = classifyExecutedOutcomes(executed, ["aging-drafts still around", "unrelated"]);
    assert.equal(scored.find((s) => s.proposalId === "p1")?.outcome, "persisted");
    assert.equal(scored.find((s) => s.proposalId === "p2")?.outcome, "resolved");
    assert.equal(scored.find((s) => s.proposalId === "p3")?.outcome, "unknown");
  });

  it("efficacyByActionType excludes unknowns, computes rate, sorts by sample size", () => {
    const eff = efficacyByActionType([
      { actionType: "sync_repair_plan", outcome: "resolved" },
      { actionType: "sync_repair_plan", outcome: "resolved" },
      { actionType: "sync_repair_plan", outcome: "persisted" },
      { actionType: "review_plan", outcome: "resolved" },
      { actionType: "review_plan", outcome: "unknown" },
    ]);
    assert.equal(eff[0]?.actionType, "sync_repair_plan", "most-decided first");
    assert.equal(eff[0]?.total, 3);
    assert.equal(eff[0]?.resolved, 2);
    assert.equal(eff[0]?.rate, 0.67);
    const review = eff.find((e) => e.actionType === "review_plan");
    assert.equal(review?.total, 1, "the unknown is excluded");
    assert.equal(review?.rate, 1);
  });

  it("summarizeEfficacy is honest when there is no decisive history", () => {
    assert.match(summarizeEfficacy([]), /no decisive outcomes recorded yet/);
    assert.match(
      summarizeEfficacy(efficacyByActionType([{ actionType: "sync_repair_plan", outcome: "resolved" }])),
      /sync_repair_plan 100% \(1\/1\)/,
    );
  });
});
