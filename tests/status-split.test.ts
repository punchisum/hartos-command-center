/**
 * tests/status-split.test.ts — Live Organism P10: split status (operator ≠ system).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeStatusSplit } from "../src/cockpit/status-split.js";
import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";

describe("computeStatusSplit", () => {
  const reg = resolveMetaAgentRegistry({ now: "2026-06-10T12:00:00Z" });
  const split = computeStatusSplit({
    registry: reg,
    operator: { band: "red", headline: "Training/recovery risk today" },
    freshness: { staleCount: 1, unavailableCount: 0 },
    proposals: { aging: 1, pending: 2 },
  });

  it("produces the six distinct status lenses", () => {
    assert.deepEqual(
      split.groups.map((g) => g.key).sort(),
      ["fleet", "freshness", "operator", "proposals", "provider", "system"],
    );
  });

  it("keeps the operator's body status SEPARATE from system — training RED ≠ system broken", () => {
    const operator = split.groups.find((g) => g.key === "operator")!;
    assert.equal(operator.band, "red");
    assert.notEqual(split.systemBand, "red", "system must NOT be red because the operator is");
    assert.equal(split.groups.find((g) => g.key === "system")!.band, "green");
  });

  it("reflects the ops-401 outage as provider RED + fleet not all-green (honest)", () => {
    assert.equal(split.groups.find((g) => g.key === "provider")!.band, "red");
    assert.notEqual(split.groups.find((g) => g.key === "fleet")!.band, "green");
  });

  it("freshness + proposals bands reflect their inputs", () => {
    assert.equal(split.groups.find((g) => g.key === "freshness")!.band, "amber");
    assert.equal(split.groups.find((g) => g.key === "proposals")!.band, "amber");
  });
});
