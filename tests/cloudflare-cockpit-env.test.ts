/**
 * tests/cloudflare-cockpit-env.test.ts — Phase 11J.
 * Env handling reports PRESENCE only and never returns values.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeEnvPresence, envPresent, isSecretName, COCKPIT_ENV_VARS, resolveLlmNetworkGate } from "../src/runtime/cloudflare-env.js";

describe("cloudflare cockpit env", () => {
  it("summarizes presence without exposing values", () => {
    const env = { CLOUDFLARE_API_TOKEN: "secretvalue-should-not-appear", CLOUDFLARE_ACCOUNT_ID: "" };
    const summary = summarizeEnvPresence(env);
    const serialized = JSON.stringify(summary);
    assert.ok(!serialized.includes("secretvalue-should-not-appear"));
    const tok = summary.find((e) => e.name === "CLOUDFLARE_API_TOKEN");
    assert.equal(tok?.present, true);
    assert.equal(tok?.secret, true);
    const acct = summary.find((e) => e.name === "CLOUDFLARE_ACCOUNT_ID");
    assert.equal(acct?.present, false, "empty string is not present");
  });

  it("flags secret-named vars", () => {
    assert.equal(isSecretName("CLOUDFLARE_API_TOKEN"), true);
    assert.equal(isSecretName("OPENAI_API_KEY"), true);
    assert.equal(isSecretName("CLOUDFLARE_PROJECT_NAME"), false);
  });

  it("knows the cockpit env vars", () => {
    assert.ok(COCKPIT_ENV_VARS.includes("ALLOW_CLOUDFLARE_COCKPIT_DEPLOY"));
    assert.ok(COCKPIT_ENV_VARS.includes("CONFIRM_CLOUDFLARE_DEPLOY"));
  });

  it("envPresent only true for non-empty strings", () => {
    assert.equal(envPresent({ X: "y" }, "X"), true);
    assert.equal(envPresent({ X: "" }, "X"), false);
    assert.equal(envPresent({}, "X"), false);
  });

  it("resolves the LLM network gate strictly", () => {
    assert.equal(resolveLlmNetworkGate({}), false);
    assert.equal(resolveLlmNetworkGate({ HARTOS_LLM_ENABLE_NETWORK: "true" }), true);
    assert.equal(resolveLlmNetworkGate({ HARTOS_LLM_ENABLE_NETWORK: "yes" }), false);
  });
});
