/**
 * src/provisioning/cloudflare-local.ts
 *
 * Safe Cloudflare command boundary for the provisioning engine.
 *
 * All CLI commands use spawnSync (not shell) to avoid injection.
 * No API tokens, account IDs, or secrets are logged.
 * Exported as an injectable interface so tests can mock Cloudflare operations.
 */

import { spawnSync } from "node:child_process";

export interface CloudflareCommandResult {
  success: boolean;
  message: string;
  exitCode: number;
  /** Safe metadata only (e.g. uploaded secret COUNT, worker existence) — never secret values. */
  data?: Record<string, unknown>;
}

/** Injectable interface for Cloudflare operations (enables test mocking). */
export interface CloudflareOps {
  /** Deploy the Cloudflare Worker using wrangler. Never prints secrets. */
  deployWorker(wranglerEnv: string): Promise<CloudflareCommandResult>;
  /**
   * Phase 18D — probe whether a Worker already exists for this env, so the orchestrator can refuse
   * to silently OVERWRITE one it didn't create (wrangler deploy is an upsert). `data.exists` is the
   * verdict; `data.checked=false` means existence could not be determined (treat conservatively).
   */
  workerExists(wranglerEnv: string): Promise<CloudflareCommandResult>;
  /**
   * Phase 18D — upload Worker secrets via `wrangler secret bulk`. Values are passed on the child's
   * STDIN as a JSON object — never as a CLI arg, never written to disk, never logged. The returned
   * message/data carry only the COUNT and the secret NAMES, never any value.
   */
  uploadSecrets(
    wranglerEnv: string,
    secrets: Record<string, string>
  ): Promise<CloudflareCommandResult>;
}

// ─── Output sanitisation ──────────────────────────────────────────────────────

/** Strip potential secrets and truncate for safe logging. */
function sanitize(output: string): string {
  return output
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/Authorization:\s*\S+/gi, "Authorization: [REDACTED]")
    .slice(0, 300);
}

// ─── Real implementation ──────────────────────────────────────────────────────

async function deployWorker(wranglerEnv: string): Promise<CloudflareCommandResult> {
  // Try `wrangler` (local install) then `npx wrangler` as fallback.
  for (const [cmd, args] of [
    ["wrangler", ["deploy", "--env", wranglerEnv]],
    ["npx", ["wrangler", "deploy", "--env", wranglerEnv]],
  ] as [string, string[]][]) {
    const result = spawnSync(cmd, args, {
      encoding: "utf8",
      stdio: "pipe",
      shell: process.platform === "win32",
    });

    if (result.status === 0) {
      return {
        success: true,
        message: `Worker deployed to ${wranglerEnv} (exit 0)`,
        exitCode: 0,
      };
    }

    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
      // Binary not found — try fallback
      continue;
    }

    const stderr = sanitize(result.stderr ?? "");
    const stdout = sanitize(result.stdout ?? "");
    return {
      success: false,
      message: `Deploy failed (exit ${result.status ?? 1}). ${stderr || stdout}`,
      exitCode: result.status ?? 1,
    };
  }

  return {
    success: false,
    message:
      "wrangler not found. Install with: npm install -g wrangler@latest or add to devDependencies.",
    exitCode: 127,
  };
}

