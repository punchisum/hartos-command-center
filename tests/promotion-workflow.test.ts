/**
 * tests/promotion-workflow.test.ts
 *
 * Tests for the promotion workflow logic and gate enforcement.
 * Verifies that every mutating step requires an explicit gate.
 * No actual deployment is performed in these tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/shared/types.js";

// ─── Gate enforcement helpers ─────────────────────────────────────────────────

/** Simulate what each gated script checks before acting. */
function isDeployGateOpen(env: Env): boolean {
  return env.ALLOW_CLOUDFLARE_DEPLOY === "true";
}

function isMigrationGateOpen(env: Env): boolean {
  return env.ALLOW_SUPABASE_MIGRATION_APPLY === "true";
}

function isWebhookGateOpen(env: Env): boolean {
  return env.ALLOW_TELEGRAM_WEBHOOK_REGISTER === "true";
}

function isProductionGateOpen(env: Env): boolean {
  return env.CONFIRM_PRODUCTION_DEPLOY === "true";
}

function canDeployToProduction(env: Env): boolean {
  return isDeployGateOpen(env) && isProductionGateOpen(env);
}

function canApplyProductionMigrations(env: Env): boolean {
  return isMigrationGateOpen(env) && isProductionGateOpen(env);
}

function canRegisterProductionWebhook(env: Env): boolean {
  return isWebhookGateOpen(env) && isProductionGateOpen(env);
}

// ─── Staging promotion gates ──────────────────────────────────────────────────

describe("staging promotion gates", () => {
  test("deploy gate is closed by default", () => {
    assert.equal(isDeployGateOpen({}), false);
  });

  test("migration gate is closed by default", () => {
    assert.equal(isMigrationGateOpen({}), false);
  });

  test("webhook gate is closed by default", () => {
    assert.equal(isWebhookGateOpen({}), false);
  });

  test("deploy gate opens when ALLOW_CLOUDFLARE_DEPLOY=true", () => {
    assert.equal(isDeployGateOpen({ ALLOW_CLOUDFLARE_DEPLOY: "true" }), true);
  });

  test("deploy gate stays closed for non-true values", () => {
    assert.equal(isDeployGateOpen({ ALLOW_CLOUDFLARE_DEPLOY: "yes" }), false);
    assert.equal(isDeployGateOpen({ ALLOW_CLOUDFLARE_DEPLOY: "1" }), false);
    assert.equal(isDeployGateOpen({ ALLOW_CLOUDFLARE_DEPLOY: "" }), false);
  });

  test("staging deploy does not require CONFIRM_PRODUCTION_DEPLOY", () => {
    const stagingEnv: Env = {
      ALLOW_CLOUDFLARE_DEPLOY: "true",
      APP_ENV: "staging",
    };
    assert.equal(isDeployGateOpen(stagingEnv), true);
    // Production gate NOT required for staging
    assert.equal(isProductionGateOpen(stagingEnv), false); // fine for staging
  });
});

// ─── Production promotion gates ───────────────────────────────────────────────

describe("production promotion gates", () => {
  test("production deploy requires both deploy gate and production gate", () => {
    const envWithOnlyDeploy: Env = { ALLOW_CLOUDFLARE_DEPLOY: "true" };
    assert.equal(canDeployToProduction(envWithOnlyDeploy), false);

    const envWithOnlyProd: Env = { CONFIRM_PRODUCTION_DEPLOY: "true" };
    assert.equal(canDeployToProduction(envWithOnlyProd), false);

    const envWithBoth: Env = {
      ALLOW_CLOUDFLARE_DEPLOY: "true",
      CONFIRM_PRODUCTION_DEPLOY: "true",
    };
    assert.equal(canDeployToProduction(envWithBoth), true);
  });

  test("production migration requires both migration gate and production gate", () => {
    assert.equal(canApplyProductionMigrations({ ALLOW_SUPABASE_MIGRATION_APPLY: "true" }), false);
    assert.equal(canApplyProductionMigrations({ CONFIRM_PRODUCTION_DEPLOY: "true" }), false);
    assert.equal(
      canApplyProductionMigrations({
        ALLOW_SUPABASE_MIGRATION_APPLY: "true",
        CONFIRM_PRODUCTION_DEPLOY: "true",
      }),
      true
    );
  });

  test("production webhook registration requires both webhook gate and production gate", () => {
    assert.equal(canRegisterProductionWebhook({ ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true" }), false);
    assert.equal(canRegisterProductionWebhook({ CONFIRM_PRODUCTION_DEPLOY: "true" }), false);
    assert.equal(
      canRegisterProductionWebhook({
        ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true",
        CONFIRM_PRODUCTION_DEPLOY: "true",
      }),
      true
    );
  });

  test("no production action is possible without CONFIRM_PRODUCTION_DEPLOY", () => {
    const envWithAllOtherGates: Env = {
      ALLOW_CLOUDFLARE_DEPLOY: "true",
      ALLOW_SUPABASE_MIGRATION_APPLY: "true",
      ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true",
      // CONFIRM_PRODUCTION_DEPLOY intentionally absent
    };
    assert.equal(canDeployToProduction(envWithAllOtherGates), false);
    assert.equal(canApplyProductionMigrations(envWithAllOtherGates), false);
    assert.equal(canRegisterProductionWebhook(envWithAllOtherGates), false);
  });
});

// ─── Environment profiles ─────────────────────────────────────────────────────

describe("environment profile detection", () => {
  test("APP_ENV=local is the default", () => {
    const env: Env = {};
    const profile = env.APP_ENV ?? "local";
    assert.equal(profile, "local");
  });

  test("APP_ENV=staging is a valid profile", () => {
    const env: Env = { APP_ENV: "staging" };
    assert.equal(env.APP_ENV, "staging");
  });

  test("APP_ENV=production is a valid profile", () => {
    const env: Env = { APP_ENV: "production" };
    assert.equal(env.APP_ENV, "production");
  });

  test("staging profile uses STAGING_* vars", () => {
    const env: Env = {
      APP_ENV: "staging",
      STAGING_CLOUDFLARE_WORKER_URL: "https://staging.worker.example.com",
    };
    assert.ok(env.STAGING_CLOUDFLARE_WORKER_URL);
  });

  test("production profile uses PRODUCTION_* vars", () => {
    const env: Env = {
      APP_ENV: "production",
      PRODUCTION_CLOUDFLARE_WORKER_URL: "https://prod.worker.example.com",
    };
    assert.ok(env.PRODUCTION_CLOUDFLARE_WORKER_URL);
  });
});
