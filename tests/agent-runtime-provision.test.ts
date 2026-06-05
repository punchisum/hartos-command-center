/**
 * tests/agent-runtime-provision.test.ts
 *
 * Phase 18D — first runtime-layer provisioning. Hermetic: deploy ops are mocked, a throwing fetch
 * is installed, the scaffold (wrangler.toml) is written into a temp workdir. ZERO network, ZERO
 * provider, ZERO CLI. Proves: dry-run by default; fail-closed on missing gates/confirms; production
 * hard-refuse; custom-routing refuse; cross-phase SUPABASE_URL mismatch refuse; full gates → deploy
 * runs the ordered pipeline + advances the proposal to runtime_provisioned (Hart's locked decision);
 * a mid-pipeline failure auto-reverts ONLY the webhook; a pre-webhook failure reverts nothing; the
 * overwrite guard refuses silent overwrite; no secrets in ledger/report; executeProposal throws;
 * the Worker can't import this path; no provisioning-engine import.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
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
  runRuntimeProvision,
  runRuntimeRollback,
  RuntimeProvisionPreconditionError,
  parseWrangler,
  createMockRuntimeDeployOps,
  type RuntimeDeployOps,
  type RuntimeStepResult,
} from "../src/execution/index.js";

const NOW = "2026-06-05T12:00:00.000Z";
const WORKER = "tax-agent";
const BOT = "123456";
const WORKER_URL = "https://w.example.com";
const WEBHOOK_URL = `${WORKER_URL}/telegram/webhook`;
const SECRET = "super_secret_service_role_key_value_aaaaaaaaaaaaaaaaaa";

const WRANGLER = (supabaseUrl = "") => `name = "${WORKER}"
main = "dist/src/index.js"
compatibility_date = "2026-06-03"

[vars]
APP_ENV = "local"

[env.staging.vars]
APP_ENV = "staging"
SUPABASE_URL = "${supabaseUrl}"
`;

const FULL = {
  ALLOW_RUNTIME_PROVISION: "true",
  CONFIRM_RUNTIME_MUTATION: "true",
  HARTOS_TARGET_ENV: "staging",
  CONFIRM_CLOUDFLARE_WORKER_NAME: WORKER,
  CONFIRM_TELEGRAM_BOT_ID: BOT,
  HARTOS_RUNTIME_WORKER_URL: WORKER_URL,
  // Secret values present so the manifest uploads them — values never logged/ledgered.
  SUPABASE_SERVICE_ROLE_KEY: SECRET,
  TELEGRAM_BOT_TOKEN: "bot-token-value",
  TELEGRAM_WEBHOOK_SECRET: "whsecret",
};

/** Recording mock ops. getWebhookInfo returns the MATCHING url so the success smoke passes. */
function recOps(overrides: Partial<RuntimeDeployOps> = {}) {
  const calls: string[] = [];
  const wrap =
    (name: string, fn: (...a: any[]) => Promise<RuntimeStepResult>) =>
    async (...a: any[]) => {
      calls.push(name);
      return fn(...a);
    };
  const base = createMockRuntimeDeployOps({
    getWebhookInfo: async () => ({ success: true, message: "mock", data: { hasWebhook: true, pendingUpdates: 0, webhookUrl: WEBHOOK_URL } }),
    getMe: async () => ({ success: true, message: "mock", data: { username: "testbot", botId: 123456 } }),
  });
  const ops: RuntimeDeployOps = {
    workerExists: wrap("workerExists", overrides.workerExists ?? base.workerExists),
    uploadSecrets: wrap("uploadSecrets", overrides.uploadSecrets ?? base.uploadSecrets),
    deployWorker: wrap("deployWorker", overrides.deployWorker ?? base.deployWorker),
    workerHealth: wrap("workerHealth", overrides.workerHealth ?? base.workerHealth),
    deployTasks: wrap("deployTasks", overrides.deployTasks ?? base.deployTasks),
    getMe: wrap("getMe", overrides.getMe ?? base.getMe),
    getWebhookInfo: wrap("getWebhookInfo", overrides.getWebhookInfo ?? base.getWebhookInfo),
    setWebhook: wrap("setWebhook", overrides.setWebhook ?? base.setWebhook),
    deleteWebhook: wrap("deleteWebhook", overrides.deleteWebhook ?? base.deleteWebhook),
  };
  return { ops, calls };
}

