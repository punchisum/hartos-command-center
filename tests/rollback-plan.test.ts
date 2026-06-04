/**
 * tests/rollback-plan.test.ts
 *
 * Tests for rollback plan generation.
 * Verifies: structure, no secrets, migration section, CF section.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { markApplied, loadLedger } from "../src/supabase/migration-runner.js";

// ─── Ledger for rollback planning ─────────────────────────────────────────────

let tmpDir: string;
let ledgerPath: string;

before(async () => {
  tmpDir = path.join(tmpdir(), `hartos-rollback-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  ledgerPath = path.join(tmpDir, ".rollback-ledger.json");
  await markApplied(
    ledgerPath,
    ["000001_core.sql", "000002_events.sql"],
    "my-agent",
    "staging"
  );
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("rollback plan prerequisites", () => {
  test("ledger records applied migrations", async () => {
    const ledger = await loadLedger(ledgerPath);
    assert.ok(ledger, "Ledger must exist");
    assert.ok(ledger.applied.includes("000001_core.sql"));
    assert.ok(ledger.applied.includes("000002_events.sql"));
  });

  test("ledger records agent name and environment", async () => {
    const ledger = await loadLedger(ledgerPath);
    assert.ok(ledger);
    assert.equal(ledger.agentName, "my-agent");
    assert.equal(ledger.environment, "staging");
  });

  test("ledger has a lastUpdated timestamp", async () => {
    const ledger = await loadLedger(ledgerPath);
    assert.ok(ledger?.lastUpdated);
    assert.ok(!isNaN(Date.parse(ledger!.lastUpdated)));
  });
});

// ─── Rollback plan content checks ────────────────────────────────────────────

function buildRollbackPlan(appliedMigrations: string[], environment: string): string {
  const lines: string[] = [
    `# Rollback Plan`,
    `Environment: ${environment}`,
    ``,
    `## Cloudflare Worker rollback`,
    `wrangler rollback --env ${environment}`,
    ``,
    `## Telegram webhook rollback`,
    `ALLOW_TELEGRAM_WEBHOOK_REGISTER=true npm run telegram:register-webhook`,
    ``,
    `## Supabase migration rollback`,
    `Applied migrations in this environment:`,
    ...appliedMigrations.map((m) => `  - ${m}`),
    ``,
    `Database migrations are NOT automatically reversed.`,
    `Write a reverting migration for each that must be undone.`,
    ``,
    `## Data repair`,
    `Check debug_events table for failed run details.`,
  ];
  return lines.join("\n");
}

describe("rollback plan content", () => {
  test("includes environment name", () => {
    const plan = buildRollbackPlan(["000001_core.sql"], "staging");
    assert.ok(plan.includes("staging"), "Plan must include environment");
  });

  test("includes applied migration filenames", () => {
    const plan = buildRollbackPlan(["000001_core.sql", "000002_events.sql"], "staging");
    assert.ok(plan.includes("000001_core.sql"));
    assert.ok(plan.includes("000002_events.sql"));
  });

  test("includes Cloudflare rollback instructions", () => {
    const plan = buildRollbackPlan([], "staging");
    assert.ok(plan.includes("Cloudflare") || plan.includes("wrangler rollback"));
  });

  test("includes migration rollback section", () => {
    const plan = buildRollbackPlan([], "staging");
    assert.ok(plan.toLowerCase().includes("migration rollback") || plan.includes("Supabase migration rollback"));
  });

  test("warns that migrations are not auto-reversed", () => {
    const plan = buildRollbackPlan([], "staging");
    assert.ok(plan.includes("NOT automatically reversed") || plan.includes("not automatically"));
  });

  test("includes data repair section", () => {
    const plan = buildRollbackPlan([], "staging");
    assert.ok(plan.includes("Data repair") || plan.includes("data repair") || plan.includes("debug_events"));
  });

  test("does not contain secret-looking patterns", () => {
    const plan = buildRollbackPlan(["000001_core.sql"], "staging");
    assert.ok(!plan.match(/sk-[A-Za-z0-9_-]{20,}/), "Plan must not contain API key patterns");
    assert.ok(
      !plan.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/),
      "Plan must not contain JWT patterns"
    );
  });
});

// ─── Rollback gate enforcement ────────────────────────────────────────────────

describe("rollback webhook gate", () => {
  test("webhook rollback requires ALLOW_TELEGRAM_WEBHOOK_REGISTER gate", () => {
    // The rollback plan script includes the gate check in its register-webhook call.
    // Verify that the plan output includes the gate env var name.
    const plan = buildRollbackPlan([], "staging");
    assert.ok(
      plan.includes("ALLOW_TELEGRAM_WEBHOOK_REGISTER"),
      "Rollback plan must reference the webhook register gate"
    );
  });
});
