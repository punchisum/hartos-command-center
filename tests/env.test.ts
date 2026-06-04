import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProviderStatus, redact, requireEnv } from "../src/runtime/env.js";

test("provider status reports present and missing without values", () => {
  const statuses = checkProviderStatus({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  });
  const supabase = statuses.find((status) => status.provider === "supabase");
  assert.equal(supabase?.configured, true);
  assert.equal(supabase?.checks.find((check) => check.name === "SUPABASE_SERVICE_ROLE_KEY")?.present, true);
});

test("redact never returns full secret values", () => {
  assert.equal(redact("SUPABASE_SERVICE_ROLE_KEY", "abcdefghijklmnopqrstuvwxyz123456"), "ab...[REDACTED]");
});

test("requireEnv fails clearly when missing", () => {
  assert.throws(() => requireEnv({}, "TELEGRAM_BOT_TOKEN"), /Missing required env var/);
});
