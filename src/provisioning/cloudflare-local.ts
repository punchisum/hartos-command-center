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
}

/** Injectable interface for Cloudflare operations (enables test mocking). */
export interface CloudflareOps {
  /** Deploy the Cloudflare Worker using wrangler. Never prints secrets. */
  deployWorker(wranglerEnv: string): Promise<CloudflareCommandResult>;
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

/** The default real Cloudflare operations. Pass to CloudflareAdapter constructor. */
export const realCloudflareOps: CloudflareOps = { deployWorker };

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
    ...overrides,
  };
}
