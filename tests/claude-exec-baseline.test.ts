/**
 * tests/claude-exec-baseline.test.ts — W3: git baseline capture + run attribution (fake GitProbe).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  captureBaseline,
  changedByRun,
  parsePorcelainZ,
  realGitProbe,
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

describe("parsePorcelainZ", () => {
  const NUL = "\0";

  it("parses normal modified + untracked entries", () => {
    const out = ` M src/a.ts${NUL}?? src/b.ts${NUL}`;
    assert.deepEqual(parsePorcelainZ(out), ["src/a.ts", "src/b.ts"]);
  });

  it("keeps spaced/unicode paths literal (no C-quoting under -z)", () => {
    const out = `?? src/weird file.ts${NUL} M src/café.ts${NUL}`;
    assert.deepEqual(parsePorcelainZ(out), ["src/weird file.ts", "src/café.ts"]);
  });

  it("emits BOTH the new and original path for a rename", () => {
    // -z rename: "R  <new>" then a bare NUL field "<old>".
    const out = `R  src/new.ts${NUL}src/old.ts${NUL} M src/other.ts${NUL}`;
    assert.deepEqual(parsePorcelainZ(out), ["src/new.ts", "src/old.ts", "src/other.ts"]);
  });

  it("empty output → []", () => {
    assert.deepEqual(parsePorcelainZ(""), []);
  });
});

// Integration: the REAL probe against a real git repo. This is the regression guard for the trim bug —
// `git status --porcelain -z` leads a worktree-only change with a SIGNIFICANT space (" M path"); a
// stray trim() ate it and slice(3) then dropped a path char ("alpha.ts" → "lpha.ts", "src/…" → "rc/…").
describe("realGitProbe (integration — real git)", () => {
  function tempRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "hartos-probe-"));
    const g = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@example.com"]);
    g(["config", "user.name", "t"]);
    g(["config", "commit.gpgsign", "false"]);
    return dir;
  }

  it("dirtyPaths returns the UNMANGLED path for a worktree-modified file (leading-space status)", () => {
    const dir = tempRepo();
    try {
      const g = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "alpha.ts"), "one\n");
      g(["add", "-A"]);
      g(["commit", "-qm", "init"]);
      // Modify WITHOUT staging → porcelain status " M alpha.ts" (leading space is the index column).
      writeFileSync(join(dir, "alpha.ts"), "two\n");
      assert.deepEqual(realGitProbe.dirtyPaths(dir), ["alpha.ts"], "leading status space must not be eaten");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("headSha returns a clean 40-hex sha (trailing newline trimmed)", () => {
    const dir = tempRepo();
    try {
      const g = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "f.ts"), "x\n");
      g(["add", "-A"]);
      g(["commit", "-qm", "init"]);
      assert.match(realGitProbe.headSha(dir), /^[0-9a-f]{40}$/, "sha must be trimmed, no whitespace");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
