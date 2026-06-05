/**
 * src/execution/agent-runtime-provision.ts
 *
 * Phase 18D — first RUNTIME-layer provisioning: deploy a generated agent's Cloudflare Worker,
 * upload its secrets, register its Trigger.dev tasks, and point its Telegram webhook — then
 * read-only smoke it. The first phase that touches external COMPUTE and TRAFFIC. Everything is
 * gated; with any gate closed it produces a DRY-RUN report (plan + pre-flight probes + rollback
 * plan) and mutates nothing.
 *
 * Scope (enforced): runtime deploy of ONE generated agent, from its local scaffold workdir, by
 * specId. NO project/account creation, NO Supabase apply (that's 18C), NO GitHub merge, NO custom
 * routes/domains (workers.dev only), NO production (hard-refused). Node CLI only — never reachable
 * from the hosted Worker. executeProposal() still throws.
 *
 * Hart's locked 18D decisions, implemented here:
 *   (1) Rollback = AUTO-REVERT WEBHOOK ONLY on mid-pipeline failure (restore the captured prior
 *       webhook state); worker/trigger/secrets get a MANUAL rollback plan (like 18C).
 *   (2) ONE all-or-nothing gate opens the whole pipeline (see runtime-layer-gates).
 *   (3) ADVANCE ON FULL SUCCESS — on all-steps-pass + smoke-pass, advance the proposal to the
 *       terminal `runtime_provisioned` state (still requires Key 1 + every gate; production stays
 *       refused).
 */

import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { containsSecret } from "../llm/redaction.js";
import {
  resolveRef,
  appendAudit,
  markRuntimeProvisioned,
  type ProposalRef,
} from "../cockpit/proposals/proposal-queue.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { DEFAULT_SCAFFOLD_DIR } from "./local-scaffold-build.js";
import { DEFAULT_DATA_PROVISION_REPORTS_DIR } from "./agent-data-provision.js";
import { refFromUrl } from "../supabase/data-layer-gates.js";
import {
  readRuntimeGates,
  type RuntimeGateConfig,
} from "../runtime-provision/runtime-layer-gates.js";
import {
  realRuntimeDeployOps,
  type RuntimeDeployOps,
  type RuntimeStepResult,
} from "../runtime-provision/runtime-deploy-ops.js";

export const DEFAULT_RUNTIME_PROVISION_REPORTS_DIR = "runtime-provision-reports";

/** Worker secrets the generated agent expects (NAMES only — values come from host env at apply). */
export const WORKER_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "TRIGGER_SECRET_KEY",
];

/** 18D registers Trigger tasks to STAGING only (cron tasks can fire on register — design decision). */
export const TRIGGER_ENV = "staging";

const WORKER_URL_KEY = "HARTOS_RUNTIME_WORKER_URL";
const WEBHOOK_PATH_KEY = "HARTOS_RUNTIME_WEBHOOK_PATH";
const DEFAULT_WEBHOOK_PATH = "/telegram/webhook";
const WEBHOOK_SECRET_KEY = "TELEGRAM_WEBHOOK_SECRET";

export class RuntimeProvisionPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeProvisionPreconditionError";
  }
}

// ─── Authorization (Key 1) ────────────────────────────────────────────────────

function loadAuthorized(item: ProposalQueueItem | null): ProposalQueueItem {
  if (!item) throw new RuntimeProvisionPreconditionError("Proposal not found.");
  if (item.actionType !== "agent_creation_plan") {
    throw new RuntimeProvisionPreconditionError(
      `18D only supports agent_creation_plan, got "${item.actionType}".`
    );
  }
  if (item.status !== "approved_for_execution") {
    throw new RuntimeProvisionPreconditionError(
      `Proposal must be approved_for_execution (was "${item.status}"). Authorize it first (Key 1).`
    );
  }
  return item;
}

// ─── Scaffold wrangler inventory ──────────────────────────────────────────────

