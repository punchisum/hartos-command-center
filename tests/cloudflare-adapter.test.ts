/**
 * tests/cloudflare-adapter.test.ts
 *
 * Tests for the Phase 7B real Cloudflare adapter.
 * All Wrangler CLI calls are mocked via injected CloudflareOps.
 * All HTTP calls are mocked via injected fetch.
 * No real Wrangler commands or real API calls are performed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CloudflareAdapter } from "../src/provisioning/adapters/cloudflare.js";
import { createMockCloudflareOps } from "../src/provisioning/cloudflare-local.js";
import type { ProvisionContext, ProvisionStep } from "../src/provisioning/types.js";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeHealthFetch(status: number): typeof fetch {
  return async (): Promise<Response> =>
    new Response(JSON.stringify({ status: "ok" }), { status });
}

function makeNetworkErrorFetch(): typeof fetch {
  return async (): Promise<Response> => {
    throw new Error("ECONNREFUSED");
  };
}

function makeCtx(
  env: Record<string, string> = {},
  environment: "local" | "staging" | "production" = "staging"
): ProvisionContext {
  return { agentName: "test-agent", environment, env };
}

const baseEnv = {
  CLOUDFLARE_API_TOKEN: "test-token",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_WORKER_NAME: "test-worker",
  CLOUDFLARE_WORKER_URL: "https://test.workers.dev",
  ALLOW_CLOUDFLARE_PROVISION: "true",
  ALLOW_CLOUDFLARE_DEPLOY: "true",
  ALLOW_CLOUDFLARE_SECRET_UPLOAD: "true",
  ALLOW_AUTO_PROVISION: "true",
  CONFIRM_STAGING_PROVISION: "true",
};

const deployStep: ProvisionStep = {
  id: "cloudflare:deploy_worker:staging",
  provider: "cloudflare",
  action: "deploy_worker",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_CLOUDFLARE_DEPLOY",
  description: "Deploy Cloudflare Worker",
  safeSummary: "Deploys Worker",
  status: "planned",
};

const secretStep: ProvisionStep = {
  id: "cloudflare:set_secret:staging",
  provider: "cloudflare",
  action: "set_secret",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_CLOUDFLARE_SECRET_UPLOAD",
  description: "Upload secrets",
  safeSummary: "Uploads secrets",
  status: "planned",
};

const healthStep: ProvisionStep = {
  id: "cloudflare:verify_health:staging",
  provider: "cloudflare",
  action: "verify_health",
  environment: "staging",
  mutation: false,
  description: "Verify health",
  safeSummary: "Health check",
  status: "planned",
};

// ─── Missing env ─────────────────────────────────────────────────────────────

describe("Cloudflare adapter — missing env", () => {
  test("missing CLOUDFLARE_API_TOKEN → missing_env", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx({ CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_WORKER_NAME: "wkr" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("CLOUDFLARE_API_TOKEN"));
  });

  test("missing CLOUDFLARE_ACCOUNT_ID → missing_env", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_WORKER_NAME: "wkr" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("CLOUDFLARE_ACCOUNT_ID"));
  });

  test("missing CLOUDFLARE_WORKER_NAME → missing_env", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acc" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("CLOUDFLARE_WORKER_NAME"));
  });

  test("missing CLOUDFLARE_WORKER_URL → configured but health check skipped", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx({
      CLOUDFLARE_API_TOKEN: "tok",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_WORKER_NAME: "wkr",
    });
    const vr = await adapter.verify(ctx);
    // Should be configured (required env vars present) but URL missing
    assert.ok(vr.status === "configured" || vr.status === "missing_env");
    assert.ok(vr.missingEnv.includes("CLOUDFLARE_WORKER_URL") || vr.nextAction.includes("CLOUDFLARE_WORKER_URL"));
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────

describe("Cloudflare adapter — health check", () => {
  test("health check 200 → configured/verified status", async () => {
    const adapter = new CloudflareAdapter(
      createMockCloudflareOps(),
      makeHealthFetch(200)
    );
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "configured");
    assert.ok(vr.safeSummary.includes("Health: ok") || vr.safeSummary.includes("healthy"));
  });

  test("health check 503 → error status with HTTP code", async () => {
    const adapter = new CloudflareAdapter(
      createMockCloudflareOps(),
      makeHealthFetch(503)
    );
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "error");
    assert.ok(
      vr.safeSummary.includes("503") || vr.nextAction.includes("503"),
      "Error message should mention HTTP 503"
    );
  });

  test("health check network error → error status", async () => {
    const adapter = new CloudflareAdapter(
      createMockCloudflareOps(),
      makeNetworkErrorFetch()
    );
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "error");
  });

  test("health check skipped when no URL", async () => {
    const adapter = new CloudflareAdapter(
      createMockCloudflareOps(),
      makeHealthFetch(200)
    );
    const envNoUrl = { ...baseEnv };
    delete (envNoUrl as Record<string, string>)["CLOUDFLARE_WORKER_URL"];
    const ctx = makeCtx(envNoUrl);
    const vr = await adapter.verify(ctx);
    // Should not fail due to missing URL — just note it's not set
    assert.ok(vr.status === "configured" || vr.status === "missing_env");
    assert.ok(!vr.safeSummary.includes("Health: ok")); // health wasn't checked
  });

  test("verify_health apply returns verified on success", async () => {
    const adapter = new CloudflareAdapter(
      createMockCloudflareOps(),
      makeHealthFetch(200)
    );
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(healthStep, ctx);
    assert.equal(r.status, "verified");
    assert.ok(r.message.includes("200") || r.message.includes("passed"));
  });

  test("verify_health apply returns failed on non-200", async () => {
    const adapter = new CloudflareAdapter(
      createMockCloudflareOps(),
      makeHealthFetch(502)
    );
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(healthStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(r.message.includes("502"));
  });

  test("verify_health skipped if no URL", async () => {
    const adapter = new CloudflareAdapter(createMockCloudflareOps(), makeHealthFetch(200));
    const envNoUrl = { ...baseEnv };
    delete (envNoUrl as Record<string, string>)["CLOUDFLARE_WORKER_URL"];
    const ctx = makeCtx(envNoUrl);
    const r = await adapter.apply(healthStep, ctx);
    assert.equal(r.status, "skipped");
  });
});

// ─── Deploy worker ────────────────────────────────────────────────────────────

describe("Cloudflare adapter — deploy worker", () => {
  test("deploy requires ALLOW_CLOUDFLARE_DEPLOY gate", async () => {
    const env = { ...baseEnv, ALLOW_CLOUDFLARE_DEPLOY: "false" };
    const adapter = new CloudflareAdapter(createMockCloudflareOps());
    const ctx = makeCtx(env);
    const r = await adapter.apply(deployStep, ctx);
    assert.ok(r.status === "failed" || r.status === "gate_missing");
    assert.ok(
      r.message.includes("ALLOW_CLOUDFLARE_DEPLOY"),
      "Should mention the missing gate"
    );
  });

  test("mock deploy success returns applied", async () => {
    const mockOps = createMockCloudflareOps({
      deployWorker: async () => ({
        success: true,
        message: "Mock deployed to staging",
        exitCode: 0,
      }),
    });
    const adapter = new CloudflareAdapter(mockOps, makeHealthFetch(200));
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(deployStep, ctx);
    assert.equal(r.status, "applied");
    assert.ok(r.message.includes("staging") || r.message.includes("deployed"));
  });

  test("mock deploy failure returns failed with safe message", async () => {
    const mockOps = createMockCloudflareOps({
      deployWorker: async () => ({
        success: false,
        message: "Deploy failed exit 1",
        exitCode: 1,
      }),
    });
    const adapter = new CloudflareAdapter(mockOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(deployStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(r.message.includes("failed") || r.message.includes("Deploy"));
  });

  test("real wrangler is never called in tests (mock ops used)", async () => {
    let wranglerCalled = false;
    const mockOps = createMockCloudflareOps({
      deployWorker: async () => {
        wranglerCalled = true;
        return { success: true, message: "Mock", exitCode: 0 };
      },
    });
    const adapter = new CloudflareAdapter(mockOps);
    const ctx = makeCtx(baseEnv);
    await adapter.apply(deployStep, ctx);
    // The mock was called but real wrangler was not
    assert.equal(wranglerCalled, true, "Mock ops should be called");
    // If test is reached without spawning wrangler, the mock is working correctly
  });
});

// ─── Set secret (manual_required) ────────────────────────────────────────────

describe("Cloudflare adapter — set_secret", () => {
  test("set_secret returns manual_required", async () => {
    const adapter = new CloudflareAdapter(createMockCloudflareOps());
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(secretStep, ctx);
    assert.equal(r.status, "manual_required");
  });

  test("set_secret message includes wrangler secret put command", async () => {
    const adapter = new CloudflareAdapter(createMockCloudflareOps());
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(secretStep, ctx);
    assert.ok(
      r.message.includes("wrangler secret put"),
      "Message should include wrangler secret put instructions"
    );
  });

  test("set_secret never contains API token in message", async () => {
    const adapter = new CloudflareAdapter(createMockCloudflareOps());
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(secretStep, ctx);
    assert.ok(!r.message.includes("test-token"), "Message must not contain API token");
  });

  test("set_secret never contains secret values", async () => {
    const env = { ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: "secret-db-key" };
    const adapter = new CloudflareAdapter(createMockCloudflareOps());
    const ctx = makeCtx(env);
    const r = await adapter.apply(secretStep, ctx);
    assert.ok(!r.message.includes("secret-db-key"), "Message must not contain secret values");
  });
});

// ─── Production gate ──────────────────────────────────────────────────────────

describe("Cloudflare adapter — production gate", () => {
  test("production deploy step has productionGateRequired=true", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const deployStep = steps.find((s) => s.action === "deploy_worker");
    assert.ok(deployStep?.productionGateRequired === true);
  });

  test("production set_secret step has productionGateRequired=true", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const secretStep = steps.find((s) => s.action === "set_secret");
    assert.ok(secretStep?.productionGateRequired === true);
  });
});

// ─── Token never in output ────────────────────────────────────────────────────

describe("Cloudflare adapter — no secrets in output", () => {
  test("verify() safeSummary never includes API token", async () => {
    const adapter = new CloudflareAdapter(
      createMockCloudflareOps(),
      makeHealthFetch(200)
    );
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("test-token"), "safeSummary must not contain API token");
    assert.ok(!vr.nextAction.includes("test-token"), "nextAction must not contain API token");
  });

  test("apply deploy message never includes API token", async () => {
    const adapter = new CloudflareAdapter(createMockCloudflareOps());
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(deployStep, ctx);
    assert.ok(!r.message.includes("test-token"), "Result message must not contain API token");
  });

  test("apply message never includes Bearer header", async () => {
    const mockOps = createMockCloudflareOps({
      deployWorker: async () => ({
        success: false,
        message: "Authorization: Bearer test-token deploy failed",
        exitCode: 1,
      }),
    });
    const adapter = new CloudflareAdapter(mockOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(deployStep, ctx);
    // The safe() function should redact the Bearer token
    assert.ok(
      !r.message.includes("Bearer test-token"),
      "Bearer token must be redacted from output"
    );
  });
});

// ─── plan() ───────────────────────────────────────────────────────────────────

describe("Cloudflare adapter — plan()", () => {
  test("plan returns set_secret, deploy_worker, verify_health steps", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const actions = steps.map((s) => s.action);
    assert.ok(actions.includes("set_secret"));
    assert.ok(actions.includes("deploy_worker"));
    assert.ok(actions.includes("verify_health"));
  });

  test("verify_health step is read-only", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const healthStep = steps.find((s) => s.action === "verify_health");
    assert.ok(healthStep);
    assert.equal(healthStep.mutation, false);
  });

  test("set_secret requires ALLOW_CLOUDFLARE_SECRET_UPLOAD gate", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const secretStep = steps.find((s) => s.action === "set_secret");
    assert.equal(secretStep?.requiredGate, "ALLOW_CLOUDFLARE_SECRET_UPLOAD");
  });

  test("deploy_worker requires ALLOW_CLOUDFLARE_DEPLOY gate", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const deployStep = steps.find((s) => s.action === "deploy_worker");
    assert.equal(deployStep?.requiredGate, "ALLOW_CLOUDFLARE_DEPLOY");
  });

  test("all mutating steps have rollback instructions", async () => {
    const adapter = new CloudflareAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const mutating = steps.filter((s) => s.mutation);
    for (const step of mutating) {
      assert.ok(step.rollback, `Step ${step.action} must have rollback instructions`);
    }
  });
});
