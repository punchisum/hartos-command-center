/**
 * tests/artifact-retention.test.ts — the PURE retention planner.
 * Deterministic: same inventory ⇒ same plan; newest-N survive; planner never deletes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_KEEP_PER_DIR,
  describeRetentionPlan,
  planRetention,
  type ArtifactDirInventory,
} from "../src/ops/artifact-retention.js";

function inv(dir: string, n: number, startMtime = 1000): ArtifactDirInventory {
  return {
    dir,
    files: Array.from({ length: n }, (_, i) => ({
      name: `run-${String(i).padStart(3, "0")}.json`,
      mtimeMs: startMtime + i,
      bytes: 100,
    })),
  };
}

describe("planRetention", () => {
  it("keeps the newest N per directory and prunes the rest", () => {
    const plan = planRetention([inv("cockpit-reports", 30)], 25);
    const d = plan.dirs[0]!;
    assert.equal(d.total, 30);
    assert.equal(d.keep.length, 25);
    assert.equal(d.prune.length, 5);
    // the pruned files are the OLDEST five (lowest mtimes)
    assert.deepEqual(
      d.prune.map((f) => f.name).sort(),
      ["run-000.json", "run-001.json", "run-002.json", "run-003.json", "run-004.json"],
    );
    assert.equal(d.pruneBytes, 500);
    assert.equal(plan.totalPrune, 5);
    assert.equal(plan.totalPruneBytes, 500);
  });

  it("a directory at or under the window prunes nothing", () => {
    const plan = planRetention([inv("hartos-reports", 10)], 25);
    assert.equal(plan.dirs[0]!.prune.length, 0);
    assert.equal(plan.totalPrune, 0);
  });

  it("is deterministic on mtime ties (name desc breaks the tie)", () => {
    const tied: ArtifactDirInventory = {
      dir: "reports",
      files: [
        { name: "a.json", mtimeMs: 5, bytes: 1 },
        { name: "b.json", mtimeMs: 5, bytes: 1 },
        { name: "c.json", mtimeMs: 5, bytes: 1 },
      ],
    };
    const p1 = planRetention([tied], 2);
    const p2 = planRetention([{ ...tied, files: [...tied.files].reverse() }], 2);
    assert.deepEqual(p1.dirs[0]!.prune.map((f) => f.name), p2.dirs[0]!.prune.map((f) => f.name));
    assert.deepEqual(p1.dirs[0]!.prune.map((f) => f.name), ["a.json"]);
  });

  it("default window matches the exported constant; floor + clamp on weird input", () => {
    assert.equal(planRetention([inv("reports", 30)]).keepPerDir, DEFAULT_KEEP_PER_DIR);
    assert.equal(planRetention([], 7.9).keepPerDir, 7);
    assert.equal(planRetention([], -3).keepPerDir, 0);
  });

  it("describeRetentionPlan is honest: totals + per-dir lines, empty dirs omitted", () => {
    const text = describeRetentionPlan(
      planRetention([inv("cockpit-reports", 30), { dir: "empty-dir", files: [] }], 25),
    );
    assert.match(text, /keep newest 25 per directory/);
    assert.match(text, /30 file\(s\) inventoried; 5 prune candidate\(s\)/);
    assert.match(text, /cockpit-reports: 30 file\(s\) → keep 25, prune 5/);
    assert.doesNotMatch(text, /empty-dir/);
  });
});
