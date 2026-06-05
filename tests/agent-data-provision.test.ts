/**
 * tests/agent-data-provision.test.ts
 *
 * Phase 18C — first data-layer provisioning. Hermetic: apply ops are mocked, a throwing
 * fetch is installed, and migrations are written into a temp scaffold workdir. ZERO network,
 * ZERO real DB, ZERO CLI. Proves: dry-run by default; fail-closed on missing target / wrong
 * confirm / production label / destructive SQL; safe SQL + full gates → mocked apply; the
 * apply CLI is NEVER reached unless every gate is open; migration hashes recorded; no secrets
 * in ledger/report; proposal is NOT advanced; the Worker can't import this path; no
 * Cloudflare/Telegram/Trigger imports.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveProposal,
  markSimulatedApproved,
  approveForExecution,
  generateProposals,
  executeProposal,
  ActionExecutionDisabledError,
  readProposal,
  type ProposalContext,
} from "../src/cockpit/proposals/index.js";
import {
  runDataLayerProvision,
  runDataLayerRollback,
  DataProvisionPreconditionError,
  createMockApplyOps,
  type SupabaseMigrationApplyOps,
} from "../src/execution/index.js";

const NOW = "2026-06-05T12:00:00.000Z";
const REF = "abcdef123456";

const FULL_GATES = {
  ALLOW_SUPABASE_MIGRATION_APPLY: "true",
  CONFIRM_DATA_LAYER_MUTATION: "true",
  HARTOS_SUPABASE_PROJECT_REF: REF,
  CONFIRM_SUPABASE_TARGET_PROJECT: REF,
  HARTOS_TARGET_ENV: "test",
  HARTOS_SUPABASE_URL: `https://${REF}.supabase.co`,
  HARTOS_SUPABASE_ACCESS_TOKEN: "sbp_placeholdertokenvalue",
};

const SAFE_MIGRATIONS: Record<string, string> = {
  "000001_core.sql": "create table if not exists public.agent_runs (id uuid primary key);\n",
  "000002_events.sql":
    "create table if not exists public.command_events (id uuid primary key);\n" +
    "alter table public.command_events enable row level security;\n",
};
const DESTRUCTIVE_MIGRATION = { "000003_drop.sql": "drop table public.agent_runs;\n" };

/** Recording mock apply ops — no CLI, no network. */
function recordingOps(overrides: Partial<SupabaseMigrationApplyOps> = {}): {
  ops: SupabaseMigrationApplyOps;
  applyCalls: number;
  smokeCalls: number;
} {
  const state = { applyCalls: 0, smokeCalls: 0 };
  const ops = createMockApplyOps({
    applyViaCli: async () => {
      state.applyCalls++;
      return { success: true, message: "mock: db push completed", detail: "mock" };
    },
    smokeTables: async (p) => {
      state.smokeCalls++;
      return p.tables.map((t) => ({ table: t, exists: true, status: "HTTP 200" }));
    },
    ...overrides,
  });
  return {
    ops,
    get applyCalls() { return state.applyCalls; },
    get smokeCalls() { return state.smokeCalls; },
  };
}

/** Authorized proposal + migrations written into the scaffold workdir. Returns {id, specId}. */
async function setup(dir: string, migrations: Record<string, string>): Promise<{ id: string; specId: string }> {
  const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: [], now: NOW, env: {} };
  const p = generateProposals(ctx)[0]!;
  await saveProposal(dir, p, NOW);
  await markSimulatedApproved(dir, { id: p.id }, NOW);
  await approveForExecution(dir, { id: p.id }, NOW);
  const item = await readProposal(dir, p.id);
  const specId = item!.specId!;
  const migDir = path.join(dir, "agent-scaffold", specId, "supabase", "migrations");
  await mkdir(migDir, { recursive: true });
  for (const [name, sql] of Object.entries(migrations)) {
    await writeFile(path.join(migDir, name), sql, "utf8");
  }
  return { id: p.id, specId };
}

