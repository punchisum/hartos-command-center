/**
 * tests/hartos-request-classifier.test.ts
 *
 * Phase 11F — request classifier tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, detectBuildTarget, requiredCapabilitiesFor } from "../src/hartos/request-classifier.js";

describe("hartos request-classifier", () => {
  it("classifies tax agent as new_agent_build, high risk, strategy first", () => {
    const c = classifyRequest("I want to build a tax specialist agent");
    assert.equal(c.classification, "new_agent_build");
    assert.equal(c.riskLevel, "high");
    assert.equal(c.domain, "tax");
    assert.equal(c.needsStrategyReview, true);
    assert.equal(c.recommendedSpecialist, "strategy_review");
    assert.equal(c.buildTarget, "tax_specialist");
  });

  it("classifies command center as feature_build or new_agent_build, engineering domain", () => {
    const c = classifyRequest("I want to build a command center");
    assert.ok(
      c.classification === "feature_build" || c.classification === "new_agent_build",
      `expected feature_build or new_agent_build, got ${c.classification}`
    );
    assert.equal(c.domain, "engineering");
    assert.equal(c.needsStrategyReview, true);
  });

  it("classifies a debug issue as debug_request", () => {
    const c = classifyRequest("the receipt parser is broken and throwing an error");
    assert.equal(c.classification, "debug_request");
    assert.equal(c.recommendedSpecialist, "cto");
    assert.equal(c.needsCtoReview, true);
  });

  it("handles unknown requests safely", () => {
    const c = classifyRequest("hello there");
    assert.equal(c.classification, "unknown");
    assert.equal(c.recommendedSpecialist, "manual_hart_decision");
    assert.ok(Array.isArray(c.rationale));
    assert.ok(c.rationale.length > 0);
  });

  it("classifies pack acquisition as pack_request → beezulbub", () => {
    const c = classifyRequest("absorb this open source repo into a pack");
    assert.equal(c.classification, "pack_request");
    assert.equal(c.recommendedSpecialist, "beezulbub");
  });

  it("classifies fitness request to fitness_agent", () => {
    const c = classifyRequest("track my workout and gym training");
    assert.equal(c.classification, "fitness_request");
    assert.equal(c.recommendedSpecialist, "fitness_agent");
    assert.equal(c.riskLevel, "low");
  });

  it("detectBuildTarget maps tax/dashboard/receipt", () => {
    assert.equal(detectBuildTarget("build a tax agent"), "tax_specialist");
    assert.equal(detectBuildTarget("build a dashboard cockpit"), "dashboard_cockpit");
    assert.equal(detectBuildTarget("build a receipt OCR agent"), "receipt_agent");
    assert.equal(detectBuildTarget("build something else"), "generic");
  });

  it("requiredCapabilitiesFor returns expected capability lists", () => {
    assert.ok(requiredCapabilitiesFor("tax_specialist").includes("receipt_ocr"));
    assert.ok(requiredCapabilitiesFor("dashboard_cockpit").includes("dashboard_layout"));
    assert.ok(requiredCapabilitiesFor("receipt_agent").includes("receipt_ocr"));
    assert.deepEqual(requiredCapabilitiesFor("generic"), []);
  });
});
