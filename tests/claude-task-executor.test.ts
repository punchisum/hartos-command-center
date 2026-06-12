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