async function setup(dir: string, opts: { wrangler?: string; appliedRef?: string } = {}): Promise<{ id: string; specId: string }> {
  const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: [], now: NOW, env: {} };
  const p = generateProposals(ctx)[0]!;
  // Force a known agent name into the payload so worker-name confirm is deterministic.
  (p.proposedPayload as Record<string, unknown>)["agentName"] = WORKER;
  await saveProposal(dir, p, NOW);
  await markSimulatedApproved(dir, { id: p.id }, NOW);
  await approveForExecution(dir, { id: p.id }, NOW);
  const item = await readProposal(dir, p.id);
  const specId = item!.specId!;
  const scaffold = path.join(dir, "agent-scaffold", specId);
  await mkdir(scaffold, { recursive: true });
  await writeFile(path.join(scaffold, "wrangler.toml"), opts.wrangler ?? WRANGLER(), "utf8");
  if (opts.appliedRef) {
    const ddir = path.join(dir, "data-provision-reports");
    await mkdir(ddir, { recursive: true });
    await writeFile(
      path.join(ddir, "data-provision-ledger.json"),
      JSON.stringify({ agentName: WORKER, entries: [{ mode: "applied", projectRef: opts.appliedRef }] }, null, 2),
      "utf8"
    );
  }
  return { id: p.id, specId };
}

