/**
 * tests/runtime-layer-gates.test.ts
 *
 * Phase 18D — pure gate matrix. No fs, no network. Proves the one all-or-nothing gate opens only
 * when every key/confirm is present and consistent; production is hard-refused; the typo guards
 * (worker name, bot id) reject mismatches; the bot-id confirm is enforced only when a webhook step
 * is planned; and credential presence is surfaced as booleans only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readRuntimeGates,
  runtimeGateNames,
  PROVISION_GATE,
  MUTATION_CONFIRM_GATE,
  OVERWRITE_GATE,
  TARGET_ENV_KEY,
  WORKER_NAME_CONFIRM_KEY,
  BOT_ID_CONFIRM_KEY,
} from "../src/runtime-provision/runtime-layer-gates.js";

const WORKER = "tax-agent";
const BOT = "123456";

const FULL = {
  [PROVISION_GATE]: "true",
  [MUTATION_CONFIRM_GATE]: "true",
  [TARGET_ENV_KEY]: "staging",
  [WORKER_NAME_CONFIRM_KEY]: WORKER,
  [BOT_ID_CONFIRM_KEY]: BOT,
};
const EXP = { workerName: WORKER, botId: BOT, webhookStepPlanned: true };

describe("18D runtime-layer-gates (pure)", () => {
  it("all closed → not allowed, lists every missing gate", () => {
    const g = readRuntimeGates({}, EXP);
    assert.equal(g.allowProvision, false);
    assert.equal(g.hardBlock, null);
    const joined = g.missing.join(" ");
    assert.match(joined, new RegExp(PROVISION_GATE));
    assert.match(joined, new RegExp(MUTATION_CONFIRM_GATE));
    assert.match(joined, new RegExp(TARGET_ENV_KEY));
    assert.match(joined, new RegExp(WORKER_NAME_CONFIRM_KEY));
    assert.match(joined, new RegExp(BOT_ID_CONFIRM_KEY));
  });

  it("full gates + matching expectations → allowed", () => {
    const g = readRuntimeGates(FULL, EXP);
    assert.equal(g.allowProvision, true);
    assert.deepEqual(g.missing, []);
    assert.equal(g.targetEnv, "staging");
  });

  it("production label → hard block, never allowed even with gates set", () => {
    const g = readRuntimeGates({ ...FULL, [TARGET_ENV_KEY]: "production" }, EXP);
    assert.equal(g.allowProvision, false);
    assert.match(g.hardBlock ?? "", /refused/i);
  });

  it("worker-name confirm mismatch → blocked (typo guard)", () => {
    const g = readRuntimeGates({ ...FULL, [WORKER_NAME_CONFIRM_KEY]: "wrong-name" }, EXP);
    assert.equal(g.allowProvision, false);
    assert.match(g.missing.join(" "), new RegExp(WORKER_NAME_CONFIRM_KEY));
  });

  it("bot-id confirm mismatch → blocked (webhook-theft guard)", () => {
    const g = readRuntimeGates({ ...FULL, [BOT_ID_CONFIRM_KEY]: "999999" }, EXP);
    assert.equal(g.allowProvision, false);
    assert.match(g.missing.join(" "), /steal/i);
  });

  it("bot-id NOT required when no webhook step is planned", () => {
    const env = { ...FULL };
    delete (env as Record<string, string>)[BOT_ID_CONFIRM_KEY];
    const g = readRuntimeGates(env, { workerName: WORKER, webhookStepPlanned: false });
    assert.equal(g.allowProvision, true);
  });

  it("bad env label (not staging/test) → blocked, no hard block", () => {
    const g = readRuntimeGates({ ...FULL, [TARGET_ENV_KEY]: "qa" }, EXP);
    assert.equal(g.allowProvision, false);
    assert.equal(g.hardBlock, null);
    assert.match(g.missing.join(" "), /staging, test/);
  });

  it("overwrite gate + credential presence are surfaced (booleans only)", () => {
    const g = readRuntimeGates(
      { ...FULL, [OVERWRITE_GATE]: "true", CLOUDFLARE_API_TOKEN: "x", TELEGRAM_BOT_TOKEN: "y", TRIGGER_SECRET_KEY: "z" },
      EXP
    );
    assert.equal(g.allowOverwrite, true);
    assert.equal(g.hasCloudflareToken, true);
    assert.equal(g.hasTelegramToken, true);
    assert.equal(g.hasTriggerKey, true);
  });

  it("runtimeGateNames lists the three gate envs", () => {
    assert.deepEqual(runtimeGateNames(), [PROVISION_GATE, MUTATION_CONFIRM_GATE, OVERWRITE_GATE]);
  });
});
