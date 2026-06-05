/**
 * src/execution/agent-data-provision.ts
 *
 * Phase 18C — first data-layer provisioning: apply a generated agent's Supabase migrations
 * to an EXPLICITLY selected existing test/staging project. The first phase that can mutate
 * an external database. Everything is gated; with any gate closed it produces a DRY-RUN
 * report (plan + destructive scan + rollback plan) and touches no database.
 *
 * Scope (enforced): migration apply only. NO project creation, NO Cloudflare/Telegram/
 * Trigger/OpenAI, NO GitHub merge, NO generated-agent runtime. Production is hard-refused.
 * Node CLI only — never reachable from the hosted Worker. executeProposal() still throws;
 * the proposal is NOT advanced (audit-only).
 *
 * Input source (Hart's locked decision): the LOCAL 18A/18B scaffold workdir, selected by
 * specId — `agent-scaffold/<specId>/supabase/migrations`. No network fetch, no PR-branch
 * checkout. The `.prep`/`.pr` sibling dirs are ignored.
 */

import path from "node:path";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { containsSecret } from "../llm/redaction.js";
import { resolveRef, appendAudit, type ProposalRef } from "../cockpit/proposals/proposal-queue.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { DEFAULT_SCAFFOLD_DIR } from "./local-scaffold-build.js";
import {
  parseMigrationFilename,
  validateMigrationFiles,
} from "../supabase/migration-runner.js";
import { scanSql, hashSql, type SqlScanResult } from "../supabase/destructive-sql-scan.js";
import {
  readDataLayerGates,
  type DataLayerGateConfig,
} from "../supabase/data-layer-gates.js";
import {
  realSupabaseMigrationApplyOps,
  type SupabaseMigrationApplyOps,
} from "../supabase/migration-apply-ops.js";

export const DEFAULT_DATA_PROVISION_REPORTS_DIR = "data-provision-reports";

/** Tables a generated agent is expected to create — used for read-only post-apply smoke. */
const SMOKE_TABLES = ["agent_runs", "command_events", "debug_events", "action_tokens"];

export class DataProvisionPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataProvisionPreconditionError";
  }
}

// ─── Authorization (Key 1) ────────────────────────────────────────────────────

function loadAuthorized(item: ProposalQueueItem | null): ProposalQueueItem {
  if (!item) throw new DataProvisionPreconditionError("Proposal not found.");
  if (item.actionType !== "agent_creation_plan") {
    throw new DataProvisionPreconditionError(
      `18C only supports agent_creation_plan, got "${item.actionType}".`
    );
  }
  if (item.status !== "approved_for_execution") {
    throw new DataProvisionPreconditionError(
      `Proposal must be approved_for_execution (was "${item.status}"). Authorize it first (Key 1).`
    );
  }
  return item;
}

// ─── Migration inventory + scan ───────────────────────────────────────────────

export interface ScannedMigration {
  filename: string;
  prefix: string;
  sha256: string;
  scan: SqlScanResult;
}

export interface MigrationInventory {
  migrationsDir: string;
  migrations: ScannedMigration[];
  /** Filename validation errors (bad name / duplicate prefix). */
  validationErrors: string[];
  /** Highest risk across all files. */
  overallRisk: SqlScanResult["risk"];
  /** Files that carry destructive/irreversible findings. */
  flagged: ScannedMigration[];
}

