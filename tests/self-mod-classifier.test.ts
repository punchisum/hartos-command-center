/**
 * tests/self-mod-classifier.test.ts — P6 §6: tier routing + blast-radius cap (pure).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyTier, SELF_MOD_MAX_FILES, SELF_MOD_MAX_LINES } from "../src/execution/self-mod-classifier.js";

describe("classifyTier", () => {
  it("fix within cap → auto-apply", () => {
    assert.equal(classifyTier({ selfModClass: "fix", fileCount: 2, changedLines: 30 }).tier, "auto-apply");
  });

  it("recalibrate within cap → auto-apply", () => {
    assert.equal(classifyTier({ selfModClass: "recalibrate", fileCount: 1, changedLines: 10 }).tier, "auto-apply");
  });

  it("extend is ALWAYS propose-only, even tiny", () => {
    const r = classifyTier({ selfModClass: "extend", fileCount: 1, changedLines: 5 });
    assert.equal(r.tier, "propose-only");
    assert.match(r.reason, /extend|propose-only/);
  });

  it("fix over the file cap → escalates to propose-only", () => {
    const r = classifyTier({ selfModClass: "fix", fileCount: SELF_MOD_MAX_FILES + 1, changedLines: 10 });
    assert.equal(r.tier, "propose-only");
    assert.match(r.reason, /file/i);
  });

  it("fix over the line cap → escalates to propose-only", () => {
    const r = classifyTier({ selfModClass: "fix", fileCount: 1, changedLines: SELF_MOD_MAX_LINES + 1 });
    assert.equal(r.tier, "propose-only");
    assert.match(r.reason, /line/i);
  });

  it("exactly at the caps → still auto-apply (cap is inclusive)", () => {
    assert.equal(
      classifyTier({ selfModClass: "fix", fileCount: SELF_MOD_MAX_FILES, changedLines: SELF_MOD_MAX_LINES }).tier,
      "auto-apply",
    );
  });

  it("an unrecognised class fails closed to propose-only", () => {
    assert.equal(classifyTier({ selfModClass: "weird" as never, fileCount: 1, changedLines: 1 }).tier, "propose-only");
  });
});
