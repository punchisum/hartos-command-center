/**
 * tests/hartos-strategy-review.test.ts
 *
 * Phase 11F — strategy review (Prophet) tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reviewStrategy } from "../src/hartos/strategy-review.js";

const ALLOWED_VERDICTS = new Set([
  "BUILD_NOW",
  "BUILD_LATER",
  "DO_NOT_BUILD",
  "DEVOUR_EXISTING_CAPABILITY",
  "MERGE_WITH_EXISTING_AGENT",
  "NEEDS_MORE_EVIDENCE",
]);

describe("hartos strategy-review", () => {
  it("tax agent recommends foundation-first when receipt/document missing", () => {
    const r = reviewStrategy("build a tax specialist agent", {
      missingFoundationCapabilities: ["receipt_ocr", "document_ingest"],
    });
    assert.equal(r.verdict, "BUILD_LATER");
    assert.ok(/receipt|document|foundation/i.test(r.simplerAlternative ?? ""));
    assert.ok(/foundation|receipt|document/i.test(r.recommendedNextAction));
  });

  it("tax agent defaults to foundation-first when foundations unknown", () => {
    const r = reviewStrategy("build a tax specialist agent");
    assert.equal(r.verdict, "BUILD_LATER");
  });

  it("dashboard cosplay gets downgraded when not tied to value", () => {
    const r = reviewStrategy("build a command center dashboard cockpit");
    assert.ok(
      r.verdict === "BUILD_LATER" || r.verdict === "DO_NOT_BUILD",
      `expected downgrade, got ${r.verdict}`
    );
    assert.ok(r.simplerAlternative !== null);
  });

  it("dashboard tied to approvals/reports is NOT downgraded as cosplay", () => {
    const r = reviewStrategy("build a dashboard showing the approval queue and reports");
    // Should not be the pure-cosplay downgrade reason
    assert.ok(!/infrastructure cosplay/i.test(r.reason));
    assert.ok(ALLOWED_VERDICTS.has(r.verdict));
  });

  it("repeated workflow automation gets a positive score", () => {
    const r = reviewStrategy("automate the repeated manual receipt expense workflow I do every day");
    assert.ok(r.scores.repeated_workflow_automated >= 7);
    assert.ok(r.expectedLeverage === "high" || r.expectedLeverage === "medium");
  });

  it("always produces one of the allowed verdicts", () => {
    for (const req of [
      "build a tax agent",
      "build a command center",
      "automate my invoices",
      "make a tiny script",
      "build a fitness tracker",
      "hello",
    ]) {
      const r = reviewStrategy(req);
      assert.ok(ALLOWED_VERDICTS.has(r.verdict), `bad verdict for "${req}": ${r.verdict}`);
    }
  });

  it("low-value high-complexity request can be DO_NOT_BUILD", () => {
    const r = reviewStrategy("build an autonomous multi-agent swarm platform system");
    assert.ok(ALLOWED_VERDICTS.has(r.verdict));
    assert.ok(r.risk === "high" || r.maintenanceBurden === "high");
  });
});
