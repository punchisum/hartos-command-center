/**
 * tests/provisioning-ledger.test.ts
 *
 * Tests for provision ledger I/O and content safety.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadLedger,
  saveLedger,
  appendToLedger,
  buildLedgerEntries,
  assertLedgerNoSecrets,
} from "../src/provisioning/ledger.js";
import type { ProvisionLedger, LedgerEntry } from "../src/provisioning/types.js";

let tmpDir: string;

before(async () => {
  tmpDir = path.join(tmpdir(), `hartos-ledger-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const sampleEntry: LedgerEntry = {
  timestamp: "2026-06-03T12:00:00.000Z",
  environment: "staging",
  provider: "supabase",
  stepId: "supabase:apply_migrations:staging",
  action: "apply_migrations",
  status: "applied",
  message: "Applied 3 migrations",
  rollbackAvailable: true,
};

// ─── Load / Save ─────────────────────────────────────────────────────────────

describe("loadLedger", () => {
  test("returns null when no ledger file exists", async () => {
    const result = await loadLedger(tmpDir);
    assert.equal(result, null);
  });
});

describe("saveLedger + loadLedger", () => {
  test("saves and reloads ledger correctly", async () => {
    const saveDir = path.join(tmpDir, "save-test");
    await mkdir(saveDir, { recursive: true });

    const ledger: ProvisionLedger = {
      agentName: "test-agent",
      entries: [sampleEntry],
      lastUpdated: new Date().toISOString(),
    };

    await saveLedger(saveDir, ledger);
    const loaded = await loadLedger(saveDir);

    assert.ok(loaded);
    assert.equal(loaded.agentName, "test-agent");
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0]!.stepId, sampleEntry.stepId);
  });
});

// ─── appendToLedger ───────────────────────────────────────────────────────────

describe("appendToLedger", () => {
  test("creates new ledger when none exists", async () => {
    const appendDir = path.join(tmpDir, "append-test-1");
    await mkdir(appendDir, { recursive: true });

    const ledger = await appendToLedger(appendDir, "test-agent", [sampleEntry]);
    assert.equal(ledger.agentName, "test-agent");
    assert.equal(ledger.entries.length, 1);
  });

  test("appends to existing ledger", async () => {
    const appendDir = path.join(tmpDir, "append-test-2");
    await mkdir(appendDir, { recursive: true });

    await appendToLedger(appendDir, "test-agent", [sampleEntry]);
    const secondEntry: LedgerEntry = {
      ...sampleEntry,
      stepId: "cloudflare:deploy_worker:staging",
      provider: "cloudflare",
      action: "deploy_worker",
    };
    const ledger = await appendToLedger(appendDir, "test-agent", [secondEntry]);
    assert.equal(ledger.entries.length, 2);
  });

  test("ledger has lastUpdated timestamp", async () => {
    const appendDir = path.join(tmpDir, "append-test-3");
    await mkdir(appendDir, { recursive: true });
    const ledger = await appendToLedger(appendDir, "test-agent", [sampleEntry]);
    assert.ok(!isNaN(Date.parse(ledger.lastUpdated)));
  });
});

// ─── buildLedgerEntries ───────────────────────────────────────────────────────

describe("buildLedgerEntries", () => {
  test("creates entries from provision results", async () => {
    const { buildProvisionPlan, buildContext } = await import("../src/provisioning/plan.js");
    const { runProvisionEngine } = await import("../src/provisioning/engine.js");
    const { MockAdapter } = await import("../src/provisioning/adapters/mock.js");

    const ctx = buildContext("test-agent", "local");
    const adapters = [new MockAdapter("supabase")];
    const plan = await buildProvisionPlan(ctx, adapters);
    const result = await runProvisionEngine(plan, adapters, ctx);
    const entries = buildLedgerEntries(result, "local");

    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.ok(entry.stepId);
      assert.ok(entry.provider);
      assert.ok(entry.action);
      assert.ok(entry.timestamp);
    }
  });
});

// ─── assertLedgerNoSecrets ────────────────────────────────────────────────────

describe("assertLedgerNoSecrets", () => {
  test("passes for a clean ledger", () => {
    const ledger: ProvisionLedger = {
      agentName: "test-agent",
      entries: [sampleEntry],
      lastUpdated: "2026-06-03T12:00:00.000Z",
    };
    assert.doesNotThrow(() => assertLedgerNoSecrets(ledger));
  });

  test("passes for a ledger with provider names and step IDs", () => {
    const ledger: ProvisionLedger = {
      agentName: "my-agent",
      entries: [
        { ...sampleEntry, stepId: "supabase:create_project:staging", message: "Project created" },
      ],
      lastUpdated: "2026-06-03T12:00:00.000Z",
    };
    assert.doesNotThrow(() => assertLedgerNoSecrets(ledger));
  });

  test("ledger entries include rollbackAvailable flag", () => {
    const entry = { ...sampleEntry, rollbackAvailable: true };
    const ledger: ProvisionLedger = {
      agentName: "test-agent",
      entries: [entry],
      lastUpdated: "2026-06-03T12:00:00.000Z",
    };
    assert.ok(ledger.entries[0]!.rollbackAvailable === true);
  });
});
