import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyExecutionOutcome } from "../src/execution/execution-verification.js";

test("verifyExecutionOutcome: clickup-move lands only when the card reached the target status", () => {
  const yes = verifyExecutionOutcome({
    strategy: "clickup-move",
    expected: { toStatus: "done" },
    observed: { status: "done" },
  });
  assert.equal(yes.landed, true);

  const no = verifyExecutionOutcome({
    strategy: "clickup-move",
    expected: { toStatus: "done" },
    observed: { status: "in progress" },
  });
  assert.equal(no.landed, false);
});

test("verifyExecutionOutcome fails CLOSED when the post-write re-read could not be made", () => {
  const r = verifyExecutionOutcome({
    strategy: "clickup-move",
    expected: { toStatus: "done" },
    observed: null,
  });
  assert.equal(r.landed, false);
});

test("verifyExecutionOutcome: refresh-sync lands only when the stale count actually fell", () => {
  const yes = verifyExecutionOutcome({
    strategy: "refresh-sync",
    expected: { staleBefore: 3 },
    observed: { staleCount: 1 },
  });
  assert.equal(yes.landed, true);

  const no = verifyExecutionOutcome({
    strategy: "refresh-sync",
    expected: { staleBefore: 3 },
    observed: { staleCount: 3 },
  });
  assert.equal(no.landed, false);
});

test("verifyExecutionOutcome: clickup-comment lands only when the idempotency marker is present", () => {
  const yes = verifyExecutionOutcome({
    strategy: "clickup-comment",
    expected: { marker: "hartos:abc123" },
    observed: { markers: ["other", "hartos:abc123"] },
  });
  assert.equal(yes.landed, true);

  const no = verifyExecutionOutcome({
    strategy: "clickup-comment",
    expected: { marker: "hartos:abc123" },
    observed: { markers: ["other"] },
  });
  assert.equal(no.landed, false);
});
