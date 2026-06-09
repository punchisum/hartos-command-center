/**
 * tests/card-target-resolver.test.ts
 *
 * Resolving "this operation" / a card name / an id against candidate ops cards. Honesty is the
 * contract: a unique match resolves; multiple matches are ambiguous; nothing fabricated.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCardTarget, type OpsCardRef } from "../src/cockpit/mutation/card-target-resolver.js";

const CARDS: OpsCardRef[] = [
  { cardId: "86a", cardName: "Supplier onboarding — Acme", status: "in progress" },
  { cardId: "86b", cardName: "Invoice reconciliation Q2", status: "waiting on hart" },
];

describe("resolveCardTarget", () => {
  it("resolves an explicit card id in the instruction", () => {
    const r = resolveCardTarget("put 86b on hold", CARDS);
    assert.equal(r.status, "resolved");
    assert.equal(r.target!.cardId, "86b");
    assert.equal(r.target!.currentStatus, "waiting on hart");
  });

  it("resolves a focus reference to the focused card", () => {
    const r = resolveCardTarget("this operation has stalled, put it on hold", CARDS, { focusedCardId: "86a" });
    assert.equal(r.status, "resolved");
    assert.equal(r.target!.cardId, "86a");
  });

  it("resolves a unique name match", () => {
    const r = resolveCardTarget("hold the reconciliation work", CARDS);
    assert.equal(r.status, "resolved");
    assert.equal(r.target!.cardId, "86b");
  });

  it("is ambiguous when a bare 'this' matches several open cards", () => {
    const r = resolveCardTarget("put this on hold", CARDS); // no focus, 2 candidates
    assert.equal(r.status, "ambiguous");
    assert.equal(r.candidates!.length, 2);
  });

  it("resolves 'this' to the sole candidate when there's only one", () => {
    const r = resolveCardTarget("put this on hold", [CARDS[0]!]);
    assert.equal(r.status, "resolved");
    assert.equal(r.target!.cardId, "86a");
  });

  it("returns no_candidates honestly when none are supplied", () => {
    const r = resolveCardTarget("put this on hold", []);
    assert.equal(r.status, "no_candidates");
  });

  it("returns none when nothing matches and there's no focus ref", () => {
    const r = resolveCardTarget("comment on the nonexistent widget thing", CARDS);
    assert.equal(r.status, "none");
  });
});
