/**
 * src/launch/production-readiness.ts
 *
 * Pre-production promotion readiness checks.
 * No mutations. Reports status of all gates and staging proof.
 */

import path from "node:path";
import type { ReadinessItem, LaunchReadinessResult } from "./types.js";
import { readLatestStagingProof } from "./promotion.js";
import { checkProviderStatus } from "../runtime/env.js";

const PRODUCTION_GATES = [
  "ALLOW_PRODUCTION_PROMOTION",
  "CONFIRM_PRODUCTION_DEPLOY",
  "ALLOW_AUTO_PROVISION",
];

const PROVIDER_PRODUCTION_GATES: Record<string, string> = {
  github: "ALLOW_GITHUB_PROVISION",
  openai: "ALLOW_OPENAI_VERIFY",
  supabase: "ALLOW_SUPABASE_PROVISION",
  cloudflare: "ALLOW_CLOUDFLARE_DEPLOY",
  telegram: "ALLOW_TELEGRAM_WEBHOOK_REGISTER",
  trigger: "ALLOW_TRIGGER_TASK_REGISTER",
};

function item(name: string, ok: boolean, note: string): ReadinessItem {
  return { name, ok, note };
}

export async function checkProductionReadiness(
  env: Record<string, string | undefined>,
  root: string
): Promise<LaunchReadinessResult> {
  const checks: ReadinessItem[] = [];
  const missingGates: string[] = [];
  const warnings: string[] = [];

  // 1. Production gates
  for (const gate of PRODUCTION_GATES) {
    const open = env[gate] === "true";
    checks.push(item(`gate:${gate}`, open, open ? "open" : `set ${gate}=true`));
    if (!open) missingGates.push(gate);
  }

  // 2. Provider gates
  for (const [provider, gate] of Object.entries(PROVIDER_PRODUCTION_GATES)) {
    const open = env[gate] === "true";
    checks.push(item(`gate:${provider}`, open, open ? "open" : `set ${gate}=true`));
    if (!open) missingGates.push(gate);
  }

  // 3. Provider env vars
  const providerStatuses = checkProviderStatus(env as Record<string, string>);
  for (const ps of providerStatuses) {
    const missing = ps.checks.filter((c) => !c.present).map((c) => c.name);
    checks.push(
      item(`provider:${ps.provider}`, ps.configured,
        ps.configured ? "configured" : `missing: ${missing.join(", ")}`)
    );
    if (!ps.configured) warnings.push(`${ps.provider}: missing ${missing.join(", ")}`);
  }

  // 4. Staging proof
  const reportsDir = path.join(root, "launch-reports");
  const proof = await readLatestStagingProof(reportsDir);

  if (!proof.found) {
    checks.push(
      item("staging:proof", false, "No staging launch report found. Run launch:staging first.")
    );
    missingGates.push("STAGING_PROOF");
  } else {
    const isGreen = proof.status === "success";
    const isPartial = proof.status === "partial";
    const allowPartial = env["ALLOW_PARTIAL_STAGING_PROMOTION"] === "true";
    const stagingOk = isGreen || (isPartial && allowPartial);

    checks.push(
      item(
        "staging:proof",
        stagingOk,
        `Staging status: ${proof.status ?? "unknown"} (${proof.timestamp?.slice(0, 10) ?? "?"})`
      )
    );
    if (!stagingOk) {
      if (isPartial) {
        warnings.push("Staging was partial — set ALLOW_PARTIAL_STAGING_PROMOTION=true to override");
      } else {
        missingGates.push("STAGING_SUCCESS");
      }
    }
  }

  // 5. CONFIRM_PRODUCTION_DEPLOY must be set explicitly
  const confirmed = env["CONFIRM_PRODUCTION_DEPLOY"] === "true";
  checks.push(
    item(
      "production:confirmed",
      confirmed,
      confirmed ? "CONFIRM_PRODUCTION_DEPLOY=true" : "set CONFIRM_PRODUCTION_DEPLOY=true"
    )
  );

  const nonGateChecks = checks.filter(
    (c) => !c.name.startsWith("gate:") && !c.name.startsWith("provider:")
  );
  const ready = nonGateChecks.every((c) => c.ok);

  return { ready, checks, missingGates, warnings };
}
