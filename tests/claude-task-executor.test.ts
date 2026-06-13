/**
 * tests/claude-task-executor.test.ts — the Claude-CLI execution hand (gating + dispatch; runner injected).
 * Disarmed by default; kill-switch + token gates; honest skip vs execute. No real process spawned.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claudeExecuteArmed,
  runClaudeTask,
  CLAUDE_EXECUTE_ARM_ENV,
  KILL_SWITCH_ENV,
  type ClaudeTaskRunner,
} from "../src/execution/claude-task-executor.js";
import { type GitProbe } from "../src/execution/claude-exec-baseline.js";

const ARMED = { [CLAUDE_EXECUTE_ARM_ENV]: "true", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test" };

describe("claudeExecuteArmed", () => {
  it("disarmed by default (no flag)", () => {
    const g = claudeExecuteArmed({ CLAUDE_CODE_OAUTH_TOKEN: "t" });
    assert.equal(g.armed, false);
    assert.match(g.reason, /disarmed/);
  });
  it("kill-switch ON blocks even when armed", () => {
    const g = claudeExecuteArmed({ ...ARMED, [KILL_SWITCH_ENV]: "on" });
    assert.equal(g.armed, false);
    assert.match(g.reason, /kill-switch/i);
  });
  it("armed flag without a token is not armed", () => {
    const g = claudeExecuteArmed({ [CLAUDE_EXECUTE_ARM_ENV]: "true" });
    assert.equal(g.armed, false);
    assert.match(g.reason, /token/i);
  });
  it("armed when flag + token set and no kill-switch", () => {
    assert.equal(claudeExecuteArmed(ARMED).armed, true);
  });
});

describe("runClaudeTask", () => {
  it("disarmed ⇒ honest skip, never invokes the runner", async () => {
    let ran = false;
    const runner: ClaudeTaskRunner = async () => { ran = true; return { ok: true, text: "x" }; };
    const r = await runClaudeTask("apply fix", { CLAUDE_CODE_OAUTH_TOKEN: "t" }, runner);
    assert.equal(r.ok, false);
    assert.match(r.detail, /skipped — disarmed/);
    assert.equal(ran, false, "must not spawn claude when disarmed");
  });

  it("empty task ⇒ skip even when armed", async () => {
    const r = await runClaudeTask("   ", ARMED, async () => ({ ok: true, text: "x" }));
    assert.equal(r.ok, false);
    assert.match(r.detail, /empty task/);
  });

  it("armed + runner success ⇒ ok with the summary", async () => {
    const runner: ClaudeTaskRunner = async (prompt) => {
      assert.match(prompt, /APPROVED TASK:/);
      assert.match(prompt, /add a null check/);
      return { ok: true, text: "Edited src/foo.ts to add the guard." };
    };
    const r = await runClaudeTask("add a null check to foo", ARMED, runner);
    assert.equal(r.ok, true);
    assert.match(r.detail, /claude applied/);
    assert.match(r.detail, /Edited src\/foo\.ts/);
  });

  it("armed + runner failure ⇒ not ok (honest)", async () => {
    const r = await runClaudeTask("do thing", ARMED, async () => ({ ok: false, text: "model error" }));
    assert.equal(r.ok, false);
    assert.match(r.detail, /failed: model error/);
  });

  it("refuses a raw agent-build (spec-interrogation gate) without spawning claude", async () => {
    let ran = false;
    const runner: ClaudeTaskRunner = async () => { ran = true; return { ok: true, text: "x" }; };
    const r = await runClaudeTask("build a new crypto portfolio agent", ARMED, runner);
    assert.equal(r.ok, false);
    assert.match(r.detail, /refused|interrogat/i);
    assert.equal(ran, false, "must not blind-build an un-interrogated agent");
  });

  it("never throws — a throwing runner is caught", async () => {
    const r = await runClaudeTask("do thing", ARMED, async () => { throw new Error("boom"); });
    assert.equal(r.ok, false);
    assert.match(r.detail, /threw: boom/);
  });
});

describe("runClaudeTask — W3 baseline + scope", () => {
  // A fake GitProbe: fixed head; first dirtyPaths() call = before, second = after.
  function fakeGit(snapshots: string[][]): GitProbe {
    let i = 0;
    return {
      headSha: () => "base-sha-001",
      dirtyPaths: () => snapshots[Math.min(i++, snapshots.length - 1)],
    };
  }

  it("success ⇒ returns the baseline sha and the files the run changed", async () => {
    const git = fakeGit([[], ["src/foo.ts"]]);
    const runner: ClaudeTaskRunner = async () => ({ ok: true, text: "Edited src/foo.ts." });
    const r = await runClaudeTask("add a null check to foo", ARMED, runner, git);
    assert.equal(r.ok, true);
    assert.equal(r.baselineSha, "base-sha-001");
    assert.deepEqual(r.filesChanged, ["src/foo.ts"]);
  });

  it("refuses (honest skip) when the baseline can't be captured — never spawns", async () => {
    let ran = false;
    const brokenGit: GitProbe = {
      headSha: () => { throw new Error("not a git repo"); },
      dirtyPaths: () => [],
    };
    const runner: ClaudeTaskRunner = async () => { ran = true; return { ok: true, text: "x" }; };
    const r = await runClaudeTask("add a null check to foo", ARMED, runner, brokenGit);
    assert.equal(r.ok, false);
    assert.match(r.detail, /baseline/i);
    assert.equal(ran, false, "must not spawn when it cannot anchor a baseline");
  });

  it("disarmed skip carries no baseline (gate runs before any git)", async () => {
    const r = await runClaudeTask("apply fix", { CLAUDE_CODE_OAUTH_TOKEN: "t" }, async () => ({ ok: true, text: "x" }));
    assert.equal(r.ok, false);
    assert.equal(r.baselineSha ?? null, null);
  });
});
