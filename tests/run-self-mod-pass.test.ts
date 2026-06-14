import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSelfModPassOnce, nextSelfModTask } from "../scripts/run-self-mod-pass.js";

describe("runSelfModPassOnce (gated no-op)", () => {
  it("disarmed (no flags) → silent no-op, returns []", async () => {
    const r = await runSelfModPassOnce({}, new Date("2026-06-14T00:00:00Z"));
    assert.deepEqual(r, []);
  });
  it("armed but no task source → no-op, returns []", async () => {
    const armed = { HARTOS_SELFMOD_AMENDMENT_APPROVED: "true", HARTOS_ALLOW_SELF_MOD: "true" };
    const r = await runSelfModPassOnce(armed, new Date("2026-06-14T00:00:00Z"));
    assert.deepEqual(r, [], "no task source in v1 → no-op even when armed");
  });
  it("nextSelfModTask returns null in v1 (no source yet)", () => {
    assert.equal(nextSelfModTask({}), null);
  });
});