async function buildInventory(migrationsDir: string): Promise<MigrationInventory> {
  if (!existsSync(migrationsDir)) {
    throw new DataProvisionPreconditionError(
      `No migrations directory at ${migrationsDir}. Build the scaffold (18A) first.`
    );
  }

  const all = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const validationErrors = validateMigrationFiles(all);

  const migrations: ScannedMigration[] = [];
  for (const filename of all) {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) continue; // invalid names are captured in validationErrors
    const raw = await readFile(path.join(migrationsDir, filename), "utf8");
    migrations.push({
      filename,
      prefix: parsed.prefix,
      sha256: hashSql(raw),
      scan: scanSql(raw),
    });
  }

  const flagged = migrations.filter((m) => !m.scan.clean);
  let overallRisk: SqlScanResult["risk"] = "safe";
  for (const m of migrations) {
    if (m.scan.risk === "irreversible") overallRisk = "irreversible";
    else if (m.scan.risk === "destructive" && overallRisk !== "irreversible") overallRisk = "destructive";
  }

  return { migrationsDir, migrations, validationErrors, overallRisk, flagged };
}

// ─── Rollback plan (manual, never auto-executed) ──────────────────────────────

function buildRollbackPlan(inv: MigrationInventory, projectRef: string | null): string[] {
  const lines: string[] = [
    "# Manual rollback plan (Phase 18C — no automated DB rollback)",
    "",
    `Target project: ${projectRef ?? "<unset>"}`,
    "Database rollback is not always clean. The steps below are a BEST-EFFORT plan to be",
    "reviewed and run by hand. Nothing here is executed automatically.",
    "",
    "## Inverse of the created objects (review before running)",
  ];
  for (const m of inv.migrations) {
    lines.push(`- ${m.filename}:`);
    if (m.scan.findings.length > 0) {
      lines.push(
        `    ⚠ contains ${m.scan.risk} operations — inverse may be IRREVERSIBLE / data-losing:`
      );
      for (const f of m.scan.findings) {
        lines.push(`      • [${f.rule}] line ${f.line}: ${f.description}`);
      }
    } else {
      lines.push(
        "    objects are additive (create table/index/function). To revert, write a new migration"
      );
      lines.push("    that DROPs exactly what this file created — manually, after review.");
    }
  }
  lines.push("");
  lines.push("## Recommended");
  lines.push("- Prefer rolling forward (a new corrective migration) over destructive rollback.");
  lines.push("- Take a database snapshot/backup BEFORE applying if any file is flagged.");
  lines.push("");
  return lines;
}

// ─── Ledger (per-agent, includes per-file SHA-256; never holds secrets) ───────

export interface DataProvisionLedgerEntry {
  timestamp: string;
  mode: "dry_run" | "applied";
  specId: string;
  proposalId: string;
  agentName: string;
  projectRef: string | null;
  targetEnv: string | null;
  migrations: Array<{ filename: string; sha256: string; risk: string }>;
  overallRisk: string;
  scanClean: boolean;
  gatesOpen: boolean;
  orderTolerance: boolean;
  appliedBy: string | null;
  smoke: Array<{ table: string; exists: boolean; status: string }> | null;
  rollbackPlanPath: string;
  reportPath: string;
}

interface DataProvisionLedger {
  agentName: string;
  entries: DataProvisionLedgerEntry[];
  lastUpdated: string;
}

function assertNoSecrets(obj: unknown, where: string): void {
  if (containsSecret(JSON.stringify(obj))) {
    throw new DataProvisionPreconditionError(
      `Refusing to write ${where}: a secret-looking value was detected. Ledger/report must never hold secrets.`
    );
  }
}

