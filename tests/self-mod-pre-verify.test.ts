/**
 * tests/self-mod-pre-verify.test.ts — P6: the pre-modification gate (clean-baseline anchor, fake git).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preVerifySelfMod } from "../src/execution/self-mod-pre-verify.js";
import { type GitProbe } from "../src/execution/claude-exec-baseline.js";

function fakeGit(head: string, dirty: string[]): GitProbe {
  return { headSha: () => head, dirtyPaths: () => dirty };
}

describe("preVerifySelfMod", () => {
  it("ok on a clean tree — captures the baseline anchor", () => {
    const r = preVerifySelfMod("/repo", fakeGit("sha-abc", []));
    assert.equal(r.ok, true);
    assert.equal(r.baseline?.headSha, "sha-abc");
    assert.deepEqual(r.baseline?.preexistingDirty, []);
  });

  it("refuses a dirty tree (self-mod needs a clean baseline)", () => {
    const r = preVerifySelfMod("/repo", fakeGit("sha-abc", ["src/already.ts"]));
    assert.equal(r.ok, false);
    assert.match(r.reason, /not clean/i);
    // baseline is still returned for diagnostics.
    assert.equal(r.baseline?.headSha, "sha-abc");
  });

  it("refuses when the baseline cannot be captured (not a git repo)", () => {
    const broken: GitProbe = {
      headSha: () => { throw new Error("not a git repo"); },
      dirtyPaths: () => [],
    };
    const r = preVerifySelfMod("/repo", broken);
    assert.equal(r.ok, false);
    assert.match(r.reason, /cannot capture baseline/i);
    assert.equal(r.baseline, undefined);
  });
});
