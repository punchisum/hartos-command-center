/**
 * tests/claude-exec-tool-scope.test.ts — W3: the code-edit-only tool-scope guard (pure, fail-closed).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertCodeEditScope,
  CODE_EDIT_TOOLS,
} from "../src/execution/claude-exec-tool-scope.js";

describe("assertCodeEditScope", () => {
  it("accepts the exact code-edit tool list", () => {
    const v = assertCodeEditScope("Read,Edit,Write,Glob,Grep");
    assert.equal(v.safe, true);
    assert.deepEqual(v.tools, ["Read", "Edit", "Write", "Glob", "Grep"]);
  });

  it("tolerates whitespace and ordering", () => {
    const v = assertCodeEditScope(" Grep , Read ,Edit ");
    assert.equal(v.safe, true);
    assert.deepEqual(v.tools, ["Grep", "Read", "Edit"]);
  });

  it("fails closed when Bash is smuggled in", () => {
    const v = assertCodeEditScope("Read,Edit,Bash");
    assert.equal(v.safe, false);
    assert.match(v.reason, /Bash/);
  });

  it("fails closed on network/agent tools", () => {
    for (const bad of ["WebFetch", "WebSearch", "Task", "NotebookEdit"]) {
      const v = assertCodeEditScope(`Read,${bad}`);
      assert.equal(v.safe, false, `${bad} must be rejected`);
      assert.match(v.reason, new RegExp(bad));
    }
  });

  it("fails closed on an empty scope", () => {
    const v = assertCodeEditScope("   ");
    assert.equal(v.safe, false);
    assert.match(v.reason, /empty/);
  });

  it("CODE_EDIT_TOOLS contains no command/network tool", () => {
    for (const banned of ["Bash", "WebFetch", "WebSearch", "Task"]) {
      assert.equal(CODE_EDIT_TOOLS.includes(banned as never), false);
    }
  });
});
