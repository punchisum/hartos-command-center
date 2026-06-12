import { test } from "node:test";
import assert from "node:assert/strict";

import { verificationInputForCommand } from "../src/execution/verification-input.js";

// The bridge from a dispatched mutation command to the post-execution verifier: pick the right
// strategy + the EXPECTED end-state from the command, pairing it with a fresh observed re-read
// (the caller supplies `observed`). This is what the live dispatch path will call after a write.

test("verificationInputForCommand maps a clickup-move command to clickup-move verification with the target status", () => {
  const command = {
    adapterId: "clickup-move-status",
    proposal: { id: "p1", status: "approved_for_execution", expiresAt: null },
    target: { cardId: "c1", cardName: "Card", fromStatus: "in progress", toStatus: "done" },
    store: {},
  };

  const vi = verificationInputForCommand(command as never, { status: "done" });

  assert.ok(vi, "expected a verification input for clickup-move");
  assert.equal(vi.strategy, "clickup-move");
  assert.equal(vi.expected.toStatus, "done");
  assert.deepEqual(vi.observed, { status: "done" });
});

test("verificationInputForCommand returns null for adapters with no external re-verify yet", () => {
  const command = { adapterId: "refresh-sync", proposal: { id: "p2" } };
  assert.equal(verificationInputForCommand(command as never, { staleCount: 0 }), null);
});
