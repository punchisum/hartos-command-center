/**
 * tests/boundary-gate.test.ts
 *
 * Plan §7 — the per-job boundary gate. Covers the allow path and EVERY denial reason:
 * maxTime, maxCost, maxSearchDepth, maxFilesWritten, disallowed source, source outside a
 * declared allowlist, external-network (fail-closed when undefined), and LLM use
 * (fail-closed when undefined). Mirrors the execution gate's { allowed, denials[] } shape.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkBoundary, type BoundaryUsage } from "../src/research/boundary-gate.js";
import type { BoundaryDefinition } from "../src/research/agent-job-types.js";

/** A generous, fully-specified boundary so each test isolates one violation. */
function permissiveBoundary(over: Partial<BoundaryDefinition> = {}): BoundaryDefinition {
  return {
    maxTime: 10_000,
    maxCost: 100,
    maxSearchDepth: 5,
    maxFilesWritten: 3,
    allowedSources: ["web", "internal-docs"],
    disallowedSources: ["telegram"],
    externalNetworkAllowed: true,
    llmAllowed: true,
    stopConditions: ["stop at 20 sources"],
    ...over,
  };
}

/** Usage that stays safely within permissiveBoundary(). */
function safeUsage(over: Partial<BoundaryUsage> = {}): BoundaryUsage {
  return {
    elapsedTime: 1_000,
    cost: 5,
    searchDepth: 2,
    filesWritten: 1,
    sourcesUsed: ["web"],
    usesExternalNetwork: true,
    usesLlm: true,
    ...over,
  };
}

describe("checkBoundary — allow path", () => {
  it("allows usage within every boundary", () => {
    const r = checkBoundary(safeUsage(), permissiveBoundary());
    assert.equal(r.allowed, true);
    assert.deepEqual(r.denials, []);
  });

  it("undefined numeric ceilings are not checked (no limit)", () => {
    const boundary: BoundaryDefinition = { stopConditions: [], externalNetworkAllowed: true, llmAllowed: true };
    const r = checkBoundary({ elapsedTime: 9_999_999, cost: 9_999, searchDepth: 99, filesWritten: 99 }, boundary);
    assert.equal(r.allowed, true);
    assert.deepEqual(r.denials, []);
  });
});

describe("checkBoundary — numeric denials", () => {
  it("denies when maxTime is exceeded", () => {
    const r = checkBoundary(safeUsage({ elapsedTime: 20_000 }), permissiveBoundary());
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("maxTime exceeded")));
  });

  it("denies when maxCost is exceeded", () => {
    const r = checkBoundary(safeUsage({ cost: 250 }), permissiveBoundary());
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("maxCost exceeded")));
  });

  it("denies when maxSearchDepth is exceeded", () => {
    const r = checkBoundary(safeUsage({ searchDepth: 9 }), permissiveBoundary());
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("maxSearchDepth exceeded")));
  });

  it("denies when maxFilesWritten is exceeded", () => {
    const r = checkBoundary(safeUsage({ filesWritten: 10 }), permissiveBoundary());
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("maxFilesWritten exceeded")));
  });
});

describe("checkBoundary — source denials", () => {
  it("denies a disallowed source (denylist wins, case-insensitive)", () => {
    const r = checkBoundary(safeUsage({ sourcesUsed: ["Telegram"] }), permissiveBoundary());
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("disallowed source used")));
  });

  it("denies a source not on the declared allowlist", () => {
    const r = checkBoundary(safeUsage({ sourcesUsed: ["random-blog"] }), permissiveBoundary());
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("not on the allowed-sources allowlist")));
  });

  it("allows a source on the allowlist (case-insensitive)", () => {
    const r = checkBoundary(safeUsage({ sourcesUsed: ["Internal-Docs"] }), permissiveBoundary());
    assert.equal(r.allowed, true);
  });
});

describe("checkBoundary — capability flags fail closed", () => {
  it("denies external network when the flag is undefined", () => {
    const boundary = permissiveBoundary();
    delete boundary.externalNetworkAllowed;
    const r = checkBoundary(safeUsage({ usesExternalNetwork: true, usesLlm: false }), boundary);
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("external network not permitted")));
  });

  it("denies external network when the flag is explicitly false", () => {
    const r = checkBoundary(
      safeUsage({ usesExternalNetwork: true, usesLlm: false }),
      permissiveBoundary({ externalNetworkAllowed: false }),
    );
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("external network not permitted")));
  });

  it("denies LLM use when the flag is undefined", () => {
    const boundary = permissiveBoundary();
    delete boundary.llmAllowed;
    const r = checkBoundary(safeUsage({ usesExternalNetwork: false, usesLlm: true }), boundary);
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("LLM use not permitted")));
  });
});

describe("checkBoundary — multiple violations are all reported", () => {
  it("lists every failing boundary at once", () => {
    const r = checkBoundary(
      { elapsedTime: 99_999, cost: 9_999, searchDepth: 99, filesWritten: 99, sourcesUsed: ["telegram"] },
      permissiveBoundary(),
    );
    assert.equal(r.allowed, false);
    assert.ok(r.denials.length >= 5);
  });
});