export interface WranglerInventory {
  wranglerPath: string | null;
  workerName: string | null;
  /** SUPABASE_URL configured for the target env (or top-level), if any. */
  supabaseUrl: string | null;
  /** True if the config declares custom routes / a custom domain (refused — workers.dev only). */
  hasCustomRouting: boolean;
  /** True if a [env.<targetEnv>] section exists in the config. */
  hasTargetEnvSection: boolean;
}

/** Locate the scaffold's wrangler config: prefer the real file, fall back to the .example. */
function findWranglerPath(scaffoldDir: string): string | null {
  for (const name of ["wrangler.toml", "wrangler.toml.example"]) {
    const p = path.join(scaffoldDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Minimal, section-aware TOML scan — no external dep, tolerant of the scaffold's simple shape. */
export function parseWrangler(raw: string, targetEnv: string): Omit<WranglerInventory, "wranglerPath"> {
  const lines = raw.split(/\r?\n/);
  let workerName: string | null = null;
  let supabaseUrl: string | null = null;
  let supabaseUrlTopLevel: string | null = null;
  let hasCustomRouting = false;
  let hasTargetEnvSection = false;

  let section = ""; // current [section] header
  const envSectionRe = new RegExp(`^\\[env\\.${targetEnv}(\\.|\\])`);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") continue;

    const header = /^\[(.+)\]$/.exec(trimmed) || /^\[\[(.+)\]\]$/.exec(trimmed);
    if (header) {
      section = trimmed;
      if (envSectionRe.test(trimmed)) hasTargetEnvSection = true;
      // Custom routing declared via a [[routes]] / [env.X.routes] style table.
      if (/\broutes?\b/i.test(trimmed)) hasCustomRouting = true;
      continue;
    }

    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1]!;
    const valRaw = kv[2]!.trim();
    const val = /^"(.*)"$/.exec(valRaw)?.[1] ?? /^'(.*)'$/.exec(valRaw)?.[1] ?? valRaw;

    if (key === "name" && section === "" && !workerName) workerName = val;
    if (key === "route" || key === "custom_domain") {
      if (val) hasCustomRouting = true;
    }
    if (key === "SUPABASE_URL") {
      if (envSectionRe.test(section)) supabaseUrl = val || supabaseUrl;
      else if (section === "[vars]" || section === "") supabaseUrlTopLevel = val || supabaseUrlTopLevel;
    }
  }

  return {
    workerName,
    supabaseUrl: supabaseUrl || supabaseUrlTopLevel || null,
    hasCustomRouting,
    hasTargetEnvSection,
  };
}

async function buildWranglerInventory(scaffoldDir: string, targetEnv: string): Promise<WranglerInventory> {
  const wranglerPath = findWranglerPath(scaffoldDir);
  if (!wranglerPath) {
    return { wranglerPath: null, workerName: null, supabaseUrl: null, hasCustomRouting: false, hasTargetEnvSection: false };
  }
  const raw = await readFile(wranglerPath, "utf8");
  return { wranglerPath, ...parseWrangler(raw, targetEnv) };
}

// ─── Cross-phase consistency (18C ↔ 18D) ──────────────────────────────────────

export interface CrossPhaseConsistency {
  /** The Supabase project ref 18C last APPLIED to (from data-provision-ledger.json), or null. */
  dataLayerRef: string | null;
  /** The Supabase project ref the worker config points at (from SUPABASE_URL), or null. */
  workerSupabaseRef: string | null;
  /** true = both present and equal; false = both present and DIFFER (block); null = can't verify. */
  consistent: boolean | null;
  note: string;
}

/** Read the latest APPLIED data-layer entry's project ref so the runtime can't wire to the wrong DB. */
async function readDataLayerRef(cwd: string, reportsDir: string): Promise<string | null> {
  const file = path.join(cwd, reportsDir, "data-provision-ledger.json");
  if (!existsSync(file)) return null;
  try {
    const ledger = JSON.parse(await readFile(file, "utf8")) as {
      entries?: Array<{ mode?: string; projectRef?: string | null }>;
    };
    const applied = (ledger.entries ?? []).filter((e) => e.mode === "applied" && e.projectRef);
    return applied.length ? applied[applied.length - 1]!.projectRef ?? null : null;
  } catch {
    return null;
  }
}

function assessConsistency(dataLayerRef: string | null, supabaseUrl: string | null): CrossPhaseConsistency {
  const workerSupabaseRef = refFromUrl(supabaseUrl);
  if (!dataLayerRef) {
    return { dataLayerRef, workerSupabaseRef, consistent: null, note: "No applied 18C data-layer entry found — cannot verify the runtime points at a migrated project." };
  }
  if (!workerSupabaseRef) {
    return { dataLayerRef, workerSupabaseRef, consistent: null, note: "Worker SUPABASE_URL is unset/unparseable — cannot verify it matches the 18C-migrated project. Set it before applying." };
  }
  if (workerSupabaseRef.toLowerCase() === dataLayerRef.toLowerCase()) {
    return { dataLayerRef, workerSupabaseRef, consistent: true, note: "Worker SUPABASE_URL matches the 18C-migrated project ref." };
  }
  return {
    dataLayerRef,
    workerSupabaseRef,
    consistent: false,
    note: `Worker SUPABASE_URL points at "${workerSupabaseRef}" but 18C migrated "${dataLayerRef}" — REFUSING (would deploy a runtime wired to an un-migrated database).`,
  };
}

// ─── Secret manifest (NAMES + presence only — never values) ────────────────────

interface SecretManifest {
  present: string[];
  missing: string[];
  /** Values map for upload (only the present ones). Never logged/ledgered. */
  values: Record<string, string>;
}

function buildSecretManifest(env: Record<string, string | undefined>): SecretManifest {
  const present: string[] = [];
  const missing: string[] = [];
  const values: Record<string, string> = {};
  for (const name of WORKER_SECRETS) {
    const v = env[name]?.trim();
    if (v) {
      present.push(name);
      values[name] = v;
    } else {
      missing.push(name);
    }
  }
  return { present, missing, values };
}

// ─── Ledger + report (never hold secrets) ─────────────────────────────────────

export type StepStatus = "ok" | "failed" | "skipped" | "reverted";

export interface RuntimeStep {
  step: string;
  status: StepStatus;
  message: string;
}

export interface RuntimeProvisionLedgerEntry {
  timestamp: string;
  mode: "dry_run" | "deployed" | "deploy_failed";
  specId: string;
  proposalId: string;
  agentName: string;
  workerName: string | null;
  targetEnv: string | null;
  triggerEnv: string;
  secretNames: string[];
  secretsMissing: string[];
  steps: RuntimeStep[];
  gatesOpen: boolean;
  allowOverwrite: boolean;
  webhookReverted: boolean;
  crossPhase: CrossPhaseConsistency;
  advanced: boolean;
  reportPath: string;
  rollbackPlanPath: string;
}

interface RuntimeProvisionLedger {
  agentName: string;
  entries: RuntimeProvisionLedgerEntry[];
  lastUpdated: string;
}

function assertNoSecrets(obj: unknown, where: string): void {
  if (containsSecret(JSON.stringify(obj))) {
    throw new RuntimeProvisionPreconditionError(
      `Refusing to write ${where}: a secret-looking value was detected. Ledger/report must never hold secrets.`
    );
  }
}

async function appendLedger(reportsDir: string, agentName: string, entry: RuntimeProvisionLedgerEntry): Promise<void> {
  const file = path.join(reportsDir, "runtime-provision-ledger.json");
  let existing: RuntimeProvisionLedger | null = null;
  if (existsSync(file)) existing = JSON.parse(await readFile(file, "utf8")) as RuntimeProvisionLedger;
  const ledger: RuntimeProvisionLedger = {
    agentName,
    entries: [...(existing?.entries ?? []), entry],
    lastUpdated: entry.timestamp,
  };
  assertNoSecrets(ledger, "runtime-provision ledger");
  await writeFile(file, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

function buildRollbackPlan(agentName: string, workerName: string | null, targetEnv: string | null): string[] {
  return [
    "# Manual rollback plan (Phase 18D — runtime layer)",
    "",
    `Agent: ${agentName}   Worker: ${workerName ?? "<unset>"}   Env: ${targetEnv ?? "<unset>"}`,
    "",
    "18D auto-reverts ONLY the Telegram webhook on a mid-pipeline failure. Worker / Trigger / secrets",
    "rollback is MANUAL and reviewed by hand — nothing below is executed automatically.",
    "",
    "## To undo a runtime deploy (review before running)",
    `- Delete the Worker:    wrangler delete --name ${workerName ?? "<worker>"} --env ${targetEnv ?? "<env>"}`,
    "- Remove the webhook:   call deleteWebhook on the bot (or restore its prior URL).",
    "- Trigger.dev:          roll back to the previous deploy version in the Trigger dashboard.",
    "- Secrets:              `wrangler secret delete <NAME>` per uploaded secret if the Worker is removed.",
    "",
    "## Recommended",
    "- Prefer rolling forward (redeploy a corrected build) over deleting the Worker.",
    "- The webhook is the only traffic-bearing change — verify it points where you expect after any rollback.",
    "",
  ];
}

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface RuntimeProvisionResult {
  mode: "dry_run" | "deployed" | "deploy_failed";
  specId: string;
  proposalId: string;
  agentName: string;
  workerName: string | null;
  targetEnv: string | null;
  triggerEnv: string;
  steps: RuntimeStep[];
  secretNames: string[];
  secretsMissing: string[];
  crossPhase: CrossPhaseConsistency;
  /** Always false — there is no executeProposal() path; 18D advances status via the executor only. */
  executed: false;
  /** True only when the proposal was advanced to runtime_provisioned (full success). */
  advanced: boolean;
  webhookReverted: boolean;
  reportPath: string;
  rollbackPlanPath: string;
  instructions: string[];
}

export interface RuntimeProvisionOptions {
  cwd: string;
  ref: ProposalRef;
  now: string;
  env?: Record<string, string | undefined>;
  outRoot?: string;
  reportsDir?: string;
  dataProvisionReportsDir?: string;
  /** Injected in tests; defaults to the real composed ops (reached only when gated open). */
  ops?: RuntimeDeployOps;
}

function dryRunInstructions(g: RuntimeGateConfig, inv: WranglerInventory, x: CrossPhaseConsistency, sm: SecretManifest): string[] {
  const lines: string[] = ["Runtime deploy is gated — DRY-RUN only. No provider was touched."];
  if (g.hardBlock) lines.push(`HARD BLOCK: ${g.hardBlock}`);
  if (g.missing.length > 0) lines.push(`Missing/closed: ${g.missing.join(", ")}`);
  if (!inv.wranglerPath) lines.push("No wrangler config found in the scaffold — build the scaffold (18A) first.");
  if (inv.hasCustomRouting) lines.push("REFUSED PRECONDITION: wrangler declares custom routes/domain — 18D deploys to *.workers.dev only.");
  if (inv.workerName && !inv.hasTargetEnvSection) lines.push(`wrangler has no [env.${g.targetEnv}] section — add it before deploying to ${g.targetEnv}.`);
  if (x.consistent === false) lines.push(`CROSS-PHASE BLOCK: ${x.note}`);
  else if (x.consistent === null) lines.push(`Cross-phase: ${x.note}`);
  if (sm.missing.length) lines.push(`Secret values absent on host (won't upload): ${sm.missing.join(", ")}.`);
  lines.push(
    "To deploy for real, on the Node host set (never commit these): " +
      "ALLOW_RUNTIME_PROVISION=true CONFIRM_RUNTIME_MUTATION=true HARTOS_TARGET_ENV=staging|test " +
      "CONFIRM_CLOUDFLARE_WORKER_NAME=<worker> CONFIRM_TELEGRAM_BOT_ID=<bot id> " +
      "HARTOS_RUNTIME_WORKER_URL=<deployed url> + provider creds (CLOUDFLARE_API_TOKEN, TELEGRAM_BOT_TOKEN, " +
      "TRIGGER_SECRET_KEY, worker secrets). Add ALLOW_RUNTIME_OVERWRITE=true only if a worker/webhook already exists."
  );
  return lines;
}

/**
 * Inspect → pre-flight → (gated) deploy a generated agent's runtime. With any gate closed, or a
 * refused precondition (custom routing, cross-phase mismatch), this is a pure DRY-RUN.
 */
export async function runRuntimeProvision(opts: RuntimeProvisionOptions): Promise<RuntimeProvisionResult> {
  const { cwd, ref, now } = opts;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const outRoot = opts.outRoot ?? DEFAULT_SCAFFOLD_DIR;
  const reportsDir = path.join(cwd, opts.reportsDir ?? DEFAULT_RUNTIME_PROVISION_REPORTS_DIR);
  const dataDir = opts.dataProvisionReportsDir ?? DEFAULT_DATA_PROVISION_REPORTS_DIR;

  const item = loadAuthorized(await resolveRef(cwd, ref));
  const specId = item.specId!;
  const agentName =
    (typeof item.proposedPayload?.["agentName"] === "string"
      ? (item.proposedPayload["agentName"] as string)
      : null) ?? specId;

  const scaffoldDir = path.join(cwd, outRoot, specId);
  const targetEnvRaw = env["HARTOS_TARGET_ENV"]?.trim().toLowerCase() || "staging";
  const inv = await buildWranglerInventory(scaffoldDir, targetEnvRaw);

  const ops = opts.ops ?? realRuntimeDeployOps({ env });

  // Pre-flight probes (read-only): bot identity (for typo guard) + current webhook (to capture/revert).
  const me = await ops.getMe();
  const botId = (me.data?.["botId"] as number | string | undefined) ?? null;
  const priorWebhook = await ops.getWebhookInfo();
  const priorWebhookUrl = (priorWebhook.data?.["webhookUrl"] as string | undefined) ?? "";

  const g = readRuntimeGates(env, {
    workerName: inv.workerName,
    botId: botId != null ? String(botId) : null,
    webhookStepPlanned: true,
  });
  const sm = buildSecretManifest(env);

  const dataLayerRef = await readDataLayerRef(cwd, dataDir);
  const crossPhase = assessConsistency(dataLayerRef, inv.supabaseUrl);

  await mkdir(reportsDir, { recursive: true });
  const ts = now.replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `runtime-provision-${specId}-${ts}.json`);
  const rollbackPlanPath = path.join(reportsDir, `rollback-plan-${specId}-${ts}.md`);

  // Rollback plan is ALWAYS generated (even in dry-run), before any deploy.
  await writeFile(rollbackPlanPath, buildRollbackPlan(agentName, inv.workerName, g.targetEnv).join("\n"), "utf8");

  // Refused preconditions beyond the gates (custom routing / cross-phase mismatch / missing config).
  const refusedPreconditions: string[] = [];
  if (!inv.wranglerPath || !inv.workerName) refusedPreconditions.push("scaffold has no usable wrangler config");
  if (inv.hasCustomRouting) refusedPreconditions.push("wrangler declares custom routes/domain (workers.dev only)");
  if (crossPhase.consistent === false) refusedPreconditions.push("cross-phase SUPABASE_URL mismatch");

  const canDeploy = g.allowProvision && refusedPreconditions.length === 0;

  const base = {
    specId,
    proposalId: item.id,
    agentName,
    workerName: inv.workerName,
    targetEnv: g.targetEnv,
    triggerEnv: TRIGGER_ENV,
    secretNames: sm.present,
    secretsMissing: sm.missing,
    crossPhase,
    executed: false as const,
  };

  // ── DRY-RUN path ──
  if (!canDeploy) {
    const instructions = dryRunInstructions(g, inv, crossPhase, sm);
    if (refusedPreconditions.length) instructions.unshift(`Refused preconditions: ${refusedPreconditions.join("; ")}.`);
    const steps: RuntimeStep[] = [
      { step: "preflight:getMe", status: me.success ? "ok" : "failed", message: me.message },
      { step: "preflight:getWebhookInfo", status: priorWebhook.success ? "ok" : "failed", message: priorWebhook.message },
      { step: "upload_secrets", status: "skipped", message: "dry-run" },
      { step: "deploy_worker", status: "skipped", message: "dry-run" },
      { step: "worker_health", status: "skipped", message: "dry-run" },
      { step: "deploy_tasks", status: "skipped", message: "dry-run" },
      { step: "set_webhook", status: "skipped", message: "dry-run" },
      { step: "smoke", status: "skipped", message: "dry-run" },
    ];
    const reportObj = { mode: "dry_run", ...base, gates: { missing: g.missing, hardBlock: g.hardBlock, allowOverwrite: g.allowOverwrite }, refusedPreconditions, steps, instructions };
    assertNoSecrets(reportObj, "dry-run report");
    await writeFile(reportPath, JSON.stringify(reportObj, null, 2) + "\n", "utf8");

    await appendLedger(reportsDir, agentName, {
      timestamp: now, mode: "dry_run", specId, proposalId: item.id, agentName,
      workerName: inv.workerName, targetEnv: g.targetEnv, triggerEnv: TRIGGER_ENV,
      secretNames: sm.present, secretsMissing: sm.missing, steps, gatesOpen: g.allowProvision,
      allowOverwrite: g.allowOverwrite, webhookReverted: false, crossPhase, advanced: false,
      reportPath, rollbackPlanPath,
    });
    await appendAudit(cwd, { id: item.id }, "runtime_provision_dryrun", now,
      g.hardBlock ?? `missing: ${g.missing.join(", ") || refusedPreconditions.join("; ") || "(preconditions)"}`);

    return { mode: "dry_run", ...base, steps, advanced: false, webhookReverted: false, reportPath, rollbackPlanPath, instructions };
  }

  // ── GATED DEPLOY path (reached only when every gate is open + preconditions clear) ──
  const workerUrl = env[WORKER_URL_KEY]?.trim() || null;
  if (!workerUrl) {
    throw new RuntimeProvisionPreconditionError(
      `${WORKER_URL_KEY} must be set to the deployed worker URL (needed for webhook + smoke).`
    );
  }
  const webhookPath = env[WEBHOOK_PATH_KEY]?.trim() || DEFAULT_WEBHOOK_PATH;
  const webhookUrl = `${workerUrl.replace(/\/$/, "")}${webhookPath.startsWith("/") ? "" : "/"}${webhookPath}`;
  const webhookSecret = env[WEBHOOK_SECRET_KEY]?.trim() || undefined;
  const wranglerEnv = g.targetEnv!;

  // Overwrite guard: refuse to silently overwrite an existing worker/webhook we didn't create.
  if (!g.allowOverwrite) {
    const exists = await ops.workerExists(wranglerEnv);
    const workerAlreadyExists = exists.data?.["exists"] === true;
    const webhookAlreadyElsewhere = Boolean(priorWebhookUrl) && priorWebhookUrl !== webhookUrl;
    if (workerAlreadyExists || webhookAlreadyElsewhere) {
      const why = [
        workerAlreadyExists ? "a Worker already exists for this env" : null,
        webhookAlreadyElsewhere ? "the bot's webhook already points elsewhere" : null,
      ].filter(Boolean).join(" and ");
      throw new RuntimeProvisionPreconditionError(
        `Refusing to overwrite: ${why}. Set ALLOW_RUNTIME_OVERWRITE=true after review to proceed.`
      );
    }
  }

  const steps: RuntimeStep[] = [];
  let webhookSet = false;
  let webhookReverted = false;

  const record = (step: string, r: RuntimeStepResult): boolean => {
    steps.push({ step, status: r.success ? "ok" : "failed", message: r.message });
    return r.success;
  };

  // Auto-revert ONLY the webhook (Hart's locked decision) — restore prior state or delete.
  const revertWebhook = async (): Promise<void> => {
    if (!webhookSet) return;
    const r = priorWebhookUrl
      ? await ops.setWebhook(priorWebhookUrl)
      : await ops.deleteWebhook();
    webhookReverted = r.success;
    steps.push({ step: "revert_webhook", status: r.success ? "reverted" : "failed", message: r.message });
  };

  const finishFailed = async (failMsg: string): Promise<RuntimeProvisionResult> => {
    const instructions = [
      `Runtime deploy FAILED: ${failMsg}`,
      webhookReverted ? "Telegram webhook was auto-reverted to its prior state." : "No webhook change to revert.",
      "Worker/Trigger/secrets rollback is MANUAL — see the rollback plan. Proposal NOT advanced.",
    ];
    const reportObj = { mode: "deploy_failed", ...base, steps, webhookReverted, instructions };
    assertNoSecrets(reportObj, "deploy-failed report");
    await writeFile(reportPath, JSON.stringify(reportObj, null, 2) + "\n", "utf8");
    await appendLedger(reportsDir, agentName, {
      timestamp: now, mode: "deploy_failed", specId, proposalId: item.id, agentName,
      workerName: inv.workerName, targetEnv: g.targetEnv, triggerEnv: TRIGGER_ENV,
      secretNames: sm.present, secretsMissing: sm.missing, steps, gatesOpen: true,
      allowOverwrite: g.allowOverwrite, webhookReverted, crossPhase, advanced: false,
      reportPath, rollbackPlanPath,
    });
    await appendAudit(cwd, { id: item.id }, "runtime_provision_failed", now, failMsg);
    return { mode: "deploy_failed", ...base, steps, advanced: false, webhookReverted, reportPath, rollbackPlanPath, instructions };
  };

  // 1. Secrets (worker must receive credentials before it serves traffic).
  if (!record("upload_secrets", await ops.uploadSecrets(wranglerEnv, sm.values))) {
    return finishFailed("secret upload failed");
  }
  // 2. Worker deploy.
  if (!record("deploy_worker", await ops.deployWorker(wranglerEnv))) {
    return finishFailed("worker deploy failed");
  }
  // 3. Worker health (read-only) BEFORE pointing the webhook at it.
  if (!record("worker_health", await ops.workerHealth(workerUrl))) {
    return finishFailed("worker health check failed (not pointing webhook at an unhealthy worker)");
  }
  // 4. Trigger.dev tasks (staging env only).
  if (!record("deploy_tasks", await ops.deployTasks(scaffoldDir, TRIGGER_ENV))) {
    return finishFailed("trigger.dev deploy failed");
  }
  // 5. Telegram webhook — LAST mutation, only after the worker is healthy.
  const wh = await ops.setWebhook(webhookUrl, webhookSecret);
  webhookSet = wh.success;
  if (!record("set_webhook", wh)) {
    return finishFailed("webhook registration failed");
  }
  // 6. Smoke (read-only). If it fails, auto-revert the webhook (don't leave a live-but-broken bot).
  const smoke = await ops.workerHealth(workerUrl);
  const whInfo = await ops.getWebhookInfo();
  const smokeOk = smoke.success && whInfo.success && (whInfo.data?.["webhookUrl"] === webhookUrl);
  steps.push({ step: "smoke", status: smokeOk ? "ok" : "failed", message: `health=${smoke.message}; webhook=${whInfo.message}` });
  if (!smokeOk) {
    await revertWebhook();
    return finishFailed("post-deploy smoke failed");
  }

  // ── Full success → advance the proposal (Hart's locked "advance on success" decision). ──
  await markRuntimeProvisioned(cwd, { id: item.id }, now,
    `worker=${inv.workerName} env=${g.targetEnv}; ${sm.present.length} secret(s); trigger=${TRIGGER_ENV}; webhook set`);

  const instructions = [
    `Deployed ${inv.workerName} to ${g.targetEnv}; uploaded ${sm.present.length} secret(s); registered Trigger tasks (${TRIGGER_ENV}); webhook set; smoke passed.`,
    "Proposal ADVANCED to runtime_provisioned (terminal). Production runtime remains separately gated/refused.",
    "Worker/Trigger/secrets rollback is manual — see the rollback plan.",
  ];
  const reportObj = { mode: "deployed", ...base, steps, webhookReverted: false, advanced: true, instructions };
  assertNoSecrets(reportObj, "deployed report");
  await writeFile(reportPath, JSON.stringify(reportObj, null, 2) + "\n", "utf8");
  await appendLedger(reportsDir, agentName, {
    timestamp: now, mode: "deployed", specId, proposalId: item.id, agentName,
    workerName: inv.workerName, targetEnv: g.targetEnv, triggerEnv: TRIGGER_ENV,
    secretNames: sm.present, secretsMissing: sm.missing, steps, gatesOpen: true,
    allowOverwrite: g.allowOverwrite, webhookReverted: false, crossPhase, advanced: true,
    reportPath, rollbackPlanPath,
  });
  await appendAudit(cwd, { id: item.id }, "runtime_provision_deployed", now,
    `${inv.workerName} → ${g.targetEnv}; advanced to runtime_provisioned`);

  return { mode: "deployed", ...base, steps, advanced: true, webhookReverted: false, reportPath, rollbackPlanPath, instructions };
}

// ─── Rollback (manual plan only — webhook auto-revert lives in the deploy path) ───

export interface RuntimeProvisionRollbackResult {
  mode: "instructions";
  specId: string;
  rollbackPlanPath: string | null;
  instructions: string[];
}

/**
 * Phase 18D rollback CLI is MANUAL ONLY (the webhook auto-revert happens inline during a failed
 * deploy). This re-surfaces the most recent rollback plan and prints manual instructions. It never
 * deletes a Worker or touches a webhook.
 */
export async function runRuntimeRollback(opts: RuntimeProvisionOptions): Promise<RuntimeProvisionRollbackResult> {
  const { cwd, ref, now } = opts;
  const reportsDir = path.join(cwd, opts.reportsDir ?? DEFAULT_RUNTIME_PROVISION_REPORTS_DIR);
  const item = loadAuthorized(await resolveRef(cwd, ref));
  const specId = item.specId!;

  let latestPlan: string | null = null;
  if (existsSync(reportsDir)) {
    const { readdir } = await import("node:fs/promises");
    const plans = (await readdir(reportsDir))
      .filter((f) => f.startsWith(`rollback-plan-${specId}-`) && f.endsWith(".md"))
      .sort();
    if (plans.length > 0) latestPlan = path.join(reportsDir, plans[plans.length - 1]!);
  }

  const instructions = [
    "Phase 18D rollback is MANUAL — no Worker is deleted and no webhook is touched by this command.",
    latestPlan ? `Review the generated rollback plan: ${latestPlan}` : "No rollback plan found — run agent:runtime-provision first.",
    "The webhook is auto-reverted only inline during a FAILED deploy; a successful deploy leaves it set on purpose.",
  ];
  await appendAudit(cwd, { id: item.id }, "runtime_provision_rollback_instructions", now, "manual rollback (no auto-delete in 18D)");
  return { mode: "instructions", specId, rollbackPlanPath: latestPlan, instructions };
}
