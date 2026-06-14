import { test } from "node:test";
import assert from "node:assert/strict";
import { ORGAN_ROSTER } from "../src/organs/organ-roster.js";

const EXPECTED = [
  "wolverine", "beezulbub", "prophet", "rinnegan", "research",
  "factory", "council", "sentinel", "fitness", "ops", "cockpit",
];
const VALID_KINDS = ["worker", "daemon", "daemon-supervised", "external-webhook", "projection"];

test("roster has all 11 approved organs, unique ids", () => {
  assert.equal(ORGAN_ROSTER.length, 11);
  const ids = ORGAN_ROSTER.map((o) => o.agentId).sort();
  assert.deepEqual(ids, [...EXPECTED].sort());
});

test("every organ has a valid runtime_kind and a detail page", () => {
  for (const o of ORGAN_ROSTER) {
    assert.ok(VALID_KINDS.includes(o.runtimeKind), `${o.agentId} bad runtime_kind ${o.runtimeKind}`);
    assert.match(o.detailPage, /^\/agent\//, `${o.agentId} bad detail page`);
    assert.ok(o.stalenessThresholdSec > 0, `${o.agentId} needs a staleness threshold`);
  }
});

test("constraint #8 — only the Factory may write external", () => {
  const external = ORGAN_ROSTER.filter((o) => o.canWriteExternal).map((o) => o.agentId);
  assert.deepEqual(external, ["factory"]);
});
