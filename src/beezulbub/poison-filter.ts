/**
 * src/beezulbub/poison-filter.ts
 *
 * Detect toxic patterns in candidate repositories.
 * A repo can be PARTIAL_DEVOUR even with poison — report it and reject the poison parts.
 */

import type { PoisonFlag, PoisonSeverity } from "./types.js";

// ─── Pattern definitions ──────────────────────────────────────────────────────

interface PoisonPattern {
  id: string;
  severity: PoisonSeverity;
  description: string;
  recommendation: string;
}

const FILE_POISON_PATTERNS: PoisonPattern[] = [
  {
    id: "committed_env",
    severity: "critical",
    description: ".env file committed to repository",
    recommendation: "Never copy .env files. Add to .gitignore. Use .env.example instead.",
  },
  {
    id: "committed_credentials",
    severity: "critical",
    description: "Credentials file committed (credentials.json, service-account.json, etc.)",
    recommendation: "Reject entirely. Credentials must never be in source control.",
  },
  {
    id: "committed_key_file",
    severity: "critical",
    description: "Private key file committed (.pem, .key, .p12, etc.)",
    recommendation: "Reject. Private keys must never be in source control.",
  },
];

const CODE_POISON_PATTERNS: Array<{
  pattern: RegExp;
  id: string;
  severity: PoisonSeverity;
  description: string;
  recommendation: string;
}> = [
  {
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*["'][A-Za-z0-9_\-./]{8,}/i,
    id: "hardcoded_api_key",
    severity: "critical",
    description: "Hardcoded API key detected",
    recommendation: "Reject this code path. Extract to env var before absorbing.",
  },
  {
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"']{4,}/i,
    id: "hardcoded_password",
    severity: "critical",
    description: "Hardcoded password detected",
    recommendation: "Reject this code path. Never absorb hardcoded credentials.",
  },
  {
    pattern: /(?:secret|token)\s*[=:]\s*["'][A-Za-z0-9_\-./]{8,}/i,
    id: "hardcoded_secret",
    severity: "high",
    description: "Hardcoded secret/token detected",
    recommendation: "Reject this code pattern. Extract to env var.",
  },
  {
    pattern: /https?:\/\/[^"'\s]*:[^@"'\s]+@[^"'\s]+/,
    id: "credentials_in_url",
    severity: "critical",
    description: "Credentials embedded in URL",
    recommendation: "Reject. Never copy URLs with embedded credentials.",
  },
  {
    pattern: /process\.env\.[A-Z_]+\s*(?:\|\|)?\s*["'][^"']{6,}/i,
    id: "env_fallback_hardcoded",
    severity: "medium",
    description: "Env var with hardcoded fallback value",
    recommendation: "Remove hardcoded fallbacks. Use safe defaults only.",
  },
  {
    pattern: /eval\s*\(/,
    id: "eval_usage",
    severity: "high",
    description: "eval() usage detected",
    recommendation: "Avoid absorbing eval() patterns. Rewrite before use.",
  },
  {
    pattern: /console\.log\s*\(.*(?:key|token|secret|password|auth)/i,
    id: "secret_logged",
    severity: "high",
    description: "Potential secret value logged to console",
    recommendation: "Reject logging patterns that may leak secrets.",
  },
];

const ARCHITECTURE_POISON_PATTERNS: PoisonPattern[] = [
  {
    id: "direct_production_deploy",
    severity: "medium",
    description: "Direct production deploy script without approval gates",
    recommendation: "Reject deploy scripts. Use HartOS launch:staging + promote:production.",
  },
  {
    id: "no_test_suite",
    severity: "medium",
    description: "No test suite found",
    recommendation: "Requires adding tests before absorption into HartOS packs.",
  },
  {
    id: "vendor_lockout",
    severity: "medium",
    description: "Deep vendor lock-in detected (proprietary APIs hard-coded)",
    recommendation: "Abstract vendor dependencies behind HartOS provider adapters.",
  },
  {
    id: "bypasses_hartos_gates",
    severity: "high",
    description: "Architecture bypasses expected HartOS approval/gate patterns",
    recommendation: "Rewrite to use HartOS provisioning gates before absorbing.",
  },
];

// ─── File path checks ────────────────────────────────────────────────────────

export function checkFilePaths(filePaths: string[]): PoisonFlag[] {
  const flags: PoisonFlag[] = [];
  const lowerPaths = filePaths.map((f) => f.toLowerCase());

  // .env committed
  if (lowerPaths.some((p) => p.endsWith("/.env") || p === ".env")) {
    const pattern = FILE_POISON_PATTERNS.find((p) => p.id === "committed_env")!;
    flags.push({
      type: pattern.id,
      severity: pattern.severity,
      description: pattern.description,
      location: filePaths.find((f) => f.toLowerCase().endsWith("/.env") || f === ".env"),
      recommendation: pattern.recommendation,
    });
  }

  // Credentials files
  const credentialPatterns = [
    /credentials\.json$/i,
    /service-account\.json$/i,
    /serviceaccount\.json$/i,
    /secret\.json$/i,
  ];
  for (const p of credentialPatterns) {
    const found = filePaths.find((f) => p.test(f));
    if (found) {
      flags.push({
        type: "committed_credentials",
        severity: "critical",
        description: "Credentials file committed",
        location: found,
        recommendation: "Reject. Do not copy credentials files.",
      });
    }
  }

  // Private key files
  const keyPatterns = [/\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /id_rsa$/i, /id_ed25519$/i];
  for (const p of keyPatterns) {
    const found = filePaths.find((f) => p.test(f));
    if (found) {
      flags.push({
        type: "committed_key_file",
        severity: "critical",
        description: "Private key file committed",
        location: found,
        recommendation: "Reject. Never copy private keys.",
      });
    }
  }

  return flags;
}

// ─── Code content checks ──────────────────────────────────────────────────────

export function checkCodeContent(content: string, filePath?: string): PoisonFlag[] {
  const flags: PoisonFlag[] = [];

  for (const pattern of CODE_POISON_PATTERNS) {
    if (pattern.pattern.test(content)) {
      flags.push({
        type: pattern.id,
        severity: pattern.severity,
        description: pattern.description,
        location: filePath,
        recommendation: pattern.recommendation,
      });
    }
  }

  return flags;
}

// ─── Architecture checks ──────────────────────────────────────────────────────

export function checkArchitecture(options: {
  hasTests: boolean;
  deployScripts: string[];
  hasDeepVendorLock: boolean;
  bypassesGates: boolean;
}): PoisonFlag[] {
  const flags: PoisonFlag[] = [];

  if (!options.hasTests) {
    const p = ARCHITECTURE_POISON_PATTERNS.find((p) => p.id === "no_test_suite")!;
    flags.push({ type: p.id, severity: p.severity, description: p.description, recommendation: p.recommendation });
  }

  if (options.deployScripts.length > 0) {
    const p = ARCHITECTURE_POISON_PATTERNS.find((p) => p.id === "direct_production_deploy")!;
    flags.push({
      type: p.id,
      severity: p.severity,
      description: `${p.description}: ${options.deployScripts.join(", ")}`,
      recommendation: p.recommendation,
    });
  }

  if (options.hasDeepVendorLock) {
    const p = ARCHITECTURE_POISON_PATTERNS.find((p) => p.id === "vendor_lockout")!;
    flags.push({ type: p.id, severity: p.severity, description: p.description, recommendation: p.recommendation });
  }

  if (options.bypassesGates) {
    const p = ARCHITECTURE_POISON_PATTERNS.find((p) => p.id === "bypasses_hartos_gates")!;
    flags.push({ type: p.id, severity: p.severity, description: p.description, recommendation: p.recommendation });
  }

  return flags;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function summarisePoisonFlags(flags: PoisonFlag[]): string {
  if (flags.length === 0) return "No poison detected.";
  const critical = flags.filter((f) => f.severity === "critical").length;
  const high = flags.filter((f) => f.severity === "high").length;
  const medium = flags.filter((f) => f.severity === "medium").length;
  const low = flags.filter((f) => f.severity === "low").length;
  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (high > 0) parts.push(`${high} high`);
  if (medium > 0) parts.push(`${medium} medium`);
  if (low > 0) parts.push(`${low} low`);
  return `${flags.length} poison flag(s): ${parts.join(", ")}`;
}
