/**
 * tests/wolverine-obsidian-detector.test.ts — Wolverine audits Obsidian (stale-note detector).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectStaleObsidianNote } from "../src/wolverine/detectors/stale-obsidian-note.js";
import type { WolverineInputs } from "../src/wolverine/wolverine-types.js";

const NOW = "2026-06-10T00:00:00.000Z";
const base = (over: Partial<WolverineInputs> = {}): WolverineInputs => ({ now: NOW, env: {}, ...over });

describe("detectStaleObsidianNote", () => {
  it("flags overdue review (medium)", () => {
    const f = detectStaleObsidianNote(base({ vaultNotes: [{ relPath: "a.md", reviewBy: "2026-01-01T00:00:00.000Z" }] }));
    assert.equal(f.length, 1);
    assert.equal(f[0]!.severity, "medium");
    assert.equal(f[0]!.id, "stale-obsidian:overdue-review");
  });
  it("flags very old notes with no review date (low)", () => {
    const f = detectStaleObsidianNote(base({ vaultNotes: [{ relPath: "b.md", ageDays: 400 }] }));
    assert.equal(f.length, 1);
    assert.equal(f[0]!.severity, "low");
  });
  it("does not flag fresh notes / future review dates", () => {
    const f = detectStaleObsidianNote(base({ vaultNotes: [
      { relPath: "c.md", ageDays: 5, reviewBy: "2099-01-01T00:00:00.000Z" },
      { relPath: "d.md", ageDays: 5 },
    ] }));
    assert.equal(f.length, 0);
  });
  it("returns nothing without vault notes", () => {
    assert.equal(detectStaleObsidianNote(base()).length, 0);
  });
});