describe("18C — data-layer provisioning (no network, no DB)", () => {
  let dir: string;
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (() => { throw new Error("network call attempted in 18C test"); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "data-prov-")); });

  it("no gates → dry-run only, apply CLI never called, nothing mutated", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env: {}, applyOps: rec.ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(r.applied, false);
    assert.equal(r.providerMutations, 0);
    assert.equal(rec.applyCalls, 0, "apply CLI must not be reached without gates");
    assert.equal(r.migrationCount, 2);
    const item = await readProposal(dir, id);
    assert.ok(item!.auditEvents.some((e) => e.event === "data_provision_dryrun"));
    assert.equal(item!.status, "approved_for_execution", "proposal must not advance");
    await rm(dir, { recursive: true, force: true });
  });

  it("missing target ref → fail closed (dry-run)", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    const env = { ...FULL_GATES, HARTOS_SUPABASE_PROJECT_REF: "" };
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env, applyOps: rec.ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(rec.applyCalls, 0);
    assert.ok(r.instructions.some((l) => l.includes("HARTOS_SUPABASE_PROJECT_REF")));
    await rm(dir, { recursive: true, force: true });
  });

  it("confirm-target ref mismatch → fail closed (typo guard)", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    const env = { ...FULL_GATES, CONFIRM_SUPABASE_TARGET_PROJECT: "wrongref000000" };
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env, applyOps: rec.ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(rec.applyCalls, 0);
    await rm(dir, { recursive: true, force: true });
  });

  it("URL points at a different project than the ref → fail closed (mismatch)", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    const env = { ...FULL_GATES, HARTOS_SUPABASE_URL: "https://otherproject.supabase.co" };
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env, applyOps: rec.ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(rec.applyCalls, 0);
    await rm(dir, { recursive: true, force: true });
  });

  it("production label → hard-refused even with all gates set", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    const env = { ...FULL_GATES, HARTOS_TARGET_ENV: "production" };
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env, applyOps: rec.ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(rec.applyCalls, 0);
    assert.ok(r.instructions.some((l) => /refused|HARD BLOCK/i.test(l)));
    await rm(dir, { recursive: true, force: true });
  });

  it("destructive SQL without override → blocked (dry-run), apply CLI never called", async () => {
    const { id } = await setup(dir, { ...SAFE_MIGRATIONS, ...DESTRUCTIVE_MIGRATION });
    const rec = recordingOps();
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL_GATES, applyOps: rec.ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(r.scanClean, false);
    assert.equal(r.overallRisk, "irreversible");
    assert.equal(rec.applyCalls, 0, "destructive scan must block apply");
    assert.ok(r.instructions.some((l) => l.includes("ALLOW_DESTRUCTIVE_SQL")));
    await rm(dir, { recursive: true, force: true });
  });

  it("destructive SQL WITH override + full gates → mocked apply proceeds", async () => {
    const { id } = await setup(dir, { ...SAFE_MIGRATIONS, ...DESTRUCTIVE_MIGRATION });
    const rec = recordingOps();
    const env = { ...FULL_GATES, ALLOW_DESTRUCTIVE_SQL: "true" };
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env, applyOps: rec.ops });
    assert.equal(r.mode, "applied");
    assert.equal(rec.applyCalls, 1);
    await rm(dir, { recursive: true, force: true });
  });

  it("safe SQL + full gates → mocked apply, hashes recorded, proposal NOT advanced", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL_GATES, applyOps: rec.ops });
    assert.equal(r.mode, "applied");
    assert.equal(r.applied, true);
    assert.equal(r.providerMutations, 0);
    assert.equal(rec.applyCalls, 1);

    // Ledger records per-file SHA-256.
    const ledgerRaw = await readFile(path.join(dir, "data-provision-reports", "data-provision-ledger.json"), "utf8");
    const ledger = JSON.parse(ledgerRaw);
    const entry = ledger.entries.at(-1);
    assert.equal(entry.mode, "applied");
    assert.equal(entry.migrations.length, 2);
    for (const m of entry.migrations) assert.match(m.sha256, /^[a-f0-9]{64}$/);

    const item = await readProposal(dir, id);
    assert.ok(item!.auditEvents.some((e) => e.event === "data_provision_applied"));
    assert.equal(item!.status, "approved_for_execution", "18C must not advance the proposal");
    await rm(dir, { recursive: true, force: true });
  });

  it("post-apply smoke runs read-only when a smoke key is present", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    const env = { ...FULL_GATES, HARTOS_SUPABASE_ANON_KEY: "anonkeyplaceholdervalue1234567890" };
    const r = await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env, applyOps: rec.ops });
    assert.equal(r.mode, "applied");
    assert.ok(r.smoke && r.smoke.length > 0);
    assert.equal(rec.smokeCalls, 1);
    await rm(dir, { recursive: true, force: true });
  });

  it("no migrations directory → fail closed (precondition error)", async () => {
    const ctx: ProposalContext = { request: "x", intent: "build_agent", panels: [], now: NOW, env: {} };
    const p = generateProposals(ctx)[0]!;
    await saveProposal(dir, p, NOW);
    await markSimulatedApproved(dir, { id: p.id }, NOW);
    await approveForExecution(dir, { id: p.id }, NOW); // authorized but no scaffold built
    await assert.rejects(
      () => runDataLayerProvision({ cwd: dir, ref: { id: p.id }, now: NOW, env: FULL_GATES, applyOps: recordingOps().ops }),
      DataProvisionPreconditionError
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("unauthorized proposal (not approved_for_execution) → fail closed", async () => {
    const ctx: ProposalContext = { request: "x", intent: "build_agent", panels: [], now: NOW, env: {} };
    const p = generateProposals(ctx)[0]!;
    await saveProposal(dir, p, NOW); // only saved, not authorized
    await assert.rejects(
      () => runDataLayerProvision({ cwd: dir, ref: { id: p.id }, now: NOW, env: FULL_GATES, applyOps: recordingOps().ops }),
      DataProvisionPreconditionError
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("ledger and report contain no secret-shaped values", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL_GATES, applyOps: rec.ops });
    const reportsDir = path.join(dir, "data-provision-reports");
    for (const f of await readdir(reportsDir)) {
      const content = await readFile(path.join(reportsDir, f), "utf8");
      assert.equal(/sbp_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{16,}\./.test(content), false, `${f} leaked a secret`);
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("rollback is manual-only: instructions, no DB connection, plan surfaced", async () => {
    const { id } = await setup(dir, SAFE_MIGRATIONS);
    const rec = recordingOps();
    await runDataLayerProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL_GATES, applyOps: rec.ops });
    const rb = await runDataLayerRollback({ cwd: dir, ref: { id }, now: NOW, env: {}, applyOps: rec.ops });
    assert.equal(rb.mode, "instructions");
    assert.ok(rb.rollbackPlanPath, "a rollback plan should have been generated during provision");
    assert.ok(rb.instructions.some((l) => /manual/i.test(l)));
    const item = await readProposal(dir, id);
    assert.ok(item!.auditEvents.some((e) => e.event === "data_provision_rollback_instructions"));
    await rm(dir, { recursive: true, force: true });
  });

  it("executeProposal still throws", () => {
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });

  it("the hosted Worker does not import the data-provision path", async () => {
    const worker = await readFile(path.join(process.cwd(), "src/runtime/cloudflare-cockpit-worker.ts"), "utf8");
    assert.equal(/from\s+["'][^"']*execution[^"']*["']/.test(worker), false, "Worker must not import src/execution");
  });

  it("18C touches no Cloudflare/Telegram/Trigger/GitHub provider modules", async () => {
    for (const f of [
      "src/execution/agent-data-provision.ts",
      "src/supabase/migration-apply-ops.ts",
      "src/supabase/data-layer-gates.ts",
      "src/supabase/destructive-sql-scan.ts",
    ]) {
      const src = await readFile(path.join(process.cwd(), f), "utf8");
      assert.equal(
        /adapters\/(cloudflare|telegram|trigger|github)|provisioning\/engine|register-telegram|deploy-cloudflare/.test(src),
        false,
        `${f} must not import deploy/registration provider modules`
      );
    }
  });
});
