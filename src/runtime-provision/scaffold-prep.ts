/**
 * src/runtime-provision/scaffold-prep.ts
 *
 * Phase 18D-B PREP (no live mutation) — make a generated agent ready for a DISPOSABLE runtime
 * smoke. This helper:
 *   1. Generates a disposable, local-only `wrangler.toml` in the scaffold workdir (worker name =
 *      a disposable name; refuses production env and refuses generic/default worker names).
 *   2. Validates (or, with `build:true`, runs) the scaffold's npm install + build and checks the
 *      deploy entrypoint exists.
 *   3. Generates a LOCAL-ONLY credential template at `.hartos/local/runtime-smoke.env`, prefilling
 *      values that already exist in `.env.local`, preserving any values already in the template.
 *
 * Hard rules: calls NO provider op (Cloudflare/Telegram/Trigger), deploys nothing, uploads no
 * secret, registers no webhook, never advances the proposal, and NEVER returns/prints a secret
 * value (only present/missing/copied STATUS by env-var name). The credential file itself holds
 * real values but is gitignored and is never read back into any returned summary.
 */

import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { containsSecret } from "../llm/redaction.js";
import { resolveRef, appendAudit, type ProposalRef } from "../cockpit/proposals/proposal-queue.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { DEFAULT_SCAFFOLD_DIR } from "../execution/local-scaffold-build.js";

export const LOCAL_DIR = path.join(".hartos", "local");
export const CRED_TEMPLATE_REL = path.join(LOCAL_DIR, "runtime-smoke.env");
/** The migrated Supabase project from 18C (Hart Personal Core). Non-secret URL. */
const DEFAULT_SUPABASE_URL = "https://xbuinrnpfjltimofwrdx.supabase.co";
/** Generic/default scaffold names that are NOT disposable — refused for a live smoke. */
const GENERIC_WORKER_NAMES = ["tax-agent", "new-agent", "test-agent", "agent"];
const ALLOWED_ENVS = ["staging", "test"];

export class ScaffoldPrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldPrepError";
  }
}

// ─── Shell runner (injectable; defaults to spawnSync) ─────────────────────────

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type ShellRunner = (cmd: string, args: string[], cwd: string) => RunResult;

const realRunner: ShellRunner = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

// ─── Env-file parsing (values stay in-process; never returned) ────────────────

/** Parse KEY=VALUE lines, ignoring comments/blanks. Strips surrounding quotes. */
export function parseEnvFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    val = val.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    map.set(key, val);
  }
  return map;
}

// ─── Credential template spec ─────────────────────────────────────────────────

type EntryKind = "const" | "prefill" | "placeholder" | "blank";
interface TemplateEntry {
  key: string;
  kind: EntryKind;
  value?: string;
  comment?: string;
  /** Section header printed before this entry. */
  section?: string;
}

export type CredStatus =
  | "set by helper"
  | "already present"
  | "copied from .env.local"
  | "placeholder"
  | "blank (optional)"
  | "missing";

