/**
 * tests/migration-runner.test.ts
 *
 * Tests for the migration runner: filename validation, duplicate detection,
 * ledger I/O, planning logic, and gate enforcement.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseMigrationFilename,
  validateMigrationFiles,
  planMigrations,
  markApplied,
  loadLedger,
  formatMigrationReport,
} from "../src/supabase/migration-runner.js";

// ─── Filename parsing ─────────────────────────────────────────────────────────

describe("parseMigrationFilename", () => {
  test("accepts standard 6-digit prefix", () => {
    const result = parseMigrationFilename("000001_core.sql");
    assert.ok(result);
    assert.equal(result.prefix, "000001");
  });

  test("accepts timestamp prefix (14 digits)", () => {
    const result = parseMigrationFilename("20260603120000_add_users.sql");
    assert.ok(result);
    assert.equal(result.prefix, "20260603120000");
  });

  test("accepts timestamp+index prefix (16 digits, factory scaffold format)", () => {
    const result = parseMigrationFilename("2026060300000000_schema_contract.sql");
    assert.ok(result, "Factory scaffold generates 16-digit timestamp+index filenames");
    assert.equal(result.prefix, "2026060300000000");
  });

  test("rejects filename without underscore separator", () => {
    assert.equal(parseMigrationFilename("000001core.sql"), null);
  });

  test("rejects filename without .sql extension", () => {
    assert.equal(parseMigrationFilename("000001_core.txt"), null);
  });

  test("rejects filename starting with letters", () => {
    assert.equal(parseMigrationFilename("abc_core.sql"), null);
  });

  test("rejects empty filename", () => {
    assert.equal(parseMigrationFilename(""), null);
  });
});

// ─── Filename validation ──────────────────────────────────────────────────────

describe("validateMigrationFiles", () => {
  test("returns no errors for valid unique filenames", () => {
    const errors = validateMigrationFiles([
      "000001_core.sql",
      "000002_debug_events.sql",
      "000003_action_tokens.sql",
    ]);
    assert.equal(errors.length, 0);
  });

  test("returns error for invalid filename format", () => {
    const errors = validateMigrationFiles(["bad_filename.sql"]);
    assert.ok(errors.some((e) => e.includes("bad_filename.sql")));
  });

  test("returns error for duplicate timestamp prefix", () => {
    const errors = validateMigrationFiles([
      "000001_first.sql",
      "000001_second.sql",
    ]);
    assert.ok(errors.some((e) => e.includes("000001")));
  });

  test("returns errors for multiple issues", () => {
    const errors = validateMigrationFiles([
      "bad.sql",          // invalid
      "000001_ok.sql",    // valid
      "000001_dupe.sql",  // duplicate prefix
    ]);
    assert.ok(errors.length >= 2);
  });
});

// ─── Integration: planning and ledger ────────────────────────────────────────

let tmpDir: string;
let migrationsDir: string;
let ledgerPath: string;

before(async () => {
  tmpDir = path.join(tmpdir(), `hartos-migration-test-${Date.now()}`);
  migrationsDir = path.join(tmpDir, "migrations");
  ledgerPath = path.join(tmpDir, ".migration-ledger.json");
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(path.join(migrationsDir, "000001_core.sql"), "-- core\nselect 1;", "utf8");
  await writeFile(path.join(migrationsDir, "000002_events.sql"), "-- events\nselect 2;", "utf8");
  await writeFile(path.join(migrationsDir, "000003_tokens.sql"), "-- tokens\nselect 3;", "utf8");
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("planMigrations", () => {
  test("reports all 3 as pending when no ledger exists", async () => {
    const plan = await planMigrations(migrationsDir, ledgerPath, "test-agent", "local");
    assert.equal(plan.errors.length, 0, `Unexpected errors: ${plan.errors.join("; ")}`);
    assert.equal(plan.pending.length, 3);
    assert.equal(plan.applied.length, 0);
    assert.equal(plan.all.length, 3);
  });

  test("pending migrations are sorted by filename", async () => {
    const plan = await planMigrations(migrationsDir, ledgerPath, "test-agent", "local");
    const names = plan.pending.map((m) => m.filename);
    assert.deepEqual(names, [...names].sort());
  });

  test("returns error for missing migrations directory", async () => {
    const plan = await planMigrations(
      path.join(tmpDir, "nonexistent"),
      ledgerPath,
      "test-agent",
      "local"
    );
    assert.ok(plan.errors.length > 0);
    assert.ok(plan.errors[0]!.includes("not found"));
  });
});

describe("markApplied + ledger", () => {
  test("marks migrations as applied and updates ledger", async () => {
    const freshLedger = path.join(tmpDir, ".fresh-ledger.json");
    await markApplied(freshLedger, ["000001_core.sql", "000002_events.sql"], "test-agent", "local");
    const ledger = await loadLedger(freshLedger);
    assert.ok(ledger);
    assert.ok(ledger.applied.includes("000001_core.sql"));
    assert.ok(ledger.applied.includes("000002_events.sql"));
    assert.ok(!ledger.applied.includes("000003_tokens.sql"));
    assert.equal(ledger.agentName, "test-agent");
    assert.equal(ledger.environment, "local");
  });

  test("subsequent plan shows only remaining pending", async () => {
    const freshLedger = path.join(tmpDir, ".plan-ledger.json");
    await markApplied(freshLedger, ["000001_core.sql", "000002_events.sql"], "test-agent", "local");
    const plan = await planMigrations(migrationsDir, freshLedger, "test-agent", "local");
    assert.equal(plan.pending.length, 1);
    assert.equal(plan.pending[0]!.filename, "000003_tokens.sql");
    assert.equal(plan.applied.length, 2);
  });

  test("markApplied is idempotent — no duplicate entries", async () => {
    const freshLedger = path.join(tmpDir, ".idem-ledger.json");
    await markApplied(freshLedger, ["000001_core.sql"], "test-agent", "local");
    await markApplied(freshLedger, ["000001_core.sql"], "test-agent", "local");
    const ledger = await loadLedger(freshLedger);
    const count = ledger!.applied.filter((f) => f === "000001_core.sql").length;
    assert.equal(count, 1, "Applied list must not contain duplicates");
  });
});

describe("formatMigrationReport", () => {
  test("includes agent name and environment", async () => {
    const plan = await planMigrations(migrationsDir, ledgerPath, "my-agent", "staging");
    const report = formatMigrationReport(plan, "my-agent");
    assert.ok(report.includes("my-agent"));
    assert.ok(report.includes("staging"));
  });

  test("includes pending migration filenames", async () => {
    const plan = await planMigrations(migrationsDir, ledgerPath, "my-agent", "local");
    const report = formatMigrationReport(plan, "my-agent");
    assert.ok(report.includes("000001_core.sql"));
    assert.ok(report.includes("000002_events.sql"));
  });

  test("does not contain secret patterns", async () => {
    const plan = await planMigrations(migrationsDir, ledgerPath, "my-agent", "local");
    const report = formatMigrationReport(plan, "my-agent");
    assert.ok(!report.includes("sk-"), "Report must not contain API key patterns");
    assert.ok(!report.includes("SERVICE_ROLE_KEY"), "Report must not reference secret names as values");
  });
});
