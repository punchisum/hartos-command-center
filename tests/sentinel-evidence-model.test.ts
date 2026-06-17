/**
 * tests/sentinel-evidence-model.test.ts — raw-evidence intake carries hostBound through honestly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence } from "../src/sentinel/evidence-model.js";

const NOW = "2026-06-11T12:00:00.000Z";

describe("normalizeEvidence", () => {
  it("carries hostBound through when set", () => {
    const hb = normalizeEvidence(
      { agentId: "research", observedAt: NOW, evidenceSource: "research-reports/", hostBound: true },
      NOW,
    );
    assert.equal(hb.hostBound, true);
  });

  it("omits hostBound when not set (⇒ cloud by default)", () => {
    const hb = normalizeEvidence({ agentId: "ops", observedAt: NOW, evidenceSource: "ops read-model" }, NOW);
    assert.equal(hb.hostBound, undefined);
  });
});
