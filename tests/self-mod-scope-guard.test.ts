import { test } from "node:test";
import assert from "node:assert/strict";

import { isInSelfModScope } from "../src/execution/self-mod-scope-guard.js";

// Self-mod may only ever touch the project's OWN runtime. Everything that could leave the fence —
// secrets, config, external mutation adapters, anything outside src/ — is denied, fail-closed.
test("self-mod may NOT touch secrets or deploy config", () => {
  assert.equal(isInSelfModScope(".env").allowed, false);
  assert.equal(isInSelfModScope("secrets/cloudflare.key").allowed, false);
  assert.equal(isInSelfModScope("wrangler.cockpit.toml").allowed, false);
});

test("self-mod may NOT touch external mutation adapters", () => {
  assert.equal(isInSelfModScope("src/execution/adapters/clickup-comment.ts").allowed, false);
});

test("self-mod MAY touch its own runtime logic", () => {
  assert.equal(isInSelfModScope("src/sentinel/sentinel-liveness.ts").allowed, true);
});

test("fail-closed: paths outside the source tree are denied", () => {
  assert.equal(isInSelfModScope("../../etc/passwd").allowed, false);
  assert.equal(isInSelfModScope("node_modules/evil/index.js").allowed, false);
});

// SELF-PROTECTION: self-mod must never edit the machinery that fences, executes, or audits it —
// otherwise a single self-mod could weaken its own restraints and the SAME run would clear itself.
test("self-mod may NOT edit the doctrine (its own fence)", () => {
  assert.equal(isInSelfModScope("src/doctrine/doctrine.ts").allowed, false);
  assert.equal(isInSelfModScope("src/doctrine/execution-gate.ts").allowed, false);
  assert.equal(isInSelfModScope("src/doctrine/amendment-gate.ts").allowed, false);
});

test("self-mod may NOT edit the self-mod guards/verifiers themselves", () => {
  assert.equal(isInSelfModScope("src/execution/self-mod-scope-guard.ts").allowed, false);
  assert.equal(isInSelfModScope("src/execution/self-mod-post-verify.ts").allowed, false);
  assert.equal(isInSelfModScope("src/execution/self-mod-pre-verify.ts").allowed, false);
});

test("self-mod may NOT edit the W3 hand/baseline its run + rollback depend on", () => {
  assert.equal(isInSelfModScope("src/execution/claude-exec-baseline.ts").allowed, false);
  assert.equal(isInSelfModScope("src/execution/claude-exec-tool-scope.ts").allowed, false);
  assert.equal(isInSelfModScope("src/execution/claude-task-executor.ts").allowed, false);
});

test("self-mod may NOT edit the secret detector its post-verify relies on", () => {
  assert.equal(isInSelfModScope("src/llm/redaction.ts").allowed, false);
});

test("self-mod MAY still edit non-protected runtime logic (no over-deny)", () => {
  // Only redaction.ts is protected inside src/llm — the rest of the dir is fair game.
  assert.equal(isInSelfModScope("src/llm/ask-llm.ts").allowed, true);
  assert.equal(isInSelfModScope("src/cockpit/cockpit.ts").allowed, true);
});
