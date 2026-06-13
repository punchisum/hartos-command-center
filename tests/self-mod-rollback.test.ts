/**
 * tests/self-mod-rollback.test.ts — P6: restore the working tree to the pre-self-mod baseline (fake git).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollbackSelfMod, type SelfModRollbackGit } from "../src/execution/self-mod-rollback.js";
import { type ExecBaseline } from "../src/execution/claude-exec-baseline.js";

const BASE: ExecBaseline = { headSha: "base-sha", preexistingDirty: [] };

/** Records calls; `existed` scripts which paths existed at baseline. */
function fakeGit(existed: string[], opts: { failRestore?: boolean; failRemove?: boolean; failExisted?: boolean } = {}) {
  const calls = { restore: [] as string[], remove: [] as string[] };
  const git: SelfModRollbackGit = {
    existedAtBaseline: (_cwd, _sha, paths) => {
      if (opts.failExisted) throw new Error("cat-file boom");
      return paths.filter((p) => existed.includes(p));
    },
    restoreToBaseline: (_cwd, _sha, paths) => {
      if (opts.failRestore) throw new Error("checkout boom");
      calls.restore.push(...paths);
    },
    removeFiles: (_cwd, paths) => {
      if (opts.failRemove) throw new Error("clean boom");
      calls.remove.push(...paths);
    },
  };
  return { git, calls };
}

describe("rollbackSelfMod", () => {
  it("restores baseline-existing files and removes newly-created ones", () => {
    const { git, calls } = fakeGit(["src/existing.ts"]);
    const r = rollbackSelfMod("/repo", BASE, ["src/existing.ts", "src/new.ts"], git);
    assert.equal(r.ok, true);
    assert.deepEqual(r.restored, ["src/existing.ts"]);
    assert.deepEqual(r.removed, ["src/new.ts"]);
    assert.deepEqual(calls.restore, ["src/existing.ts"]);
    assert.deepEqual(calls.remove, ["src/new.ts"]);
    assert.deepEqual(r.errors, []);
  });

  it("all files existed at baseline → only restores", () => {
    const { git, calls } = fakeGit(["a.ts", "b.ts"]);
    const r = rollbackSelfMod("/repo", BASE, ["a.ts", "b.ts"], git);
    assert.deepEqual(r.restored, ["a.ts", "b.ts"]);
    assert.deepEqual(r.removed, []);
    assert.deepEqual(calls.remove, []);
    assert.equal(r.ok, true);
  });

  it("all files new → only removes", () => {
    const { git, calls } = fakeGit([]);
    const r = rollbackSelfMod("/repo", BASE, ["x.ts", "y.ts"], git);
    assert.deepEqual(r.removed, ["x.ts", "y.ts"]);
    assert.deepEqual(r.restored, []);
    assert.deepEqual(calls.restore, []);
    assert.equal(r.ok, true);
  });

  it("empty change set → ok, no git calls", () => {
    const { git, calls } = fakeGit([]);
    const r = rollbackSelfMod("/repo", BASE, [], git);
    assert.equal(r.ok, true);
    assert.deepEqual(calls.restore, []);
    assert.deepEqual(calls.remove, []);
  });

  it("restore failure → ok:false with error, still attempts remove", () => {
    const { git, calls } = fakeGit(["a.ts"], { failRestore: true });
    const r = rollbackSelfMod("/repo", BASE, ["a.ts", "new.ts"], git);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /restore failed/.test(e)));
    assert.deepEqual(calls.remove, ["new.ts"]);
  });

  it("existedAtBaseline failure → ok:false, nothing restored/removed", () => {
    const { git, calls } = fakeGit(["a.ts"], { failExisted: true });
    const r = rollbackSelfMod("/repo", BASE, ["a.ts"], git);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /existedAtBaseline failed/.test(e)));
    assert.deepEqual(calls.restore, []);
    assert.deepEqual(calls.remove, []);
  });
});
