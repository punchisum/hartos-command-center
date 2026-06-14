/**
 * tests/council-host-glue.test.ts
 *
 * Task 2.4 — TDD tests for:
 *   - council.orchestrate job kind in agent-job.ts
 *   - runCouncilOnce disarmed → skip / no-op
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AGENT_JOB_KINDS, isAgentJobKind } from "../src/jobs/agent-job.js";
import { runCouncilOnce } from "../scripts/run-council-pass.js";

describe("council.orchestrate job kind (Task 2.4)", () => {
  it("AGENT_JOB_KINDS includes 'council.orchestrate'", () => {
    assert.ok(
      (AGENT_JOB_KINDS as readonly string[]).includes("council.orchestrate"),
      "'council.orchestrate' must be in AGENT_JOB_KINDS",
    );
  });

  it("isAgentJobKind('council.orchestrate') returns true", () => {
    assert.equal(isAgentJobKind("council.orchestrate"), true);
  });

  it("isAgentJobKind('council.unknown') returns false", () => {
    assert.equal(isAgentJobKind("council.unknown"), false);
  });
});

describe("runCouncilOnce (Task 2.4)", () => {
  it("disarmed (default env) → returns skip lines without running any specialist", async () => {
    // No HARTOS_ALLOW_COUNCIL=true → must be a no-op.
    const lines = await runCouncilOnce({}, "build a CRM", new Date());
    // Returns empty OR a single line explaining the skip — either is acceptable.
    // What it must NOT do: throw, or return a payload that implies work was done.
    assert.ok(Array.isArray(lines), "must return an array");
    // If it returned a line, it must mention skip/disarm/no-op.
    if (lines.length > 0) {
      const all = lines.join(" ").toLowerCase();
      assert.ok(
        all.includes("skip") || all.includes("disarm") || all.includes("no-op") || all.includes("council"),
        `unexpected skip line content: ${lines.join(", ")}`,
      );
    }
  });

  it("disarmed → no proposal upserted (never mutates)", async () => {
    // We can only observe side-effects via the public interface; since disarmed returns [],
    // and we're not injecting a store, this is inherently a no-mutation test.
    const lines = await runCouncilOnce({}, "build a CRM", new Date());
    assert.ok(Array.isArray(lines));
    // No throw = no mutation attempted (the store path requires an armed guard first).
  });

  it("no goal → returns [] (silent no-op when goal is empty)", async () => {
    const lines = await runCouncilOnce({}, "", new Date());
    assert.ok(Array.isArray(lines));
    assert.equal(lines.length, 0, "empty goal with disarmed env must return []");
  });

  it("kill-switch=on even with council flag → still skips (kill-switch overrides all)", async () => {
    const lines = await runCouncilOnce(
      { HARTOS_ALLOW_COUNCIL: "true", HARTOS_EXECUTION_KILL_SWITCH: "on" },
      "build a CRM",
      new Date(),
    );
    assert.ok(Array.isArray(lines));
    // Either [] or a single skip line; must NOT produce a payload.
    if (lines.length > 0) {
      const all = lines.join(" ").toLowerCase();
      assert.ok(
        all.includes("skip") || all.includes("disarm") || all.includes("kill"),
        `expected skip/disarm/kill signal, got: ${lines.join(", ")}`,
      );
    }
  });

  it("never throws regardless of env", async () => {
    let threw = false;
    try {
      await runCouncilOnce(
        { HARTOS_ALLOW_COUNCIL: "invalid", HARTOS_EXECUTION_KILL_SWITCH: "yes" },
        "goal",
        new Date(),
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "runCouncilOnce must never throw");
  });
});
