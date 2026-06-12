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
