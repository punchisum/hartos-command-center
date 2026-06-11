/**
 * src/beezulbub/pack-safety.ts
 *
 * Safety scanner for generated pack skeletons.
 *
 * Rules:
 *   - No raw secrets in generated files
 *   - No copied third-party source code (only stubs/docs)
 *   - No .env files
 *   - No package-lock from external repos
 *   - Secrets are redacted and recorded in rejected-poison.md
 */

export interface PackSafetyIssue {
  type: string;
  severity: "critical" | "high" | "medium";
  file?: string;
  description: string;
  action: string;
}

export interface PackSafetyResult {
  passed: boolean;
  issues: PackSafetyIssue[];
  summary: string;
}

/** Patterns that should never appear in generated pack files */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /[A-Za-z0-9+=_-]{40,}/,  // Generic long token
];

/** Filenames that must never appear in a generated pack */
const FORBIDDEN_FILENAMES = new Set([
  ".env",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/** Scan a map of filename → content for safety issues */
export function scanPackContent(
  files: Record<string, string>
): PackSafetyResult {
  const issues: PackSafetyIssue[] = [];

  for (const [filename, content] of Object.entries(files)) {
    // Check forbidden filenames
    const basename = filename.split("/").pop() ?? filename;
    if (FORBIDDEN_FILENAMES.has(basename)) {
      issues.push({
        type: "forbidden_file",
        severity: "critical",
        file: filename,
        description: `Forbidden file: ${basename}`,
        action: `Remove ${basename} from generated pack.`,
      });
      continue;
    }

    // Check for secret patterns
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        issues.push({
          type: "secret_detected",
          severity: "critical",
          file: filename,
          description: `Secret-like value detected in ${filename}`,
          action: "Redact value and move to rejected-poison.md.",
        });
        break;
      }
    }

    // Check for copied third-party code indicators
    if (
      content.includes("// Copyright") &&
      content.includes("All rights reserved") &&
      !content.includes("HartOS")
    ) {
      issues.push({
        type: "possible_third_party_code",
        severity: "high",
        file: filename,
        description: `Possible third-party copyright header in ${filename}`,
        action: "Remove third-party code. Use HartOS stubs only.",
      });
    }
  }

  const passed = issues.filter((i) => i.severity === "critical").length === 0;
  const summary =
    issues.length === 0
      ? "Pack safety scan passed — no issues detected."
      : `${issues.length} issue(s) found. ` +
        `Critical: ${issues.filter((i) => i.severity === "critical").length}. ` +
        `Pack ${passed ? "passed" : "FAILED"} safety scan.`;

  return { passed, issues, summary };
}

/** Redact secret-like values from a string */
export function redactSecrets(content: string): string {
  let redacted = content;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

/** Format safety issues as markdown for rejected-poison.md */
export function formatSafetyIssues(issues: PackSafetyIssue[]): string {
  if (issues.length === 0) {
    return `# Rejected Poison\n\nNo issues detected during pack safety scan.\n`;
  }

  const lines = [`# Rejected Poison`, ``];
  for (const issue of issues) {
    lines.push(`## [${issue.severity.toUpperCase()}] ${issue.type}`);
    if (issue.file) lines.push(`File: ${issue.file}`);
    lines.push(issue.description);
    lines.push(`Action: ${issue.action}`);
    lines.push(``);
  }
  return lines.join("\n") + "\n";
}