function templateSpec(workerName: string, targetEnv: string): TemplateEntry[] {
  return [
    { key: "ALLOW_RUNTIME_PROVISION", kind: "const", value: "true", section: "# Gates (one all-or-nothing gate opens the whole pipeline)" },
    { key: "CONFIRM_RUNTIME_MUTATION", kind: "const", value: "true" },
    { key: "HARTOS_TARGET_ENV", kind: "const", value: targetEnv },

    { key: "CLOUDFLARE_WORKER_NAME", kind: "const", value: workerName, section: "# Disposable Cloudflare Worker" },
    { key: "CONFIRM_CLOUDFLARE_WORKER_NAME", kind: "const", value: workerName },

    { key: "CLOUDFLARE_ACCOUNT_ID", kind: "prefill", section: "# Cloudflare" },
    { key: "CLOUDFLARE_API_TOKEN", kind: "prefill" },

    {
      key: "HARTOS_RUNTIME_WORKER_URL",
      kind: "placeholder",
      value: `https://${workerName}.<your-subdomain>.workers.dev`,
      section: "# Runtime URL after first deploy (replace <your-subdomain>)",
    },

    { key: "TELEGRAM_BOT_TOKEN", kind: "prefill", section: "# Telegram THROWAWAY bot only" },
    { key: "CONFIRM_TELEGRAM_BOT_ID", kind: "prefill" },
    { key: "TELEGRAM_WEBHOOK_SECRET", kind: "prefill" },

    { key: "TRIGGER_SECRET_KEY", kind: "prefill", section: "# Trigger.dev staging/test only" },

    { key: "SUPABASE_URL", kind: "const", value: DEFAULT_SUPABASE_URL, section: "# Optional runtime secrets if generated agent /health needs them" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", kind: "prefill" },
    { key: "OPENAI_API_KEY", kind: "prefill" },

    { key: "ALLOW_RUNTIME_OVERWRITE", kind: "blank", section: "# Only set =true after review if the worker exists or existence is unverified" },
  ];
}

export interface CredResolution {
  key: string;
  status: CredStatus;
  value: string; // in-process only; NEVER surfaced in the returned summary
}

function resolveCreds(
  spec: TemplateEntry[],
  envLocal: Map<string, string>,
  existing: Map<string, string>
): CredResolution[] {
  return spec.map((e) => {
    const existed = existing.get(e.key);
    if (existed && existed.trim()) return { key: e.key, status: "already present", value: existed };
    if (e.kind === "const") return { key: e.key, status: "set by helper", value: e.value ?? "" };
    if (e.kind === "placeholder") return { key: e.key, status: "placeholder", value: e.value ?? "" };
    if (e.kind === "prefill") {
      const fromLocal = envLocal.get(e.key);
      if (fromLocal && fromLocal.trim()) return { key: e.key, status: "copied from .env.local", value: fromLocal };
      return { key: e.key, status: "missing", value: "" };
    }
    return { key: e.key, status: "blank (optional)", value: "" }; // blank
  });
}

function renderCredFile(spec: TemplateEntry[], resolved: Map<string, string>): string {
  const lines: string[] = [
    "# HartOS 18D-B Disposable Runtime Smoke — LOCAL ONLY",
    "# Generated by `npm run runtime:prepare-scaffold`. Do NOT commit. Do NOT paste into chat.",
    "# Raw values must stay on this host only.",
    "",
  ];
  for (const e of spec) {
    if (e.section) {
      lines.push("");
      lines.push(e.section);
    }
    lines.push(`${e.key}=${resolved.get(e.key) ?? ""}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ─── Wrangler generation ──────────────────────────────────────────────────────

/** Rewrite the top-level worker name; synthesize a minimal config if no example exists. */
export function buildWranglerToml(exampleContent: string | null, workerName: string, targetEnv: string): string {
  if (exampleContent && /^name\s*=/m.test(exampleContent)) {
    // Replace only the top-level name (first `name =` line).
    return exampleContent.replace(/^name\s*=\s*".*"\s*$/m, `name = "${workerName}"`);
  }
  return [
    `name = "${workerName}"`,
    `main = "dist/src/index.js"`,
    `compatibility_date = "2026-06-03"`,
    "",
    "[vars]",
    `APP_ENV = "local"`,
    "",
    `[env.${targetEnv}.vars]`,
    `APP_ENV = "${targetEnv}"`,
    `SUPABASE_URL = ""`,
    "",
  ].join("\n");
}

// ─── Result shape (NO secret values) ──────────────────────────────────────────

export interface ScaffoldPrepResult {
  specId: string;
  proposalId: string;
  workerName: string;
  targetEnv: string;
  scaffoldDir: string;
  wranglerPath: string;
  credTemplatePath: string;
  credTemplateExisted: boolean;
  credentials: Array<{ key: string; status: CredStatus }>;
  build: {
    nodeModules: "already present" | "ran" | "skipped";
    npmBuild: "passed" | "failed" | "skipped";
    distEntrypoint: "present" | "missing";
    distPath: string;
  };
  proposalStatus: string;
  auditAppended: boolean;
  providerOpsCalled: 0;
  instructions: string[];
}

export interface PrepareScaffoldOptions {
  cwd: string;
  ref: ProposalRef;
  workerName: string;
  targetEnv: string;
  now: string;
  force?: boolean;
  /** When true, actually run `npm install` (if needed) + `npm run build`; else validate only. */
  build?: boolean;
  env?: Record<string, string | undefined>;
  outRoot?: string;
  runner?: ShellRunner;
  /** Skip the audit append (tests). */
  noAudit?: boolean;
}

function loadAuthorized(item: ProposalQueueItem | null): ProposalQueueItem {
  if (!item) throw new ScaffoldPrepError("Proposal not found.");
  if (item.actionType !== "agent_creation_plan") {
    throw new ScaffoldPrepError(`prep only supports agent_creation_plan, got "${item.actionType}".`);
  }
  if (item.status !== "approved_for_execution") {
    throw new ScaffoldPrepError(`Proposal must be approved_for_execution (was "${item.status}"). Authorize it first (Key 1).`);
  }
  return item;
}

/**
 * Prepare a generated scaffold for a disposable live smoke. Mutates only LOCAL files (a gitignored
 * wrangler.toml in the scaffold + the local credential template). Touches no provider.
 */
export async function prepareScaffold(opts: PrepareScaffoldOptions): Promise<ScaffoldPrepResult> {
  const { cwd, ref, now } = opts;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const runner = opts.runner ?? realRunner;
  const outRoot = opts.outRoot ?? DEFAULT_SCAFFOLD_DIR;
  const workerName = (opts.workerName ?? "").trim();
  const targetEnv = (opts.targetEnv ?? "").trim().toLowerCase();

  // ── Arg validation (fail closed) ──
  if (!workerName) throw new ScaffoldPrepError("Missing --worker-name.");
  if (targetEnv === "production" || targetEnv === "prod") {
    throw new ScaffoldPrepError("Refusing --env production. Disposable smoke is staging/test only.");
  }
  if (!ALLOWED_ENVS.includes(targetEnv)) {
    throw new ScaffoldPrepError(`--env must be one of: ${ALLOWED_ENVS.join(", ")} (got "${targetEnv || "<empty>"}").`);
  }
  if (GENERIC_WORKER_NAMES.includes(workerName.toLowerCase())) {
    throw new ScaffoldPrepError(
      `Refusing generic/default worker name "${workerName}" for a live smoke. Use a disposable name like "hartos-tax-agent-smoke".`
    );
  }

  const item = loadAuthorized(await resolveRef(cwd, ref));
  const specId = item.specId!;
  const scaffoldDir = path.join(cwd, outRoot, specId);
  if (!existsSync(scaffoldDir)) {
    throw new ScaffoldPrepError(`Scaffold not found at ${scaffoldDir}. Build it (18A) first.`);
  }

  // ── 1. Disposable wrangler.toml (local-only) ──
  const wranglerPath = path.join(scaffoldDir, "wrangler.toml");
  const examplePath = path.join(scaffoldDir, "wrangler.toml.example");
  const example = existsSync(examplePath) ? await readFile(examplePath, "utf8") : null;
  const wranglerToml = buildWranglerToml(example, workerName, targetEnv);
  if (containsSecret(wranglerToml)) {
    throw new ScaffoldPrepError("Refusing to write wrangler.toml: secret-looking content detected.");
  }
  if (existsSync(wranglerPath) && !opts.force) {
    // Non-destructive by default: only overwrite the name line if needed, else leave as-is.
    const current = await readFile(wranglerPath, "utf8");
    const updated = buildWranglerToml(current, workerName, targetEnv);
    if (updated !== current) await writeFile(wranglerPath, updated, "utf8");
  } else {
    await writeFile(wranglerPath, wranglerToml, "utf8");
  }

  // ── 2. Build prep (validate by default; run only when build:true) ──
  const distPath = path.join(scaffoldDir, "dist", "src", "index.js");
  const hasNodeModules = existsSync(path.join(scaffoldDir, "node_modules"));
  let nodeModules: ScaffoldPrepResult["build"]["nodeModules"] = hasNodeModules ? "already present" : "skipped";
  let npmBuild: ScaffoldPrepResult["build"]["npmBuild"] = "skipped";

  if (opts.build) {
    if (!hasNodeModules) {
      const inst = runner("npm", ["install"], scaffoldDir);
      nodeModules = inst.status === 0 ? "ran" : "skipped";
      if (inst.status !== 0) {
        throw new ScaffoldPrepError(`npm install failed in ${scaffoldDir}. Run it manually, then re-run prep.`);
      }
    }
    const built = runner("npm", ["run", "build"], scaffoldDir);
    npmBuild = built.status === 0 ? "passed" : "failed";
    if (built.status !== 0) {
      throw new ScaffoldPrepError(`npm run build failed in ${scaffoldDir}. Fix the build, then re-run prep.`);
    }
    if (!existsSync(distPath)) {
      throw new ScaffoldPrepError(
        `Build reported success but the deploy entrypoint is missing: ${distPath}. ` +
          `Check the scaffold's wrangler "main" / tsconfig outDir, then re-run prep.`
      );
    }
  }
  const distEntrypoint: "present" | "missing" = existsSync(distPath) ? "present" : "missing";

  // ── 3. Local credential template ──
  const localDir = path.join(cwd, LOCAL_DIR);
  await mkdir(localDir, { recursive: true });
  const credTemplatePath = path.join(cwd, CRED_TEMPLATE_REL);
  const credTemplateExisted = existsSync(credTemplatePath);

  const envLocalPath = path.join(cwd, ".env.local");
  const envLocal = existsSync(envLocalPath) ? parseEnvFile(await readFile(envLocalPath, "utf8")) : new Map<string, string>();
  const existing = credTemplateExisted ? parseEnvFile(await readFile(credTemplatePath, "utf8")) : new Map<string, string>();

  const spec = templateSpec(workerName, targetEnv);
  const resolved = resolveCreds(spec, envLocal, existing);
  const valueMap = new Map(resolved.map((r) => [r.key, r.value]));
  const fileContent = renderCredFile(spec, valueMap);
  await writeFile(credTemplatePath, fileContent, "utf8");

  // ── Optional audit (no status change, no secrets) ──
  let auditAppended = false;
  if (!opts.noAudit) {
    await appendAudit(cwd, { id: item.id }, "runtime_scaffold_prep", now,
      `worker=${workerName} env=${targetEnv}; wrangler+cred-template written; no provider mutation`);
    auditAppended = true;
  }
  const fresh = await resolveRef(cwd, { id: item.id });

  const credentials = resolved.map((r) => ({ key: r.key, status: r.status }));
  const instructions: string[] = [
    `Fill the MISSING values in ${CRED_TEMPLATE_REL} (local only — never commit, never paste into chat).`,
    distEntrypoint === "missing"
      ? `Build the scaffold before smoke: cd "${scaffoldDir}" && npm install && npm run build (or re-run prep with --build).`
      : "Scaffold build entrypoint present.",
    "Replace <your-subdomain> in HARTOS_RUNTIME_WORKER_URL after the first deploy.",
    "When all required values are set, say \"go\" — live smoke is still gated and NOT run by this helper.",
  ];

  // Final guard: the returned summary must carry NO secret values.
  const summarySafe = { workerName, targetEnv, credentials, build: { nodeModules, npmBuild, distEntrypoint } };
  if (containsSecret(JSON.stringify(summarySafe))) {
    throw new ScaffoldPrepError("Internal: prep summary unexpectedly contained a secret — aborting before output.");
  }

  return {
    specId,
    proposalId: item.id,
    workerName,
    targetEnv,
    scaffoldDir,
    wranglerPath,
    credTemplatePath,
    credTemplateExisted,
    credentials,
    build: { nodeModules, npmBuild, distEntrypoint, distPath },
    proposalStatus: fresh?.status ?? item.status,
    auditAppended,
    providerOpsCalled: 0,
    instructions,
  };
}
