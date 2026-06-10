/**
 * tests/wolverine-audit.test.ts — Wolverine v1: detectors + aggregator verdict, no I/O.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { detectUnsafeFlags } from "../src/wolverine/detectors/unsafe-flags.js";
import { detectGitHygiene } from "../src/wolverine/detectors/git-hygiene.js";
import type { WolverineDetector, WolverineFinding, WolverineInputs } from "../src/wolverine/wolverine-types.js";

const NOW = "2026-06-10T00:00:00.000Z";
const base = (over: Partial<WolverineInputs> = {}): WolverineInputs => ({ now: NOW, env: {}, ...over });

function finding(severity: WolverineFinding["severity"], id: string): WolverineFinding {
  return {
    id, category: "improvement", severity, title: id, evidence: "e", recommendedFix: "f",
    blastRadius: "b", rollbackPath: "r", approvalRequired: false, confidence: "high",
    freshness: "now", source: "test",
  };
}

describe("detectUnsafeFlags", () => {
  it("flags an armed exec flag as high", () => {
    const f = detectUnsafeFlags(base({ env: { ALLOW_EXEC_CLICKUP_COMMENT: "true" } }));
    assert.equal(f.length, 1);
    assert.equal(f[0]!.severity, "high");
    assert.equal(f[0]!.category, "unsafe_flag");
  });

  it("finds nothing when all flags are disarmed", () => {
    assert.equal(detectUnsafeFlags(base({ env: { ALLOW_EXEC_CLICKUP_COMMENT: "false", CONFIRM_CLOUDFLARE_DEPLOY: "false" } })).length, 0);
  });

  it("downgrades an exec flag to low when the kill-switch is ON", () => {
    const f = detectUnsafeFlags(base({ env: { ALLOW_EXEC_CLICKUP_COMMENT: "true", HARTOS_EXECUTION_KILL_SWITCH: "on" } }));
    assert.equal(f[0]!.severity, "low");
  });

  it("kill-switch does NOT neutralise a deploy gate", () => {
    const f = detectUnsafeFlags(base({ env: { CONFIRM_CLOUDFLARE_DEPLOY: "true", HARTOS_EXECUTION_KILL_SWITCH: "on" } }));
    assert.equal(f[0]!.severity, "high");
  });
});

describe("detectGitHygiene", () => {
  it("returns nothing without git facts", () => {
    assert.equal(detectGitHygiene(base()).length, 0);
  });
  it("flags uncommitted (medium), and high at >=10", () => {
    assert.equal(detectGitHygiene(base({ git: { branch: "x", uncommitted: 3, untracked: 0, ahead: 0, hasUpstream: true } }))[0]!.severity, "medium");
    assert.equal(detectGitHygiene(base({ git: { branch: "x", uncommitted: 12, untracked: 0, ahead: 0, hasUpstream: true } }))[0]!.severity, "high");
  });
  it("flags unpushed commits only when an upstream exists", () => {
    const withUp = detectGitHygiene(base({ git: { branch: "x", uncommitted: 0, untracked: 0, ahead: 4, hasUpstream: true } }));
    assert.ok(withUp.some((f) => f.id === "git:unpushed"));
    const noUp = detectGitHygiene(base({ git: { branch: "x", uncommitted: 0, untracked: 0, ahead: 4, hasUpstream: false } }));
    assert.ok(!noUp.some((f) => f.id === "git:unpushed"));
  });
});

describe("wolverineAudit verdict", () => {
  const det = (fs: WolverineFinding[]): WolverineDetector => () => fs;

  it("GREEN with no findings", () => {
    const r = wolverineAudit(base(), { detectors: [det([])] });
    assert.equal(r.verdict, "GREEN");
    assert.equal(r.findingCount, 0);
  });
  it("AMBER with one high", () => {
    assert.equal(wolverineAudit(base(), { detectors: [det([finding("high", "a")])] }).verdict, "AMBER");
  });
  it("RED with two highs", () => {
    assert.equal(wolverineAudit(base(), { detectors: [det([finding("high", "a"), finding("high", "b")])] }).verdict, "RED");
  });
  it("RED with a critical", () => {
    assert.equal(wolverineAudit(base(), { detectors: [det([finding("critical", "a")])] }).verdict, "RED");
  });
  it("AMBER with three mediums; GREEN with two", () => {
    assert.equal(wolverineAudit(base(), { detectors: [det([finding("medium", "a"), finding("medium", "b"), finding("medium", "c")])] }).verdict, "AMBER");
    assert.equal(wolverineAudit(base(), { detectors: [det([finding("medium", "a"), finding("medium", "b")])] }).verdict, "GREEN");
  });
  it("ranks worst-first and caps topRisks at 5", () => {
    const many = [finding("low", "l1"), finding("critical", "c1"), finding("high", "h1"), finding("medium", "m1"), finding("low", "l2"), finding("high", "h2")];
    const r = wolverineAudit(base(), { detectors: [det(many)] });
    assert.equal(r.topRisks.length, 5);
    assert.equal(r.topRisks[0]!.severity, "critical");
    assert.equal(r.repairQueue.length, 6);
  });
  it("a throwing detector becomes a low finding, not a crash", () => {
    const boom: WolverineDetector = () => { throw new Error("boom"); };
    const r = wolverineAudit(base(), { detectors: [boom] });
    assert.equal(r.findingCount, 1);
    assert.equal(r.repairQueue[0]!.category, "broken_wiring");
  });
});
