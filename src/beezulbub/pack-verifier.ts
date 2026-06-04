/**
 * src/beezulbub/pack-verifier.ts
 *
 * Pack verification — checks a pack skeleton/implementation against contract.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PackManifest } from "./pack-types.js";
import { isValidPackStatus } from "./pack-lifecycle.js";
import { loadLedger, hasProvenance } from "./provenance-ledger.js";

// ─── Verification result ──────────────────────────────────────────────────────

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface PackVerifyResult {
  packName: string;
  packPath: string;
  status: "passed" | "failed";
  passedCount: number;
  failedCount: number;
  checks: VerificationCheck[];
  nextAction: string;
  verifiedAt: string;
}

// ─── Secret pattern (for verification safety scan) ───────────────────────────

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /[A-Za-z0-9_-]{40,}/,
];

const FORBIDDEN_FILES = [".env", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

function check(name: string, passed: boolean, message: string): VerificationCheck {
  return { name, passed, message };
}

// ─── Main verifier ────────────────────────────────────────────────────────────

export async function verifyPack(
  packPath: string,
  ledgerPath?: string,
  cwd?: string
): Promise<PackVerifyResult> {
  const checks: VerificationCheck[] = [];
  const verifiedAt = new Date().toISOString();

  // 1. Pack directory exists
  checks.push(check(
    "pack_directory_exists",
    existsSync(packPath),
    existsSync(packPath) ? `Pack directory found: ${packPath}` : `Pack directory not found: ${packPath}`
  ));

  if (!existsSync(packPath)) {
    return buildResult(packPath, "unknown", checks, verifiedAt);
  }

  // 2. Manifest exists
  const manifestPath = path.join(packPath, "pack.manifest.json");
  const manifestExists = existsSync(manifestPath);
  checks.push(check(
    "manifest_exists",
    manifestExists,
    manifestExists ? "pack.manifest.json found" : "pack.manifest.json missing"
  ));

  let manifest: PackManifest | null = null;
  let packName = path.basename(packPath);

  if (manifestExists) {
    try {
      const raw = await readFile(manifestPath, "utf8");
      manifest = JSON.parse(raw) as PackManifest;
      packName = manifest.packName;

      checks.push(check(
        "manifest_has_required_fields",
        !!(manifest.packName && manifest.packVersion && manifest.status),
        manifest.packName && manifest.packVersion && manifest.status
          ? `Manifest valid: ${manifest.packName} v${manifest.packVersion}`
          : "Manifest missing required fields (packName, packVersion, or status)"
      ));

      checks.push(check(
        "manifest_status_valid",
        isValidPackStatus(manifest.status),
        isValidPackStatus(manifest.status)
          ? `Status is valid: ${manifest.status}`
          : `Status is invalid: ${manifest.status}`
      ));

      // 3. Manifest secret scan
      const manifestContent = JSON.stringify(manifest);
      const hasSecret = SECRET_PATTERNS.some((p) => p.test(manifestContent));
      checks.push(check(
        "manifest_no_secrets",
        !hasSecret,
        !hasSecret ? "No secrets in manifest" : "Secret-like value detected in manifest"
      ));
    } catch {
      checks.push(check("manifest_parseable", false, "pack.manifest.json is not valid JSON"));
    }
  }

  // 4. Required docs
  const requiredDocs = [
    "README.md",
    "adaptation-plan.md",
    "source-digest-summary.md",
    "rejected-poison.md",
    "implementation-notes.md",
  ];
  for (const doc of requiredDocs) {
    const exists = existsSync(path.join(packPath, doc));
    checks.push(check(`doc_${doc.replace(".", "_")}`, exists, exists ? `${doc} found` : `${doc} missing`));
  }

  // 5. Required test file
  const testExists = existsSync(path.join(packPath, "tests", "pack.contract.test.ts"));
  checks.push(check("contract_test_exists", testExists,
    testExists ? "tests/pack.contract.test.ts found" : "tests/pack.contract.test.ts missing"
  ));

  // 6. Smoke plan
  const smokeExists = existsSync(path.join(packPath, "smoke", "smoke-plan.md"));
  checks.push(check("smoke_plan_exists", smokeExists,
    smokeExists ? "smoke/smoke-plan.md found" : "smoke/smoke-plan.md missing"
  ));

  // 7. No forbidden files
  for (const forbidden of FORBIDDEN_FILES) {
    const forbiddenExists = existsSync(path.join(packPath, forbidden));
    checks.push(check(
      `no_${forbidden.replace(".", "_")}`,
      !forbiddenExists,
      !forbiddenExists ? `${forbidden} not found (good)` : `${forbidden} found — must be removed`
    ));
  }

  // 8. Provenance check
  if (ledgerPath && manifest) {
    try {
      const ledger = await loadLedger(path.resolve(cwd ?? process.cwd(), ledgerPath));
      const hasProv = manifest.capabilities.some((cap) => hasProvenance(ledger, cap));
      checks.push(check(
        "provenance_exists",
        hasProv,
        hasProv ? "Provenance recorded in ledger" : "No provenance found — run pack-generate first"
      ));
    } catch {
      checks.push(check("provenance_exists", false, "Could not read provenance ledger"));
    }
  }

  // 9. No production deploy script
  const deployScriptExists = existsSync(path.join(packPath, "deploy.sh")) ||
    existsSync(path.join(packPath, "deploy.ts")) ||
    existsSync(path.join(packPath, "deploy.js"));
  checks.push(check(
    "no_deploy_script",
    !deployScriptExists,
    !deployScriptExists ? "No direct deploy scripts (good)" : "Direct deploy script found — remove it"
  ));

  return buildResult(packPath, packName, checks, verifiedAt);
}

function buildResult(
  packPath: string,
  packName: string,
  checks: VerificationCheck[],
  verifiedAt: string
): PackVerifyResult {
  const failedChecks = checks.filter((c) => !c.passed);
  const status = failedChecks.length === 0 ? "passed" : "failed";

  const nextAction = status === "passed"
    ? `Pack verified. Run: npm run beezulbub:pack-promote -- --pack=${packPath} --to=verified --approve-promote`
    : `Fix ${failedChecks.length} failing check(s), then re-run: npm run beezulbub:pack-verify -- --pack=${packPath}`;

  return {
    packName,
    packPath,
    status,
    passedCount: checks.filter((c) => c.passed).length,
    failedCount: failedChecks.length,
    checks,
    nextAction,
    verifiedAt,
  };
}

export function formatVerifyReport(result: PackVerifyResult): string {
  const icon = result.status === "passed" ? "✅" : "❌";
  const lines = [
    `# Pack Verification: ${result.packName}`,
    ``,
    `Status: ${icon} ${result.status.toUpperCase()}`,
    `Verified: ${result.verifiedAt}`,
    `Checks: ${result.passedCount} passed, ${result.failedCount} failed`,
    ``,
    `## Checks`,
    ``,
  ];

  for (const c of result.checks) {
    lines.push(`${c.passed ? "✓" : "✗"} **${c.name}**: ${c.message}`);
  }

  lines.push(``);
  lines.push(`## Next action`);
  lines.push(``);
  lines.push(result.nextAction);
  lines.push(``);
  lines.push(`---`);
  lines.push(`Generated by HartOS Beezulbub Phase 11D`);

  return lines.join("\n") + "\n";
}
