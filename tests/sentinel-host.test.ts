/**
 * tests/sentinel-host.test.ts — local heartbeats are all host-bound (they die when the PC is off).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gatherLocalHeartbeats } from "../src/sentinel/sentinel-host.js";

describe("gatherLocalHeartbeats", () => {
  it("tags every gathered heartbeat host-bound", () => {
    // No env ⇒ no memory-capture beat; the EVIDENCE_DIRS beats are still produced (lastEvidenceAt
    // may be null when the dir is absent), and every one must be host-bound.
    const beats = gatherLocalHeartbeats({});
    assert.ok(beats.length > 0);
    for (const b of beats) {
      assert.equal(b.hostBound, true, `${b.agentId} must be host-bound`);
    }
  });
});
