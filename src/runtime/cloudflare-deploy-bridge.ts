/**
 * src/runtime/cloudflare-deploy-bridge.ts
 *
 * Bridges the hosted cockpit into the existing Factory deployment/provisioning
 * gate doctrine (Phase 6/7B/10). It does NOT create a parallel deploy system:
 * it reuses the Factory's ALLOW_AUTO_PROVISION gate and adds the cockpit-specific
 * confirmation gates, then produces a readiness check, a deploy plan, and report
 * output. A real deploy is GATED and BLOCKED BY DEFAULT — the deploy script is a
 * safe stub that emits exact wrangler steps and never deploys during tests.
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { checkAutoProvisionGate } from "../provisioning/gates.js";
import { containsSecret } from "../llm/redaction.js";
import { summarizeEnvPresence, envPresent } from "./cloudflare-env.js";
import {
  ACTION_EXECUTION,
  MUTATION_ENDPOINTS,
  SECURITY_CHECKLIST,
} from "./cloudflare-security.js";
import { SUPPORTED_ROUTES } from "./cloudflare-cockpit-worker.js";
import type {
  CloudflareCockpitEnv,
  CockpitDeployGateResult,
  CloudflareReportKind,
} from "./cloudflare-cockpit-types.js";

export const DEFAULT_CLOUDFLARE_REPORTS_DIR = "cloudflare-cockpit-reports";

/** Gates required for any real cockpit deploy (Factory doctrine + cockpit gates). */
export const COCKPIT_DEPLOY_GATES = [
  "ALLOW_AUTO_PROVISION",
  "CONFIRM_CLOUDFLARE_DEPLOY",
  "ALLOW_CLOUDFLARE_COCKPIT_DEPLOY",
] as const;

export const COCKPIT_DEPLOY_REQUIRED_ENV = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

/**
 * Check deploy gates. Reuses the Factory ALLOW_AUTO_PROVISION gate, then layers
 * the cockpit confirmation gates and required-env presence. Returns
 * `blocked_missing_gate` when anything is missing.
 */
export function checkCockpitDeployGates(env: CloudflareCockpitEnv): CockpitDeployGateResult {
  const missingGates: string[] = [];

  // Reuse the existing Factory auto-provision gate.
  const autoGate = checkAutoProvisionGate(env);
  if (!autoGate.allowed) missingGates.push(...autoGate.missingGates);

  if (env["CONFIRM_CLOUDFLARE_DEPLOY"] !== "true") missingGates.push("CONFIRM_CLOUDFLARE_DEPLOY");
  if (env["ALLOW_CLOUDFLARE_COCKPIT_DEPLOY"] !== "true") missingGates.push("ALLOW_CLOUDFLARE_COCKPIT_DEPLOY");

  const requiredEnvPresent = COCKPIT_DEPLOY_REQUIRED_ENV.map((name) => ({
    name,
    present: envPresent(env, name),
  }));
  for (const r of requiredEnvPresent) {
    if (!r.present) missingGates.push(`${r.name} (env present)`);
  }

  const blocked = missingGates.length > 0;
  return {
    status: blocked ? "blocked_missing_gate" : "ready",
    missingGates,
    requiredEnvPresent,
    message: blocked
      ? `Deploy blocked. Missing: ${missingGates.join(", ")}.`
      : "All cockpit deploy gates are open.",
  };
}

export interface CloudflareCheckResult {
  runtimeFilesPresent: boolean;
  missingRuntimeFiles: string[];
  configPresent: { wranglerExample: boolean; devVarsExample: boolean };
}

export interface DeployPlan {
  kind: CloudflareReportKind;
  generatedAt: string;
  runtimeMode: "hosted";
  routes: string[];
  actionExecution: string;
  mutationEndpoints: string;
  gate: CockpitDeployGateResult;
  envPresence: { name: string; present: boolean; secret: boolean }[];
  securityChecklist: string[];
  cloudflareAccessRecommendation: string;
  deploymentSteps: string[];
  healthCheckPlan: string[];
  rollbackPlan: string[];
  notes: string[];
}

const CLOUDFLARE_ACCESS_RECOMMENDATION =
  "Put the hosted cockpit behind Cloudflare Access (Zero Trust) before any production exposure. " +
  "Do not rely on obscurity. See CLOUDFLARE_ACCESS_SETUP.md.";

