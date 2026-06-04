import { test } from "node:test";
import assert from "node:assert/strict";
import { getProviderStatus, hasProvider } from "../src/runtime/provider-status.js";

test("provider status marks unconfigured providers false", () => {
  const statuses = getProviderStatus({});
  assert.equal(statuses.every((status) => status.configured === false), true);
});

test("hasProvider returns true only when required env exists", () => {
  assert.equal(hasProvider({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "secret" }, "supabase"), true);
  assert.equal(hasProvider({ SUPABASE_URL: "https://example.test" }, "supabase"), false);
});
