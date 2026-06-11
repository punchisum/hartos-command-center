/**
 * tests/autoheal-gate.test.ts — the guardrailed-autonomy double gate.
 *
 * armedAutohealAdapters returns an adapter ONLY when its class flag AND its own ALLOW_EXEC_* are
 * both armed, and never when the kill-switch is on. Disarmed-by-default is the safe floor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  armedAutohealAdapters,
  autohealClassFor,
  AUTOHEAL_PROPOSAL_HYGIENE_FLAG,
} from "../src/doctrine/autoheal-gate.js";

const ALL_EXEC = {
  ALLOW_EXEC_REJECT_DRAFTS: "true",
  ALLOW_EXEC_ARCHIVE_REJECTED: "true",
  ALLOW_EXEC_REFRESH_SYNC: "true",
} as const;

describe("autoheal gate (guardrailed autonomy)", () => {
  it("empty by default — nothing armed", () => {
    assert.equal(armedAutohealAdapters({}).size, 0);
  });

  it("class flag alone is NOT enough — the per-adapter ALLOW_EXEC_* must also be armed", () => {
    const armed = armedAutohealAdapters({ [AUTOHEAL_PROPOSAL_HYGIENE_FLAG]: "true" });
    assert.equal(armed.size, 0);
  });

  it("ALLOW_EXEC_* alone is NOT enough — the class flag must also be armed", () => {
    const armed = armedAutohealAdapters({ ...ALL_EXEC });
    assert.equal(armed.size, 0);
  });

  it("both keys arm exactly the matching adapter", () => {
    const armed = armedAutohealAdapters({
      [AUTOHEAL_PROPOSAL_HYGIENE_FLAG]: "true",
      ALLOW_EXEC_REJECT_DRAFTS: "true",
    });
    assert.deepEqual([...armed], ["reject-drafts"]);
  });

  it("class + all three exec flags arm all three internal adapters", () => {
    const armed = armedAutohealAdapters({ [AUTOHEAL_PROPOSAL_HYGIENE_FLAG]: "true", ...ALL_EXEC });
    assert.deepEqual([...armed].sort(), ["archive-rejected", "refresh-sync", "reject-drafts"]);
  });

  it("kill-switch overrides everything — empty even when twice-armed", () => {
    const armed = armedAutohealAdapters({
      [AUTOHEAL_PROPOSAL_HYGIENE_FLAG]: "true",
      ...ALL_EXEC,
      HARTOS_EXECUTION_KILL_SWITCH: "on",
    });
    assert.equal(armed.size, 0);
  });

  it("autohealClassFor maps internal adapters to the hygiene class and external ones to undefined", () => {
    assert.equal(autohealClassFor("reject-drafts")?.id, "proposal-hygiene");
    assert.equal(autohealClassFor("refresh-sync")?.id, "proposal-hygiene");
    assert.equal(autohealClassFor("clickup-move-status"), undefined);
    assert.equal(autohealClassFor("clickup-comment"), undefined);
  });

  it("no autoheal class includes any external adapter (autonomy is internal-by-construction)", () => {
    const external = new Set(["clickup-move-status", "clickup-comment"]);
    const fullyArmed = armedAutohealAdapters({ [AUTOHEAL_PROPOSAL_HYGIENE_FLAG]: "true", ...ALL_EXEC });
    for (const a of fullyArmed) assert.equal(external.has(a), false, `${a} must never be auto-healable`);
  });
});