export function buildDeployPlan(
  env: CloudflareCockpitEnv,
  kind: CloudflareReportKind,
  now: Date = new Date()
): DeployPlan {
  const gate = checkCockpitDeployGates(env);
  const workerName = envPresent(env, "CLOUDFLARE_WORKER_NAME") ? "$CLOUDFLARE_WORKER_NAME" : "<worker-name>";
  return {
    kind,
    generatedAt: now.toISOString(),
    runtimeMode: "hosted",
    routes: [...SUPPORTED_ROUTES],
    actionExecution: ACTION_EXECUTION,
    mutationEndpoints: MUTATION_ENDPOINTS,
    gate,
    envPresence: summarizeEnvPresence(env),
    securityChecklist: SECURITY_CHECKLIST,
    cloudflareAccessRecommendation: CLOUDFLARE_ACCESS_RECOMMENDATION,
    deploymentSteps: [
      "Review CLOUDFLARE_HOSTED_COCKPIT.md and CLOUDFLARE_FACTORY_DEPLOYMENT_BRIDGE.md.",
      "Set deploy gates: ALLOW_AUTO_PROVISION=true, CONFIRM_CLOUDFLARE_DEPLOY=true, ALLOW_CLOUDFLARE_COCKPIT_DEPLOY=true.",
      "Ensure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are present in .env.local / .dev.vars (never committed).",
      "Bake a cockpit snapshot for the Worker (see hosted cockpit doc).",
      `Run: wrangler deploy --name ${workerName} --var BUILD_SHA:$(git rev-parse --short HEAD) --var BUILD_TIME:$(date -u +%Y-%m-%dT%H:%M:%SZ)`,
      "(BUILD_SHA/BUILD_TIME make GET /health report exactly which commit is live — the deployed-SHA signal that makes 'live == a known SHA' true and rollback trustworthy.)",
      "Configure Cloudflare Access for the deployed route before sharing the URL.",
    ],
    healthCheckPlan: [
      "After deploy, GET <cockpit-url>/health → expect { ok: true } AND version === the deployed short SHA.",
      "Run: npm run smoke:staging — it asserts /health.version matches the deployed commit (fails if live code is not this commit).",
      "GET <cockpit-url>/api/state → expect read-only state JSON, no secrets.",
      "GET <cockpit-url>/api/debug/status → expect env PRESENCE only, no values.",
    ],
    rollbackPlan: [
      "Roll back via wrangler rollback or redeploy the previous version.",
      "Hosted cockpit is read-only; rollback affects only the served snapshot, never data.",
      "Local cockpit (npm run cockpit:web) remains available as a fallback.",
    ],
    notes: [
      "Real deploy is gated and blocked by default; the deploy script emits manual wrangler steps.",
      "No action execution, no provider/Supabase/ClickUp/Drive/Apple Health/Telegram mutation.",
    ],
  };
}

// ─── Reports ─────────────────────────────────────────────────────────────────

function renderReportMarkdown(plan: DeployPlan, check?: CloudflareCheckResult): string {
  const lines: string[] = [
    `# Cloudflare Hosted Cockpit — ${plan.kind}`,
    "",
    `- generatedAt: ${plan.generatedAt}`,
    `- runtime mode: ${plan.runtimeMode}`,
    `- action execution: ${plan.actionExecution}`,
    `- mutation endpoints: ${plan.mutationEndpoints}`,
    `- gate status: ${plan.gate.status}`,
    plan.gate.missingGates.length ? `- missing gates: ${plan.gate.missingGates.join(", ")}` : "- missing gates: none",
    "",
    "## Routes supported",
    "",
    ...plan.routes.map((r) => `- ${r}`),
    "",
    "## Environment presence (redacted — names only, no values)",
    "",
    ...plan.envPresence.map((e) => `- ${e.name}: ${e.present ? "present" : "missing"}${e.secret ? " (secret)" : ""}`),
    "",
  ];
  if (check) {
    lines.push(
      "## Runtime file check",
      "",
      `- runtime files present: ${check.runtimeFilesPresent}`,
      check.missingRuntimeFiles.length ? `- missing: ${check.missingRuntimeFiles.join(", ")}` : "- missing: none",
      `- wrangler.toml.example: ${check.configPresent.wranglerExample}`,
      `- .dev.vars.example: ${check.configPresent.devVarsExample}`,
      ""
    );
  }
  lines.push(
    "## Security checklist",
    "",
    ...plan.securityChecklist.map((c) => `- ${c}`),
    "",
    "## Cloudflare Access",
    "",
    `- ${plan.cloudflareAccessRecommendation}`,
    "",
    "## Deployment steps",
    "",
    ...plan.deploymentSteps.map((s) => `- ${s}`),
    "",
    "## Health check plan",
    "",
    ...plan.healthCheckPlan.map((s) => `- ${s}`),
    "",
    "## Rollback plan",
    "",
    ...plan.rollbackPlan.map((s) => `- ${s}`),
    "",
    "---",
    "Hosted cockpit is read-only. Deployment uses Factory gates; real deploy is blocked by default.",
    ""
  );
  return lines.join("\n");
}

export async function writeCloudflareCockpitReport(
  reportsDir: string,
  plan: DeployPlan,
  check?: CloudflareCheckResult
): Promise<{ mdPath: string; jsonPath: string }> {
  const md = renderReportMarkdown(plan, check);
  const json = JSON.stringify({ ...plan, check: check ?? null }, null, 2);
  if (containsSecret(md) || containsSecret(json)) {
    throw new Error("Refusing to write Cloudflare cockpit report: secret-looking content detected.");
  }
  await mkdir(reportsDir, { recursive: true });
  const stamp = plan.generatedAt.replace(/[:.]/g, "-");
  const mdPath = path.join(reportsDir, `cloudflare-cockpit-${plan.kind}-${stamp}.md`);
  const jsonPath = path.join(reportsDir, `cloudflare-cockpit-${plan.kind}-${stamp}.json`);
  await writeFile(mdPath, md, "utf8");
  await writeFile(jsonPath, json, "utf8");
  return { mdPath, jsonPath };
}
