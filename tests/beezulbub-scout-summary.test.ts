/**
 * tests/beezulbub-scout-summary.test.ts — scout summary, license-risk classification, note round-trip.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeScout, isRiskyLicense, parseCapabilityScoutNote } from "../src/beezulbub/scout-summary.js";
import { capabilityScoutNote } from "../src/beezulbub/capability-dossier-note.js";
import type { BeezulbubScoutResult } from "../src/beezulbub/types.js";

const NOW = "2026-06-10T12:00:00Z";

function result(topLicense: string | undefined, topStale: "low" | "medium" | "high" = "low"): BeezulbubScoutResult {
  return {
    target: "markdown_editor",
    timestamp: NOW,
    mode: "live",
    recommendation: "top pick",
    candidates: [
      { name: "vditor", sourceUrl: "https://github.com/Vanessa219/vditor", targetCapability: "markdown_editor", reason: "MD editor", estimatedValue: 10, licenseGuess: topLicense, staleRisk: topStale, notes: "Stars: 9000" },
      { name: "other", sourceUrl: "https://github.com/x/other", targetCapability: "markdown_editor", reason: "MD", estimatedValue: 6, licenseGuess: "MIT", staleRisk: "low", notes: "" },
    ],
  };
}

describe("isRiskyLicense", () => {
  it("flags copyleft/unknown, clears permissive", () => {
    assert.equal(isRiskyLicense("MIT"), false);
    assert.equal(isRiskyLicense("Apache-2.0"), false);
    assert.equal(isRiskyLicense("BSD-3-Clause"), false);
    assert.equal(isRiskyLicense("AGPL-3.0"), true);
    assert.equal(isRiskyLicense("GPL-3.0"), true);
    assert.equal(isRiskyLicense(null), true);
    assert.equal(isRiskyLicense(undefined), true);
  });
});

describe("summarizeScout", () => {
  it("summarizes the top candidate + flags a risky license", () => {
    const s = summarizeScout(result("AGPL-3.0"));
    assert.equal(s.topCandidate, "vditor");
    assert.equal(s.topLicense, "AGPL-3.0");
    assert.equal(s.riskyTopLicense, true);
    assert.equal(s.candidateCount, 2);
    assert.equal(s.mode, "live");
  });
  it("clears a permissive top license", () => {
    assert.equal(summarizeScout(result("MIT")).riskyTopLicense, false);
  });
  it("flags a stale top pick", () => {
    assert.equal(summarizeScout(result("MIT", "high")).staleTop, true);
  });
});

describe("parseCapabilityScoutNote round-trips the rendered note", () => {
  it("recovers target, top candidate, license + risk from a real dossier body", () => {
    const note = capabilityScoutNote(result("AGPL-3.0"), NOW);
    const parsed = parseCapabilityScoutNote(note.body)!;
    assert.equal(parsed.target, "markdown_editor");
    assert.equal(parsed.mode, "live");
    assert.equal(parsed.topCandidate, "vditor");
    assert.equal(parsed.topLicense, "AGPL-3.0");
    assert.equal(parsed.riskyTopLicense, true);
  });
  it("returns null for a non-scout body", () => {
    assert.equal(parseCapabilityScoutNote("# Some other note\n\nbody"), null);
  });
});
