/**
 * tests/control-surface-rules.test.ts
 *
 * Phase 18E — deterministic rules. Covers brief tests #1 (verdict), #2
 * (confidence), #4 (severity ordering), #5 (no-execute), plus freshness + system
 * verdict. Hermetic: no network, no LLM, no clock beyond the `now` passed in.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeFreshness,
  computeVerdict,
  computeConfidence,
  computeSystemVerdict,
  sortFixesBySeverity,
  isAllowedFixAction,
  ALLOWED_FIX_ACTION_KINDS,
  type Fact,
  type Freshness,
  type FixRecommendation,
  type HealthCheck,
} from "../src/cockpit/control-surface/index.js";

const NOW = "2026-06-05T12:00:00.000Z";
const f = (key: string, freshness: Freshness, value: string | number | null = 1): Fact => ({
  key,
  label: key,
  value: freshness === "unknown" ? null : value,
  asOf: NOW,
  source: "test",
  freshness,
});

describe("18E — computeFreshness windows", () => {
  it("< 6h → fresh", () => {
    assert.equal(computeFreshness("2026-06-05T08:00:00.000Z", NOW), "fresh");
  });
  it("6h–72h → stale", () => {
    assert.equal(computeFreshness("2026-06-04T00:00:00.000Z", NOW), "stale");
  });
  it("> 72h → dead", () => {
    assert.equal(computeFreshness("2026-06-01T00:00:00.000Z", NOW), "dead");
  });
  it("null value → unknown", () => {
    assert.equal(computeFreshness(null, NOW, { valueNull: true }), "unknown");
  });
  it("failed check → dead", () => {
    assert.equal(computeFreshness("2026-06-05T11:59:00.000Z", NOW, { checkFailed: true }), "dead");
  });
});

describe("18E — verdict rule (test #1)", () => {
  const okHealth: HealthCheck[] = [{ name: "x", state: "g", detail: "" }];
  it("all fresh → GREEN", () => {
    assert.equal(computeVerdict([f("a", "fresh"), f("b", "fresh")], okHealth), "GREEN");
  });
  it("a stale fact → AMBER", () => {
    assert.equal(computeVerdict([f("a", "fresh"), f("b", "stale")], okHealth), "AMBER");
  });
  it("a blocking condition → AMBER even when all fresh", () => {
    assert.equal(computeVerdict([f("a", "fresh")], okHealth, { blocked: true }), "AMBER");
  });
  it('health "r" → RED', () => {
    const health: HealthCheck[] = [{ name: "x", state: "r", detail: "" }];
    assert.equal(computeVerdict([f("a", "fresh")], health), "RED");
  });
  it("a safety-critical dead fact → RED", () => {
    assert.equal(computeVerdict([f("health", "dead")], okHealth, { safetyCriticalKeys: ["health"] }), "RED");
  });
  it("all facts null → UNKNOWN", () => {
    assert.equal(computeVerdict([f("a", "unknown"), f("b", "unknown")], okHealth), "UNKNOWN");
  });
  it("empty bundle → UNKNOWN", () => {
    assert.equal(computeVerdict([], okHealth), "UNKNOWN");
  });
});

describe("18E — confidence = worst cited freshness (test #2)", () => {
  it("all fresh → HIGH", () => {
    assert.equal(computeConfidence([f("a", "fresh"), f("b", "fresh")]), "HIGH");
  });
  it("any stale → LOW", () => {
    assert.equal(computeConfidence([f("a", "fresh"), f("b", "stale")]), "LOW");
  });
  it("any dead → LOW", () => {
    assert.equal(computeConfidence([f("a", "fresh"), f("b", "dead")]), "LOW");
  });
  it("any unknown → UNKNOWN (dominates stale)", () => {
    assert.equal(computeConfidence([f("a", "stale"), f("b", "unknown")]), "UNKNOWN");
  });
});

describe("18E — system verdict = worst agent verdict", () => {
  it("RED dominates", () => {
    assert.equal(computeSystemVerdict(["GREEN", "AMBER", "RED", "UNKNOWN"]), "RED");
  });
  it("AMBER over UNKNOWN/GREEN", () => {
    assert.equal(computeSystemVerdict(["GREEN", "UNKNOWN", "AMBER"]), "AMBER");
  });
  it("UNKNOWN over GREEN", () => {
    assert.equal(computeSystemVerdict(["GREEN", "UNKNOWN"]), "UNKNOWN");
  });
  it("all green → GREEN", () => {
    assert.equal(computeSystemVerdict(["GREEN", "GREEN"]), "GREEN");
  });
});

const fix = (severity: FixRecommendation["severity"], title: string): FixRecommendation => ({
  severity,
  title,
  why: "because",
  action: { kind: "open_link", payload: "x" },
});

describe("18E — severity ordering (test #4)", () => {
  it("security always sorts above note regardless of input order", () => {
    const sorted = sortFixesBySeverity([fix("note", "n"), fix("security", "s")]);
    assert.equal(sorted[0]!.severity, "security");
    assert.equal(sorted[1]!.severity, "note");
  });
  it("full tier order: security > stale-revenue > blocked > next > note", () => {
    const sorted = sortFixesBySeverity([
      fix("note", "n"),
      fix("next", "x"),
      fix("blocked", "b"),
      fix("stale-revenue", "r"),
      fix("security", "s"),
    ]);
    assert.deepEqual(
      sorted.map((x) => x.severity),
      ["security", "stale-revenue", "blocked", "next", "note"]
    );
  });
  it("ties within a tier preserve input order (LLM may only order within tier)", () => {
    const sorted = sortFixesBySeverity([fix("next", "first"), fix("next", "second")]);
    assert.deepEqual(
      sorted.map((x) => x.title),
      ["first", "second"]
    );
  });
});

describe("18E — no execute path (test #5)", () => {
  it("allowed fix action kinds are exactly copy_cli / open_proposal / open_link", () => {
    assert.deepEqual([...ALLOWED_FIX_ACTION_KINDS].sort(), ["copy_cli", "open_link", "open_proposal"]);
  });
  it('"execute" is not an allowed action kind', () => {
    assert.equal(isAllowedFixAction("execute"), false);
    assert.equal(isAllowedFixAction("deploy"), false);
    assert.equal(isAllowedFixAction("run"), false);
  });
  it("every allowed kind passes the guard", () => {
    for (const k of ALLOWED_FIX_ACTION_KINDS) assert.equal(isAllowedFixAction(k), true);
  });
});
