/**
 * tests/beezulbub-manual-clone.test.ts
 *
 * Tests for manual clone workflow and URL detection.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isGitUrl,
  repoUrlToLocalName,
  generateCloneCommand,
  generateCloneInstructions,
  checkClonePermission,
} from "../src/beezulbub/manual-clone.js";
import { digestLocalRepo } from "../src/beezulbub/digest.js";

// ─── isGitUrl ────────────────────────────────────────────────────────────────

describe("isGitUrl", () => {
  test("detects https://github.com URL", () => {
    assert.equal(isGitUrl("https://github.com/user/repo"), true);
  });

  test("detects https://gitlab.com URL", () => {
    assert.equal(isGitUrl("https://gitlab.com/user/repo"), true);
  });

  test("detects git@ SSH URL", () => {
    assert.equal(isGitUrl("git@github.com:user/repo.git"), true);
  });

  test("does not flag local path as git URL", () => {
    assert.equal(isGitUrl("/local/path/to/repo"), false);
    assert.equal(isGitUrl("tests/fixtures/beezulbub/clean-dashboard"), false);
  });

  test("does not flag relative path as git URL", () => {
    assert.equal(isGitUrl("../my-repo"), false);
  });
});

// ─── repoUrlToLocalName ───────────────────────────────────────────────────────

describe("repoUrlToLocalName", () => {
  test("converts GitHub URL to local name", () => {
    const name = repoUrlToLocalName("https://github.com/user/my-repo");
    assert.ok(name.includes("user") || name.includes("my-repo"));
    assert.ok(!name.includes("https://"));
  });

  test("removes .git suffix", () => {
    const name = repoUrlToLocalName("https://github.com/user/repo.git");
    assert.ok(!name.endsWith(".git"));
  });

  test("returns safe characters only", () => {
    const name = repoUrlToLocalName("https://github.com/user/repo");
    assert.ok(/^[A-Za-z0-9_-]+$/.test(name), `Name should be alphanumeric+dash: ${name}`);
  });
});

// ─── generateCloneCommand ─────────────────────────────────────────────────────

describe("generateCloneCommand", () => {
  test("generates valid git clone command", () => {
    const cmd = generateCloneCommand("https://github.com/user/repo");
    assert.ok(cmd.startsWith("git clone"));
    assert.ok(cmd.includes("https://github.com/user/repo"));
    assert.ok(cmd.includes("external-repos"));
  });

  test("never contains secrets", () => {
    const cmd = generateCloneCommand("https://github.com/user/repo");
    const secretPattern = /[A-Za-z0-9+=_-]{40,}/;
    assert.ok(!secretPattern.test(cmd), "Clone command must not contain secrets");
  });
});

// ─── generateCloneInstructions ────────────────────────────────────────────────

describe("generateCloneInstructions", () => {
  test("includes clone step", () => {
    const instructions = generateCloneInstructions("https://github.com/user/repo");
    assert.ok(instructions.includes("git clone"));
  });

  test("includes digest step", () => {
    const instructions = generateCloneInstructions("https://github.com/user/repo", "dashboard_layout");
    assert.ok(instructions.includes("beezulbub:digest") || instructions.includes("digest"));
    assert.ok(instructions.includes("dashboard_layout"));
  });

  test("mentions external-repos directory", () => {
    const instructions = generateCloneInstructions("https://github.com/user/repo");
    assert.ok(instructions.includes("external-repos"));
  });
});

// ─── checkClonePermission ────────────────────────────────────────────────────

describe("checkClonePermission", () => {
  test("returns not allowed when gate not set", () => {
    const result = checkClonePermission(
      "https://github.com/user/repo",
      {}
    );
    assert.equal(result.allowed, false);
    assert.ok(result.message.includes("BEEZULBUB_ALLOW_CLONE") || result.message.includes("clone"));
  });

  test("returns allowed when BEEZULBUB_ALLOW_CLONE=true", () => {
    const result = checkClonePermission(
      "https://github.com/user/repo",
      { BEEZULBUB_ALLOW_CLONE: "true" }
    );
    assert.equal(result.allowed, true);
    assert.ok(result.clonePath !== null);
  });

  test("always includes clone command", () => {
    const result = checkClonePermission(
      "https://github.com/user/repo",
      {}
    );
    assert.ok(result.cloneCommand.includes("git clone"));
  });

  test("always includes full instructions", () => {
    const result = checkClonePermission(
      "https://github.com/user/repo",
      {}
    );
    assert.ok(result.fullInstructions.includes("git clone"));
    assert.ok(result.fullInstructions.includes("beezulbub:digest") || result.fullInstructions.includes("digest"));
  });
});

// ─── digestLocalRepo with URL input ──────────────────────────────────────────

describe("digestLocalRepo — URL returns manual_required error", () => {
  test("throws with clone instructions when GitHub URL is passed", async () => {
    await assert.rejects(
      () => digestLocalRepo({ localPath: "https://github.com/user/repo" }),
      /manual_required|clone/,
      "Should throw with manual_required/clone instruction"
    );
  });

  test("error contains git clone command", async () => {
    try {
      await digestLocalRepo({ localPath: "https://github.com/user/repo" });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("git clone") || err.message.includes("clone"));
    }
  });

  test("error does not contain secrets", async () => {
    try {
      await digestLocalRepo({ localPath: "https://github.com/user/repo" });
    } catch (err) {
      if (err instanceof Error) {
        const secretPattern = /[A-Za-z0-9+=_-]{40,}/;
        assert.ok(!secretPattern.test(err.message), "Error must not contain secret-like values");
      }
    }
  });
});
