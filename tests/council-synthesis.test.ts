import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { synthesize } from "../src/council/council-synthesis.js";
import type { SpecialistFinding } from "../src/council/council-types.js";

const f = (over: Partial<SpecialistFinding>): SpecialistFinding =>
  ({ specialistId: "x", lens: "x", summary: "s", confidence: "high", risks: [], degraded: false, ...over });

describe("synthesize", () => {
  it("confidence = the WEAKEST non-degraded band (no laundering)", () => {
    const s = synthesize([f({ specialistId: "cto", confidence: "high" }), f({ specialistId: "legal", confidence: "low", risks: ["GDPR"] })], { truncated: false });
    assert.equal(s.confidence, "low");
  });
  it("degraded findings are EXCLUDED from confidence but noted", () => {
    const s = synthesize([f({ specialistId: "cto", confidence: "high" }), f({ specialistId: "legal", degraded: true, confidence: "low" })], { truncated: false });
    assert.equal(s.confidence, "high");
    assert.ok(s.notes.some((n) => /legal|degraded/i.test(n)));
  });
  it("all degraded / empty → low confidence + honest note", () => {
    assert.equal(synthesize([f({ degraded: true })], { truncated: false }).confidence, "low");
    assert.equal(synthesize([], { truncated: false }).confidence, "low");
    assert.ok(synthesize([], { truncated: false }).notes.length > 0);
  });
  it("consensus lists the non-degraded specialist summaries", () => {
    const s = synthesize([f({ specialistId: "cto", summary: "buildable in 6w" })], { truncated: false });
    assert.ok(s.consensus.some((c) => /buildable/.test(c)));
  });
  it("dissent surfaces low-confidence / risk-flagging specialists", () => {
    const s = synthesize([f({ specialistId: "legal", confidence: "low", risks: ["GDPR exposure"] })], { truncated: false });
    assert.ok(s.dissent.length > 0);
  });
  it("truncated passes through + is noted", () => {
    const s = synthesize([f({})], { truncated: true });
    assert.equal(s.truncated, true);
    assert.ok(s.notes.some((n) => /truncat|cap/i.test(n)));
  });
  it("recommendation is a non-empty deterministic string; never throws", () => {
    const s = synthesize([f({ specialistId: "cto", summary: "go" })], { truncated: false });
    assert.equal(typeof s.recommendation, "string");
    assert.ok(s.recommendation.length > 0);
  });
});
