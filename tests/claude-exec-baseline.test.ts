/**
 * tests/claude-exec-baseline.test.ts — W3: git baseline capture + run attribution (fake GitProbe).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  captureBaseline,
  changedByRun,
  type GitProbe,
  type ExecBaseline,
} from "../src/execution/claude-exec-baseline.js";

/** A scripted GitProbe: fixed head, and a queue of dirty-path snapshots returned in order. */
function fakeGit(head: string, snapshots: string[][]): GitProbe {
  let i = 0;
  return {
    headSha: () => head,
    dirtyPaths: () => snapshots[Math.min(i++, snapshots.length - 1)],
  };
}

describe("captureBaseline", () => {
  it("records the HEAD sha and the pre-existing dirty paths", () => {
    const git = fakeGit("abc123", [["src/dirty-already.ts"]]);
    const base = captureBaseline("/repo", git);
    assert.equal(base.headSha, "abc123");
    assert.deepEqual(base.preexistingDirty, ["src/dirty-already.ts"]);
  });
});

describe("changedByRun", () => {
  it("attributes only NEW dirty paths to the run", () => {
    // before: one already-dirty file; after: that file + two the run touched.
    const git = fakeGit("abc123", [
      ["src/dirty-already.ts"],
      ["src/dirty-already.ts", "src/new-a.ts", "src/new-b.ts"],
    ]);
    const base = captureBaseline("/repo", git);
    const changed = changedByRun("/repo", base, git);
    assert.deepEqual(changed.sort(), ["src/new-a.ts", "src/new-b.ts"]);
  });

  it("returns [] when the run touched nothing", () => {
    const git = fakeGit("abc123", [["src/x.ts"], ["src/x.ts"]]);
    const base = captureBaseline("/repo", git);
    assert.deepEqual(changedByRun("/repo", base, git), []);
  });
});
