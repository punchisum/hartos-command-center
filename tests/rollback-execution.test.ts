/**
 * tests/rollback-execution.test.ts
 *
 * Tests for the rollback execution utility.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { executeRollback, formatRollbackInstructions } from "../src/launch/rollback-execution.js";
import { MockAdapter } from "../src/provisioning/adapters/mock.js";
import type { ProviderAdapter, ProvisionContext } from "../src/provisioning/types.js";

function makeCtx(env: Record<string, string> = {}): ProvisionContext {
  return { agentName: "test-agent", environment: "production", env };
}

describe("executeRollback — gate not open", () => {
  test("returns instruction_only when ALLOW_ROLLBACK_EXECUTION not set", async () => {
    const adapters: ProviderAdapter[] = [new MockAdapter("github")];
    const result = await executeRollback(adapters, makeCtx({}));
    assert.equal(result.gateOpen, false);
    assert.ok(result.steps.every((s) => s.status === "instruction_only"));
  });

  test("includes instructions for each provider", async () => {
    const adapters: ProviderAdapter[] = [
      new MockAdapter("github"),
      new MockAdapter("cloudflare"),
    ];
    const result = await executeRollback(adapters, makeCtx({}));
    const providers = result.steps.map((s) => s.provider);
    assert.ok(providers.includes("github"));
    assert.ok(providers.includes("cloudflare"));
  });

  test("summary mentions setting ALLOW_ROLLBACK_EXECUTION", async () => {
    const adapters: ProviderAdapter[] = [new MockAdapter("supabase")];
    const result = await executeRollback(adapters, makeCtx({}));
    assert.ok(result.summary.includes("ALLOW_ROLLBACK_EXECUTION"));
  });
});

describe("executeRollback — gate open", () => {
  test("calls adapter rollback() when gate is open and adapter supports it", async () => {
    let rollbackCalled = false;
    const base = new MockAdapter("telegram");
    const adapter: ProviderAdapter = {
      provider: base.provider,
      plan: (ctx: import("../src/provisioning/types.js").ProvisionContext) => base.plan(ctx),
      verify: (ctx: import("../src/provisioning/types.js").ProvisionContext) => base.verify(ctx),
      rollback: async () => {
        rollbackCalled = true;
        return {
          step: {
            id: "rollback",
            provider: "telegram",
            action: "register_webhook" as const,
            environment: "production" as const,
            mutation: false,
            description: "Rollback",
            safeSummary: "Rollback",
            status: "skipped" as const,
          },
          status: "skipped" as const,
          message: "Manual rollback required",
          timestamp: new Date().toISOString(),
        };
      },
    };
    const result = await executeRollback([adapter], makeCtx({ ALLOW_ROLLBACK_EXECUTION: "true" }));
    assert.equal(result.gateOpen, true);
    assert.ok(rollbackCalled, "rollback() should be called when gate is open");
  });
});

describe("formatRollbackInstructions", () => {
  test("includes instructions for each provider", () => {
    const formatted = formatRollbackInstructions(["github", "cloudflare", "supabase"]);
    assert.ok(formatted.includes("github"));
    assert.ok(formatted.includes("cloudflare"));
    assert.ok(formatted.includes("supabase"));
  });

  test("does not include secrets", () => {
    const formatted = formatRollbackInstructions(["github", "cloudflare"]);
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    assert.ok(!secretPattern.test(formatted), "Instructions must not contain secret-like values");
  });
});