async function appendLedger(
  reportsDir: string,
  agentName: string,
  entry: DataProvisionLedgerEntry
): Promise<void> {
  const file = path.join(reportsDir, "data-provision-ledger.json");
  let existing: DataProvisionLedger | null = null;
  if (existsSync(file)) existing = JSON.parse(await readFile(file, "utf8")) as DataProvisionLedger;
  const ledger: DataProvisionLedger = {
    agentName,
    entries: [...(existing?.entries ?? []), entry],
    lastUpdated: entry.timestamp,
  };
  assertNoSecrets(ledger, "data-provision ledger");
  await writeFile(file, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface DataProvisionResult {
  mode: "dry_run" | "applied";
  specId: string;
  proposalId: string;
  agentName: string;
  projectRef: string | null;
  targetEnv: string | null;
  migrationCount: number;
  overallRisk: SqlScanResult["risk"];
  scanClean: boolean;
  /** Always false in 18C — kept explicit so callers can assert it. */
  providerMutations: number;
  executed: false;
  applied: boolean;
  smoke: Array<{ table: string; exists: boolean; status: string }> | null;
  reportPath: string;
  rollbackPlanPath: string;
  instructions: string[];
}

export interface DataProvisionOptions {
  cwd: string;
  ref: ProposalRef;
  now: string;
  env?: Record<string, string | undefined>;
  outRoot?: string;
  reportsDir?: string;
  /** Injected in tests; defaults to the real CLI/PostgREST impl (reached only when gated + clean). */
  applyOps?: SupabaseMigrationApplyOps;
}

function dryRunInstructions(g: DataLayerGateConfig, inv: MigrationInventory): string[] {
  const lines: string[] = ["Data-layer apply is gated — DRY-RUN only. No database was touched."];
  if (g.hardBlock) lines.push(`HARD BLOCK: ${g.hardBlock}`);
  if (g.missing.length > 0) lines.push(`Missing/closed: ${g.missing.join(", ")}`);
  if (inv.validationErrors.length > 0) {
    lines.push(`Migration validation errors: ${inv.validationErrors.slice(0, 3).join("; ")}`);
  }
  lines.push(
    g.allowOutOfOrder
      ? "Ordering tolerance: ON (db push will use --include-all — applies migrations that sort before the target's existing history)."
      : "Ordering tolerance: OFF (strict order; if the generated versions sort before the target's existing migrations, db push refuses — set ALLOW_OUT_OF_ORDER_MIGRATION_APPLY=true to allow)."
  );
  if (!inv.flagged.length) {
    lines.push("Destructive-SQL scan: clean.");
  } else {
    lines.push(
      `Destructive-SQL scan flagged ${inv.flagged.length} file(s) [${inv.overallRisk}]: ` +
        inv.flagged.map((f) => f.filename).join(", ") +
        ". Set ALLOW_DESTRUCTIVE_SQL=true to override after review."
    );
  }
  lines.push(
    "To apply for real, on the Node host set (never commit these): " +
      "ALLOW_SUPABASE_MIGRATION_APPLY=true CONFIRM_DATA_LAYER_MUTATION=true " +
      "HARTOS_SUPABASE_PROJECT_REF=<ref> CONFIRM_SUPABASE_TARGET_PROJECT=<ref> " +
      "HARTOS_TARGET_ENV=staging|test HARTOS_SUPABASE_URL=<url> HARTOS_SUPABASE_ACCESS_TOKEN=<token>."
  );
  return lines;
}

/**
 * Inspect → validate → scan → (gated) apply a generated agent's migrations.
 * With any gate closed, or a destructive scan without override, this is a pure DRY-RUN.
 */
export async function runDataLayerProvision(
  opts: DataProvisionOptions
): Promise<DataProvisionResult> {
  const { cwd, ref, now } = opts;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const applyOps = opts.applyOps ?? realSupabaseMigrationApplyOps();
  const outRoot = opts.outRoot ?? DEFAULT_SCAFFOLD_DIR;
  const reportsDir = path.join(cwd, opts.reportsDir ?? DEFAULT_DATA_PROVISION_REPORTS_DIR);

  const item = loadAuthorized(await resolveRef(cwd, ref));
  const specId = item.specId!;
  const agentName =
    (typeof item.proposedPayload?.["agentName"] === "string"
      ? (item.proposedPayload["agentName"] as string)
      : null) ?? specId;

  // Input source: the local scaffold workdir, by specId. Ignore .prep/.pr siblings.
  const migrationsDir = path.join(cwd, outRoot, specId, "supabase", "migrations");
  const inv = await buildInventory(migrationsDir);
  const g = readDataLayerGates(env);

  await mkdir(reportsDir, { recursive: true });
  const ts = now.replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `data-provision-${specId}-${ts}.json`);
  const rollbackPlanPath = path.join(reportsDir, `rollback-plan-${specId}-${ts}.md`);

  // Rollback plan is ALWAYS generated (even in dry-run), before any apply.
  await writeFile(rollbackPlanPath, buildRollbackPlan(inv, g.projectRef).join("\n"), "utf8");

  const ledgerMigrations = inv.migrations.map((m) => ({
    filename: m.filename,
    sha256: m.sha256,
    risk: m.scan.risk,
  }));

  // Decide: can we apply? Need gates open, no validation errors, and either a clean scan
  // or an explicit destructive override.
  const scanBlocksApply = inv.flagged.length > 0 && !g.allowDestructive;
  const canApply =
    g.allowApply && inv.validationErrors.length === 0 && !scanBlocksApply && inv.migrations.length > 0;

  const base = {
    specId,
    proposalId: item.id,
    agentName,
    projectRef: g.projectRef,
    targetEnv: g.targetEnv,
    migrationCount: inv.migrations.length,
    overallRisk: inv.overallRisk,
    scanClean: inv.flagged.length === 0,
    providerMutations: 0,
    executed: false as const,
  };

  // ── DRY-RUN path ──
  if (!canApply) {
    const instructions = dryRunInstructions(g, inv);
    const reportObj = { mode: "dry_run", ...base, gates: { missing: g.missing, hardBlock: g.hardBlock, orderTolerance: g.allowOutOfOrder }, migrations: ledgerMigrations, instructions };
    assertNoSecrets(reportObj, "dry-run report");
    await writeFile(reportPath, JSON.stringify(reportObj, null, 2) + "\n", "utf8");

    await appendLedger(reportsDir, agentName, {
      timestamp: now, mode: "dry_run", specId, proposalId: item.id, agentName,
      projectRef: g.projectRef, targetEnv: g.targetEnv, migrations: ledgerMigrations,
      overallRisk: inv.overallRisk, scanClean: inv.flagged.length === 0, gatesOpen: g.allowApply,
      orderTolerance: g.allowOutOfOrder, appliedBy: null, smoke: null, rollbackPlanPath, reportPath,
    });
    await appendAudit(cwd, { id: item.id }, "data_provision_dryrun", now,
      g.hardBlock ?? `missing: ${g.missing.join(", ") || "(scan/validation)"}`);

    return { mode: "dry_run", ...base, applied: false, smoke: null, reportPath, rollbackPlanPath, instructions };
  }

  // ── GATED APPLY path (reached only when every gate is open + scan acceptable) ──
  const accessToken = env["HARTOS_SUPABASE_ACCESS_TOKEN"]?.trim() || null;
  const dbPassword = env["HARTOS_SUPABASE_DB_PASSWORD"]?.trim() || null;
  const projectDir = path.join(cwd, outRoot, specId);

  const applyResult = await applyOps.applyViaCli({
    projectDir,
    projectRef: g.projectRef!,
    accessToken,
    dbPassword,
    // Ordering tolerance — only when explicitly opted in. Lets db push apply migrations
    // whose versions sort before the target project's existing history (--include-all).
    includeAll: g.allowOutOfOrder,
  });

  if (!applyResult.success) {
    // Apply attempted but failed — record and surface; do NOT advance the proposal.
    const instructions = [
      `Apply FAILED: ${applyResult.message}`,
      "No proposal status was advanced. Review the report and rollback plan.",
    ];
    const reportObj = { mode: "apply_failed", ...base, apply: { message: applyResult.message, detail: applyResult.detail ?? null }, migrations: ledgerMigrations, instructions };
    assertNoSecrets(reportObj, "apply-failed report");
    await writeFile(reportPath, JSON.stringify(reportObj, null, 2) + "\n", "utf8");
    await appendAudit(cwd, { id: item.id }, "data_provision_apply_failed", now, applyResult.message);
    throw new DataProvisionPreconditionError(`Migration apply failed: ${applyResult.message}`);
  }

  // Read-only post-apply smoke (best-effort; never mutates).
  let smoke: Array<{ table: string; exists: boolean; status: string }> | null = null;
  const smokeKey = env["HARTOS_SUPABASE_SERVICE_ROLE"]?.trim() || env["HARTOS_SUPABASE_ANON_KEY"]?.trim() || null;
  if (g.url && smokeKey) {
    smoke = await applyOps.smokeTables({ url: g.url, apiKey: smokeKey, tables: SMOKE_TABLES });
  }

  const instructions = [
    `Applied ${inv.migrations.length} migration(s) to project ${g.projectRef} (${g.targetEnv}).`,
    "Proposal NOT advanced (18C is audit-only). Rollback plan generated (manual).",
  ];
  const reportObj = { mode: "applied", ...base, orderTolerance: g.allowOutOfOrder, apply: { message: applyResult.message, detail: applyResult.detail ?? null }, migrations: ledgerMigrations, smoke, instructions };
  assertNoSecrets(reportObj, "applied report");
  await writeFile(reportPath, JSON.stringify(reportObj, null, 2) + "\n", "utf8");

  await appendLedger(reportsDir, agentName, {
    timestamp: now, mode: "applied", specId, proposalId: item.id, agentName,
    projectRef: g.projectRef, targetEnv: g.targetEnv, migrations: ledgerMigrations,
    overallRisk: inv.overallRisk, scanClean: inv.flagged.length === 0, gatesOpen: true,
    orderTolerance: g.allowOutOfOrder, appliedBy: env["USER"] || env["USERNAME"] || "node-host", smoke, rollbackPlanPath, reportPath,
  });
  await appendAudit(cwd, { id: item.id }, "data_provision_applied", now,
    `${inv.migrations.length} migration(s) → ${g.projectRef} (${g.targetEnv}); not advanced`);

  return { mode: "applied", ...base, applied: true, smoke, reportPath, rollbackPlanPath, instructions };
}

// ─── Rollback (manual plan only — never auto-executes) ────────────────────────

export interface DataProvisionRollbackResult {
  mode: "instructions";
  specId: string;
  rollbackPlanPath: string | null;
  instructions: string[];
}

/**
 * Phase 18C rollback is MANUAL ONLY. This re-surfaces the most recent rollback plan and
 * prints manual instructions. It never connects to a database and never drops data.
 */
export async function runDataLayerRollback(
  opts: DataProvisionOptions
): Promise<DataProvisionRollbackResult> {
  const { cwd, ref, now } = opts;
  const reportsDir = path.join(cwd, opts.reportsDir ?? DEFAULT_DATA_PROVISION_REPORTS_DIR);

  const item = loadAuthorized(await resolveRef(cwd, ref));
  const specId = item.specId!;

  let latestPlan: string | null = null;
  if (existsSync(reportsDir)) {
    const plans = (await readdir(reportsDir))
      .filter((f) => f.startsWith(`rollback-plan-${specId}-`) && f.endsWith(".md"))
      .sort();
    if (plans.length > 0) latestPlan = path.join(reportsDir, plans[plans.length - 1]!);
  }

  const instructions = [
    "Phase 18C rollback is MANUAL ONLY — no automated DB rollback, no data is dropped.",
    latestPlan
      ? `Review the generated rollback plan: ${latestPlan}`
      : "No rollback plan found — run agent:data-provision first to generate one.",
    "Prefer a corrective forward migration over destructive rollback.",
    "Restore from a database snapshot/backup if a flagged migration must be undone.",
  ];

  await appendAudit(cwd, { id: item.id }, "data_provision_rollback_instructions", now, "manual rollback (no auto-execute in 18C)");
  return { mode: "instructions", specId, rollbackPlanPath: latestPlan, instructions };
}
