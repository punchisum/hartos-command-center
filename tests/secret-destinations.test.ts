/**
 * tests/secret-destinations.test.ts
 *
 * Tests for the secret destination mapping utility.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SECRET_DESTINATIONS,
  getSecretDestination,
  getMissingSecrets,
  formatSecretDestinations,
} from "../src/bootstrap/secret-destinations.js";

describe("SECRET_DESTINATIONS", () => {
  test("all entries have required fields", () => {
    for (const dest of SECRET_DESTINATIONS) {
      assert.ok(dest.envVarName, "Must have envVarName");
      assert.ok(dest.description, "Must have description");
      assert.ok(Array.isArray(dest.destinations), "Must have destinations array");
      assert.ok(Array.isArray(dest.commands), "Must have commands array");
    }
  });

  test("no commands contain real secret values", () => {
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    for (const dest of SECRET_DESTINATIONS) {
      for (const cmd of dest.commands) {
        assert.ok(!secretPattern.test(cmd), `Command in ${dest.envVarName} must not contain secrets`);
      }
    }
  });

  test("includes key secrets", () => {
    const names = SECRET_DESTINATIONS.map((d) => d.envVarName);
    assert.ok(names.includes("SUPABASE_SERVICE_ROLE_KEY"));
    assert.ok(names.includes("TELEGRAM_BOT_TOKEN"));
    assert.ok(names.includes("OPENAI_API_KEY"));
  });
});

describe("getSecretDestination", () => {
  test("finds known secret", () => {
    const dest = getSecretDestination("SUPABASE_SERVICE_ROLE_KEY");
    assert.ok(dest !== undefined);
    assert.equal(dest.envVarName, "SUPABASE_SERVICE_ROLE_KEY");
  });

  test("returns undefined for unknown secret", () => {
    const dest = getSecretDestination("NONEXISTENT_SECRET");
    assert.equal(dest, undefined);
  });
});

describe("getMissingSecrets", () => {
  test("returns all secrets when env is empty", () => {
    const missing = getMissingSecrets({});
    assert.ok(missing.length > 0);
  });

  test("excludes configured secrets", () => {
    const missing = getMissingSecrets({ SUPABASE_SERVICE_ROLE_KEY: "configured" });
    const names = missing.map((s) => s.envVarName);
    assert.ok(!names.includes("SUPABASE_SERVICE_ROLE_KEY"));
  });

  test("returns empty when all secrets configured", () => {
    const env: Record<string, string> = {};
    for (const dest of SECRET_DESTINATIONS) {
      env[dest.envVarName] = "configured";
    }
    const missing = getMissingSecrets(env);
    assert.equal(missing.length, 0);
  });
});

describe("formatSecretDestinations", () => {
  test("includes secret names", () => {
    const formatted = formatSecretDestinations(SECRET_DESTINATIONS.slice(0, 2), "test-agent");
    assert.ok(formatted.includes(SECRET_DESTINATIONS[0]!.envVarName));
  });

  test("includes commands", () => {
    const formatted = formatSecretDestinations([SECRET_DESTINATIONS[0]!], "test-agent");
    assert.ok(formatted.includes("wrangler") || formatted.includes(SECRET_DESTINATIONS[0]!.commands[0] ?? ""));
  });

  test("does not contain secret values", () => {
    const formatted = formatSecretDestinations(SECRET_DESTINATIONS, "test-agent");
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    assert.ok(!secretPattern.test(formatted), "Format must not contain secret-like values");
  });
});
