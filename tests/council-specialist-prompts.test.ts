import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SPECIALIST_LENSES, buildSpecialistPrompt, parseFinding } from "../src/council/specialist-prompts.js";

describe("specialist-prompts", () => {
  it("ships the 5 lenses", () => {
    assert.deepEqual(Object.keys(SPECIALIST_LENSES).sort(), ["cto", "financial", "legal", "ma", "research"]);
  });
  it("prompt embeds the lens + goal and is redacted", () => {
    const p = buildSpecialistPrompt("cto", { goal: "build a CRM", context: "key=sk-ABCDEF1234567890ABCDEF" });
    assert.match(p.system, /feasibility|architecture/i);
    assert.ok(!/sk-ABCDEF1234567890ABCDEF/.test(p.user), "secret must be redacted from the prompt");
  });
  it("parseFinding tolerates malformed model output → degraded finding", () => {
    const f = parseFinding("cto", "not json at all");
    assert.equal(f.degraded, true);
    assert.equal(f.specialistId, "cto");
  });
  it("parseFinding reads a well-formed JSON finding", () => {
    const raw = JSON.stringify({ summary: "ok", confidence: "high", risks: ["scope"] });
    const f = parseFinding("financial", raw);
    assert.equal(f.confidence, "high");
    assert.equal(f.degraded, false);
  });
});
