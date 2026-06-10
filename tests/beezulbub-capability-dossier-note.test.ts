/**
 * tests/beezulbub-capability-dossier-note.test.ts — scout result → gated capability dossier note.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capabilityScoutNote } from "../src/beezulbub/capability-dossier-note.js";
import type { BeezulbubScoutResult } from "../src/beezulbub/types.js";

const NOW = "2026-06-10T12:00:00Z";

function result(over: Partial<BeezulbubScoutResult> = {}): BeezulbubScoutResult {
  return {
    target: "markdown_editor",
    timestamp: NOW,
    mode: "live",
    recommendation: "Top: milkdown (value 9/10).",
    candidates: [
      { name: "milkdown", sourceUrl: "https://github.com/Milkdown/milkdown", targetCapability: "markdown_editor", reason: "Plugin-based MD editor", estimatedValue: 9, licenseGuess: "MIT", staleRisk: "low", notes: "Stars: 9000" },
      { name: "react-md-editor", sourceUrl: "https://github.com/uiwjs/react-md-editor", targetCapability: "markdown_editor", reason: "Simple RC editor", estimatedValue: 7, licenseGuess: "MIT", staleRisk: "low", notes: "Stars: 2000" },
    ],
    ...over,
  };
}

describe("capabilityScoutNote", () => {
  it("renders a ranked capability_dossier note with sources + medium confidence for a live scout", () => {
    const note = capabilityScoutNote(result(), NOW);
    assert.equal(note.noteType, "capability_dossier");
    assert.equal(note.folder, "HartOS/Capability Scout");
    assert.equal(note.confidence, "medium"); // live + candidates
    assert.deepEqual(note.sources, ["https://github.com/Milkdown/milkdown", "https://github.com/uiwjs/react-md-editor"]);
    assert.ok(note.relatedAgents?.includes("Beezulbub"));
    assert.match(note.body, /# Capability Scout — markdown_editor/);
    assert.match(note.body, /never auto-copies code/);
  });

  it("caps confidence at low for a fixture/offline scout (honesty floor)", () => {
    const note = capabilityScoutNote(result({ mode: "fixture" }), NOW);
    assert.equal(note.confidence, "low");
  });

  it("renders LLM due-diligence and rises to high confidence when assessments are present", () => {
    const note = capabilityScoutNote(result(), NOW, {
      assessments: [{ name: "milkdown", assessment: "Well-maintained, MIT, strong HartOS fit. Lean: DEVOUR." }],
    });
    assert.equal(note.confidence, "high");
    assert.match(note.body, /LLM due-diligence/);
    assert.match(note.body, /Lean: DEVOUR/);
  });

  it("ranks candidates by value (highest first)", () => {
    const note = capabilityScoutNote(
      result({
        candidates: [
          { name: "low", targetCapability: "x", reason: "r", estimatedValue: 4, staleRisk: "low", notes: "" },
          { name: "high", targetCapability: "x", reason: "r", estimatedValue: 9, staleRisk: "low", notes: "" },
        ],
      }),
      NOW,
    );
    const hi = note.body.indexOf("high");
    const lo = note.body.indexOf("low");
    assert.ok(hi < lo && hi !== -1, "higher-value candidate appears first");
  });
});
