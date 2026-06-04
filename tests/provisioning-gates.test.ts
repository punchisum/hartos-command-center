/**
 * tests/provisioning-gates.test.ts
 *
 * Tests for gate enforcement in the provisioning engine.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkAutoProvisionGate,
  checkEnvironmentGate,
  checkStepGate,
  checkAllAutoGates,
  buildGateSummary,
} from "../src/provisioning/gates.js";
import type { ProvisionStep } from "../src/provisioning/types.js";

const mutatingStep: ProvisionStep = {
  id: "supabase:apply_migrations:staging",
  provider: "supabase",
  action: "apply_migrations",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_SUPABASE_PROVISION",
  description: "Apply migrations",
  safeSummary: "Applies migrations",
  status: "planned",
};

const readOnlyStep: ProvisionStep = {
  id: "openai:verify_model:local",
  provider: "openai",
  action: "verify_model",
  environment: "local",
  mutation: false,
  description: "Verify OpenAI model",
  safeSummary: "Checks OpenAI env",
  status: "planned",
};

const prodMutatingStep: ProvisionStep = {
  ...mutatingStep,
  id: "cloudflare:deploy_worker:production",
  environment: "production",
  provider: "cloudflare",
  action: "deploy_worker",
  requiredGate: "ALLOW_CLOUDFLARE_PROVISION",
  productionGateRequired: true,
};

// ─── Auto provision gate ──────────────────────────────────────────────────────

describe("checkAutoProvisionGate", () => {
  test("closed when ALLOW_AUTO_PROVISION not set", () => {
    const result = checkAutoProvisionGate({});
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("ALLOW_AUTO_PROVISION"));
  });

  test("closed when ALLOW_AUTO_PROVISION=false", () => {
    const result = checkAutoProvisionGate({ ALLOW_AUTO_PROVISION: "false" });
    assert.equal(result.allowed, false);
  });

  test("open when ALLOW_AUTO_PROVISION=true", () => {
    const result = checkAutoProvisionGate({ ALLOW_AUTO_PROVISION: "true" });
    assert.equal(result.allowed, true);
    assert.deepEqual(result.missingGates, []);
  });

  test("closed for ALLOW_AUTO_PROVISION=yes (must be exactly 'true')", () => {
    const result = checkAutoProvisionGate({ ALLOW_AUTO_PROVISION: "yes" });
    assert.equal(result.allowed, false);
  });
});

// ─── Environment gate ─────────────────────────────────────────────────────────

describe("checkEnvironmentGate", () => {
  test("local environment always passes", () => {
    const result = checkEnvironmentGate({}, "local");
    assert.equal(result.allowed, true);
  });

  test("staging requires CONFIRM_STAGING_PROVISION", () => {
    const result = checkEnvironmentGate({}, "staging");
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("CONFIRM_STAGING_PROVISION"));
  });

  test("staging passes with CONFIRM_STAGING_PROVISION=true", () => {
    const result = checkEnvironmentGate({ CONFIRM_STAGING_PROVISION: "true" }, "staging");
    assert.equal(result.allowed, true);
  });

  test("production requires CONFIRM_PRODUCTION_DEPLOY", () => {
    const result = checkEnvironmentGate({}, "production");
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
  });

  test("production passes with CONFIRM_PRODUCTION_DEPLOY=true", () => {
    const result = checkEnvironmentGate({ CONFIRM_PRODUCTION_DEPLOY: "true" }, "production");
    assert.equal(result.allowed, true);
  });
});

// ─── Step gate ────────────────────────────────────────────────────────────────

describe("checkStepGate", () => {
  test("read-only step always passes (no gate needed)", () => {
    const result = checkStepGate(readOnlyStep, {});
    assert.equal(result.allowed, true);
    assert.deepEqual(result.missingGates, []);
  });

  test("mutating step blocked when requiredGate not set", () => {
    const result = checkStepGate(mutatingStep, {});
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("ALLOW_SUPABASE_PROVISION"));
  });

  test("mutating step passes when requiredGate=true", () => {
    const result = checkStepGate(mutatingStep, { ALLOW_SUPABASE_PROVISION: "true" });
    assert.equal(result.allowed, true);
  });

  test("production step blocked when CONFIRM_PRODUCTION_DEPLOY missing", () => {
    const result = checkStepGate(prodMutatingStep, {
      ALLOW_CLOUDFLARE_PROVISION: "true",
      // CONFIRM_PRODUCTION_DEPLOY intentionally absent
    });
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
  });

  test("production step passes with both gates", () => {
    const result = checkStepGate(prodMutatingStep, {
      ALLOW_CLOUDFLARE_PROVISION: "true",
      CONFIRM_PRODUCTION_DEPLOY: "true",
    });
    assert.equal(result.allowed, true);
  });

  test("gate names reported accurately", () => {
    const result = checkStepGate(prodMutatingStep, {});
    assert.ok(result.missingGates.includes("ALLOW_CLOUDFLARE_PROVISION"));
    assert.ok(result.missingGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
  });
});

// ─── Combined gate check ──────────────────────────────────────────────────────

describe("checkAllAutoGates", () => {
  test("fails when ALLOW_AUTO_PROVISION missing", () => {
    const result = checkAllAutoGates({ CONFIRM_STAGING_PROVISION: "true" }, "staging");
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("ALLOW_AUTO_PROVISION"));
  });

  test("fails when env gate missing", () => {
    const result = checkAllAutoGates({ ALLOW_AUTO_PROVISION: "true" }, "staging");
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("CONFIRM_STAGING_PROVISION"));
  });

  test("passes when all gates set for staging", () => {
    const result = checkAllAutoGates(
      { ALLOW_AUTO_PROVISION: "true", CONFIRM_STAGING_PROVISION: "true" },
      "staging"
    );
    assert.equal(result.allowed, true);
  });

  test("production requires CONFIRM_PRODUCTION_DEPLOY even with all other gates", () => {
    const result = checkAllAutoGates(
      { ALLOW_AUTO_PROVISION: "true" },
      "production"
    );
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
  });
});

// ─── Gate summary ─────────────────────────────────────────────────────────────

describe("buildGateSummary", () => {
  test("returns summary with known gate names", () => {
    const summary = buildGateSummary({}, "local");
    const names = summary.map((s) => s.gateName);
    assert.ok(names.includes("ALLOW_AUTO_PROVISION"));
    assert.ok(names.includes("ALLOW_SUPABASE_PROVISION"));
    assert.ok(names.includes("ALLOW_CLOUDFLARE_PROVISION"));
  });

  test("open gates are marked open", () => {
    const summary = buildGateSummary({ ALLOW_AUTO_PROVISION: "true" }, "local");
    const autoGate = summary.find((g) => g.gateName === "ALLOW_AUTO_PROVISION");
    assert.ok(autoGate);
    assert.equal(autoGate.open, true);
  });

  test("staging gate appears for staging environment", () => {
    const summary = buildGateSummary({}, "staging");
    const names = summary.map((g) => g.gateName);
    assert.ok(names.includes("CONFIRM_STAGING_PROVISION"));
  });

  test("production gate appears for production environment", () => {
    const summary = buildGateSummary({}, "production");
    const names = summary.map((g) => g.gateName);
    assert.ok(names.includes("CONFIRM_PRODUCTION_DEPLOY"));
  });

  test("staging gate does not appear for local environment", () => {
    const summary = buildGateSummary({}, "local");
    const names = summary.map((g) => g.gateName);
    assert.ok(!names.includes("CONFIRM_STAGING_PROVISION"));
  });
});
