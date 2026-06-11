/**
 * tests/state-report-note.test.ts — the pure HartOS state-report builder.
 * Deterministic, no fabrication: empty sections render an honest placeholder, never invented signal.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStateReportNote, reportSlug, type StateReportSections } from "../src/reports/state-report-note.js";

const now = "2026-06-11T08:00:00Z";

const full: StateReportSections = {
  focus: "ops",
  verdict: "AMBER",
  verdictReason: "1 aging draft",
  findingCount: 1,
  topRisks: [{ severity: "medium", title: "aging draft proposal", recommendedFix: "reject stale drafts" }],
  forecastSummary: "1 consequence projected",
  consequences: [{ subject: "ops backlog", severity: "medium", projection: "grows if untended" }],
  decisionsHeadline: "Today: clear the aging draft.",
  memorySummary: "Executive memory: 2 pattern(s), 1 trend(s), 0 lesson(s).",
  recurringSubjects: ["ops stale"],
  postureLines: ["Autoheal armed (auto-executes): reject-drafts", "ALLOW_OBSIDIAN_WRITE: armed"],
};

const empty: StateReportSections = {
  focus: "",
  verdict: "GREEN",
  verdictReason: "nothing surfaced",
  findingCount: 0,
  topRisks: [],
  forecastSummary: "no consequences projected",
  consequences: [],
  decisionsHeadline: null,
  memorySummary: "insufficient history (no memory snapshots yet)",
  recurringSubjects: [],
  postureLines: [],
};

describe("state-report note builder", () => {
  it("uses the executive_weekly_review type + HartOS/Reports folder", () => {
    const note = buildStateReportNote(full, now);
    assert.equal(note.noteType, "executive_weekly_review");
    assert.equal(note.folder, "HartOS/Reports");
    assert.equal(note.createdAt, now);
  });

  it("a focus appears in the title + tags; the body carries every populated section", () => {
    const note = buildStateReportNote(full, now);
    assert.match(note.title, /HartOS Report — ops/);
    assert.ok(note.tags.includes("ops"));
    assert.match(note.body, /Verdict: AMBER/);
    assert.match(note.body, /aging draft proposal/);
    assert.match(note.body, /reject stale drafts/);
    assert.match(note.body, /ops backlog/);
    assert.match(note.body, /Today: clear the aging draft\./);
    assert.match(note.body, /Autoheal armed \(auto-executes\): reject-drafts/);
    assert.match(note.body, /Recurring subjects: ops stale/);
    assert.equal(note.tags.every((t) => t.length > 0), true, "no empty tags");
  });

  it("no fabrication — empty sections render honest placeholders, not invented content", () => {
    const note = buildStateReportNote(empty, now);
    assert.match(note.title, /HartOS State Report — 2026-06-11/);
    assert.match(note.body, /No risks surfaced by the active detectors/);
    assert.match(note.body, /No projected consequences/);
    assert.match(note.body, /Nothing armed — fully propose-only/);
    assert.match(note.body, /No decision synthesis available this run/);
    // an empty focus must not produce an empty tag
    assert.equal(note.tags.every((t) => t.length > 0), true);
  });

  it("reportSlug is deterministic + filesystem-safe", () => {
    assert.equal(reportSlug("Ops Focus!", now), "ops-focus-2026-06-11");
    assert.equal(reportSlug("", now), "hartos-state-2026-06-11");
  });
});