/** Output that unambiguously means "this Worker does not exist" (vs. an auth/network/rate error). */
const WORKER_ABSENT_RE = /not found|no deployment|no worker|could ?n[o']?t find|does not exist|workers\.dev.*not/i;

/**
 * Phase 18D (Fix #3 — fail closed) — probe Worker existence via `wrangler deployments list`.
 * Distinguishes THREE outcomes, never conflating an error with "absent":
 *   - exit 0                              → CONFIRMED EXISTS   (exists:true,  checked:true)
 *   - non-zero with clear not-found text  → CONFIRMED ABSENT   (exists:false, checked:true)
 *   - any other non-zero / wrangler missing → UNKNOWN          (exists:false, checked:false)
 * Only CONFIRMED ABSENT may proceed without an overwrite gate; UNKNOWN fails closed upstream.
 */
async function workerExists(wranglerEnv: string): Promise<CloudflareCommandResult> {
  for (const [cmd, args] of [
    ["wrangler", ["deployments", "list", "--env", wranglerEnv]],
    ["npx", ["wrangler", "deployments", "list", "--env", wranglerEnv]],
  ] as [string, string[]][]) {
    const result = spawnSync(cmd, args, {
      encoding: "utf8",
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    if (result.status === 0) {
      return { success: true, message: "Existing Worker confirmed for env", exitCode: 0, data: { exists: true, checked: true } };
    }
    const out = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    if (WORKER_ABSENT_RE.test(out)) {
      return { success: true, message: "No existing Worker for env (confirmed absent)", exitCode: result.status ?? 1, data: { exists: false, checked: true } };
    }
    // Non-zero for some OTHER reason (auth, network, rate limit, parse) — existence UNKNOWN, fail closed.
    return {
      success: false,
      message: `Worker existence UNKNOWN (wrangler exit ${result.status ?? 1}): ${sanitize(out) || "no output"}`,
      exitCode: result.status ?? 1,
      data: { exists: false, checked: false },
    };
  }
  return { success: false, message: "wrangler not found — Worker existence UNKNOWN (failing closed)", exitCode: 127, data: { exists: false, checked: false } };
}

/**
 * Phase 18D — bulk-upload Worker secrets. The values map is serialized to JSON and handed to
 * `wrangler secret bulk` on STDIN (the `input` option), so secret values never appear in argv,
 * a file, or any log. Only the COUNT and NAMES are surfaced. wrangler reads its API token from env.
 */
async function uploadSecrets(
  wranglerEnv: string,
  secrets: Record<string, string>
): Promise<CloudflareCommandResult> {
  const names = Object.keys(secrets);
  if (names.length === 0) {
    return { success: true, message: "No secrets to upload (0)", exitCode: 0, data: { count: 0, names: [] } };
  }
  const payload = JSON.stringify(secrets);
  for (const [cmd, args] of [
    ["wrangler", ["secret", "bulk", "--env", wranglerEnv]],
    ["npx", ["wrangler", "secret", "bulk", "--env", wranglerEnv]],
  ] as [string, string[]][]) {
    const result = spawnSync(cmd, args, {
      encoding: "utf8",
      stdio: "pipe",
      shell: process.platform === "win32",
      input: payload, // secret VALUES travel here on stdin only — never argv/disk/log
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    if (result.status === 0) {
      return {
        success: true,
        message: `Uploaded ${names.length} secret(s): ${names.join(", ")}`,
        exitCode: 0,
        data: { count: names.length, names },
      };
    }
    // Sanitize CLI output defensively — it should never echo a value, but never risk it.
    return {
      success: false,
      message: `Secret upload failed (exit ${result.status ?? 1}). ${sanitize(result.stderr ?? "") || sanitize(result.stdout ?? "")}`,
      exitCode: result.status ?? 1,
      data: { count: 0, names },
    };
  }
  return { success: false, message: "wrangler not found. Install wrangler to upload secrets.", exitCode: 127, data: { count: 0, names } };
}

/** The default real Cloudflare operations. Pass to CloudflareAdapter constructor. */
export const realCloudflareOps: CloudflareOps = { deployWorker, workerExists, uploadSecrets };

/** Create a no-op mock for tests that must not call real wrangler. */
export function createMockCloudflareOps(
  overrides: Partial<CloudflareOps> = {}
): CloudflareOps {
  return {
    deployWorker: async () => ({
      success: true,
      message: "Mock deploy success (no real wrangler called)",
      exitCode: 0,
    }),
    workerExists: async () => ({
      success: true,
      message: "Mock: no existing worker",
      exitCode: 0,
      data: { exists: false, checked: true },
    }),
    uploadSecrets: async (_env, secrets) => ({
      success: true,
      message: `Mock: uploaded ${Object.keys(secrets).length} secret(s)`,
      exitCode: 0,
      data: { count: Object.keys(secrets).length, names: Object.keys(secrets) },
    }),
    ...overrides,
  };
}
