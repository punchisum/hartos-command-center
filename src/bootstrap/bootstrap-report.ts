/**
 * src/bootstrap/bootstrap-report.ts
 *
 * Format and write bootstrap reports.
 * NEVER include raw secrets in any output.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BootstrapPlan, BootstrapResult } from "./types.js";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /[A-Za-z0-9_-]{40,}/,
];

export function assertNoSecretsInBootstrapReport(content: string): void {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(
        "Secret-looking value detected in bootstrap report. " +
          "Bootstrap reports must never contain secrets."
      );
    }
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "ready":
    case "applied": return "✓";
    case "manual_required": return "⚒";
    case "gate_missing": return "○";
    case "missing_env": return "✗";
    case "degraded": return "⚠";
    default: return "?";
  }
}

export function formatBootstrapPlan(plan: BootstrapPlan): string {
  const lines = [
    `# Bootstrap Plan: ${plan.agentName}`,
    ``,
    `Generated: ${plan.timestamp}`,
    ``,
    `## Summary`,
    `${plan.summary}`,
    ``,
  ];

  if (plan.missingGates.length > 0) {
    lines.push(`## Missing bootstrap gates`);
    lines.push(`Set these to run bootstrap:auto:`);
    for (const gate of plan.missingGates) {
      lines.push(`  ${gate}=true`);
    }
    lines.push(``);
  }

  if (plan.missingEnv.length > 0) {
    lines.push(`## Missing env vars`);
    lines.push(`Configure these before running bootstrap:`);
    for (const envVar of plan.missingEnv) {
      lines.push(`  ${envVar}=`);
    }
    lines.push(`See .env.example for placeholder names.`);
    lines.push(``);
  }

  lines.push(`## Steps`);
  lines.push(``);
  for (const step of plan.steps) {
    lines.push(`${statusIcon(step.status)} **${step.id}** [${step.status}]`);
    lines.push(`  ${step.message}`);
    if (step.nextAction) lines.push(`  Next: ${step.nextAction}`);
    if (step.manualCommands && step.manualCommands.length > 0) {
      lines.push(`  Commands:`);
      for (const cmd of step.manualCommands) {
        lines.push(`    ${cmd}`);
      }
    }
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}

export function formatBootstrapResult(result: BootstrapResult): string {
  const lines = [
    `# Bootstrap Result: ${result.agentName}`,
    ``,
    `Status: ${result.status}`,
    `Generated: ${result.timestamp}`,
    ``,
    `## Summary`,
    `${result.summary}`,
    ``,
    `## Steps`,
    ``,
  ];

  for (const step of result.results) {
    lines.push(`${statusIcon(step.status)} **${step.id}** [${step.status}]`);
    lines.push(`  ${step.message}`);
    if (step.nextAction) lines.push(`  Next: ${step.nextAction}`);
    lines.push(``);
  }

  if (result.results.some((r) => r.manualRequired)) {
    lines.push(`## Manual steps required`);
    lines.push(`Complete these steps then re-run bootstrap:auto:`);
    for (const step of result.results.filter((r) => r.manualRequired)) {
      lines.push(`- ${step.id}: ${step.nextAction}`);
      if (step.manualCommands) {
        for (const cmd of step.manualCommands) {
          lines.push(`  ${cmd}`);
        }
      }
    }
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}

export async function writeBootstrapReport(
  content: string,
  reportsDir: string,
  filename: string
): Promise<string> {
  assertNoSecretsInBootstrapReport(content);
  await mkdir(reportsDir, { recursive: true });
  const outputPath = path.join(reportsDir, filename);
  await writeFile(outputPath, content, "utf8");
  return outputPath;
}