describe("18D — runtime provisioning (no network, no provider)", () => {
  let dir: string;
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (() => { throw new Error("network call attempted in 18D test"); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "rt-prov-")); });

  it("parseWrangler extracts name, env SUPABASE_URL, custom-routing flag", () => {
    const w = parseWrangler(WRANGLER("https://ref123.supabase.co"), "staging");
    assert.equal(w.workerName, WORKER);
    assert.equal(w.supabaseUrl, "https://ref123.supabase.co");
    assert.equal(w.hasCustomRouting, false);
    assert.equal(w.hasTargetEnvSection, true);
    const routed = parseWrangler(WRANGLER() + '\nroute = "tax.example.com/*"\n', "staging");
    assert.equal(routed.hasCustomRouting, true);
  });

  it("no gates → dry-run only, no mutating op called, proposal NOT advanced", async () => {
    const { id } = await setup(dir);
    const { ops, calls } = recOps();
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: {}, ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(r.advanced, false);
    assert.equal(calls.includes("uploadSecrets"), false);
    assert.equal(calls.includes("deployWorker"), false);
    assert.equal(calls.includes("setWebhook"), false);
    assert.equal((await readProposal(dir, id))!.status, "approved_for_execution");
  });

  it("production label → hard-refused dry-run", async () => {
    const { id } = await setup(dir);
    const { ops } = recOps();
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: { ...FULL, HARTOS_TARGET_ENV: "production" }, ops });
    assert.equal(r.mode, "dry_run");
    assert.ok(r.instructions.some((l) => /HARD BLOCK/.test(l)));
  });

  it("custom routing in wrangler → refused precondition (dry-run, workers.dev only)", async () => {
    const { id } = await setup(dir, { wrangler: WRANGLER() + '\nroute = "tax.example.com/*"\n' });
    const { ops, calls } = recOps();
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL, ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(calls.includes("deployWorker"), false);
    assert.ok(r.instructions.some((l) => /routes\/domain/.test(l)));
  });

  it("cross-phase SUPABASE_URL mismatch → refused (won't wire runtime to un-migrated DB)", async () => {
    const { id } = await setup(dir, { wrangler: WRANGLER("https://wrongref.supabase.co"), appliedRef: "rightref" });
    const { ops, calls } = recOps();
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL, ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(r.crossPhase.consistent, false);
    assert.equal(calls.includes("deployWorker"), false);
  });

  it("worker-name confirm mismatch → dry-run (typo guard)", async () => {
    const { id } = await setup(dir);
    const { ops } = recOps();
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: { ...FULL, CONFIRM_CLOUDFLARE_WORKER_NAME: "wrong" }, ops });
    assert.equal(r.mode, "dry_run");
  });

  it("full gates → ordered deploy, smoke passes, proposal ADVANCED to runtime_provisioned", async () => {
    const { id } = await setup(dir);
    const { ops, calls } = recOps();
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL, ops });
    assert.equal(r.mode, "deployed");
    assert.equal(r.advanced, true);
    assert.equal(r.webhookReverted, false);
    // Ordering: secrets → worker → health → trigger → webhook (before-webhook health precedes setWebhook).
    const order = calls.filter((c) => ["uploadSecrets", "deployWorker", "workerHealth", "deployTasks", "setWebhook"].includes(c));
    assert.deepEqual(order.slice(0, 5), ["uploadSecrets", "deployWorker", "workerHealth", "deployTasks", "setWebhook"]);
    assert.equal((await readProposal(dir, id))!.status, "runtime_provisioned");
  });

  it("mid-pipeline failure AFTER webhook (smoke fails) → auto-reverts ONLY the webhook", async () => {
    const { id } = await setup(dir);
    // getWebhookInfo returns a NON-matching url → smokeOk false → revert. Prior webhook empty → deleteWebhook.
    const { ops, calls } = recOps({
      getWebhookInfo: async () => ({ success: true, message: "mock", data: { hasWebhook: false, pendingUpdates: 0, webhookUrl: "" } }),
    });
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL, ops });
    assert.equal(r.mode, "deploy_failed");
    assert.equal(r.advanced, false);
    assert.equal(r.webhookReverted, true);
    assert.equal(calls.includes("setWebhook"), true);
    assert.equal(calls.includes("deleteWebhook"), true, "prior webhook empty → revert via deleteWebhook");
    assert.ok(r.steps.some((s) => s.step === "revert_webhook" && s.status === "reverted"));
    assert.equal((await readProposal(dir, id))!.status, "approved_for_execution");
  });

  it("pre-webhook failure (worker deploy fails) → fail-stop, NOTHING reverted, webhook never set", async () => {
    const { id } = await setup(dir);
    const { ops, calls } = recOps({
      deployWorker: async () => ({ success: false, message: "mock: deploy boom" }),
    });
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL, ops });
    assert.equal(r.mode, "deploy_failed");
    assert.equal(r.webhookReverted, false);
    assert.equal(calls.includes("setWebhook"), false);
    assert.equal(calls.includes("deleteWebhook"), false);
    assert.equal(r.steps.some((s) => s.step === "deploy_tasks"), false, "fail-stop: later steps not attempted");
  });

  it("overwrite guard: existing worker without ALLOW_RUNTIME_OVERWRITE → refused", async () => {
    const { id } = await setup(dir);
    const { ops } = recOps({
      workerExists: async () => ({ success: true, message: "exists", data: { exists: true, checked: true } }),
    });
    await assert.rejects(
      () => runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL, ops }),
      /Refusing to overwrite/
    );
  });

  it("overwrite ALLOWED with ALLOW_RUNTIME_OVERWRITE=true → deploys", async () => {
    const { id } = await setup(dir);
    const { ops } = recOps({
      workerExists: async () => ({ success: true, message: "exists", data: { exists: true, checked: true } }),
    });
    const r = await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: { ...FULL, ALLOW_RUNTIME_OVERWRITE: "true" }, ops });
    assert.equal(r.mode, "deployed");
  });

  it("full gates but HARTOS_RUNTIME_WORKER_URL missing → precondition error (no partial deploy)", async () => {
    const { id } = await setup(dir);
    const { ops } = recOps();
    const env = { ...FULL };
    delete (env as Record<string, string>)["HARTOS_RUNTIME_WORKER_URL"];
    await assert.rejects(
      () => runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env, ops }),
      /HARTOS_RUNTIME_WORKER_URL/
    );
  });

  it("no secret value ever appears in the report or ledger", async () => {
    const { id, specId } = await setup(dir);
    const { ops } = recOps();
    await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: FULL, ops });
    const reportsDir = path.join(dir, "runtime-provision-reports");
    const ledger = await readFile(path.join(reportsDir, "runtime-provision-ledger.json"), "utf8");
    assert.equal(ledger.includes(SECRET), false, "ledger must not contain a secret value");
    // The report file name embeds specId; read it back and check.
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(reportsDir)).filter((f) => f.startsWith(`runtime-provision-${specId}-`) && f.endsWith(".json"));
    for (const f of files) {
      assert.equal((await readFile(path.join(reportsDir, f), "utf8")).includes(SECRET), false);
    }
  });

  it("unauthorized proposal (not approved_for_execution) → fail closed", async () => {
    const ctx: ProposalContext = { request: "x", intent: "build_agent", panels: [], now: NOW, env: {} };
    const p = generateProposals(ctx)[0]!;
    await saveProposal(dir, p, NOW);
    await markSimulatedApproved(dir, { id: p.id }, NOW); // stops at simulated_approved (no Key 1)
    await assert.rejects(
      () => runRuntimeProvision({ cwd: dir, ref: { id: p.id }, now: NOW, env: FULL, ops: recOps().ops }),
      RuntimeProvisionPreconditionError
    );
  });

  it("manual rollback surfaces the latest plan, touches nothing", async () => {
    const { id } = await setup(dir);
    await runRuntimeProvision({ cwd: dir, ref: { id }, now: NOW, env: {}, ops: recOps().ops });
    const rb = await runRuntimeRollback({ cwd: dir, ref: { id }, now: NOW, env: {} });
    assert.equal(rb.mode, "instructions");
    assert.ok(rb.rollbackPlanPath && rb.rollbackPlanPath.includes("rollback-plan-"));
    assert.ok(rb.instructions.some((l) => /MANUAL/.test(l)));
  });

  it("executeProposal still throws", () => {
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });

  it("the hosted Worker does not import the runtime-provision path", async () => {
    const worker = await readFile(path.join(process.cwd(), "src/runtime/cloudflare-cockpit-worker.ts"), "utf8");
    assert.equal(/from\s+["'][^"']*execution[^"']*["']/.test(worker), false, "Worker must not import src/execution");
    assert.equal(/runtime-provision/.test(worker), false, "Worker must not reference runtime-provision");
  });

  it("18D orchestrator does not import the loose provisioning engine", async () => {
    const src = await readFile(path.join(process.cwd(), "src/execution/agent-runtime-provision.ts"), "utf8");
    assert.equal(/provisioning\/engine|provisioning\/gates/.test(src), false, "must not use the 7B auto-provision engine/gates");
  });
});
